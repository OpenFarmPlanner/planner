"""Hint migration preserves existing user preferences on forward and reverse."""

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class TaskDragHintMigrationTest(TransactionTestCase):
    def test_preferences_survive_round_trip(self) -> None:
        before = [('accounts', '0015_userprojectsettings_table_edit_hint')]
        after = [('accounts', '0016_task_drag_hint')]
        try:
            executor = MigrationExecutor(connection)
            executor.migrate(before)
            apps = executor.loader.project_state(before).apps
            user = apps.get_model('auth', 'User').objects.create(username='hint-migration')
            row = apps.get_model('accounts', 'UserProjectSettings').objects.create(
                user=user, ui_language='fr', table_edit_hint_done=True,
            )
            executor = MigrationExecutor(connection)
            executor.migrate(after)
            apps = executor.loader.project_state(after).apps
            model = apps.get_model('accounts', 'UserProjectSettings')
            migrated = model.objects.get(pk=row.pk)
            self.assertFalse(migrated.task_drag_hint_done)
            self.assertEqual(migrated.ui_language, 'fr')
            executor = MigrationExecutor(connection)
            executor.migrate(before)
            apps = executor.loader.project_state(before).apps
            model = apps.get_model('accounts', 'UserProjectSettings')
            self.assertTrue(model.objects.get(pk=row.pk).table_edit_hint_done)
        finally:
            executor = MigrationExecutor(connection)
            executor.migrate(executor.loader.graph.leaf_nodes())
