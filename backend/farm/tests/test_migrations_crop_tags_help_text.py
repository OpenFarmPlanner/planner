import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


@pytest.mark.django_db(transaction=True)
class TestCropTagsHelpTextMigration:
    migrate_from = [('farm', '0123_crop_tags')]
    migrate_to = [('farm', '0124_alter_crop_tags_help_text')]

    def setup_method(self):
        self.executor = MigrationExecutor(connection)
        self.executor.migrate(self.migrate_from)
        old_apps = self.executor.loader.project_state(self.migrate_from).apps
        project_model = old_apps.get_model('farm', 'Project')
        crop_model = old_apps.get_model('farm', 'Crop')

        project = project_model.objects.create(name='Tags', slug='crop-tags-migration')
        # Historical models skip Crop.save(), which fills the normalized names.
        self.kultur = crop_model.objects.create(
            project=project, name='Kamille', name_normalized='kamille',
            variety='', tags=['Kräuter', 'Blumen'],
        )
        self.sorte = crop_model.objects.create(
            project=project, name='Kamille', name_normalized='kamille',
            variety='Bodegold', variety_normalized='bodegold', tags=[],
        )

        self.executor.loader.build_graph()
        self.executor.migrate(self.migrate_to)
        self.new_apps = self.executor.loader.project_state(self.migrate_to).apps

    def teardown_method(self):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(executor.loader.graph.leaf_nodes())

    def test_existing_tags_survive(self):
        crop_model = self.new_apps.get_model('farm', 'Crop')
        assert crop_model.objects.get(pk=self.kultur.pk).tags == ['Kräuter', 'Blumen']
        assert crop_model.objects.get(pk=self.sorte.pk).tags == []
