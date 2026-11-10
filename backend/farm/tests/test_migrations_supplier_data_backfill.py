import pytest

from farm.tests.migration_base import MigrationTestBase


@pytest.mark.django_db
class TestSupplierDataBackfillMigration(MigrationTestBase):
    migrate_from = [('farm', '0059_culture_selected_seed_demand_supplier')]
    migrate_to = [('farm', '0060_backfill_supplier_data_from_culture_seed_fields')]

    @classmethod
    def seed_before_migration(cls, apps):
        project_model = apps.get_model('farm', 'Project')
        crop_model = apps.get_model('farm', 'Culture')
        supplier_model = apps.get_model('farm', 'Supplier')
        crop_supplier_data_model = apps.get_model('farm', 'CultureSupplierData')
        seed_package_model = apps.get_model('farm', 'SeedPackage')

        project = project_model.objects.create(name='Migration Project', slug='migration-project')
        supplier = supplier_model.objects.create(name='Migration Supplier', homepage_url='https://supplier.example', project_id=project.id)

        crop = crop_model.objects.create(
            name='Carrot',
            name_normalized='carrot',
            variety='Nantaise',
            project_id=project.id,
            thousand_kernel_weight_g=3.5,
        )
        crop_supplier_data_model.objects.create(
            culture_id=crop.id,
            supplier_id=supplier.id,
            project_id=project.id,
            packaging_sizes=[],
            thousand_kernel_weight_g=None,
        )
        seed_package_model.objects.create(
            culture_id=crop.id,
            project_id=project.id,
            size_value='25.0',
            size_unit='g',
        )

        preserved = crop_model.objects.create(
            name='Beet',
            name_normalized='beet',
            variety='Detroit',
            project_id=project.id,
            thousand_kernel_weight_g=9.5,
        )
        crop_supplier_data_model.objects.create(
            culture_id=preserved.id,
            supplier_id=supplier.id,
            project_id=project.id,
            packaging_sizes=[{'size_value': 10, 'size_unit': 'g'}],
            thousand_kernel_weight_g=1.2,
        )
        seed_package_model.objects.create(
            culture_id=preserved.id,
            project_id=project.id,
            size_value='99.0',
            size_unit='g',
        )

    def test_migration_copies_legacy_values_to_empty_supplier_data(self):
        apps = self.new_apps
        crop_model = apps.get_model('farm', 'Culture')
        crop_supplier_data_model = apps.get_model('farm', 'CultureSupplierData')

        crop = crop_model.objects.get(name='Carrot')
        supplier_data = crop_supplier_data_model.objects.get(culture_id=crop.id)

        assert supplier_data.thousand_kernel_weight_g == 3.5
        assert supplier_data.packaging_sizes == [{'size_value': 25.0, 'size_unit': 'g'}]

    def test_migration_does_not_overwrite_existing_supplier_specific_values(self):
        apps = self.new_apps
        crop_model = apps.get_model('farm', 'Culture')
        crop_supplier_data_model = apps.get_model('farm', 'CultureSupplierData')

        crop = crop_model.objects.get(name='Beet')
        supplier_data = crop_supplier_data_model.objects.get(culture_id=crop.id)

        assert supplier_data.thousand_kernel_weight_g == 1.2
        assert supplier_data.packaging_sizes == [{'size_value': 10, 'size_unit': 'g'}]
