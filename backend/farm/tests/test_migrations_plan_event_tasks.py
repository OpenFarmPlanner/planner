"""Backfill preserves existing task identities and survives non-destructive rollback."""

from datetime import date

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class PlanEventTasksMigrationTest(TransactionTestCase):
    def test_backfill_inheritance_manual_work_and_replay(self) -> None:
        before = [('farm', '0129_add_task_field')]
        after = [('farm', '0130_generate_plan_event_tasks')]
        executor = MigrationExecutor(connection)
        try:
            executor.migrate(before)
            apps = executor.loader.project_state(before).apps
            project = apps.get_model('farm', 'Project').objects.create(name='Tasks', slug='events')
            season = apps.get_model('farm', 'Season').objects.create(
                project=project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
            )
            species = apps.get_model('crops', 'CropSpecies').objects.create(name='Task fixture')
            Crop = apps.get_model('farm', 'Crop')
            Crop.objects.create(
                project=project, name='General', crop_species=species,
                propagation_duration_days=30, growth_duration_days=60,
                cultivation_type='pre_cultivation', cultivation_types=['pre_cultivation'],
            )
            variety = Crop.objects.create(
                project=project, name='Variety', crop_species=species,
                variety='Early', variety_normalized='early',
            )
            Plan = apps.get_model('farm', 'PlantingPlan')
            plan = Plan.objects.create(
                project=project, season=season, crop=variety, planting_date=date(2026, 5, 1),
            )
            unassigned = Plan.objects.create(
                project=project, crop=variety, planting_date=date(2026, 5, 1),
            )
            Task = apps.get_model('farm', 'Task')
            manual = Task.objects.create(project=project, title='Manual', status='completed')
            existing = Task.objects.create(
                project=project, season=season, planting_plan=plan, title='Custom title',
                origin='automatic', source_key=f'plan:{plan.pk}:event:planting',
                due_date=date(2026, 4, 15), status='completed', due_date_overridden=True,
            )
            executor = MigrationExecutor(connection)
            executor.migrate(after)
            tasks = executor.loader.project_state(after).apps.get_model('farm', 'Task').objects
            self.assertEqual(tasks.count(), 4)
            self.assertEqual(tasks.get(pk=manual.pk).status, 'completed')
            self.assertEqual(tasks.get(pk=existing.pk).title, 'Custom title')
            self.assertEqual(tasks.get(pk=existing.pk).due_date, date(2026, 4, 15))
            self.assertTrue(tasks.filter(
                source_key=f'plan:{plan.pk}:event:propagation_start', due_date=date(2026, 4, 1),
            ).exists())
            self.assertTrue(tasks.filter(
                source_key=f'plan:{plan.pk}:event:harvest_start', due_date=date(2026, 6, 30),
            ).exists())
            self.assertFalse(tasks.filter(planting_plan_id=unassigned.pk).exists())
            ids = set(tasks.values_list('id', flat=True))
            executor = MigrationExecutor(connection)
            executor.migrate(before)
            executor = MigrationExecutor(connection)
            executor.migrate(after)
            tasks = executor.loader.project_state(after).apps.get_model('farm', 'Task').objects
            self.assertEqual(set(tasks.values_list('id', flat=True)), ids)
        finally:
            executor = MigrationExecutor(connection)
            executor.migrate(executor.loader.graph.leaf_nodes())
