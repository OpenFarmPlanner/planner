"""Private crop selections: project-local spelling reuse and catalogue references."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from django.core.exceptions import ValidationError
from rest_framework.exceptions import APIException

from crops.plant_health_models import PlantHealthEntry
from crops.plant_health_values import normalize_plant_health, validate_public_plant_health_value
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


def canonical_public_plant_health(value: Any, *, existing_value: Any = None) -> dict | None:
    validate_public_plant_health_value(value)
    return canonical_plant_health(value, None, existing_value=existing_value)


def publication_plant_health(value: Any, *, existing_value: Any = None) -> tuple[dict | None, int]:
    """Keep unresolved names private; retain portable, previously approved identities."""
    normalized = normalize_plant_health(value)
    entries = (normalized or {}).get("entries", [])
    previous = normalize_plant_health(existing_value)
    retained = {
        item["catalogue_identity"]: item["name"]
        for item in (previous or {}).get("entries", []) if "catalogue_identity" in item
    }
    identities = {item["catalogue_identity"] for item in entries if "catalogue_identity" in item}
    catalogue = {
        str(entry.identity_key): entry
        for entry in PlantHealthEntry.objects.filter(identity_key__in=identities)
    } if identities else {}
    selected = []
    for item in entries:
        identity = item.get("catalogue_identity")
        entry = catalogue.get(identity)
        if entry is not None and (
            entry.status in {PlantHealthEntry.STATUS_PUBLISHED, PlantHealthEntry.STATUS_ARCHIVED}
            or identity in retained
        ):
            selected.append({
                "name": retained.get(identity) or entry.name, "catalogue_identity": identity,
            })
    return ({"entries": selected} if selected else None), len(entries) - len(selected)


class PlantHealthMappingConflict(APIException):
    status_code = 409

    def __init__(self):
        super().__init__({
            "code": "plant_health_mapping_conflict",
            "detail": "The crop or selected local name changed; reload before mapping it.",
        })


def map_crop_plant_health(
    crop: Crop, *, expected_updated_at: datetime, mappings: list[dict[str, Any]],
) -> Crop:
    from farm.services.crop_inheritance import crop_identity_write, resolve_crop_field

    with crop_identity_write(crop.project_id):
        crop.refresh_from_db()
        if crop.updated_at != expected_updated_at:
            raise PlantHealthMappingConflict()
        effective = normalize_plant_health(resolve_crop_field(crop, "plant_health"))
        entries = (effective or {}).get("entries", [])
        names = {item["name"].casefold() for item in entries if "catalogue_identity" not in item}
        requested = {
            " ".join(item["local_name"].split()).casefold(): str(item["catalogue_identity"])
            for item in mappings
        }
        if not requested.keys() <= names:
            raise PlantHealthMappingConflict()
        approved = {
            str(entry.identity_key): entry
            for entry in PlantHealthEntry.objects.select_for_update().filter(
                identity_key__in=set(requested.values()), status=PlantHealthEntry.STATUS_PUBLISHED,
            ).order_by("pk")
        }
        if set(requested.values()) != approved.keys():
            raise ValidationError(
                "Choose a currently approved catalogue identity for each mapping."
            )
        mapped = []
        for item in entries:
            identity = (
                requested.get(item["name"].casefold()) if "catalogue_identity" not in item else None
            )
            mapped.append(
                {"name": approved[identity].name, "catalogue_identity": identity}
                if identity else item
            )
        crop.plant_health = canonical_plant_health(
            {"entries": mapped}, crop.project_id, existing_value=crop.plant_health,
        )
        crop.save()
        return crop
