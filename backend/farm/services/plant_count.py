"""Plant count of a planting plan from its area and the crop's spacing.

One implementation for every consumer: the ``plants_count`` column of the
planting-plans API and the young-plant demand
(``farm.services.young_plant_demand``). Inherited Sorte spacing is resolved
through the general Kultur, like everywhere else.
"""
from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from farm.models import PlantingPlan
from farm.services.crop_inheritance import GeneralCropIndex, resolve_plants_per_m2

PLANT_COUNT_BLOCKER_MISSING_AREA = 'missing_area'
PLANT_COUNT_BLOCKER_MISSING_PLANT_SPACING = 'missing_plant_spacing'


@dataclass(frozen=True)
class PlantCountResult:
    """A plan's plant count, or the reasons it cannot be computed."""

    count: int | None
    blockers: tuple[str, ...] = ()


def compute_plan_plant_count(
    plan: PlantingPlan,
    general_crop_index: GeneralCropIndex | None = None,
) -> PlantCountResult:
    """Plants on ``plan.area_usage_sqm`` (m²) at the crop's effective spacing, rounded."""
    blockers: list[str] = []
    area = Decimal(str(plan.area_usage_sqm)) if plan.area_usage_sqm else Decimal('0')
    if area <= 0:
        blockers.append(PLANT_COUNT_BLOCKER_MISSING_AREA)
    plants_per_m2 = resolve_plants_per_m2(plan.crop, general_crop_index)
    if not plants_per_m2 or plants_per_m2 <= 0:
        blockers.append(PLANT_COUNT_BLOCKER_MISSING_PLANT_SPACING)
    if blockers:
        return PlantCountResult(count=None, blockers=tuple(blockers))
    return PlantCountResult(count=round(area * plants_per_m2))
