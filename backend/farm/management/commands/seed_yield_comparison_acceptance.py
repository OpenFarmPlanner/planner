"""Create an isolated two-site fixture for the filtered yield comparison."""

from datetime import date

from django.contrib.auth import get_user_model
from django.core.management.base import CommandError, CommandParser
from django.db import transaction

from farm.management.commands.seed_library_import_acceptance import Command as LocalFixtureCommand
from farm.models import (
    Bed,
    Crop,
    Field,
    HarvestAllocation,
    HarvestRecord,
    Location,
    PlantingPlan,
    Project,
    ProjectMembership,
    Season,
)

MARKER = 'Synthetic yield comparison acceptance fixture.'


class Command(LocalFixtureCommand):
    help = 'Preview or create a private fixture for filtered harvest and forecast comparisons.'

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
            self.stdout.write('Preview only: one private project, four seasons and two sites.')
            return

        with transaction.atomic():
            project, created = Project.objects.get_or_create(
                slug=f'ofp-local-yield-comparison-{user.pk}',
                defaults={'name': 'Yield comparison acceptance', 'description': MARKER},
            )
            if created:
                ProjectMembership.objects.create(project=project, user=user, role='admin')
                self._populate(project)
            elif project.description != MARKER or not ProjectMembership.objects.filter(
                project=project, user=user, role='admin',
            ).exists():
                raise CommandError('Fixture slug has different ownership; nothing changed.')
        self.stdout.write(f'Open project {project.pk}: {project.name}. Existing data is preserved.')

    @staticmethod
    def _populate(project: Project) -> None:
        seasons = {
            year: Season.objects.create(
                project=project, start_date=date(year, 9, 1), end_date=date(year + 1, 8, 31),
            )
            for year in (2023, 2024, 2025, 2026)
        }
        beds = []
        for name in ('North orchard', 'South garden'):
            site = Location.objects.create(project=project, name=name)
            field = Field.objects.create(project=project, location=site, name='Market plot')
            beds.append(Bed.objects.create(
                project=project, field=field, name=f'{name} bed', area_sqm=30,
            ))
        north, south = beds
        leek, tomato, carrot = [
            Crop.objects.create(
                project=project, name=name, variety=variety, expected_yield=2,
                harvest_method='per_sqm', cultivation_type='direct_sowing',
            )
            for name, variety in (('Leek', ''), ('Tomato', 'Roma'), ('Carrot', ''))
        ]

        def plant(season: Season, crop: Crop, bed: Bed, area: int) -> PlantingPlan:
            year = season.start_date.year
            return PlantingPlan.objects.create(
                project=project, season=season, crop=crop, bed=bed, area_usage_sqm=area,
                planting_date=date(year, 9, 12), cultivation_type='direct_sowing',
                harvest_date=date(year, 10, 1), harvest_end_date=date(year, 10, 31),
                harvest_date_is_explicit=True, harvest_end_date_is_explicit=True,
            )

        def record(year: int, crop: Crop, quantity: int, *shares: tuple[PlantingPlan, int]) -> None:
            harvest = HarvestRecord.objects.create(
                project=project, crop=crop, date=date(year, 10, 10), quantity=quantity, unit='kg',
            )
            HarvestAllocation.objects.bulk_create([
                HarvestAllocation(
                    project=project, harvest=harvest, planting_plan=plan, quantity=amount,
                )
                for plan, amount in shares
            ])

        for year in (2025, 2026):
            plan = plant(seasons[year], leek, north, 8)
            if year == 2025:
                record(year, leek, 5, (plan, 5))
            else:
                other = plant(seasons[year], leek, south, 10)
                record(year, leek, 17, (plan, 6), (other, 9))
        record(2026, leek, 4)
        record(2026, tomato, 6, (plant(seasons[2026], tomato, north, 8), 6))
        record(2026, carrot, 4, (plant(seasons[2026], carrot, south, 6), 4))
        record(2023, leek, 3)
