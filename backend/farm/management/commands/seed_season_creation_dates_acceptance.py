"""Prepare private projects for checking season-copy sources and date bases."""

from datetime import date

from django.contrib.auth import get_user_model
from django.core.management.base import CommandError, CommandParser
from django.db import transaction

from farm.management.commands.seed_library_import_acceptance import Command as LocalFixtureCommand
from farm.models import Crop, PlantingPlan, Project, ProjectMembership, Season, SeasonPattern

MARKER = 'Synthetic season creation date-basis fixture; private local test data.'


class Command(LocalFixtureCommand):
    help = 'Preview or create isolated guided and historical season-copy fixtures.'

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument('--username', required=True)
        parser.add_argument('--database-name', required=True)
        parser.add_argument('--historical-copy', action='store_true')
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args: object, **options: object) -> None:
        engine, host, database = self.validate_database(str(options['database_name']))
        user = get_user_model().objects.filter(username=options['username'], is_active=True).first()
        if user is None:
            raise CommandError('An existing active local user is required.')
        self.stdout.write(f'Target: {engine}, host={host or "local file"}, database={database}.')
        historical = options['historical_copy']
        if not options['apply']:
            self.stdout.write('Preview only: ' + (
                'one private project with three seasons and two plans.' if historical
                else 'two private projects, each with a source season and one plan.'
            ))
            return

        year = date.today().year - 1
        fixtures = [('historical', 'Historical season copy')] if historical else [
            (basis, f'Season creation dates ({basis})') for basis in ('actual', 'planned')
        ]
        with transaction.atomic():
            for fixture, name in fixtures:
                project, created = Project.objects.get_or_create(
                    slug=f'ofp-local-season-creation-dates-{user.pk}-{fixture}',
                    defaults={'name': name, 'description': MARKER},
                )
                if created:
                    ProjectMembership.objects.create(project=project, user=user, role='admin')
                    if historical:
                        self._populate_historical(project)
                    else:
                        self._populate(project, year)
                elif project.description != MARKER or not ProjectMembership.objects.filter(
                    project=project, user=user, role='admin',
                ).exists():
                    raise CommandError('Fixture slug has different ownership; nothing changed.')
                self.stdout.write(
                    f'Open project {project.pk}: {project.name}. Existing data is preserved.'
                )

    @staticmethod
    def _populate(project: Project, year: int) -> None:
        SeasonPattern.objects.create(project=project, start_day=1, start_month=1)
        source = Season.objects.create(
            project=project, start_date=date(year, 1, 1), end_date=date(year, 12, 31),
        )
        crop = Crop.objects.create(
            project=project, name='Lettuce', cultivation_type='direct_sowing',
            growth_duration_days=30,
        )
        PlantingPlan.objects.create(
            project=project, season=source, crop=crop, cultivation_type='direct_sowing',
            planting_date=date(year, 4, 1), actual_sowing_date=date(year, 4, 6),
            harvest_date=date(year, 5, 3), harvest_date_is_explicit=True,
        )

    @staticmethod
    def _populate_historical(project: Project) -> None:
        SeasonPattern.objects.create(project=project, start_day=1, start_month=1)
        seasons = {
            year: Season.objects.create(
                project=project, start_date=date(year, 1, 1), end_date=date(year, 12, 31),
                custom_label=label,
            )
            for year, label in ((2024, 'Historical garden'), (2025, ''), (2026, ''))
        }
        for name, planned, actual in (
            ('Lettuce', date(2024, 2, 26), date(2024, 2, 29)),
            ('Carrot', date(2026, 4, 1), None),
        ):
            crop = Crop.objects.create(
                project=project, name=name, cultivation_type='direct_sowing',
                growth_duration_days=30,
            )
            PlantingPlan.objects.create(
                project=project, season=seasons[planned.year], crop=crop,
                cultivation_type='direct_sowing', planting_date=planned, actual_sowing_date=actual,
            )
