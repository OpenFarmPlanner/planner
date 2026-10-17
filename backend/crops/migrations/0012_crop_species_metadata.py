from django.db import migrations, models


def _clean_categories(value):
    if not isinstance(value, list | tuple):
        return []
    cleaned = []
    seen = set()
    for entry in value:
        if not isinstance(entry, str):
            continue
        category = ' '.join(entry.split()).lower()
        if category and category not in seen:
            cleaned.append(category)
            seen.add(category)
    return cleaned


def sync_crop_species_metadata(apps, schema_editor):
    from crops.migrations.data.species_bootstrap import (
        BOOTSTRAP_SPECIES,
        get_bootstrap_species_name,
    )
    from farm.utils import normalize_text

    CropSpecies = apps.get_model('crops', 'CropSpecies')
    Crop = apps.get_model('farm', 'Crop')
    PublicCrop = apps.get_model('farm', 'PublicCrop')

    for entry in BOOTSTRAP_SPECIES:
        metadata = {
            'scientific_name': ' '.join((entry.scientific_name or '').split()),
            'family': ' '.join((entry.family or '').split()),
            'categories': _clean_categories(entry.categories),
        }
        if not any(metadata.values()):
            continue

        normalized_name = normalize_text(get_bootstrap_species_name(entry, 'de')) or ''
        species = CropSpecies.objects.filter(name_normalized=normalized_name).first()
        if species is None:
            continue

        changed_fields = []
        for field_name, value in metadata.items():
            current = getattr(species, field_name)
            if not current and value:
                setattr(species, field_name, value)
                changed_fields.append(field_name)
        if changed_fields:
            species.save(update_fields=changed_fields)

        if metadata['family']:
            general_crop_query = {
                'crop_species_id': species.id,
                'variety__in': ['', None],
                'crop_family': '',
            }
            Crop.objects.filter(**general_crop_query).update(crop_family=metadata['family'])
            PublicCrop.objects.filter(**general_crop_query).update(crop_family=metadata['family'])


def clear_seeded_crop_species_metadata(apps, schema_editor):
    from crops.migrations.data.species_bootstrap import (
        BOOTSTRAP_SPECIES,
        get_bootstrap_species_name,
    )
    from farm.utils import normalize_text

    CropSpecies = apps.get_model('crops', 'CropSpecies')

    normalized_names = [
        normalize_text(get_bootstrap_species_name(entry, 'de')) or ''
        for entry in BOOTSTRAP_SPECIES
        if entry.scientific_name or entry.family or entry.categories
    ]
    if not normalized_names:
        return
    CropSpecies.objects.filter(name_normalized__in=normalized_names).update(
        scientific_name='',
        family='',
        categories=[],
    )


class Migration(migrations.Migration):

    dependencies = [
        ('farm', '0102_clear_public_variety_species_invariant_fields'),
        ('crops', '0011_replace_asian_greens_collective_species'),
    ]

    operations = [
        migrations.AddField(
            model_name='cropspecies',
            name='categories',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name='cropspecies',
            name='family',
            field=models.CharField(blank=True, max_length=200),
        ),
        migrations.AddField(
            model_name='cropspecies',
            name='scientific_name',
            field=models.CharField(blank=True, max_length=200),
        ),
        migrations.RunPython(
            sync_crop_species_metadata,
            clear_seeded_crop_species_metadata,
        ),
    ]
