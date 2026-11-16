"""Private crop selections: project-local spelling reuse and catalogue references."""

from __future__ import annotations

from typing import Any

from django.core.exceptions import ValidationError

from crops.plant_health_models import PlantHealthEntry
from crops.plant_health_values import normalize_plant_health
from farm.models import Crop


def canonical_plant_health(
    value: Any,
    project_id: int | None,
    *,
    existing_value: Any = None,
) -> dict[str, list[dict[str, str]]] | None:
    """Resolve only explicit UUIDs; local names never create global records.

    Reference names are snapshots for portable files/history, not taxonomic
    matching keys or evidence of a host relationship. Archived identities stay
    portable; other unpublished identities can only be retained on the same row.
    """
    result = normalize_plant_health(value)
    if result is None or not result["entries"]:
        return result
    previous = normalize_plant_health(existing_value)
    retained = {
        item["catalogue_identity"]: item["name"]
        for item in (previous or {}).get("entries", [])
        if "catalogue_identity" in item
    }
    identities = {
        item["catalogue_identity"] for item in result["entries"] if "catalogue_identity" in item
    }
    catalogue = (
        {
            str(entry.identity_key): entry
            for entry in PlantHealthEntry.objects.filter(identity_key__in=identities)
        }
        if identities
        else {}
    )
    spellings: dict[str, str] = {}
    if project_id is not None and any(
        "catalogue_identity" not in item for item in result["entries"]
    ):
        values = Crop.objects.filter(project_id=project_id).exclude(plant_health__isnull=True)
        for stored in values.order_by("pk").values_list("plant_health", flat=True):
            for item in (stored or {}).get("entries", []):
                if "catalogue_identity" not in item:
                    name = " ".join(item["name"].split())
                    spellings.setdefault(name.casefold(), name)
    for item in result["entries"]:
        identity = item.get("catalogue_identity")
        if identity is None:
            item["name"] = spellings.get(item["name"].casefold(), item["name"])
            continue
        entry = catalogue.get(identity)
        if entry is None or (
            entry.status
            not in {PlantHealthEntry.STATUS_PUBLISHED, PlantHealthEntry.STATUS_ARCHIVED}
            and identity not in retained
        ):
            raise ValidationError(
                "A selected catalogue identity is unavailable; review its mapping."
            )
        # Keep an existing snapshot across later catalogue renames and restores.
        item["name"] = retained.get(identity) or entry.name
    return result
