"""Create private examples for reviewing the timing-window editor locally."""

from django.contrib.auth import get_user_model
from django.core.management.base import CommandError, CommandParser
from django.db import transaction

from farm.management.commands.seed_library_import_acceptance import Command as LocalFixtureCommand
from farm.models import Crop, Project, ProjectMembership
from farm.services.timing_windows import TimingWindow, replace_crop_timing_windows

MARKER = 'Synthetic timing-window editor acceptance fixture.'
PROPAGATION = (
    TimingWindow.decade('pre_cultivation', 11, 'early', 2, 'late'),
    TimingWindow.weeks('pre_cultivation', 10, 14),
)


class Command(LocalFixtureCommand):
    help = 'Preview or create a private timing-window acceptance project with three crops.'

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
            self.stdout.write('Preview only: three crops with empty, partial and full windows.')
            return

        with transaction.atomic():
            project, created = Project.objects.get_or_create(
                slug=f'ofp-local-timing-windows-{user.pk}',
                defaults={'name': 'Timing window editor acceptance', 'description': MARKER},
            )
            if created:
                ProjectMembership.objects.create(project=project, user=user, role='admin')
                self._populate(project)
            elif project.description != MARKER or not ProjectMembership.objects.filter(
                project=project, user=user, role='admin',
            ).exists():
                raise CommandError('Fixture slug has different ownership; nothing changed.')
        self.stdout.write(f'Use project {project.pk} to compare the three editor states.')

    def _populate(self, project: Project) -> None:
        full = (
            *PROPAGATION,
            TimingWindow.decade('direct_sowing', 9, 'mid', 10, 'late'),
            TimingWindow.weeks('planting', 32, 36),
        )
        for name, windows in (
            ('Timing windows empty', ()),
            ('Timing windows partial', PROPAGATION),
            ('Timing windows full', full),
        ):
            crop = Crop.objects.create(project=project, name=name)
            replace_crop_timing_windows(crop, windows)
