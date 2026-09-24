"""Point-in-time restore and batch-operation revert, built on recorded
entity revisions."""

from collections.abc import Callable
from typing import Any

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from farm.models import Crop, EntityRevision, PlantingPlan, Project, Task

from .records import (
    _ENTITY_TYPE_LABELS,
    _RESTORABLE_ENTITY_TYPES,
    _entity_display_name,
    _serialize_instance,
    record_entity_revision,
    start_batch_operation,
)

_MODEL_BY_ENTITY_TYPE: dict[str, type] = {label: model for model, label in _ENTITY_TYPE_LABELS.items()}
_ENTITY_TYPE_ORDER: dict[str, int] = {label: index for index, (_m, label) in enumerate(_RESTORABLE_ENTITY_TYPES)}


def _model_manager(model):
    return getattr(model, 'all_objects', None) or model._base_manager


def _bulk_create_skipping_conflicts(model, instances: list, object_ids: list[int]) -> set[int]:
    """Recreate `instances` (aligned with `object_ids`), returning the ids that
    landed.

    Fast path is one `bulk_create`. It can still fail when two historical
    snapshots both look "active" and collide on a (possibly partial) unique
    constraint — which happens when an entity was hard-deleted without an
    `ACTION_DELETED` revision (e.g. an old demo reset). Then fall back to
    inserting row by row in savepoints and skip the losers; callers pass the
    rows newest-id-first, so the most recent snapshot wins.
    """
    if not instances:
        return set()
    try:
        with transaction.atomic():
            model.objects.bulk_create(instances)
        return set(object_ids)
    except IntegrityError:
        pass

    inserted: set[int] = set()
    for instance, object_id in zip(instances, object_ids, strict=True):
        try:
            with transaction.atomic():
                model.objects.bulk_create([instance])
            inserted.add(object_id)
        except IntegrityError:
            continue
    return inserted


def _entity_states_at(project: Project, entity_type: str, target_time) -> dict[int, dict[str, Any] | None]:
    """Return {object_id: snapshot} for every object with a revision at/before
    target_time; a value of None marks an object that was deleted by then."""
    revisions = (
        EntityRevision.objects
        .filter(project=project, entity_type=entity_type, created_at__lte=target_time)
        .order_by('object_id', '-created_at')
    )
    states: dict[int, dict[str, Any] | None] = {}
    for revision in revisions:
        if revision.object_id in states:
            continue
        states[revision.object_id] = None if revision.action == EntityRevision.ACTION_DELETED else revision.snapshot
    return states


_SKIP_ON_UPDATE = {'id', 'created_at', 'updated_at'}


def is_latest_project_revision(project: Project, revision: EntityRevision) -> bool:
    """Whether `revision` is the project's newest one, i.e. the current state.

    Ordered by `(created_at, id)`, matching `ProjectHistoryListView`.
    """
    return not (
        EntityRevision.objects
        .filter(project=project)
        .filter(
            Q(created_at__gt=revision.created_at)
            | Q(created_at=revision.created_at, id__gt=revision.id)
        )
        .exists()
    )


def _restore_project_state_at(project: Project, target_time) -> None:
    """Roll every restorable entity type back to its state at target_time.

    Works only through recorded revisions and never mass-deletes: a tracked row
    is *updated in place* to its snapshot (or recreated if it had been
    deleted). The only rows it removes are ones history positively records as
    deleted by target_time. Rows history never recorded (the auto
    "Hauptstandort" default, demo-seeder rows, data predating history) — and
    entities merely created *after* target_time — are left untouched, so a
    partial history can't empty a project or orphan its planting plans. The
    trade-off is deliberate: recovering old state matters more than perfectly
    un-creating everything newer.
    """
    restorable_models = {model for model, _entity_type in _RESTORABLE_ENTITY_TYPES}
    with transaction.atomic():
        # 1. Remove tracked rows history records as deleted by target_time.
        #    Reverse dependency order so a parent's delete cascade never hits a
        #    child we still have to process.
        for model, entity_type in reversed(_RESTORABLE_ENTITY_TYPES):
            states = _entity_states_at(project, entity_type, target_time)
            gone_at_target = {object_id for object_id, snap in states.items() if snap is None}
            if gone_at_target:
                _model_manager(model).filter(project=project, pk__in=gone_at_target).delete()

        # 2. Bring every tracked row that existed at target_time to its
        #    snapshot — update in place, or recreate if it had been deleted.
        present_ids: dict[type, set[int]] = {}
        for model, entity_type in _RESTORABLE_ENTITY_TYPES:
            manager = _model_manager(model)
            allowed_fields = {field.attname for field in model._meta.concrete_fields}
            restorable_fk_fields = [
                field for field in model._meta.concrete_fields
                if field.remote_field is not None and field.remote_field.model in restorable_models
            ]
            # FKs to non-restorable models can still dangle if the target row was
            # hard-deleted since the snapshot — null the (nullable) FK instead of
            # failing the insert.
            external_fk_fields = [
                field for field in model._meta.concrete_fields
                if field.remote_field is not None
                and field.remote_field.model not in restorable_models
                and field.null
            ]
            existing_external_ids: dict[type, set[int]] = {
                field.remote_field.model: set(
                    field.remote_field.model._base_manager.values_list('pk', flat=True)
                )
                for field in external_fk_fields
            }

            live_ids = set(manager.filter(project=project).values_list('pk', flat=True))
            present_ids[model] = set(live_ids)
            states = _entity_states_at(project, entity_type, target_time)
            recreate: list[tuple[int, Any]] = []
            for object_id, snapshot in states.items():
                if snapshot is None:
                    continue
                # Skip if a parent this row needs was itself not restored.
                if any(
                    snapshot.get(field.attname) is not None
                    and snapshot[field.attname] not in present_ids.get(field.remote_field.model, set())
                    for field in restorable_fk_fields
                ):
                    continue
                # Snapshots may carry fields the model has since dropped — keep
                # only what still exists rather than crashing on an unknown kwarg.
                row_data = {key: value for key, value in snapshot.items() if key in allowed_fields}
                for field in external_fk_fields:
                    if (
                        row_data.get(field.attname) is not None
                        and row_data[field.attname] not in existing_external_ids[field.remote_field.model]
                    ):
                        row_data[field.attname] = None
                row_data['project_id'] = project.id
                if 'deleted_at' in allowed_fields:
                    row_data['deleted_at'] = None

                if object_id in live_ids:
                    manager.filter(pk=object_id).update(
                        **{key: value for key, value in row_data.items() if key not in _SKIP_ON_UPDATE},
                    )
                    present_ids[model].add(object_id)
                else:
                    recreate.append((object_id, model(**row_data)))

            # Newest object_id first, so a unique-constraint collision between
            # two stale snapshots resolves in favour of the most recent one.
            recreate.sort(key=lambda pair: pair[0], reverse=True)
            present_ids[model] |= _bulk_create_skipping_conflicts(
                model,
                [instance for _object_id, instance in recreate],
                [object_id for object_id, _instance in recreate],
            )


def restore_crop_from_revision(crop: Crop, revision: EntityRevision) -> Crop:
    """Write a revision's snapshot back onto `crop` and undelete it.

    Fields the snapshot cannot own — the primary key and the timestamps — are
    skipped, so restoring an old version keeps the row's identity and its
    audit timestamps. `_history_action` tags the resulting save as a restore
    rather than a plain update (see `Crop.save`).
    """
    restorable_fields = {
        field.name for field in Crop._meta.fields
        if field.name not in {'id', 'created_at', 'updated_at'}
    }

    with transaction.atomic():
        for key, value in revision.snapshot.items():
            if key in restorable_fields:
                setattr(crop, key, value)
        crop.deleted_at = None
        crop._history_action = EntityRevision.ACTION_RESTORED
        crop.save()

    return crop


def _latest_revision_per_object(project: Project, entity_type: str, since) -> list[EntityRevision]:
    """Newest revision per object of `entity_type` recorded at/after `since`."""
    revisions = (
        EntityRevision.objects
        .filter(project=project, entity_type=entity_type, created_at__gte=since)
        .order_by('object_id', '-created_at')
    )
    latest: list[EntityRevision] = []
    seen: set[int] = set()
    for revision in revisions:
        if revision.object_id in seen:
            continue
        seen.add(revision.object_id)
        latest.append(revision)
    return latest


def _recreate_rows_deleted_since(
    project: Project,
    model: type,
    entity_type: str,
    deleted_since,
    batch,
    *,
    user_name: str,
    belongs_to_restore: Callable[[dict], bool],
    build_row_data: Callable[[dict], dict],
    select_related: tuple[str, ...] = (),
) -> list[int]:
    """Recreate rows this project's history records as deleted since
    `deleted_since`, and record an `ACTION_RESTORED` revision for each.

    Only the newest revision per object is considered, so a row deleted and
    later recreated by other means is left alone; `belongs_to_restore` narrows
    the candidates to the ones that went away with the entity being restored.
    Returns the ids that were recreated.
    """
    allowed_fields = {field.attname for field in model._meta.concrete_fields}
    recreated = []
    for revision in _latest_revision_per_object(project, entity_type, deleted_since):
        snapshot = revision.snapshot
        if (
            revision.action != EntityRevision.ACTION_DELETED
            or not isinstance(snapshot, dict)
            or not belongs_to_restore(snapshot)
            or model.objects.filter(pk=revision.object_id).exists()
        ):
            continue
        row_data = {key: value for key, value in snapshot.items() if key in allowed_fields}
        recreated.append(model(**build_row_data(row_data)))

    if not recreated:
        return []

    model.objects.bulk_create(recreated)
    recreated_ids = [instance.pk for instance in recreated]
    queryset = model.objects.filter(pk__in=recreated_ids)
    if select_related:
        queryset = queryset.select_related(*select_related)
    for instance in queryset:
        record_entity_revision(
            project=project, entity_type=entity_type, object_id=instance.pk,
            action=EntityRevision.ACTION_RESTORED,
            snapshot=_serialize_instance(instance),
            display_name=_entity_display_name(instance),
            changed_fields=[], user_name=user_name, batch_operation=batch,
        )
    return recreated_ids


def _null_dangling_nullable_fks(model: type, row_data: dict, *, keep: set[str]) -> dict:
    """A FK target (bed/crop/user) may have been hard-deleted since the
    snapshot — null the nullable ones rather than 500 on insert, matching the
    other restore paths. `keep` names FKs the caller has already set itself."""
    for field in model._meta.concrete_fields:
        related_id = row_data.get(field.attname)
        if (
            field.remote_field is None
            or related_id is None
            or field.attname in keep
            or not field.null
        ):
            continue
        target_manager = (
            getattr(field.remote_field.model, 'all_objects', None)
            or field.remote_field.model._base_manager
        )
        if not target_manager.filter(pk=related_id).exists():
            row_data[field.attname] = None
    return row_data


def restore_plans_and_tasks_deleted_with_season(
    project: Project,
    season,
    deleted_since,
    batch,
    *,
    user_name: str,
) -> None:
    """Bring back the planting plans hard-deleted with `season`, and the tasks
    that DB-cascaded away with those plans.

    Planting plans have no soft delete, so undeleting a season has to recreate
    them from the revisions recorded when it was deleted.
    """
    def build_plan_row(row_data: dict) -> dict:
        row_data['project_id'] = season.project_id
        row_data['season_id'] = season.pk
        return _null_dangling_nullable_fks(
            PlantingPlan, row_data, keep={'project_id', 'season_id'},
        )

    plan_ids = _recreate_rows_deleted_since(
        project, PlantingPlan, 'planting_plan', deleted_since, batch,
        user_name=user_name,
        belongs_to_restore=lambda snapshot: snapshot.get('season_id') == season.pk,
        build_row_data=build_plan_row,
        select_related=('crop', 'bed'),
    )
    if not plan_ids:
        return

    def build_task_row(row_data: dict) -> dict:
        row_data['project_id'] = project.id
        return row_data

    _recreate_rows_deleted_since(
        project, Task, 'task', deleted_since, batch,
        user_name=user_name,
        belongs_to_restore=lambda snapshot: snapshot.get('planting_plan_id') in plan_ids,
        build_row_data=build_task_row,
    )


def restore_season_planting_plans(project: Project, season, batch, *, user_name: str) -> None:
    """Replay the plan/task deletions recorded when `season` was last deleted.

    A no-op for a season that was never deleted; otherwise it finds that
    deletion's timestamp and hands it to
    `restore_plans_and_tasks_deleted_with_season`.
    """
    deleted_revision = (
        EntityRevision.objects
        .filter(
            project=project,
            entity_type='season',
            object_id=season.pk,
            action=EntityRevision.ACTION_DELETED,
        )
        .order_by('-created_at')
        .first()
    )
    if deleted_revision is None:
        return
    restore_plans_and_tasks_deleted_with_season(
        project, season, deleted_revision.created_at, batch, user_name=user_name,
    )


class BatchRevertError(Exception):
    """A batch operation can't be reverted (already reverted, unknown entity
    type, or an insert would violate a constraint)."""


_RESTORABLE_MODEL_ENTITY_TYPE: dict[type, str] = {model: label for model, label in _RESTORABLE_ENTITY_TYPES}


def _record_cascade_deletions(project: Project, instances: list, batch, user_name: str) -> None:
    """Record an `ACTION_DELETED` revision for every *restorable* row a DB
    cascade delete of `instances` would also remove (a planting plan's tasks,
    say) — so it lands in the same batch and a later restore can bring it back.
    Does not delete anything; the caller does."""
    if not instances:
        return
    from django.db.models.deletion import Collector

    already = {(type(instance), instance.pk) for instance in instances}
    collector = Collector(using=instances[0]._state.db or 'default')
    collector.collect(list(instances))

    dependents: dict[type, set] = {}
    for model, objs in collector.data.items():
        dependents.setdefault(model, set()).update(objs)
    # Leaf models with nothing further to cascade go in `fast_deletes` as
    # querysets rather than `data` — a plan's tasks land here.
    for queryset in collector.fast_deletes:
        dependents.setdefault(queryset.model, set()).update(queryset)

    for model, objs in dependents.items():
        entity_type = _RESTORABLE_MODEL_ENTITY_TYPE.get(model)
        if entity_type is None:
            continue
        for obj in objs:
            if (model, obj.pk) in already:
                continue
            record_entity_revision(
                project=project, entity_type=entity_type, object_id=obj.pk,
                action=EntityRevision.ACTION_DELETED,
                snapshot=_serialize_instance(obj),
                display_name=_entity_display_name(obj),
                changed_fields=[], user_name=user_name, batch_operation=batch,
            )


def _row_data_from_snapshot(model, snapshot: dict, project: Project) -> dict:
    concrete = {field.attname for field in model._meta.concrete_fields}
    row = {key: value for key, value in snapshot.items() if key in concrete}
    row['project_id'] = project.id
    if 'deleted_at' in concrete:
        row['deleted_at'] = None
    for field in model._meta.concrete_fields:
        related_id = row.get(field.attname)
        if field.remote_field is None or related_id is None:
            continue
        if not _model_manager(field.remote_field.model).filter(pk=related_id).exists():
            row[field.attname] = None
    return row


def revert_batch_operation(project: Project, batch, *, user_name: str = '') -> None:
    """Undo a whole `BatchOperation`: every entity it touched goes back to its
    state just before the batch. `created` entities are deleted, `deleted` ones
    recreated, `updated`/`restored` ones rolled back to the prior revision.

    Idempotent — applying it again when the entities are already at their
    pre-batch state is a no-op — and it composes: reverting a `batch_reverted`
    batch re-applies the original action.
    """
    revisions = list(batch.revisions.all())
    if not revisions:
        raise BatchRevertError('empty batch')

    first_batch_id: dict[tuple[str, int], int] = {}
    for revision in revisions:
        key = (revision.entity_type, revision.object_id)
        first_batch_id[key] = min(first_batch_id.get(key, revision.id), revision.id)

    to_delete: list[tuple[str, int]] = []
    to_write: list[tuple[str, int, dict]] = []
    for revision in revisions:
        if revision.entity_type not in _MODEL_BY_ENTITY_TYPE:
            raise BatchRevertError(revision.entity_type)
        key = (revision.entity_type, revision.object_id)
        if revision.action == EntityRevision.ACTION_CREATED:
            to_delete.append(key)
            continue
        if revision.action == EntityRevision.ACTION_DELETED:
            to_write.append((revision.entity_type, revision.object_id, revision.snapshot))
            continue
        prior = (
            EntityRevision.objects
            .filter(
                project=project, entity_type=revision.entity_type,
                object_id=revision.object_id, id__lt=first_batch_id[key],
            )
            .order_by('-id')
            .first()
        )
        if prior is None or prior.action == EntityRevision.ACTION_DELETED:
            to_delete.append(key)
        else:
            to_write.append((revision.entity_type, revision.object_id, prior.snapshot))

    with transaction.atomic():
        revert_batch = start_batch_operation(
            project=project,
            operation_type='batch_reverted',
            context={'reverted_operation_type': batch.operation_type, **(batch.context or {})},
            user_name=user_name,
        )

        # Children first so a parent's cascade never races us.
        for entity_type, object_id in sorted(
            to_delete, key=lambda pair: -_ENTITY_TYPE_ORDER.get(pair[0], 999),
        ):
            model = _MODEL_BY_ENTITY_TYPE[entity_type]
            instance = _model_manager(model).filter(project=project, pk=object_id).first()
            if instance is None:
                continue
            snapshot = _serialize_instance(instance)
            display_name = _entity_display_name(instance)
            # Rows a DB cascade would take with it (plans added to the season
            # after it was created, their tasks) get their own revision so the
            # revert stays reversible.
            _record_cascade_deletions(project, [instance], revert_batch, user_name)
            _model_manager(model).filter(pk=object_id).delete()
            record_entity_revision(
                project=project, entity_type=entity_type, object_id=object_id,
                action=EntityRevision.ACTION_DELETED, snapshot=snapshot,
                display_name=display_name, changed_fields=[], user_name=user_name,
                batch_operation=revert_batch,
            )

        # Parents first for the recreates/updates.
        for entity_type, object_id, snapshot in sorted(
            to_write, key=lambda item: _ENTITY_TYPE_ORDER.get(item[0], 999),
        ):
            model = _MODEL_BY_ENTITY_TYPE[entity_type]
            manager = _model_manager(model)
            row = _row_data_from_snapshot(model, snapshot, project)
            if manager.filter(project=project, pk=object_id).exists():
                manager.filter(pk=object_id).update(
                    **{key: value for key, value in row.items() if key not in _SKIP_ON_UPDATE},
                )
                action = EntityRevision.ACTION_UPDATED
            else:
                try:
                    with transaction.atomic():
                        model.objects.bulk_create([model(**row)])
                except IntegrityError as exc:
                    raise BatchRevertError(entity_type) from exc
                action = EntityRevision.ACTION_RESTORED
            instance = manager.filter(pk=object_id).select_related().first()
            record_entity_revision(
                project=project, entity_type=entity_type, object_id=object_id,
                action=action, snapshot=_serialize_instance(instance) if instance else snapshot,
                display_name=_entity_display_name(instance) if instance else '',
                changed_fields=[], user_name=user_name, batch_operation=revert_batch,
            )

        batch.reverted_at = timezone.now()
        batch.save(update_fields=['reverted_at'])
