import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


@pytest.mark.django_db(transaction=True)
def test_existing_supplier_offers_default_to_unknown() -> None:
    executor = MigrationExecutor(connection)
    before = ('farm', '0127_extend_task_metadata')
    after = ('farm', '0128_supplier_seed_status')
    try:
        executor.migrate([before])
        apps = executor.loader.project_state([before]).apps
        project = apps.get_model('farm', 'Project').objects.create(
            name='Seed migration', slug='seed-migration',
        )
        crop = apps.get_model('farm', 'Crop').objects.create(name='Carrot', project_id=project.pk)
        supplier = apps.get_model('farm', 'Supplier').objects.create(
            name='Seeds', project_id=project.pk,
        )
        row = apps.get_model('farm', 'CropSupplierData').objects.create(
            crop_id=crop.pk, supplier_id=supplier.pk, project_id=project.pk,
            supplier_product_name='Existing offer', notes='Keep me',
            packaging_sizes=[{'size_value': 25, 'size_unit': 'g'}],
        )
        executor = MigrationExecutor(connection)
        executor.migrate([after])
        apps = executor.loader.project_state([after]).apps
        saved = apps.get_model('farm', 'CropSupplierData').objects.get(pk=row.pk)
        assert saved.seed_status == 'unknown'
        assert saved.seed_exemption_status == 'unknown'
        assert saved.notes == 'Keep me'
        assert saved.supplier_product_name == 'Existing offer'
        assert saved.packaging_sizes == [{'size_value': 25, 'size_unit': 'g'}]
        executor = MigrationExecutor(connection)
        executor.migrate([before])
        apps = executor.loader.project_state([before]).apps
        assert apps.get_model('farm', 'CropSupplierData').objects.get(pk=row.pk).notes == 'Keep me'
    finally:
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
