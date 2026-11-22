"""Prepare a private orchard for checking recurring and one-off harvests."""

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

MARKER = 'Synthetic perennial harvest acceptance fixture.'


class Command(LocalFixtureCommand):
    help = 'Preview or create an isolated project with recurring, legacy and annual harvests.'

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
            self.stdout.write('Preview only: one private orchard, five seasons and four plans.')
            return

        with transaction.atomic():
            project, created = Project.objects.get_or_create(
                slug=f'ofp-local-perennial-harvest-{user.pk}',
                defaults={'name': 'Perennial harvest acceptance', 'description': MARKER},
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
        origin = Season.objects.create(
            project=project, start_date=date(2025, 1, 1), end_date=date(2025, 12, 31),
        )
        for start, end, label in (
            (date(2026, 1, 1), date(2026, 12, 31), ''),
            (date(2027, 1, 1), date(2027, 12, 31), ''),
            (date(2028, 1, 1), date(2028, 8, 31), 'Jan–Aug 2028'),
            (date(2028, 9, 1), date(2029, 8, 31), 'Sep 2028–Aug 2029'),
        ):
            Season.objects.create(
                project=project, start_date=start, end_date=end, custom_label=label,
            )

        location = Location.objects.create(project=project, name='Acceptance orchard')
        field = Field.objects.create(project=project, location=location, name='Orchard trials')

        def plant(
            name: str, planted: date, clearing: date | None, **timing: object,
        ) -> PlantingPlan:
            bed = Bed.objects.create(project=project, field=field, name=name, area_sqm=24)
            crop = Crop.objects.create(
                project=project, name=name, cultivation_type='direct_sowing',
                cultivation_types=['direct_sowing'], expected_yield=2, harvest_method='per_sqm',
                **timing,
            )
            return PlantingPlan.objects.create(
                project=project, crop=crop, bed=bed, season=origin, planting_date=planted,
                clearing_date=clearing, area_usage_sqm=20, cultivation_type='direct_sowing',
            )

        apple = plant(
            'Apple', date(2025, 3, 15), date(2028, 9, 10), life_cycle='perennial',
            standing_time_years=8, annual_harvest_window='09-01/10-15', first_harvest_delay_years=2,
        )
        apple.actual_harvest_start_date = date(2025, 10, 3)
        apple.save(update_fields=['actual_harvest_start_date'])
        record = HarvestRecord.objects.create(
            project=project, crop=apple.crop, date=date(2027, 9, 10), quantity=3, unit='kg',
        )
        HarvestAllocation.objects.create(
            project=project, harvest=record, planting_plan=apple, quantity=3,
        )
        plant(
            'Winter apple', date(2025, 3, 15), date(2029, 1, 8), life_cycle='perennial',
            standing_time_years=8, annual_harvest_window='12-20/01-10',
        )
        plant(
            'Legacy rhubarb', date(2025, 3, 15), date(2029, 1, 8), life_cycle='perennial',
            standing_time_years=8, growth_duration_days=50, harvest_duration_days=30,
        )
        plant(
            'Overwintering garlic', date(2025, 10, 15), None, life_cycle='annual',
            growth_duration_days=200, harvest_duration_days=14,
        )
