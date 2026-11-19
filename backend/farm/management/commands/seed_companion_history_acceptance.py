"""Prepare private local crops for exercising companion import history."""

from django.contrib.auth import get_user_model
from django.core.management.base import CommandError, CommandParser
from django.db import transaction

from farm.management.commands.seed_library_import_acceptance import Command as LocalFixtureCommand
from farm.models import Crop, CropCompanion, Project, ProjectMembership

MARKER = 'Synthetic companion history acceptance fixture; private local test data.'


class Command(LocalFixtureCommand):
    help = 'Preview or create an isolated local project with a free-text companion to resolve.'

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
            self.stdout.write('Preview only: two private crops and a text neighbour.')
            return

        with transaction.atomic():
            project, created = Project.objects.get_or_create(
                slug=f'ofp-local-companion-history-{user.pk}',
                defaults={'name': 'Companion history acceptance', 'description': MARKER},
            )
            if created:
                ProjectMembership.objects.create(project=project, user=user, role='admin')
                owner = Crop.objects.create(project=project, name='Companion history owner')
                Crop.objects.create(project=project, name='Companion history neighbour')
                CropCompanion.objects.create(
                    project=project, crop=owner, companion_text='Companion history later',
                    kind=CropCompanion.KIND_GOOD,
                )
            elif project.description != MARKER or not ProjectMembership.objects.filter(
                project=project, user=user, role='admin',
            ).exists():
                raise CommandError('Fixture slug has different ownership; nothing changed.')
        self.stdout.write(f'Use project {project.pk} with the companion history JSON example.')
