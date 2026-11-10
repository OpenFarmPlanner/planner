from decimal import Decimal

import pytest

from farm.tests.migration_base import MigrationTestBase


@pytest.mark.django_db
class TestConsolidateSupplierTkgMigration(MigrationTestBase):
    migrate_from = [('farm', '0063_location_agronomic_fields')]
    migrate_to = [('farm', '0064_tkg_decimal_precision')]

    @classmethod
    def seed_before_migration(cls, apps):
        project_model = apps.get_model('farm', 'Project')
        crop_model = apps.get_model('farm', 'Culture')
        supplier_model = apps.get_model('farm', 'Supplier')
        crop_supplier_data_model = apps.get_model('farm', 'CultureSupplierData')

        project = project_model.objects.create(name='TKG Consolidation Project', slug='tkg-consolidation-project')
        supplier_a = supplier_model.objects.create(
            name='Supplier A',
            name_normalized='supplier a',
            homepage_url='https://a.example',
            slug='supplier-a',
            project_id=project.id,
        )
        supplier_b = supplier_model.objects.create(
            name='Supplier B',
            name_normalized='supplier b',
            homepage_url='https://b.example',
            slug='supplier-b',
            project_id=project.id,
        )

        unified = crop_model.objects.create(
            name='Unified',
            name_normalized='unified',
            project_id=project.id,
            thousand_kernel_weight_g=None,
        )
        crop_supplier_data_model.objects.create(
            culture_id=unified.id,
            supplier_id=supplier_a.id,
            project_id=project.id,
            thousand_kernel_weight_g=3.4,
            packaging_sizes=[],
        )
        crop_supplier_data_model.objects.create(
            culture_id=unified.id,
            supplier_id=supplier_b.id,
            project_id=project.id,
            thousand_kernel_weight_g=3.4,
            packaging_sizes=[],
        )

        single = crop_model.objects.create(
            name='Single',
            name_normalized='single',
            project_id=project.id,
            thousand_kernel_weight_g=None,
        )
        crop_supplier_data_model.objects.create(
            culture_id=single.id,
            supplier_id=supplier_a.id,
            project_id=project.id,
            thousand_kernel_weight_g=5.6,
            packaging_sizes=[],
        )

        conflict = crop_model.objects.create(
            name='Conflict',
            name_normalized='conflict',
            project_id=project.id,
            thousand_kernel_weight_g=None,
        )
        crop_supplier_data_model.objects.create(
            culture_id=conflict.id,
            supplier_id=supplier_a.id,
            project_id=project.id,
            thousand_kernel_weight_g=1.2,
            packaging_sizes=[],
        )
        crop_supplier_data_model.objects.create(
            culture_id=conflict.id,
            supplier_id=supplier_b.id,
            project_id=project.id,
            thousand_kernel_weight_g=2.2,
            packaging_sizes=[],
        )

        existing = crop_model.objects.create(
            name='Existing',
            name_normalized='existing',
            project_id=project.id,
            thousand_kernel_weight_g=9.9,
        )
        crop_supplier_data_model.objects.create(
            culture_id=existing.id,
            supplier_id=supplier_a.id,
            project_id=project.id,
            thousand_kernel_weight_g=4.5,
            packaging_sizes=[],
        )

    def test_migration_moves_unique_supplier_tkg_to_crop(self):
        apps = self.new_apps
        crop_model = apps.get_model('farm', 'Culture')

        unified = crop_model.objects.get(name='Unified')
        assert unified.thousand_kernel_weight_g == Decimal('3.40')

    def test_migration_moves_single_supplier_tkg_to_crop(self):
        apps = self.new_apps
        crop_model = apps.get_model('farm', 'Culture')

        single = crop_model.objects.get(name='Single')
        assert single.thousand_kernel_weight_g == Decimal('5.60')

    def test_migration_does_not_copy_conflicting_supplier_tkg_to_crop(self):
        apps = self.new_apps
        crop_model = apps.get_model('farm', 'Culture')

        conflict = crop_model.objects.get(name='Conflict')
        assert conflict.thousand_kernel_weight_g is None

    def test_migration_does_not_overwrite_existing_crop_tkg(self):
        apps = self.new_apps
        crop_model = apps.get_model('farm', 'Culture')

        existing = crop_model.objects.get(name='Existing')
        assert existing.thousand_kernel_weight_g == Decimal('9.90')
