"""Prepare an isolated project for testing the admin history storage summary."""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import CommandError, CommandParser
from django.db import transaction
from django.utils import timezone

from farm.history.project_restore import capture_project_state, record_project_checkpoint
from farm.history.records import HISTORY_RETENTION_DAYS
from farm.management.commands.seed_library_import_acceptance import Command as LocalFixtureCommand
from farm.models import Crop, Project, ProjectMembership

MARKER = 'Synthetic history storage fixture v1; private local test data.'


class Command(LocalFixtureCommand):
    help = 'Preview or seed a local project with three history entries and one retained anchor.'

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument('--username', required=True)
        parser.add_argument('--database-name', required=True)
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args: object, **options: object) -> None:
        engine, host, database = self.validate_database(str(options['database_name']))
        user = get_user_model().objects.filter(
            username=options['username'], is_active=True, is_staff=True, is_superuser=True,
        ).first()
        if user is None:
            raise CommandError('An existing active local superuser is required.')
        self.stdout.write(f'Target: {engine}, host={host or "local file"}, database={database}.')
        if not options['apply']:
            self.stdout.write(
                'Preview only: three history entries, including one retained checkpoint.'
            )
            return

        with transaction.atomic():
            project, created = Project.objects.get_or_create(
                slug=f'ofp-local-history-storage-{user.pk}',
                defaults={'name': 'History storage acceptance', 'description': MARKER},
            )
            if not created:
                if project.description != MARKER or not project.memberships.filter(
                    user=user, role='admin',
                ).exists():
                    raise CommandError('Fixture slug has different ownership; nothing changed.')
                self.stdout.write(f'Kept project {project.pk}; manual edits were preserved.')
                return

            ProjectMembership.objects.create(project=project, user=user, role='admin')
            crop = Crop.objects.create(project=project, name='Synthetic crop')
            record_project_checkpoint(project, capture_project_state(project))
            project.entity_revisions.filter(entity_type='project').update(
                created_at=timezone.now() - timedelta(days=HISTORY_RETENTION_DAYS + 1),
            )
            crop.notes = 'Edited synthetic notes'
            crop.save()
        self.stdout.write(f'Created project {project.pk}: History storage acceptance.')
