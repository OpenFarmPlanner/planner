"""Perennial defaults, explicit occupancy, season scoping, and rotation."""

from datetime import date

from crops.models import CropSpecies, PlantFamily
from farm.crops.serializers.public import PublicCropUpdateSerializer
from farm.models import (
    Bed,
    Crop,
    EntityRevision,
    HarvestAllocation,
    HarvestRecord,
    PlantingPlan,
    PublicCrop,
    Season,
    Task,
)
from farm.services.crop_rotation import STATUS_CONFLICT, STATUS_OK, RotationService
from farm.tests.api_base import ProjectApiTestCase

PLANS = '/openfarmplanner/api/planting-plans/'
CROPS = '/openfarmplanner/api/crops/'


class PerennialPlanningTest(ProjectApiTestCase):
    def setUp(self):
        super().setUp()
        self.source = self.season(2024)
        self.next_season = self.season(2025)
        self.client.defaults['HTTP_X_SEASON_ID'] = str(self.source.pk)
        self.species = CropSpecies.objects.create(
            name='Synthetic perennial species', status=CropSpecies.STATUS_PUBLISHED,
        )

    def season(self, year):
        return Season.objects.create(
            project=self.project, start_date=date(year, 1, 1), end_date=date(year, 12, 31),
        )

    def perennial(self, *, standing_time=3, **attributes):
        return Crop.objects.create(
            project=self.project, name='Rhubarb', life_cycle='perennial',
            standing_time_years=standing_time, growth_duration_days=20,
            harvest_duration_days=7, expected_yield=2, harvest_method='per_sqm',
            **attributes,
        )

    def plant(self, crop, **attributes):
        return self.client.post(PLANS, {
            'crop': crop.pk, 'bed': self.bed.pk, 'planting_date': '2024-02-29',
            'area_usage_sqm': 20, **attributes,
        })

    def test_saves_and_resets_one_occurrence_without_changing_execution(self):
        crop = self.perennial(
            standing_time=6, annual_harvest_window='09-01/10-15', first_harvest_delay_years=2,
        )
        fruiting_season = self.season(2027)
        following_season = self.season(2028)
        created = self.plant(crop, actual_harvest_start_date='2024-10-03')
        self.assertEqual(created.status_code, 201, created.data)
        plan = PlantingPlan.objects.get(pk=created.data['id'])
        harvested = self.client.post('/openfarmplanner/api/harvests/', {
            'crop': crop.pk, 'date': '2027-09-10', 'quantity': '3', 'unit': 'kg',
            'allocations': [{'planting_plan': plan.pk, 'quantity': '3'}],
        }, format='json', HTTP_X_SEASON_ID=str(fruiting_season.pk))
        self.assertEqual(harvested.status_code, 201, harvested.data)
        record = HarvestRecord.objects.get(pk=harvested.data['id'])
        allocation = HarvestAllocation.objects.get(
            harvest=record, planting_plan=plan,
        )
        task_ids = set(Task.objects.filter(planting_plan=plan).values_list('pk', flat=True))
        detail = f'{PLANS}{plan.pk}/'
        endpoint = f'{detail}harvest-window/2027/'
        dates = {'start_date': '2027-09-10', 'end_date': '2027-10-20'}
        saved = self.client.put(endpoint, dates, format='json')
        self.assertEqual(saved.status_code, 200, saved.data)
        version_filter = EntityRevision.objects.filter(
            project=self.project, entity_type='planting_plan', object_id=plan.pk,
        )
        revision_count = version_filter.count()
        self.assertEqual(self.client.put(endpoint, dates, format='json').status_code, 200)
        self.assertEqual(version_filter.count(), revision_count)

        for season, expected in (
            (fruiting_season, dates),
            (following_season, {'start_date': '2028-09-01', 'end_date': '2028-10-15'}),
        ):
            header = {'HTTP_X_SEASON_ID': str(season.pk)}
            response = self.client.get(PLANS, **header)
            self.assertEqual(response.status_code, 200, response.data)
            row = response.json()['results'][0]
            self.assertEqual(row['id'], plan.pk)
            self.assertTrue(row['carried_over'])
            self.assertEqual(row['seasonal_harvest']['periods'], [expected])
            blocked = self.client.put(endpoint, dates, format='json', **header)
            self.assertEqual(blocked.status_code, 404)
            self.assertEqual(self.client.delete(endpoint, **header).status_code, 404)

        self.assertEqual(self.client.delete(endpoint).status_code, 200)
        page = self.client.get(detail).json()['harvest_windows_by_year']
        occurrence = next(item for item in page['occurrences'] if item['year'] == 2027)
        self.assertEqual(occurrence['default'], {
            'start_date': '2027-09-01', 'end_date': '2027-10-15',
        })
        self.assertIsNone(occurrence['override'])
        reloaded = PlantingPlan.objects.get(pk=plan.pk)
        self.assertEqual(reloaded.planting_date, plan.planting_date)
        self.assertEqual(reloaded.harvest_date, plan.harvest_date)
        self.assertEqual(reloaded.actual_harvest_start_date, plan.actual_harvest_start_date)
        self.assertEqual(reloaded.season_id, plan.season_id)
        self.assertEqual(PlantingPlan.objects.filter(project=self.project).count(), 1)
        self.assertEqual(
            set(Task.objects.filter(planting_plan=plan).values_list('pk', flat=True)), task_ids,
        )
        self.assertEqual(HarvestAllocation.objects.get(planting_plan=plan), allocation)
        self.assertEqual(HarvestRecord.objects.get(pk=record.pk).date, date(2027, 9, 10))

    def test_override_dates_follow_first_bearing_leap_year_and_removal(self):
        crop = self.perennial(annual_harvest_window='02-29/03-05', first_harvest_delay_years=2)
        created = self.plant(crop, clearing_date='2028-03-10')
        self.assertEqual(created.status_code, 201, created.data)
        detail = f"{PLANS}{created.data['id']}/"

        for year, start, end in (
            (2025, '2025-03-01', '2025-03-02'),  # Before first bearing.
            (2026, '2026-02-27', '2026-03-04'),  # Before the clamped anniversary.
            (2028, '2028-03-03', '2028-03-02'),  # Reversed.
            (2028, '2028-03-02', '2028-03-11'),  # Beyond removal.
        ):
            with self.subTest(year=year, start=start, end=end):
                response = self.client.put(f'{detail}harvest-window/{year}/', {
                    'start_date': start, 'end_date': end,
                }, format='json')
                self.assertEqual(response.status_code, 400, response.data)
                self.assertEqual(response.data['code'], 'invalid_harvest_window')

        dates = {'start_date': '2028-03-01', 'end_date': '2028-03-09'}
        endpoint = f'{detail}harvest-window/2028/'
        saved = self.client.put(endpoint, dates, format='json')
        self.assertEqual(saved.status_code, 200, saved.data)
        shortened = self.client.patch(detail, {'clearing_date': '2028-03-02'}, format='json')
        self.assertEqual(shortened.status_code, 200, shortened.data)
        season = self.season(2028)
        loaded = self.client.get(detail, HTTP_X_SEASON_ID=str(season.pk)).json()
        page = loaded['harvest_windows_by_year']
        occurrence = next(item for item in page['occurrences'] if item['year'] == 2028)
        self.assertEqual(occurrence['override'], dates)
        self.assertTrue(occurrence['conflict'])
        self.assertEqual(loaded['seasonal_harvest']['periods'], [{
            'start_date': '2028-02-29', 'end_date': '2028-03-02',
        }])

    def test_one_override_splits_forecast_across_custom_seasons(self):
        self.next_season.start_date = date(2025, 9, 1)
        self.next_season.save(update_fields=['start_date'])
        following = Season.objects.create(
            project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 8, 31),
        )
        created = self.plant(self.perennial(
            annual_harvest_window='11-20/01-20', first_harvest_delay_years=1,
        ))
        self.assertEqual(created.status_code, 201, created.data)
        detail = f"{PLANS}{created.data['id']}/"
        dates = {'start_date': '2025-12-27', 'end_date': '2026-01-05'}
        saved = self.client.put(f'{detail}harvest-window/2025/', dates, format='json')
        self.assertEqual(saved.status_code, 200, saved.data)
        for season, start, end in (
            (self.next_season, '2025-12-27', '2025-12-31'),
            (following, '2026-01-01', '2026-01-05'),
        ):
            header = {'HTTP_X_SEASON_ID': str(season.pk)}
            loaded = self.client.get(detail, **header).json()
            self.assertEqual(loaded['seasonal_harvest']['periods'], [{
                'start_date': start, 'end_date': end,
            }])
            page = loaded['harvest_windows_by_year']
            windows = [item for item in page['occurrences'] if item['override']]
            self.assertEqual(len(windows), 1)
            self.assertEqual(windows[0]['year'], 2025)
            self.assertEqual(windows[0]['override'], dates)
            forecast = self.client.get('/openfarmplanner/api/yield-calendar/', **header)
            self.assertEqual(forecast.status_code, 200, forecast.data)
            projected_yield = sum(crop['yield'] for week in forecast.data for crop in week['crops'])
            self.assertAlmostEqual(projected_yield, 20)

    def test_lifetime_windows_are_bounded_and_allow_navigation_to_a_distant_year(self):
        crop = self.perennial(annual_harvest_window='12-01/01-31')
        january = Season.objects.create(
            project=self.project, start_date=date(2044, 1, 1), end_date=date(2044, 8, 31),
        )
        created = self.plant(crop, clearing_date='9999-12-31')
        self.assertEqual(created.status_code, 201, created.data)
        detail = f"{PLANS}{created.data['id']}/"
        first = self.client.get(detail).json()['harvest_windows_by_year']
        self.assertEqual([item['year'] for item in first['occurrences']], list(range(2024, 2044)))
        self.assertIsNone(first['previous_year'])
        self.assertEqual(first['next_year'], 2044)
        second = self.client.get(detail, {'harvest_year': first['next_year']}).json()
        self.assertEqual(second['harvest_windows_by_year']['previous_year'], 2043)
        distant = self.client.get(detail, {'harvest_year': 9999}).json()['harvest_windows_by_year']
        self.assertLessEqual(len(distant['occurrences']), 20)
        self.assertEqual(distant['occurrences'][-1]['year'], 9999)
        self.assertIsNone(distant['next_year'])
        january_detail = self.client.get(detail, HTTP_X_SEASON_ID=str(january.pk)).json()
        self.assertEqual(january_detail['harvest_windows_by_year']['occurrences'][-1]['year'], 2043)

    def test_history_restores_overrides_and_accepts_pre_migration_snapshots(self):
        created = self.plant(self.perennial(annual_harvest_window='09-01/10-15'))
        self.assertEqual(created.status_code, 201, created.data)
        plan_id = created.data['id']
        detail = f'{PLANS}{plan_id}/'
        versions = EntityRevision.objects.filter(
            project=self.project, entity_type='planting_plan', object_id=plan_id,
        )
        before = versions.latest('id')
        before.snapshot.pop('harvest_window_overrides')
        before.save(update_fields=['snapshot'])
        dates = {'start_date': '2025-09-10', 'end_date': '2025-10-20'}
        response = self.client.put(f'{detail}harvest-window/2025/', dates, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        saved = versions.latest('id')
        self.assertEqual(saved.snapshot['harvest_window_overrides'], {'2025': dates})
        self.assertIn('harvest_window_overrides', saved.changed_fields)
        response = self.client.patch(detail, {'notes': 'Later edit'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        plan = PlantingPlan.objects.get(pk=plan_id)
        self.assertEqual(plan.harvest_window_overrides, {'2025': dates})

        for version, expected in ((before, {}), (saved, {'2025': dates})):
            response = self.client.post('/openfarmplanner/api/history/project/restore/', {
                'history_id': version.pk,
            }, format='json')
            self.assertEqual(response.status_code, 200, response.data)
            plan.refresh_from_db()
            self.assertEqual(plan.harvest_window_overrides, expected)

    def test_crop_writes_require_positive_whole_years_and_allow_variety_inheritance(self):
        base = {'name': 'Rhubarb', 'life_cycle': 'perennial', 'crop_species': self.species.pk}
        for override in ({}, {'standing_time_years': 0}, {'standing_time_years': 2.5}):
            with self.subTest(override=override):
                missing = self.client.post(CROPS, {**base, **override})
                self.assertEqual(missing.status_code, 400, missing.data)
                self.assertIn('standing_time_years', missing.data)
        parent = self.client.post(CROPS, {**base, 'standing_time_years': 3})
        self.assertEqual(parent.status_code, 201, parent.data)
        self.assertEqual(parent.data['standing_time_years'], 3)

        variety = self.client.post(CROPS, {**base, 'variety': 'Early stems'})
        self.assertEqual(variety.status_code, 201, variety.data)
        self.assertIsNone(variety.data['standing_time_years'])
        self.assertEqual(variety.data['effective_values']['standing_time_years'], 3)
        variety_crop = Crop.objects.get(pk=variety.data['id'])
        plan = self.plant(variety_crop)
        self.assertEqual(plan.status_code, 201, plan.data)
        self.assertEqual(plan.data['clearing_date'], '2027-02-28')

        annual = self.client.post(CROPS, {
            'name': 'Annual salad', 'life_cycle': 'annual', 'standing_time_years': 4,
        })
        self.assertEqual(annual.status_code, 201, annual.data)
        self.assertIsNone(annual.data['standing_time_years'])

    def test_inherits_a_complete_annual_window_and_preserves_a_zero_delay(self) -> None:
        parent = self.perennial(crop_species=self.species)
        plan = self.plant(parent)
        self.assertEqual(plan.status_code, 201, plan.data)
        timing = {'annual_harvest_window': '12-15/02-29', 'first_harvest_delay_years': 2}
        response = self.client.patch(f'{CROPS}{parent.pk}/', timing, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        for field, value in timing.items():
            self.assertEqual(response.data[field], value)

        response = self.client.post(CROPS, {
            'name': parent.name, 'variety': 'Early stems', 'crop_species': self.species.pk,
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['annual_harvest_window'], '')
        self.assertIsNone(response.data['first_harvest_delay_years'])
        for field, value in timing.items():
            self.assertEqual(response.data['effective_values'][field], value)
            self.assertIn(field, response.data['inherited_fields'])

        response = self.client.patch(f"{CROPS}{response.data['id']}/", {
            'annual_harvest_window': '06-01/06-01', 'first_harvest_delay_years': 0,
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['effective_values']['annual_harvest_window'], '06-01/06-01')
        self.assertEqual(response.data['effective_values']['first_harvest_delay_years'], 0)
        self.assertNotIn('first_harvest_delay_years', response.data['inherited_fields'])
        reloaded = self.client.get(f"{PLANS}{plan.data['id']}/")
        for field in ('planting_date', 'harvest_date', 'harvest_end_date', 'clearing_date'):
            self.assertEqual(reloaded.data[field], plan.data[field])

    def test_annual_harvest_timing_rejects_invalid_dates_and_delay(self) -> None:
        crop = self.perennial()
        url = f'{CROPS}{crop.pk}/'
        for field, value in (
            ('annual_harvest_window', '04-31/06-01'),
            ('annual_harvest_window', '12-01/02-30'),
            ('annual_harvest_window', '09-01/'),
            ('annual_harvest_window', '2026-09-01/10-15'),
            ('first_harvest_delay_years', -1),
            ('first_harvest_delay_years', 1.5),
        ):
            with self.subTest(field=field, value=value):
                response = self.client.patch(url, {field: value}, format='json')
                self.assertEqual(response.status_code, 400, response.data)
                self.assertIn(field, response.data)
        crop.refresh_from_db()
        self.assertEqual(crop.annual_harvest_window, '')
        self.assertIsNone(crop.first_harvest_delay_years)

    def test_crop_file_import_previews_updates_and_persists_annual_timing(self) -> None:
        crop = self.perennial()
        invalid = self.client.post(f'{CROPS}import/preview/', [
            {'name': crop.name, 'annual_harvest_window': '12-15/02-30'},
        ], format='json')
        self.assertIn('annual_harvest_window', invalid.data['results'][0]['error'])
        timing = {'annual_harvest_window': '09-01/10-15', 'first_harvest_delay_years': 0}
        items = [{'name': crop.name, **timing}]
        response = self.client.post(f'{CROPS}import/preview/', items, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        changes = response.data['results'][0]['diff']
        self.assertEqual({item['field']: item['new'] for item in changes}, timing)
        response = self.client.post(f'{CROPS}import/apply/', {
            'items': items, 'confirm_updates': True,
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['errors'], [])
        crop.refresh_from_db()
        self.assertEqual(crop.annual_harvest_window, timing['annual_harvest_window'])
        self.assertEqual(crop.first_harvest_delay_years, 0)
        response = self.client.post(f'{CROPS}import/apply/', {
            'items': [{
                'name': crop.name, 'annual_harvest_window': '', 'first_harvest_delay_years': None,
            }],
            'confirm_updates': True,
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['errors'], [])
        crop.refresh_from_db()
        self.assertEqual(crop.annual_harvest_window, '')
        self.assertIsNone(crop.first_harvest_delay_years)

    def test_legacy_values_remain_readable_and_new_plantings_require_a_lifespan(self):
        perennial = self.perennial(standing_time=None)
        update = self.client.patch(f'{CROPS}{perennial.pk}/', {'notes': 'Older crop'})
        self.assertEqual(update.status_code, 200, update.data)
        self.assertIsNone(update.data['standing_time_years'])
        rejected = self.plant(perennial, clearing_date='2026-10-30')
        self.assertEqual(rejected.status_code, 400, rejected.data)
        self.assertIn('crop', rejected.data)

        old = PlantingPlan.objects.create(
            project=self.project, crop=perennial, bed=self.bed, season=self.source,
            planting_date=date(2024, 3, 2),
        )
        read = self.client.get(f'{PLANS}{old.pk}/')
        self.assertEqual(read.status_code, 200, read.data)
        self.assertIsNone(read.data['clearing_date'])
        explicit = self.client.patch(f'{PLANS}{old.pk}/', {'clearing_date': '2026-10-30'})
        self.assertEqual(explicit.status_code, 200, explicit.data)
        self.assertEqual(explicit.data['clearing_date'], '2026-10-30')

        biennial = Crop.objects.create(
            project=self.project, name='Older crop', life_cycle='biennial',
        )
        read = self.client.get(f'{CROPS}{biennial.pk}/')
        self.assertEqual(read.data['life_cycle'], 'biennial')

    def test_clearing_is_editable_and_controls_scoping_capacity_and_rotation(self):
        family = PlantFamily.objects.get(botanical_name='Polygonaceae')
        perennial = self.perennial(crop_family=family, rotation_break_years=3)
        created = self.plant(perennial)
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.json()['suggested_clearing_date'], '2027-02-28')
        self.assertEqual(created.data['occupancy_end_date'], '2027-02-28')
        self.assertEqual(created.json()['harvest_end_date'], '2024-03-27')
        plan_id = created.data['id']
        url = f'{PLANS}{plan_id}/'

        earlier = self.client.patch(url, {'clearing_date': '2024-02-28'})
        self.assertEqual(earlier.status_code, 400)
        empty = self.client.patch(url, {'clearing_date': None}, format='json')
        self.assertEqual(empty.status_code, 400)
        later = self.client.patch(url, {'clearing_date': '2028-06-01'})
        self.assertEqual(later.status_code, 200, later.data)
        self.assertEqual(later.json()['harvest_end_date'], '2024-03-27')

        changed_lifespan = self.client.patch(
            f'{CROPS}{perennial.pk}/', {'standing_time_years': 6},
        )
        self.assertEqual(changed_lifespan.status_code, 200, changed_lifespan.data)
        reloaded = self.client.get(url)
        self.assertEqual(reloaded.data['clearing_date'], '2028-06-01')
        self.assertEqual(reloaded.json()['suggested_clearing_date'], '2030-02-28')

        candidate = {'crop_id': perennial.pk, 'exclude_plan_id': plan_id}
        preflight = self.client.get(f'{PLANS}remaining-area/', {
            **candidate, 'start_date': '2024-02-29', 'bed_id': self.bed.pk,
        })
        suggestions = self.client.get(f'{PLANS}bed-suggestions/', {
            **candidate, 'planting_date': '2024-02-29',
        })
        for response in (preflight, suggestions):
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(response.data['end_date'], '2028-06-01')

        scope = {'HTTP_X_SEASON_ID': str(self.next_season.pk)}
        carried = self.client.get(PLANS, **scope).data['results']
        self.assertEqual([(row['id'], row['carried_over']) for row in carried], [(plan_id, True)])
        denied = self.client.patch(url, {'clearing_date': '2026-02-02'}, **scope)
        self.assertEqual(denied.status_code, 404)
        after_clearing = self.season(2029)
        after_scope = {'HTTP_X_SEASON_ID': str(after_clearing.pk)}
        self.assertEqual(self.client.get(PLANS, **after_scope).data['count'], 0)

        remaining = f'{PLANS}remaining-area/'
        full = self.client.get(remaining, {
            'bed_id': self.bed.pk, 'start_date': '2028-06-01', 'crop_id': self.crop.pk,
        })
        free = self.client.get(remaining, {
            'bed_id': self.bed.pk, 'start_date': '2028-06-02', 'crop_id': self.crop.pk,
        })
        self.assertEqual(full.data['remaining_area_sqm'], 0)
        self.assertEqual(free.data['remaining_area_sqm'], 20)
        self.assertEqual(free.data['end_date'], '2028-06-11')

        annual = Crop.objects.create(
            project=self.project, name='Annual relative', crop_family=family,
            rotation_break_years=3, life_cycle='annual',
        )
        rotation = RotationService(self.project.pk, language_code='en')
        stored_plan = PlantingPlan.objects.get(pk=plan_id)
        self.assertEqual(rotation.check_plan(stored_plan).status, STATUS_OK)
        candidate = rotation.occupancy(
            crop=annual, bed_id=self.bed.pk, start=date(2029, 3, 1), end=date(2029, 4, 1),
        )
        conflict = rotation.check(candidate)
        self.assertEqual(conflict.status, STATUS_CONFLICT)
        self.assertEqual(conflict.findings[0].earliest_year, 2032)

    def test_capacity_preflight_uses_the_perennial_interval_after_a_crop_change(self):
        original = self.plant(self.crop)
        self.assertEqual(original.status_code, 201, original.data)
        occupant = self.plant(self.crop, planting_date='2025-04-01', season=self.next_season.pk)
        self.assertEqual(occupant.status_code, 201, occupant.data)
        crop = self.perennial()
        url = f'{PLANS}remaining-area/'
        params = {
            'bed_id': self.bed.pk, 'start_date': '2024-02-29', 'crop_id': crop.pk,
            'exclude_plan_id': original.data['id'], 'end_date': '2024-03-10',
        }
        retargeted = self.client.get(url, params)
        self.assertEqual(retargeted.status_code, 200, retargeted.data)
        self.assertEqual(retargeted.data['end_date'], '2027-02-28')
        self.assertEqual(retargeted.data['remaining_area_sqm'], 0)

        edited = self.client.get(url, {**params, 'clearing_date': '2025-03-31'})
        self.assertEqual(edited.status_code, 200, edited.data)
        self.assertEqual(edited.data['end_date'], '2025-03-31')
        self.assertEqual(edited.data['remaining_area_sqm'], 20)

        suggestions_url = f'{PLANS}bed-suggestions/'
        suggestions_params = {**params, 'planting_date': params['start_date'], 'area_sqm': 20}
        for clearing_date, expected_end, fits in (
            ({}, '2027-02-28', False),
            ({'clearing_date': '2025-03-31'}, '2025-03-31', True),
        ):
            with self.subTest(clearing_date=clearing_date):
                result = self.client.get(suggestions_url, {**suggestions_params, **clearing_date})
                self.assertEqual(result.status_code, 200, result.data)
                self.assertEqual(result.data['end_date'], expected_end)
                bed = next(row for row in result.data['results'] if row['bed_id'] == self.bed.pk)
                self.assertEqual(bed['has_enough_area'], fits)

        for invalid_date in ('2024-02-28', '2024-02-31'):
            with self.subTest(invalid_date=invalid_date):
                invalid = self.client.get(url, {**params, 'clearing_date': invalid_date})
                self.assertEqual(invalid.status_code, 400, invalid.data)

    def test_capacity_checks_use_the_recorded_start_of_a_recurring_perennial(self):
        crop = self.perennial(annual_harvest_window='02-12/02-15')
        created = self.plant(
            crop, actual_sowing_date='2024-02-10', cultivation_type='direct_sowing',
        )
        self.assertEqual(created.status_code, 201, created.data)
        plan_id = created.data['id']
        remaining = f'{PLANS}remaining-area/'
        suggestions = f'{PLANS}bed-suggestions/'
        params = {'bed_id': self.bed.pk, 'area_sqm': 20}
        for day, free in (('2024-02-09', 20), ('2024-02-10', 0)):
            with self.subTest(day=day):
                response = self.client.get(
                    remaining, {**params, 'start_date': day, 'end_date': day},
                )
                self.assertEqual(response.status_code, 200, response.data)
                self.assertEqual(response.data['remaining_area_sqm'], free)
        ranked = self.client.get(suggestions, {
            **params, 'crop_id': self.crop.pk, 'planting_date': '2024-02-12',
        })
        self.assertEqual(ranked.status_code, 200, ranked.data)
        self.assertFalse(ranked.data['results'][0]['has_enough_area'])
        self.assertEqual(ranked.data['results'][0]['blocking_plan']['plan_id'], plan_id)

        other = Bed.objects.create(
            project=self.project, field=self.bed.field, name='Second bed', area_sqm=20,
        )
        PlantingPlan.objects.create(
            project=self.project, season=self.source, bed=other, crop=self.crop, area_usage_sqm=20,
            planting_date=date(2024, 2, 9), harvest_date=date(2024, 2, 16),
            harvest_end_date=date(2024, 2, 20), harvest_date_is_explicit=True,
            harvest_end_date_is_explicit=True,
        )
        edit = {'bed_id': other.pk, 'crop_id': crop.pk, 'exclude_plan_id': plan_id, 'area_sqm': 20}
        preflight = self.client.get(remaining, {**edit, 'start_date': '2024-02-29'})
        self.assertEqual(preflight.status_code, 200, preflight.data)
        self.assertEqual(preflight.data['remaining_area_sqm'], 0)
        ranked_edit = self.client.get(suggestions, {**edit, 'planting_date': '2024-02-29'})
        self.assertEqual(ranked_edit.status_code, 200, ranked_edit.data)
        destination = next(row for row in ranked_edit.data['results'] if row['bed_id'] == other.pk)
        self.assertFalse(destination['has_enough_area'])

    def test_capacity_preflight_uses_the_proposed_cultivation_type_for_recorded_dates(self):
        crop = self.perennial(
            annual_harvest_window='02-12/02-15', cultivation_type='direct_sowing',
        )
        plan = PlantingPlan.objects.create(
            project=self.project, season=self.source, bed=self.bed, crop=crop, area_usage_sqm=20,
            planting_date=date(2024, 2, 29), clearing_date=date(2027, 2, 28),
            actual_sowing_date=date(2024, 2, 10), actual_transplanting_date=date(2024, 2, 25),
            cultivation_type='purchased_transplant',
        )
        other_bed = Bed.objects.create(
            project=self.project, field=self.bed.field, name='Second bed', area_sqm=20,
        )
        PlantingPlan.objects.create(
            project=self.project, season=self.source, bed=other_bed, crop=self.crop,
            area_usage_sqm=20,
            planting_date=date(2024, 2, 9), harvest_date=date(2024, 2, 16),
            harvest_end_date=date(2024, 2, 20), harvest_date_is_explicit=True,
            harvest_end_date_is_explicit=True,
        )
        params = {
            'bed_id': other_bed.pk, 'crop_id': crop.pk, 'exclude_plan_id': plan.pk, 'area_sqm': 20,
        }
        for change, free in (
            ({}, 20),
            ({'cultivation_type': 'direct_sowing'}, 0),
            ({'cultivation_type': ''}, 0),
        ):
            with self.subTest(change=change):
                remaining = self.client.get(
                    f'{PLANS}remaining-area/', {**params, **change, 'start_date': '2024-02-29'},
                )
                self.assertEqual(remaining.status_code, 200, remaining.data)
                self.assertEqual(remaining.data['remaining_area_sqm'], free)
                suggestions = self.client.get(
                    f'{PLANS}bed-suggestions/', {**params, **change, 'planting_date': '2024-02-29'},
                )
                self.assertEqual(suggestions.status_code, 200, suggestions.data)
                destination = next(
                    row for row in suggestions.data['results'] if row['bed_id'] == other_bed.pk
                )
                self.assertEqual(destination['has_enough_area'], free == 20)

    def test_rotation_history_includes_the_recorded_year_of_a_recurring_perennial(self):
        family = PlantFamily.objects.get(botanical_name='Polygonaceae')
        annual = Crop.objects.create(
            project=self.project, name='Annual rotation candidate', crop_family=family,
            rotation_break_years=1, growth_duration_days=5, harvest_duration_days=3,
        )
        crop = self.perennial(
            annual_harvest_window='12-20/12-25', crop_family=family, rotation_break_years=1,
        )
        plan = PlantingPlan.objects.create(
            project=self.project, season=self.next_season, bed=self.bed, crop=crop,
            planting_date=date(2025, 1, 10), clearing_date=date(2027, 1, 10), area_usage_sqm=10,
            actual_transplanting_date=date(2024, 12, 17), cultivation_type='purchased_transplant',
        )

        service = RotationService(self.project.pk, language_code='en')
        self.assertEqual(service.plan_occupancy(plan).start, date(2024, 12, 17))
        candidate = service.occupancy(
            crop=annual, bed_id=self.bed.pk, start=date(2024, 12, 20), end=date(2024, 12, 28),
        )
        self.assertEqual(service.check(candidate).status, STATUS_CONFLICT)

        params = {
            'crop_id': annual.pk, 'bed_id': self.bed.pk,
            'planting_date': '2024-12-20', 'end_date': '2024-12-28',
        }
        checked = self.client.get(f'{PLANS}rotation-check/', params)
        self.assertEqual(checked.status_code, 200, checked.data)
        self.assertEqual(checked.data['status'], STATUS_CONFLICT)
        self.assertEqual(checked.data['findings'][0]['previous_plan_id'], plan.pk)

        suggested = self.client.get(f'{PLANS}bed-suggestions/', params)
        self.assertEqual(suggested.status_code, 200, suggested.data)
        self.assertEqual(suggested.data['results'][0]['status'], STATUS_CONFLICT)

    def test_running_perennial_is_not_copied_or_forecast_again(self):
        response = self.plant(self.perennial())
        self.assertEqual(response.status_code, 201, response.data)
        options = {'source_season_id': self.source.pk, 'use_actual_dates': True}
        base = f'/openfarmplanner/api/seasons/{self.next_season.pk}/'
        preview = self.client.get(f'{base}copy-preview/', options)
        copied = self.client.post(f'{base}copy-from/', options)
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertEqual(copied.status_code, 200, copied.data)
        self.assertEqual(preview.data['continuing_count'], 1)
        self.assertEqual(copied.data['continuing_count'], 1)
        self.assertEqual(copied.data['copied_count'], 0)
        self.assertEqual(PlantingPlan.objects.filter(project=self.project).count(), 1)

        url = '/openfarmplanner/api/yield-calendar/'
        self.assertTrue(self.client.get(url).data)
        self.assertEqual(self.client.get(url, HTTP_X_SEASON_ID=str(self.next_season.pk)).data, [])

    def test_copy_skips_unconfigured_legacy_plan_then_defaults_a_valid_new_copy(self):
        crop = self.perennial(standing_time=None)
        legacy = PlantingPlan.objects.create(
            project=self.project, crop=crop, bed=self.bed, season=self.source,
            planting_date=date(2024, 3, 2),
        )
        base = f'/openfarmplanner/api/seasons/{self.next_season.pk}/'
        options = {'source_season_id': self.source.pk}
        preview = self.client.get(f'{base}copy-preview/', options)
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertEqual(preview.data['unconfigured_perennial_count'], 1)
        skipped = self.client.post(f'{base}copy-from/', options)
        self.assertEqual(skipped.status_code, 200, skipped.data)
        self.assertEqual(skipped.data['copied_count'], 0)
        self.assertEqual(skipped.data['unconfigured_perennial_count'], 1)

        crop.standing_time_years = 6
        crop.save(update_fields=['standing_time_years'])
        copied = self.client.post(f'{base}copy-from/', options)
        self.assertEqual(copied.status_code, 200, copied.data)
        self.assertEqual(copied.data['copied_count'], 1)
        copy = PlantingPlan.objects.get(season=self.next_season)
        self.assertEqual(copy.clearing_date, date(2031, 3, 2))
        legacy.refresh_from_db()
        self.assertIsNone(legacy.clearing_date)


class PublicPerennialPlanningTest(ProjectApiTestCase):
    def test_public_edits_validate_standing_time_and_can_use_a_general_entry(self):
        species = CropSpecies.objects.create(
            name='Synthetic public perennial species', status=CropSpecies.STATUS_PUBLISHED,
        )
        PublicCrop.objects.create(
            name='Rhubarb', crop_species=species, life_cycle='perennial', standing_time_years=6,
        )
        variety = PublicCrop.objects.create(name='Rhubarb', crop_species=species, variety='Early')
        inherited = PublicCropUpdateSerializer(
            variety, data={'life_cycle': 'perennial'}, partial=True,
        )
        self.assertTrue(inherited.is_valid(), inherited.errors)
        self.assertEqual(inherited.validated_data['standing_time_years'], 6)
        missing = PublicCropUpdateSerializer(data={'life_cycle': 'perennial'}, partial=True)
        self.assertFalse(missing.is_valid())
        self.assertIn('standing_time_years', missing.errors)
