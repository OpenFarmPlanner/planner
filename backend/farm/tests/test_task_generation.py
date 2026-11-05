"""Generation of persisted tasks from known planting-plan dates."""

from datetime import date

from crops.models import CropSpecies
from farm.models import Crop, PlantingPlan, Season, Task
from farm.services.tasks import generate_plan_tasks, generate_tasks_for_plans, plan_event_dates
from farm.tests.api_base import ProjectApiTestCase


class TaskTimingFixture(ProjectApiTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.season = Season.objects.create(
            project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        self.crop.cultivation_type = 'pre_cultivation'
        self.crop.cultivation_types = ['pre_cultivation']
        self.crop.propagation_duration_days = 20
        self.crop.growth_duration_days = 30
        self.crop.harvest_duration_days = 10
        self.crop.save()

    def plan(self, **overrides: object) -> PlantingPlan:
        return PlantingPlan.objects.create(**{
            'project': self.project, 'season': self.season, 'crop': self.crop,
            'bed': self.bed, 'planting_date': date(2026, 5, 1), **overrides,
        })


class TaskGenerationTest(TaskTimingFixture):
    def test_pre_cultivation_dates_and_optional_harvest_end(self) -> None:
        plan = self.plan(cultivation_type='pre_cultivation')
        generated = generate_plan_tasks(plan)
        self.assertEqual({task.title: task.due_date for task in generated}, {
            'Start propagation': date(2026, 4, 11), 'Transplant': date(2026, 5, 1),
            'Start harvesting': date(2026, 5, 31),
        })
        for task in generated:
            self.assertEqual(task.origin, 'automatic')
            self.assertEqual(task.season_id, self.season.pk)
            self.assertEqual(task.crop_id, self.crop.pk)
            self.assertEqual(task.calculated_due_date, task.due_date)
            self.assertFalse(task.due_date_overridden)
        extra = generate_plan_tasks(plan, include_harvest_end=True)
        self.assertEqual(len(extra), 1)
        self.assertEqual(extra[0].due_date, date(2026, 6, 10))

    def test_direct_sowing_and_purchased_transplants_have_no_propagation_task(self) -> None:
        for kind, expected in [('direct_sowing', 'Direct sowing'),
                               ('purchased_transplant', 'Transplant')]:
            plan = self.plan(cultivation_type=kind)
            generated = generate_plan_tasks(plan)
            self.assertEqual({task.title for task in generated}, {expected, 'Start harvesting'})

    def test_idempotence_preserves_manual_tasks_ids_completion_and_overrides(self) -> None:
        plan = self.plan(cultivation_type='pre_cultivation')
        manual = Task.objects.create(
            project=self.project, season=self.season, planting_plan=plan,
            title='Manual work', due_date=date(2026, 4, 12), status='completed',
        )
        generated = generate_plan_tasks(plan)
        task = generated[0]
        task.status = 'completed'
        task.due_date_overridden = True
        task.due_date = date(2026, 4, 3)
        task.title = 'User title'
        task.save()
        original_ids = set(Task.objects.values_list('id', flat=True))
        self.assertEqual(generate_plan_tasks(plan), [])
        self.assertEqual(set(Task.objects.values_list('id', flat=True)), original_ids)
        task.refresh_from_db()
        manual.refresh_from_db()
        self.assertEqual(task.title, 'User title')
        self.assertEqual(task.due_date, date(2026, 4, 3))
        self.assertTrue(task.due_date_overridden)
        self.assertEqual(task.status, 'completed')
        self.assertEqual(manual.title, 'Manual work')

    def test_missing_dates_and_unknown_propagation_are_not_invented(self) -> None:
        self.assertEqual(generate_plan_tasks(self.plan(planting_date=None)), [])
        self.crop.propagation_duration_days = None
        self.crop.save()
        events = plan_event_dates(self.plan(cultivation_type='pre_cultivation'))
        self.assertNotIn('propagation_start', events)
        self.assertIn('planting', events)
        self.assertEqual(generate_plan_tasks(self.plan(season=None)), [])

    def test_variety_uses_general_culture_timing(self) -> None:
        species = CropSpecies.objects.create(name='Task inheritance species')
        Crop.objects.create(
            project=self.project, crop_species=species, name='General',
            cultivation_types=['pre_cultivation'], cultivation_type='pre_cultivation',
            propagation_duration_days=15, growth_duration_days=40,
        )
        variety = Crop.objects.create(
            project=self.project, crop_species=species, name='Variety', variety='Early',
        )
        plan = self.plan(crop=variety, cultivation_type='pre_cultivation')
        self.assertEqual(generate_tasks_for_plans([plan]), 3)
        self.assertTrue(Task.objects.filter(
            planting_plan=plan, title='Start propagation', due_date=date(2026, 4, 16),
        ).exists())

    def test_plan_creation_api_generates_persisted_tasks(self) -> None:
        self.client.defaults['HTTP_X_SEASON_ID'] = str(self.season.pk)
        response = self.client.post('/openfarmplanner/api/planting-plans/', {
            'crop': self.crop.pk, 'bed': self.bed.pk, 'planting_date': '2026-05-01',
            'cultivation_type': 'pre_cultivation',
        })
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(Task.objects.filter(planting_plan_id=response.data['id']).count(), 3)
        listed = self.client.get('/openfarmplanner/api/tasks/')
        self.assertEqual(listed.data['count'], 3)


class TaskSynchronizationTest(TaskTimingFixture):
    def setUp(self) -> None:
        super().setUp()
        self.client.defaults['HTTP_X_SEASON_ID'] = str(self.season.pk)

    def test_rescheduling_preserves_ids_completed_and_overridden_dates(self) -> None:
        plan = self.plan(cultivation_type='pre_cultivation')
        tasks = {task.title: task for task in generate_plan_tasks(plan)}
        completed = tasks['Start propagation']
        completed.status = 'completed'
        completed.save()
        overridden = tasks['Start harvesting']
        overridden.due_date_overridden = True
        overridden.due_date = date(2026, 8, 1)
        overridden.save()
        ids = set(Task.objects.values_list('id', flat=True))
        for _ in range(2):
            response = self.client.patch(f'/openfarmplanner/api/planting-plans/{plan.pk}/', {
                'planting_date': '2026-06-01',
            })
            self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(set(Task.objects.values_list('id', flat=True)), ids)
        completed.refresh_from_db()
        overridden.refresh_from_db()
        self.assertEqual(completed.due_date, date(2026, 4, 11))
        self.assertEqual(overridden.due_date, date(2026, 8, 1))
        self.assertEqual(overridden.calculated_due_date, date(2026, 7, 1))
        self.assertEqual(Task.objects.get(pk=tasks['Transplant'].pk).due_date, date(2026, 6, 1))

    def test_deleted_generated_task_is_not_recreated(self) -> None:
        from farm.services.tasks import synchronize_plan_tasks

        plan = self.plan(cultivation_type='direct_sowing')
        task = generate_plan_tasks(plan)[0]
        response = self.client.delete(f'/openfarmplanner/api/tasks/{task.pk}/')
        self.assertEqual(response.status_code, 204)
        synchronize_plan_tasks(plan)
        self.assertTrue(Task.objects.filter(pk=task.pk, deleted_at__isnull=False).exists())
        self.assertEqual(self.client.get(f'/openfarmplanner/api/tasks/{task.pk}/').status_code, 404)

    def test_removed_event_is_cancelled_and_never_reopened_implicitly(self) -> None:
        from farm.services.tasks import synchronize_plan_tasks

        plan = self.plan(cultivation_type='pre_cultivation')
        tasks = {task.title: task for task in generate_plan_tasks(plan)}
        plan.cultivation_type = 'direct_sowing'
        plan.save()
        synchronize_plan_tasks(plan)
        removed = tasks['Transplant']
        removed.refresh_from_db()
        self.assertEqual(removed.status, 'cancelled')
        plan.cultivation_type = 'pre_cultivation'
        plan.save()
        synchronize_plan_tasks(plan)
        removed.refresh_from_db()
        self.assertEqual(removed.status, 'cancelled')
        self.assertEqual(Task.objects.filter(source_key=removed.source_key).count(), 1)

    def test_plan_deletion_preserves_manual_and_completed_work(self) -> None:
        plan = self.plan(cultivation_type='pre_cultivation')
        generated = generate_plan_tasks(plan)
        generated[0].status = 'completed'
        generated[0].save()
        manual = Task.objects.create(
            project=self.project, season=self.season, planting_plan=plan, title='Manual',
        )
        response = self.client.delete(f'/openfarmplanner/api/planting-plans/{plan.pk}/')
        self.assertEqual(response.status_code, 204)
        manual.refresh_from_db()
        generated[0].refresh_from_db()
        self.assertIsNone(manual.planting_plan_id)
        self.assertEqual(generated[0].status, 'completed')
        self.assertIsNone(generated[0].planting_plan_id)
        self.assertTrue(Task.objects.filter(pk=generated[1].pk, status='cancelled').exists())

    def test_noop_history_and_override_reset_use_latest_baseline(self) -> None:
        from farm.models import EntityRevision
        from farm.services.tasks import synchronize_plan_tasks

        plan = self.plan(cultivation_type='direct_sowing')
        task = generate_plan_tasks(plan)[0]
        task.due_date_overridden = True
        task.due_date = None
        task.save()
        plan.planting_date = date(2026, 6, 1)
        plan.save()
        synchronize_plan_tasks(plan)
        count = EntityRevision.objects.filter(entity_type='task').count()
        synchronize_plan_tasks(plan)
        self.assertEqual(EntityRevision.objects.filter(entity_type='task').count(), count)
        task.refresh_from_db()
        self.assertIsNone(task.due_date)
        self.assertTrue(task.due_date_overridden)
        response = self.client.patch(f'/openfarmplanner/api/tasks/{task.pk}/', {
            'due_date_overridden': False,
        })
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['due_date'], '2026-06-01')

    def test_generated_identity_cannot_be_reassigned_to_another_plan(self) -> None:
        plan = self.plan(cultivation_type='direct_sowing')
        task = generate_plan_tasks(plan)[0]
        other = self.plan(cultivation_type='direct_sowing')
        response = self.client.patch(f'/openfarmplanner/api/tasks/{task.pk}/', {
            'planting_plan': other.pk,
        })
        self.assertEqual(response.status_code, 400)
        task.refresh_from_db()
        self.assertEqual(task.planting_plan_id, plan.pk)
