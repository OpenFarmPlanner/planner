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
        parser.add_argument(
            '--legend', action='store_true', help='Include full and overlapping beds.',
        )

    def handle(self, *args: object, **options: object) -> None:
        engine, host, database = self.validate_database(str(options['database_name']))
        user = get_user_model().objects.filter(username=options['username'], is_active=True).first()
        if user is None:
            raise CommandError('An existing active local user is required.')
        legend = bool(options['legend'])
        fixture = 'bed-capacity-legend' if legend else 'bed-capacity'
        name = (
            'Crop Calendar capacity legend acceptance' if legend
            else 'Crop Calendar bed capacity acceptance'
        )
        self.stdout.write(f'Target: {engine}, host={host or "local file"}, database={database}.')
        if not options['apply']:
            contents = 'five beds and six plans' if legend else 'three beds and three plans'
            self.stdout.write(f'Preview only: one private project with {contents}.')
            return

        with transaction.atomic():
            project, created = Project.objects.get_or_create(
                slug=f'ofp-local-{fixture}-{user.pk}',
                defaults={'name': name, 'description': MARKER},
            )
            if created:
                ProjectMembership.objects.create(project=project, user=user, role='admin')
                self._populate(project, legend=legend)
                ensure_project_checkpoint(project, user_name=user.username)
            elif project.description != MARKER or not ProjectMembership.objects.filter(
                project=project, user=user, role='admin',
            ).exists():
                raise CommandError('Fixture slug has different ownership; nothing changed.')
        self.stdout.write(f'Open project {project.pk} in Crop Calendar and enable Show free areas.')

    def _populate(self, project: Project, *, legend: bool) -> None:
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
        if legend:
            self._add_full_and_overlapping_beds(project, season, field, carrot, year)

    def _add_full_and_overlapping_beds(
        self, project: Project, season: Season, field: Field, carrot: Crop, year: int,
    ) -> None:
        full = Bed.objects.create(project=project, field=field, name='Full bed', area_sqm=10)
        overlap = Bed.objects.create(
            project=project, field=field, name='Succession during harvest', area_sqm=10,
        )
        succession = Crop.objects.create(
            project=project, name='Succession crop',
            growth_duration_days=35, harvest_duration_days=28,
        )
        for bed, crop, planting_date, area in (
            (full, carrot, date(year, 4, 5), 10),
            (overlap, succession, date(year, 4, 1), 6),
            (overlap, succession, date(year, 5, 22), 6),
        ):
            PlantingPlan.objects.create(
                project=project, season=season, bed=bed, crop=crop, area_usage_sqm=area,
                planting_date=planting_date, cultivation_type='direct_sowing',
            )
