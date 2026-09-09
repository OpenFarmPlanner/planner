"""Drop dead species-invariant overrides from species-linked Sorten.

``crop_family``, ``nutrient_demand`` and ``rotation_break_years`` describe the
crop species, not a single variety. A Sorte (``variety`` set) that is linked to
a ``crop_species`` now always resolves these from its general Kultur, and the
API no longer stores a Sorte-level value for them. Rows created before that rule
can still carry one; it is never read again, so this migration clears it instead
of leaving the database with permanently dead override columns.

``crop_family`` and ``nutrient_demand`` are non-nullable ``CharField``s, so
their empty state is the blank string, not ``NULL``.

Free-text Sorten and species-linked Sorten without a general Kultur are left
untouched — they have no inheritance source, so clearing their only copy would
silently lose data.

Irreversible in substance: the old values are not recorded anywhere, so the
reverse operation is a no-op.
"""

from django.db import migrations
from django.db.models import Q


def clear_variety_overrides(apps, schema_editor):
    Crop = apps.get_model('farm', 'Crop')
    species_with_general_crop = set(
        Crop.objects.filter(crop_species__isnull=False)
        .filter(Q(variety__isnull=True) | Q(variety=''))
        .values_list('project_id', 'crop_species_id')
    )
    if not species_with_general_crop:
        return

    backed_variety_ids = [
        crop_id
        for crop_id, project_id, species_id in Crop.objects.filter(
            crop_species__isnull=False,
        ).exclude(Q(variety__isnull=True) | Q(variety='')).values_list(
            'id', 'project_id', 'crop_species_id',
        )
        if (project_id, species_id) in species_with_general_crop
    ]
    linked_varieties = (
        Crop.objects.filter(id__in=backed_variety_ids)
        .filter(
            Q(crop_family__gt='')
            | Q(nutrient_demand__gt='')
            | Q(rotation_break_years__isnull=False)
        )
    )
    linked_varieties.update(
        crop_family='',
        nutrient_demand='',
        rotation_break_years=None,
    )


def noop_reverse(apps, schema_editor):
    """The cleared values are not stored anywhere; nothing to restore."""


class Migration(migrations.Migration):

    dependencies = [
        ('farm', '0100_rename_culture_in_stored_json'),
    ]

    operations = [
        migrations.RunPython(clear_variety_overrides, noop_reverse),
    ]
