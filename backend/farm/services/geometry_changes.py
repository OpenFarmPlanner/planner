"""Preview/confirm writes of physical growing-area geometry (#1634).

Every write to the measurements or parent of a used area goes through this
one contract, whichever screen starts it:

1. ``preview_geometry_change`` derives the effective date on the server,
   checks the whole affected interval and returns old/new values, affected
   plans, blocking conflicts, warnings and a short-lived signed token.
2. ``confirm_geometry_change`` rechecks everything under the project and row
   locks, rejects a stale preview and writes the version, the present-row
   mirror and one project-history batch in a single transaction. The request
   ID makes a retried confirmation a replay instead of a second write.

``undo_geometry_change`` is the checked inverse behind the history entry's
Undo. Design: docs/growing-area-geometry-history.md.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID

from django.core import signing
from django.db import IntegrityError, transaction
from django.db.models import Model, Q, QuerySet
from django.utils import timezone

from farm.history.records import (
    _entity_display_name,
    _entity_type_for,
    _serialize_instance,
    record_entity_revision,
    revision_batch,
    start_batch_operation,
)
from farm.models import (
    BatchOperation,
    Bed,
    BedLayout,
    EntityRevision,
    Field,
    GrowingAreaGeometryVersion,
    Location,
    PlantingPlan,
    Project,
    Season,
    Task,
)
from farm.planning.individual_planting import _positions_fit
from farm.services.bed_capacity import (
    ZERO_AREA,
    BedOccupancy,
    SuccessionRule,
    _occupancy_start,
    _peak_area,
    build_occupancy,
)
from farm.services.bed_layouts import move_bed_layouts
from farm.services.crop_inheritance import lock_crop_project
from farm.services.growing_area_geometry import (
    AREA_MODELS,
    STATUS_ACTIVE,
    AreaKind,
    GeometryFacts,
    mirror_version,
    resolve_geometry,
    write_present_facts,
)

Version = GrowingAreaGeometryVersion
ACTION_CORRECTION = 'correction'
ACTION_PHYSICAL_CHANGE = 'physical_change'
ACTION_RETIREMENT = 'retirement'
ACTIONS = (ACTION_CORRECTION, ACTION_PHYSICAL_CHANGE, ACTION_RETIREMENT)
TOKEN_SALT = 'farm.geometry_change.preview'
TOKEN_MAX_AGE_SECONDS = 600
MAX_LISTED_PLANS = 20
_MIRROR_FIELDS: dict[AreaKind, tuple[str, ...]] = {
    'location': ('length_m', 'width_m'),
    'field': ('length_m', 'width_m', 'area_sqm', 'location_id'),
    'bed': ('length_m', 'width_m', 'area_sqm', 'field_id'),
}


class GeometryChangeConflict(Exception):
    """A geometry change cannot be previewed or confirmed as requested."""

    def __init__(self, code: str, detail: str, **context: Any) -> None:
        super().__init__(detail)
        self.code = code
        self.detail = detail
        self.context = context


@dataclass(frozen=True)
class GeometryChangeRequest:
    """A normalized change request; the server derives every date itself."""

    kind: AreaKind
    area_id: int
    action: str
    facts: GeometryFacts
    season: Season | None = None
    version_id: int | None = None
    revision: int | None = None


@dataclass
class GeometryPreview:
    """Everything the confirmation needs to recheck, plus what the user sees."""

    request: GeometryChangeRequest
    area: Model
    effective_from: date
    interval_end: date | None
    target: GrowingAreaGeometryVersion
    following: GrowingAreaGeometryVersion | None
    previous: GeometryFacts
    plans: list[PlantingPlan]
    descendant_count: int
    # First date the checks cover; None also covers the dates before a first
    # legacy observation, which keep using it.
    check_from: date | None = None
    # Retirement: each descendant's timeline, retired together with the area.
    descendants: dict[tuple[AreaKind, int], list[Version]] = field(default_factory=dict)
    conflicts: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[dict[str, Any]] = field(default_factory=list)
    fingerprint: str = ''

    @property
    def can_confirm(self) -> bool:
        """Whether nothing blocks the confirmation."""
        return not self.conflicts

    def as_dict(self, token: str | None) -> dict[str, Any]:
        """Serialize the preview for the API."""
        return {
            'kind': self.request.kind,
            'id': self.request.area_id,
            'name': self.area.name,
            'action': self.request.action,
            'effective_from': self.effective_from,
            'interval_end': self.interval_end,
            'target_version': {
                'id': self.target.pk, 'revision': self.target.revision,
                'effective_from': self.target.effective_from, 'origin': self.target.origin,
            },
            'continues_after': _version_summary(self.following),
            'previous': facts_as_dict(self.previous),
            'proposed': facts_as_dict(self.request.facts),
            'affected_plans': {
                'count': len(self.plans),
                'results': [_plan_summary(plan) for plan in self.plans[:MAX_LISTED_PLANS]],
            },
            'descendant_count': self.descendant_count,
            'conflicts': self.conflicts,
            'warnings': self.warnings,
            'can_confirm': self.can_confirm,
            'token': token,
        }


def facts_as_dict(facts: GeometryFacts) -> dict[str, Any]:
    """JSON-safe recorded facts."""
    return {
        'length_m': facts.length_m,
        'width_m': facts.width_m,
        'area_sqm': float(facts.area_sqm) if facts.area_sqm is not None else None,
        'measurement_basis': facts.basis,
        'parent_id': facts.parent_id,
    }


def _facts_from_dict(data: dict[str, Any]) -> GeometryFacts:
    area = data['area_sqm']
    return GeometryFacts(
        data['length_m'], data['width_m'], Decimal(str(area)) if area is not None else None,
        data['measurement_basis'], data['parent_id'],
    )


def _version_summary(version: GrowingAreaGeometryVersion | None) -> dict[str, Any] | None:
    if version is None:
        return None
    return {
        'id': version.pk, 'effective_from': version.effective_from, 'state': version.state,
        'area_sqm': (
            float(version.confirmed_area_sqm) if version.confirmed_area_sqm is not None else None
        ),
    }


def _plan_summary(plan: PlantingPlan) -> dict[str, Any]:
    return {
        'id': plan.pk,
        'label': _entity_display_name(plan),
        'start': plan.planting_date,
        'end': plan.occupied_until,
        'area_usage_sqm': float(plan.area_usage_sqm) if plan.area_usage_sqm is not None else None,
        'individual_count': len(plan.individual_positions or []),
    }


# --- Usage -----------------------------------------------------------------

def _subtree_plan_filter(kind: AreaKind, area_id: int) -> Q:
    if kind == 'bed':
        return Q(bed_id=area_id)
    if kind == 'field':
        return Q(parcel_id=area_id) | Q(bed__field_id=area_id)
    return Q(site_id=area_id) | Q(parcel__location_id=area_id) | Q(bed__field__location_id=area_id)


def area_is_used(project: Project, kind: AreaKind, area_id: int) -> bool:
    """Plans, recorded harvests on them or tasks in the subtree make an area used."""
    if PlantingPlan.objects.filter(
        _subtree_plan_filter(kind, area_id), project=project,
    ).exists():
        return True
    if kind == 'bed':
        return False
    task_filter = Q(field_id=area_id) if kind == 'field' else Q(field__location_id=area_id)
    return Task.objects.filter(task_filter, project=project).exists()


def _plans_in_interval(
    project: Project, kind: AreaKind, area_id: int, start: date | None, end: date | None,
) -> QuerySet[PlantingPlan]:
    plans = PlantingPlan.objects.annotate(
        occupied_until=PlantingPlan.occupancy_end_expression(),
    ).filter(
        _subtree_plan_filter(kind, area_id), project=project, planting_date__isnull=False,
    )
    if start is not None:
        plans = plans.filter(occupied_until__gte=start)
    if end is not None:
        plans = plans.filter(planting_date__lte=end)
    return plans.select_related('crop', 'bed', 'parcel', 'site').order_by('planting_date', 'pk')


def _dateless_positions(project: Project, kind: AreaKind, area_id: int) -> QuerySet:
    """Individual placements without dates still have to fit every interval."""
    return PlantingPlan.objects.filter(
        _own_placements(kind, area_id), project=project, planting_date__isnull=True,
    ).exclude(individual_positions=[])


def _own_placements(kind: AreaKind, area_id: int) -> Q:
    if kind == 'bed':
        return Q(bed_id=area_id, individual_bed=True)
    if kind == 'field':
        return Q(parcel_id=area_id)
    return Q(site_id=area_id)


# --- Timeline position of the change ----------------------------------------

def proposed_base(
    project: Project, kind: AreaKind, area_id: int, version_id: int | None,
    season: Season | None,
) -> GeometryFacts:
    """The facts a request starts from when it only names some measurements."""
    if not AREA_MODELS[kind].objects.filter(project=project, pk=area_id).exists():
        raise GeometryChangeConflict('not_found', 'The area does not exist.')
    versions = Version.objects.filter(project=project, **{f'{kind}_id': area_id})
    version = None
    if version_id is not None:
        version = versions.filter(pk=version_id).first()
    elif season is not None:
        version = versions.filter(effective_from__lte=season.start_date).order_by(
            '-effective_from', '-pk',
        ).first()
    if version is None and version_id is None:
        version = mirror_version(kind, area_id)
    if version is None or version.owner_id != area_id or version.project_id != project.pk:
        raise GeometryChangeConflict(
            'geometry_version_changed', 'The geometry changed since it was loaded.',
        )
    return GeometryFacts.from_version(version)


def _timeline(area_kind_: AreaKind, area_id: int, *, lock: bool) -> list[Version]:
    queryset = Version.objects.filter(**{f'{area_kind_}_id': area_id})
    if lock:
        queryset = queryset.select_for_update()
    return list(queryset.order_by('effective_from', 'pk'))


def _locate(request: GeometryChangeRequest, versions: list[Version]) -> tuple[Version, date]:
    """Return the version the change starts from and the effective date."""
    if request.action == ACTION_CORRECTION:
        target = next((version for version in versions if version.pk == request.version_id), None)
        if target is None:
            raise GeometryChangeConflict(
                'geometry_version_changed', 'The selected geometry version no longer exists.',
            )
        if target.state != Version.STATE_ACTIVE:
            raise GeometryChangeConflict(
                'geometry_version_retired', 'A retirement record cannot be corrected here.',
            )
        return target, target.effective_from
    if request.season is None:
        raise GeometryChangeConflict(
            'geometry_season_required', 'A physical change needs a season.',
        )
    effective_from = request.season.start_date
    in_effect = [version for version in versions if version.effective_from <= effective_from]
    if not in_effect:
        raise GeometryChangeConflict(
            'geometry_not_recorded_at_date',
            'No measurements are recorded for this area at the season start.',
            effective_from=effective_from,
        )
    target = in_effect[-1]
    if target.effective_from == effective_from:
        raise GeometryChangeConflict(
            'geometry_version_exists_on_date',
            'A version already starts on this date; correct it instead.',
            version_id=target.pk, revision=target.revision, effective_from=effective_from,
        )
    if target.state != Version.STATE_ACTIVE:
        raise GeometryChangeConflict(
            'geometry_area_retired', 'The area is retired at the season start.',
            effective_from=effective_from,
        )
    if request.version_id is not None and request.version_id != target.pk:
        raise GeometryChangeConflict(
            'geometry_version_changed', 'The geometry changed since it was loaded.',
        )
    return target, effective_from


def _following(versions: list[Version], effective_from: date) -> Version | None:
    return next((version for version in versions if version.effective_from > effective_from), None)


# --- Checks -----------------------------------------------------------------

def _area_capacity_conflict(
    project: Project, preview: GeometryPreview, facts: GeometryFacts,
) -> None:
    area_plans = [plan for plan in preview.plans if not plan.individual_bed
                  and plan.area_usage_sqm is not None and plan.bed_id == preview.area.pk]
    if not area_plans:
        return
    if facts.area_sqm is None:
        preview.warnings.append({'code': 'geometry_capacity_unknown'})
        return
    rule = SuccessionRule.for_project(project)
    crop_indexes: dict = {}
    occupancies: list[BedOccupancy] = [
        build_occupancy(
            rule=rule, start=_occupancy_start(plan, crop_indexes),
            harvest_start=None if plan.clearing_date else plan.harvest_date,
            end=plan.occupied_until, area_sqm=plan.area_usage_sqm, plan_id=plan.pk,
        )
        for plan in area_plans
    ]
    end = preview.interval_end or max(item.firm_end for item in occupancies)
    start = preview.check_from or min(item.start for item in occupancies)
    peak = _peak_area(occupancies, start, end, BedOccupancy.firmly_covers)
    if peak > facts.area_sqm:
        preview.conflicts.append({
            'code': 'geometry_capacity_exceeded',
            'used_area_sqm': float(peak),
            'area_sqm': float(facts.area_sqm),
        })


def _is_own_placement(plan: PlantingPlan, kind: AreaKind, area_id: int) -> bool:
    if kind == 'bed':
        return plan.individual_bed and plan.bed_id == area_id
    if kind == 'field':
        return plan.parcel_id == area_id
    return plan.site_id == area_id


def _positions_conflict(
    project: Project, preview: GeometryPreview, facts: GeometryFacts,
) -> None:
    kind, area_id = preview.request.kind, preview.area.pk
    dated = [plan for plan in preview.plans
             if plan.individual_positions and _is_own_placement(plan, kind, area_id)]
    dateless = list(_dateless_positions(project, kind, area_id))
    outside = [plan for plan in [*dated, *dateless]
               if not _positions_fit(plan.individual_positions, facts.width_m, facts.length_m)]
    if outside:
        preview.conflicts.append({
            'code': 'geometry_positions_outside',
            'plans': [plan.pk for plan in outside],
        })


def _children_conflict(preview: GeometryPreview, facts: GeometryFacts) -> None:
    kind = preview.request.kind
    if kind == 'bed' or facts.area_sqm is None:
        return
    previous_area = preview.previous.area_sqm
    if previous_area is not None and facts.area_sqm >= previous_area:
        return
    project = preview.area.project
    child_kind: AreaKind = 'bed' if kind == 'field' else 'field'
    model = Bed if kind == 'field' else Field
    parent_lookup = 'field_id' if kind == 'field' else 'location_id'
    child_ids = list(model.objects.filter(
        project=project, **{parent_lookup: preview.area.pk},
    ).values_list('pk', flat=True))
    resolution = resolve_geometry(
        project, preview.effective_from, **{f'{child_kind}s': child_ids}, with_ancestors=False,
    )
    known = [entry for entry in resolution
             if entry.status == STATUS_ACTIVE and entry.area_sqm is not None]
    total = sum((entry.area_sqm for entry in known), ZERO_AREA)
    if total <= facts.area_sqm:
        return
    used_ids = _used_children(project, child_kind, [entry.area_id for entry in known])
    used_total = sum((entry.area_sqm for entry in known if entry.area_id in used_ids), ZERO_AREA)
    finding = {
        'code': 'geometry_children_exceed_area',
        'children_area_sqm': float(total),
        'area_sqm': float(facts.area_sqm),
    }
    # Only children in use make the smaller area impossible; unused ones are a hint.
    (preview.conflicts if used_total > facts.area_sqm else preview.warnings).append(finding)


def _used_children(project: Project, kind: AreaKind, area_ids: list[int]) -> set[int]:
    if not area_ids:
        return set()
    lookup = 'bed_id' if kind == 'bed' else 'parcel_id'
    used = set(PlantingPlan.objects.filter(
        project=project, **{f'{lookup}__in': area_ids},
    ).values_list(lookup, flat=True))
    if kind == 'field':
        used |= set(PlantingPlan.objects.filter(
            project=project, bed__field_id__in=area_ids,
        ).values_list('bed__field_id', flat=True))
    return used


def _parent_conflict(project: Project, preview: GeometryPreview, facts: GeometryFacts) -> None:
    if facts.parent_id == preview.previous.parent_id:
        return
    if preview.request.action == ACTION_PHYSICAL_CHANGE:
        preview.conflicts.append({'code': 'geometry_relocation_unsupported'})
        return
    parent_kind = {'field': Location, 'bed': Field}.get(preview.request.kind)
    if parent_kind is None or not parent_kind.objects.filter(
        project=project, pk=facts.parent_id,
    ).exists():
        preview.conflicts.append({'code': 'geometry_parent_invalid'})


def _retirement_checks(project: Project, preview: GeometryPreview) -> None:
    later = [preview.following] if preview.following else []
    later += [
        version for versions in preview.descendants.values() for version in versions
        if version.effective_from >= preview.effective_from
    ]
    if later:
        preview.conflicts.append({
            'code': 'geometry_retirement_later_versions',
            'effective_from': min(version.effective_from for version in later),
        })
    undated = PlantingPlan.objects.filter(
        _subtree_plan_filter(preview.request.kind, preview.area.pk), project=project,
        planting_date__isnull=True, season__start_date__gte=preview.effective_from,
    ).count()
    if preview.plans or undated:
        preview.conflicts.append({
            'code': 'geometry_retirement_plans', 'count': len(preview.plans) + undated,
        })


def _run_checks(project: Project, preview: GeometryPreview, facts: GeometryFacts) -> None:
    preview.conflicts.clear()
    preview.warnings.clear()
    if preview.request.action == ACTION_RETIREMENT:
        _retirement_checks(project, preview)
        return
    if facts == preview.previous:
        preview.conflicts.append({'code': 'geometry_unchanged'})
        return
    _parent_conflict(project, preview, facts)
    if preview.request.kind == 'bed':
        _area_capacity_conflict(project, preview, facts)
    _children_conflict(preview, facts)
    _positions_conflict(project, preview, facts)
    if preview.following is not None:
        preview.warnings.append({
            'code': 'geometry_later_version_kept',
            'effective_from': preview.following.effective_from,
        })


def _fingerprint(preview: GeometryPreview, versions: list[Version]) -> str:
    state = {
        'versions': [[v.pk, v.revision, v.effective_from.isoformat(), v.state] for v in versions],
        'plans': [
            [plan.pk, plan.updated_at.isoformat()] for plan in preview.plans
        ],
        'descendants': preview.descendant_count,
        'descendant_versions': sorted(
            [kind, area_id, *(v.pk for v in versions), *(v.revision for v in versions)]
            for (kind, area_id), versions in preview.descendants.items()
        ),
    }
    return hashlib.sha256(json.dumps(state, sort_keys=True).encode()).hexdigest()


def _descendant_count(project: Project, kind: AreaKind, area_id: int) -> int:
    if kind == 'field':
        return Bed.objects.filter(project=project, field_id=area_id).count()
    if kind == 'location':
        return (
            Field.objects.filter(project=project, location_id=area_id).count()
            + Bed.objects.filter(project=project, field__location_id=area_id).count()
        )
    return 0


def _load_area(project: Project, kind: AreaKind, area_id: int, *, lock: bool) -> Model:
    queryset = AREA_MODELS[kind].objects.filter(project=project, pk=area_id)
    if lock:
        queryset = queryset.select_for_update(no_key=True)
    area = queryset.first()
    if area is None:
        raise GeometryChangeConflict('not_found', 'The area does not exist.')
    return area


def _descendant_timelines(
    project: Project, kind: AreaKind, area_id: int, *, lock: bool,
) -> dict[tuple[AreaKind, int], list[Version]]:
    if kind == 'bed':
        return {}
    beds = Bed.objects.filter(project=project).filter(
        Q(field_id=area_id) if kind == 'field' else Q(field__location_id=area_id),
    ).values_list('pk', flat=True)
    keys: list[tuple[AreaKind, int]] = [('bed', pk) for pk in beds]
    if kind == 'location':
        parcels = Field.objects.filter(project=project, location_id=area_id)
        keys += [('field', pk) for pk in parcels.values_list('pk', flat=True)]
    timelines: dict[tuple[AreaKind, int], list[Version]] = {key: [] for key in keys}
    versions = Version.objects.filter(project=project).filter(
        Q(bed_id__in=[pk for child_kind, pk in keys if child_kind == 'bed'])
        | Q(field_id__in=[pk for child_kind, pk in keys if child_kind == 'field']),
    ).order_by('effective_from', 'pk')
    if lock:
        versions = versions.select_for_update()
    for version in versions:
        timelines[(version.kind, version.owner_id)].append(version)
    return timelines


def _build_preview(
    project: Project, request: GeometryChangeRequest, *, lock: bool,
) -> GeometryPreview:
    area = _load_area(project, request.kind, request.area_id, lock=lock)
    versions = _timeline(request.kind, area.pk, lock=lock)
    target, effective_from = _locate(request, versions)
    if (
        request.action == ACTION_CORRECTION and request.revision is not None
        and request.revision != target.revision
    ):
        raise GeometryChangeConflict(
            'geometry_version_changed', 'The geometry changed since it was loaded.',
        )
    following = _following(versions, effective_from)
    interval_end = following.effective_from - timedelta(days=1) if following else None
    # Dates before a first legacy observation keep using it (as capacity does),
    # so correcting that observation also checks the earlier plans.
    compat_start = (
        None if target is versions[0] and target.origin == Version.ORIGIN_LEGACY_OBSERVATION
        and request.action == ACTION_CORRECTION else effective_from
    )
    retiring = request.action == ACTION_RETIREMENT
    plans = list(_plans_in_interval(
        project, request.kind, area.pk, compat_start, None if retiring else interval_end,
    ))
    preview = GeometryPreview(
        request=request, area=area, effective_from=effective_from, interval_end=interval_end,
        target=target, following=following, previous=GeometryFacts.from_version(target),
        plans=plans, descendant_count=_descendant_count(project, request.kind, area.pk),
        check_from=compat_start,
        descendants=(
            _descendant_timelines(project, request.kind, area.pk, lock=lock) if retiring else {}
        ),
    )
    _run_checks(project, preview, request.facts)
    preview.fingerprint = _fingerprint(preview, versions)
    return preview


def preview_geometry_change(
    project: Project, request: GeometryChangeRequest, *, user_id: int,
) -> dict[str, Any]:
    """Dry run: what the change would do, and a token to confirm exactly that."""
    preview = _build_preview(project, request, lock=False)
    token = _token(project, request, preview, user_id) if preview.can_confirm else None
    return preview.as_dict(token)


def _token_payload(
    project: Project, request: GeometryChangeRequest, preview: GeometryPreview, user_id: int,
) -> dict[str, Any]:
    return {
        'project': project.pk, 'user': user_id, 'kind': request.kind, 'id': request.area_id,
        'action': request.action, 'season': request.season.pk if request.season else None,
        'version': preview.target.pk, 'revision': preview.target.revision,
        'effective_from': preview.effective_from.isoformat(),
        'facts': json.loads(json.dumps(facts_as_dict(request.facts))),
        'fingerprint': preview.fingerprint,
    }


def _token(
    project: Project, request: GeometryChangeRequest, preview: GeometryPreview, user_id: int,
) -> str:
    return signing.dumps(
        _token_payload(project, request, preview, user_id), salt=TOKEN_SALT, compress=True,
    )


# --- Confirmation -------------------------------------------------------------

def _read_token(token: str, project: Project, user_id: int) -> dict[str, Any]:
    try:
        payload = signing.loads(token, salt=TOKEN_SALT, max_age=TOKEN_MAX_AGE_SECONDS)
    except signing.BadSignature as exc:
        raise GeometryChangeConflict(
            'geometry_preview_stale', 'The preview expired; check the change again.',
        ) from exc
    if payload.get('project') != project.pk or payload.get('user') != user_id:
        raise GeometryChangeConflict(
            'geometry_preview_stale', 'The preview belongs to another project or user.',
        )
    return payload


def _request_from_token(project: Project, payload: dict[str, Any]) -> GeometryChangeRequest:
    season = None
    if payload['season'] is not None:
        season = Season.objects.filter(project=project, pk=payload['season']).first()
        if season is None:
            raise GeometryChangeConflict(
                'geometry_preview_stale', 'The season changed since the preview.',
            )
    return GeometryChangeRequest(
        kind=payload['kind'], area_id=payload['id'], action=payload['action'],
        facts=_facts_from_dict(payload['facts']), season=season,
        version_id=payload['version'], revision=payload['revision'],
    )


def _request_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _replayed(existing: BatchOperation, project: Project, user_id: int, token: str) -> dict:
    if (
        existing.project_id != project.pk or existing.initiated_by_id != user_id
        or existing.operation_type != BatchOperation.TYPE_GEOMETRY_CHANGE
        or not existing.completed_at
        or existing.context.get('_request_hash') != _request_hash(token)
    ):
        raise GeometryChangeConflict(
            'geometry_request_changed', 'This request ID belongs to another change.',
        )
    return _public_context(existing.context)


def _public_context(context: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in context.items() if not key.startswith('_')}


def _retire(preview: GeometryPreview) -> list[Version]:
    """Retire the area and its descendants that are active at the date.

    Each retirement record keeps the facts and parent of the interval it ends.
    """
    request = preview.request
    owners: list[tuple[AreaKind, int, Version | None]] = [
        (request.kind, preview.area.pk, preview.target),
    ]
    for (kind, area_id), versions in preview.descendants.items():
        in_effect = [item for item in versions if item.effective_from <= preview.effective_from]
        current = in_effect[-1] if in_effect else None
        if current is None or current.state == Version.STATE_ACTIVE:
            owners.append((kind, area_id, current))
    created = []
    for kind, area_id, current in owners:
        version = Version(
            project_id=preview.area.project_id, effective_from=preview.effective_from,
            origin=Version.ORIGIN_RETIREMENT, state=Version.STATE_RETIRED,
            original_season=request.season, **{f'{kind}_id': area_id},
        )
        if current is not None:
            GeometryFacts.from_version(current).apply_to(version, kind)
        else:
            row = AREA_MODELS[kind].objects.get(pk=area_id)
            GeometryFacts.from_area(row).apply_to(version, kind)
        version.save()
        created.append(version)
    return created


def _apply(preview: GeometryPreview, facts: GeometryFacts) -> Version:
    request = preview.request
    if request.action == ACTION_RETIREMENT:
        return _retire(preview)[0]
    if request.action == ACTION_PHYSICAL_CHANGE:
        version = Version(
            project_id=preview.area.project_id, effective_from=preview.effective_from,
            origin=Version.ORIGIN_PHYSICAL_CHANGE, original_season=request.season,
            **{f'{request.kind}_id': preview.area.pk},
        )
        facts.apply_to(version, request.kind)
        version.save()
        return version
    version = preview.target
    facts.apply_to(version, request.kind)
    version.revision += 1
    version.save()
    return version


def _sync_mirror_after(area: Model, kind: AreaKind, *, actor_label: str) -> list[str]:
    mirrored = mirror_version(kind, area.pk)
    if mirrored is None:
        return []
    changed = write_present_facts(area, GeometryFacts.from_version(mirrored))
    _follow_parent_change(area, kind, changed, actor_label=actor_label)
    return changed


def _follow_parent_change(
    area: Model, kind: AreaKind, changed: list[str], *, actor_label: str,
) -> None:
    """Keep schematic bed layouts with their location, as a direct move does."""
    if kind == 'bed' and 'field_id' in changed:
        parcel = Field.objects.get(pk=area.field_id)
        layouts = BedLayout.objects.filter(project_id=area.project_id, bed=area)
        move_bed_layouts(layouts, parcel.location_id, user_name=actor_label)
    elif kind == 'field' and 'location_id' in changed:
        layouts = BedLayout.objects.filter(project_id=area.project_id, bed__field=area)
        move_bed_layouts(layouts, area.location_id, user_name=actor_label)


def _record(
    project: Project, area: Model, changed: list[str], *, actor_label: str,
    batch: BatchOperation,
) -> None:
    record_entity_revision(
        project=project, entity_type=_entity_type_for(area), object_id=area.pk,
        action=EntityRevision.ACTION_UPDATED, snapshot=_serialize_instance(area),
        display_name=_entity_display_name(area), changed_fields=changed or ['geometry'],
        user_name=actor_label, batch_operation=batch,
    )


def confirm_geometry_change(
    project: Project, token: str, request_id: UUID, *, user_id: int, actor_label: str,
) -> dict[str, Any]:
    """Recheck and apply a previewed change atomically, or replay its receipt."""
    payload = _read_token(token, project, user_id)
    previous = BatchOperation.objects.filter(request_id=request_id).first()
    if previous is not None:
        return _replayed(previous, project, user_id, token)
    request = _request_from_token(project, payload)
    with transaction.atomic():
        lock_crop_project(project.pk)
        preview = _build_preview(project, request, lock=True)
        if _token_payload(project, request, preview, user_id) != payload:
            raise GeometryChangeConflict(
                'geometry_preview_stale', 'The area or its plans changed; check the change again.',
            )
        if not preview.can_confirm:
            raise GeometryChangeConflict(
                'geometry_change_blocked', 'The change conflicts with existing plans.',
                conflicts=preview.conflicts,
            )
        try:
            with transaction.atomic():
                batch = start_batch_operation(
                    project=project, operation_type=BatchOperation.TYPE_GEOMETRY_CHANGE,
                    request_id=request_id, initiated_by_id=user_id, user_name=actor_label,
                )
        except IntegrityError as exc:
            raise GeometryChangeConflict(
                'geometry_request_changed', 'This request ID belongs to another change.',
            ) from exc
        if request.action == ACTION_RETIREMENT:
            created = _retire(preview)
            version = created[0]
        else:
            version = _apply(preview, request.facts)
            created = [version]
        with revision_batch(batch):
            changed = _sync_mirror_after(preview.area, request.kind, actor_label=actor_label)
            _record(project, preview.area, changed, actor_label=actor_label, batch=batch)
        batch.context = {
            'kind': request.kind, 'id': preview.area.pk, 'name': preview.area.name,
            'action': request.action, 'version_id': version.pk,
            'effective_from': preview.effective_from.isoformat(),
            'season_label': request.season.label if request.season else '',
            'previous': facts_as_dict(preview.previous),
            'proposed': facts_as_dict(request.facts),
            'revision_after': version.revision,
            'version_ids': [item.pk for item in created],
            '_request_hash': _request_hash(token),
        }
        batch.completed_at = timezone.now()
        batch.save(update_fields=['context', 'completed_at'])
    return _public_context(batch.context)


# --- Checked inverse ----------------------------------------------------------

def undo_geometry_change(project: Project, batch: BatchOperation, *, actor_label: str) -> None:
    """Undo one confirmed change when nothing since then relies on it.

    The inverse goes through the same checks as a forward change: a later
    version, a further correction or plans that no longer fit the previous
    measurements block it instead of being changed silently.
    """
    if batch.reverted_at is not None:
        raise GeometryChangeConflict('geometry_undo_done', 'This change was already undone.')
    context = batch.context
    kind: AreaKind = context['kind']
    if context['action'] == ACTION_RETIREMENT:
        _undo_retirement(project, batch, actor_label=actor_label)
        return
    with transaction.atomic():
        lock_crop_project(project.pk)
        area = _load_area(project, kind, context['id'], lock=True)
        versions = _timeline(kind, area.pk, lock=True)
        version = next((item for item in versions if item.pk == context['version_id']), None)
        if version is None or version.revision != context['revision_after']:
            raise GeometryChangeConflict(
                'geometry_undo_changed', 'The geometry changed after this action.',
            )
        if any(item.created_at > batch.created_at and item.pk != version.pk for item in versions):
            raise GeometryChangeConflict(
                'geometry_undo_changed', 'A later geometry change relies on this one.',
            )
        previous = _facts_from_dict(context['previous'])
        inverse = GeometryChangeRequest(
            kind=kind, area_id=area.pk, action=ACTION_CORRECTION, facts=previous,
            version_id=version.pk, revision=version.revision,
        )
        preview = _build_preview(project, inverse, lock=True)
        if not preview.can_confirm:
            raise GeometryChangeConflict(
                'geometry_undo_blocked', 'Current plans no longer fit the previous measurements.',
                conflicts=preview.conflicts,
            )
        revert = start_batch_operation(
            project=project, operation_type=BatchOperation.TYPE_REVERTED,
            context={'reverted_operation_type': batch.operation_type,
                     **_public_context(context)},
            user_name=actor_label,
        )
        if context['action'] == ACTION_PHYSICAL_CHANGE:
            version.delete()
        else:
            _apply(preview, previous)
        with revision_batch(revert):
            changed = _sync_mirror_after(area, kind, actor_label=actor_label)
            _record(project, area, changed, actor_label=actor_label, batch=revert)
        batch.reverted_at = timezone.now()
        batch.save(update_fields=['reverted_at'])
        revert.completed_at = timezone.now()
        revert.save(update_fields=['completed_at'])


def _undo_retirement(project: Project, batch: BatchOperation, *, actor_label: str) -> None:
    """Make retired areas available again while no later record relies on it."""
    context = batch.context
    with transaction.atomic():
        lock_crop_project(project.pk)
        area = _load_area(project, context['kind'], context['id'], lock=True)
        retired = list(Version.objects.select_for_update().filter(
            project=project, pk__in=context['version_ids'],
        ))
        if len(retired) != len(context['version_ids']) or any(
            version.revision != 1 for version in retired
        ):
            raise GeometryChangeConflict(
                'geometry_undo_changed', 'The retirement changed after this action.',
            )
        later = Version.objects.filter(project=project, created_at__gt=batch.created_at).filter(
            Q(location_id__in=[v.location_id for v in retired if v.location_id])
            | Q(field_id__in=[v.field_id for v in retired if v.field_id])
            | Q(bed_id__in=[v.bed_id for v in retired if v.bed_id]),
        ).exclude(pk__in=context['version_ids'])
        if later.exists():
            raise GeometryChangeConflict(
                'geometry_undo_changed', 'A later geometry change relies on this retirement.',
            )
        revert = start_batch_operation(
            project=project, operation_type=BatchOperation.TYPE_REVERTED,
            context={'reverted_operation_type': batch.operation_type,
                     **_public_context(context)},
            user_name=actor_label,
        )
        Version.objects.filter(pk__in=context['version_ids']).delete()
        with revision_batch(revert):
            changed = _sync_mirror_after(area, context['kind'], actor_label=actor_label)
            _record(project, area, changed, actor_label=actor_label, batch=revert)
        batch.reverted_at = timezone.now()
        batch.save(update_fields=['reverted_at'])
        revert.completed_at = timezone.now()
        revert.save(update_fields=['completed_at'])
