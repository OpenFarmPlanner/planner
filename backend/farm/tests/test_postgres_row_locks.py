"""Row-lock regressions that only PostgreSQL can reproduce.

SQLite ignores `select_for_update()`, so these tests only prove something when
the suite runs with `TEST_DB_ENGINE=postgres` (the `backend-postgres-tests` CI
job runs every test marked `postgres`). PostgreSQL rejects `FOR UPDATE` on the
nullable side of an outer join, which `select_related()` on a nullable foreign
key produces unless the lock is limited with `of=('self',)`.
"""

from datetime import date

import pytest

from farm.models import CropTaskTemplate, Task
from farm.services.tasks import synchronize_plan_tasks
from farm.tests.test_task_generation import TaskTimingFixture

pytestmark = pytest.mark.postgres


class PlanTaskSynchronizationLockTest(TaskTimingFixture):
    def setUp(self) -> None:
        super().setUp()
        self.client.defaults['HTTP_X_SEASON_ID'] = str(self.season.pk)

    def test_updating_plan_dates_synchronizes_automatic_and_template_tasks(self) -> None:
        CropTaskTemplate.objects.create(
            project=self.project, crop=self.crop, title='Water',
            reference_event='planting', day_offset=-7,
        )
        plan = self.plan(cultivation_type='pre_cultivation')
        synchronize_plan_tasks(plan)

        response = self.client.patch(f'/api/planting-plans/{plan.pk}/', {
            'planting_date': '2026-06-01',
        }, format='json')

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            Task.objects.get(planting_plan=plan, origin='template').due_date, date(2026, 5, 25),
        )
        self.assertEqual(
            Task.objects.get(planting_plan=plan, source_key__endswith=':planting').due_date,
            date(2026, 6, 1),
        )

    def test_synchronizing_a_draft_plan_without_crop_succeeds(self) -> None:
        plan = self.plan(crop=None)

        synchronize_plan_tasks(plan)

        self.assertFalse(Task.objects.filter(planting_plan=plan, origin='automatic').exists())
