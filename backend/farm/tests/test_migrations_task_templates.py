"""Template schema rollback preserves generated task rows."""

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class TaskTemplateMigrationTest(TransactionTestCase):
    def test_task_rows_survive_template_schema_rollback(self) -> None:
        before = [('farm', '0131_preserve_generated_task_identity')]
        after = [('farm', '0132_add_crop_task_templates')]
        try:
            executor = MigrationExecutor(connection)
            executor.migrate(before)
            apps = executor.loader.project_state(before).apps
            project = apps.get_model('farm', 'Project').objects.create(name='Rules', slug='rules')
            crop = apps.get_model('farm', 'Crop').objects.create(project=project, name='Crop')
            task = apps.get_model('farm', 'Task').objects.create(
                project=project, crop=crop, title='Completed work', status='completed',
            )
            executor = MigrationExecutor(connection)
            executor.migrate(after)
            apps = executor.loader.project_state(after).apps
            template = apps.get_model('farm', 'CropTaskTemplate').objects.create(
                project_id=project.pk, crop_id=crop.pk, title='Rule', reference_event='sowing',
            )
            apps.get_model('farm', 'Task').objects.filter(pk=task.pk).update(template=template)
            executor = MigrationExecutor(connection)
            executor.migrate(before)
            Task = executor.loader.project_state(before).apps.get_model('farm', 'Task')
            self.assertEqual(Task.objects.get(pk=task.pk).status, 'completed')
        finally:
            executor = MigrationExecutor(connection)
            executor.migrate(executor.loader.graph.leaf_nodes())


class TaskRecurrenceMigrationTest(TransactionTestCase):
    def test_existing_single_templates_and_tasks_survive_round_trip(self) -> None:
        before = [('farm', '0132_add_crop_task_templates')]
        after = [('farm', '0134_validate_template_recurrence')]
        try:
            executor = MigrationExecutor(connection)
            executor.migrate(before)
            apps = executor.loader.project_state(before).apps
            project = apps.get_model('farm', 'Project').objects.create(name='Repeat', slug='repeat')
            crop = apps.get_model('farm', 'Crop').objects.create(project=project, name='Crop')
            template = apps.get_model('farm', 'CropTaskTemplate').objects.create(
                project=project, crop=crop, title='Rule', reference_event='planting',
            )
            task = apps.get_model('farm', 'Task').objects.create(
                project=project, template=template, title='Done', status='completed',
            )
            executor = MigrationExecutor(connection)
            executor.migrate(after)
            apps = executor.loader.project_state(after).apps
            retained = apps.get_model('farm', 'CropTaskTemplate').objects.get(pk=template.pk)
            self.assertIsNone(retained.repeat_interval_days)
            self.assertEqual(retained.repeat_until, '')
            self.assertIsNone(retained.repeat_count)
            executor = MigrationExecutor(connection)
            executor.migrate(before)
            Task = executor.loader.project_state(before).apps.get_model('farm', 'Task')
            self.assertEqual(Task.objects.get(pk=task.pk).status, 'completed')
        finally:
            executor = MigrationExecutor(connection)
            executor.migrate(executor.loader.graph.leaf_nodes())
