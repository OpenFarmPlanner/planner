from datetime import date
from typing import ClassVar

import pytest
from django.apps.registry import Apps

from farm.tests.migration_base import MigrationTestBase

LEGACY_POSITIONS = [{'id': '31e742f9-2332-44ce-83f2-a496a3bc2de7', 'x_m': 1.25, 'y_m': 7.6}]


@pytest.mark.django_db
class TestBedIndividualPlacementMigration(MigrationTestBase):
    migrate_from: ClassVar = [('farm', '0171_user_action_activity')]
    migrate_to: ClassVar = [('farm', '0172_bed_individual_placement')]

    @classmethod
    def seed_before_migration(cls, apps: Apps) -> None:
        project = apps.get_model('farm', 'Project').objects.create(
            name='Legacy placement', slug='legacy-placement',
        )
        location = apps.get_model('farm', 'Location').objects.create(
            project=project, name='Legacy location',
        )
        parcel = apps.get_model('farm', 'Field').objects.create(
            project=project, location=location, name='Legacy parcel', width_m=5, length_m=10,
        )
        bed = apps.get_model('farm', 'Bed').objects.create(
            project=project, field=parcel, name='Legacy bed', area_sqm=5,
        )
        crop = apps.get_model('farm', 'Crop').objects.create(
            project=project, name='Legacy crop', name_normalized='legacy crop',
        )
        plans = apps.get_model('farm', 'PlantingPlan').objects
        plans.create(
            project=project, parcel=parcel, crop=crop, notes='Legacy direct placement',
            planting_date=date(2026, 3, 1), individual_positions=LEGACY_POSITIONS,
        )
        plans.create(
            project=project, bed=bed, crop=crop, notes='Legacy area plan', area_usage_sqm=3,
        )

    def test_preserves_existing_stem_ids_coordinates_and_area(self):
        plans = self.new_apps.get_model('farm', 'PlantingPlan').objects
        direct = plans.get(notes='Legacy direct placement')
        area = plans.get(notes='Legacy area plan')
        assert direct.parcel_id is not None
        assert direct.bed_id is None
        assert direct.individual_bed is False
        assert direct.individual_positions == LEGACY_POSITIONS
        assert area.bed_id is not None
        assert area.parcel_id is None
        assert area.individual_bed is False
        assert area.individual_positions == []
        assert area.area_usage_sqm == 3
