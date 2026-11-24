"""Prepare a private local project for checking crop-group selection and undo."""

from django.contrib.auth import get_user_model
from django.core.management.base import CommandError, CommandParser
from django.db import transaction

from farm.history.project_restore import ensure_project_checkpoint
from farm.management.commands.seed_library_import_acceptance import Command as LocalFixtureCommand
from farm.models import Crop, Project, ProjectMembership

MARKER = 'Synthetic crop bulk selection acceptance fixture; private local test data.'


class Command(LocalFixtureCommand):
    help = 'Preview or create a private project with one crop group and an unrelated crop.'

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
            self.stdout.write('Preview only: one private project, two crops and two varieties.')
            return

        with transaction.atomic():
            project, created = Project.objects.get_or_create(
                slug=f'ofp-local-crop-bulk-selection-{user.pk}',
                defaults={'name': 'Crop bulk selection acceptance', 'description': MARKER},
            )
            if created:
                ProjectMembership.objects.create(project=project, user=user, role='admin')
                for name, variety, origin in (
                    ('Manual tomato', '', Crop.CREATION_MANUAL),
                    ('Other chard', '', Crop.CREATION_MANUAL),
                    ('Manual tomato', 'File basil', Crop.CREATION_FILE_IMPORT),
                    ('Manual tomato', 'File chard', Crop.CREATION_FILE_IMPORT),
                ):
                    Crop.objects.create(
                        project=project, name=name, variety=variety, creation_origin=origin,
                    )
                ensure_project_checkpoint(project, user_name=user.username)
            elif project.description != MARKER or not ProjectMembership.objects.filter(
                project=project, user=user, role='admin',
            ).exists():
                raise CommandError('Fixture slug has different ownership; nothing changed.')
        self.stdout.write(f'Open project {project.pk} in Cultures and turn on selection mode.')
