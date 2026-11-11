"""Weather-independent germination hints and expected emergence for planting plans."""

from datetime import date, timedelta
from typing import Any

from farm.models import PlantingPlan
from farm.services.crop_inheritance import resolve_crop_field, resolve_effective_timing_window_list
from farm.services.timing_window_check import TimingWindowChecker, plan_uses_own_propagation
from farm.services.timing_windows import any_window_contains


def add_days(day: date, days: int | None) -> str | None:
    if days is None:
        return None
    try:
        return (day + timedelta(days=days)).isoformat()
    except OverflowError:
        return None


def check_germination(plan: PlantingPlan, checker: TimingWindowChecker) -> dict[str, Any]:
    """Use the timing check's request-wide indexes; never add per-plan queries."""
    result: dict[str, Any] = {"germination_findings": [], "expected_emergence": None}
    crop = plan.crop
    if crop is None or plan.cultivation_type == PlantingPlan.CULTIVATION_TYPE_PURCHASED_TRANSPLANT:
        return result
    index = checker.general_crop_index
    propagation = resolve_crop_field(crop, "propagation_duration_days", index)
    maximum = resolve_crop_field(crop, "germination_days_max", index)
    own_propagation = plan_uses_own_propagation(plan, crop, index)
    if (
        own_propagation
        and propagation is not None
        and maximum is not None
        and propagation < maximum
    ):
        result["germination_findings"].append({"code": "propagation_shorter_than_germination"})
    sowing = plan.planting_date
    if sowing is None or (own_propagation and propagation is None):
        return result
    if own_propagation:
        sowing_iso = add_days(sowing, -propagation)
        if sowing_iso is None:
            return result
        sowing = date.fromisoformat(sowing_iso)
    requirement = resolve_crop_field(crop, "germination_temperature_requirement", index)
    if requirement in {"cold_stratification", "frost_treatment"} and 4 <= sowing.month <= 8:
        kind = "pre_cultivation" if own_propagation else "direct_sowing"
        windows = [
            window
            for window in resolve_effective_timing_window_list(
                crop,
                checker.windows,
                index,
            )
            if window.kind == kind
        ]
        if not any_window_contains(windows, sowing):
            result["germination_findings"].append({"code": "cold_period_required"})
    minimum = resolve_crop_field(crop, "germination_days_min", index)
    first = add_days(sowing, minimum if minimum is not None else maximum)
    last = add_days(sowing, maximum if maximum is not None else minimum)
    if first is not None and last is not None:
        result["expected_emergence"] = {"min": first, "max": last}
    return result
