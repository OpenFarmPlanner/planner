"""Shared crop germination field contracts and validation."""

import math
from collections.abc import Callable, Collection, Mapping
from typing import Any

GERMINATION_TYPES = ("cold", "frost", "light", "dark")
TEMPERATURE_REQUIREMENT_CHOICES = (
    ("", "Unknown"),
    ("none", "None"),
    ("cold_stratification", "Cold stratification"),
    ("frost_treatment", "Frost treatment"),
)
LIGHT_REQUIREMENT_CHOICES = (
    ("", "Unknown"),
    ("none", "Light-independent"),
    ("light", "Light germinator"),
    ("dark", "Dark germinator"),
)
REQUIREMENT_LEGACY_VALUES = {
    "germination_temperature_requirement": {
        "cold_stratification": "cold",
        "frost_treatment": "frost",
    },
    "germination_light_requirement": {"light": "light", "dark": "dark"},
}
STRATIFICATION_FIELDS = (
    "stratification_days_min",
    "stratification_days_max",
    "stratification_temperature_min_c",
    "stratification_temperature_max_c",
)
GERMINATION_NUMBER_FIELDS = (
    "germination_temperature_optimal_min_c",
    "germination_temperature_optimal_max_c",
    "germination_temperature_min_c",
    "germination_days_min",
    "germination_days_max",
    *STRATIFICATION_FIELDS,
)
GERMINATION_FIELDS = (
    *GERMINATION_NUMBER_FIELDS,
    *REQUIREMENT_LEGACY_VALUES,
    "germination_types",
    "germination_pretreatment",
)


def requirement_from_legacy(types: list[Any], field: str, *, override_missing: bool = False) -> str:
    """Do not guess between conflicting historical flags; preserve their list."""
    selected = [
        value for value, legacy in REQUIREMENT_LEGACY_VALUES[field].items() if legacy in types
    ]
    return (
        selected[0] if len(selected) == 1 else ("none" if not selected and override_missing else "")
    )


def _legacy_axis_changed(
    old_legacy: list[Any],
    legacy: list[Any],
    mapping: Mapping[str, str],
    previous_value: str | None,
    legacy_variety: bool,
) -> bool:
    old_axis = [kind for kind in mapping.values() if kind in old_legacy]
    new_axis = [kind for kind in mapping.values() if kind in legacy]
    override_started = bool(
        legacy_variety and legacy and legacy != old_legacy and not new_axis and not previous_value
    )
    return old_axis != new_axis or override_started


def complete_germination_write(
    values: dict[str, Any],
    instance: Any = None,
    *,
    legacy_variety: bool | None = None,
) -> None:
    """Accept deprecated list writes while canonical enum changes take precedence.

    An unchanged unknown enum does not erase conflicting historical flags.
    The legacy field can be removed only after old clients and conflicts are gone.
    """

    def previous(field: str) -> Any:
        return (
            instance.get(field) if isinstance(instance, Mapping) else getattr(instance, field, None)
        )

    legacy = values.get("germination_types", previous("germination_types") or [])
    if not isinstance(legacy, list):
        return
    if legacy_variety is None:
        legacy_variety = bool(
            values.get("variety", previous("variety"))
            and values.get("crop_species", previous("crop_species_id"))
        )
    changed = False
    for field, mapping in REQUIREMENT_LEGACY_VALUES.items():
        if field in values:
            if values[field] == "" and sum(kind in legacy for kind in mapping.values()) > 1:
                # Portable historical conflicts retain their original flags.
                continue
            legacy = [kind for kind in legacy if kind not in mapping.values()]
            if values[field] in mapping:
                legacy.append(mapping[values[field]])
            changed = True
        elif "germination_types" in values:
            old_legacy = previous("germination_types") or []
            if instance is None or _legacy_axis_changed(
                old_legacy,
                legacy,
                mapping,
                previous(field),
                legacy_variety,
            ):
                values[field] = requirement_from_legacy(
                    legacy, field, override_missing=bool(legacy_variety and legacy)
                )
    if changed:
        values["germination_types"] = legacy


def project_legacy_requirements(temperature: str, light: str, legacy: list[Any]) -> list[str]:
    """Project independently inherited axes for old readers; retain conflicts."""
    result = []
    for field, value in zip(REQUIREMENT_LEGACY_VALUES, (temperature, light), strict=True):
        mapping = REQUIREMENT_LEGACY_VALUES[field]
        if value in mapping:
            result.append(mapping[value])
        elif not value:
            flags = [kind for kind in mapping.values() if kind in legacy]
            if len(flags) > 1:
                result.extend(flags)
    return result


def sync_germination_requirements(
    instance: Any,
    previous: Mapping[str, Any] | None,
    update_fields: Collection[str] | None = None,
) -> set[str]:
    """Keep model/admin/fixture writes compatible, including partial saves."""
    fields = ("germination_types", *REQUIREMENT_LEGACY_VALUES)
    values = {
        field: getattr(instance, field)
        for field in fields
        if (update_fields is None or field in update_fields)
        and (
            getattr(instance, field) != previous.get(field)
            if previous is not None
            else bool(getattr(instance, field))
        )
    }
    if not values:
        return set()
    # Canonical clients control both independent axes. Do not mistake their
    # compatibility projection for an old client's whole-list override.
    if any(field in values for field in REQUIREMENT_LEGACY_VALUES):
        guarded_axes = set()
        for field in REQUIREMENT_LEGACY_VALUES:
            if update_fields is not None and previous is not None and field not in update_fields:
                values[field] = previous.get(field, "")
                guarded_axes.add(field)
            else:
                values[field] = getattr(instance, field)
    else:
        guarded_axes = set()
    complete_germination_write(
        values,
        previous,
        legacy_variety=bool(instance.variety and instance.crop_species_id),
    )
    for field in guarded_axes:
        values.pop(field, None)
    changed = {field for field, value in values.items() if getattr(instance, field) != value}
    for field, value in values.items():
        setattr(instance, field, value)
    return changed


def upgrade_germination_snapshot(snapshot: Mapping[str, Any]) -> dict[str, Any]:
    """Interpret immutable historical revisions without rewriting their data."""
    result = dict(snapshot)
    legacy = result.get("germination_types") or []
    result["germination_types"] = legacy
    for field in REQUIREMENT_LEGACY_VALUES:
        result.setdefault(
            field,
            requirement_from_legacy(
                legacy,
                field,
                override_missing=bool(
                    legacy
                    and snapshot.get("variety")
                    and (snapshot.get("crop_species_id") or snapshot.get("crop_species"))
                ),
            ),
        )
    for field in GERMINATION_NUMBER_FIELDS:
        result.setdefault(field, None)
    result.setdefault("germination_pretreatment", "")
    return result


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
        ("stratification_days_min", "stratification_days_max"),
        ("stratification_temperature_min_c", "stratification_temperature_max_c"),
    ):
        if value(lower) is not None and value(upper) is not None and value(lower) > value(upper):
            errors[upper] = "The maximum must be greater than or equal to the minimum."
    errors.update(_requirement_errors(value))
    return errors


def _requirement_errors(value: Callable[[str], Any]) -> dict[str, str]:
    """Validate canonical enums and the retained legacy list."""
    errors = {}
    for field, choices in (
        ("germination_temperature_requirement", TEMPERATURE_REQUIREMENT_CHOICES),
        ("germination_light_requirement", LIGHT_REQUIREMENT_CHOICES),
    ):
        if value(field) not in (None, *(choice[0] for choice in choices)):
            errors[field] = "Choose a supported germination requirement."
    types = value("germination_types")
    if types is not None and (
        not isinstance(types, list)
        or any(item not in GERMINATION_TYPES for item in types)
        or len(set(types)) != len(types)
    ):
        errors["germination_types"] = "Choose unique supported germination types."
    return errors
