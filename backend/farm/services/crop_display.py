from __future__ import annotations

from crops.models import CropSpecies
from farm.models import Crop


def resolve_crop_display_name(
    crop: Crop,
    language_code: str,
    region: str | None = None,
) -> tuple[str | None, str]:
    """Return the localized display name for a project crop.

    Project crop identity stays stored on ``Crop.name``. When the crop
    is linked to a language-independent crop species, read-only UI surfaces can
    display the species translation that matches the active UI language.
    """
    species: CropSpecies | None = crop.crop_species
    if species is None:
        return crop.name, ''
    # Only a published species carries an authoritative, moderator-approved
    # name. A still-proposed species has no official translations yet, and a
    # rejected one keeps whatever free-text name the proposer typed (which can
    # be an unrelated placeholder). In both cases the crop's own name is the
    # correct thing to show.
    if species.status != CropSpecies.STATUS_PUBLISHED:
        return crop.name, ''
    return species.localized_name(language_code, region)


def format_crop_label(crop: Crop, language_code: str, region: str | None = None) -> str:
    """The localized display name with the variety, as findings name a culture."""
    display_name, _ = resolve_crop_display_name(crop, language_code, region)
    name = display_name or crop.name
    variety = (crop.variety or '').strip()
    return f'{name} ({variety})' if name and variety else (name or variety)
