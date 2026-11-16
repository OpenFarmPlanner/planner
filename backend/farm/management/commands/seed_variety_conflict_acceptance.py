"""Prepare private local fixtures for rejected variety identity changes."""

from django.contrib.auth import get_user_model
from django.core.management.base import CommandError, CommandParser
from django.db import transaction
from django.utils import timezone

from farm.management.commands.seed_library_import_acceptance import Command as LocalFixtureCommand
from farm.models import Crop, EntityRevision, Project, ProjectMembership, Supplier

MARKER = 'Synthetic variety conflict acceptance fixture v1; private local test data.'


class Command(LocalFixtureCommand):
    help = 'Preview or prepare an isolated variety-conflict project without resetting edits.'

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
                'Preview only: one private project; rename, restore and undelete conflicts. '
                'No global records or existing projects will change.'
            )
            return
        with transaction.atomic():
            project, created = Project.objects.get_or_create(
                slug=f'ofp-local-variety-conflict-{user.pk}',
                defaults={'name': 'Variety conflict acceptance', 'description': MARKER},
            )
            if not created:
                if project.description != MARKER or not ProjectMembership.objects.filter(
                    project=project, user=user, role='admin',
                ).exists():
                    raise CommandError('Fixture slug has different ownership; nothing changed.')
                self.stdout.write(f'Kept project {project.pk}; manual edits were not reset.')
                return
            ProjectMembership.objects.create(project=project, user=user, role='admin')
            supplier = Supplier.objects.create(project=project, name='Synthetic identity supplier')
            general = Crop.objects.create(project=project, name='Source')
            for name in ('Source', 'Target'):
                Crop.objects.create(project=project, name=name, variety='V', supplier=supplier)
            historical = Crop.objects.create(
                project=project, name='Beet', variety='Boro', supplier=supplier,
            )
            revision = EntityRevision.objects.filter(
                entity_type='crop', object_id=historical.pk,
            ).latest('pk')
            historical.variety = 'Boltardy'
            historical.save()
            Crop.objects.create(project=project, name='Beet', variety='Boro', supplier=supplier)
            for value in (supplier, None):
                name = 'Carrot supplied' if value else 'Carrot no supplier'
                old = Crop.objects.create(
                    project=project, name=name, variety='Nantes', supplier=value,
                )
                old.deleted_at = timezone.now()
                old.save()
                Crop.objects.create(project=project, name=name, variety='Nantes', supplier=value)
            self.stdout.write(
                f'Project {project.pk}: rename general crop {general.pk} Source to Target; '
                f'restore Beet {historical.pk} to revision {revision.pk}; '
                'undelete either Carrot Nantes. Each must report a conflict without changing data.'
            )
