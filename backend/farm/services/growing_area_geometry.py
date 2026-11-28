"""Dated growing-area geometry: facts, bulk resolution and timeline upkeep (#1634).

One server-side resolver answers "what is known about these areas on this
business date" for locations, parcels and beds. Saves of the present rows keep
the timeline in step (see ``sync_saved_area``) until physical changes go
through their own preview/confirm workflow. Design:
docs/growing-area-geometry-history.md.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

from django.db.models import Model

from farm.models import (
    Bed,
    Field,
    GrowingAreaGeometryVersion,
    Location,
    Project,
    Season,
)

AreaKind = Literal['location', 'field', 'bed']
AREA_KINDS: tuple[AreaKind, ...] = ('location', 'field', 'bed')
AREA_MODELS: dict[AreaKind, type[Model]] = {'location': Location, 'field': Field, 'bed': Bed}
_PARENT_KIND: dict[AreaKind, AreaKind | None] = {
    'location': None, 'field': 'location', 'bed': 'field',
}
_PARENT_ATTNAME: dict[AreaKind, str | None] = {
    'location': None, 'field': 'location_id', 'bed': 'field_id',
}
_VERSION_PARENT_ATTNAME: dict[AreaKind, str | None] = {
    'location': None, 'field': 'parent_location_id', 'bed': 'parent_field_id',
}
# Locations derive their area at two decimals; parcels and beds store one.
_AREA_QUANTUM: dict[AreaKind, Decimal] = {
    'location': Decimal('0.01'), 'field': Decimal('0.1'), 'bed': Decimal('0.1'),
}

STATUS_ACTIVE = 'active'
STATUS_RETIRED = 'retired'
STATUS_NOT_YET_AVAILABLE = 'not_yet_available'
STATUS_UNKNOWN = 'unknown'
# Unknown history is no proof of unavailability: legacy areas stay assignable,
# only their capacity is unknown.
_ASSIGNABLE_STATUSES = frozenset({STATUS_ACTIVE, STATUS_UNKNOWN})

Version = GrowingAreaGeometryVersion


def area_kind(instance: Model) -> AreaKind:
    """Return the geometry kind of a Location, Field or Bed instance."""
    for kind, model in AREA_MODELS.items():
        if isinstance(instance, model):
            return kind
    raise TypeError(f'{type(instance).__name__} has no growing-area geometry')


@dataclass(frozen=True)
class GeometryFacts:
    """Recorded physical facts of one version; unknown values stay ``None``."""

    length_m: float | None
    width_m: float | None
    area_sqm: Decimal | None
    basis: str
    parent_id: int | None

    @classmethod
    def from_measurements(
        cls,
        kind: AreaKind,
        length_m: Any,
        width_m: Any,
        stored_area: Any,
        parent_id: int | None,
    ) -> GeometryFacts:
        """Normalize present measurements without guessing contradictory evidence.

        Both positive sides derive the area with the present rounding. A
        declared area counts only without both sides. A stored area that
        contradicts its own sides is recorded as unknown instead of picking one.
        """
        length = _positive_float(length_m)
        width = _positive_float(width_m)
        declared = _positive_decimal(stored_area)
        if length is not None and width is not None:
            derived = derive_area(kind, length, width)
            if declared is not None and declared.quantize(_AREA_QUANTUM[kind]) != derived:
                return cls(None, None, None, Version.BASIS_UNKNOWN, parent_id)
            return cls(length, width, derived, Version.BASIS_DIMENSIONS, parent_id)
        if declared is not None:
            return cls(length, width, declared, Version.BASIS_DECLARED_AREA, parent_id)
        return cls(length, width, None, Version.BASIS_UNKNOWN, parent_id)

    @classmethod
    def from_area(cls, instance: Model) -> GeometryFacts:
        """Read the facts of a saved Location, Field or Bed row."""
        kind = area_kind(instance)
        stored_area = None if kind == 'location' else instance.area_sqm
        parent_attname = _PARENT_ATTNAME[kind]
        parent_id = getattr(instance, parent_attname) if parent_attname else None
        return cls.from_measurements(
            kind, instance.length_m, instance.width_m, stored_area, parent_id,
        )

    @classmethod
    def from_version(cls, version: GrowingAreaGeometryVersion) -> GeometryFacts:
        """Read the facts recorded on a version."""
        return cls(
            version.length_m, version.width_m, version.confirmed_area_sqm,
            version.measurement_basis, version.parent_id,
        )

    def apply_to(self, version: GrowingAreaGeometryVersion, kind: AreaKind) -> None:
        """Write these facts onto an unsaved or locked version."""
        version.length_m = self.length_m
        version.width_m = self.width_m
        version.confirmed_area_sqm = self.area_sqm
        version.measurement_basis = self.basis
        parent_attname = _VERSION_PARENT_ATTNAME[kind]
        if parent_attname:
            setattr(version, parent_attname, self.parent_id)


def merge_facts(kind: AreaKind, base: GeometryFacts, values: dict[str, Any]) -> GeometryFacts:
    """Facts after changing only the submitted measurements or parent.

    Two sides decide the area, so a client's rounded area never contradicts
    them; clearing a side keeps the recorded area as a declared one, as the
    present-row save always has.
    """
    length = values['length_m'] if 'length_m' in values else base.length_m
    width = values['width_m'] if 'width_m' in values else base.width_m
    area = values['area_sqm'] if 'area_sqm' in values else base.area_sqm
    if kind == 'location' or (length and width):
        area = None
    parent = values['parent_id'] if 'parent_id' in values else base.parent_id
    return GeometryFacts.from_measurements(kind, length, width, area, parent)


def derive_area(kind: AreaKind, length_m: float, width_m: float) -> Decimal:
    """Area from two sides with the same rounding as the present model saves."""
    return Decimal(str(length_m * width_m)).quantize(_AREA_QUANTUM[kind])


def _positive_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def _positive_decimal(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return number if number.is_finite() and number > 0 else None


@dataclass(frozen=True)
class ResolvedGeometry:
    """What is known about one area on a business date."""

    kind: AreaKind
    area_id: int
    status: str
    version_id: int | None
    effective_from: date | None
    next_effective_from: date | None
    parent_id: int | None
    length_m: float | None
    width_m: float | None
    area_sqm: Decimal | None
    measurement_basis: str
    origin: str | None
    revision: int | None
    assignable: bool

    @property
    def capacity_known(self) -> bool:
        """Whether a positive area is known for capacity checks on this date."""
        return self.status == STATUS_ACTIVE and self.area_sqm is not None

    def as_dict(self) -> dict[str, Any]:
        """Serialize for the dated geometry API."""
        return {
            'kind': self.kind,
            'id': self.area_id,
            'status': self.status,
            'assignable': self.assignable,
            'version_id': self.version_id,
            'effective_from': self.effective_from,
            'next_effective_from': self.next_effective_from,
            'parent_id': self.parent_id,
            'length_m': self.length_m,
            'width_m': self.width_m,
            'area_sqm': float(self.area_sqm) if self.area_sqm is not None else None,
            'measurement_basis': self.measurement_basis,
            'origin': self.origin,
            'revision': self.revision,
        }


class GeometryResolution:
    """Resolved geometry of several areas on one date, keyed by ``(kind, id)``."""

    def __init__(self, as_of: date, entries: dict[tuple[AreaKind, int], ResolvedGeometry]) -> None:
        self.as_of = as_of
        self._entries = entries

    def get(self, kind: AreaKind, area_id: int) -> ResolvedGeometry | None:
        """Return the resolved entry, or None when it was not requested."""
        return self._entries.get((kind, area_id))

    def __iter__(self) -> Iterator[ResolvedGeometry]:
        return iter(self._entries.values())


def _status_before_first(first: GrowingAreaGeometryVersion) -> str:
    if first.origin == Version.ORIGIN_NEW_AREA:
        return STATUS_NOT_YET_AVAILABLE
    return STATUS_UNKNOWN


def _resolve_one(
    kind: AreaKind,
    area_id: int,
    versions: list[GrowingAreaGeometryVersion],
    as_of: date,
    current_parent_id: int | None,
) -> ResolvedGeometry:
    current = None
    upcoming = None
    for version in versions:  # ordered by effective_from
        if version.effective_from <= as_of:
            current = version
        else:
            upcoming = version
            break
    next_from = upcoming.effective_from if upcoming else None
    if current is None:
        status = _status_before_first(versions[0]) if versions else STATUS_UNKNOWN
        return ResolvedGeometry(
            kind, area_id, status, None, None, next_from, current_parent_id,
            None, None, None, Version.BASIS_UNKNOWN, None, None, False,
        )
    status = STATUS_ACTIVE if current.state == Version.STATE_ACTIVE else STATUS_RETIRED
    return ResolvedGeometry(
        kind, area_id, status, current.pk, current.effective_from, next_from,
        current.parent_id if kind != 'location' else None,
        current.length_m, current.width_m, current.confirmed_area_sqm,
        current.measurement_basis, current.origin, current.revision, False,
    )


def _versions_by_owner(
    project: Project, kind: AreaKind, area_ids: Iterable[int],
) -> dict[int, list[GrowingAreaGeometryVersion]]:
    ids = set(area_ids)
    grouped: dict[int, list[GrowingAreaGeometryVersion]] = {area_id: [] for area_id in ids}
    if not ids:
        return grouped
    queryset = Version.objects.filter(project=project, **{f'{kind}_id__in': ids}).order_by(
        'effective_from', 'pk',
    )
    for version in queryset:
        grouped[version.owner_id].append(version)
    return grouped


def _current_parents(
    project: Project, kind: AreaKind, area_ids: Iterable[int],
) -> dict[int, int | None]:
    ids = set(area_ids)
    if not ids:
        return {}
    parent_attname = _PARENT_ATTNAME[kind]
    model = AREA_MODELS[kind]
    if parent_attname is None:
        return dict.fromkeys(
            model.objects.filter(project=project, pk__in=ids).values_list('pk', flat=True),
        )
    return dict(
        model.objects.filter(project=project, pk__in=ids).values_list('pk', parent_attname),
    )


def resolve_geometry(
    project: Project,
    as_of: date,
    *,
    locations: Iterable[int] = (),
    fields: Iterable[int] = (),
    beds: Iterable[int] = (),
    loaded: Iterable[Model] = (),
    with_ancestors: bool = True,
) -> GeometryResolution:
    """Resolve the requested areas and their ancestors on ``as_of`` in bulk.

    Foreign-project IDs are ignored. Each kind costs two queries regardless of
    the number of areas: present parents and the sparse version timeline.
    ``loaded`` rows of the project skip the first query. A child is assignable
    only when its own and every ancestor's status is active or unknown;
    without ``with_ancestors`` only the requested kinds are read and
    ``assignable`` reflects the area's own status.
    """
    requested: dict[AreaKind, set[int]] = {
        'location': set(locations), 'field': set(fields), 'bed': set(beds),
    }
    known: dict[AreaKind, dict[int, int | None]] = {kind: {} for kind in AREA_KINDS}
    for row in loaded:
        kind = area_kind(row)
        if row.project_id == project.pk:
            parent_attname = _PARENT_ATTNAME[kind]
            known[kind][row.pk] = getattr(row, parent_attname) if parent_attname else None
            requested[kind].add(row.pk)
    entries: dict[tuple[AreaKind, int], ResolvedGeometry] = {}
    pending: dict[AreaKind, set[int]] = {kind: set(ids) for kind, ids in requested.items()}
    for kind in reversed(AREA_KINDS):  # beds, then their parcels, then locations
        if not with_ancestors and not requested[kind]:
            continue
        missing = pending[kind] - known[kind].keys()
        parents = {
            **{key: value for key, value in known[kind].items() if key in pending[kind]},
            **_current_parents(project, kind, missing),
        }
        versions = _versions_by_owner(project, kind, parents)
        for area_id, current_parent in parents.items():
            entry = _resolve_one(kind, area_id, versions[area_id], as_of, current_parent)
            entries[(kind, area_id)] = entry
            parent_kind = _PARENT_KIND[kind]
            if parent_kind and entry.parent_id is not None:
                pending[parent_kind].add(entry.parent_id)
    resolved: dict[tuple[AreaKind, int], ResolvedGeometry] = {}
    for kind in AREA_KINDS:  # parents first, so a child reads its parent's result
        for (entry_kind, area_id), entry in entries.items():
            if entry_kind != kind:
                continue
            parent_kind = _PARENT_KIND[kind]
            parent = resolved.get((parent_kind, entry.parent_id)) if parent_kind else None
            parent_ok = parent_kind is None or not with_ancestors or (
                parent is not None and parent.assignable
            )
            assignable = entry.status in _ASSIGNABLE_STATUSES and parent_ok
            resolved[(kind, area_id)] = _replace_assignable(entry, assignable)
    return GeometryResolution(
        as_of,
        {key: value for key, value in resolved.items() if key[1] in requested[key[0]]},
    )


def _replace_assignable(entry: ResolvedGeometry, assignable: bool) -> ResolvedGeometry:
    if entry.assignable == assignable:
        return entry
    values = {name: getattr(entry, name) for name in entry.__dataclass_fields__}
    values['assignable'] = assignable
    return ResolvedGeometry(**values)


_SETUP_ORIGINS = frozenset({Version.ORIGIN_LEGACY_OBSERVATION, Version.ORIGIN_NEW_AREA})


def removable_with_area(model: type[Model], objects: Iterable[Model], project_id: int) -> bool:
    """Whether a cascade may take these geometry rows along with their area.

    Only an area's own setup records go with it. A recorded physical change
    or retirement is relied-on history and keeps blocking the removal.
    """
    if model is not Version:
        return False
    return all(
        version.project_id == project_id and version.origin in _SETUP_ORIGINS
        for version in objects
    )


@dataclass(frozen=True)
class AreaSlice:
    """One stretch of dates with a constant recorded area; open ends are None."""

    start: date | None
    end: date | None
    area_sqm: Decimal | None


class AreaTimeline:
    """An area's recorded size over time, for date-sliced capacity checks."""

    def __init__(self, slices: list[AreaSlice]) -> None:
        self.slices = slices

    @classmethod
    def constant(cls, area_sqm: Decimal | None) -> AreaTimeline:
        """A timeline without versions keeps the present area everywhere."""
        return cls([AreaSlice(None, None, area_sqm)])

    def at(self, day: date) -> Decimal | None:
        """The recorded area on ``day``, or None when it is unknown or unavailable."""
        for item in self.slices:
            if (item.start is None or item.start <= day) and (item.end is None or day <= item.end):
                return item.area_sqm
        return None

    def between(self, start: date, end: date) -> list[AreaSlice]:
        """The slices overlapping ``[start, end]``, clipped to it."""
        return [
            AreaSlice(max(item.start or start, start), min(item.end or end, end), item.area_sqm)
            for item in self.slices
            if (item.start is None or item.start <= end) and (item.end is None or start <= item.end)
        ]


def _timeline_slices(versions: list[GrowingAreaGeometryVersion]) -> list[AreaSlice]:
    first = versions[0]
    # Before an area's first observation its recorded size is unknown. Capacity
    # keeps using that observation there, as every check did before the
    # timeline existed; the dated reads still report those dates as unknown.
    before = first.confirmed_area_sqm if first.origin == Version.ORIGIN_LEGACY_OBSERVATION else None
    slices = [AreaSlice(None, first.effective_from - timedelta(days=1), before)]
    for index, version in enumerate(versions):
        following = versions[index + 1] if index + 1 < len(versions) else None
        area = version.confirmed_area_sqm if version.state == Version.STATE_ACTIVE else None
        end = following.effective_from - timedelta(days=1) if following else None
        slices.append(AreaSlice(version.effective_from, end, area))
    return slices


def bed_area_timelines(beds: Iterable[Bed]) -> dict[int, AreaTimeline]:
    """Recorded bed sizes over time, in one query for all beds."""
    beds = list(beds)
    grouped: dict[int, list[GrowingAreaGeometryVersion]] = {bed.pk: [] for bed in beds}
    if beds:
        for version in Version.objects.filter(bed_id__in=grouped).order_by('effective_from', 'pk'):
            grouped[version.bed_id].append(version)
    return {
        bed.pk: AreaTimeline(_timeline_slices(grouped[bed.pk])) if grouped[bed.pk]
        else AreaTimeline.constant(bed.area_sqm)
        for bed in beds
    }


def geometry_view_date(season: Season | None, today: date | None = None) -> date:
    """The date List, Graphic and Map resolve for a season view.

    A past or future season resolves at its start; the current season at the
    business date (today), so an observation within it is shown accurately.
    """
    today = today or date.today()
    if season is None:
        return today
    if season.start_date <= today <= season.end_date:
        return today
    return season.start_date


def area_timeline(
    project: Project, kind: AreaKind, area_id: int, *, limit: int,
) -> list[GrowingAreaGeometryVersion]:
    """Return one area's versions in chronological order, bounded by ``limit``."""
    return list(
        Version.objects.filter(project=project, **{f'{kind}_id': area_id})
        .select_related('original_season')
        .order_by('effective_from', 'pk')[:limit]
    )


# --- Keeping the timeline in step with saves of the present rows -----------

_creation_season: ContextVar[Season | None] = ContextVar('geometry_creation_season', default=None)


def project_season(project: Project, season_id: int | None) -> Season | None:
    """Return the project's active (not deleted) season with this ID, if any."""
    if season_id is None:
        return None
    return Season.objects.filter(project=project, pk=season_id).first()


@contextmanager
def geometry_creation_season(season: Season | None) -> Iterator[None]:
    """Date areas created inside this block from the season the user selected."""
    token = _creation_season.set(season)
    try:
        yield
    finally:
        _creation_season.reset(token)


def _initial_version(instance: Model, kind: AreaKind, facts: GeometryFacts) -> Version:
    season = _creation_season.get()
    if season is not None and season.project_id == instance.project_id:
        effective_from, origin = season.start_date, Version.ORIGIN_NEW_AREA
    else:
        # Without a chosen season nothing proves when the area began, so
        # earlier dates stay unknown rather than not yet available.
        season = None
        effective_from, origin = date.today(), Version.ORIGIN_LEGACY_OBSERVATION
    version = Version(
        project_id=instance.project_id, effective_from=effective_from, origin=origin,
        original_season=season, **{f'{kind}_id': instance.pk},
    )
    facts.apply_to(version, kind)
    return version


_deferred_initial: ContextVar[list[Version] | None] = ContextVar(
    'geometry_deferred_initial_versions', default=None,
)


@contextmanager
def batched_initial_versions() -> Iterator[None]:
    """Insert the first versions of areas created in this block with one query."""
    pending: list[Version] = []
    token = _deferred_initial.set(pending)
    try:
        yield
    finally:
        _deferred_initial.reset(token)
    Version.objects.bulk_create(pending)


def mirror_version(
    kind: AreaKind, area_id: int, *, today: date | None = None, lock: bool = False,
) -> GrowingAreaGeometryVersion | None:
    """The version the present row mirrors: in effect today, else the first one."""
    today = today or date.today()
    queryset = Version.objects.filter(**{f'{kind}_id': area_id})
    if lock:
        queryset = queryset.select_for_update()
    current = queryset.filter(effective_from__lte=today).order_by('-effective_from', '-pk').first()
    return current or queryset.order_by('effective_from', 'pk').first()


def sync_saved_area(instance: Model, *, created: bool) -> None:
    """Keep the dated timeline consistent with a saved Location, Field or Bed.

    Creation records the first version. A later save that changes the recorded
    measurements or parent corrects the version the present row mirrors; names,
    notes, conditions and layout writes leave the timeline untouched.
    """
    kind = area_kind(instance)
    facts = GeometryFacts.from_area(instance)
    if created:
        initial = _initial_version(instance, kind, facts)
        pending = _deferred_initial.get()
        if pending is None:
            initial.save()
        else:
            pending.append(initial)
        return
    version = mirror_version(kind, instance.pk, lock=True)
    if version is None:
        _initial_version(instance, kind, facts).save()
        return
    if GeometryFacts.from_version(version) == facts:
        return
    correct_version(version, facts)


def correct_version(version: GrowingAreaGeometryVersion, facts: GeometryFacts) -> None:
    """Correct the facts of one version in place, keeping its interval."""
    facts.apply_to(version, version.kind)
    version.revision += 1
    version.save()


class GeometryHistoryConflict(Exception):
    """A bulk write would rewrite a recorded physical change or retirement."""


def reconcile_project_geometry(project: Project) -> None:
    """Bring the timeline in step after bulk writes such as a project restore.

    An area without any version gets an observation from today. An area whose
    present facts differ from its mirrored setup record corrects that record.
    A recorded physical change or retirement is never rewritten this way;
    the write is refused instead. Later scheduled versions are never removed.
    """
    today = date.today()
    for kind, model in AREA_MODELS.items():
        rows = list(model.objects.filter(project=project).order_by('pk'))
        versions = _versions_by_owner(project, kind, (row.pk for row in rows))
        created: list[Version] = []
        for row in rows:
            facts = GeometryFacts.from_area(row)
            timeline = versions[row.pk]
            if not timeline:
                created.append(_initial_version(row, kind, facts))
                continue
            in_effect = [version for version in timeline if version.effective_from <= today]
            mirrored = in_effect[-1] if in_effect else timeline[0]
            if GeometryFacts.from_version(mirrored) == facts:
                continue
            if mirrored.origin not in _SETUP_ORIGINS:
                raise GeometryHistoryConflict(f'{kind} {row.pk} has dated geometry history')
            correct_version(mirrored, facts)
        Version.objects.bulk_create(created)


def refresh_present_mirrors(project: Project, *, actor_label: str = '') -> None:
    """Copy a dated change that has come into effect onto its present row.

    Only physical changes and retirements can make the present measurements
    fall behind; without any in effect this costs one query. Each refreshed
    row records an internal revision so project history stays complete.
    """
    from farm.history.records import _serialize_instance, record_entity_revision
    from farm.models import EntityRevision

    today = date.today()
    owners = set(
        Version.objects.filter(project=project, effective_from__lte=today)
        .exclude(origin__in=_SETUP_ORIGINS)
        .values_list('location_id', 'field_id', 'bed_id'),
    )
    for location_id, field_id, bed_id in owners:
        kind: AreaKind = 'bed' if bed_id else 'field' if field_id else 'location'
        area_id = bed_id or field_id or location_id
        row = AREA_MODELS[kind].objects.select_for_update().filter(pk=area_id).first()
        mirrored = mirror_version(kind, area_id, today=today)
        if row is None or mirrored is None:
            continue
        facts = GeometryFacts.from_version(mirrored)
        if GeometryFacts.from_area(row) == facts:
            continue
        write_present_facts(row, facts)
        snapshot = {**_serialize_instance(row), '_project_version_internal': True}
        record_entity_revision(
            project=project, entity_type=kind, object_id=row.pk,
            action=EntityRevision.ACTION_UPDATED, snapshot=snapshot,
            display_name=row.name, changed_fields=['geometry'], user_name=actor_label,
        )


def write_present_facts(area: Model, facts: GeometryFacts) -> list[str]:
    """Copy facts onto the present row without re-entering the save hook."""
    kind = area_kind(area)
    values: dict[str, Any] = {'length_m': facts.length_m, 'width_m': facts.width_m}
    if kind != 'location':
        values['area_sqm'] = (
            facts.area_sqm.quantize(Decimal('0.1')) if facts.area_sqm is not None else None
        )
        values['location_id' if kind == 'field' else 'field_id'] = facts.parent_id
    changed = [name for name, value in values.items() if getattr(area, name) != value]
    if changed:
        for name, value in values.items():
            setattr(area, name, value)
        area._skip_geometry_sync = True
        try:
            area.save(update_fields=[*values, 'updated_at'])
        finally:
            area._skip_geometry_sync = False
    return changed


def scheduled_dimensions(area: Model) -> list[tuple[float | None, float | None]]:
    """Width and length of the area's active versions that start after today."""
    kind = area_kind(area)
    return list(
        Version.objects.filter(
            **{f'{kind}_id': area.pk}, effective_from__gt=date.today(),
            state=Version.STATE_ACTIVE,
        ).values_list('width_m', 'length_m'),
    )
