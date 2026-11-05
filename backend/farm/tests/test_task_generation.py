"""Generation of persisted tasks from known planting-plan dates."""

from datetime import date

from crops.models import CropSpecies
from farm.models import Crop, PlantingPlan, Season, Task
from farm.services.tasks import generate_plan_tasks, generate_tasks_for_plans, plan_event_dates
from farm.tests.api_base import ProjectApiTestCase


class TaskGenerationTest(ProjectApiTestCase):
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
