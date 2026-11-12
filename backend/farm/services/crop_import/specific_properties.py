"""Fold ordinary spreadsheet columns into the typed record-local dictionary."""

import copy
from typing import Any

from rest_framework import serializers

from crops.models import CropSpecies
from crops.services import find_species_by_common_name
from crops.specific_properties import specific_property_errors
from farm.models import Crop

PROPERTY_COLUMN_PREFIX = "specific_properties."


class SpecificPropertyImportError(serializers.ValidationError):
    default_code = "specific_properties_invalid"


def apply_specific_property_cells(data: dict[str, Any], existing: Crop | None = None) -> None:
    columns = {
        key.removeprefix(PROPERTY_COLUMN_PREFIX): data.pop(key)
        for key in list(data)
        if key.startswith(PROPERTY_COLUMN_PREFIX)
    }
    if not columns and "specific_properties" not in data:
        return
    # Explicit JSON replaces; ordinary nonempty sheet cells merge. Empty sheet
    # cells never arrive here, so they cannot erase other stored properties.
    properties = copy.deepcopy(
        data.get("specific_properties", existing.specific_properties if existing else {})
    )
    if isinstance(properties, dict):
        properties.update(columns)
    if "crop_species" in data:
        species = (
            CropSpecies.objects.filter(pk=data["crop_species"]).first()
            if data["crop_species"]
            else None
        )
    elif existing is not None:
        species = existing.crop_species
    else:
        species = find_species_by_common_name(data.get("name"))
    errors = specific_property_errors(properties, getattr(species, "specific_property_profile", ""))
    if errors:
        raise SpecificPropertyImportError({"specific_properties": errors})
    data["specific_properties"] = properties
    if species is not None and existing is None:
        data["crop_species"] = species.pk
