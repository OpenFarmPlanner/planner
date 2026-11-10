import pytest
from django.utils import timezone

from farm.tests.migration_base import MigrationTestBase


@pytest.mark.django_db
class TestRepairDemoSeedsPerPlantMigration(MigrationTestBase):
    migrate_from = [('farm', '0118_project_succession_during_harvest')]
    migrate_to = [('farm', '0119_repair_demo_fractional_seeds_per_plant')]

    @classmethod
    def seed_before_migration(cls, apps):
        project_model = apps.get_model('farm', 'Project')
        crop_model = apps.get_model('farm', 'Crop')

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

        cls.crop_ids = {
            'demo_1_2': crop(demo, 'Tomate', 1.2),
            'demo_1_5': crop(demo, 'Mangold', 1.5),
            'demo_whole': crop(demo, 'Lauch', 2.0),
            'demo_other_unit': crop(demo, 'Karotte', 1.2, unit='g_per_m2'),
            'regular_1_2': crop(regular, 'Tomate', 1.2),
        }

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
