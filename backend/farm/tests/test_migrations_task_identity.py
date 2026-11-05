"""Task deletion metadata migrates without changing existing work."""

from datetime import date

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class TaskIdentityMigrationTest(TransactionTestCase):
    def test_forward_and_reverse_preserve_task_rows(self) -> None:
        before = [('farm', '0130_generate_plan_event_tasks')]
        after = [('farm', '0131_preserve_generated_task_identity')]
        try:
            executor = MigrationExecutor(connection)
            executor.migrate(before)
            apps = executor.loader.project_state(before).apps
            project = apps.get_model('farm', 'Project').objects.create(
                name='Identity', slug='identity',
            )
            season = apps.get_model('farm', 'Season').objects.create(
                project=project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
            )
            plan = apps.get_model('farm', 'PlantingPlan').objects.create(
                project=project, season=season,
            )
            task = apps.get_model('farm', 'Task').objects.create(
                project=project, season=season, planting_plan=plan, title='Completed',
                status='completed', due_date=date(2026, 5, 1),
            )
            executor = MigrationExecutor(connection)
            executor.migrate(after)
            apps = executor.loader.project_state(after).apps
            apps.get_model('farm', 'PlantingPlan').objects.filter(pk=plan.pk).delete()
            retained = apps.get_model('farm', 'Task').objects.get(pk=task.pk)
            self.assertIsNone(retained.planting_plan_id)
            self.assertIsNone(retained.deleted_at)
            self.assertEqual(retained.status, 'completed')
            executor = MigrationExecutor(connection)
            executor.migrate(before)
            Task = executor.loader.project_state(before).apps.get_model('farm', 'Task')
            retained = Task.objects.get(pk=task.pk)
            self.assertEqual(retained.due_date, date(2026, 5, 1))
        finally:
            executor = MigrationExecutor(connection)
            executor.migrate(executor.loader.graph.leaf_nodes())
