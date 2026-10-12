"""Turn the free-text ``crop_family`` into a reference to the plant-family list.

The old text column is renamed to ``legacy_crop_family`` and kept read-only, so
no value is lost. A new ``crop_family`` foreign key to ``crops.PlantFamily``
(keyed by botanical name) is then filled from that text with
``crops.plant_families.resolve_plant_family_key`` — the same rule for project
crops and public library entries, so the 4-case update model does not see a
spurious difference between an imported copy and its entry.

Values that cannot be mapped leave the reference empty; every one of them is
printed with the affected row ids so they can be fixed by hand. Pending public
edit proposals carrying a ``crop_family`` are re-keyed the same way, because
approving one re-validates it against the new list. Soft-deleted
crops are mapped too (``_base_manager``), and rows are written with
``update()`` so neither ``updated_at`` nor the history/divergence bookkeeping
of ``Crop.save()`` is touched.

Reverse: drops the reference and renames the untouched text column back.
"""

from collections import defaultdict

import django.db.models.deletion
from django.db import migrations, models

LEGACY_HELP_TEXT = (
    'Deprecated: original free-text crop family before the switch to the curated '
    'plant-family list. Read-only; to be removed in a later release.'
)


def map_legacy_crop_families(apps, schema_editor):
    from crops.plant_families import resolve_plant_family_key

    known_families = set(
        apps.get_model('crops', 'PlantFamily').objects.values_list('pk', flat=True)
    )
    for model_name in ('Crop', 'PublicCrop'):
        manager = apps.get_model('farm', model_name)._base_manager
        ids_by_value: dict[str, list[int]] = defaultdict(list)
        for pk, value in (
            manager.exclude(legacy_crop_family='').order_by('pk').values_list('pk', 'legacy_crop_family')
        ):
            ids_by_value[value].append(pk)

        unmapped: dict[str, list[int]] = {}
        for value, ids in ids_by_value.items():
            family_key = resolve_plant_family_key(value)
            if family_key is None or family_key not in known_families:
                unmapped[value] = ids
                continue
            manager.filter(legacy_crop_family=value).update(crop_family_id=family_key)

        for value, ids in sorted(unmapped.items()):
            print(
                f'\n  [farm.0112] Unmapped {model_name}.crop_family {value!r}: '
                f'left empty for ids {ids} (original kept in legacy_crop_family)'
            )

    _map_pending_proposals(apps, known_families, resolve_plant_family_key)


def _map_pending_proposals(apps, known_families, resolve_plant_family_key):
    """Re-key ``crop_family`` in pending edit proposals, which approval re-validates.

    A value that cannot be mapped is removed from the proposal (and printed)
    rather than turned into a "clear the family" proposal.
    """
    Proposal = apps.get_model('farm', 'PublicCropChangeProposal')
    for proposal in Proposal.objects.filter(status='pending').order_by('pk'):
        data = proposal.proposed_data
        if not isinstance(data, dict) or 'crop_family' not in data:
            continue
        value = data['crop_family']
        family_key = resolve_plant_family_key(value) if isinstance(value, str) else None
        if not value:
            data['crop_family'] = None
        elif family_key is not None and family_key in known_families:
            data['crop_family'] = family_key
        else:
            data.pop('crop_family')
            print(
                f'\n  [farm.0112] Unmapped crop_family {value!r} removed from pending '
                f'PublicCropChangeProposal {proposal.pk}'
            )
        proposal.proposed_data = data
        proposal.save(update_fields=['proposed_data'])


class Migration(migrations.Migration):

    dependencies = [
        ('crops', '0019_plant_family'),
        ('farm', '0111_project_demo_seeded_at'),
    ]

    operations = [
        migrations.RenameField(
            model_name='crop',
            old_name='crop_family',
            new_name='legacy_crop_family',
        ),
        migrations.RenameField(
            model_name='publiccrop',
            old_name='crop_family',
            new_name='legacy_crop_family',
        ),
        migrations.AlterField(
            model_name='crop',
            name='legacy_crop_family',
            field=models.CharField(
                blank=True, editable=False, help_text=LEGACY_HELP_TEXT, max_length=200,
            ),
        ),
        migrations.AlterField(
            model_name='publiccrop',
            name='legacy_crop_family',
            field=models.CharField(
                blank=True, editable=False, help_text=LEGACY_HELP_TEXT, max_length=200,
            ),
        ),
        migrations.AddField(
            model_name='crop',
            name='crop_family',
            field=models.ForeignKey(
                blank=True,
                help_text='Plant family for rotation planning, referenced by its botanical name',
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='crops',
                to='crops.plantfamily',
            ),
        ),
        migrations.AddField(
            model_name='publiccrop',
            name='crop_family',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='public_crops',
                to='crops.plantfamily',
            ),
        ),
        migrations.RunPython(map_legacy_crop_families, migrations.RunPython.noop),
    ]
