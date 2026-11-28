"""Prepare a private growing-area hierarchy for local interaction measurements."""

from django.contrib.auth import get_user_model
from django.core.management.base import CommandError, CommandParser
from django.db import transaction

from farm.management.commands.seed_library_import_acceptance import Command as LocalFixtureCommand
from farm.models import Bed, Field, Location, Project, ProjectMembership
from farm.services.growing_area_geometry import reconcile_project_geometry

MARKER = 'Synthetic growing-area edit benchmark fixture.'


class Command(LocalFixtureCommand):
    help = 'Preview or create a private local project for measuring Growing Areas edits.'

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument('--username', required=True)
        parser.add_argument('--database-name', required=True)
        parser.add_argument('--beds', type=int, choices=(24, 640), required=True)
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args: object, **options: object) -> None:
        engine, host, database = self.validate_database(str(options['database_name']))
        user = get_user_model().objects.filter(username=options['username'], is_active=True).first()
        if user is None:
            raise CommandError('An existing active local user is required.')
        count = int(options['beds'])
        label = f'Growing area edit benchmark ({count})'
        self.stdout.write(f'Target: {engine}, host={host or "local file"}, database={database}.')
        if not options['apply']:
            self.stdout.write(f'Preview only: {label}, {count} beds in a private hierarchy.')
            return
        with transaction.atomic():
            project, created = Project.objects.get_or_create(
                slug=f'ofp-local-growing-area-edit-benchmark-{count}-{user.pk}',
                defaults={'name': label, 'description': MARKER},
            )
            if created:
                ProjectMembership.objects.create(project=project, user=user, role='admin')
                self._populate(project, count)
            elif project.description != MARKER or not ProjectMembership.objects.filter(
                project=project, user=user, role='admin',
            ).exists():
                raise CommandError('Fixture slug has different ownership; nothing changed.')
        self.stdout.write(f'Open project {project.pk}: {label}. Existing data is preserved.')

    @staticmethod
    def _populate(project: Project, count: int) -> None:
        location_count, fields_per_location, beds_per_field = (
            (2, 2, 6) if count == 24 else (4, 8, 20)
        )
        locations = Location.objects.bulk_create([
            Location(
                project=project, name=f'Bench location {index + 1:02}', length_m=120, width_m=18,
                light_condition='sunny', irrigation='available',
            )
            for index in range(location_count)
        ])
        fields = Field.objects.bulk_create([
            Field(
                project=project, location=location, name=f'Bench parcel {index + 1:02}',
                length_m=75, width_m=12, area_sqm=900, cultivation_environment='polytunnel',
            )
            for location in locations for index in range(fields_per_location)
        ])
        Bed.objects.bulk_create([
            Bed(
                project=project, field=field, name=f'Bench bed {index + 1:02}',
                length_m=8, width_m=2, area_sqm=16,
                light_condition='shade' if index % 8 == 7 else None,
            )
            for field in fields for index in range(beds_per_field)
        ])
        reconcile_project_geometry(project)
