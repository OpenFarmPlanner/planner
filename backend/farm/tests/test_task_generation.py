"""Generation of persisted tasks from known planting-plan dates."""

from datetime import date
from unittest.mock import patch

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


class RecurringHarvestTaskTest(TaskTimingFixture):
    def setUp(self) -> None:
        super().setUp()
        self.client.defaults['HTTP_X_SEASON_ID'] = str(self.season.pk)

    def set_window(self, window: str, *, delay: int = 0) -> None:
        self.crop.life_cycle = 'perennial'
        self.crop.annual_harvest_window = window
        self.crop.first_harvest_delay_years = delay
        self.crop.save()

    def period(self, year: int) -> Season:
        return Season.objects.create(
            project=self.project, start_date=date(year, 1, 1), end_date=date(year, 12, 31),
        )

    def harvests(self, plan: PlantingPlan):
        return Task.objects.filter(source_key=f'plan:{plan.pk}:event:harvest_start')

    @patch('farm.services.tasks.timezone.localdate', return_value=date(2027, 1, 1))
    def test_existing_harvest_task_is_adopted_and_following_seasons_get_their_own(self, _today):
        first = self.period(2024)
        second = self.period(2025)
        plan = self.plan(
            planting_date=date(2024, 5, 1), season=first,
            clearing_date=date(2026, 9, 30), cultivation_type='direct_sowing',
        )
        generate_plan_tasks(plan)
        legacy = self.harvests(plan).get()
        legacy.status = 'completed'
        legacy.due_date = legacy.calculated_due_date = date(2025, 3, 12)
        legacy.save()
        self.set_window('03-12/04-09')

        generation = generate_plan_tasks(plan)
        self.assertEqual(len(generation), 1)
        legacy.refresh_from_db()
        self.assertEqual((legacy.status, legacy.due_date, legacy.season_id), (
            'completed', date(2025, 3, 12), first.pk,
        ))
        task = self.harvests(plan).get(occurrence_index=2026)
        self.assertEqual((task.status, task.due_date, task.season_id), (
            'pending', date(2026, 3, 12), self.season.pk,
        ))
        self.assertEqual(generate_plan_tasks(plan), [])
        self.assertEqual(Task.objects.filter(planting_plan=plan).count(), 3)
        self.assertEqual(self.harvests(plan).get(occurrence_index=2025).id, legacy.id)

        board = self.client.get('/openfarmplanner/api/tasks/', {'planting_plan': plan.pk})
        self.assertEqual([row['id'] for row in board.data['results']], [task.pk])
        details = self.client.get('/openfarmplanner/api/tasks/', {
            'planting_plan': plan.pk, 'across_seasons': True,
        })
        self.assertIn(legacy.pk, [row['id'] for row in details.data['results']])
        self.assertTrue(second.start_date <= legacy.due_date <= second.end_date)

    def test_delayed_leap_day_and_next_calendar_year_use_real_season_ranges(self):
        first = self.period(2025)
        early = Season.objects.create(
            project=self.project, start_date=date(2027, 1, 1), end_date=date(2027, 8, 31),
        )
        late = Season.objects.create(
            project=self.project, start_date=date(2027, 9, 1), end_date=date(2028, 8, 31),
        )
        self.set_window('11-15/01-10', delay=2)
        winter_plan = self.plan(
            planting_date=date(2025, 11, 16), season=first, clearing_date=date(2028, 1, 6),
            cultivation_type='direct_sowing',
            harvest_window_overrides={
                '2027': {'start_date': '2028-01-03', 'end_date': '2028-01-06'},
            },
        )
        generate_plan_tasks(winter_plan)
        task = self.harvests(winter_plan).get()
        self.assertEqual((task.occurrence_index, task.due_date, task.season_id), (
            2027, date(2028, 1, 3), late.pk,
        ))

        leap_season = self.period(2024)
        self.set_window('02-29/03-15', delay=3)
        leap_plan = self.plan(
            planting_date=date(2024, 2, 29), season=leap_season,
            clearing_date=date(2027, 3, 1), cultivation_type='direct_sowing',
        )
        generate_plan_tasks(leap_plan)
        self.assertEqual(list(self.harvests(leap_plan).values_list('due_date', 'season_id')), [
            (date(2027, 2, 28), early.pk),
        ])

    @patch('farm.services.tasks.timezone.localdate', return_value=date(2027, 1, 1))
    def test_edits_reconcile_editable_occurrences_and_keep_protected_rows(self, _today):
        self.set_window('03-12/04-09')
        for year in range(2027, 2031):
            self.period(year)
        plan = self.plan(planting_date=date(2026, 2, 1), clearing_date=date(2030, 10, 1))
        generate_plan_tasks(plan)
        tasks = {task.occurrence_index: task for task in self.harvests(plan)}
        self.harvests(plan).filter(occurrence_index=2026).update(status='completed')
        self.harvests(plan).filter(occurrence_index=2029).update(due_date_overridden=True)
        self.harvests(plan).filter(occurrence_index=2030).update(deleted_at='2027-01-01T00:00:00Z')

        url = f'/openfarmplanner/api/planting-plans/{plan.pk}/'
        for _ in range(2):
            response = self.client.put(f'{url}harvest-window/2027/', {
                'start_date': '2027-03-20', 'end_date': '2027-04-09',
            })
            self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.harvests(plan).get(pk=tasks[2027].pk).due_date, date(2027, 3, 20))
        self.assertEqual(self.harvests(plan).get(pk=tasks[2028].pk).due_date, date(2028, 3, 12))

        response = self.client.patch(f'/openfarmplanner/api/crops/{self.crop.pk}/', {
            'annual_harvest_window': '03-15/04-10',
        })
        self.assertEqual(response.status_code, 200, response.data)
        response = self.client.patch(url, {'clearing_date': '2028-02-01'})
        self.assertEqual(response.status_code, 200, response.data)
        for task in tasks.values():
            task.refresh_from_db()
        self.assertEqual((tasks[2026].status, tasks[2026].due_date), (
            'completed', date(2026, 3, 12),
        ))
        self.assertEqual((tasks[2027].status, tasks[2027].due_date), ('pending', date(2027, 3, 20)))
        self.assertEqual((tasks[2028].status, tasks[2028].due_date), (
            'cancelled', date(2028, 3, 15),
        ))
        self.assertEqual((tasks[2029].status, tasks[2029].due_date), ('pending', date(2029, 3, 12)))
        self.assertIsNotNone(tasks[2030].deleted_at)
        self.assertEqual(self.harvests(plan).count(), 5)

    def test_new_season_generates_work_for_an_existing_plan(self):
        self.set_window('03-12/04-09')
        plan = self.plan(planting_date=date(2026, 2, 1), clearing_date=date(2028, 9, 1))
        generate_plan_tasks(plan)
        response = self.client.post('/openfarmplanner/api/seasons/', {
            'start_date': '2027-02-01', 'end_date': '2028-01-31', 'custom_label': 'Future beds',
        })
        self.assertEqual(response.status_code, 201, response.data)
        task = self.harvests(plan).get(occurrence_index=2027)
        self.assertEqual((task.season_id, task.due_date), (response.data['id'], date(2027, 3, 12)))
        self.assertEqual(generate_plan_tasks(plan), [])

    @patch('farm.services.tasks.timezone.localdate', return_value=date(2026, 1, 1))
    def test_removing_recurring_window_restores_the_one_time_harvest_task(self, _today):
        self.set_window('03-12/04-09')
        self.period(2027)
        plan = self.plan(planting_date=date(2026, 2, 1), clearing_date=date(2027, 9, 1))
        generate_plan_tasks(plan)
        self.harvests(plan).filter(occurrence_index=2027).update(status='completed')
        crop_url = f'/openfarmplanner/api/crops/{self.crop.pk}/'
        for _ in range(2):
            response = self.client.patch(crop_url, {'annual_harvest_window': ''})
            self.assertEqual(response.status_code, 200, response.data)
        one_time = self.harvests(plan).get(occurrence_index=0)
        self.assertEqual((one_time.due_date, one_time.season_id, one_time.status), (
            date(2026, 3, 3), self.season.pk, 'pending',
        ))
        self.assertEqual(self.harvests(plan).get(occurrence_index=2026).status, 'cancelled')
        self.assertEqual(self.harvests(plan).get(occurrence_index=2027).status, 'completed')
        plan.refresh_from_db()
        self.assertEqual(generate_plan_tasks(plan), [])

    @patch('farm.services.tasks.timezone.localdate', return_value=date(2026, 1, 1))
    def test_deleting_a_season_cancels_open_harvest_tasks_of_other_plans_in_it(self, _today):
        self.set_window('03-12/04-09')
        later = self.period(2027)
        plan = self.plan(planting_date=date(2026, 2, 1), clearing_date=date(2028, 9, 1))
        generate_plan_tasks(plan)
        task = self.harvests(plan).get(occurrence_index=2027)
        self.assertEqual(task.season_id, later.pk)
        response = self.client.delete(f'/openfarmplanner/api/seasons/{later.pk}/')
        self.assertEqual(response.status_code, 204)
        task.refresh_from_db()
        self.assertEqual(task.status, 'cancelled')

    @patch('farm.services.tasks.timezone.localdate', return_value=date(2029, 1, 1))
    def test_restored_source_plan_gains_tasks_for_seasons_added_while_absent(self, _today):
        self.set_window('03-12/04-09')
        plan = self.plan(planting_date=date(2026, 2, 1), clearing_date=date(2028, 9, 1))
        generate_plan_tasks(plan)
        original = self.harvests(plan).get(occurrence_index=2026)
        original.status = 'completed'
        original.save(update_fields=['status'])
        seasons = '/openfarmplanner/api/seasons/'
        for year in (2027, 2028):
            removed = self.client.delete(f'{seasons}{self.season.pk}/')
            self.assertEqual(removed.status_code, 204)
            added = self.client.post(seasons, {
                'start_date': f'{year}-01-01', 'end_date': f'{year}-12-31',
            })
            self.assertEqual(added.status_code, 201, added.data)
            if year == 2027:
                restored = self.client.post(f'{seasons}{self.season.pk}/undelete/')
                self.assertEqual(restored.status_code, 200, restored.data)
            else:
                restored = self.client.post(seasons, {
                    'start_date': '2026-01-01', 'end_date': '2026-12-31',
                })
                self.assertEqual(restored.status_code, 201, restored.data)
            self.assertEqual(restored.data['id'], self.season.pk)
            task = self.harvests(plan).get(occurrence_index=year)
            self.assertEqual((task.planting_plan_id, task.season_id, task.due_date, task.status), (
                plan.pk, added.data['id'], date(year, 3, 12), 'pending',
            ))
        original.refresh_from_db()
        self.assertEqual((original.planting_plan_id, original.status), (plan.pk, 'completed'))
        self.assertEqual(self.harvests(plan).count(), 3)

    @patch('farm.services.tasks.timezone.localdate', return_value=date(2027, 1, 1))
    def test_actual_sowing_reanchors_first_bearing_without_moving_sowing_task(self, _today):
        self.set_window('03-12/04-09', delay=1)
        self.period(2027)
        plan = self.plan(
            cultivation_type='direct_sowing', planting_date=date(2026, 2, 1),
            clearing_date=date(2027, 9, 1),
        )
        generate_plan_tasks(plan)
        start = self.harvests(plan).get()
        response = self.client.patch(f'/openfarmplanner/api/planting-plans/{plan.pk}/', {
            'actual_sowing_date': '2026-03-29',
        })
        self.assertEqual(response.status_code, 200, response.data)
        start.refresh_from_db()
        self.assertEqual(start.due_date, date(2027, 3, 29))
        sowing = Task.objects.get(planting_plan=plan, occurrence_index=0)
        self.assertEqual(sowing.due_date, date(2026, 2, 1))


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
