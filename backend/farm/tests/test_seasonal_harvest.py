from datetime import date
from decimal import Decimal

from django.urls import reverse

from crops.models import CropSpecies
from farm.models import (
    Crop,
    CropLoss,
    HarvestAllocation,
    HarvestRecord,
    PlantingPlan,
    Project,
    Season,
    Task,
)
from farm.services.seasonal_harvest import recurring_harvest_schedule
from farm.tests.api_base import ProjectApiTestCase

PLANS = '/openfarmplanner/api/planting-plans/'
CALENDAR_WINDOWS = f'{PLANS}calendar-harvest-windows/'
FORECAST = '/openfarmplanner/api/yield-calendar/'
HARVESTS = '/openfarmplanner/api/harvests/'
LOSSES = '/openfarmplanner/api/crop-losses/'
TASKS = '/openfarmplanner/api/tasks/'


class SeasonalHarvestTest(ProjectApiTestCase):
    def season(self, start: date, end: date, label: str = '') -> Season:
        return Season.objects.create(
            project=self.project, start_date=start, end_date=end, custom_label=label,
        )

    def crop_with_window(self, window: str, **fields: object) -> Crop:
        return Crop.objects.create(project=self.project, name='Orchard crop', **{
            'life_cycle': 'perennial', 'standing_time_years': 20,
            'annual_harvest_window': window, 'expected_yield': 2, 'harvest_method': 'per_sqm',
            **fields,
        })

    def forecast(self, season: Season) -> Decimal:
        response = self.client.get(FORECAST, HTTP_X_SEASON_ID=str(season.pk))
        self.assertEqual(response.status_code, 200, response.data)
        return sum((
            Decimal(str(crop['yield'])) for week in response.json() for crop in week['crops']
        ), Decimal(0))

    def comparison(self, crop: Crop) -> dict[int, dict]:
        response = self.client.get(reverse('yield-comparison'), {'crop_id': crop.pk})
        self.assertEqual(response.status_code, 200, response.data)
        return {row['id']: row for row in response.json()['seasons']}

    def test_season_changes_projected_dates_and_forecast_for_one_inherited_plan(self) -> None:
        seasons = {
            year: self.season(date(year, 1, 1), date(year, 12, 31))
            for year in range(2025, 2030)
        }
        species = CropSpecies.objects.create(name='Synthetic orchard species')
        parent = self.crop_with_window('09-01/10-15', crop_species=species,
                                       first_harvest_delay_years=2)
        variety = Crop.objects.create(
            project=self.project, name=parent.name, variety='Test apple', crop_species=species,
        )
        plan = PlantingPlan.objects.create(
            project=self.project, crop=variety, bed=self.bed, season=seasons[2025],
            planting_date=date(2025, 3, 15), clearing_date=date(2028, 9, 10), area_usage_sqm=20,
            cultivation_type='pre_cultivation', planned_sowing_date=date(2025, 2, 5),
            actual_harvest_start_date=date(2025, 9, 10),
            recorded_harvest_end_date=date(2025, 10, 2),
        )
        measured = HarvestRecord.objects.create(
            project=self.project, crop=variety, date=date(2027, 9, 2), quantity=3, unit='kg',
        )
        HarvestAllocation.objects.create(
            project=self.project, harvest=measured, planting_plan=plan, quantity=3,
        )
        expected_windows = {
            2025: [], 2026: [],
            2027: [{'start_date': '2027-09-01', 'end_date': '2027-10-15'}],
            2028: [{'start_date': '2028-09-01', 'end_date': '2028-09-10'}],
        }
        for year, expected in expected_windows.items():
            with self.subTest(year=year):
                response = self.client.get(PLANS, HTTP_X_SEASON_ID=str(seasons[year].pk))
                self.assertEqual(response.status_code, 200, response.data)
                row, = response.json()['results']
                self.assertEqual(row['id'], plan.pk)
                self.assertEqual(row['season'], seasons[2025].pk)
                self.assertEqual(row['planting_date'], '2025-03-15')
                self.assertEqual(row['planned_sowing_date'], '2025-02-05')
                self.assertEqual(row['clearing_date'], '2028-09-10')
                self.assertEqual(row['carried_over'], year != 2025)
                self.assertEqual(row['seasonal_harvest'], {
                    'periods': expected,
                    'occupancy_start_date': '2025-03-15',
                    'planting_recorded': False,
                    'actual_start_date': '2025-09-10' if year == 2025 else None,
                    'actual_end_date': '2025-10-02' if year == 2025 else None,
                })
                if year == 2027:
                    self.assertEqual(row['actual_harvest']['forecast_kg'], '40')

        calendar = self.client.get(CALENDAR_WINDOWS, {
            'start_date': '2026-09-01', 'end_date': '2028-10-31',
        }, HTTP_X_SEASON_ID=str(seasons[2026].pk))
        self.assertEqual(calendar.status_code, 200, calendar.data)
        self.assertEqual(calendar.json(), {
            'windows_by_plan': {str(plan.pk): [
                {**window, 'occurrence_start_date': window['start_date']}
                for window in expected_windows[2027] + expected_windows[2028]
            ]},
            'next_start_date': None,
        })

        comparison = self.comparison(variety)
        totals = {2025: None, 2026: None, 2027: '40', 2028: '8.89', 2029: None}
        for year, total in totals.items():
            with self.subTest(forecast_year=year):
                season = seasons[year]
                row = comparison[season.pk]
                self.assertEqual(row['forecast_kg'], total)
                self.assertEqual(self.forecast(season), Decimal(total or 0))
                self.assertEqual(row['recorded']['measured_kg'], '3' if year == 2027 else None)
        forecast_activity, = comparison[seasons[2027].pk]['plan_dates']
        self.assertIsNone(forecast_activity['planting_date'])
        self.assertEqual(forecast_activity['id'], plan.pk)
        self.assertEqual(forecast_activity['seasonal_harvest']['periods'], expected_windows[2027])
        self.assertEqual(PlantingPlan.objects.filter(project=self.project).count(), 1)
        self.assertEqual(HarvestAllocation.objects.filter(planting_plan=plan).count(), 1)

    def test_cross_year_window_rounding_is_shared_by_weekly_and_season_forecasts(self) -> None:
        first = self.season(date(2025, 1, 1), date(2025, 12, 31))
        second = self.season(date(2026, 1, 1), date(2026, 8, 31))
        third = self.season(date(2026, 9, 1), date(2027, 8, 31), 'Orchard autumn to summer')
        crop = self.crop_with_window('12-20/01-10', harvest_method='per_plant',
                                    row_spacing_m=1, distance_within_row_m=1)
        plan = PlantingPlan.objects.create(
            project=self.project, crop=crop, bed=self.bed, season=first,
            planting_date=date(2025, 3, 15), clearing_date=date(2027, 1, 8), area_usage_sqm=11,
        )

        comparison = self.comparison(crop)
        expected = [(first, '12', '2025-12-20', '2025-12-31'),
                    (second, '10', '2026-01-01', '2026-01-10'),
                    (third, '20', '2026-12-20', '2027-01-08')]
        for season, kilograms, start, end in expected:
            with self.subTest(season=season.label):
                self.assertEqual(comparison[season.pk]['forecast_kg'], kilograms)
                self.assertEqual(self.forecast(season), Decimal(kilograms))
                response = self.client.get(f'{PLANS}{plan.pk}/', HTTP_X_SEASON_ID=str(season.pk))
                self.assertEqual(response.status_code, 200, response.data)
                self.assertEqual(response.json()['seasonal_harvest']['periods'], [
                    {'start_date': start, 'end_date': end},
                ])
        self.assertEqual(self.forecast(first) + self.forecast(second), Decimal(22))
        schedule = recurring_harvest_schedule(plan)
        projections = schedule.project(date(2026, 1, 1), date(2026, 12, 31))
        self.assertEqual([(part.start_date, part.end_date) for part in projections], [
            (date(2026, 1, 1), date(2026, 1, 10)),
            (date(2026, 12, 20), date(2026, 12, 31)),
        ])

    def test_calendar_projection_uses_overrides_beyond_a_non_calendar_season(self) -> None:
        origin = self.season(date(2024, 9, 1), date(2025, 8, 31))
        active = self.season(date(2025, 9, 1), date(2026, 8, 31))
        crop = self.crop_with_window('12-20/01-10')
        plan = PlantingPlan.objects.create(
            project=self.project, crop=crop, bed=self.bed, season=origin,
            planting_date=date(2025, 3, 15), clearing_date=date(2028, 1, 4),
            area_usage_sqm=8,
            harvest_window_overrides={
                '2026': {'start_date': '2026-12-25', 'end_date': '2027-01-15'},
            },
        )
        headers = {'HTTP_X_SEASON_ID': str(active.pk)}
        response = self.client.get(CALENDAR_WINDOWS, {
            'start_date': '2026-01-05', 'end_date': '2028-01-20',
        }, **headers)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json(), {
            'windows_by_plan': {str(plan.pk): [
                {
                    'start_date': '2026-01-05', 'end_date': '2026-01-10',
                    'occurrence_start_date': '2025-12-20',
                },
                {
                    'start_date': '2026-12-25', 'end_date': '2027-01-15',
                    'occurrence_start_date': '2026-12-25',
                },
                {
                    'start_date': '2027-12-20', 'end_date': '2028-01-04',
                    'occurrence_start_date': '2027-12-20',
                },
            ]},
            'next_start_date': None,
        })
        invalid = self.client.get(CALENDAR_WINDOWS, {
            'start_date': '2028-01-20', 'end_date': '2026-01-05',
        }, **headers)
        self.assertEqual(invalid.status_code, 400)
        details = self.client.get(f'{PLANS}{plan.pk}/', **headers).json()
        self.assertEqual(details['seasonal_harvest']['periods'], [
            {'start_date': '2025-12-20', 'end_date': '2026-01-10'},
        ])

    def test_calendar_projection_pages_wide_ranges_and_preserves_occurrence_identity(self) -> None:
        season = self.season(date(2026, 1, 1), date(2026, 12, 31))
        plan = PlantingPlan.objects.create(
            project=self.project, crop=self.crop_with_window('12-20/01-10'), bed=self.bed,
            season=season, planting_date=date(2026, 3, 15), clearing_date=date(2040, 1, 4),
            area_usage_sqm=8,
        )
        params = {'start_date': '2026-01-01', 'end_date': '2040-01-04'}
        headers = {'HTTP_X_SEASON_ID': str(season.pk)}
        first = self.client.get(CALENDAR_WINDOWS, params, **headers).json()
        self.assertEqual(first['next_start_date'], '2036-01-01')
        self.assertEqual(len(first['windows_by_plan'][str(plan.pk)]), 10)
        self.assertEqual(first['windows_by_plan'][str(plan.pk)][-1], {
            'start_date': '2035-12-20', 'end_date': '2035-12-31',
            'occurrence_start_date': '2035-12-20',
        })
        second = self.client.get(
            CALENDAR_WINDOWS, {**params, 'start_date': first['next_start_date']}, **headers,
        ).json()
        self.assertIsNone(second['next_start_date'])
        self.assertEqual(second['windows_by_plan'][str(plan.pk)][0], {
            'start_date': '2036-01-01', 'end_date': '2036-01-10',
            'occurrence_start_date': '2035-12-20',
        })
        invalid_season = self.client.get(
            CALENDAR_WINDOWS, params, HTTP_X_SEASON_ID=str(season.pk + 1),
        )
        self.assertEqual(invalid_season.json(), {'windows_by_plan': {}, 'next_start_date': None})

    def test_detail_record_season_scopes_dates_allocations_losses_and_tasks(self) -> None:
        origin = self.season(date(2024, 1, 1), date(2024, 12, 31))
        historical = self.season(date(2025, 1, 1), date(2025, 12, 31))
        inspected = self.season(date(2026, 9, 1), date(2027, 8, 31))
        active = self.season(date(2028, 1, 1), date(2028, 12, 31))
        crop = self.crop_with_window('12-20/01-10')
        plan = PlantingPlan.objects.create(
            project=self.project, crop=crop, bed=self.bed, season=origin,
            planting_date=date(2024, 3, 15), clearing_date=date(2030, 4, 1),
            actual_harvest_start_date=date(2025, 12, 22), area_usage_sqm=8,
        )
        for day, quantity, unit in (
            (date(2025, 12, 20), Decimal('1'), 'kg'),
            (inspected.start_date, Decimal('3.5'), 'kg'),
            (inspected.end_date, Decimal('4'), 'bunch'),
            (date(2027, 9, 1), Decimal('6'), 'kg'),
        ):
            harvest = HarvestRecord.objects.create(
                project=self.project, crop=crop, date=day, quantity=quantity, unit=unit,
            )
            HarvestAllocation.objects.create(
                project=self.project, harvest=harvest, planting_plan=plan, quantity=quantity,
            )
            CropLoss.objects.create(
                project=self.project, planting_plan=plan, date=day,
                loss_type='partial', cause='frost',
            )
        older_task = Task.objects.create(
            project=self.project, planting_plan=plan, season=origin, title='Earlier task',
            due_date=date(2025, 12, 20),
        )
        headers = {'HTTP_X_SEASON_ID': str(active.pk)}
        task = self.client.post(TASKS, {
            'title': 'Inspect standing crop', 'planting_plan': plan.pk,
            'season': inspected.pk, 'due_date': inspected.end_date.isoformat(),
        }, format='json', **headers)
        self.assertEqual(task.status_code, 201, task.data)

        details_url = f'{PLANS}{plan.pk}/'
        params = {'across_seasons': 'true', 'record_season': inspected.pk}
        detail = self.client.get(details_url, params, **headers).json()
        self.assertEqual(detail['season'], origin.pk)
        self.assertEqual(detail['planting_date'], '2024-03-15')
        self.assertEqual(detail['clearing_date'], '2030-04-01')
        self.assertEqual(detail['observed_first_harvest_date'], inspected.start_date.isoformat())
        self.assertEqual(detail['seasonal_harvest']['periods'], [
            {'start_date': '2026-12-20', 'end_date': '2027-01-10'},
        ])
        self.assertIsNone(detail['seasonal_harvest']['actual_start_date'])
        self.assertIsNone(detail['seasonal_harvest']['actual_end_date'])
        self.assertEqual(detail['actual_harvest']['quantities'], [
            {'unit': 'kg', 'quantity': '3.5'}, {'unit': 'bunch', 'quantity': '4'},
        ])
        for endpoint in (HARVESTS, LOSSES):
            rows = self.client.get(endpoint, {
                'planting_plan': plan.pk, 'record_season': inspected.pk,
            }, **headers).json()['results']
            self.assertEqual({row['date'] for row in rows}, {'2026-09-01', '2027-08-31'})
        tasks = self.client.get(TASKS, {
            'planting_plan': plan.pk, 'record_season': inspected.pk,
        }, **headers).json()['results']
        self.assertEqual([row['id'] for row in tasks], [task.data['id']])
        task_edit = self.client.patch(
            f"{TASKS}{task.data['id']}/?record_season={inspected.pk}",
            {'title': 'Checked standing crop'}, format='json', **headers,
        )
        self.assertEqual(task_edit.status_code, 200, task_edit.data)
        previous = self.client.get(
            details_url, {**params, 'record_season': historical.pk}, **headers,
        ).json()
        self.assertEqual(previous['seasonal_harvest']['actual_start_date'], '2025-12-22')
        self.assertEqual(previous['observed_first_harvest_date'], '2025-12-20')
        historical_tasks = self.client.get(TASKS, {
            'planting_plan': plan.pk, 'record_season': historical.pk,
        }, **headers).json()['results']
        self.assertEqual([row['id'] for row in historical_tasks], [older_task.pk])
        plan.refresh_from_db()
        self.assertEqual(plan.actual_harvest_start_date, date(2025, 12, 22))
        self.assertIsNone(plan.recorded_harvest_end_date)
        forbidden_edit = self.client.patch(
            f'{details_url}?record_season={origin.pk}', {'notes': 'Changed outside origin'},
            format='json', **headers,
        )
        self.assertEqual(forbidden_edit.status_code, 404)
        foreign = Project.objects.create(name='Other orchard', slug='other-orchard')
        foreign_season = Season.objects.create(
            project=foreign, start_date=inspected.start_date, end_date=inspected.end_date,
        )
        forbidden_read = self.client.get(
            details_url, {**params, 'record_season': foreign_season.pk}, **headers,
        )
        self.assertEqual(forbidden_read.status_code, 404)

    def test_actual_planting_anniversaries_and_leap_boundaries(self) -> None:
        crop = self.crop_with_window('02-15/02-29', first_harvest_delay_years=2)
        plan = PlantingPlan(
            crop=crop, planting_date=date(2024, 2, 15), actual_sowing_date=date(2024, 2, 29),
            clearing_date=date(2029, 5, 1), cultivation_type='direct_sowing',
        )
        schedule = recurring_harvest_schedule(plan)
        self.assertEqual(schedule.project(date(2025, 1, 1), date(2025, 12, 31)), [])
        first, = schedule.project(date(2026, 1, 1), date(2026, 12, 31))
        self.assertEqual((first.start_date, first.end_date), (date(2026, 2, 28), date(2026, 2, 28)))
        leap, = schedule.project(date(2028, 1, 1), date(2028, 12, 31))
        self.assertEqual(leap.end_date, date(2028, 2, 29))

        crop.annual_harvest_window = '02-29/02-28'
        schedule = recurring_harvest_schedule(plan)
        previous, current = schedule.project(date(2027, 1, 1), date(2027, 12, 31))
        self.assertEqual(previous.end_date, date(2027, 2, 27))
        self.assertEqual(current.start_date, date(2027, 2, 28))

    def test_identical_copies_share_one_forecast_until_their_eligibility_differs(self) -> None:
        origin = self.season(date(2025, 1, 1), date(2025, 12, 31))
        target = self.season(date(2026, 1, 1), date(2026, 12, 31))
        crop = self.crop_with_window('09-01/09-02')
        source = PlantingPlan.objects.create(
            project=self.project, crop=crop, bed=self.bed, season=origin,
            planting_date=date(2025, 3, 15), clearing_date=date(2025, 12, 31), area_usage_sqm=8,
        )
        template = dict(
            project=self.project, crop=crop, bed=self.bed, season=target,
            planting_date=date(2026, 3, 15), clearing_date=date(2026, 12, 31), area_usage_sqm=8,
            copied_from_plan_id=source.pk, cultivation_type='pre_cultivation',
        )
        PlantingPlan.objects.create(**template)
        changed = PlantingPlan.objects.create(**template)
        self.assertEqual(self.forecast(target), Decimal(16))
        self.assertEqual(self.comparison(crop)[target.pk]['forecast_kg'], '16')

        changed.actual_transplanting_date = date(2026, 9, 2)
        changed.save(update_fields=['actual_transplanting_date'])
        self.assertEqual(self.forecast(target), Decimal(24))
        self.assertEqual(self.comparison(crop)[target.pk]['forecast_kg'], '24')

    def test_unscheduled_perennials_are_incomplete_only_in_their_own_season(self) -> None:
        origin = self.season(date(2025, 1, 1), date(2025, 12, 31))
        later = self.season(date(2026, 1, 1), date(2026, 12, 31))
        crop = self.crop_with_window('09-01/10-15', first_harvest_delay_years=2)
        draft = PlantingPlan.objects.create(
            project=self.project, crop=crop, bed=self.bed, season=origin, area_usage_sqm=8,
        )
        PlantingPlan.objects.create(
            project=self.project, crop=crop, bed=self.bed, season=origin, area_usage_sqm=8,
            planting_date=date(2025, 3, 15), clearing_date=date(2028, 12, 31),
        )

        for season, expected_ids in ((origin, [draft.pk]), (later, [])):
            with self.subTest(season=season.label):
                response = self.client.get(
                    FORECAST, {'include_incomplete': 'true'}, HTTP_X_SEASON_ID=str(season.pk),
                )
                self.assertEqual(response.status_code, 200, response.data)
                self.assertEqual(response.data['weeks'], [])
                incomplete = response.data['incomplete_plans']
                self.assertEqual([entry['plan_id'] for entry in incomplete], expected_ids)
                if incomplete:
                    self.assertEqual(
                        incomplete[0]['calculation_blockers'], ['missing_harvest_period'],
                    )

        comparison = self.comparison(crop)
        self.assertEqual(comparison[origin.pk]['forecast_plan_count'], 0)
        self.assertEqual(comparison[origin.pk]['expected_plan_count'], 1)
        self.assertEqual(comparison[later.pk]['expected_plan_count'], 0)

    def test_zero_delay_uses_an_earlier_recorded_transplant_date(self) -> None:
        season = self.season(date(2026, 9, 1), date(2027, 8, 31))
        crop = self.crop_with_window('12-20/12-25', first_harvest_delay_years=0)
        plan = PlantingPlan.objects.create(
            project=self.project, crop=crop, bed=self.bed, season=season, area_usage_sqm=8,
            planting_date=date(2027, 1, 10), clearing_date=date(2029, 1, 10),
            actual_transplanting_date=date(2026, 12, 17), cultivation_type='purchased_transplant',
        )

        headers = {'HTTP_X_SEASON_ID': str(season.pk)}
        row = self.client.get(f'{PLANS}{plan.pk}/', **headers).json()
        self.assertEqual(row['planting_date'], '2027-01-10')
        self.assertTrue(row['seasonal_harvest']['planting_recorded'])
        self.assertEqual(row['seasonal_harvest']['periods'], [
            {'start_date': '2026-12-20', 'end_date': '2026-12-25'},
        ])
        weekly = self.client.get(FORECAST, {'year': 2026}, **headers)
        self.assertEqual(weekly.status_code, 200, weekly.data)
        self.assertEqual(sum(crop['yield'] for week in weekly.data for crop in week['crops']), 16)
        self.assertEqual(self.forecast(season), Decimal(16))
        self.assertEqual(self.comparison(crop)[season.pk]['forecast_kg'], '16')

    def test_early_occupancy_in_a_preceding_season_keeps_the_original_plan(self) -> None:
        earlier = self.season(date(2026, 1, 1), date(2026, 12, 31))
        owner = self.season(date(2027, 1, 1), date(2027, 12, 31))
        crop = self.crop_with_window('12-20/12-25')
        plan = PlantingPlan.objects.create(
            project=self.project, crop=crop, bed=self.bed, season=owner, area_usage_sqm=8,
            planting_date=date(2027, 1, 10), clearing_date=date(2027, 9, 15),
            actual_transplanting_date=date(2026, 12, 17), cultivation_type='purchased_transplant',
        )
        annual = Crop.objects.create(
            project=self.project, name='Annual comparator', life_cycle='annual',
        )
        PlantingPlan.objects.create(
            project=self.project, crop=annual, bed=self.bed, season=owner, area_usage_sqm=8,
            planting_date=date(2027, 1, 10), actual_transplanting_date=date(2026, 12, 17),
            cultivation_type='purchased_transplant',
        )

        headers = {'HTTP_X_SEASON_ID': str(earlier.pk)}
        response = self.client.get(PLANS, **headers)
        self.assertEqual(response.status_code, 200, response.data)
        row, = response.json()['results']
        self.assertEqual(row['id'], plan.pk)
        self.assertEqual(row['season'], owner.pk)
        self.assertTrue(row['carried_over'])
        self.assertEqual(row['seasonal_harvest']['occupancy_start_date'], '2026-12-17')
        self.assertEqual(row['seasonal_harvest']['periods'], [
            {'start_date': '2026-12-20', 'end_date': '2026-12-25'},
        ])
        detail = self.client.get(f'{PLANS}{plan.pk}/', **headers)
        self.assertEqual(detail.status_code, 200, detail.data)
        edit = self.client.patch(f'{PLANS}{plan.pk}/', {'notes': 'test'}, **headers)
        self.assertEqual(edit.status_code, 404)

        self.assertEqual(self.forecast(earlier), Decimal(16))
        self.assertEqual(self.forecast(owner), 0)
        harvest = self.client.post('/openfarmplanner/api/harvests/', {
            'crop': crop.pk, 'date': '2026-12-21', 'quantity': 3, 'unit': 'kg',
            'allocations': [{'planting_plan': plan.pk, 'quantity': 3}],
        }, format='json', **headers)
        self.assertEqual(harvest.status_code, 201, harvest.data)
        comparison = self.comparison(crop)
        self.assertEqual(comparison[earlier.pk]['forecast_kg'], '16')
        self.assertEqual(comparison[earlier.pk]['recorded']['measured_kg'], '3')
        self.assertIsNone(comparison[owner.pk]['forecast_kg'])
        self.assertIsNone(comparison[owner.pk]['recorded']['measured_kg'])
