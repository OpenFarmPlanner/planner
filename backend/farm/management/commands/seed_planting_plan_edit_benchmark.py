"""Prepare isolated planting-plan datasets for local interaction measurements."""

from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import CommandError, CommandParser
from django.db import transaction

from farm.management.commands.seed_library_import_acceptance import Command as LocalFixtureCommand
from farm.models import Bed, Crop, Field, Location, PlantingPlan, Project, ProjectMembership, Season

MARKER = 'Synthetic planting-plan edit benchmark fixture.'
CULTIVATION = 'pre_cultivation'


class Command(LocalFixtureCommand):
    help = 'Preview or create a private local project for measuring date editing.'

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument('--username', required=True)
        parser.add_argument('--database-name', required=True)
        parser.add_argument('--plans', type=int, choices=(24, 640), required=True)
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args: object, **options: object) -> None:
        engine, host, database = self.validate_database(str(options['database_name']))
        user = get_user_model().objects.filter(username=options['username'], is_active=True).first()
        if user is None:
            raise CommandError('An existing active local user is required.')
        count = int(options['plans'])
        label = f'Planting plan edit benchmark ({count})'
        self.stdout.write(f'Target: {engine}, host={host or "local file"}, database={database}.')
        if not options['apply']:
            self.stdout.write(f'Preview only: {label}, {count} annual plans and one carried-over apple.')
            return

        with transaction.atomic():
            project, created = Project.objects.get_or_create(
                slug=f'ofp-local-plan-edit-benchmark-{count}-{user.pk}',
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
        previous_season = Season.objects.create(project=project, start_date=date(2025, 1, 1), end_date=date(2025, 12, 31))
        season = Season.objects.create(project=project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31))
        locations, fields_per_location, beds_per_field, crop_count = (2, 1, 3, 6) if count == 24 else (4, 4, 4, 32)
        beds = []
        for location_index in range(locations):
            location = Location.objects.create(project=project, name=f'Benchmark location {location_index + 1:02}')
            for field_index in range(fields_per_location):
                field = Field.objects.create(project=project, location=location, name=f'Benchmark parcel {field_index + 1:02}')
                for bed_index in range(beds_per_field):
                    beds.append(Bed.objects.create(
                        project=project, field=field, name=f'Benchmark bed {bed_index + 1:02}', area_sqm=80,
                    ))

        def make_annual_crop(name: str) -> Crop:
            return Crop.objects.create(
                project=project, name=name, cultivation_type=CULTIVATION, cultivation_types=[CULTIVATION],
                propagation_duration_days=21, growth_duration_days=30, harvest_duration_days=10,
            )

        crops = [make_annual_crop(f'Benchmark annual {index + 1:02}') for index in range(crop_count)]
        missing_actual = make_annual_crop('Benchmark missing actual')
        apple = Crop.objects.create(
            project=project, name='Benchmark perennial apple', life_cycle='perennial', standing_time_years=10,
            annual_harvest_window='08-01/10-01', first_harvest_delay_years=0,
            cultivation_type=CULTIVATION, cultivation_types=[CULTIVATION],
        )
        plans = []
        for index in range(count):
            planting = date(2026, 3, index + 1) if index < 3 else date(2026, 4, 1) + timedelta(days=index % 75)
            plans.append(PlantingPlan(
                project=project, season=season, bed=beds[index % len(beds)],
                crop=missing_actual if index == 2 else crops[index % crop_count],
                cultivation_type=CULTIVATION, planting_date=planting,
                harvest_date=planting + timedelta(days=30), harvest_end_date=planting + timedelta(days=39),
                area_usage_sqm=1, actual_transplanting_date=None if index == 2 else planting,
            ))
        PlantingPlan.objects.bulk_create(plans)
        PlantingPlan.objects.create(
            project=project, season=previous_season, bed=beds[-1], crop=apple, cultivation_type=CULTIVATION,
            planting_date=date(2025, 5, 1), clearing_date=date(2030, 9, 1), area_usage_sqm=2,
        )
