"""Crop template CRUD and independently completable plan instances."""

from datetime import date

from farm.models import CropTaskTemplate, Task
from farm.services.tasks import generate_plan_tasks, synchronize_plan_tasks
from farm.tests.test_task_generation import TaskTimingFixture


class CropTaskTemplateTest(TaskTimingFixture):
    url = '/openfarmplanner/api/crop-task-templates/'

    def setUp(self) -> None:
        super().setUp()
        self.client.defaults['HTTP_X_SEASON_ID'] = str(self.season.pk)

    def payload(self, **changes: object) -> dict:
        return {
            'crop': self.crop.pk, 'title': 'Prepare bed', 'description': 'Check tools',
            'reference_event': 'planting', 'day_offset': -3, **changes,
        }

    def template(self, **changes: object) -> CropTaskTemplate:
        payload = self.payload(**changes)
        payload['crop_id'] = payload.pop('crop')
        return CropTaskTemplate.objects.create(project=self.project, **payload)

    def test_create_and_update_generate_and_reschedule_existing_plan_tasks(self) -> None:
        plan = self.plan(cultivation_type='pre_cultivation')
        response = self.client.post(self.url, self.payload())
        self.assertEqual(response.status_code, 201, response.data)
        task = Task.objects.get(planting_plan=plan, origin='template')
        self.assertEqual(task.template_id, response.data['id'])
        self.assertEqual(task.due_date, date(2026, 4, 28))
        self.assertEqual(task.description, 'Check tools')
        response = self.client.patch(f"{self.url}{response.data['id']}/", {'day_offset': 4})
        self.assertEqual(response.status_code, 200, response.data)
        task.refresh_from_db()
        self.assertEqual(task.due_date, date(2026, 5, 5))
        self.assertEqual(Task.objects.filter(planting_plan=plan, origin='template').count(), 1)

    def test_plan_creation_instantiates_template_and_missing_events_are_skipped(self) -> None:
        template = self.template()
        missing = self.template(reference_event='propagation_start')
        plan = self.plan(cultivation_type='purchased_transplant')
        generate_plan_tasks(plan)
        task = Task.objects.get(template=template)
        self.assertEqual(task.planting_plan_id, plan.pk)
        self.assertFalse(Task.objects.filter(template=missing).exists())
        synchronize_plan_tasks(plan)
        self.assertEqual(Task.objects.filter(template=template).count(), 1)

    def test_template_deletion_preserves_completed_and_overridden(self) -> None:
        template = self.template()
        plans = [self.plan(cultivation_type='pre_cultivation') for _ in range(3)]
        for plan in plans:
            generate_plan_tasks(plan)
        tasks = list(Task.objects.filter(template=template).order_by('pk'))
        tasks[1].status = 'completed'
        tasks[1].save()
        tasks[2].due_date_overridden = True
        tasks[2].due_date = date(2026, 3, 1)
        tasks[2].save()
        response = self.client.delete(f'{self.url}{template.pk}/')
        self.assertEqual(response.status_code, 204)
        self.assertEqual(self.client.get(f'{self.url}{template.pk}/').status_code, 404)
        for task in tasks:
            task.refresh_from_db()
        self.assertEqual(tasks[0].status, 'cancelled')
        self.assertEqual(tasks[1].status, 'completed')
        self.assertEqual(tasks[2].due_date, date(2026, 3, 1))
        self.assertEqual(Task.objects.filter(template=template).count(), 3)

    def test_filters_and_invalid_offsets_events_and_foreign_crop(self) -> None:
        for change in ({'day_offset': -3651}, {'day_offset': 1.5},
                       {'reference_event': 'unknown'}, {'title': ''}):
            response = self.client.post(self.url, self.payload(**change))
            self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(self.client.get(self.url, {'crop': 'invalid'}).status_code, 400)
        from farm.models import Crop, Project

        foreign = Project.objects.create(name='Foreign template', slug='foreign-template')
        crop = Crop.objects.create(project=foreign, name='Foreign')
        self.assertEqual(self.client.post(self.url, self.payload(crop=crop.pk)).status_code, 400)
        hidden = CropTaskTemplate.objects.create(
            project=foreign, crop=crop, title='Hidden', reference_event='sowing',
        )
        self.assertEqual(self.client.get(f'{self.url}{hidden.pk}/').status_code, 404)
