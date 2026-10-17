from django.db import migrations


def sync_expanded_crop_species_seed_data(apps, schema_editor):
    from crops.migrations.data.species_bootstrap import (
        BOOTSTRAP_SPECIES,
        get_bootstrap_species_name,
    )
    from farm.utils import normalize_text

    CropSpecies = apps.get_model('crops', 'CropSpecies')
    CropSpeciesTranslation = apps.get_model('crops', 'CropSpeciesTranslation')

    for entry in BOOTSTRAP_SPECIES:
        name = get_bootstrap_species_name(entry, 'de')
        normalized_name = normalize_text(name) or ''
        species = CropSpecies.objects.filter(name_normalized=normalized_name).first()
        if species is None:
            species = CropSpecies.objects.create(
                name=name,
                name_normalized=normalized_name,
                status='published',
            )
        else:
            species.name = name
            species.name_normalized = normalized_name
            species.status = 'published'
            species.save(update_fields=['name', 'name_normalized', 'status'])

        for language_code, common_name in entry.translations.items():
            cleaned_language_code = (language_code or '').strip().lower()
            cleaned_common_name = ' '.join((common_name or '').split())
            CropSpeciesTranslation.objects.update_or_create(
                species=species,
                language_code=cleaned_language_code,
                defaults={
                    'common_name': cleaned_common_name,
                    'common_name_normalized': normalize_text(cleaned_common_name) or '',
                },
            )


class Migration(migrations.Migration):

    dependencies = [
        ('crops', '0005_backfill_crop_species_translations'),
    ]

    operations = [
        migrations.RunPython(sync_expanded_crop_species_seed_data, migrations.RunPython.noop),
    ]
