"""Harvest suggestions and unit-safe quantities for records and planting plans."""

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import Q
from django.db.models.query import QuerySet

from farm.models import Crop, PlantingPlan, Season
from farm.models.harvests import HarvestConversionSource, HarvestUnit
from farm.services.crop_inheritance import GeneralCropIndex, get_general_crop
from farm.services.public_crops import effective_library_pinned_fields
from farm.services.yield_calendar import compute_plan_expected_yield

REFERENCE_WEIGHT_FIELDS = {
    HarvestUnit.PIECE: "average_harvest_piece_weight_g",
    HarvestUnit.BUNCH: "average_harvest_bunch_weight_g",
}
GRAMS_PER_KILOGRAM = Decimal(1000)
DISPLAY_PRECISION = Decimal("0.000001")


def reference_weight(crop: Crop, unit: str) -> tuple[Decimal | None, str]:
    field_name = REFERENCE_WEIGHT_FIELDS.get(unit)
    if field_name is None:
        return None, ""
    owner = crop if getattr(crop, field_name) is not None else get_general_crop(crop)
    weight = getattr(owner, field_name, None)
    if weight is None or weight <= 0:
        return None, ""
    public = owner.source_public_crop or owner.derived_from_public_crop
    if (
        public is not None
        and getattr(public, field_name) == weight
        and field_name not in effective_library_pinned_fields(owner)
    ):
        return weight, HarvestConversionSource.LIBRARY
    return weight, HarvestConversionSource.CROP


def measured_weight_kg(quantity: Decimal, unit: str) -> Decimal | None:
    if unit == HarvestUnit.KILOGRAM:
        return quantity
    if unit == HarvestUnit.GRAM:
        return quantity / GRAMS_PER_KILOGRAM
    return None


def estimated_weight_kg(quantity: Decimal, grams_per_unit: Decimal | None) -> Decimal | None:
    return quantity * grams_per_unit / GRAMS_PER_KILOGRAM if grams_per_unit is not None else None


def harvest_number(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return format(value.quantize(DISPLAY_PRECISION, rounding=ROUND_HALF_UP).normalize(), "f")


def eligible_harvest_plans(project_id: int, crop_id: int, day: date) -> QuerySet[PlantingPlan]:
    """Plans in the record's season or physically occupying a bed on its date."""
    return (
        PlantingPlan.objects.filter(
            project_id=project_id,
            crop_id=crop_id,
            season__deleted_at__isnull=True,
        )
        .alias(occupied_until=PlantingPlan.occupancy_end_expression())
        .filter(
            Q(season__start_date__lte=day, season__end_date__gte=day)
            | Q(bed__isnull=False, planting_date__lte=day, occupied_until__gte=day)
        )
    )


def harvest_plan_sort_key(plan: PlantingPlan, day: date) -> tuple[int, int]:
    start = plan.harvest_date
    end = plan.harvest_end_date
    if start and end and start <= day <= end:
        return 0, plan.pk
    nearest = min(
        (abs((day - value).days) for value in (start, end) if value), default=date.max.toordinal()
    )
    return nearest, plan.pk


@dataclass
class HarvestTotals:
    quantities: dict[str, Decimal] = field(default_factory=lambda: defaultdict(Decimal))
    measured_kg: Decimal = Decimal(0)
    estimated_kg: Decimal = Decimal(0)
    has_measured: bool = False
    has_estimated: bool = False
    has_unconvertible: bool = False

    def add(self, quantity: Decimal, unit: str, grams_per_unit: Decimal | None) -> None:
        measured = measured_weight_kg(quantity, unit)
        if measured is not None:
            self.quantities[HarvestUnit.KILOGRAM] += measured
            self.measured_kg += measured
            self.has_measured = True
            return
        self.quantities[unit] += quantity
        estimated = estimated_weight_kg(quantity, grams_per_unit)
        if estimated is not None:
            self.estimated_kg += estimated
            self.has_estimated = True
        else:
            self.has_unconvertible = True

    def quantities_payload(self) -> list[dict[str, str | None]]:
        return [
            {"unit": unit, "quantity": harvest_number(self.quantities[unit])}
            for unit in (HarvestUnit.KILOGRAM, HarvestUnit.PIECE, HarvestUnit.BUNCH)
            if unit in self.quantities
        ]

    def weight_payload(self) -> dict[str, str | bool | None]:
        return {
            "measured_kg": harvest_number(self.measured_kg) if self.has_measured else None,
            "estimated_kg": harvest_number(self.estimated_kg) if self.has_estimated else None,
            "has_unconvertible_quantity": self.has_unconvertible,
        }


def plan_harvest_totals(
    plan: PlantingPlan,
    totals: HarvestTotals,
    season: Season | None,
    crop_index: GeneralCropIndex,
    *,
    comparable_crop: bool = True,
) -> dict:
    """Compare recorded totals with the original forecast in a matching period."""
    start, end = plan.harvest_date, plan.harvest_end_date
    has_window = start is not None and end is not None and start < end
    matches_period = has_window and (
        season is None or (season.start_date <= start and end <= season.end_date)
    )
    forecast = (
        compute_plan_expected_yield(plan, crop_index).kilograms
        if matches_period and comparable_crop
        else None
    )
    convertible = bool(totals.quantities) and not totals.has_unconvertible
    actual = totals.measured_kg + totals.estimated_kg if convertible else None
    area = plan.area_usage_sqm
    return {
        "quantities": totals.quantities_payload(),
        **totals.weight_payload(),
        "forecast_kg": harvest_number(forecast),
        "actual_kg_per_sqm": harvest_number(actual / area) if actual is not None and area else None,
        "forecast_percentage": (
            harvest_number(actual / forecast * 100) if actual is not None and forecast else None
        ),
    }
