"""Prepare private fixtures for parcel duplication and supplier undo history."""

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import CommandError, CommandParser
from django.db import transaction

from farm.history.project_restore import ensure_project_checkpoint
from farm.management.commands.seed_library_import_acceptance import Command as LocalFixtureCommand
from farm.models import (
    Bed,
    Crop,
    CropSupplierData,
    Field,
    Location,
    Project,
    ProjectMembership,
    Supplier,
)

MARKER = 'Synthetic structure and supplier history fixture; private local test data.'


class Command(LocalFixtureCommand):
    help = 'Preview or create an isolated parcel and linked supplier offer for history checks.'

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
            self.stdout.write('Preview only: one private parcel, two beds and a linked supplier.')
            return

        with transaction.atomic():
            project, created = Project.objects.get_or_create(
                slug=f'ofp-local-structure-supplier-history-{user.pk}',
                defaults={
                    'name': 'Structure and supplier history acceptance', 'description': MARKER,
                },
            )
            if created:
                ProjectMembership.objects.create(project=project, user=user, role='admin')
                self._populate(project)
                ensure_project_checkpoint(project, user_name=user.username)
            elif project.description != MARKER or not ProjectMembership.objects.filter(
                project=project, user=user, role='admin',
            ).exists():
                raise CommandError('Fixture slug has different ownership; nothing changed.')
        self.stdout.write(f'Open project {project.pk} to check the North field and Seed nursery.')

    def _populate(self, project: Project) -> None:
        location = Location.objects.create(project=project, name='Acceptance garden')
        field = Field.objects.create(
            project=project, location=location, name='North field', length_m=24, width_m=10,
            light_condition='shade', cultivation_environment='greenhouse',
        )
        Bed.objects.create(
            project=project, field=field, name='North 1', length_m=12, width_m=1.5,
        )
        Bed.objects.create(
            project=project, field=field, name='North 2', area_sqm=8, irrigation='available',
        )
        supplier = Supplier.objects.create(project=project, name='Seed nursery')
        crop = Crop.objects.create(
            project=project, name='Lettuce', supplier=supplier,
            selected_seed_demand_supplier=supplier,
        )
        CropSupplierData.objects.create(
            project=project, crop=crop, supplier=supplier, supplier_product_name='Lettuce seeds',
            seed_status='conventional', seed_exemption_status='approved', price=Decimal('4.25'),
        )
