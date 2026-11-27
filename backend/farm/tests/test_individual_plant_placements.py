from datetime import date
from decimal import Decimal
from uuid import UUID, uuid4

from crops.models import CropSpecies
from farm.models import Bed, Crop, Field, Location, PlantingPlan, Project, Season
from farm.services.bed_capacity import calculate_bed_capacity
from farm.services.harvests import eligible_harvest_plans
from farm.services.parcel_rotation_copy import preview_parcel_rotation
from farm.services.seasons import build_planting_plan_copies, copy_planting_plans
from farm.services.seed_demand import compute_plan_requirement
from farm.tests.api_base import ProjectApiTestCase

URL = '/openfarmplanner/api/planting-plans/'
CROP_URL = '/openfarmplanner/api/crops/'
BOUGHT_IN = PlantingPlan.CULTIVATION_TYPE_PURCHASED_TRANSPLANT


class IndividualPlantPlacementTests(ProjectApiTestCase):
    def setUp(self):
        super().setUp()
        self.field.width_m, self.field.length_m = 12, 20
        self.field.save()
        self.origin = self.make_season(2026)
        self.later = self.make_season(2027)
        self.client.defaults['HTTP_X_SEASON_ID'] = str(self.origin.id)
        self.apple = Crop.objects.create(
            project=self.project, name='Apple', life_cycle='perennial', standing_time_years=12,
            cultivation_types=['pre_cultivation'], estimated_canopy_diameter_m=Decimal('3.50'),
            distance_within_row_m=4, annual_harvest_window='08-10/09-10',
        )

    def make_season(self, year):
        return Season.objects.create(
            project=self.project, start_date=date(year, 1, 1), end_date=date(year, 12, 31),
        )

    def payload(self, **changes):
        return {
            'crop': self.apple.id, 'parcel': self.field.id, 'planting_date': '2026-04-18',
            'cultivation_type': BOUGHT_IN,
            'individual_positions': [{'x_m': 2, 'y_m': 4}, {'x_m': 2, 'y_m': 9}],
            **changes,
        }

    def create_plan(self, **changes):
        response = self.client.post(URL, self.payload(**changes), format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response

    def graphic_scene(self):
        self.location.width_m, self.location.length_m = 30, 30
        self.location.save()
        self.bed.width_m, self.bed.length_m = 2, 4
        self.bed.save()
        return {
            'location': self.location.id, 'origin_x': 100, 'origin_y': 100,
            'footprints': [
                {'kind': 'field', 'id': self.field.id, 'x': 0, 'y': 0, 'width': 12, 'height': 20},
                {'kind': 'bed', 'id': self.bed.id, 'x': 1, 'y': 1, 'width': 2, 'height': 4},
            ],
        }

    def graphic_point(self, parent, x, y):
        kind = {Location: 'location', Field: 'field', Bed: 'bed'}[type(parent)]
        return {'x_m': x, 'y_m': y, 'parent': {'kind': kind, 'id': parent.pk}}

    def test_graphic_atomically_groups_distinct_parents_and_replays_without_duplicates(self):
        data = {
            'request_id': str(uuid4()), 'scene': self.graphic_scene(), 'crop': self.apple.id,
            'cultivation_type': BOUGHT_IN, 'planting_date': '2026-04-18',
            'individual_count': 5, 'pending_parent': {'kind': 'location', 'id': self.location.pk},
            'points': [
                self.graphic_point(self.location, 21, 3), self.graphic_point(self.field, 6, 8),
                self.graphic_point(self.bed, 2, 3), self.graphic_point(self.bed, 2.5, 3),
            ],
        }
        url = f'{URL}graphic-placement/'
        incorrect = {**data, 'points': [*data['points'], self.graphic_point(self.field, 2, 3)]}
        self.assertEqual(self.client.post(url, incorrect, format='json').status_code, 409)
        self.assertFalse(PlantingPlan.objects.filter(project=self.project).exists())
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        members = {plan['placement_mode']: plan for plan in response.json()['plans']}
        self.assertEqual(members['individual_site']['site'], self.location.pk)
        self.assertEqual(members['individual_site']['pending_plants_count'], 1)
        self.assertEqual(members['individual_parcel']['parcel'], self.field.pk)
        self.assertEqual(members['individual_bed']['bed'], self.bed.pk)
        positions = members['individual_bed']['individual_positions']
        self.assertEqual([(point['x_m'], point['y_m']) for point in positions], [(1, 2), (1.5, 2)])
        again = self.client.post(url, data, format='json')
        self.assertEqual(again.status_code, 200, again.data)
        self.assertEqual({plan['id'] for plan in again.json()['plans']},
                         {plan['id'] for plan in members.values()})
        self.assertEqual(PlantingPlan.objects.filter(project=self.project).count(), 3)

    def test_count_only_location_keeps_pending_and_moves_the_split_count_with_a_stem(self):
        scene = self.graphic_scene()
        original = self.create_plan(
            parcel=None, site=self.location.pk, individual_positions=[], individual_count=3,
        ).json()
        counts = ('plants_count', 'positioned_plants_count', 'pending_plants_count')
        self.assertEqual(tuple(original[key] for key in counts), (3, 0, 3))
        by_location = self.client.get(f'{URL}?individual_location={self.location.pk}').json()
        self.assertEqual(by_location['results'][0]['id'], original['id'])
        demand = self.client.get('/openfarmplanner/api/young-plant-demand/').json()['results'][0]
        self.assertEqual(demand['plant_count'], 3)
        response = self.client.post(f'{URL}graphic-placement/', {
            'request_id': str(uuid4()), 'scene': scene, 'plan': original['id'],
            'placement_updated_at': original['updated_at'], 'individual_count': 4,
            'points': [
                self.graphic_point(self.location, 21, 3), self.graphic_point(self.location, 22, 3),
            ],
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        plan, = response.json()['plans']
        self.assertEqual((plan['plants_count'], plan['pending_plants_count']), (4, 2))
        stem = plan['individual_positions'][0]['id']
        move = {'scene': scene, 'stem': stem, 'placement_updated_at': plan['updated_at'],
                'point': self.graphic_point(self.bed, 2, 3)}
        url = f'{URL}{plan["id"]}/graphic-move/'
        moved = self.client.post(url, move, format='json')
        self.assertEqual(moved.status_code, 200, moved.data)
        source, target = moved.json()['plans']
        self.assertEqual(source['id'], original['id'])
        self.assertEqual(tuple(source[key] for key in counts), (3, 1, 2))
        self.assertEqual(target['individual_positions'], [{'id': stem, 'x_m': 1, 'y_m': 2}])
        self.assertEqual(target['bed'], self.bed.pk)
        self.assertEqual(tuple(target[key] for key in counts), (1, 1, 0))
        self.assertTrue(PlantingPlan.objects.get(pk=target['id']).tasks.filter(
            origin='automatic', status='pending',
        ).exists())
        self.assertEqual(self.client.post(url, move, format='json').status_code, 409)

    def test_count_only_bed_has_unmeasured_capacity_during_occupancy(self):
        self.graphic_scene()
        self.create_plan(
            bed=self.bed.pk, parcel=None, placement_mode='individual_bed',
            individual_positions=[], individual_count=5,
        )
        capacity = calculate_bed_capacity(self.bed, start=date(2026, 5, 1), end=date(2026, 6, 1))
        self.assertTrue(capacity.has_unmeasured_placement)

    def test_harvest_suggestion_names_the_direct_site(self):
        self.graphic_scene()
        plan = self.create_plan(
            parcel=None, site=self.location.pk, individual_positions=[], individual_count=2,
        ).json()
        response = self.client.get('/openfarmplanner/api/harvests/suggestions/', {
            'crop': self.apple.pk, 'date': '2026-09-01',
        })
        self.assertEqual(response.status_code, 200, response.data)
        suggestion, = response.json()
        self.assertEqual(suggestion['id'], plan['id'])
        self.assertEqual(suggestion['site_name'], self.location.name)

    def test_graphic_rejects_overlapping_geometry_and_protected_split(self):
        scene = self.graphic_scene()
        other = Field.objects.create(project=self.project, location=self.location,
                                     name='Overlapping parcel', width_m=4, length_m=8)
        scene['footprints'].append({
            'kind': 'field', 'id': other.pk, 'x': 1, 'y': 1, 'width': 4, 'height': 8,
        })
        plan = self.create_plan(actual_transplanting_date='2026-04-18').json()
        stem = plan['individual_positions'][0]
        url = f'{URL}{plan["id"]}/graphic-move/'
        base = {'scene': scene, 'stem': stem['id'], 'placement_updated_at': plan['updated_at']}
        ambiguous = self.client.post(url, {**base, 'point': self.graphic_point(self.bed, 2, 3)},
                                     format='json')
        self.assertEqual(ambiguous.status_code, 409)
        self.assertEqual(ambiguous.json()['code'], 'individual_parent_ambiguous')
        protected = self.client.post(url, {**base,
            'point': self.graphic_point(self.location, 22, 8)}, format='json')
        self.assertEqual(protected.status_code, 409)
        self.assertEqual(protected.json()['code'], 'individual_split_protected')
        plan_after = self.client.get(f'{URL}{plan["id"]}/').json()
        self.assertEqual(plan_after['individual_positions'], plan['individual_positions'])
        self.assertEqual(PlantingPlan.objects.filter(project=self.project).count(), 1)

    def test_create_and_edit_positions_preserves_ids_and_updates_demand(self):
        created = self.create_plan().json()
        plan_id = created['id']
        old_stems = created['individual_positions']
        self.assertEqual(len({UUID(stem['id']) for stem in old_stems}), 2)
        self.assertIsNone(created['bed'])
        self.assertIsNone(created['area_usage_sqm'])
        self.assertEqual(created['plants_count'], 2)
        self.assertEqual(created['recommended_plant_spacing_m'], 4)
        self.assertEqual(Decimal(created['estimated_canopy_diameter_m']), Decimal('3.50'))
        self.assertEqual(created['clearing_date'], '2038-04-18')

        placement_url = f'{URL}{plan_id}/individual-placement/'
        payload = {
            'individual_positions': [
                {**old_stems[0], 'x_m': 2.75}, {'x_m': 0, 'y_m': 0},
                {'x_m': 12, 'y_m': 20},
            ],
            'estimated_canopy_diameter_m': None, 'placement_updated_at': created['updated_at'],
        }
        response = self.client.patch(placement_url, payload, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        changed = response.json()
        self.assertEqual(changed['plants_count'], 3)
        self.assertIsNone(changed['estimated_canopy_diameter_m'])
        self.assertEqual(changed['individual_positions'][0], {**old_stems[0], 'x_m': 2.75})
        new_ids = [stem['id'] for stem in changed['individual_positions']]
        self.assertNotIn(old_stems[1]['id'], new_ids)
        self.assertEqual(self.client.patch(placement_url, payload, format='json').status_code, 409)

        demand = self.client.get('/openfarmplanner/api/young-plant-demand/').json()['results'][0]
        self.assertEqual(demand['plant_count'], 3)
        self.assertEqual(demand['plans'][0]['field_name'], self.field.name)
        self.assertEqual(demand['plans'][0]['location_name'], self.location.name)

        response = self.client.patch(placement_url, {
            'individual_positions': [], 'placement_updated_at': changed['updated_at'],
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.json()['plants_count'], 0)
        empty = self.client.get('/openfarmplanner/api/young-plant-demand/').json()['results'][0]
        self.assertEqual(empty['plant_count'], 0)
        self.assertEqual(PlantingPlan.objects.filter(parcel=self.field).count(), 1)

    def test_rejects_foreign_parcel_and_malformed_placement_without_writes(self):
        other = Project.objects.create(name='Other project', slug='other-placements')
        location = Location.objects.create(project=other, name='Other location')
        parcel = Field.objects.create(project=other, location=location, name='Other plot')
        for invalid in (
            {'parcel': parcel.id}, {'bed': self.bed.id}, {'quantity': 12}, {'area_usage_sqm': 10},
            {'placement_mode': 'area'}, {'planting_date': None}, {'individual_positions': []},
            {'individual_positions': [{'x_m': -1, 'y_m': 0}]},
            {'individual_positions': [{'x_m': 12.01, 'y_m': 4}]},
            {'individual_positions': [{'x_m': 'NaN', 'y_m': 5}]},
            {'individual_positions': [{'x_m': 2.125, 'y_m': 4}]},
            {'individual_positions': [{'id': str(uuid4()), 'x_m': 2, 'y_m': 4}]},
        ):
            with self.subTest(invalid=invalid):
                result = self.client.post(URL, self.payload(**invalid), format='json')
                self.assertEqual(result.status_code, 400, result.data)
        self.assertFalse(PlantingPlan.objects.exists())

        created = self.create_plan().json()
        for positions in (
            [created['individual_positions'][0]] * 2,
            [{'id': created['individual_positions'][0]['id'], 'x_m': 3}],
        ):
            result = self.client.patch(f"{URL}{created['id']}/individual-placement/", {
                'individual_positions': positions, 'placement_updated_at': created['updated_at'],
            }, format='json')
            self.assertEqual(result.status_code, 400, result.data)
        self.assertEqual(
            PlantingPlan.objects.get(pk=created['id']).individual_positions,
            created['individual_positions'],
        )

    def test_annual_individual_plans_share_a_bed_with_area_plans(self):
        self.bed.width_m, self.bed.length_m = 2, 10
        self.bed.save()
        beans = Crop.objects.create(
            project=self.project, name='Climbing beans', life_cycle='annual',
            growth_duration_days=12, harvest_duration_days=5,
        )
        carrots = self.client.post(URL, {
            'crop': self.crop.pk, 'bed': self.bed.pk, 'planting_date': '2026-04-18',
            'area_usage_sqm': 8,
        }, format='json')
        self.assertEqual(carrots.status_code, 201, carrots.data)
        self.assertEqual(carrots.data['placement_mode'], 'area')
        bed_payload = {
            'crop': beans.pk, 'parcel': None, 'bed': self.bed.pk,
            'placement_mode': 'individual_bed',
        }
        placed = self.create_plan(**bed_payload).json()
        second = self.create_plan(**bed_payload).json()
        direct = self.create_plan(crop=beans.pk, placement_mode='individual_parcel').json()
        self.assertEqual(placed['bed'], self.bed.pk)
        self.assertIsNone(placed['parcel'])
        self.assertIsNone(placed['area_usage_sqm'])
        self.assertIsNone(placed['quantity'])
        self.assertIsNone(placed['clearing_date'])
        self.assertEqual(placed['plants_count'], 2)
        self.assertEqual(placed['parcel_location_id'], self.location.pk)
        self.assertEqual(direct['placement_mode'], 'individual_parcel')
        self.assertIsNone(direct['clearing_date'])
        self.assertTrue(
            {stem['id'] for stem in placed['individual_positions']}.isdisjoint(
                stem['id'] for stem in second['individual_positions']
            )
        )
        results = self.client.get(URL, {'individual_location': self.location.pk}).json()['results']
        self.assertEqual(
            {plan['id'] for plan in results}, {placed['id'], second['id'], direct['id']},
        )
        summaries = self.client.get(URL, {'individual_only': 'true'}).json()['results']
        self.assertEqual(
            {plan['id'] for plan in summaries}, {placed['id'], second['id'], direct['id']},
        )
        self.assertTrue(all('individual_positions' not in plan for plan in summaries))
        detail = self.client.get(f"{URL}{placed['id']}/").json()
        self.assertEqual(detail['field_name'], self.field.name)
        self.assertEqual(detail['location_name'], self.location.name)
        self.assertEqual(detail['bed_name'], self.bed.name)
        demand = self.client.get('/openfarmplanner/api/young-plant-demand/').json()['results']
        beans_demand = next(item for item in demand if item['crop_id'] == beans.pk)
        self.assertEqual(beans_demand['plant_count'], 6)

        capacity = self.client.get(f'{URL}remaining-area/', {
            'bed_id': self.bed.pk, 'start_date': '2026-04-18', 'end_date': '2026-04-22',
        }).json()
        self.assertFalse(capacity['area_capacity_known'])
        self.assertIsNone(capacity['remaining_area_sqm'])
        self.assertEqual(capacity['overlapping_used_area_sqm'], 8.0)
        self.assertEqual(capacity['unallocated_measured_area_sqm'], 12.0)
        fits = self.client.post(URL, {
            'crop': self.crop.pk, 'bed': self.bed.pk, 'planting_date': '2026-04-18',
            'area_usage_sqm': 12,
        }, format='json')
        self.assertEqual(fits.status_code, 201, fits.data)

    def test_undated_existing_placement_stays_editable_but_date_cannot_be_cleared_or_omitted(self):
        created = self.create_plan().json()
        PlantingPlan.objects.filter(pk=created['id']).update(planting_date=None)
        detail = f"{URL}{created['id']}/"
        stems = [{'id': created['individual_positions'][0]['id'], 'x_m': 3, 'y_m': 4}]
        edited = self.client.patch(detail, {
            'individual_positions': stems,
            'placement_updated_at': self.client.get(detail).json()['updated_at'],
        }, format='json')
        self.assertEqual(edited.status_code, 200, edited.data)
        cleared = self.client.patch(detail, {'planting_date': None}, format='json')
        self.assertEqual(cleared.status_code, 400)
        undated_payload = self.payload()
        del undated_payload['planting_date']
        omitted = self.client.post(URL, undated_payload, format='json')
        self.assertEqual(omitted.status_code, 400)

    def test_bed_placement_checks_dimensions_and_preserves_parent_on_updates(self):
        self.bed.width_m, self.bed.length_m = 3, 10
        self.bed.save()
        base = {
            'crop': self.crop.pk, 'parcel': None, 'bed': self.bed.pk,
            'placement_mode': 'individual_bed',
        }
        other_bed = Bed.objects.create(
            project=self.project, field=self.field, name='Unmeasured bed',
        )
        for invalid in (
            {'parcel': self.field.pk}, {'bed': None}, {'bed': other_bed.pk},
            {'placement_mode': 'individual_parcel'},
            {'individual_positions': [{'x_m': 3.01, 'y_m': 4}]},
        ):
            with self.subTest(invalid=invalid):
                result = self.client.post(URL, self.payload(**(base | invalid)), format='json')
                self.assertEqual(result.status_code, 400, result.data)
        self.assertFalse(PlantingPlan.objects.exists())

        placed = self.create_plan(**base).json()
        url = f"{URL}{placed['id']}/"
        for invalid in (
            {'bed': other_bed.pk}, {'placement_mode': 'area'}, {'parcel': self.field.pk},
        ):
            result = self.client.patch(url, invalid, format='json')
            self.assertEqual(result.status_code, 400, result.data)
        dimensions = f'/openfarmplanner/api/beds/{self.bed.pk}/'
        changed = self.client.patch(dimensions, {'length_m': 8.9}, format='json')
        self.assertEqual(changed.status_code, 409, changed.data)
        self.assertEqual(changed.data['code'], 'bed_contains_individual_positions')
        self.bed.refresh_from_db()
        self.assertEqual(self.bed.length_m, 10)
        after = PlantingPlan.objects.get(pk=placed['id'])
        self.assertEqual(after.bed_id, self.bed.pk)
        self.assertEqual(after.individual_positions, placed['individual_positions'])

    def test_parcel_dimension_changes_keep_all_saved_positions_inside(self):
        created = self.create_plan().json()
        parcel_url = f'/openfarmplanner/api/fields/{self.field.pk}/'
        for dimensions in ({'width_m': 1.99}, {'length_m': 8.99}, {'width_m': None}):
            with self.subTest(dimensions=dimensions):
                result = self.client.patch(parcel_url, dimensions, format='json')
                self.assertEqual(result.status_code, 409, result.data)
                self.assertEqual(result.data['code'], 'parcel_contains_individual_positions')
        self.field.refresh_from_db()
        self.assertEqual((self.field.width_m, self.field.length_m), (12, 20))

        exact_fit = self.client.patch(parcel_url, {'width_m': 2, 'length_m': 9}, format='json')
        self.assertEqual(exact_fit.status_code, 200, exact_fit.data)
        plan_url = f"{URL}{created['id']}/individual-placement/"
        unchanged = self.client.patch(plan_url, {
            'placement_updated_at': created['updated_at'],
            'individual_positions': created['individual_positions'],
        }, format='json')
        self.assertEqual(unchanged.status_code, 200, unchanged.data)
        self.assertEqual(unchanged.data['individual_positions'], created['individual_positions'])

        removed = self.client.patch(plan_url, {
            'placement_updated_at': unchanged.data['updated_at'], 'individual_positions': [],
        }, format='json')
        self.assertEqual(removed.status_code, 200, removed.data)
        now_unmeasured = self.client.patch(parcel_url, {'width_m': None}, format='json')
        self.assertEqual(now_unmeasured.status_code, 200, now_unmeasured.data)

    def test_plot_filter_keeps_bed_plans_and_canopy_does_not_reserve_the_bed(self):
        orchard = self.create_plan(estimated_canopy_diameter_m=10).json()
        vegetable = self.client.post(URL, {
            'crop': self.crop.id, 'bed': self.bed.id, 'planting_date': '2026-04-18',
            'area_usage_sqm': 20,
        }, format='json')
        self.assertEqual(vegetable.status_code, 201, vegetable.data)
        self.assertEqual(vegetable.data['harvest_overlaps'], [])
        for query, expected in (
            (f'individual_location={self.location.id}', {orchard['id']}),
            (f'location={self.location.id}', {vegetable.data['id']}),
            (f'field={self.field.id}', {orchard['id'], vegetable.data['id']}),
            (f'bed={self.bed.id}', {vegetable.data['id']}),
        ):
            with self.subTest(query=query):
                result = self.client.get(f'{URL}?{query}').json()['results']
                self.assertEqual({plan['id'] for plan in result}, expected)
        detail = self.client.get(f"{URL}{orchard['id']}/").json()
        self.assertEqual(detail['field_name'], self.field.name)
        self.assertEqual(detail['location_name'], self.location.name)

    def test_plot_suitability_uses_parcel_conditions_and_inherits_from_location(self):
        self.apple.light_requirement, self.apple.water_requirement = ['full_sun'], 'high'
        self.apple.save()
        self.field.light_condition, self.field.soil_moisture = 'shade', 'dry'
        self.field.save()
        self.location.irrigation = 'unavailable'
        self.location.save()

        created = self.create_plan().json()
        detail = self.client.get(f"{URL}{created['id']}/").json()
        [listed] = self.client.get(URL, {'individual_location': self.location.pk}).json()['results']
        light, water = detail['site_suitability_findings']
        self.assertEqual((light['code'], light['light']['source']), ('light_mismatch', 'field'))
        self.assertEqual(
            (water['code'], water['irrigation']['source']), ('water_mismatch', 'location'),
        )
        self.assertEqual(water['soil_moisture']['source'], 'field')
        self.assertEqual(detail['site_suitability_findings'], listed['site_suitability_findings'])

    def test_crop_cannot_become_annual_while_used_by_an_individual_plan(self):
        created = self.create_plan().json()
        response = self.client.patch(
            f'{CROP_URL}{self.apple.pk}/', {'life_cycle': 'annual'}, format='json',
        )
        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data['code'], 'individual_plant_lifecycle_conflict')
        self.apple.refresh_from_db()
        self.assertEqual(self.apple.life_cycle, 'perennial')
        detail = self.client.get(f"{URL}{created['id']}/").json()
        self.assertEqual(detail['individual_positions'], created['individual_positions'])
        self.assertEqual(detail['clearing_date'], created['clearing_date'])
        self.assertTrue(eligible_harvest_plans(
            self.project.id, self.apple.id, date(2027, 8, 29),
        ).exists())

    def test_crop_cannot_become_annual_while_used_by_a_location_plan(self):
        self.create_plan(
            parcel=None, site=self.location.pk,
            individual_positions=[], individual_count=2,
        )
        response = self.client.patch(
            f'{CROP_URL}{self.apple.pk}/', {'life_cycle': 'annual'}, format='json',
        )
        self.assertEqual(response.status_code, 409, response.data)
        self.assertEqual(response.data['code'], 'individual_plant_lifecycle_conflict')

    def variety_inheriting_from_apple(self):
        species = CropSpecies.objects.create(name='Orchard apple')
        self.apple.crop_species = species
        self.apple.save()
        return Crop.objects.create(
            project=self.project, name=self.apple.name, crop_species=species, variety='Topaz',
        )

    def test_general_crop_edit_respects_the_effective_lifecycle_of_used_varieties(self):
        variety = self.variety_inheriting_from_apple()
        self.create_plan(crop=variety.pk)

        url = f'{CROP_URL}{self.apple.pk}/'
        result = self.client.patch(url, {'life_cycle': 'annual'}, format='json')
        self.assertEqual(result.status_code, 409, result.data)
        own_perennial = self.client.patch(f'{CROP_URL}{variety.pk}/', {
            'life_cycle': 'perennial', 'standing_time_years': 10,
        }, format='json')
        self.assertEqual(own_perennial.status_code, 200, own_perennial.data)
        allowed = self.client.patch(url, {'life_cycle': 'annual'}, format='json')
        self.assertEqual(allowed.status_code, 200, allowed.data)
        no_override = self.client.patch(
            f'{CROP_URL}{variety.pk}/', {'life_cycle': ''}, format='json',
        )
        self.assertEqual(no_override.status_code, 409, no_override.data)

    def test_cannot_archive_the_perennial_parent_of_an_individual_plan(self):
        variety = self.variety_inheriting_from_apple()
        plan = self.create_plan(crop=variety.pk).json()
        parent_url = f'{CROP_URL}{self.apple.pk}/'

        rejected = self.client.delete(parent_url)
        self.assertEqual(rejected.status_code, 409, rejected.data)
        self.assertEqual(rejected.data['code'], 'individual_plant_lifecycle_conflict')
        self.assertTrue(Crop.objects.filter(pk=variety.pk).exists())

        archived_variety = self.client.delete(f'{CROP_URL}{variety.pk}/')
        self.assertEqual(archived_variety.status_code, 204, archived_variety.data)
        still_rejected = self.client.delete(parent_url)
        self.assertEqual(still_rejected.status_code, 409, still_rejected.data)
        self.apple.refresh_from_db()
        self.assertIsNone(self.apple.deleted_at)
        self.assertTrue(eligible_harvest_plans(
            self.project.pk, variety.pk, date(2027, 8, 29),
        ).filter(pk=plan['id']).exists())

    def test_carryover_is_the_same_planting_and_can_be_edited_in_the_visible_season(self):
        created = self.create_plan().json()
        plan_id = created['id']
        self.client.defaults['HTTP_X_SEASON_ID'] = str(self.later.id)
        visible = self.client.get(f'{URL}?individual_location={self.location.id}').json()['results']
        self.assertEqual([plan['id'] for plan in visible], [plan_id])
        self.assertTrue(visible[0]['carried_over'])
        self.assertEqual(visible[0]['individual_positions'], created['individual_positions'])
        projected = self.client.get(URL, {'individual_only': 'true'}).json()['results']
        self.assertEqual(
            [(plan['id'], plan['plants_count'], plan['carried_over']) for plan in projected],
            [(plan_id, 2, True)],
        )
        unscoped = self.client.get(URL, {'individual_only': 'true'}, HTTP_X_SEASON_ID='')
        self.assertEqual(unscoped.json()['results'], [])
        self.assertTrue(eligible_harvest_plans(
            self.project.id, self.apple.id, date(2027, 8, 29),
        ).filter(id=plan_id).exists())

        response = self.client.patch(f'{URL}{plan_id}/individual-placement/', {
            'estimated_canopy_diameter_m': 4, 'placement_updated_at': created['updated_at'],
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.json()['carried_over'])
        result = copy_planting_plans(source_season=self.origin, target_season=self.later)
        self.assertEqual(result, ([], 0, 1, 0))
        self.assertEqual(PlantingPlan.objects.get(id=plan_id).season_id, self.origin.id)

        after_removal = self.make_season(2039)
        self.client.defaults['HTTP_X_SEASON_ID'] = str(after_removal.id)
        after = self.client.get(f'{URL}?individual_location={self.location.id}')
        self.assertEqual(after.json()['results'], [])
        self.assertEqual(self.client.get(URL, {'individual_only': 'true'}).json()['results'], [])
        denied = self.client.patch(f'{URL}{plan_id}/individual-placement/', {
            'estimated_canopy_diameter_m': 5, 'placement_updated_at': response.json()['updated_at'],
        }, format='json')
        self.assertEqual(denied.status_code, 404, denied.data)

    def test_harvest_suggestions_distinguish_two_direct_parcels(self):
        second = Field.objects.create(
            project=self.project, location=self.location, name='South orchard',
            width_m=12, length_m=20,
        )
        first_plan = self.create_plan().json()
        second_plan = self.create_plan(parcel=second.pk).json()
        self.client.defaults['HTTP_X_SEASON_ID'] = str(self.later.id)
        response = self.client.get('/openfarmplanner/api/harvests/suggestions/', {
            'crop': self.apple.pk, 'date': '2027-08-29',
        })
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            {(item['id'], item['field_name'], item['bed_name']) for item in response.data},
            {(first_plan['id'], self.field.name, ''), (second_plan['id'], second.name, '')},
        )
        harvests_url = '/openfarmplanner/api/harvests/'
        saved = self.client.post(harvests_url, {
            'crop': self.apple.pk, 'date': '2027-08-29', 'unit': 'kg', 'quantity': 5,
            'allocations': [
                {'planting_plan': first_plan['id'], 'quantity': 2},
                {'planting_plan': second_plan['id'], 'quantity': 3},
            ],
        }, format='json')
        self.assertEqual(saved.status_code, 201, saved.data)
        reopened = self.client.get(f"{harvests_url}{saved.data['id']}/")
        self.assertEqual(reopened.status_code, 200, reopened.data)
        self.assertEqual(
            {item['parcel_name'] for item in reopened.data['allocations']},
            {self.field.name, second.name},
        )

    def test_carried_over_parcel_plan_accepts_tasks_and_matches_field_filter(self):
        plan = self.create_plan().json()
        self.client.defaults['HTTP_X_SEASON_ID'] = str(self.later.id)
        url = '/openfarmplanner/api/tasks/'
        created = self.client.post(url, {
            'title': 'Check stems', 'planting_plan': plan['id'], 'due_date': '2027-04-18',
        }, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data['season'], self.later.id)
        self.assertIn(self.field.name, created.data['planting_plan_name'])
        filtered = self.client.get(url, {
            'planting_plan': plan['id'], 'field': self.field.id,
        }).json()['results']
        self.assertIn(created.data['id'], {task['id'] for task in filtered})
        explicitly_scoped = self.client.patch(f"{url}{created.data['id']}/", {
            'field': self.field.id,
        }, format='json')
        self.assertEqual(explicitly_scoped.status_code, 200, explicitly_scoped.data)

    def test_rotation_keeps_the_plot_and_renewal_coordinates(self):
        opposite = Field.objects.create(
            project=self.project, location=self.location, name='Other plot',
            width_m=12, length_m=20,
        )
        opposite_bed = Bed.objects.create(
            project=self.project, field=opposite, name='Other bed', width_m=4, length_m=10,
        )
        created = self.client.post('/openfarmplanner/api/parcel-rotation-groups/', {
            'name': 'Rotation', 'parcels': [
                {'id': self.field.id, 'bed_ids': [self.bed.id]},
                {'id': opposite.id, 'bed_ids': [opposite_bed.id]},
            ],
        }, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        self.bed.width_m, self.bed.length_m = 3, 10
        self.bed.save()
        orchard = self.create_plan(clearing_date='2026-12-31').json()
        plants = self.create_plan(
            crop=self.crop.pk, parcel=None, bed=self.bed.pk, placement_mode='individual_bed',
        ).json()
        annual = PlantingPlan.objects.create(
            project=self.project, season=self.origin, crop=self.crop, bed=self.bed,
            planting_date=date(2026, 5, 1), area_usage_sqm=5,
        )
        pairs, _, continuing, _ = build_planting_plan_copies(
            source_season=self.origin, target_season=self.later,
        )
        preview = preview_parcel_rotation(
            self.origin, self.later, pairs, preceding=True, requested=True,
            continuing_count=continuing,
        ).summary
        self.assertTrue(preview['enabled'])
        self.assertEqual(len(preview['moves']), 2)
        position_move = next(
            move for move in preview['moves'] if move['source_plan_id'] == plants['id']
        )
        self.assertIsNone(position_move['new_area_sqm'])
        self.assertEqual(position_move['new_plant_count'], 2)

        opposite_bed.width_m = 1
        opposite_bed.save()
        incompatible = preview_parcel_rotation(
            self.origin, self.later, pairs, preceding=True, requested=True,
            continuing_count=continuing,
        ).summary
        self.assertFalse(incompatible['available'])
        issue_codes = {issue['code'] for issue in incompatible['issues']}
        self.assertIn('bed_placement_incompatible', issue_codes)
        api = f'/openfarmplanner/api/seasons/{self.later.pk}/copy-from/'
        rejected = self.client.post(api, {
            'source_season_id': self.origin.pk, 'rotate_parcels': True,
            'parcel_rotation_fingerprint': preview['fingerprint'],
        }, format='json')
        self.assertEqual(rejected.status_code, 409, rejected.data)
        self.assertFalse(PlantingPlan.objects.filter(season=self.later).exists())
        opposite_bed.width_m = 4
        opposite_bed.save()

        copies, _, _, _ = copy_planting_plans(
            source_season=self.origin, target_season=self.later,
            parcel_rotation_fingerprint=preview['fingerprint'],
        )
        by_source = {plan.copied_from_plan_id: plan for plan in copies}
        self.assertEqual(by_source[annual.id].bed_id, opposite_bed.id)
        copied_bed_placement = by_source[plants['id']]
        self.assertEqual(copied_bed_placement.placement_mode, 'individual_bed')
        self.assertEqual(copied_bed_placement.bed_id, opposite_bed.pk)
        self.assertIsNone(copied_bed_placement.area_usage_sqm)
        self.assertEqual(
            PlantingPlan.objects.get(pk=plants['id']).individual_positions,
            plants['individual_positions'],
        )
        for before, after in zip(
            plants['individual_positions'], copied_bed_placement.individual_positions, strict=True,
        ):
            self.assertNotEqual(before['id'], after['id'])
            self.assertEqual((before['x_m'], before['y_m']), (after['x_m'], after['y_m']))
        trees = by_source[orchard['id']]
        self.assertEqual(trees.parcel_id, self.field.id)
        self.assertIsNone(trees.bed_id)
        compared = zip(orchard['individual_positions'], trees.individual_positions, strict=True)
        for before, after in compared:
            self.assertNotEqual(before['id'], after['id'])
            self.assertEqual((before['x_m'], before['y_m']), (after['x_m'], after['y_m']))

    def test_seed_rate_per_plant_uses_confirmed_positions(self):
        self.apple.cultivation_types = ['pre_cultivation']
        self.apple.seed_rate_pre_cultivation_value = 2
        self.apple.seed_rate_pre_cultivation_unit = 'seeds_per_plant'
        plan = PlantingPlan(
            crop=self.apple, parcel=self.field, cultivation_type='pre_cultivation', quantity=999,
            individual_positions=[{'x_m': 1, 'y_m': 1}, {'x_m': 2, 'y_m': 2}],
        )
        self.assertEqual(compute_plan_requirement(plan).value, Decimal(4))
        plan.individual_positions = []
        self.assertEqual(compute_plan_requirement(plan).value, Decimal(0))
