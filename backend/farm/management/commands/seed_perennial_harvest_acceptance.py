"""Prepare a private orchard for checking recurring and one-off harvests."""

from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import CommandError, CommandParser
from django.db import transaction

from farm.management.commands.seed_library_import_acceptance import Command as LocalFixtureCommand
from farm.models import (
    Bed,
    Crop,
    CropLoss,
    Field,
    HarvestAllocation,
    HarvestRecord,
    Location,
    PlantingPlan,
    Project,
    ProjectMembership,
    Season,
    Task,
)
from farm.services.tasks import generate_tasks_for_plans

MARKER = 'Synthetic perennial harvest acceptance fixture.'


class Command(LocalFixtureCommand):
    help = 'Preview or create an isolated project with recurring, legacy and annual harvests.'

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument('--username', required=True)
        parser.add_argument('--database-name', required=True)
        variants = parser.add_mutually_exclusive_group()
        variants.add_argument('--calendar-axis', action='store_true')
        variants.add_argument('--season-details', action='store_true')
        variants.add_argument('--harvest-tasks', action='store_true')
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args: object, **options: object) -> None:
        engine, host, database = self.validate_database(str(options['database_name']))
        user = get_user_model().objects.filter(username=options['username'], is_active=True).first()
        if user is None:
            raise CommandError('An existing active local user is required.')
        self.stdout.write(f'Target: {engine}, host={host or "local file"}, database={database}.')
        season_details = bool(options['season_details'])
        harvest_tasks = bool(options['harvest_tasks'])
        calendar_axis = bool(options['calendar_axis']) or season_details or harvest_tasks
        if not options['apply']:
            fixture = (
                'six seasons and six plans' if calendar_axis else 'five seasons and four plans'
            )
            if harvest_tasks:
                fixture = 'seven seasons and six plans with seasonal harvest tasks'
            self.stdout.write(f'Preview only: one private orchard, {fixture}.')
            if season_details:
                self.stdout.write('Calendar rhubarb has a harvest, a historical loss and a task.')
            return

        suffix = 'tasks' if harvest_tasks else 'details' if season_details else (
            'calendar' if calendar_axis else 'harvest'
        )
        name = {
            'details': 'Perennial season details acceptance',
            'tasks': 'Perennial harvest tasks acceptance',
            'calendar': 'Perennial calendar acceptance',
            'harvest': 'Perennial harvest acceptance',
        }[suffix]
        with transaction.atomic():
            project, created = Project.objects.get_or_create(
                slug=f'ofp-local-perennial-{suffix}-{user.pk}',
                defaults={'name': name, 'description': MARKER},
            )
            if created:
                ProjectMembership.objects.create(project=project, user=user, role='admin')
                self._populate(project, calendar_axis=calendar_axis, season_details=season_details)
                if harvest_tasks:
                    self._generate_harvest_tasks(project)
            elif project.description != MARKER or not ProjectMembership.objects.filter(
                project=project, user=user, role='admin',
            ).exists():
                raise CommandError('Fixture slug has different ownership; nothing changed.')
        self.stdout.write(f'Open project {project.pk}: {project.name}. Existing data is preserved.')

    @staticmethod
    def _generate_harvest_tasks(project: Project) -> None:
        Season.objects.create(
            project=project, start_date=date(2029, 9, 1), end_date=date(2030, 8, 31),
        )
        plans = PlantingPlan.objects.filter(project=project).select_related('crop', 'season')
        generate_tasks_for_plans(plans)
        rhubarb = plans.get(crop__name='Calendar rhubarb')
        Task.objects.filter(
            project=project, source_key=f'plan:{rhubarb.pk}:event:harvest_start',
            occurrence_index=2025,
        ).update(status='completed')

    @staticmethod
    def _populate(project: Project, *, calendar_axis: bool, season_details: bool) -> None:
        origin = Season.objects.create(
            project=project, start_date=date(2025, 1, 1), end_date=date(2025, 12, 31),
        )
        calendar_season = Season.objects.create(
            project=project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        for start, end, label in (
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
            name: str, planted: date, clearing: date | None,
            *, season: Season = origin, **timing: object,
        ) -> PlantingPlan:
            bed = Bed.objects.create(project=project, field=field, name=name, area_sqm=24)
            crop = Crop.objects.create(
                project=project, name=name, cultivation_type='direct_sowing',
                cultivation_types=['direct_sowing'], expected_yield=2, harvest_method='per_sqm',
                **timing,
            )
            return PlantingPlan.objects.create(
                project=project, crop=crop, bed=bed, season=season, planting_date=planted,
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

        if calendar_axis:
            earlier = Season.objects.create(
                project=project, start_date=date(2024, 1, 1), end_date=date(2024, 12, 31),
            )
            rhubarb = plant(
                'Calendar rhubarb', date(2024, 5, 1), date(2030, 9, 30), season=earlier,
                life_cycle='perennial', standing_time_years=10, annual_harvest_window='03-12/04-09',
            )
            plant(
                'Long winter leek', date(2026, 10, 1), None, season=calendar_season,
                life_cycle='annual', growth_duration_days=355, harvest_duration_days=40,
            )
            if season_details:
                rhubarb.actual_sowing_date = date(2024, 5, 3)
                rhubarb.save(update_fields=['actual_sowing_date'])
                Task.objects.create(
                    project=project, planting_plan=rhubarb, crop=rhubarb.crop, season=earlier,
                    title='Check the spring harvest',
                    due_date=date(2025, 3, 12), status='completed',
                )
                record = HarvestRecord.objects.create(
                    project=project, crop=rhubarb.crop, date=date(2026, 4, 22),
                    quantity=Decimal('3.5'), unit='kg',
                )
                HarvestAllocation.objects.create(
                    project=project, harvest=record, planting_plan=rhubarb,
                    quantity=record.quantity,
                )
                CropLoss.objects.create(
                    project=project, planting_plan=rhubarb, date=date(2025, 4, 8),
                    loss_type='partial', cause='frost',
                )
