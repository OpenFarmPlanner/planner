"""Existing task identities and manual dates survive the metadata backfill."""

from datetime import date

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class TaskMetadataMigrationTest(TransactionTestCase):
    def test_forward_and_reverse_preserve_legacy_tasks(self) -> None:
        before = [('farm', '0126_add_crop_germination')]
        after = [('farm', '0127_extend_task_metadata')]
        executor = MigrationExecutor(connection)
        try:
            executor.migrate(before)
            apps = executor.loader.project_state(before).apps
            project = apps.get_model('farm', 'Project').objects.create(name='Tasks', slug='tasks')
            crop = apps.get_model('farm', 'Crop').objects.create(project=project, name='Carrot')
            season = apps.get_model('farm', 'Season').objects.create(
                project=project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
            )
            plan = apps.get_model('farm', 'PlantingPlan').objects.create(
                project=project, crop=crop, season=season,
            )
            tasks = apps.get_model('farm', 'Task').objects
            linked = tasks.create(
                project=project, planting_plan=plan, title='Keep me', description='Manual',
                due_date=date(2026, 4, 2), status='completed',
            )
            standalone = tasks.create(project=project, title='Standalone')
            executor = MigrationExecutor(connection)
            executor.migrate(after)
            tasks = executor.loader.project_state(after).apps.get_model('farm', 'Task').objects
            migrated = tasks.get(pk=linked.pk)
            self.assertEqual(migrated.season_id, season.pk)
            self.assertEqual(migrated.crop_id, crop.pk)
            self.assertEqual(migrated.due_date, date(2026, 4, 2))
            self.assertEqual(migrated.status, 'completed')
            self.assertEqual(migrated.description, 'Manual')
            self.assertEqual(migrated.origin, 'manual')
            self.assertEqual(migrated.source_key, '')
            self.assertIsNone(migrated.calculated_due_date)
            self.assertFalse(migrated.due_date_overridden)
            self.assertIsNone(tasks.get(pk=standalone.pk).season_id)
            executor = MigrationExecutor(connection)
            executor.migrate(before)
            old_tasks = executor.loader.project_state(before).apps.get_model('farm', 'Task').objects
            self.assertEqual(old_tasks.get(pk=linked.pk).status, 'completed')
            self.assertEqual(old_tasks.count(), 2)
        finally:
            executor = MigrationExecutor(connection)
            executor.migrate(executor.loader.graph.leaf_nodes())
