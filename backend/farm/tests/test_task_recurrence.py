"""Each recurring occurrence has stable identity and independent user work."""

from datetime import date

from farm.models import CropTaskTemplate, Task
from farm.services.tasks import generate_plan_tasks, synchronize_plan_tasks
from farm.tests.test_task_generation import TaskTimingFixture


class TaskRecurrenceTest(TaskTimingFixture):
    def template(self, **changes: object) -> CropTaskTemplate:
        return CropTaskTemplate.objects.create(**{
            'project': self.project, 'crop': self.crop, 'title': 'Water',
            'reference_event': 'planting', 'day_offset': -2,
            'repeat_interval_days': 7, 'repeat_until': 'count', 'repeat_count': 3,
            **changes,
        })

    def test_count_offsets_and_independent_completion_survive_rescheduling(self) -> None:
        template = self.template()
        plan = self.plan(cultivation_type='pre_cultivation')
        generate_plan_tasks(plan)
        tasks = list(Task.objects.filter(template=template).order_by('occurrence_index'))
        self.assertEqual([task.due_date for task in tasks], [
            date(2026, 4, 29), date(2026, 5, 6), date(2026, 5, 13),
        ])
        tasks[0].status = 'completed'
        tasks[0].save()
        tasks[1].due_date = date(2026, 9, 1)
        tasks[1].due_date_overridden = True
        tasks[1].save()
        ids = [task.pk for task in tasks]
        plan.planting_date = date(2026, 6, 1)
        plan.save()
        for _ in range(2):
            synchronize_plan_tasks(plan)
        changed = list(Task.objects.filter(template=template).order_by('occurrence_index'))
        self.assertEqual([task.pk for task in changed], ids)
        self.assertEqual(changed[0].due_date, date(2026, 4, 29))
        self.assertEqual(changed[0].status, 'completed')
        self.assertEqual(changed[1].due_date, date(2026, 9, 1))
        self.assertEqual(changed[2].due_date, date(2026, 6, 13))

    def test_harvest_end_is_inclusive_and_shortening_cancels_only_open_work(self) -> None:
        template = self.template(repeat_until='harvest_end', repeat_count=None, day_offset=0,
                                 repeat_interval_days=10)
        plan = self.plan(cultivation_type='pre_cultivation')
        generate_plan_tasks(plan)
        tasks = list(Task.objects.filter(template=template).order_by('occurrence_index'))
        self.assertEqual(len(tasks), 5)
        self.assertEqual(tasks[-1].due_date, date(2026, 6, 10))
        tasks[-1].status = 'completed'
        tasks[-1].save()
        template.repeat_until = 'count'
        template.repeat_count = 1
        template.save()
        synchronize_plan_tasks(plan)
        tasks[-1].refresh_from_db()
        self.assertEqual(tasks[-1].status, 'completed')
        self.assertEqual(Task.objects.filter(template=template, status='cancelled').count(), 3)

    def test_missing_end_does_not_invent_occurrences(self) -> None:
        template = self.template(repeat_until='harvest_start', repeat_count=None)
        self.crop.growth_duration_days = None
        self.crop.save()
        generate_plan_tasks(self.plan(cultivation_type='pre_cultivation'))
        self.assertFalse(Task.objects.filter(template=template).exists())

    def test_api_rejects_invalid_rules(self) -> None:
        url = '/openfarmplanner/api/crop-task-templates/'
        for changes in ({'repeat_interval_days': 0}, {'repeat_count': 1001},
                        {'repeat_until': ''}, {'repeat_count': None},
                        {'repeat_until': 'harvest_end', 'repeat_count': 2}):
            response = self.client.post(url, {
                'crop': self.crop.pk, 'title': 'Water', 'reference_event': 'planting',
                'repeat_interval_days': 7, 'repeat_until': 'count', 'repeat_count': 3,
                **changes,
            }, format='json')
            self.assertEqual(response.status_code, 400, response.data)

    def test_excessive_expansion_rolls_back_template_creation(self) -> None:
        from farm.models import PlantingPlan

        plan = self.plan(cultivation_type='pre_cultivation')
        PlantingPlan.objects.filter(pk=plan.pk).update(harvest_date=date(2030, 1, 1))
        before = Task.objects.count()
        response = self.client.post('/openfarmplanner/api/crop-task-templates/', {
            'crop': self.crop.pk, 'title': 'Daily', 'reference_event': 'planting',
            'repeat_interval_days': 1, 'repeat_until': 'harvest_start',
        }, format='json')
        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(CropTaskTemplate.objects.filter(title='Daily').exists())
        self.assertEqual(Task.objects.count(), before)
