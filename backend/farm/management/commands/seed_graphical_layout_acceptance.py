"""Prepare isolated schematic fields for graphical layout acceptance (#913)."""

from django.contrib.auth import get_user_model
from django.core.management.base import CommandError, CommandParser
from django.db import transaction

from farm.management.commands.seed_library_import_acceptance import Command as LocalFixtureCommand
from farm.models import Bed, Field, Location, Project, ProjectMembership

MARKER = 'Synthetic graphical layout acceptance fixture v1.'


class Command(LocalFixtureCommand):
    help = 'Preview or create an isolated graphical layout test project without resetting data.'

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument('--username', required=True)
        parser.add_argument('--database-name', required=True)
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args: object, **options: object) -> None:
        engine, host, name = self.validate_database(str(options['database_name']))
        user = get_user_model().objects.filter(username=options['username'], is_active=True).first()
        if user is None:
            raise CommandError('An existing active local user is required.')
        self.stdout.write(f'Target: {engine}, host={host or "local file"}, database={name}.')
        if not options['apply']:
            self.stdout.write(
                'Preview only: one dedicated project, one location, three unsaved fields '
                'and three beds with mixed proportions and long names. No changes made.'
            )
            return
        with transaction.atomic():
            project, created = Project.objects.get_or_create(
                slug=f'local-graphical-layout-{user.pk}',
                defaults={'name': 'Graphical layout acceptance', 'description': MARKER},
            )
            if not created:
                if project.description != MARKER or not ProjectMembership.objects.filter(
                    project=project, user=user, role='admin',
                ).exists():
                    raise CommandError('Fixture slug belongs to another project; nothing changed.')
                self.stdout.write(f'Kept project {project.pk}; no reset performed.')
                return
            ProjectMembership.objects.create(project=project, user=user, role='admin')
            location = Location.objects.create(project=project, name='Schematic layout')
            for index, width, length, bed_width, bed_length in [
                (1, 10, 20, 2, 15), (2, 24, 10, 18, 3), (3, 8, 8, 4, 4),
            ]:
                field = Field.objects.create(
                    project=project, location=location, name=f'Plot {index}',
                    width_m=width, length_m=length,
                )
                Bed.objects.create(
                    project=project, field=field, name=f'Bed {index} with a long readable name',
                    width_m=bed_width, length_m=bed_length,
                )
            self.stdout.write(f'Created project {project.pk}: {project.name}.')
