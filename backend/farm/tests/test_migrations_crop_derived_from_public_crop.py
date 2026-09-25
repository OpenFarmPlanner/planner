import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


@pytest.mark.django_db(transaction=True)
class TestBackfillCropProvenance:
    migrate_from = ('farm', '0108_publiccropspeciesrelinkrequest_to_variety')
    migrate_to = ('farm', '0109_crop_derived_from_public_crop')

    def setup_method(self):
        self.executor = MigrationExecutor(connection)
        self.executor.migrate([self.migrate_from])
        old_apps = self.executor.loader.project_state([self.migrate_from]).apps

        project_model = old_apps.get_model('farm', 'Project')
        crop_model = old_apps.get_model('farm', 'Crop')
        public_crop = old_apps.get_model('farm', 'PublicCrop')

        project = project_model.objects.create(name='P', slug='p')
        self.entry_id = public_crop.objects.create(
            name='Carrot', name_normalized='carrot', variety='Mokum',
            variety_normalized='mokum', status='published', version=2,
        ).id
        self.linked_crop_id = crop_model.objects.create(
            name='Carrot', name_normalized='carrot', project=project,
            origin_type='imported', source_public_crop_id=self.entry_id,
        ).id
        self.local_crop_id = crop_model.objects.create(
            name='Beet', name_normalized='beet', project=project,
        ).id

        self.executor.loader.build_graph()
        self.executor.migrate([self.migrate_to])

    def teardown_method(self):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(executor.loader.graph.leaf_nodes())

    def test_linked_crops_derive_from_their_entry(self):
        apps = self.executor.loader.project_state([self.migrate_to]).apps
        crop_model = apps.get_model('farm', 'Crop')

        linked = crop_model.objects.get(id=self.linked_crop_id)
        assert linked.derived_from_public_crop_id == self.entry_id
        assert linked.source_public_crop_id == self.entry_id

        local = crop_model.objects.get(id=self.local_crop_id)
        assert local.derived_from_public_crop_id is None
