"""Prepare a local project with large checkpoints and a restorable history."""

from django.contrib.auth import get_user_model
from django.core.management.base import CommandError, CommandParser
from django.db import transaction

from farm.history.project_restore import capture_project_state, record_project_checkpoint
from farm.management.commands.seed_library_import_acceptance import Command as LocalFixtureCommand
from farm.models import Crop, Project, ProjectMembership

PROJECT_NAME = 'Restore history budget acceptance'
MARKER = 'Synthetic restore history budget fixture v1; private local test data.'
CHECKPOINT_COUNT = 30


class Command(LocalFixtureCommand):
    help = 'Preview or seed one isolated project with 30 large restore checkpoints.'

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
            self.stdout.write(f'Preview only: {PROJECT_NAME}, with 30 synthetic checkpoints.')
            return

        with transaction.atomic():
            project, created = Project.objects.get_or_create(
                slug=f'ofp-local-restore-history-budget-{user.pk}',
                defaults={'name': PROJECT_NAME, 'description': MARKER},
            )
            if not created:
                if project.description != MARKER or not project.memberships.filter(
                    user=user, role='admin',
                ).exists():
                    raise CommandError('Fixture slug has different ownership; nothing changed.')
                self.stdout.write(f'Kept project {project.pk}; manual edits were preserved.')
                return

            ProjectMembership.objects.create(project=project, user=user, role='admin')
            for number in range(1, 121):
                Crop(project=project, name=f'Synthetic crop {number:03d}',
                     notes='Synthetic project history test data. ' * 180).save(record_history=False)
            marker = Crop(project=project, name='Checkpoint marker')
            for number in range(1, CHECKPOINT_COUNT + 1):
                marker.notes = f'Checkpoint {number:02d}'
                marker.save(record_history=False)
                record_project_checkpoint(project, capture_project_state(project),
                                          user_name=marker.notes)
            marker.notes = 'Current version'
            marker.save()

        self.stdout.write(f'Created project {project.pk}: {PROJECT_NAME}.')
