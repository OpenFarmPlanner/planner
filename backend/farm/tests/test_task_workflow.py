"""End-to-end API invariants across generation, recurrence and season recovery."""

from datetime import date

from farm.models import Crop, CropTaskTemplate, EntityRevision, PlantingPlan, Project, Season, Task
from farm.tests.test_task_generation import TaskTimingFixture


class TaskWorkflowTest(TaskTimingFixture):
    def setUp(self) -> None:
        super().setUp()
        self.client.defaults['HTTP_X_SEASON_ID'] = str(self.season.pk)

    def test_recurrence_override_completion_deletion_and_season_recovery(self) -> None:
        template = self.client.post('/api/crop-task-templates/', {
            'crop': self.crop.pk, 'title': 'Water', 'reference_event': 'planting',
            'day_offset': -7, 'repeat_interval_days': 7, 'repeat_until': 'count', 'repeat_count': 3,
        }, format='json')
        self.assertEqual(template.status_code, 201, template.data)
        created = self.client.post('/api/planting-plans/', {
            'crop': self.crop.pk, 'season': self.season.pk,
            'cultivation_type': 'pre_cultivation', 'planting_date': '2026-05-01',
        }, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        plan_id = created.data['id']
        tasks = list(
            Task.objects.filter(template_id=template.data['id']).order_by('occurrence_index')
        )
        self.assertEqual(len(tasks), 3)
        original_ids = set(
            Task.objects.filter(planting_plan_id=plan_id).values_list('id', flat=True)
        )
        self.assertEqual(self.client.patch(f'/api/tasks/{tasks[0].pk}/', {
            'status': 'completed',
        }, format='json').status_code, 200)
        self.assertEqual(self.client.patch(f'/api/tasks/{tasks[1].pk}/', {
            'due_date': None,
        }, format='json').status_code, 200)
        self.assertEqual(self.client.delete(f'/api/tasks/{tasks[2].pk}/').status_code, 204)
        for _ in range(2):
            response = self.client.patch(f'/api/planting-plans/{plan_id}/', {
                'planting_date': '2026-06-01',
            }, format='json')
            self.assertEqual(response.status_code, 200, response.data)
        history_count = EntityRevision.objects.filter(entity_type='task').count()
        self.client.patch(f'/api/planting-plans/{plan_id}/', {
            'planting_date': '2026-06-01',
        }, format='json')
        self.assertEqual(EntityRevision.objects.filter(entity_type='task').count(), history_count)
        for task in tasks:
            task.refresh_from_db()
        self.assertEqual(tasks[0].due_date, date(2026, 4, 24))
        self.assertEqual(tasks[0].status, 'completed')
        self.assertIsNone(tasks[1].due_date)
        self.assertTrue(tasks[1].due_date_overridden)
        self.assertEqual(tasks[1].calculated_due_date, date(2026, 6, 1))
        self.assertIsNotNone(tasks[2].deleted_at)
        self.assertEqual(self.client.get(f'/api/tasks/{tasks[2].pk}/').status_code, 404)
        self.assertEqual(self.client.delete(f'/api/seasons/{self.season.pk}/').status_code, 204)
        self.assertEqual(self.client.get('/api/tasks/').data['count'], 0)
        restored = self.client.post(f'/api/seasons/{self.season.pk}/undelete/', {}, format='json')
        self.assertEqual(restored.status_code, 200, restored.data)
        self.assertEqual(set(Task.objects.filter(
            planting_plan_id=plan_id,
        ).values_list('id', flat=True)), original_ids)
        self.assertEqual(Task.objects.get(pk=tasks[0].pk).status, 'completed')
        self.assertTrue(Task.objects.get(pk=tasks[1].pk).due_date_overridden)
        self.assertEqual(self.client.get(f'/api/tasks/{tasks[2].pk}/').status_code, 404)

    def test_generated_relations_cannot_cross_project_or_season_boundaries(self) -> None:
        foreign = Project.objects.create(name='Foreign workflow', slug='foreign-workflow')
        foreign_season = Season.objects.create(
            project=foreign, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        crop = Crop.objects.create(project=foreign, name='Secret crop')
        template = CropTaskTemplate.objects.create(
            project=foreign, crop=crop, title='Secret rule', reference_event='planting',
        )
        plan = PlantingPlan.objects.create(project=foreign, crop=crop, season=foreign_season)
        task = Task.objects.create(
            project=foreign, crop=crop, season=foreign_season, planting_plan=plan,
            template=template, title='Secret task', origin='template',
        )
        self.assertEqual(self.client.get(f'/api/tasks/{task.pk}/').status_code, 404)
        response = self.client.get(f'/api/crop-task-templates/{template.pk}/')
        self.assertEqual(response.status_code, 404)
        response = self.client.post('/api/tasks/', {
            'title': 'Invalid link', 'planting_plan': plan.pk, 'season': self.season.pk,
        }, format='json')
        self.assertEqual(response.status_code, 400)
        listed = self.client.get('/api/tasks/', {'planting_plan': plan.pk})
        self.assertEqual(listed.data['count'], 0)

    def test_plan_deletion_keeps_manual_completed_and_overridden_occurrences(self) -> None:
        from farm.services.tasks import generate_plan_tasks

        template = CropTaskTemplate.objects.create(
            project=self.project, crop=self.crop, title='Water', reference_event='planting',
            repeat_interval_days=7, repeat_until='count', repeat_count=3,
        )
        plan = self.plan(cultivation_type='pre_cultivation')
        generate_plan_tasks(plan)
        occurrences = list(Task.objects.filter(template=template).order_by('occurrence_index'))
        occurrences[0].status = 'completed'
        occurrences[0].save()
        occurrences[1].due_date = None
        occurrences[1].due_date_overridden = True
        occurrences[1].save()
        manual = Task.objects.create(
            project=self.project, season=self.season, planting_plan=plan, title='Manual repair',
        )
        ids = {task.pk for task in [*occurrences, manual]}
        response = self.client.delete(f'/api/planting-plans/{plan.pk}/')
        self.assertEqual(response.status_code, 204)
        self.assertEqual(set(Task.objects.filter(pk__in=ids).values_list('id', flat=True)), ids)
        self.assertFalse(Task.objects.filter(pk__in=ids, planting_plan__isnull=False).exists())
        self.assertEqual(Task.objects.get(pk=occurrences[0].pk).status, 'completed')
        protected = Task.objects.get(pk=occurrences[1].pk)
        self.assertIsNone(protected.due_date)
        self.assertTrue(protected.due_date_overridden)
        self.assertEqual(protected.status, 'pending')
        self.assertEqual(Task.objects.get(pk=occurrences[2].pk).status, 'cancelled')
        self.assertEqual(Task.objects.get(pk=manual.pk).status, 'pending')
