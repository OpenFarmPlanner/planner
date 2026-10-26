"""Crop rotation check (Fruchtfolge) for planting plans on a bed.

One service answers every rotation question the app asks: the status shown on
each planting plan, the live check in the planting-plan dialog, the ranked bed
suggestions, and the preview/decision when copying plans into a new season.
The rules are documented in docs/crop-rotation.md; in short:

- The scope is the bed. A plan occupies every calendar year from its planting
  date to its last date (harvest end, else harvest start, else the planting
  date itself).
- ``rotation_break_years`` counts the calendar years *without* the family on
  the bed in between: a family last on the bed in year ``Y`` may come back
  from ``Y + break + 1``. Of the two cultures involved, the stricter (larger)
  effective break wins. A break of 0 never conflicts.
- A conflict is reported against plans that start no later than the checked
  plan ends, so the earlier of two plans is not blamed for the later one.

Warnings never block saving; a conflict can be consciously accepted on the
plan (``PlantingPlan.rotation_conflict_accepted_at``).
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any

from farm.models import Bed, Crop, PlantingPlan
from farm.services.bed_capacity import BedCapacity, calculate_bed_capacities
from farm.services.crop_display import format_crop_label
from farm.services.crop_inheritance import (
    GeneralCropIndex,
    build_general_crop_index,
    forces_species_invariant_inheritance,
    get_general_crop,
    resolve_crop_field,
)

STATUS_CONFLICT = 'conflict'
STATUS_ACCEPTED = 'accepted'
STATUS_HINT = 'hint'
STATUS_INFO = 'info'
STATUS_OK = 'ok'

KIND_FAMILY_CONFLICT = 'family_conflict'
KIND_NUTRIENT_HINT = 'nutrient_hint'
KIND_NO_FAMILY = 'no_family'
KIND_NO_BREAK = 'no_break'
KIND_PREVIOUS_NO_FAMILY = 'previous_no_family'
KIND_NO_HISTORY = 'no_history'
KIND_INCOMPLETE = 'incomplete'
KIND_OK = 'ok'

BREAK_SOURCE_CROP = 'crop'
BREAK_SOURCE_FAMILY = 'family_default'

LEGUME_FAMILY_KEY = 'Fabaceae'
# A `CropSpecies.categories` entry marking a species as green manure.
GREEN_MANURE_CATEGORY = 'green_manure'
HIGH_NUTRIENT_DEMAND = 'high'

CATEGORY_GOOD = 'good'
CATEGORY_FITS = 'fits'
CATEGORY_HINT = 'hint'
CATEGORY_NO_DATA = 'no_data'
CATEGORY_CONFLICT = 'conflict'

COPY_CONFLICTS_KEEP = 'keep'
COPY_CONFLICTS_WITHOUT_BED = 'without_bed'
COPY_CONFLICTS_SKIP = 'skip'
COPY_CONFLICT_MODES = (COPY_CONFLICTS_KEEP, COPY_CONFLICTS_WITHOUT_BED, COPY_CONFLICTS_SKIP)


@dataclass(frozen=True)
class RotationCrop:
    """The rotation-relevant, effective values of one culture."""

    crop_id: int
    label: str
    family_key: str | None
    family_name: str | None
    break_years: int | None
    break_source: str | None
    # The crop row whose value the break/family edit has to change: the general
    # Kultur for a linked Sorte (species-invariant fields live there).
    settings_crop_id: int
    settings_crop_label: str
    nutrient_demand: str
    is_soil_improver: bool


@dataclass(frozen=True)
class RotationOccupancy:
    """A culture on a bed over an inclusive date range."""

    plan_id: int | None
    bed_id: int
    start: date
    end: date
    crop: RotationCrop

    @property
    def first_year(self) -> int:
        return self.start.year

    @property
    def last_year(self) -> int:
        return self.end.year


@dataclass
class RotationFinding:
    """One reason behind a rotation status, structured for localized copy."""

    kind: str
    crop_label: str | None = None
    family_key: str | None = None
    family_name: str | None = None
    previous_plan_id: int | None = None
    previous_crop_label: str | None = None
    previous_family_key: str | None = None
    previous_family_name: str | None = None
    year: int | None = None
    break_years: int | None = None
    earliest_year: int | None = None
    break_source: str | None = None
    settings_crop_id: int | None = None
    settings_crop_label: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            'kind': self.kind,
            'crop_label': self.crop_label,
            'family_key': self.family_key,
            'family_name': self.family_name,
            'previous_plan_id': self.previous_plan_id,
            'previous_crop_label': self.previous_crop_label,
            'previous_family_key': self.previous_family_key,
            'previous_family_name': self.previous_family_name,
            'year': self.year,
            'break_years': self.break_years,
            'earliest_year': self.earliest_year,
            'break_source': self.break_source,
            'settings_crop_id': self.settings_crop_id,
            'settings_crop_label': self.settings_crop_label,
        }


@dataclass
class RotationResult:
    """Status plus findings of one check; ``years_since_family`` feeds ranking."""

    status: str
    findings: list[RotationFinding] = field(default_factory=list)
    years_since_family: int | None = None
    family_seen_on_bed: bool = False
    previous_is_soil_improver: bool = False

    @property
    def is_conflict(self) -> bool:
        return self.status in (STATUS_CONFLICT, STATUS_ACCEPTED)

    def as_dict(self) -> dict[str, Any]:
        return {
            'status': self.status,
            'findings': [finding.as_dict() for finding in self.findings],
        }


def _effective_break(*crops: RotationCrop) -> tuple[int | None, RotationCrop | None]:
    """The stricter (larger) effective break of the given cultures and its owner."""
    best: tuple[int | None, RotationCrop | None] = (None, None)
    for crop in crops:
        if crop.break_years is None:
            continue
        if best[0] is None or crop.break_years > best[0]:
            best = (crop.break_years, crop)
    return best


def _conflict_finding(
    candidate: RotationOccupancy,
    other: RotationOccupancy,
) -> RotationFinding | None:
    """A family conflict between ``candidate`` and an earlier/concurrent plan."""
    break_years, break_owner = _effective_break(candidate.crop, other.crop)
    if break_years is None or break_owner is None or break_years < 1:
        return None
    if other.first_year > candidate.last_year:
        return None
    earliest_year = other.last_year + break_years + 1
    if candidate.first_year >= earliest_year:
        return None
    return RotationFinding(
        kind=KIND_FAMILY_CONFLICT,
        crop_label=break_owner.label,
        family_key=candidate.crop.family_key,
        family_name=candidate.crop.family_name,
        previous_plan_id=other.plan_id,
        previous_crop_label=other.crop.label,
        previous_family_key=other.crop.family_key,
        previous_family_name=other.crop.family_name,
        year=other.last_year,
        break_years=break_years,
        earliest_year=earliest_year,
        break_source=break_owner.break_source,
        settings_crop_id=break_owner.settings_crop_id,
        settings_crop_label=break_owner.settings_crop_label,
    )


def _sort_key_latest(occupancy: RotationOccupancy) -> tuple[date, date]:
    return (occupancy.end, occupancy.start)


def _nutrient_hint(
    candidate: RotationOccupancy,
    previous: Sequence[RotationOccupancy],
) -> RotationFinding | None:
    """Heavy feeder after heavy feeder, without a legume/green manure between.

    Walks back from the latest previous plan; a legume or green manure, or a
    culture with a known lower demand, ends the walk without a hint. Cultures
    without a demand value are stepped over.
    """
    if candidate.crop.nutrient_demand != HIGH_NUTRIENT_DEMAND:
        return None
    for occupancy in previous:
        if occupancy.crop.is_soil_improver:
            return None
        demand = occupancy.crop.nutrient_demand
        if not demand:
            continue
        if demand != HIGH_NUTRIENT_DEMAND:
            return None
        return RotationFinding(
            kind=KIND_NUTRIENT_HINT,
            crop_label=candidate.crop.label,
            family_key=candidate.crop.family_key,
            family_name=candidate.crop.family_name,
            previous_plan_id=occupancy.plan_id,
            previous_crop_label=occupancy.crop.label,
            previous_family_key=occupancy.crop.family_key,
            previous_family_name=occupancy.crop.family_name,
            year=occupancy.last_year,
        )
    return None


def evaluate_rotation(
    candidate: RotationOccupancy,
    others: Iterable[RotationOccupancy],
    *,
    accepted: bool = False,
) -> RotationResult:
    """Check ``candidate`` against the other plans on the same bed.

    ``others`` must not contain the candidate itself. Pure: no database access,
    so the rules can be tested and reused for unsaved plans (dialog check, bed
    suggestions, season copy preview).
    """
    crop = candidate.crop
    others = [
        other for other in others
        if other.plan_id is None or other.plan_id != candidate.plan_id
    ]
    # Plans that started before the candidate, latest first ("Vorkultur").
    previous = sorted(
        (other for other in others if other.start < candidate.start),
        key=_sort_key_latest,
        reverse=True,
    )
    same_family = [
        other for other in others
        if crop.family_key and other.crop.family_key == crop.family_key
        and other.first_year <= candidate.last_year
    ]
    latest_same_family = max(same_family, key=_sort_key_latest, default=None)
    result = RotationResult(
        status=STATUS_OK,
        family_seen_on_bed=latest_same_family is not None,
        years_since_family=(
            candidate.first_year - latest_same_family.last_year
            if latest_same_family is not None else None
        ),
        previous_is_soil_improver=bool(previous) and previous[0].crop.is_soil_improver,
    )

    relevant_previous = _relevant_previous(candidate, previous)
    if not crop.family_key:
        missing = [_missing_crop_data(KIND_NO_FAMILY, crop)]
        if _report_missing_data(result, missing, relevant_previous):
            return result
        return _no_history_or_ok(result, candidate, others, previous, latest_same_family)

    conflicts = [
        finding for finding in (_conflict_finding(candidate, other) for other in same_family)
        if finding is not None
    ]
    conflicts.sort(
        key=lambda finding: (-(finding.earliest_year or 0), finding.previous_plan_id or 0),
    )
    hint = _nutrient_hint(candidate, previous)

    if conflicts:
        result.status = STATUS_ACCEPTED if accepted else STATUS_CONFLICT
        result.findings.extend(conflicts)
        if hint is not None:
            result.findings.append(hint)
        return result
    if hint is not None:
        result.status = STATUS_HINT
        result.findings.append(hint)
        return result

    family_break, _ = _effective_break(*(other.crop for other in same_family))
    missing: list[RotationFinding] = []
    if crop.break_years is None and family_break is None:
        missing.append(_missing_crop_data(KIND_NO_BREAK, crop))
    if _report_missing_data(result, missing, relevant_previous):
        return result
    return _no_history_or_ok(result, candidate, others, previous, latest_same_family)


def _relevant_previous(
    candidate: RotationOccupancy,
    previous: Sequence[RotationOccupancy],
) -> list[RotationOccupancy]:
    """Earlier plans on the bed inside the culture's break window.

    Without a known break every earlier plan counts, since any of them could
    be the one that blocks the family.
    """
    break_years = candidate.crop.break_years
    if break_years is None:
        return list(previous)
    window_start = candidate.first_year - break_years
    return [other for other in previous if other.last_year >= window_start]


def _missing_crop_data(kind: str, crop: RotationCrop) -> RotationFinding:
    return RotationFinding(
        kind=kind,
        crop_label=crop.label,
        family_key=crop.family_key,
        family_name=crop.family_name,
        settings_crop_id=crop.settings_crop_id,
        settings_crop_label=crop.settings_crop_label,
    )


def _report_missing_data(
    result: RotationResult,
    missing: list[RotationFinding],
    relevant_previous: Sequence[RotationOccupancy],
) -> bool:
    """Mark ``result`` "not checkable" when missing data blocks a real check.

    Only an earlier plan in the break window makes the check matter: on a bed
    without one there is nothing to compare, whatever data is missing. Every
    such plan whose culture has no family is a reason of its own.
    """
    if not relevant_previous:
        return False
    findings = list(missing)
    for other in sorted(relevant_previous, key=_sort_key_latest):
        if not other.crop.family_key:
            findings.append(RotationFinding(
                kind=KIND_PREVIOUS_NO_FAMILY,
                previous_plan_id=other.plan_id,
                previous_crop_label=other.crop.label,
                year=other.last_year,
                settings_crop_id=other.crop.settings_crop_id,
                settings_crop_label=other.crop.settings_crop_label,
            ))
    if not findings:
        return False
    result.status = STATUS_INFO
    result.findings.extend(findings)
    return True


def _no_history_or_ok(
    result: RotationResult,
    candidate: RotationOccupancy,
    others: Sequence[RotationOccupancy],
    previous: Sequence[RotationOccupancy],
    latest_same_family: RotationOccupancy | None,
) -> RotationResult:
    """The fitting result: nothing recorded in the checked years, or checked ok."""
    crop = candidate.crop
    window_start = candidate.first_year - max(crop.break_years or 0, 1)
    has_history = any(
        other.last_year >= window_start and other.first_year <= candidate.last_year
        for other in others
    )
    if not has_history or not crop.family_key:
        # Nothing recorded on the bed in the years that matter (for a culture
        # without family: nothing earlier in its break window): the rotation
        # fits; the finding only says why there was nothing to compare.
        result.findings.append(RotationFinding(
            kind=KIND_NO_HISTORY,
            crop_label=crop.label,
            family_key=crop.family_key,
            family_name=crop.family_name,
        ))
        return result

    result.findings.append(RotationFinding(
        kind=KIND_OK,
        crop_label=crop.label,
        family_key=crop.family_key,
        family_name=crop.family_name,
        previous_plan_id=previous[0].plan_id if previous else None,
        previous_crop_label=previous[0].crop.label if previous else None,
        previous_family_key=previous[0].crop.family_key if previous else None,
        previous_family_name=previous[0].crop.family_name if previous else None,
        year=latest_same_family.last_year if latest_same_family is not None else None,
        break_years=crop.break_years,
        break_source=crop.break_source,
    ))
    return result


def incomplete_result() -> RotationResult:
    """The status of a draft plan that lacks a crop, bed or planting date."""
    return RotationResult(status=STATUS_INFO, findings=[RotationFinding(kind=KIND_INCOMPLETE)])


def _plan_end_date(plan: PlantingPlan, general_crop_index: GeneralCropIndex) -> date | None:
    """The last date a plan occupies its bed."""
    if plan.planting_date is None:
        return None
    end = plan.harvest_end_date or plan.harvest_date
    if end is None and plan.crop_id is not None:
        harvest_start, harvest_end = plan.calculate_effective_harvest_dates(general_crop_index)
        end = harvest_end or harvest_start
    if end is None or end < plan.planting_date:
        return plan.planting_date
    return end


class RotationService:
    """Loads one project's bed history once and answers rotation checks from it.

    Construction is cheap; the bed history and the plant-family list are each
    loaded with a constant number of queries on first use, so checking every
    plan of a list response costs the same as checking one.
    """

    def __init__(
        self,
        project_id: int,
        *,
        language_code: str,
        region: str = '',
        general_crop_index: GeneralCropIndex | None = None,
    ) -> None:
        self.project_id = project_id
        self.language_code = language_code
        self.region = region
        self._general_crop_index = general_crop_index
        self._families: dict[str, tuple[str, int | None]] | None = None
        self._crops: dict[int, RotationCrop] = {}
        self._occupancies_by_bed: dict[int, list[RotationOccupancy]] | None = None
        self._occupancies_by_plan_id: dict[int, RotationOccupancy] | None = None

    @property
    def general_crop_index(self) -> GeneralCropIndex:
        if self._general_crop_index is None:
            self._general_crop_index = build_general_crop_index(self.project_id)
        return self._general_crop_index

    def _family_info(self, family_key: str) -> tuple[str, int | None]:
        if self._families is None:
            from crops.models import PlantFamily

            self._families = {
                family.botanical_name: (
                    family.localized_name(self.language_code)[0],
                    family.default_rotation_break_years,
                )
                for family in PlantFamily.objects.prefetch_related('translations')
            }
        return self._families.get(family_key, (family_key, None))

    def _crop_label(self, crop: Crop) -> str:
        return format_crop_label(crop, self.language_code, self.region)

    def rotation_crop(self, crop: Crop) -> RotationCrop:
        """Effective rotation values of ``crop``, cached per crop id."""
        cached = self._crops.get(crop.pk)
        if cached is not None:
            return cached
        index = self.general_crop_index
        family_key = resolve_crop_field(crop, 'crop_family', index) or None
        family_name: str | None = None
        family_default: int | None = None
        if family_key:
            family_name, family_default = self._family_info(family_key)
        own_break = resolve_crop_field(crop, 'rotation_break_years', index)
        if own_break is not None:
            break_years, break_source = own_break, BREAK_SOURCE_CROP
        elif family_default is not None:
            break_years, break_source = family_default, BREAK_SOURCE_FAMILY
        else:
            break_years, break_source = None, None
        settings_crop = crop
        if forces_species_invariant_inheritance(crop, 'rotation_break_years'):
            settings_crop = get_general_crop(crop, index) or crop
        species = crop.crop_species if crop.crop_species_id else None
        categories = species.categories if species is not None else []
        result = RotationCrop(
            crop_id=crop.pk,
            label=self._crop_label(crop),
            family_key=family_key,
            family_name=family_name,
            break_years=break_years,
            break_source=break_source,
            settings_crop_id=settings_crop.pk,
            settings_crop_label=self._crop_label(settings_crop),
            nutrient_demand=resolve_crop_field(crop, 'nutrient_demand', index) or '',
            is_soil_improver=(
                family_key == LEGUME_FAMILY_KEY or GREEN_MANURE_CATEGORY in (categories or [])
            ),
        )
        self._crops[crop.pk] = result
        return result

    def occupancy(
        self,
        *,
        crop: Crop,
        bed_id: int,
        start: date,
        end: date | None,
        plan_id: int | None = None,
    ) -> RotationOccupancy:
        return RotationOccupancy(
            plan_id=plan_id,
            bed_id=bed_id,
            start=start,
            end=end if end is not None and end >= start else start,
            crop=self.rotation_crop(crop),
        )

    def plan_occupancy(self, plan: PlantingPlan) -> RotationOccupancy | None:
        if plan.crop is None or plan.bed_id is None or plan.planting_date is None:
            return None
        return self.occupancy(
            crop=plan.crop,
            bed_id=plan.bed_id,
            start=plan.planting_date,
            end=_plan_end_date(plan, self.general_crop_index),
            plan_id=plan.pk,
        )

    def _load_occupancies(self) -> dict[int, list[RotationOccupancy]]:
        if self._occupancies_by_bed is None:
            plans = (
                PlantingPlan.objects
                .filter(
                    project_id=self.project_id,
                    bed__isnull=False,
                    crop__isnull=False,
                    planting_date__isnull=False,
                )
                .select_related('crop', 'crop__crop_species')
                .prefetch_related('crop__crop_species__translations')
            )
            by_bed: dict[int, list[RotationOccupancy]] = defaultdict(list)
            for plan in plans:
                occupancy = self.plan_occupancy(plan)
                if occupancy is not None:
                    by_bed[occupancy.bed_id].append(occupancy)
            self._occupancies_by_bed = dict(by_bed)
        return self._occupancies_by_bed

    def plan_occupancy_by_id(self, plan_id: int) -> RotationOccupancy | None:
        """A saved plan's occupancy from the loaded bed history, if it has one."""
        if self._occupancies_by_plan_id is None:
            self._occupancies_by_plan_id = {
                occupancy.plan_id: occupancy
                for occupancies in self._load_occupancies().values()
                for occupancy in occupancies
                if occupancy.plan_id is not None
            }
        return self._occupancies_by_plan_id.get(plan_id)

    def bed_occupancies(self, bed_id: int) -> list[RotationOccupancy]:
        return self._load_occupancies().get(bed_id, [])

    def add_occupancies(self, occupancies: Iterable[RotationOccupancy]) -> None:
        """Treat unsaved plans (e.g. season copies) as part of the bed history."""
        by_bed = self._load_occupancies()
        for occupancy in occupancies:
            by_bed.setdefault(occupancy.bed_id, []).append(occupancy)

    def check(self, candidate: RotationOccupancy, *, accepted: bool = False) -> RotationResult:
        others = [
            other for other in self.bed_occupancies(candidate.bed_id)
            if other is not candidate
            and (candidate.plan_id is None or other.plan_id != candidate.plan_id)
        ]
        return evaluate_rotation(candidate, others, accepted=accepted)

    def check_plan(self, plan: PlantingPlan) -> RotationResult:
        occupancy = self.plan_occupancy(plan)
        if occupancy is None:
            return incomplete_result()
        return self.check(occupancy, accepted=plan.rotation_conflict_accepted)

    def bed_history(
        self,
        bed_id: int,
        *,
        exclude_plan_id: int | None = None,
    ) -> list[dict[str, Any]]:
        """The bed's recorded cultures, newest first, for "Belegung ansehen"."""
        rows = sorted(
            (
                occupancy for occupancy in self.bed_occupancies(bed_id)
                if exclude_plan_id is None or occupancy.plan_id != exclude_plan_id
            ),
            key=_sort_key_latest,
            reverse=True,
        )
        return [
            {
                'plan_id': occupancy.plan_id,
                'crop_label': occupancy.crop.label,
                'family_key': occupancy.crop.family_key,
                'family_name': occupancy.crop.family_name,
                'first_year': occupancy.first_year,
                'last_year': occupancy.last_year,
            }
            for occupancy in rows
        ]


# Bed options are ordered by these groups first: fitting rotation, nutrient
# hint, not checkable, rotation conflict, and last the beds without enough
# free area in the period (shown, but not selectable).
OPTION_GROUP_ORDER = (STATUS_OK, STATUS_HINT, STATUS_INFO, STATUS_CONFLICT)
OPTION_GROUP_INSUFFICIENT_AREA = len(OPTION_GROUP_ORDER)


def _suggestion_category(result: RotationResult, crop: RotationCrop) -> str:
    if result.is_conflict:
        return CATEGORY_CONFLICT
    if result.status == STATUS_HINT:
        return CATEGORY_HINT
    if result.status == STATUS_INFO:
        return CATEGORY_NO_DATA
    legume_plus = crop.nutrient_demand == HIGH_NUTRIENT_DEMAND and result.previous_is_soil_improver
    well_rested = (
        not result.family_seen_on_bed
        or (
            result.years_since_family is not None
            and crop.break_years is not None
            and result.years_since_family > 2 * crop.break_years
        )
    )
    return CATEGORY_GOOD if legume_plus or well_rested else CATEGORY_FITS


def _capacity_payload(
    service: RotationService,
    capacity: BedCapacity,
    needed_area_sqm: Decimal | None,
) -> dict[str, Any]:
    blocker = capacity.last_ending_plan()
    blocker_occupancy = (
        service.plan_occupancy_by_id(blocker.plan_id) if blocker is not None else None
    )
    free = capacity.free_area_sqm
    return {
        'bed_area_sqm': float(capacity.bed_area_sqm) if capacity.bed_area_sqm is not None else None,
        'used_area_sqm': float(capacity.used_area_sqm),
        'free_area_sqm': float(free) if free is not None else None,
        'has_enough_area': capacity.has_room_for(needed_area_sqm),
        'is_partially_occupied': capacity.is_partially_occupied,
        'blocking_plan': (
            {
                'plan_id': blocker.plan_id,
                'crop_label': blocker_occupancy.crop.label if blocker_occupancy is not None else '',
                'end_date': blocker.end.isoformat(),
            }
            if blocker is not None else None
        ),
    }


def suggest_beds(
    service: RotationService,
    *,
    crop: Crop,
    start: date,
    end: date | None,
    exclude_plan_id: int | None = None,
    needed_area_sqm: Decimal | None = None,
) -> list[dict[str, Any]]:
    """Every bed of the project for ``crop`` in ``[start, end]``, best fit first.

    Each row carries the rotation result and the bed's capacity in the period
    (:mod:`farm.services.bed_capacity`, the same rule as the save check).
    Beds without enough free area for ``needed_area_sqm`` come last with
    ``has_enough_area`` false; without ``needed_area_sqm`` the area is not
    checked. Within a group, the bed whose last same-family culture is longest
    ago comes first (never on the bed counts as longest ago).
    """
    end = end if end is not None and end >= start else start
    beds = list(
        Bed.objects
        .filter(project_id=service.project_id)
        .select_related('field', 'field__location')
        .order_by('field__location__name', 'field__name', 'name', 'pk')
    )
    # The plan's own harvest phase from the crop's timing: during its soft
    # stage a follow-up crop may already take over (farm/services/bed_capacity.py).
    draft = PlantingPlan(crop=crop, planting_date=start)
    harvest_start, _ = draft.calculate_effective_harvest_dates(service.general_crop_index)
    capacities = calculate_bed_capacities(
        beds, start=start, end=end, harvest_start=harvest_start, exclude_plan_id=exclude_plan_id,
    )
    rotation_crop = service.rotation_crop(crop)
    rows: list[tuple[tuple[Any, ...], dict[str, Any]]] = []
    for position, bed in enumerate(beds):
        candidate = RotationOccupancy(
            plan_id=exclude_plan_id, bed_id=bed.pk, start=start, end=end, crop=rotation_crop,
        )
        result = service.check(candidate)
        category = _suggestion_category(result, rotation_crop)
        capacity_payload = _capacity_payload(service, capacities[bed.pk], needed_area_sqm)
        legume_plus = (
            rotation_crop.nutrient_demand == HIGH_NUTRIENT_DEMAND
            and result.previous_is_soil_improver
        )
        years_since = result.years_since_family
        group = (
            OPTION_GROUP_ORDER.index(STATUS_CONFLICT if result.is_conflict else result.status)
            if capacity_payload['has_enough_area'] else OPTION_GROUP_INSUFFICIENT_AREA
        )
        sort_key = (
            group,
            # Never on the bed ranks like "longest ago".
            -(years_since if years_since is not None else 10_000),
            0 if legume_plus else 1,
            position,
        )
        bed_field = bed.field if bed.field_id else None
        location = bed_field.location if bed_field is not None else None
        rows.append((sort_key, {
            'bed_id': bed.pk,
            'bed_name': bed.name,
            'field_id': bed_field.pk if bed_field is not None else None,
            'field_name': bed_field.name if bed_field is not None else '',
            'location_id': location.pk if location is not None else None,
            'location_name': location.name if location is not None else '',
            'category': category,
            'status': result.status,
            'findings': [finding.as_dict() for finding in result.findings],
            'years_since_family': years_since,
            'previous_is_soil_improver': result.previous_is_soil_improver,
            **capacity_payload,
        }))
    rows.sort(key=lambda row: row[0])
    return [row for _, row in rows]


def check_season_copies(
    service: RotationService,
    pairs: Sequence[tuple[PlantingPlan, PlantingPlan]],
) -> list[RotationResult]:
    """Check unsaved season copies against the bed history and each other.

    ``pairs`` come from :func:`farm.services.seasons.build_planting_plan_copies`;
    the results are in the same order. The copies count as bed history for
    one another, since they will all exist after the copy.
    """
    occupancies = [service.plan_occupancy(copy) for _, copy in pairs]
    service.add_occupancies(occupancy for occupancy in occupancies if occupancy is not None)
    return [
        service.check(occupancy) if occupancy is not None else incomplete_result()
        for occupancy in occupancies
    ]


def preview_season_copy(
    service: RotationService,
    pairs: Sequence[tuple[PlantingPlan, PlantingPlan]],
) -> dict[str, Any]:
    """Summary of the rotation check for a season copy, for the copy dialog."""
    results = check_season_copies(service, pairs)
    items: list[dict[str, Any]] = []
    conflict_count = 0
    hint_count = 0
    for (source, copy), result in zip(pairs, results, strict=True):
        if result.is_conflict:
            conflict_count += 1
        elif result.status == STATUS_HINT:
            hint_count += 1
        else:
            continue
        items.append({
            'source_plan_id': source.pk,
            'crop_label': service.rotation_crop(copy.crop).label if copy.crop is not None else '',
            'bed_id': copy.bed_id,
            'bed_name': copy.bed.name if copy.bed is not None else '',
            'status': STATUS_CONFLICT if result.is_conflict else result.status,
            'findings': [finding.as_dict() for finding in result.findings],
        })
    items.sort(
        key=lambda item: (item['status'] != STATUS_CONFLICT, item['bed_name'], item['crop_label']),
    )
    total = len(pairs)
    return {
        'total': total,
        'conflict_count': conflict_count,
        'hint_count': hint_count,
        'conflict_free_count': total - conflict_count,
        'items': items,
    }
