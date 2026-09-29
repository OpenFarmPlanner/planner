"""Seed the smooth/curly endive names as search aliases of Endivie.

Eskariol/Escariol (smooth) and Frisée (curly) are the same species,
Cichorium endivia, with the same harvest logic, so they are aliases rather
than species of their own; see docs/crop-taxonomy-guidelines.md §3.
Chicorée and Radicchio are deliberately untouched.

The alias list is written out here instead of read from `crops.seed_data`, so
this migration keeps doing the same thing when the seed list changes later.
"""
from django.db import migrations

ENDIVE_NAME = 'Endivie'
ADDED_ENDIVE_SYNONYMS = ('Eskariol', 'Frisée', 'Frisee', 'Endiviensalat')


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


def _endive_translation(apps):
    CropSpeciesTranslation = apps.get_model('crops', 'CropSpeciesTranslation')
    return (
        CropSpeciesTranslation.objects
        .filter(
            species__name_normalized=_normalized(ENDIVE_NAME),
            language_code='de',
        )
        .first()
    )


def _save_synonyms(translation, synonyms):
    regional_names = (
        translation.regional_names if isinstance(translation.regional_names, dict) else {}
    )
    translation.synonyms = synonyms
    translation.search_text_normalized = _build_search_text(
        translation.common_name, synonyms, regional_names,
    )
    translation.save(update_fields=['synonyms', 'search_text_normalized'])


def add_endive_aliases(apps, schema_editor):
    translation = _endive_translation(apps)
    if translation is None:
        return
    stored = translation.synonyms if isinstance(translation.synonyms, list) else []
    merged = list(stored)
    seen = {item.casefold() for item in merged if isinstance(item, str)}
    for synonym in ADDED_ENDIVE_SYNONYMS:
        if synonym.casefold() not in seen:
            merged.append(synonym)
            seen.add(synonym.casefold())
    if merged != stored:
        _save_synonyms(translation, merged)


def remove_endive_aliases(apps, schema_editor):
    translation = _endive_translation(apps)
    if translation is None:
        return
    added = {synonym.casefold() for synonym in ADDED_ENDIVE_SYNONYMS}
    stored = translation.synonyms if isinstance(translation.synonyms, list) else []
    kept = [
        item for item in stored
        if not (isinstance(item, str) and item.casefold() in added)
    ]
    if kept != stored:
        _save_synonyms(translation, kept)


class Migration(migrations.Migration):

    dependencies = [
        ('crops', '0015_crop_species_regional_display_names'),
    ]

    operations = [
        migrations.RunPython(add_endive_aliases, remove_endive_aliases),
    ]
