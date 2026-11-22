from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from crops.models import CropSpecies
from farm.models import (
    Bed,
    Crop,
    CropLoss,
    Field,
    HarvestAllocation,
    HarvestRecord,
    Location,
    PlantingPlan,
    Project,
    ProjectMembership,
    Season,
)
from farm.services.seasons import copy_planting_plans


class YieldComparisonTest(TestCase):
    def setUp(self):
        self.project = Project.objects.create(name='Market garden', slug='market-garden')
        user = get_user_model().objects.create_user(username='yield-grower')
        ProjectMembership.objects.create(project=self.project, user=user, role='admin')
        self.client = APIClient()
        self.client.force_authenticate(user)
        self.client.defaults['HTTP_X_PROJECT_ID'] = str(self.project.pk)
        self.url = reverse('yield-comparison')
        self.crop = Crop.objects.create(
            project=self.project, name='Leek', expected_yield=Decimal('3.50'),
            harvest_method='per_sqm', cultivation_types=['direct_sowing'],
        )
        self.previous = Season.objects.create(
            project=self.project, start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
        )
        self.current = Season.objects.create(
            project=self.project, start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
            custom_label='Market garden September to August',
        )
        self.later = Season.objects.create(
            project=self.project, start_date=date(2028, 9, 1), end_date=date(2029, 8, 31),
        )

    def add_plan(
        self, season, day, start=None, end=None, *, crop=None, area=10, actual=None, bed=None,
    ):
        plan = PlantingPlan.objects.create(
            project=self.project, crop=crop or self.crop, season=season, planting_date=day,
            area_usage_sqm=area, cultivation_type='direct_sowing',
            actual_sowing_date=actual, bed=bed,
        )
        PlantingPlan.objects.filter(pk=plan.pk).update(harvest_date=start, harvest_end_date=end)
        return plan

    def add_harvest(self, day, amount, unit, allocations=(), *, crop=None, grams_per_unit=None):
        harvest = HarvestRecord.objects.create(
            project=self.project, crop=crop or self.crop, date=day, quantity=amount, unit=unit,
            grams_per_unit=grams_per_unit, conversion_source='manual' if grams_per_unit else '',
        )
        HarvestAllocation.objects.bulk_create([
            HarvestAllocation(
                project=self.project, harvest=harvest, planting_plan=plan,
                quantity=quantity, harvested_area_sqm=area,
            )
            for plan, quantity, area in allocations
        ])
        return harvest

    def rows(self, crop=None):
        response = self.client.get(
            self.url, {'crop_id': (crop or self.crop).pk}, HTTP_X_SEASON_ID=str(self.current.pk),
        )
        self.assertEqual(response.status_code, 200, response.data)
        return {item['id']: item for item in response.json()['seasons']}

    def test_clips_forecast_and_dated_actuals_on_either_side_of_a_noncalendar_boundary(self):
        plan = self.add_plan(
            self.previous, date(2025, 10, 14), date(2026, 8, 28), date(2026, 9, 4),
            actual=date(2025, 10, 16),
        )
        self.add_harvest(date(2026, 8, 31), 6, 'kg', [(plan, 6, None)])
        self.add_harvest(date(2026, 9, 1), 2500, 'g', [(plan, 2500, 2)])
        self.add_harvest(date(2028, 5, 2), 1000, 'kg')
        CropLoss.objects.create(
            project=self.project, planting_plan=plan, date=date(2026, 9, 2),
            loss_type='partial', cause='frost', extent_unit='percent', extent_value=0,
        )

        rows = self.rows()
        self.assertEqual(list(rows), [self.later.pk, self.current.pk, self.previous.pk])
        old, new, empty = (rows[key] for key in [self.previous.pk, self.current.pk, self.later.pk])
        self.assertEqual([old['forecast_kg'], new['forecast_kg']], ['20', '15'])
        self.assertEqual(
            [old['recorded']['measured_kg'], new['recorded']['measured_kg']], ['6', '2.5'],
        )
        self.assertEqual(new['label'], self.current.custom_label)
        self.assertEqual(new['start_date'], '2026-09-01')
        self.assertEqual(new['end_date'], '2027-08-31')
        self.assertTrue(old['comparable'])
        self.assertTrue(new['comparable'])
        self.assertEqual(new['recorded_kg_per_plan_sqm'], '0.25')
        self.assertEqual(new['harvested_areas'][0]['kg_per_sqm'], '1.25')
        self.assertEqual(old['plan_dates'][0]['actual_sowing_date'], '2025-10-16')
        self.assertIsNone(old['plan_dates'][0]['recorded_harvest_end_date'])
        self.assertEqual(new['plan_dates'], [])
        self.assertEqual(old['losses'], [])
        self.assertEqual(new['losses'][0]['extent_value'], '0')
        self.assertEqual(empty['recorded']['quantities'], [])
        self.assertIsNone(empty['recorded']['measured_kg'])
        self.assertIsNone(empty['forecast_kg'])

    def test_scope_counts_all_crops_and_only_the_allocated_share_for_a_site(self):
        beds = []
        for name in ('North', 'South'):
            site = Location.objects.create(project=self.project, name=name)
            field = Field.objects.create(project=self.project, location=site, name='Market garden')
            beds.append(Bed.objects.create(project=self.project, field=field, name='Bed One'))
        roma = Crop.objects.create(
            project=self.project, name='Tomato', variety='Roma', expected_yield=2,
            harvest_method='per_sqm',
        )
        carrot = Crop.objects.create(project=self.project, name='Carrot')
        date_range = (self.current, date(2027, 4, 1), date(2027, 6, 1), date(2027, 6, 10))
        north = self.add_plan(*date_range, bed=beds[0], area=5)
        south = self.add_plan(*date_range, bed=beds[1])
        bedless = self.add_plan(*date_range)
        roma_plan = self.add_plan(*date_range, bed=beds[0], crop=roma)
        day = date(2027, 6, 5)
        self.add_harvest(day, 17, 'kg', [(north, 6, 2), (south, 9, 4)])
        self.add_harvest(day, 4, 'kg')
        self.add_harvest(day, 3, 'kg', [(bedless, 3, None)])
        self.add_harvest(day, 6, 'kg', [(roma_plan, 6, None)], crop=roma)
        self.add_harvest(day, 5, 'kg', crop=carrot)

        def current_row(**filters):
            response = self.client.get(self.url, {'season_window': '3', **filters})
            self.assertEqual(response.status_code, 200, response.data)
            return next(row for row in response.json()['seasons'] if row['id'] == self.current.pk)

        self.assertEqual(current_row()['recorded']['measured_kg'], '35')
        crop_filter = {'crop_id': [self.crop.pk, roma.pk]}
        unfiltered = current_row(**crop_filter)
        self.assertEqual(unfiltered['recorded']['measured_kg'], '30')
        self.assertEqual(unfiltered['unassigned'], [{'quantity': '6', 'unit': 'kg'}])
        first = current_row(**crop_filter, location_id=beds[0].field.location_id)
        self.assertEqual(first['forecast_kg'], '37.5')
        self.assertEqual(first['recorded']['measured_kg'], '12')
        self.assertEqual(first['excluded_unassigned_records'], 3)
        self.assertEqual(first['unassigned'], [])
        self.assertFalse(first['comparable'])
        self.assertEqual({plan['id'] for plan in first['plan_dates']}, {north.pk, roma_plan.pk})
        self.assertEqual([area['plan_id'] for area in first['harvested_areas']], [north.pk])
        second = current_row(**crop_filter, field_id=beds[1].field_id)
        self.assertEqual(second['forecast_kg'], '35')
        self.assertEqual(second['recorded']['measured_kg'], '9')
        self.assertEqual(second['excluded_unassigned_records'], 3)
        variety = current_row(bed_id=beds[0].pk, variety_id=roma.pk)
        self.assertEqual(variety['forecast_kg'], '20')
        self.assertEqual(variety['recorded']['measured_kg'], '6')
        self.assertEqual(variety['excluded_unassigned_records'], 0)
        self.assertTrue(variety['comparable'])
        Crop.objects.filter(pk=self.crop.pk).update(variety_normalized='')
        legacy_general = current_row(variety_id=self.crop.pk)
        self.assertIsNone(legacy_general['forecast_kg'])
        self.assertIsNone(legacy_general['recorded']['measured_kg'])

    def test_window_uses_the_latest_real_seasons_and_preserves_unknown_recorded_yield(self):
        for year in (2022, 2023, 2024):
            Season.objects.create(
                project=self.project, start_date=date(year, 9, 1),
                end_date=date(year + 1, 8, 31),
            )
        self.add_harvest(date(2026, 8, 31), 4, 'kg')
        self.add_harvest(date(2026, 9, 1), 8, 'kg')
        for window, expected_count in (('3', 3), ('5', 5), ('all', 6)):
            with self.subTest(window=window):
                seasons = self.client.get(self.url, {'season_window': window}).json()['seasons']
                self.assertEqual(len(seasons), expected_count)
                self.assertEqual([row['id'] for row in seasons[:3]], [
                    self.later.pk, self.current.pk, self.previous.pk,
                ])
                self.assertEqual([row['recorded']['measured_kg'] for row in seasons[:3]], [
                    None, '8', '4',
                ])
        for keep in (2, 1):
            retained = [self.later, self.current][:keep]
            Season.objects.filter(project=self.project).exclude(
                pk__in=[season.pk for season in retained],
            ).update(deleted_at=timezone.now())
            seasons = self.client.get(self.url, {'season_window': '3'}).json()['seasons']
            self.assertEqual([row['id'] for row in seasons], [season.pk for season in retained])
        invalid = self.client.get(self.url, {'season_window': '1'})
        self.assertEqual(invalid.status_code, 400)

    def test_window_summary_scopes_area_quantities_and_distinct_crop_coverage(self):
        beds = []
        for name in ('North', 'South'):
            site = Location.objects.create(project=self.project, name=name)
            field = Field.objects.create(project=self.project, location=site, name='Market garden')
            beds.append(Bed.objects.create(project=self.project, field=field, name='Bed One'))
        north, south = beds
        species = CropSpecies.objects.create(name='Tomato')
        crop_fields = (
            {'name': 'Tomato', 'crop_species': species},
            {'name': 'Garden tomato', 'crop_species': species, 'variety': 'Roma'},
            {'name': 'Carrot'},
            {'name': 'Chard'},
        )
        tomato, roma, carrot, chard = [
            Crop.objects.create(project=self.project, **fields) for fields in crop_fields
        ]
        first = date(2026, 8, 31)
        second = date(2026, 9, 1)
        old_north = self.add_plan(
            self.previous, date(2026, 5, 1), date(2026, 8, 27), date(2026, 9, 3), bed=north,
        )
        old_south = self.add_plan(self.previous, date(2026, 5, 1), bed=south, area=8)
        self.add_plan(self.current, date(2027, 5, 1), bed=north, area=4)
        self.add_plan(self.current, second, bed=north, area=2, crop=tomato)
        roma_plan = self.add_plan(self.current, second, bed=north, area=3, crop=roma)
        self.add_plan(self.current, second, bed=north, area=None, crop=carrot)
        self.add_harvest(first, 1000, 'g', [(old_north, 800, None), (old_south, 200, None)])
        self.add_harvest(second, 6, 'kg', [(old_north, 4, None), (old_south, 1, None)])
        self.add_harvest(second, 3, 'kg', crop=chard)
        self.add_harvest(second, 5, 'piece', [(roma_plan, 5, None)], crop=roma, grams_per_unit=200)
        # The selected season records have a gap in 2027/28.
        self.add_harvest(date(2028, 5, 1), 99, 'kg', crop=carrot)

        def get_summary(**filters):
            response = self.client.get(self.url, {'season_window': '3', **filters})
            self.assertEqual(response.status_code, 200, response.data)
            return response.json()['summary']

        self.assertEqual(get_summary(), {
            'planned_area_sqm': '27', 'plans_without_area_count': 1,
            'recorded_quantities': [
                {'unit': 'kg', 'quantity': '10'}, {'unit': 'piece', 'quantity': '5'},
            ],
            'excluded_unassigned_records': 0, 'crop_count': 4, 'recorded_crop_count': 3,
        })
        self.assertEqual(get_summary(location_id=north.field.location_id), {
            'planned_area_sqm': '19', 'plans_without_area_count': 1,
            'recorded_quantities': [
                {'unit': 'kg', 'quantity': '4.8'}, {'unit': 'piece', 'quantity': '5'},
            ],
            'excluded_unassigned_records': 2, 'crop_count': 3, 'recorded_crop_count': 2,
        })
        self.assertEqual(get_summary(bed_id=north.pk, variety_id=roma.pk), {
            'planned_area_sqm': '3', 'plans_without_area_count': 0,
            'recorded_quantities': [{'unit': 'piece', 'quantity': '5'}],
            'excluded_unassigned_records': 0, 'crop_count': 1, 'recorded_crop_count': 1,
        })
        self.assertEqual(get_summary(crop_id=carrot.pk), {
            'planned_area_sqm': None, 'plans_without_area_count': 1, 'recorded_quantities': [],
            'excluded_unassigned_records': 0, 'crop_count': 1, 'recorded_crop_count': 0,
        })
        self.assertEqual(get_summary(bed_id=south.pk, crop_id=chard.pk), {
            'planned_area_sqm': None, 'plans_without_area_count': 0, 'recorded_quantities': [],
            'excluded_unassigned_records': 1, 'crop_count': 0, 'recorded_crop_count': 0,
        })

    def test_split_records_count_once_and_area_uses_unique_plans(self):
        first, second = [
            self.add_plan(
                self.current, date(2027, 2, 1), date(2027, 6, 1), date(2027, 6, 10), area=area,
            )
            for area in (5, 10)
        ]
        day = date(2027, 6, 4)
        self.add_harvest(day, 17, 'kg', [(first, 6, 2), (second, 9, 4)])
        self.add_harvest(day, 3000, 'g', [(first, 3000, 2)])
        row = self.rows()[self.current.pk]
        self.assertEqual(row['recorded']['quantities'], [{'quantity': '20', 'unit': 'kg'}])
        self.assertEqual(row['unassigned'], [{'quantity': '2', 'unit': 'kg'}])
        self.assertEqual(row['assigned_plan_count'], 2)
        self.assertEqual(row['recorded_kg_per_plan_sqm'], '1.2')
        self.assertEqual(row['forecast_kg'], '52.5')
        self.assertEqual(row['forecast_kg_per_sqm'], '3.5')
        self.assertFalse(row['comparable'])

        self.add_harvest(day, 4, 'piece', [(first, 4, None)], grams_per_unit=500)
        mixed = self.rows()[self.current.pk]
        self.assertTrue(mixed['recorded_kg_per_plan_sqm_estimated'])
        self.assertEqual(mixed['recorded_kg_per_plan_sqm'], '1.333333')
        self.assertEqual(mixed['recorded']['measured_kg'], '20')
        self.assertEqual(mixed['recorded']['estimated_kg'], '2')

        self.add_harvest(day, 3, 'bunch', [(second, 3, 1)])
        mixed = self.rows()[self.current.pk]
        self.assertEqual(mixed['recorded']['quantities'], [
            {'quantity': '20', 'unit': 'kg'}, {'quantity': '4', 'unit': 'piece'},
            {'quantity': '3', 'unit': 'bunch'},
        ])
        self.assertTrue(mixed['recorded']['has_unconvertible_quantity'])
        self.assertIsNone(mixed['recorded_kg_per_plan_sqm'])
        self.assertFalse(mixed['comparable'])

    def test_crop_rates_use_matching_plan_areas_and_skip_invalid_trend_seasons(self):
        old = Season.objects.create(
            project=self.project, start_date=date(2024, 9, 1), end_date=date(2025, 8, 31),
        )
        earliest = Season.objects.create(
            project=self.project, start_date=date(2023, 9, 1), end_date=date(2024, 8, 31),
        )
        species = CropSpecies.objects.create(name='Leek')
        self.crop.crop_species = species
        self.crop.save(update_fields=['crop_species'])
        variety = Crop.objects.create(
            project=self.project, name='Winter leek', variety='Blue', crop_species=species,
        )
        sites = [Location.objects.create(project=self.project, name=name)
                 for name in ('North', 'South')]
        fields = [Field.objects.create(project=self.project, name='Plot', location=site)
                  for site in sites]
        north, south = [Bed.objects.create(project=self.project, field=field, name='Bed')
                        for field in fields]
        old_day = date(2025, 8, 30)
        current_day = date(2026, 9, 1)
        base = self.add_plan(old, old_day, old_day, date(2025, 8, 31), bed=north, area=5)
        self.add_harvest(old_day, 10000, 'g', [(base, 10000, None)])
        overwintering = self.add_plan(
            self.previous, date(2026, 8, 20), date(2026, 8, 30), date(2026, 9, 10),
            bed=north, area=4, crop=variety,
        )
        other_site = self.add_plan(self.current, current_day, bed=south, area=6, crop=variety)
        self.add_harvest(current_day, 16, 'kg', [(overwintering, 12, None), (other_site, 4, None)],
                         crop=variety)
        self.add_harvest(current_day, 6, 'kg', [(overwintering, 6, None)], crop=variety)
        pieces = self.add_harvest(
            date(2026, 8, 31), 10, 'piece', [(overwintering, 10, None)], crop=variety,
        )
        self.add_harvest(date(2028, 9, 2), 5, 'kg')

        def row(**filters):
            response = self.client.get(self.url, {'season_window': '5', **filters})
            self.assertEqual(response.status_code, 200, response.data)
            crops = response.json()['crop_yields']
            self.assertEqual(len(crops), 1)
            return crops[0]

        all_sites = row()
        self.assertEqual(all_sites['crop_ids'], sorted([self.crop.pk, variety.pk]))
        self.assertEqual([cell['season_id'] for cell in all_sites['rates']], [
            earliest.pk, old.pk, self.previous.pk, self.current.pk, self.later.pk,
        ])
        self.assertEqual([cell['status'] for cell in all_sites['rates']], [
            'missing', 'measured', 'unavailable', 'measured', 'unassigned',
        ])
        self.assertEqual(all_sites['rates'][3]['value'], '2.2')
        self.assertEqual(all_sites['trend'], {
            'from_season_id': old.pk, 'to_season_id': self.current.pk, 'change': '0.1',
        })
        north_only = row(location_id=sites[0].pk)
        self.assertEqual(north_only['rates'][3]['value'], '4.5')
        self.assertEqual(north_only['trend']['change'], '1.25')
        self.assertEqual(row(season_window='3')['trend'], None)
        self.assertEqual(row(variety_id=variety.pk)['crop_ids'], [variety.pk])

        pieces.grams_per_unit = 100
        pieces.conversion_source = 'manual'
        pieces.save(update_fields=['grams_per_unit', 'conversion_source'])
        estimated = row()['rates'][2]
        self.assertEqual((estimated['status'], estimated['value']), ('estimated', '0.25'))

        self.add_harvest(current_day, 1, 'kg', crop=variety)
        partial = row(location_id=sites[0].pk)
        self.assertEqual(partial['rates'][3]['value'], '4.5')
        self.assertTrue(partial['rates'][3]['partial'])
        self.assertIsNone(partial['trend'])

        PlantingPlan.objects.filter(pk=other_site.pk).update(area_usage_sqm=None)
        self.assertEqual(row(location_id=sites[1].pk)['rates'][3]['status'], 'unavailable')

    def test_crop_rates_do_not_reassign_harvest_if_a_plan_changes_crop(self):
        day = date(2027, 6, 1)
        plan = self.add_plan(self.current, date(2027, 4, 1))
        self.add_harvest(day, 4, 'kg', [(plan, 4, None)])
        carrot = Crop.objects.create(project=self.project, name='Carrot')
        PlantingPlan.objects.filter(pk=plan.pk).update(crop=carrot)

        data = self.client.get(self.url, {'season_window': '3'}).json()
        crops = {crop['name']: crop['rates'][1] for crop in data['crop_yields']}
        self.assertEqual(crops['Leek']['status'], 'unassigned')
        self.assertEqual(crops['Carrot']['status'], 'missing')
        self.assertEqual(data['seasons'][1]['recorded']['measured_kg'], '4')
        self.assertIsNone(data['seasons'][1]['recorded_kg_per_plan_sqm'])

    def test_continuing_perennial_does_not_invent_a_repeat_forecast(self):
        perennial = Crop.objects.create(
            project=self.project, name='Rhubarb', life_cycle='perennial', standing_time_years=7,
            expected_yield=1, harvest_method='per_sqm',
        )
        plan = self.add_plan(
            self.previous, date(2025, 9, 20), date(2026, 6, 1), date(2026, 6, 15), crop=perennial,
        )
        PlantingPlan.objects.filter(pk=plan.pk).update(clearing_date=date(2031, 9, 20))
        self.add_harvest(date(2027, 6, 3), 10, 'kg', [(plan, 10, None)], crop=perennial)
        older, newer = (self.rows(perennial)[key] for key in (self.previous.pk, self.current.pk))
        self.assertEqual(older['forecast_kg'], '10')
        self.assertIsNone(newer['forecast_kg'])
        self.assertEqual(newer['recorded']['measured_kg'], '10')
        self.assertEqual(newer['recorded_kg_per_plan_sqm'], '1')
        self.assertFalse(newer['comparable'])
        summary = self.client.get(self.url, {'crop_id': perennial.pk}).json()['summary']
        self.assertEqual(summary['planned_area_sqm'], '10')
        self.assertEqual(summary['recorded_crop_count'], 1)

    def test_missing_forecast_inputs_never_produce_a_comparable_pair(self):
        day = date(2027, 4, 20)
        scheduled = self.add_plan(self.current, day, date(2027, 5, 5), date(2027, 5, 9))
        draft = self.add_plan(self.current, day, date(2027, 5, 6), date(2027, 5, 10), area=None)
        self.add_harvest(day, 8, 'kg', [(scheduled, 8, None)])
        row = self.rows()[self.current.pk]
        self.assertEqual(row['expected_plan_count'], 2)
        self.assertEqual(row['forecast_plan_count'], 1)
        self.assertEqual(row['assigned_forecast_plan_count'], 1)
        self.assertEqual(row['forecast_kg'], '35')
        self.assertFalse(row['comparable'])
        self.assertEqual({plan['id'] for plan in row['plan_dates']}, {scheduled.id, draft.id})

    def test_repeated_identical_copies_contribute_one_forecast_until_edited(self):
        source = self.add_plan(
            self.previous, date(2026, 4, 20), date(2026, 5, 5), date(2026, 5, 9),
        )
        PlantingPlan.objects.filter(pk=source.pk).update(
            harvest_date_is_explicit=True, harvest_end_date_is_explicit=True,
        )
        first, duplicate = [
            copy_planting_plans(source_season=self.previous, target_season=self.current)[0][0]
            for _ in range(2)
        ]
        self.assertEqual(first.copied_from_plan_id, source.pk)
        self.assertEqual(duplicate.copied_from_plan_id, source.pk)
        self.add_harvest(date(2027, 5, 5), 5, 'kg', [(first, 5, None)])
        row = self.rows()[self.current.pk]
        self.assertEqual(row['forecast_kg'], '35')
        self.assertEqual(row['forecast_plan_count'], 1)
        self.assertEqual(row['recorded']['measured_kg'], '5')
        summary = self.client.get(self.url, {'season_window': '3'}).json()['summary']
        self.assertEqual(summary['planned_area_sqm'], '20')

        PlantingPlan.objects.filter(pk=duplicate.pk).update(area_usage_sqm=12)
        row = self.rows()[self.current.pk]
        self.assertEqual(row['forecast_kg'], '77')
        self.assertEqual(row['assigned_forecast_plan_count'], 1)
        self.assertEqual(row['expected_plan_count'], 2)
        self.assertFalse(row['comparable'])

    def test_chart_catalog_and_details_are_project_scoped_and_exclude_deleted_seasons(self):
        foreign = Project.objects.create(name='Foreign garden', slug='foreign-garden')
        unrelated = Crop.objects.create(project=foreign, name='Hidden')
        deleted_only = Crop.objects.create(project=self.project, name='From a deleted season')
        removed = Season.objects.create(
            project=self.project, start_date=date(2024, 9, 1), end_date=date(2025, 8, 31),
        )
        self.add_plan(removed, date(2025, 5, 6), crop=deleted_only)
        Season.all_objects.filter(pk=removed.pk).update(deleted_at=timezone.now())
        self.add_harvest(date(2026, 8, 30), 1, 'kg')
        self.add_harvest(date(2026, 9, 5), 2, 'kg', crop=unrelated)
        self.assertEqual(self.client.get(self.url).json()['crops'], [
            {'id': self.crop.pk, 'name': 'Leek'},
        ])
        self.assertEqual(self.client.get(self.url, {'crop_id': unrelated.pk}).status_code, 404)
        self.assertEqual(self.client.get(self.url, {'crop_id': '9' * 100}).status_code, 400)
        self.assertNotIn(removed.pk, self.rows())
