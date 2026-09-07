from django.db import migrations

CAULIFLOWER_AUSTRIAN_NAME = 'Karfiol'
CAULIFLOWER_CANONICAL_NAME = 'Blumenkohl'
CAULIFLOWER_ENGLISH_NAME = 'Cauliflower'
CAULIFLOWER_MERGE_NOTE = (
    'Automatically merged: "Karfiol" and "Blumenkohl" are the same crop '
    'species. "Blumenkohl" is the canonical German name; "Karfiol" is kept as '
    'the Austrian regional display name. See docs/crop-taxonomy-guidelines.md.'
)


def _normalized(value):
    from farm.utils import normalize_text

    return normalize_text(value) or ''


def _build_search_text(common_name, synonyms, regional_names):
    from farm.utils import normalize_text

    terms = [common_name]
    terms.extend(item for item in synonyms if isinstance(item, str))
    terms.extend(item for item in regional_names.values() if isinstance(item, str))
    normalized_terms = []
    for term in terms:
        normalized = normalize_text(term)
        if normalized:
            normalized_terms.append(normalized)
    return (
        '\n' + '\n'.join(dict.fromkeys(normalized_terms)) + '\n'
        if normalized_terms
        else ''
    )


def _write_translation(apps, species, language_code, common_name, synonyms, regional_names):
    """Write one translation, merging alias data instead of replacing it.

    Aliases added outside the seed list (an earlier one-off migration, a
    moderator edit) must survive a seed sync, so the seeded values are merged
    into what is already stored rather than overwriting it.
    """
    CropSpeciesTranslation = apps.get_model('crops', 'CropSpeciesTranslation')

    translation = CropSpeciesTranslation.objects.filter(
        species=species, language_code=language_code,
    ).first()
    stored_synonyms = (
        [value for value in translation.synonyms if isinstance(value, str)]
        if translation is not None and isinstance(translation.synonyms, list)
        else []
    )
    stored_regional_names = (
        {
            key: value
            for key, value in translation.regional_names.items()
            if isinstance(value, str)
        }
        if translation is not None and isinstance(translation.regional_names, dict)
        else {}
    )
    merged_synonyms = list(dict.fromkeys([*stored_synonyms, *synonyms]))
    merged_regional_names = {**stored_regional_names, **regional_names}

    CropSpeciesTranslation.objects.update_or_create(
        species=species,
        language_code=language_code,
        defaults={
            'common_name': common_name,
            'common_name_normalized': _normalized(common_name),
            'synonyms': merged_synonyms,
            'regional_names': merged_regional_names,
            'search_text_normalized': _build_search_text(
                common_name, merged_synonyms, merged_regional_names,
            ),
        },
    )


def _rewrite_translation(apps, species, language_code, common_name):
    """Replace a translation's name and drop its alias data (revert path only)."""
    CropSpeciesTranslation = apps.get_model('crops', 'CropSpeciesTranslation')

    CropSpeciesTranslation.objects.update_or_create(
        species=species,
        language_code=language_code,
        defaults={
            'common_name': common_name,
            'common_name_normalized': _normalized(common_name),
            'synonyms': [],
            'regional_names': {},
            'search_text_normalized': _build_search_text(common_name, [], {}),
        },
    )


def _merge_species(apps, *, loser, winner):
    """Repoint every reference away from ``loser`` and retire it."""
    Crop = apps.get_model('farm', 'Crop')
    PublicCrop = apps.get_model('farm', 'PublicCrop')
    CropSpecies = apps.get_model('crops', 'CropSpecies')
    CropSpeciesTranslation = apps.get_model('crops', 'CropSpeciesTranslation')

    Crop.objects.filter(crop_species_id=loser.id).update(crop_species_id=winner.id)
    PublicCrop.objects.filter(crop_species_id=loser.id).update(crop_species_id=winner.id)
    CropSpeciesTranslation.objects.filter(species_id=loser.id).delete()
    CropSpecies.objects.filter(id=loser.id).delete()


def _rename_cauliflower_species(apps):
    """Make "Blumenkohl" the canonical name of the existing "Karfiol" species."""
    CropSpecies = apps.get_model('crops', 'CropSpecies')

    austrian_species = CropSpecies.objects.filter(
        name_normalized=_normalized(CAULIFLOWER_AUSTRIAN_NAME),
    ).first()
    canonical_species = CropSpecies.objects.filter(
        name_normalized=_normalized(CAULIFLOWER_CANONICAL_NAME),
    ).first()

    if austrian_species is None:
        return canonical_species

    if canonical_species is not None and canonical_species.id != austrian_species.id:
        # Both spellings exist as separate species rows. The one users already
        # publish under wins so no published entry has to move; ties go to the
        # older row.
        _merge_species(apps, loser=austrian_species, winner=canonical_species)
        canonical_species.review_note = CAULIFLOWER_MERGE_NOTE
        canonical_species.save(update_fields=['review_note'])
        return canonical_species

    austrian_species.name = CAULIFLOWER_CANONICAL_NAME
    austrian_species.name_normalized = _normalized(CAULIFLOWER_CANONICAL_NAME)
    austrian_species.review_note = CAULIFLOWER_MERGE_NOTE
    austrian_species.save(update_fields=['name', 'name_normalized', 'review_note'])
    return austrian_species


def sync_crop_species_aliases(apps, schema_editor):
    from crops.seed_data import (
        CROP_SPECIES_SEED_DATA,
        get_crop_species_seed_name,
        get_crop_species_seed_regional_names,
        get_crop_species_seed_synonyms,
    )

    CropSpecies = apps.get_model('crops', 'CropSpecies')

    _rename_cauliflower_species(apps)

    for entry in CROP_SPECIES_SEED_DATA:
        name = get_crop_species_seed_name(entry, 'de')
        normalized_name = _normalized(name)
        species = CropSpecies.objects.filter(name_normalized=normalized_name).first()
        if species is None:
            species = CropSpecies.objects.create(
                name=name,
                name_normalized=normalized_name,
                status='published',
                scientific_name=entry.scientific_name,
                family=entry.family,
                categories=list(entry.categories),
            )
        else:
            changed_fields = []
            if species.status != 'published':
                # A species that is part of the official seed list must stay a
                # valid mapping target even if a moderator rejected a
                # user-proposed row with the same name earlier.
                species.status = 'published'
                changed_fields.append('status')
            for field_name, value in (
                ('scientific_name', entry.scientific_name),
                ('family', entry.family),
                ('categories', list(entry.categories)),
            ):
                if not getattr(species, field_name) and value:
                    setattr(species, field_name, value)
                    changed_fields.append(field_name)
            if changed_fields:
                species.save(update_fields=changed_fields)

        for language_code in entry.translations:
            _write_translation(
                apps,
                species,
                language_code,
                get_crop_species_seed_name(entry, language_code),
                get_crop_species_seed_synonyms(entry, language_code),
                get_crop_species_seed_regional_names(entry, language_code),
            )


def clear_crop_species_aliases(apps, schema_editor):
    """Drop the seeded alias data again; species rows themselves are kept.

    The rename is reverted, but a merge is not: the losing row's references
    were rewritten and there is no record of which ones they were.
    """
    from crops.seed_data import (
        CROP_SPECIES_SEED_DATA,
        get_crop_species_seed_name,
        get_crop_species_seed_regional_names,
        get_crop_species_seed_synonyms,
    )

    CropSpecies = apps.get_model('crops', 'CropSpecies')
    CropSpeciesTranslation = apps.get_model('crops', 'CropSpeciesTranslation')

    for entry in CROP_SPECIES_SEED_DATA:
        if not entry.synonyms and not entry.regional_names:
            continue
        species = CropSpecies.objects.filter(
            name_normalized=_normalized(get_crop_species_seed_name(entry, 'de')),
        ).first()
        if species is None:
            continue
        for language_code in entry.translations:
            seeded_synonyms = set(get_crop_species_seed_synonyms(entry, language_code))
            seeded_regions = get_crop_species_seed_regional_names(entry, language_code)
            translation = CropSpeciesTranslation.objects.filter(
                species=species, language_code=language_code,
            ).first()
            if translation is None:
                continue
            synonyms = [
                value
                for value in translation.synonyms
                if isinstance(value, str) and value not in seeded_synonyms
            ]
            regional_names = {
                key: value
                for key, value in translation.regional_names.items()
                if seeded_regions.get(key) != value
            }
            translation.synonyms = synonyms
            translation.regional_names = regional_names
            translation.search_text_normalized = _build_search_text(
                translation.common_name, synonyms, regional_names,
            )
            translation.save(
                update_fields=[
                    'regional_names',
                    'search_text_normalized',
                    'synonyms',
                ],
            )

    cauliflower = CropSpecies.objects.filter(
        name_normalized=_normalized(CAULIFLOWER_CANONICAL_NAME),
        review_note=CAULIFLOWER_MERGE_NOTE,
    ).first()
    if cauliflower is not None:
        cauliflower.name = CAULIFLOWER_AUSTRIAN_NAME
        cauliflower.name_normalized = _normalized(CAULIFLOWER_AUSTRIAN_NAME)
        cauliflower.review_note = ''
        cauliflower.save(update_fields=['name', 'name_normalized', 'review_note'])
        _rewrite_translation(apps, cauliflower, 'de', CAULIFLOWER_AUSTRIAN_NAME)
        _rewrite_translation(apps, cauliflower, 'en', CAULIFLOWER_ENGLISH_NAME)


class Migration(migrations.Migration):

    dependencies = [
        ('crops', '0013_replace_generic_fennel_species'),
        ('farm', '0077_public_publishing_metadata'),
    ]

    operations = [
        migrations.RunPython(
            sync_crop_species_aliases,
            clear_crop_species_aliases,
        ),
    ]
