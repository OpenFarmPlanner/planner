from typing import ClassVar

import pytest
from django.apps.registry import Apps

from farm.tests.migration_base import MigrationTestBase


@pytest.mark.django_db
class TestCropLightTolerancesMigration(MigrationTestBase):
    migrate_from: ClassVar = [('farm', '0149_location_boundary_origin')]
    migrate_to: ClassVar = [('farm', '0150_crop_light_tolerances')]

    @classmethod
    def seed_before_migration(cls, apps: Apps) -> None:
        project = apps.get_model('farm', 'Project').objects.create(
            name='Light tolerance migration', slug='light-tolerance-migration',
        )
        for value in ('', 'full_sun', 'partial_shade', 'shade'):
            name = f'Legacy light {value}'
            apps.get_model('farm', 'Crop').objects.create(
                name=name, name_normalized=name.strip().lower(), project=project,
                light_requirement=value,
            )
            apps.get_model('farm', 'PublicCrop').objects.create(name=name, light_requirement=value)

    def test_preserves_single_choices_and_unset_on_both_models(self) -> None:
        for model_name in ('Crop', 'PublicCrop'):
            model = self.new_apps.get_model('farm', model_name)
            rows = model.objects.filter(name__startswith='Legacy light ')
            assert dict(rows.values_list('name', 'light_requirement')) == {
                'Legacy light ': [],
                'Legacy light full_sun': ['full_sun'],
                'Legacy light partial_shade': ['partial_shade'],
                'Legacy light shade': ['shade'],
            }
