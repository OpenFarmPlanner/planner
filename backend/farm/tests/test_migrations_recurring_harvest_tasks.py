from datetime import date
from importlib import import_module
from typing import ClassVar

import pytest
from django.apps.registry import Apps
from django.db import connection

from farm.tests.migration_base import MigrationTestBase


@pytest.mark.django_db
class TestRecurringHarvestTasksMigration(MigrationTestBase):
    migrate_from: ClassVar = [('farm', '0161_supplier_package_pricing')]
    migrate_to: ClassVar = [('farm', '0162_recurring_harvest_start_tasks')]

    @classmethod
    def seed_before_migration(cls, apps: Apps) -> None:
        project = apps.get_model('farm', 'Project').objects.create(
            name='Legacy perennial task project', slug='legacy-perennial-tasks',
        )
        species = apps.get_model('crops', 'CropSpecies').objects.create(name='Perennial task crop')
        crops = apps.get_model('farm', 'Crop').objects
        crops.create(
            project=project, crop_species=species, name='Legacy crop',
            name_normalized='legacy crop',
            life_cycle='perennial', annual_harvest_window='11-15/01-10',
            first_harvest_delay_years=1, cultivation_types=['direct_sowing'],
        )
        variety = crops.create(
            project=project, crop_species=species, name='Legacy crop', name_normalized='legacy',
            variety='Red', variety_normalized='red',
        )
        seasons = apps.get_model('farm', 'Season').objects
        first = seasons.create(
            project=project, start_date=date(2022, 1, 1), end_date=date(2022, 8, 31),
        )
        for year in range(2022, 2025):
            seasons.create(
                project=project, start_date=date(year, 9, 1), end_date=date(year + 1, 8, 31),
            )
        plan = apps.get_model('farm', 'PlantingPlan').objects.create(
            project=project, season=first, crop=variety, planting_date=date(2022, 4, 1),
            clearing_date=date(2025, 1, 8),
            harvest_window_overrides={
                '2024': {'start_date': '2025-01-03', 'end_date': '2025-01-08'},
            },
        )
        cls.legacy = apps.get_model('farm', 'Task').objects.create(
            project=project, season=first, crop=variety, planting_plan=plan,
            title='Custom completed title', origin='automatic', status='completed',
            source_key=f'plan:{plan.pk}:event:harvest_start', occurrence_index=0,
            due_date=date(2024, 1, 6), calculated_due_date=date(2024, 1, 6),
        )

    def test_adopts_history_and_generates_missing_pending_work_in_the_actual_season(self) -> None:
        task_model = self.new_apps.get_model('farm', 'Task')
        tasks = task_model.objects.filter(source_key=self.legacy.source_key)
        assert tasks.count() == 2
        legacy = tasks.get(occurrence_index=2023)
        assert legacy.pk == self.legacy.pk
        assert legacy.title == 'Custom completed title'
        assert legacy.status == 'completed'
        assert legacy.due_date == date(2024, 1, 6)
        assert legacy.season_id == self.legacy.season_id
        pending = tasks.get(occurrence_index=2024)
        assert pending.status == 'pending'
        assert pending.due_date == pending.calculated_due_date == date(2025, 1, 3)
        assert pending.season.start_date == date(2024, 9, 1)
        assert pending.planting_plan_id == legacy.planting_plan_id

    def test_replay_keeps_task_ids(self) -> None:
        task_model = self.new_apps.get_model('farm', 'Task')
        tasks = task_model.objects.filter(source_key=self.legacy.source_key).order_by('pk')
        before = list(tasks.values_list('pk', 'occurrence_index', 'status', 'due_date'))
        migration = import_module('farm.migrations.0162_recurring_harvest_start_tasks')
        migration.backfill_tasks(self.new_apps, connection.schema_editor())
        assert list(tasks.values_list('pk', 'occurrence_index', 'status', 'due_date')) == before
