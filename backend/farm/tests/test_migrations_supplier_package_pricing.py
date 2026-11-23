from decimal import Decimal
from typing import ClassVar

import pytest
from django.apps.registry import Apps

from farm.tests.migration_base import MigrationTestBase


@pytest.mark.django_db
class TestSupplierPackagePricingMigration(MigrationTestBase):
    migrate_from: ClassVar = [('farm', '0160_perennial_harvest_window_overrides')]
    migrate_to: ClassVar = [('farm', '0161_supplier_package_pricing')]

    @classmethod
    def seed_before_migration(cls, apps: Apps) -> None:
        project = apps.get_model('farm', 'Project').objects.create(
            name='Legacy supplier offers', slug='legacy-supplier-offers',
        )
        supplier = apps.get_model('farm', 'Supplier').objects.create(
            project=project, name='Legacy supplier', name_normalized='legacy supplier',
        )
        crop = apps.get_model('farm', 'Crop').objects.create(
            project=project, name='Legacy crop', name_normalized='legacy crop',
        )
        apps.get_model('farm', 'CropSupplierData').objects.create(
            project=project, crop=crop, supplier=supplier, price=Decimal('2.50'),
            packaging_sizes=[{'size_value': 25, 'size_unit': 'g'}],
        )

    def test_leaves_legacy_amount_and_package_size_unassigned(self) -> None:
        offer = self.new_apps.get_model('farm', 'CropSupplierData').objects.get(
            project__slug='legacy-supplier-offers',
        )
        assert offer.price == Decimal('2.50')
        assert offer.packaging_sizes == [{'size_value': 25, 'size_unit': 'g'}]
        assert offer.package_currency == ''
        assert offer.project.default_currency == ''
