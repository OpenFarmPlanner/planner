from django.db import migrations


def seed_initial_crop_species(apps, schema_editor):
    from crops.migrations.data.species_bootstrap import (
        BOOTSTRAP_SPECIES,
        get_bootstrap_species_name,
    )
    from farm.utils import normalize_text

    CropSpecies = apps.get_model('crops', 'CropSpecies')

    for entry in BOOTSTRAP_SPECIES:
        name = get_bootstrap_species_name(entry, 'de')
        normalized_name = normalize_text(name) or ''
        species = CropSpecies.objects.filter(name_normalized=normalized_name).first()
        if species is None:
            CropSpecies.objects.create(
                name=name,
                name_normalized=normalized_name,
                status='published',
            )
            continue

        species.name = name
        species.status = 'published'
        species.name_normalized = normalized_name
        species.save(update_fields=['name', 'status', 'name_normalized'])


def unseed_initial_crop_species(apps, schema_editor):
    from crops.migrations.data.species_bootstrap import (
        BOOTSTRAP_SPECIES,
        get_bootstrap_species_name,
    )
    from farm.utils import normalize_text

    CropSpecies = apps.get_model('crops', 'CropSpecies')
    normalized_names = [
        normalize_text(get_bootstrap_species_name(entry, 'de')) or ''
        for entry in BOOTSTRAP_SPECIES
    ]
    CropSpecies.objects.filter(name_normalized__in=normalized_names, status='published').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('crops', '0001_crop_species'),
    ]

    operations = [
        migrations.RunPython(seed_initial_crop_species, unseed_initial_crop_species),
    ]
