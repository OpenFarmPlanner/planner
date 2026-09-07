"""Seed regional/colloquial search aliases and the two species they must not merge into.

Aliases are matching-only names on `CropSpeciesTranslation.synonyms`; the new
`Pfefferoni`, `Puntarelle`, `Schnittkohl` and `Zuckererbse` species exist
because those are functionally distinct crops rather than regional names for
Paprika, Chicorée, Grünkohl or Erbse. See the criterion documented on
`crops.seed_data.CROP_SPECIES_SYNONYM_SEED_DATA`.
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


def _find_species(apps, entry):
    from crops.seed_data import get_crop_species_seed_name

    CropSpecies = apps.get_model('crops', 'CropSpecies')
    CropSpeciesTranslation = apps.get_model('crops', 'CropSpeciesTranslation')

    german_name = get_crop_species_seed_name(entry, 'de')
    species = CropSpecies.objects.filter(name_normalized=_normalized(german_name)).first()
    if species is not None:
        return species
    translation = (
        CropSpeciesTranslation.objects
        .filter(common_name_normalized__in=[
            _normalized(name) for name in entry.translations.values()
        ])
        .select_related('species')
        .first()
    )
    return translation.species if translation is not None else None


def _create_species(apps, entry):
    from crops.seed_data import get_crop_species_seed_name

    CropSpecies = apps.get_model('crops', 'CropSpecies')
    CropSpeciesTranslation = apps.get_model('crops', 'CropSpeciesTranslation')

    german_name = get_crop_species_seed_name(entry, 'de')
    species = CropSpecies.objects.create(
        name=german_name,
        name_normalized=_normalized(german_name),
        scientific_name=entry.scientific_name,
        family=entry.family,
        categories=list(entry.categories),
        status='published',
    )
    for language_code, common_name in entry.translations.items():
        CropSpeciesTranslation.objects.create(
            species=species,
            language_code=language_code,
            common_name=common_name,
            common_name_normalized=_normalized(common_name),
            search_text_normalized=_build_search_text(common_name, [], {}),
        )
    return species


def _write_synonyms(translation, synonyms):
    stored = translation.synonyms if isinstance(translation.synonyms, list) else []
    regional_names = (
        translation.regional_names if isinstance(translation.regional_names, dict) else {}
    )
    merged = list(stored)
    seen = {item.casefold() for item in merged if isinstance(item, str)}
    for synonym in synonyms:
        if synonym.casefold() not in seen:
            merged.append(synonym)
            seen.add(synonym.casefold())
    if merged == stored:
        return
    translation.synonyms = merged
    translation.regional_names = regional_names
    translation.search_text_normalized = _build_search_text(
        translation.common_name, merged, regional_names,
    )
    translation.save(update_fields=['synonyms', 'regional_names', 'search_text_normalized'])


def seed_crop_species_search_aliases(apps, schema_editor):
    from crops.seed_data import CROP_SPECIES_SEED_DATA, CROP_SPECIES_SYNONYM_SEED_DATA

    CropSpeciesTranslation = apps.get_model('crops', 'CropSpeciesTranslation')

    for entry in CROP_SPECIES_SEED_DATA:
        synonyms_by_language = CROP_SPECIES_SYNONYM_SEED_DATA.get(entry.key, {})
        species = _find_species(apps, entry)
        if species is None:
            # Only the species newly added to the seed list are missing here;
            # everything else was created by 0002/0006/0010.
            species = _create_species(apps, entry)
        for language_code, synonyms in synonyms_by_language.items():
            common_name = entry.translations.get(language_code)
            if not common_name:
                continue
            translation, _created = CropSpeciesTranslation.objects.get_or_create(
                species=species,
                language_code=language_code,
                defaults={
                    'common_name': common_name,
                    'common_name_normalized': _normalized(common_name),
                },
            )
            _write_synonyms(translation, list(synonyms))


def remove_crop_species_search_aliases(apps, schema_editor):
    """Drop the seeded aliases again; species and hand-curated aliases stay.

    Species are deliberately not deleted: published crops may already link to
    them, and a species row is not what this migration is reversing.
    """
    from crops.seed_data import CROP_SPECIES_SEED_DATA, CROP_SPECIES_SYNONYM_SEED_DATA

    for entry in CROP_SPECIES_SEED_DATA:
        synonyms_by_language = CROP_SPECIES_SYNONYM_SEED_DATA.get(entry.key, {})
        if not synonyms_by_language:
            continue
        species = _find_species(apps, entry)
        if species is None:
            continue
        for language_code, synonyms in synonyms_by_language.items():
            translation = species.translations.filter(language_code=language_code).first()
            if translation is None:
                continue
            seeded = {synonym.casefold() for synonym in synonyms}
            stored = translation.synonyms if isinstance(translation.synonyms, list) else []
            kept = [
                item for item in stored
                if not (isinstance(item, str) and item.casefold() in seeded)
            ]
            if kept == stored:
                continue
            regional_names = (
                translation.regional_names
                if isinstance(translation.regional_names, dict)
                else {}
            )
            translation.synonyms = kept
            translation.search_text_normalized = _build_search_text(
                translation.common_name, kept, regional_names,
            )
            translation.save(
                update_fields=['synonyms', 'search_text_normalized'],
            )


class Migration(migrations.Migration):

    dependencies = [
        ('crops', '0013_replace_generic_fennel_species'),
    ]

    operations = [
        migrations.RunPython(
            seed_crop_species_search_aliases,
            remove_crop_species_search_aliases,
        ),
    ]
