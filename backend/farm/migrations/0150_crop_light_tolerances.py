"""Preserve the old light choice as the only selected site condition."""

from django.apps.registry import Apps
from django.db import migrations, models
from django.db.backends.base.schema import BaseDatabaseSchemaEditor

from farm.crop_light import validate_crop_light

BATCH_SIZE = 500


def _convert(apps: Apps, schema_editor: BaseDatabaseSchemaEditor, *, reverse: bool = False) -> None:
    for model_name in ('Crop', 'PublicCrop'):
        model = apps.get_model('farm', model_name)
        rows = model._base_manager.using(schema_editor.connection.alias)
        destination = 'legacy_light_requirement' if reverse else 'light_requirement'
        batch = []
        light_rows = rows.only('pk', 'legacy_light_requirement', 'light_requirement')
        for row in light_rows.iterator(BATCH_SIZE):
            if reverse:
                row.legacy_light_requirement = next(iter(row.light_requirement), '')
            else:
                value = row.legacy_light_requirement
                row.light_requirement = [value] if value else []
            batch.append(row)
            if len(batch) == BATCH_SIZE:
                rows.bulk_update(batch, [destination], batch_size=BATCH_SIZE)
                batch.clear()
        rows.bulk_update(batch, [destination], batch_size=BATCH_SIZE)


def forwards(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    _convert(apps, schema_editor)


def backwards(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    _convert(apps, schema_editor, reverse=True)


class Migration(migrations.Migration):
    dependencies = [('farm', '0149_location_boundary_origin')]

    operations = [
        migrations.RenameField('crop', 'light_requirement', 'legacy_light_requirement'),
        migrations.RenameField('publiccrop', 'light_requirement', 'legacy_light_requirement'),
        migrations.AddField(
            'crop', 'light_requirement',
            models.JSONField(
                blank=True, default=list, validators=[validate_crop_light],
                help_text='Suitable site light conditions. An empty list means unspecified.',
            ),
        ),
        migrations.AddField(
            'publiccrop', 'light_requirement',
            models.JSONField(blank=True, default=list, validators=[validate_crop_light]),
        ),
        migrations.RunPython(forwards, backwards),
        migrations.RemoveField('crop', 'legacy_light_requirement'),
        migrations.RemoveField('publiccrop', 'legacy_light_requirement'),
    ]
