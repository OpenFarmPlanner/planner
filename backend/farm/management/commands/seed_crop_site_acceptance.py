"""Prepare an isolated local project with contrasting site suitability examples."""

from datetime import date

from django.contrib.auth import get_user_model
from django.core.management.base import CommandError, CommandParser
from django.db import transaction

from farm.management.commands.seed_library_import_acceptance import Command as LocalFixtureCommand
from farm.models import Bed, Crop, Field, Location, PlantingPlan, Project, ProjectMembership, Season

MARKER = 'Synthetic crop site suitability fixture; private local test data.'


class Command(LocalFixtureCommand):
    help = 'Preview or create a private project with a crop, two beds and a saved plan.'

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
            self.stdout.write('Preview only: one private project with contrasting site conditions.')
            return

        with transaction.atomic():
            project, created = Project.objects.get_or_create(
                slug=f'ofp-local-crop-site-{user.pk}',
                defaults={'name': 'Crop site suitability acceptance', 'description': MARKER},
            )
            if created:
                ProjectMembership.objects.create(project=project, user=user, role='admin')
                self._populate(project)
            elif project.description != MARKER or not ProjectMembership.objects.filter(
                project=project, user=user, role='admin',
            ).exists():
                raise CommandError('Fixture slug has different ownership; nothing changed.')
        self.stdout.write(f'Use project {project.pk} to compare the two test beds.')

    def _populate(self, project: Project) -> None:
        location = Location.objects.create(
            project=project, name='Shaded site', light_condition='shade', irrigation='unavailable',
        )
        field = Field.objects.create(
            project=project, location=location, name='Dry field', soil_moisture='dry',
        )
        bed = Bed.objects.create(project=project, field=field, name='Inherited bed', area_sqm=10)
        Bed.objects.create(
            project=project, field=field, name='Sunny override bed', area_sqm=10,
            light_condition='sunny', irrigation='available',
        )
        crop = Crop.objects.create(
            project=project, name='Site suitability crop', water_requirement='high',
            light_requirement=['full_sun', 'partial_shade'], growth_duration_days=40,
        )
        year = date.today().year
        season = Season.objects.create(
            project=project, start_date=date(year, 1, 1), end_date=date(year, 12, 31),
        )
        PlantingPlan.objects.create(
            project=project, crop=crop, bed=bed, season=season,
            planting_date=date(year, 5, 1), area_usage_sqm=2,
        )
