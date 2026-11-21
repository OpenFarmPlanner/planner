"""Prepare private recurring and manual tasks for testing season restoration."""

from datetime import date

from django.contrib.auth import get_user_model
from django.core.management.base import CommandError, CommandParser
from django.db import transaction
from django.utils import timezone

from farm.history.project_restore import ensure_project_checkpoint
from farm.management.commands.seed_library_import_acceptance import Command as LocalFixtureCommand
from farm.models import (
    Crop,
    CropTaskTemplate,
    PlantingPlan,
    Project,
    ProjectMembership,
    Season,
    Task,
)
from farm.services.tasks import generate_plan_tasks

MARKER = 'Synthetic season task history fixture; private local test data.'


class Command(LocalFixtureCommand):
    help = 'Preview or create an isolated season with generated and manual tasks.'

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument('--username', required=True)
        parser.add_argument('--database-name', required=True)
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args: object, **options: object) -> None:
        engine, host, database = self.validate_database(str(options['database_name']))
        user = get_user_model().objects.filter(username=options['username'], is_active=True).first()
        if user is None:
            raise CommandError('An existing active local user is required.')
        self.stdout.write(f'Target: {engine}, host={host or "local file"}, database={database}.')
        if not options['apply']:
            self.stdout.write('Preview only: two seasons, one plan and its original tasks.')
            return

        with transaction.atomic():
            project, created = Project.objects.get_or_create(
                slug=f'ofp-local-season-task-history-{user.pk}',
                defaults={'name': 'Season task history acceptance', 'description': MARKER},
            )
            if created:
                ProjectMembership.objects.create(project=project, user=user, role='admin')
                self._populate(project)
                ensure_project_checkpoint(project, user_name=user.username)
            elif project.description != MARKER or not ProjectMembership.objects.filter(
                project=project, user=user, role='admin',
            ).exists():
                raise CommandError('Fixture slug has different ownership; nothing changed.')
        self.stdout.write(f'Open project {project.pk} and select the Recurring work season.')

    def _populate(self, project: Project) -> None:
        year = date.today().year
        target = Season.objects.create(
            project=project, start_date=date(year, 1, 1), end_date=date(year, 12, 31),
            custom_label='Recurring work',
        )
        other = Season.objects.create(
            project=project, start_date=date(year + 1, 1, 1), end_date=date(year + 1, 12, 31),
            custom_label='Other season',
        )
        crop = Crop.objects.create(project=project, name='Lettuce', growth_duration_days=40)
        rule = CropTaskTemplate.objects.create(
            project=project, crop=crop, title='Water lettuce', reference_event='planting',
            repeat_interval_days=7, repeat_until='count', repeat_count=3,
        )
        plan = PlantingPlan.objects.create(
            project=project, season=target, crop=crop, planting_date=date(year, 4, 7),
            cultivation_type='pre_cultivation',
        )
        generate_plan_tasks(plan)
        occurrences = Task.objects.filter(planting_plan=plan, template=rule)
        occurrences.filter(occurrence_index=0).update(status='completed')
        occurrences.filter(occurrence_index=1).update(due_date=None, due_date_overridden=True)
        occurrences.filter(occurrence_index=2).update(deleted_at=timezone.now())
        Task.objects.create(
            project=project, season=target, planting_plan=plan, title='Manual check',
        )
        Task.objects.create(project=project, season=other, title='Unrelated task')
