"""Backfill species translations from the existing single-language names.

Migration assumptions, deliberately conservative — no machine translation is
invented and no existing text is changed:

1. Every ``CropSpecies.name`` currently in the database was entered through a
   German-only UI (the app shipped German-only until this change) and is
   therefore stored as the ``de`` translation. ``name`` itself is left
   untouched and keeps serving as the canonical reference label.
2. English names are written **only** for species whose normalized name
   matches a curated entry in the frozen bootstrap snapshot
   (``crops/migrations/data/species_bootstrap_v1.json``). Those pairs are
   hand-curated repository data, not generated text.
3. Species that do not match a seed entry (user proposals) get a ``de`` row
   only. They will simply fall back to German in an English UI, and the
   frontend marks that as "translation missing" rather than pretending the
   German name is English.

Re-running is safe: rows are matched on (species, language_code) and existing
translations are never overwritten. The reverse operation only deletes
translation rows, so no source data can be lost.
"""

from django.db import migrations


def _seed_names_by_normalized_german(normalize_text):
    from crops.migrations.data.species_bootstrap import BOOTSTRAP_SPECIES

    return {
        normalize_text(entry.translations['de']) or '': entry.translations
        for entry in BOOTSTRAP_SPECIES
    }


def backfill_translations(apps, schema_editor):
    from farm.utils import normalize_text

    CropSpecies = apps.get_model('crops', 'CropSpecies')
    CropSpeciesTranslation = apps.get_model('crops', 'CropSpeciesTranslation')

    seed_by_normalized = _seed_names_by_normalized_german(normalize_text)
    existing = {
        (row.species_id, row.language_code)
        for row in CropSpeciesTranslation.objects.all().only('species_id', 'language_code')
    }

    new_rows = []
    for species in CropSpecies.objects.all().iterator():
        name = (species.name or '').strip()
        if not name:
            continue

        # Assumption 1: legacy names are German.
        translations = {'de': name}

        # Assumption 2: curated English names only, never generated ones.
        seed_translations = seed_by_normalized.get(species.name_normalized or '')
        if seed_translations and seed_translations.get('en'):
            translations['en'] = seed_translations['en']

        for language_code, common_name in translations.items():
            if (species.id, language_code) in existing:
                continue
            new_rows.append(CropSpeciesTranslation(
                species_id=species.id,
                language_code=language_code,
                common_name=common_name,
                common_name_normalized=normalize_text(common_name) or '',
            ))

    CropSpeciesTranslation.objects.bulk_create(new_rows, batch_size=500)


def drop_translations(apps, schema_editor):
    CropSpeciesTranslation = apps.get_model('crops', 'CropSpeciesTranslation')
    CropSpeciesTranslation.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ('crops', '0004_add_crop_translations'),
    ]

    operations = [
        migrations.RunPython(backfill_translations, drop_translations),
    ]
