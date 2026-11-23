"""Prepare an isolated local project for checking the inline planting-plan bed picker."""

from datetime import date

from django.contrib.auth import get_user_model
from django.core.management.base import CommandError, CommandParser
from django.db import transaction

from farm.history.project_restore import ensure_project_checkpoint
from farm.management.commands.seed_library_import_acceptance import Command as LocalFixtureCommand
from farm.models import Bed, Crop, Field, Location, PlantingPlan, Project, ProjectMembership, Season

MARKER = 'Synthetic inline bed picker acceptance fixture; private local test data.'


class Command(LocalFixtureCommand):
    help = 'Preview or create a private project with duplicate plot names and limited bed capacity.'

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
            self.stdout.write(
                'Preview only: one private project with two locations, three plots and four beds.',
            )
            return

        with transaction.atomic():
            project, created = Project.objects.get_or_create(
                slug=f'ofp-local-bed-picker-{user.pk}',
                defaults={'name': 'Bed picker acceptance', 'description': MARKER},
            )
            if created:
                ProjectMembership.objects.create(project=project, user=user, role='admin')
                self._populate(project)
                ensure_project_checkpoint(project, user_name=user.username)
            elif project.description != MARKER or not ProjectMembership.objects.filter(
                project=project, user=user, role='admin',
            ).exists():
                raise CommandError('Fixture slug has different ownership; nothing changed.')
        self.stdout.write(f'Open project {project.pk}: {project.name}. Existing data is preserved.')

    @staticmethod
    def _populate(project: Project) -> None:
        year = date.today().year
        previous = Season.objects.create(
            project=project, start_date=date(year - 1, 1, 1), end_date=date(year - 1, 12, 31),
        )
        current = Season.objects.create(
            project=project, start_date=date(year, 1, 1), end_date=date(year, 12, 31),
        )
        home = Location.objects.create(project=project, name='Hofgarten')
        remote = Location.objects.create(project=project, name='Pachtacker Lindenhof')
        north = Field.objects.create(project=project, name='Frühbeete Nord', location=home)
        remote_north = Field.objects.create(project=project, name=north.name, location=remote)
        tunnel = Field.objects.create(
            project=project, location=home,
            name='Sommerfolienhaus Süd mit langer Parzellenbezeichnung',
        )
        lettuce_bed = Bed.objects.create(
            project=project, field=north, name='Salat 1', area_sqm=18.8,
        )
        small_bed = Bed.objects.create(project=project, field=north, name='Engpass', area_sqm=6)
        Bed.objects.create(
            project=project, field=remote_north, name=lettuce_bed.name, area_sqm=18.8,
        )
        Bed.objects.create(project=project, field=tunnel, name='Freies Beet', area_sqm=18.8)
        lettuce = Crop.objects.create(
            project=project, name='Kopfsalat',
            crop_family_id='Asteraceae', rotation_break_years=3,
        )
        carrot = Crop.objects.create(project=project, name='Karotte', crop_family_id='Apiaceae')

        for season, crop, bed, start_year, area in (
            (previous, lettuce, small_bed, year - 1, 5),
            (current, lettuce, lettuce_bed, year, 8.5),
            (current, carrot, small_bed, year, 5.5),
        ):
            PlantingPlan.objects.create(
                project=project, season=season, crop=crop, bed=bed,
                cultivation_type='direct_sowing',
                planting_date=date(start_year, 4, 10), harvest_date=date(start_year, 6, 10),
                clearing_date=date(start_year, 6, 30), area_usage_sqm=area,
            )
