"""Versioned definitions shared with the frontend; species remain database rows."""

import json
import math
from pathlib import Path
from typing import Any

REGISTRY = json.loads(Path(__file__).with_name("specific_properties.v1.json").read_text())
PROPERTY_DEFINITIONS: dict[str, dict[str, Any]] = REGISTRY["properties"]
PROPERTY_PROFILES: dict[str, list[str]] = REGISTRY["profiles"]


def property_definitions(profile: str) -> dict[str, dict[str, Any]]:
    return {key: PROPERTY_DEFINITIONS[key] for key in PROPERTY_PROFILES.get(profile, [])}


def _valid_property_value(value: Any, definition: dict[str, Any]) -> bool:
    kind = definition["type"]
    if kind == "enum":
        return isinstance(value, str) and value in definition["options"]
    if kind == "boolean":
        return isinstance(value, bool)
    if kind == "text":
        return isinstance(value, str) and len(value) <= definition.get("max_length", 1000)
    if kind not in {"number", "integer"} or isinstance(value, bool):
        return False
    if not isinstance(value, int | float) or not math.isfinite(value):
        return False
    return (
        (kind != "integer" or value == int(value))
        and value >= definition.get("minimum", -math.inf)
        and value <= definition.get("maximum", math.inf)
    )


def specific_property_errors(value: Any, profile: str) -> list[str]:
    """JSON writes replace the dictionary; omission preserves existing values."""
    if not isinstance(value, dict):
        return ["Crop-specific properties must be an object."]
    definitions = property_definitions(profile)
    errors = []
    for key, entry in value.items():
        if key not in definitions:
            errors.append(f"Property {key} is not supported for this crop species.")
        elif not _valid_property_value(entry, definitions[key]):
            errors.append(f"Property {key} has an unsupported value or type.")
    return errors


def crop_specific_property_errors(
    instance: Any, values: dict[str, Any] | None = None
) -> dict[str, list[str]]:
    values = values or {}
    properties = values.get("specific_properties", getattr(instance, "specific_properties", {}))
    if isinstance(properties, dict) and not properties:
        return {}
    species = values.get("crop_species", getattr(instance, "crop_species", None))
    errors = specific_property_errors(properties, getattr(species, "specific_property_profile", ""))
    return {"specific_properties": errors} if errors else {}
