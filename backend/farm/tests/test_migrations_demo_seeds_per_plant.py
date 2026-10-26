import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone


@pytest.mark.django_db(transaction=True)
class TestRepairDemoSeedsPerPlantMigration:
    migrate_from = [('farm', '0118_project_succession_during_harvest')]
    migrate_to = [('farm', '0119_repair_demo_fractional_seeds_per_plant')]

    def setup_method(self):
        self.executor = MigrationExecutor(connection)
        self.executor.migrate(self.migrate_from)
        old_apps = self.executor.loader.project_state(self.migrate_from).apps
        project_model = old_apps.get_model('farm', 'Project')
        crop_model = old_apps.get_model('farm', 'Crop')

        demo = project_model.objects.create(
            name='Solawi Sonnenacker', slug='repair-demo', demo_seeded_at=timezone.now(),
        )
        regular = project_model.objects.create(name='Echt', slug='repair-regular')

        def crop(project, name, value, unit='seeds_per_plant'):
            return crop_model.objects.create(
                project=project,
                name=name,
                # Historical models skip Crop.save(), which fills this in.
                name_normalized=name.lower(),
                seed_rate_pre_cultivation_value=value,
                seed_rate_pre_cultivation_unit=unit,
            ).pk

        self.crop_ids = {
            'demo_1_2': crop(demo, 'Tomate', 1.2),
            'demo_1_5': crop(demo, 'Mangold', 1.5),
            'demo_whole': crop(demo, 'Lauch', 2.0),
            'demo_other_unit': crop(demo, 'Karotte', 1.2, unit='g_per_m2'),
            'regular_1_2': crop(regular, 'Tomate', 1.2),
        }

        self.executor.loader.build_graph()
        self.executor.migrate(self.migrate_to)
        self.new_apps = self.executor.loader.project_state(self.migrate_to).apps

    def teardown_method(self):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(executor.loader.graph.leaf_nodes())

    def _value(self, key):
        crop_model = self.new_apps.get_model('farm', 'Crop')
        return crop_model.objects.get(pk=self.crop_ids[key]).seed_rate_pre_cultivation_value

    def test_old_demo_seed_values_become_whole_seeds(self):
        assert self._value('demo_1_2') == 1.0
        assert self._value('demo_1_5') == 1.0

    def test_leaves_other_values_units_and_non_demo_projects_alone(self):
        assert self._value('demo_whole') == 2.0
        assert self._value('demo_other_unit') == 1.2
        assert self._value('regular_1_2') == 1.2
