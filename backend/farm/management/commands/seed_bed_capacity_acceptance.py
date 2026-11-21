"""Prepare an isolated local project for checking Crop Calendar bed capacity."""

from datetime import date

from django.contrib.auth import get_user_model
from django.core.management.base import CommandError, CommandParser
from django.db import transaction

from farm.history.project_restore import ensure_project_checkpoint
from farm.management.commands.seed_library_import_acceptance import Command as LocalFixtureCommand
from farm.models import Bed, Crop, Field, Location, PlantingPlan, Project, ProjectMembership, Season

MARKER = 'Synthetic Crop Calendar bed capacity fixture; private local test data.'


class Command(LocalFixtureCommand):
    help = 'Preview or create local test beds with free, partly used and unknown area.'

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
            self.stdout.write('Preview only: one private project with three beds and three plans.')
            return

        with transaction.atomic():
            project, created = Project.objects.get_or_create(
                slug=f'ofp-local-bed-capacity-{user.pk}',
                defaults={'name': 'Crop Calendar bed capacity acceptance', 'description': MARKER},
            )
            if created:
                ProjectMembership.objects.create(project=project, user=user, role='admin')
                self._populate(project)
                ensure_project_checkpoint(project, user_name=user.username)
            elif project.description != MARKER or not ProjectMembership.objects.filter(
                project=project, user=user, role='admin',
            ).exists():
                raise CommandError('Fixture slug has different ownership; nothing changed.')
        self.stdout.write(f'Open project {project.pk} in Crop Calendar and enable Show free areas.')

    def _populate(self, project: Project) -> None:
        year = date.today().year
        season = Season.objects.create(
            project=project, start_date=date(year, 1, 1), end_date=date(year, 12, 31),
        )
        location = Location.objects.create(project=project, name='Capacity garden')
        field = Field.objects.create(project=project, location=location, name='Capacity field')
        mixed_bed = Bed.objects.create(
            project=project, field=field, name='Carrot and lettuce', area_sqm=10,
        )
        unknown_bed = Bed.objects.create(
            project=project, field=field, name='Unmeasured planting', area_sqm=10,
        )
        Bed.objects.create(project=project, field=field, name='Unused bed', area_sqm=10)
        carrot = Crop.objects.create(project=project, name='Carrot', growth_duration_days=40)
        lettuce = Crop.objects.create(project=project, name='Lettuce', growth_duration_days=35)
        for bed, crop, april_day, area in (
            (mixed_bed, carrot, 1, 5), (mixed_bed, lettuce, 15, 3), (unknown_bed, carrot, 5, None),
        ):
            PlantingPlan.objects.create(
                project=project, season=season, bed=bed, crop=crop, area_usage_sqm=area,
                planting_date=date(year, 4, april_day), cultivation_type='direct_sowing',
            )
