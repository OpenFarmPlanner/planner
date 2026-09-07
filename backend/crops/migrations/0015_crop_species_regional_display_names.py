"""Seed the regional display names for Austrian and Swiss projects.

`0014_crop_species_search_aliases` seeded the search-only aliases. This adds the
other half: the terms a region actually uses, which replace the canonical name
for projects whose `Project.region` matches. See
docs/crop-taxonomy-guidelines.md §4 — an ambiguous term such as "Peperoni" is
deliberately not among them.
"""
from django.db import migrations


def _normalized(value):
    from farm.utils import normalize_text

    return normalize_text(value) or ''


def _build_search_text(common_name, synonyms, regional_names):
    terms = [common_name]
    terms.extend(item for item in synonyms if isinstance(item, str))
    terms.extend(item for item in regional_names.values() if isinstance(item, str))
    normalized_terms = []
    for term in terms:
        normalized = _normalized(term)
        if normalized:
            normalized_terms.append(normalized)
    return (
        '\n' + '\n'.join(dict.fromkeys(normalized_terms)) + '\n'
        if normalized_terms
        else ''
    )


def _seeded_translations(apps):
    """Yield ``(translation, seeded_regional_names)`` for every seeded entry."""
    from crops.seed_data import (
        CROP_SPECIES_REGIONAL_NAME_SEED_DATA,
        CROP_SPECIES_SEED_DATA,
        get_crop_species_seed_name,
    )

    CropSpecies = apps.get_model('crops', 'CropSpecies')
    CropSpeciesTranslation = apps.get_model('crops', 'CropSpeciesTranslation')

    entries_by_key = {entry.key: entry for entry in CROP_SPECIES_SEED_DATA}
    for key, regional_names_by_language in CROP_SPECIES_REGIONAL_NAME_SEED_DATA.items():
        entry = entries_by_key.get(key)
        if entry is None:
            continue
        species = CropSpecies.objects.filter(
            name_normalized=_normalized(get_crop_species_seed_name(entry, 'de')),
        ).first()
        if species is None:
            continue
        for language_code, regional_names in regional_names_by_language.items():
            translation = CropSpeciesTranslation.objects.filter(
                species=species, language_code=language_code,
            ).first()
            if translation is not None:
                yield translation, regional_names


def _save_regional_names(translation, regional_names):
    synonyms = translation.synonyms if isinstance(translation.synonyms, list) else []
    translation.regional_names = regional_names
    translation.search_text_normalized = _build_search_text(
        translation.common_name, synonyms, regional_names,
    )
    translation.save(update_fields=['regional_names', 'search_text_normalized'])


def seed_crop_species_regional_names(apps, schema_editor):
    for translation, seeded in _seeded_translations(apps):
        # Merged, not replaced: a regional name curated outside the seed list
        # (0008 added Melanzani before the seed list carried it) must survive.
        stored = (
            translation.regional_names
            if isinstance(translation.regional_names, dict)
            else {}
        )
        merged = {**stored, **seeded}
        if merged != stored:
            _save_regional_names(translation, merged)


def remove_crop_species_regional_names(apps, schema_editor):
    """Drop the seeded regional names again; hand-curated ones stay."""
    for translation, seeded in _seeded_translations(apps):
        stored = (
            translation.regional_names
            if isinstance(translation.regional_names, dict)
            else {}
        )
        kept = {
            region: name
            for region, name in stored.items()
            if seeded.get(region) != name
        }
        if kept != stored:
            _save_regional_names(translation, kept)


class Migration(migrations.Migration):

    dependencies = [
        ('crops', '0014_crop_species_search_aliases'),
    ]

    operations = [
        migrations.RunPython(
            seed_crop_species_regional_names,
            remove_crop_species_regional_names,
        ),
    ]
