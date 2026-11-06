"""Add current work examples to older demos without resetting their data."""

from datetime import timedelta

from django.apps.registry import Apps
from django.db import migrations
from django.db.backends.base.schema import BaseDatabaseSchemaEditor
from django.utils import timezone

# Frozen demo identifiers and text: migration behavior must survive template changes.
DESCRIPTIONS = {
    'Persönliches Demo-Projekt mit realistischen Beispieldaten.': 'de',
    'Personal demo project with realistic sample data.': 'en',
    'Reproduzierbares Demo-Projekt für Produkt-Screenshots.': 'de',
    'Reproducible demo project for product screenshots.': 'en',
}
TITLES = {
    'de': ['Zaun am Pachtacker prüfen', 'Beete jäten', 'Erntekisten reinigen',
           'Bewässerung kontrollieren', 'Kompostlieferung abstimmen',
           'Zusätzliche Saatgutbestellung', 'Abdeckvlies kontrollieren'],
    'en': ['Check the fence on the leased field', 'Weed the beds', 'Clean harvest crates',
           'Check irrigation', 'Arrange the compost delivery',
           'Additional seed order', 'Check the covering fleece'],
}
TASK_DESCRIPTIONS = {
    'de': 'Beispielaufgabe für die gemeinsame Arbeitsplanung im Demo-Projekt.',
    'en': 'Sample task for shared work planning in the demo project.',
}


def backfill_demo_tasks(apps: Apps, schema_editor: BaseDatabaseSchemaEditor) -> None:
    Project = apps.get_model('farm', 'Project')
    Season = apps.get_model('farm', 'Season')
    Task = apps.get_model('farm', 'Task')
    Membership = apps.get_model('farm', 'ProjectMembership')
    Revision = apps.get_model('farm', 'EntityRevision')
    alias = schema_editor.connection.alias
    today = timezone.localdate()
    tasks = Task.objects.using(alias)
    projects = Project.objects.using(alias).filter(
        demo_seeded_at__isnull=False, description__in=DESCRIPTIONS,
        is_active=True, deleted_at__isnull=True,
    )
    for project in projects.iterator():
        # Existing manual work (even soft-deleted) or edits/deletions are user
        # intent. Never refill a board that a user may deliberately have cleared.
        if tasks.filter(project_id=project.pk, origin='manual').exists():
            continue
        if Revision.objects.using(alias).filter(project_id=project.pk, entity_type='task').exists():
            continue
        # Match the overview's default selection, including old demo years.
        season = Season.objects.using(alias).filter(
            project_id=project.pk, deleted_at__isnull=True,
        ).order_by('-start_date', '-pk').first()
        if season is None:
            continue
        owner_id = Membership.objects.using(alias).filter(
            project_id=project.pk, role='admin',
        ).order_by('pk').values_list('user_id', flat=True).first()
        language = DESCRIPTIONS[project.description]
        tasks.bulk_create([
            Task(
                project_id=project.pk, season_id=season.pk, title=TITLES[language][index],
                description=TASK_DESCRIPTIONS[language], status=status,
                due_date=today + timedelta(days=offset) if offset is not None else None,
                assigned_to_id=owner_id if offset is not None else None,
                origin='manual',
            )
            for index, status, offset in [
                (0, 'pending', 6), (1, 'in_progress', 0), (2, 'completed', -1),
                (3, 'pending', 2), (4, 'pending', None), (5, 'cancelled', -3),
                (6, 'pending', -2),
            ]
        ])


class Migration(migrations.Migration):
    dependencies = [('farm', '0134_validate_template_recurrence')]

    # Keep the examples on rollback: they may already contain user edits.
    operations = [migrations.RunPython(backfill_demo_tasks, migrations.RunPython.noop)]
