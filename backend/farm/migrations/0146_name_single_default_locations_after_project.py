"""Rename a project's only location from the generated default to the project name.

Until #1190 every new project got one location named by the server in the
request's language. From now on the first location is named after the project.
This migration gives existing projects the same result where it is safe:

- only projects with exactly one location (soft-deleted projects included, so a
  restored project looks like a new one);
- only when that location's name is exactly one of the generated defaults
  below, compared without leading/trailing whitespace. Any other name, or a
  default name the user typed themselves, is left alone; the two cases cannot
  be told apart, since no field records how the location was created, so a
  manually chosen "Hauptstandort" is renamed too (docs/growing-areas.md);
- the location keeps its ID, fields, notes, layout and all references; only
  ``name`` changes, and a ``location`` revision records the change so the
  project's latest version still reconstructs its live state.

Projects with several locations are unchanged. Running it again changes
nothing, because a renamed location no longer carries a default name. The
reverse is a no-op: renaming back could overwrite a name the user set after
the migration.
"""

import json
import logging

from django.core.serializers.json import DjangoJSONEncoder
from django.db import migrations
from django.db.models import Count, Q
from django.utils import timezone

logger = logging.getLogger(__name__)

# The exact names farm.services.default_location generated before #1190, one
# per supported UI language. Frozen here; do not import application code.
HISTORICAL_DEFAULT_LOCATION_NAMES = (
    'Hauptstandort',
    'Main location',
    'Site principal',
    'Ubicación principal',
    'Sito principale',
    'Exploração principal',
    'Hoofdlocatie',
)


def rename_default_locations(apps, schema_editor):
    Project = apps.get_model('farm', 'Project')
    Location = apps.get_model('farm', 'Location')
    EntityRevision = apps.get_model('farm', 'EntityRevision')
    max_length = Location._meta.get_field('name').max_length

    single_location_projects = (
        Project.objects.annotate(location_count=Count('locations'))
        .filter(location_count=1)
        .values_list('pk', flat=True)
    )
    name_filter = Q()
    for name in HISTORICAL_DEFAULT_LOCATION_NAMES:
        name_filter |= Q(name__iexact=name)
    candidates = (
        Location.objects.filter(project_id__in=single_location_projects)
        .filter(name_filter)
        .select_related('project')
        .order_by('pk')
    )
    renamed = 0
    for location in candidates.iterator():
        if location.name.strip() not in HISTORICAL_DEFAULT_LOCATION_NAMES:
            continue
        new_name = location.project.name.strip()[:max_length]
        if not new_name or new_name == location.name:
            continue
        Location.objects.filter(pk=location.pk).update(name=new_name, updated_at=timezone.now())
        row = Location.objects.filter(pk=location.pk).values().first()
        EntityRevision.objects.create(
            project_id=location.project_id,
            entity_type='location',
            object_id=location.pk,
            action='updated',
            display_name=new_name,
            snapshot=json.loads(json.dumps(row, cls=DjangoJSONEncoder)),
            changed_fields=['name'],
            user_name='',
        )
        renamed += 1
    logger.info('Named %d single default locations after their project.', renamed)


class Migration(migrations.Migration):

    dependencies = [
        ('farm', '0145_add_retained_upload_cleanup'),
    ]

    operations = [
        migrations.RunPython(rename_default_locations, migrations.RunPython.noop),
    ]
