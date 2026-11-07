import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


@pytest.mark.django_db(transaction=True)
class TestSowingDepthRangeMigration:
    migrate_from = [('farm', '0135_backfill_demo_dashboard_tasks')]
    migrate_to = [('farm', '0136_sowing_depth_range')]

    def setup_method(self):
        self.executor = MigrationExecutor(connection)
        self.executor.migrate(self.migrate_from)
        old_apps = self.executor.loader.project_state(self.migrate_from).apps
        project_model = old_apps.get_model('farm', 'Project')
        crop_model = old_apps.get_model('farm', 'Crop')
        public_crop_model = old_apps.get_model('farm', 'PublicCrop')

        project = project_model.objects.create(name='Depth', slug='sowing-depth-migration')
        # Historical models skip Crop.save(), which fills the normalized names.
        self.with_depth = crop_model.objects.create(
            project=project, name='Möhre', name_normalized='möhre', variety='', sowing_depth_m=0.02,
        )
        self.without_depth = crop_model.objects.create(
            project=project, name='Salat', name_normalized='salat', variety='',
        )
        self.public = public_crop_model.objects.create(
            name='Möhre', name_normalized='möhre', sowing_depth_m=0.015,
        )

        self.executor.loader.build_graph()
        self.executor.migrate(self.migrate_to)
        self.new_apps = self.executor.loader.project_state(self.migrate_to).apps

    def teardown_method(self):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(executor.loader.graph.leaf_nodes())

    def test_an_existing_depth_becomes_a_range_of_one(self):
        crop_model = self.new_apps.get_model('farm', 'Crop')
        public_crop_model = self.new_apps.get_model('farm', 'PublicCrop')
        crop = crop_model.objects.get(pk=self.with_depth.pk)
        assert (crop.sowing_depth_m, crop.sowing_depth_max_m) == (0.02, 0.02)
        empty = crop_model.objects.get(pk=self.without_depth.pk)
        assert (empty.sowing_depth_m, empty.sowing_depth_max_m) == (None, None)
        public = public_crop_model.objects.get(pk=self.public.pk)
        assert (public.sowing_depth_m, public.sowing_depth_max_m) == (0.015, 0.015)
