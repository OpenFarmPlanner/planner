"""Prepare isolated local proposals for seven-language moderation acceptance."""

from django.contrib.auth import get_user_model
from django.core.management.base import CommandError, CommandParser
from django.db import transaction

from config.languages import SUPPORTED_LANGUAGE_CODES
from crops.models import CropSpecies, CropSpeciesTranslation
from crops.permissions import is_public_library_moderator
from farm.management.commands.seed_library_import_acceptance import Command as LocalFixtureCommand
from farm.models import Project, ProjectMembership

MARKER = 'Synthetic species moderation acceptance fixture v1; local test data only.'


class Command(LocalFixtureCommand):
    help = 'Preview or prepare three local species proposals; never grant roles or reset fixtures.'

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument('--username', required=True)
        parser.add_argument('--database-name', required=True)
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args: object, **options: object) -> None:
        engine, host, database = self.validate_database(str(options['database_name']))
        user = get_user_model().objects.filter(username=options['username'], is_active=True).first()
        if user is None or not is_public_library_moderator(user):
            raise CommandError(
                'An existing active local moderator is required; no roles are granted.'
            )
        self.stdout.write(f'Target: {engine}, host={host or "local file"}, database={database}.')
        if not options['apply']:
            self.stdout.write('Preview only: one private marker project and three proposed species '
                              '(7/7, 5/7 with required names, 5/7 missing a required name). '
                              'Existing library records remain unchanged.')
            return
        with transaction.atomic():
            project, created = Project.objects.get_or_create(
                slug=f'ofp-local-species-moderation-{user.pk}',
                defaults={'name': 'Species moderation acceptance', 'description': MARKER},
            )
            if not created:
                if project.description != MARKER or not ProjectMembership.objects.filter(
                    project=project, user=user, role='admin',
                ).exists():
                    raise CommandError('Fixture project has different ownership; nothing changed.')
                self.stdout.write('Kept existing fixtures, including manual edits and decisions.')
                return
            ProjectMembership.objects.create(project=project, user=user, role='admin')
            for scenario in ('complete', 'optional-missing', 'required-missing'):
                name = f'Synthetic moderation {user.pk} {scenario}'
                if CropSpecies.objects.filter(name=name).exists():
                    raise CommandError('Fixture species name already exists; nothing changed.')
                species = CropSpecies.objects.create(
                    name=name, scientific_name=f'Syntheticus moderatio {scenario}',
                    status=CropSpecies.STATUS_PROPOSED, proposed_by=user, review_note=MARKER,
                )
                for code in SUPPORTED_LANGUAGE_CODES:
                    if scenario != 'complete' and code == 'nl':
                        continue
                    blank = (scenario, code) in {
                        ('optional-missing', 'pt'), ('required-missing', 'en'),
                    }
                    CropSpeciesTranslation.objects.create(
                        species=species, language_code=code,
                        common_name=(
                            '   ' if blank else f'{code.upper()} synthetic long crop {scenario}'
                        ),
                        synonyms=[f'{code.upper()} synthetic synonym with several readable words'],
                    )
                self.stdout.write(f'Created proposed species {species.pk}: {scenario}.')
