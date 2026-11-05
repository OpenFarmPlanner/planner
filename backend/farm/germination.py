"""Shared crop germination field contracts and validation."""

import math
from typing import Any

GERMINATION_TYPES = ("cold", "frost", "light", "dark")
GERMINATION_NUMBER_FIELDS = (
    "germination_temperature_optimal_min_c",
    "germination_temperature_optimal_max_c",
    "germination_temperature_min_c",
    "germination_days_min",
    "germination_days_max",
)
GERMINATION_FIELDS = (*GERMINATION_NUMBER_FIELDS, "germination_types", "germination_pretreatment")


def germination_errors(instance: Any, values: dict[str, Any] | None = None) -> dict[str, str]:
    """Validate supplied values against the stored row, including partial updates."""
    values = values or {}

    def value(field: str) -> Any:
        return values.get(field, getattr(instance, field, None))

    errors: dict[str, str] = {}
    for field in GERMINATION_NUMBER_FIELDS:
        number = value(field)
        if number is None:
            continue
        minimum = 0 if "days" in field else -273.15
        if not math.isfinite(number) or number < minimum:
            errors[field] = "Enter a finite number within the valid range."
        elif "days" in field and number != int(number):
            errors[field] = "Germination time must be a whole number of days."
    for lower, upper in (
        ("germination_temperature_optimal_min_c", "germination_temperature_optimal_max_c"),
        ("germination_days_min", "germination_days_max"),
    ):
        if value(lower) is not None and value(upper) is not None and value(lower) > value(upper):
            errors[upper] = "The maximum must be greater than or equal to the minimum."
    types = value("germination_types")
    if types is not None and (
        not isinstance(types, list)
        or any(item not in GERMINATION_TYPES for item in types)
        or len(set(types)) != len(types)
    ):
        errors["germination_types"] = "Choose unique supported germination types."
    return errors
