"""Bed capacity: how much of a bed's area is still free in a period.

One rule answers every capacity question: the planting-plan table's save check
(through the ``remaining-area`` endpoint), the bed suggestions and the bed
options of "Anbaufläche ändern" (``bed-suggestions``), and the harvest-overlap
infos on saved plans. A bed that is offered there is therefore never rejected
when the plan is saved. The rules are documented in
docs/bed-occupancy.md; in short:

- A plan occupies its bed from its planting date to its harvest end, else its
  harvest start, else its planting date. Plans without a planting date or bed
  have no place in time and never count.
- That occupancy has two stages. The *firm* stage runs up to the day before
  harvest start + the project's minimum gap (capped at the harvest end); the
  rest of the harvest phase is *soft*. A follow-up crop may take over the bed
  during the soft stage: the previous crop is then harvested and cleared early.
  With the project setting off, or without a harvest start, everything is firm.
- The save check only counts firm stages: when at any day the firm areas of
  the plans exceed the bed, the plan does not fit. Overlapping soft stages are
  allowed and reported as a harvest overlap (an info, never an error).
- Two periods overlap when they share at least one day (inclusive bounds).
- The plan being edited (``exclude_plan_id``) never counts against itself.
- A plan without an area skips the check, and so does a bed without an area.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from django.db.models import DateField, QuerySet
from django.db.models.functions import Coalesce

from farm.models import Bed, Crop, PlantingPlan, Project

ZERO_AREA = Decimal('0.00')
DEFAULT_SUCCESSION_MIN_DAYS = 14
MAX_SUCCESSION_MIN_DAYS = 365

ROLE_PREDECESSOR = 'predecessor'
ROLE_SUCCESSOR = 'successor'


@dataclass(frozen=True)
class SuccessionRule:
    """When a follow-up crop may take over a bed during a harvest phase."""

    allow_during_harvest: bool = True
    min_days_after_harvest_start: int = DEFAULT_SUCCESSION_MIN_DAYS

    @classmethod
    def for_project(cls, project: Project | None) -> SuccessionRule:
        if project is None:
            return cls()
        return cls(
            allow_during_harvest=project.allow_succession_during_harvest,
            min_days_after_harvest_start=project.succession_min_days_after_harvest_start,
        )

    @classmethod
    def for_project_id(cls, project_id: int) -> SuccessionRule:
        project = (
            Project.objects
            .only('allow_succession_during_harvest', 'succession_min_days_after_harvest_start')
            .filter(pk=project_id)
            .first()
        )
        return cls.for_project(project)

    def firm_end(self, start: date, harvest_start: date | None, end: date) -> date:
        """The last day (inclusive) the plan occupies its bed firmly."""
        if not self.allow_during_harvest or harvest_start is None or harvest_start > end:
            return end
        earliest_successor_start = harvest_start + timedelta(days=self.min_days_after_harvest_start)
        return max(start, min(end, earliest_successor_start - timedelta(days=1)))


@dataclass(frozen=True)
class BedOccupancy:
    """A plan's place on its bed: the whole period and its firm stage (inclusive)."""

    plan_id: int | None
    crop_id: int | None
    area_sqm: Decimal
    start: date
    harvest_start: date | None
    end: date
    firm_end: date
    crop_label: str = ''

    def covers(self, day: date) -> bool:
        return self.start <= day <= self.end

    def firmly_covers(self, day: date) -> bool:
        return self.start <= day <= self.firm_end

    def firmly_overlaps(self, start: date, end: date) -> bool:
        return self.start <= end and start <= self.firm_end

    def is_soft_on(self, day: date) -> bool:
        """Whether ``day`` falls in the soft stage, where a follow-up may start."""
        return self.firm_end < day <= self.end


def build_occupancy(
    *,
    rule: SuccessionRule,
    start: date,
    harvest_start: date | None,
    end: date | None,
    area_sqm: Decimal | None,
    plan_id: int | None = None,
    crop_id: int | None = None,
    crop_label: str = '',
) -> BedOccupancy:
    """An occupancy from a plan's dates; ``end`` falls back to the harvest start."""
    period_end = end or harvest_start or start
    if period_end < start:
        period_end = start
    return BedOccupancy(
        plan_id=plan_id,
        crop_id=crop_id,
        area_sqm=area_sqm if area_sqm is not None else ZERO_AREA,
        start=start,
        harvest_start=harvest_start,
        end=period_end,
        firm_end=rule.firm_end(start, harvest_start, period_end),
        crop_label=crop_label,
    )


def _peak_area(
    occupancies: Iterable[BedOccupancy],
    start: date,
    end: date,
    covers: Callable[[BedOccupancy, date], bool],
) -> Decimal:
    """The largest summed area of ``occupancies`` on any day of ``[start, end]``.

    Occupied area only grows on a plan's first day, so the peak is on the
    window's first day or on one of those.
    """
    occupancies = list(occupancies)
    days = {start} | {item.start for item in occupancies if start <= item.start <= end}
    return max(
        (
            sum((item.area_sqm for item in occupancies if covers(item, day)), ZERO_AREA)
            for day in days
        ),
        default=ZERO_AREA,
    )


@dataclass(frozen=True)
class OccupyingPlan:
    """A plan whose firm stage takes up area on a bed during the checked period."""

    plan_id: int
    crop_id: int | None
    area_sqm: Decimal
    # The last day of the firm stage: from the next day on, the area is free
    # for a follow-up crop.
    end: date
    start: date | None = None
    harvest_start: date | None = None


@dataclass(frozen=True)
class BedCapacity:
    """Area of one bed and how much of it other plans firmly use in the period (m²)."""

    bed_id: int
    bed_area_sqm: Decimal | None
    used_area_sqm: Decimal
    occupying_plans: tuple[OccupyingPlan, ...] = ()

    @property
    def free_area_sqm(self) -> Decimal | None:
        """Remaining area in m², never negative; ``None`` when the bed has no area."""
        if self.bed_area_sqm is None:
            return None
        return max(self.bed_area_sqm - self.used_area_sqm, ZERO_AREA)

    @property
    def is_partially_occupied(self) -> bool:
        return self.used_area_sqm > ZERO_AREA

    def has_room_for(self, needed_area_sqm: Decimal | None) -> bool:
        """Whether a plan needing ``needed_area_sqm`` m² fits; the save check's rule."""
        free = self.free_area_sqm
        if needed_area_sqm is None or needed_area_sqm <= ZERO_AREA or free is None:
            return True
        return needed_area_sqm <= free

    def last_ending_plan(self) -> OccupyingPlan | None:
        """The occupying plan that frees its area last (named as the blocker)."""
        return max(self.occupying_plans, key=lambda plan: (plan.end, plan.plan_id), default=None)


def _plans_with_period() -> QuerySet[PlantingPlan]:
    return PlantingPlan.objects.annotate(
        occupied_until=Coalesce(
            'harvest_end_date', 'harvest_date', 'planting_date', output_field=DateField(),
        ),
    )


def occupying_plans_in_period(
    *,
    bed_ids: Iterable[int],
    start: date,
    end: date,
    exclude_plan_id: int | None = None,
) -> QuerySet[PlantingPlan]:
    """Plans on ``bed_ids`` whose occupied period overlaps ``[start, end]``."""
    plans = _plans_with_period().filter(
        bed_id__in=list(bed_ids), planting_date__lte=end, occupied_until__gte=start,
    )
    if exclude_plan_id is not None:
        plans = plans.exclude(pk=exclude_plan_id)
    return plans


def calculate_bed_capacities(
    beds: Sequence[Bed],
    *,
    start: date,
    end: date,
    harvest_start: date | None = None,
    exclude_plan_id: int | None = None,
    rule: SuccessionRule | None = None,
) -> dict[int, BedCapacity]:
    """Capacity of every bed in ``beds`` for a plan in ``[start, end]``.

    Only the firm stages count, the checked plan's own (from ``harvest_start``)
    and the other plans'. ``used_area_sqm`` is the peak firmly used area on
    any day of the checked plan's firm stage. Without ``rule`` the rule of the
    beds' project applies.
    """
    if end < start:
        raise ValueError('end must be greater than or equal to start.')
    if rule is None:
        rule = SuccessionRule.for_project_id(beds[0].project_id) if beds else SuccessionRule()
    firm_end = rule.firm_end(start, harvest_start, end)
    occupying: dict[int, list[BedOccupancy]] = defaultdict(list)
    rows = occupying_plans_in_period(
        bed_ids=[bed.pk for bed in beds], start=start, end=firm_end,
        exclude_plan_id=exclude_plan_id,
    ).values_list(
        'bed_id', 'pk', 'crop_id', 'area_usage_sqm', 'planting_date', 'harvest_date', 'occupied_until',
    )
    for bed_id, plan_id, crop_id, area, planting_date, plan_harvest_start, occupied_until in rows:
        occupancy = build_occupancy(
            rule=rule, start=planting_date, harvest_start=plan_harvest_start, end=occupied_until,
            area_sqm=area, plan_id=plan_id, crop_id=crop_id,
        )
        if occupancy.firmly_overlaps(start, firm_end):
            occupying[bed_id].append(occupancy)
    return {
        bed.pk: BedCapacity(
            bed_id=bed.pk,
            bed_area_sqm=bed.area_sqm,
            used_area_sqm=_peak_area(
                occupying[bed.pk], start, firm_end, BedOccupancy.firmly_covers,
            ),
            occupying_plans=tuple(
                OccupyingPlan(
                    plan_id=item.plan_id,
                    crop_id=item.crop_id,
                    area_sqm=item.area_sqm,
                    end=item.firm_end,
                    start=item.start,
                    harvest_start=item.harvest_start,
                )
                for item in occupying[bed.pk]
                if item.plan_id is not None
            ),
        )
        for bed in beds
    }


def calculate_bed_capacity(
    bed: Bed,
    *,
    start: date,
    end: date,
    harvest_start: date | None = None,
    exclude_plan_id: int | None = None,
    rule: SuccessionRule | None = None,
) -> BedCapacity:
    """Capacity of one bed for a plan in ``[start, end]``."""
    capacities = calculate_bed_capacities(
        [bed], start=start, end=end, harvest_start=harvest_start,
        exclude_plan_id=exclude_plan_id, rule=rule,
    )
    return capacities[bed.pk]


@dataclass(frozen=True)
class HarvestOverlap:
    """An allowed overlap: a follow-up crop starts in a previous crop's harvest phase.

    ``role`` is the checked plan's part. As the predecessor (Vorkultur) its
    harvest ends on ``date`` at the latest, the follow-up's first day; as the
    successor (Folgekultur) ``date`` is the predecessor's planned harvest end.
    """

    role: str
    other_plan_id: int | None
    other_crop_label: str
    date: date

    def as_dict(self) -> dict[str, Any]:
        return {
            'role': self.role,
            'other_plan_id': self.other_plan_id,
            'other_crop_label': self.other_crop_label,
            'date': self.date.isoformat(),
        }


def _overflows_bed(
    arrival: BedOccupancy,
    occupancies: Sequence[BedOccupancy],
    bed_area_sqm: Decimal,
) -> bool:
    """Whether the bed is over-full on the day ``arrival`` takes it over."""
    used = sum((item.area_sqm for item in occupancies if item.covers(arrival.start)), ZERO_AREA)
    return used > bed_area_sqm


def find_harvest_overlaps(
    candidate: BedOccupancy,
    others: Sequence[BedOccupancy],
    bed_area_sqm: Decimal | None,
) -> list[HarvestOverlap]:
    """The harvest overlaps of ``candidate`` with the other plans on its bed.

    A pair overlaps when the follow-up starts in the soft stage of the
    predecessor and the bed is over-full on that day, so the predecessor has
    to make room early. Partial plans that fit side by side are no overlap.
    Sorted by date, so the first predecessor entry is the actual harvest end.
    """
    if bed_area_sqm is None:
        return []
    everyone = [candidate, *others]
    overlaps: list[HarvestOverlap] = []
    for other in others:
        if candidate.is_soft_on(other.start):
            if _overflows_bed(other, everyone, bed_area_sqm):
                overlaps.append(HarvestOverlap(
                    role=ROLE_PREDECESSOR,
                    other_plan_id=other.plan_id,
                    other_crop_label=other.crop_label,
                    date=other.start,
                ))
        elif other.is_soft_on(candidate.start):
            if _overflows_bed(candidate, everyone, bed_area_sqm):
                overlaps.append(HarvestOverlap(
                    role=ROLE_SUCCESSOR,
                    other_plan_id=other.plan_id,
                    other_crop_label=other.crop_label,
                    date=other.end,
                ))
    overlaps.sort(key=lambda item: (item.date, item.role, item.other_plan_id or 0))
    return overlaps


def actual_harvest_end(overlaps: Iterable[HarvestOverlap]) -> date | None:
    """The day the plan's harvest ends at the latest: its earliest follow-up's start."""
    return min((item.date for item in overlaps if item.role == ROLE_PREDECESSOR), default=None)


class HarvestOverlapIndex:
    """Loads the bed occupancies of one project once and answers overlap questions.

    ``crop_label`` turns a crop into the label the infos name it by; the
    queries are constant however many plans are checked.
    """

    def __init__(
        self,
        project_id: int,
        *,
        crop_label: Callable[[Crop], str],
        rule: SuccessionRule | None = None,
        bed_ids: Iterable[int] | None = None,
    ) -> None:
        self.project_id = project_id
        self._crop_label = crop_label
        self._rule = rule
        self._bed_ids = list(bed_ids) if bed_ids is not None else None
        self._by_bed: dict[int, list[BedOccupancy]] | None = None
        self._bed_areas: dict[int, Decimal | None] = {}

    @property
    def rule(self) -> SuccessionRule:
        if self._rule is None:
            self._rule = SuccessionRule.for_project_id(self.project_id)
        return self._rule

    def _load(self) -> dict[int, list[BedOccupancy]]:
        if self._by_bed is None:
            plans = (
                _plans_with_period()
                .filter(project_id=self.project_id, bed__isnull=False, planting_date__isnull=False)
                .select_related('bed', 'crop', 'crop__crop_species')
                .prefetch_related('crop__crop_species__translations')
            )
            if self._bed_ids is not None:
                plans = plans.filter(bed_id__in=self._bed_ids)
            by_bed: dict[int, list[BedOccupancy]] = defaultdict(list)
            for plan in plans:
                self._bed_areas[plan.bed_id] = plan.bed.area_sqm
                by_bed[plan.bed_id].append(build_occupancy(
                    rule=self.rule,
                    start=plan.planting_date,
                    harvest_start=plan.harvest_date,
                    end=plan.occupied_until,
                    area_sqm=plan.area_usage_sqm,
                    plan_id=plan.pk,
                    crop_id=plan.crop_id,
                    crop_label=self._crop_label(plan.crop) if plan.crop is not None else '',
                ))
            self._by_bed = dict(by_bed)
        return self._by_bed

    def plan_overlaps(self, plan: PlantingPlan) -> list[HarvestOverlap]:
        """The harvest overlaps of a saved plan, as stored."""
        if plan.bed_id is None or plan.planting_date is None:
            return []
        occupancies = self._load().get(plan.bed_id, [])
        candidate = next((item for item in occupancies if item.plan_id == plan.pk), None)
        if candidate is None:
            return []
        others = [item for item in occupancies if item is not candidate]
        return find_harvest_overlaps(candidate, others, self._bed_areas.get(plan.bed_id))

    def candidate_overlaps(
        self,
        bed: Bed,
        *,
        start: date,
        harvest_start: date | None,
        end: date | None,
        area_sqm: Decimal | None,
        exclude_plan_id: int | None = None,
    ) -> list[HarvestOverlap]:
        """The harvest overlaps a plan with these (unsaved) values would have."""
        candidate = build_occupancy(
            rule=self.rule, start=start, harvest_start=harvest_start, end=end,
            area_sqm=area_sqm, plan_id=exclude_plan_id,
        )
        others = [
            item for item in self._load().get(bed.pk, [])
            if exclude_plan_id is None or item.plan_id != exclude_plan_id
        ]
        return find_harvest_overlaps(candidate, others, bed.area_sqm)
