from collections import Counter, defaultdict
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from itertools import batched
from typing import Any

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import F, Q
from django.http import HttpRequest, HttpResponse
from django.utils import timezone

from accounts.demo_access import is_active_guest_demo_user
from crops.agent_api.authentication import header_carries_crop_library_token
from farm.agent_api.authentication import header_carries_api_token
from farm.models import (
    CountedActionOperation,
    EntityRevision,
    ProjectActionDay,
    ProjectActiveUserDay,
    ProjectChangeDay,
)

ACTIVITY_RETENTION_DAYS = 90
Category = ProjectChangeDay.Category
ENTITY_CATEGORIES = {
    'planting_plan': Category.PLANTING,
    'crop': Category.CROP,
    'location': Category.GROWING_AREA,
    'field': Category.GROWING_AREA,
    'bed': Category.GROWING_AREA,
    'bed_layout': Category.GROWING_AREA,
    'field_layout': Category.GROWING_AREA,
    'harvest_record': Category.HARVEST,
    'harvest_allocation': Category.HARVEST,
    'seed_package': Category.SEED,
    'season': Category.SEASON,
    'season_pattern': Category.SEASON,
    'task': Category.TASK,
}
CASCADE_CATEGORIES = {
    f"farm.{entity_type.replace('_', '')}": category
    for entity_type, category in ENTITY_CATEGORIES.items()
}
CREATED = EntityRevision.ACTION_CREATED
UPDATED = EntityRevision.ACTION_UPDATED
DELETED = EntityRevision.ACTION_DELETED
RESTORED = EntityRevision.ACTION_RESTORED
# The audit log also records import provenance, housekeeping and notice state.
NON_CONTENT_FIELDS = frozenset({
    'id', 'created_at', 'updated_at', 'project_id', 'created_by_id', 'updated_by_id',
    'name_normalized', 'variety_normalized', 'source_public_version', 'rejected_public_version',
    'is_modified_from_source', '_project_version_internal',
})

type Change = tuple[int, str, int, str]  # project, entity type, object, action
type State = dict[str, dict[str, dict[str, Any]]]


@dataclass
class RevisionChanges:
    created_at: datetime
    entities: list[Change]
    cascaded_deletions: Counter[tuple[int, Category]] = field(default_factory=Counter)
    # The history batch shared by every request of one multi-request operation.
    batch_id: int | None = None


type PendingChanges = dict[int, RevisionChanges]
_pending_changes: ContextVar[PendingChanges | None] = ContextVar(
    'project_usage_changes', default=None,
)


@contextmanager
def collect_usage_changes() -> Iterator[PendingChanges]:
    changes: PendingChanges = {}
    token = _pending_changes.set(changes)
    try:
        yield changes
    finally:
        _pending_changes.reset(token)


def observe_entity_revision(revision: EntityRevision, *, measure_usage: bool) -> None:
    """Remember action metadata in memory until the revision's transaction succeeds."""
    pending = _pending_changes.get()
    if pending is None:
        return
    # SQLite can reuse an ID from a rolled-back savepoint inside the same request.
    pending.pop(revision.pk, None)
    entity_type = (
        'season_pattern' if revision.entity_type == 'seasonpattern' else revision.entity_type
    )
    if not measure_usage or entity_type not in ENTITY_CATEGORIES:
        return
    action = revision.action
    if action == UPDATED:
        fields = set(revision.changed_fields) - NON_CONTENT_FIELDS
        if not fields:
            return
        if 'deleted_at' in fields:
            action = DELETED if revision.snapshot.get('deleted_at') else RESTORED
    pending[revision.pk] = RevisionChanges(revision.created_at, [
        (revision.project_id, entity_type, revision.object_id, action),
    ], batch_id=revision.batch_operation_id)


def observe_cascaded_deletions(
    revision: EntityRevision, deleted_models: dict[str, int], *, root_model: str,
) -> None:
    """Attach the actual cascade counts to the same audit row as the root deletion."""
    pending = _pending_changes.get()
    if pending is None:
        return
    children = Counter()
    for model, count in deleted_models.items():
        category = CASCADE_CATEGORIES.get(model.lower())
        # The root object's audit revision already contributes its own deletion.
        count -= int(model == root_model)
        if category is not None and count > 0:
            children[revision.project_id, category] += count
    if children:
        event = pending.setdefault(revision.pk, RevisionChanges(
            revision.created_at, [], batch_id=revision.batch_operation_id,
        ))
        event.cascaded_deletions.update(children)


def _snapshot_action(old: dict | None, new: dict | None) -> str | None:
    old_live = old is not None and not old.get('deleted_at')
    new_live = new is not None and not new.get('deleted_at')
    if old_live and not new_live:
        return DELETED
    if new_live and not old_live:
        return RESTORED
    if old_live and new_live and any(
        old.get(key) != new.get(key) for key in (old.keys() | new.keys()) - NON_CONTENT_FIELDS
    ):
        return UPDATED
    return None


def observe_restored_state(checkpoint: EntityRevision, before: State, after: State) -> None:
    """Use the already captured states for inverse writes without per-entity revisions."""
    pending = _pending_changes.get()
    if pending is None:
        return
    changes = []
    for category in before.keys() & after.keys() & ENTITY_CATEGORIES.keys():
        old, new = before[category], after[category]
        for pk in old.keys() | new.keys():
            if action := _snapshot_action(old.get(pk), new.get(pk)):
                changes.append((checkpoint.project_id, category, int(pk), action))
    if changes:
        pending[checkpoint.pk] = RevisionChanges(
            checkpoint.created_at, changes, batch_id=checkpoint.batch_operation_id,
        )


def _committed_changes(pending: PendingChanges) -> Iterator[RevisionChanges]:
    """A revision discarded by a rolled-back savepoint cannot contribute."""
    for ids in batched(sorted(pending), 500):
        revisions = EntityRevision.objects.filter(
            pk__in=ids, project__guest_demo_session__isnull=True,
        ).filter(
            Q(project__demo_seeded_at__isnull=True) |
            Q(created_at__gt=F('project__demo_seeded_at')),
        )
        for revision_id, created_at in revisions.order_by('pk').values_list('pk', 'created_at'):
            event = pending[revision_id]
            if created_at == event.created_at:
                yield event


def _completed_action(actions: list[str]) -> str | None:
    first, last = actions[0], actions[-1]
    if first == CREATED and last == DELETED:
        return None
    if last == DELETED:
        return DELETED
    if first == CREATED:
        return CREATED
    if RESTORED in actions:
        return RESTORED
    return UPDATED


def _completed_totals(events: list[RevisionChanges]) -> dict[tuple[int, Category], Counter]:
    object_actions = defaultdict(list)
    totals = defaultdict(Counter)
    for event in events:
        for project_id, entity_type, pk, action in event.entities:
            object_actions[project_id, entity_type, pk].append(action)
        for key, count in event.cascaded_deletions.items():
            totals[key][DELETED] += count
    for (project_id, entity_type, _), actions in object_actions.items():
        if action := _completed_action(actions):
            totals[project_id, ENTITY_CATEGORIES[entity_type]][action] += 1
    return totals


def _event_projects(event: RevisionChanges) -> set[int]:
    return {change[0] for change in event.entities} | {
        project_id for project_id, _ in event.cascaded_deletions
    }


def _claim_operation(batch_id: int, day: date) -> bool:
    """Whether this request is the first to count the batch; safe under concurrency."""
    try:
        with transaction.atomic():
            CountedActionOperation.objects.create(batch_operation_id=batch_id, day=day)
    except IntegrityError:
        return False
    return True


def _primary_category(counts: dict[Category, int]) -> Category:
    """The category with the most changed objects; ties follow the category order."""
    order = list(Category)
    return max(counts, key=lambda category: (counts[category], -order.index(category)))


def _action_categories(
    day: date, events: list[RevisionChanges], totals: dict[tuple[int, Category], Counter],
) -> dict[int, Category]:
    """One action per changed project, unless it only continues an already counted batch.

    A request counts on its own once it commits a change outside any history
    batch; otherwise each of its batches counts the first time it commits a
    change, so the batched requests and retries of one import stay one action.
    """
    changed: dict[int, dict[Category, int]] = defaultdict(dict)
    for (project_id, category), counts in totals.items():
        changed[project_id][category] = sum(counts.values())
    actions = {}
    for project_id, counts in sorted(changed.items()):
        batches = set()
        unbatched = False
        for event in events:
            if project_id in _event_projects(event):
                unbatched |= event.batch_id is None
                batches.add(event.batch_id)
        claimed = [_claim_operation(batch_id, day) for batch_id in sorted(batches - {None})]
        if unbatched or any(claimed):
            actions[project_id] = _primary_category(counts)
    return actions


def _save_totals(day: date, user_id: int, pending: PendingChanges) -> None:
    events = list(_committed_changes(pending))
    totals = _completed_totals(events)
    for (project_id, category), counts in sorted(totals.items()):
        row, created = ProjectChangeDay.objects.get_or_create(
            day=day, project_id=project_id, category=category, defaults=counts,
        )
        if not created:
            ProjectChangeDay.objects.filter(pk=row.pk).update(
                **{action: F(action) + count for action, count in counts.items()},
            )
    for project_id, category in _action_categories(day, events, totals).items():
        row, created = ProjectActionDay.objects.get_or_create(
            day=day, project_id=project_id, category=category, defaults={'count': 1},
        )
        if not created:
            ProjectActionDay.objects.filter(pk=row.pk).update(count=F('count') + 1)
    ProjectActiveUserDay.objects.bulk_create(
        [ProjectActiveUserDay(day=day, user_id=user_id, project_id=project_id)
         for project_id in sorted({key[0] for key in totals})],
        ignore_conflicts=True,
    )


class ProjectUsageMiddleware:
    """Count successful signed-in project writes, with the metrics in the same transaction."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response
        prefix = settings.URL_PREFIX.strip('/')
        self.prefixes = (
            f'/{prefix}/api/' if prefix else '/api/',
            '/openfarmplanner/api/',
        )

    def __call__(self, request: HttpRequest) -> HttpResponse:
        if not self._observe_request(request):
            return self.get_response(request)

        user = request.user
        with collect_usage_changes() as pending, transaction.atomic():
            # Keep activity writes and account anonymization ordered by the user row.
            # Lock before the view can take project locks, as account deletion does.
            can_record = get_user_model().objects.select_for_update(no_key=True).filter(
                pk=user.pk, is_active=True, is_staff=False, is_superuser=False,
            ).exists()
            response = self.get_response(request)
            if (
                can_record and pending and 200 <= response.status_code < 300
                and not is_active_guest_demo_user(user)
            ):
                _save_totals(timezone.now().astimezone(UTC).date(), user.pk, pending)
            return response

    def _observe_request(self, request: HttpRequest) -> bool:
        if request.method not in {'POST', 'PUT', 'PATCH', 'DELETE'}:
            return False
        if not request.path_info.startswith(self.prefixes):
            return False
        authorization = request.META.get('HTTP_AUTHORIZATION', '')
        if (
            request.session.get('agent_mode')
            or header_carries_api_token(authorization)
            or header_carries_crop_library_token(authorization)
        ):
            return False
        user = request.user
        return user.is_authenticated and user.is_active and not (user.is_staff or user.is_superuser)
