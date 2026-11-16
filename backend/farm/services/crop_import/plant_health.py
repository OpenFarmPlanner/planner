"""Parse only the new explicitly structured plant-health spreadsheet column."""

import json
from typing import Any

from django.core.exceptions import ValidationError
from rest_framework import serializers

from farm.services.crop_plant_health import canonical_plant_health


def apply_plant_health_cell(data: dict[str, Any], project_id: int, existing=None) -> None:
    """Blank/absent cells stay absent; JSON null inherits, [] clears selections.

    JSON supplies escaping for commas, semicolons, quotes and newlines inside
    one individual name. The legacy pests_diseases header never reaches here.
    """
    if "plant_health" not in data:
        return
    value = data["plant_health"]
    try:
        if isinstance(value, str):
            if len(value) > 20000:
                raise ValidationError("The structured plant-health cell is too large.")
            value = json.loads(value)
            if isinstance(value, list):
                value = {
                    "entries": [{"name": item} if isinstance(item, str) else item for item in value]
                }
        data["plant_health"] = canonical_plant_health(
            value,
            project_id,
            existing_value=getattr(existing, "plant_health", None),
        )
    except (ValueError, RecursionError, ValidationError) as error:
        messages = (
            error.messages
            if isinstance(error, ValidationError)
            else ["Expected a JSON list, selections object or null."]
        )
        raise serializers.ValidationError({"plant_health": messages}) from error
