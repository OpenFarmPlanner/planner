"""Bed capacity: how much of a bed's area is still free in a period.

One rule answers every capacity question: the planting-plan table's save check
(through the ``remaining-area`` endpoint), the bed suggestions and the bed
options of "Anbaufläche ändern" (``bed-suggestions``). A bed that is offered
there is therefore never rejected when the plan is saved.

- Another plan occupies its bed from its planting date to its harvest end,
  else its harvest start, else its planting date. Plans without a planting
  date or bed have no place in time and never count.
- Two periods overlap when they share at least one day (inclusive bounds).
  There is no tolerance for short overlaps.
- The plan being edited (``exclude_plan_id``) never counts against itself.
- A plan without an area skips the check, and so does a bed without an area.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from django.db.models import DateField, QuerySet
from django.db.models.functions import Coalesce

from farm.models import Bed, PlantingPlan

ZERO_AREA = Decimal('0.00')


@dataclass(frozen=True)
class OccupyingPlan:
    """A plan that takes up area on a bed during the checked period."""

    plan_id: int
    crop_id: int | None
    area_sqm: Decimal
    end: date


@dataclass(frozen=True)
class BedCapacity:
    """Area of one bed and how much of it other plans use in the period (m²)."""

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


def occupying_plans_in_period(
    *,
    bed_ids: Iterable[int],
    start: date,
    end: date,
    exclude_plan_id: int | None = None,
) -> QuerySet[PlantingPlan]:
    """Plans on ``bed_ids`` whose occupied period overlaps ``[start, end]``."""
    plans = (
        PlantingPlan.objects
        .annotate(
            occupied_until=Coalesce(
                'harvest_end_date', 'harvest_date', 'planting_date', output_field=DateField(),
            ),
        )
        .filter(bed_id__in=list(bed_ids), planting_date__lte=end, occupied_until__gte=start)
    )
    if exclude_plan_id is not None:
        plans = plans.exclude(pk=exclude_plan_id)
    return plans


def calculate_bed_capacities(
    beds: Sequence[Bed],
    *,
    start: date,
    end: date,
    exclude_plan_id: int | None = None,
) -> dict[int, BedCapacity]:
    """Capacity of every bed in ``beds`` for ``[start, end]``, with one query."""
    if end < start:
        raise ValueError('end must be greater than or equal to start.')
    occupying: dict[int, list[OccupyingPlan]] = defaultdict(list)
    rows = occupying_plans_in_period(
        bed_ids=[bed.pk for bed in beds], start=start, end=end, exclude_plan_id=exclude_plan_id,
    ).values_list('bed_id', 'pk', 'crop_id', 'area_usage_sqm', 'occupied_until')
    for bed_id, plan_id, crop_id, area, occupied_until in rows:
        occupying[bed_id].append(OccupyingPlan(
            plan_id=plan_id,
            crop_id=crop_id,
            area_sqm=area if area is not None else ZERO_AREA,
            end=occupied_until,
        ))
    return {
        bed.pk: BedCapacity(
            bed_id=bed.pk,
            bed_area_sqm=bed.area_sqm,
            used_area_sqm=sum((plan.area_sqm for plan in occupying[bed.pk]), ZERO_AREA),
            occupying_plans=tuple(occupying[bed.pk]),
        )
        for bed in beds
    }


def calculate_bed_capacity(
    bed: Bed,
    *,
    start: date,
    end: date,
    exclude_plan_id: int | None = None,
) -> BedCapacity:
    """Capacity of one bed for ``[start, end]``."""
    capacities = calculate_bed_capacities(
        [bed], start=start, end=end, exclude_plan_id=exclude_plan_id,
    )
    return capacities[bed.pk]
