"""Create local supplier offers for checking package prices and offer metadata."""

from django.contrib.auth import get_user_model
from django.core.management.base import CommandError, CommandParser
from django.db import transaction

from farm.history.project_restore import ensure_project_checkpoint
from farm.management.commands.seed_library_import_acceptance import Command as LocalFixtureCommand
from farm.models import Crop, CropSupplierData, Project, ProjectMembership, Supplier

MARKER = 'Synthetic supplier offer acceptance fixture; private local test data.'


class Command(LocalFixtureCommand):
    help = 'Preview or create a private project with priced packages and a legacy offer price.'

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
            self.stdout.write('Preview only: one private project, one crop and two offers.')
            return

        with transaction.atomic():
            project, created = Project.objects.get_or_create(
                slug=f'ofp-local-supplier-offers-{user.pk}',
                defaults={'name': 'Supplier offer acceptance', 'description': MARKER},
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
        crop = Crop.objects.create(project=project, name='Karotte')
        local = Supplier.objects.create(
            project=project, name='Saatgut Nord', homepage_url='https://nord.example.invalid',
        )
        imports = Supplier.objects.create(
            project=project, name='Seed Imports', homepage_url='https://imports.example.invalid',
        )
        CropSupplierData.objects.create(
            crop=crop, project=project, supplier=local, supplier_product_name='Nantaise',
            supplier_product_url='https://nord.example.invalid/karotte',
            source_url='https://nord.example.invalid/katalog', germination_rate=85,
            notes='Katalogpreis', package_currency='EUR',
            packaging_sizes=[
                {'size_value': 100, 'size_unit': 'seeds', 'price': '4.0000'},
                {'size_value': 500, 'size_unit': 'seeds', 'price': '12.0000'},
                {'size_value': 10, 'size_unit': 'seeds', 'price': '0.0000'},
                {'size_value': 25, 'size_unit': 'g'},
            ],
        )
        CropSupplierData.objects.create(
            crop=crop, project=project, supplier=imports, price='9.90',
            packaging_sizes=[{'size_value': 50, 'size_unit': 'g'}],
        )
