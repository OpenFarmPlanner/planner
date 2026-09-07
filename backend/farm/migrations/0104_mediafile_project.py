from typing import Any

import django.db.models.deletion
from django.db import migrations, models


def backfill_media_projects(apps: Any, schema_editor: Any) -> None:
    MediaFile = apps.get_model('farm', 'MediaFile')
    Crop = apps.get_model('farm', 'Crop')

    for media_file in MediaFile.objects.filter(project__isnull=True).iterator():
        project_id = (
            Crop.objects.filter(image_file_id=media_file.pk)
            .order_by('project_id')
            .values_list('project_id', flat=True)
            .first()
        )
        if project_id is not None:
            media_file.project_id = project_id
            media_file.save(update_fields=['project'])
            Crop.objects.filter(image_file_id=media_file.pk).exclude(
                project_id=project_id
            ).update(image_file=None)


class Migration(migrations.Migration):
    dependencies = [('farm', '0103_link_published_crops_to_owned_entries')]

    operations = [
        migrations.AddField(
            model_name='mediafile',
            name='project',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='media_files',
                to='farm.project',
            ),
        ),
        migrations.RunPython(backfill_media_projects, migrations.RunPython.noop),
    ]
