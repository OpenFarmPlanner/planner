"""Portable plant-health selections; prose and names are separate contracts."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from django.core.exceptions import ValidationError

MAX_HEALTH_NAME_LENGTH = 200


def _normalize_entry(item: Any) -> dict[str, str]:
    if not isinstance(item, dict) or set(item) - {"name", "catalogue_identity"}:
        raise ValidationError(
            "Each entry contains a name and optionally a catalogue_identity UUID."
        )
    name = item.get("name", "")
    if not isinstance(name, str) or len(name) > MAX_HEALTH_NAME_LENGTH:
        raise ValidationError(
            f"Entry names must be text of at most {MAX_HEALTH_NAME_LENGTH} characters."
        )
    entry = {"name": " ".join(name.split())}
    identity = item.get("catalogue_identity")
    if identity is not None:
        if not isinstance(identity, str):
            raise ValidationError("Catalogue identities must be UUID strings.")
        try:
            entry["catalogue_identity"] = str(UUID(identity))
        except ValueError as exc:
            raise ValidationError("Catalogue identities must be UUID strings.") from exc
    elif not entry["name"]:
        raise ValidationError("A local entry needs a nonempty name.")
    return entry


def normalize_plant_health(value: Any) -> dict[str, list[dict[str, str]]] | None:
    """Normalize explicit selections without inferring identities from their names.

    Null means unspecified/inherit. An object with an empty entries list is an
    explicit empty override, including on a variety. A catalogue UUID and a
    local name remain different selections even when their labels agree.
    """
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {"entries"}:
        raise ValidationError("Expected an object containing only an entries list, or null.")
    entries = value["entries"]
    if not isinstance(entries, list):
        raise ValidationError("Provide a list of entries.")
    normalized: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in entries:
        entry = _normalize_entry(item)
        key = (
            ("catalogue", entry["catalogue_identity"])
            if "catalogue_identity" in entry
            else ("local", entry["name"].casefold())
        )
        if key not in seen:
            normalized.append(entry)
            seen.add(key)
    return {"entries": normalized}


def validate_plant_health_value(value: Any) -> None:
    """Model-field validator shared with serializer and import validation."""
    normalize_plant_health(value)


def official_plant_health(value: Any) -> dict[str, list[dict[str, str]]] | None:
    normalized = normalize_plant_health(value)
    if normalized is None:
        return None
    entries = [
        item for item in normalized["entries"] if "catalogue_identity" in item
    ]
    return {"entries": entries}


def plant_health_identities(value: Any) -> tuple[str, ...] | None:
    """Keep override intent; ignore order, private names and snapshot spelling."""
    official = official_plant_health(value)
    if official is None:
        return None
    return tuple(sorted(
        item["catalogue_identity"]
        for item in official["entries"]
    ))


def merge_official_plant_health(local_value: Any, public_value: Any) -> dict | None:
    """Replace only official references; never drop unresolved project names."""
    local = normalize_plant_health(local_value)
    official = official_plant_health(public_value)
    private = [
        item for item in (local or {}).get("entries", []) if "catalogue_identity" not in item
    ]
    if official is None and not private:
        return None
    return normalize_plant_health({"entries": [*private, *(official or {}).get("entries", [])]})


def validate_public_plant_health_value(value: Any) -> None:
    normalized = normalize_plant_health(value)
    if any("catalogue_identity" not in item for item in (normalized or {}).get("entries", [])):
        raise ValidationError(
            "Public plant-health selections require explicit catalogue identities."
        )
