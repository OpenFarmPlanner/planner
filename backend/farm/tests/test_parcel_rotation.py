from datetime import date
from decimal import Decimal

from farm.history.project_restore import capture_project_state, record_project_checkpoint
from farm.models import Bed, Field, Location, PlantingPlan, Project, Season
from farm.tests.api_base import ProjectApiTestCase

GROUPS_URL = '/openfarmplanner/api/parcel-rotation-groups/'
SEASONS_URL = '/openfarmplanner/api/seasons/'


class ParcelRotationApiTest(ProjectApiTestCase):
    def setUp(self):
        super().setUp()
        self.rotation_fields = []
        self.rotation_beds = []
        for name, area in (('North', '10.0'), ('South', '8.1'), ('West', '7.3')):
            field = Field.objects.create(project=self.project, location=self.location, name=name)
            self.rotation_fields.append(field)
            self.rotation_beds.append(
                [
                    Bed.objects.create(
                        project=self.project, field=field, name=bed_name, area_sqm=Decimal(area)
                    )
                    for bed_name in ('Lower', 'Upper')
                ]
            )

    def _configuration(self):
        return {
            'name': 'Market garden',
            'parcels': [
                {'id': field.pk, 'bed_ids': [bed.pk for bed in reversed(beds)]}
                for field, beds in zip(self.rotation_fields, self.rotation_beds, strict=True)
            ],
        }

    def _create_group(self):
        created = self.client.post(GROUPS_URL, self._configuration(), format='json')
        self.assertEqual(created.status_code, 201, created.data)
        return created.data

    def _season(self, year):
        return Season.objects.create(
            project=self.project,
            start_date=date(year, 1, 1),
            end_date=date(year, 12, 31),
        )

    def _plan(self, season, bed, area, *, notes='', quantity=None):
        return PlantingPlan.objects.create(
            project=self.project,
            crop=self.crop,
            bed=bed,
            season=season,
            notes=notes,
            planting_date=date(season.start_date.year, 4, 1),
            cultivation_type='direct_sowing',
            area_usage_sqm=Decimal(area),
            quantity=quantity,
        )

    def test_group_order_is_persisted_and_membership_is_project_scoped(self):
        group = self._create_group()
        group_url = f'{GROUPS_URL}{group["id"]}/'
        configuration = self._configuration()
        configuration['parcels'].reverse()
        changed = self.client.put(group_url, configuration, format='json')
        self.assertEqual(changed.status_code, 200, changed.data)
        first = self.client.get(GROUPS_URL).data[0]['parcels'][0]
        self.assertEqual(first['id'], self.rotation_fields[-1].pk)
        self.assertEqual(
            [bed['id'] for bed in first['beds']],
            [bed.pk for bed in reversed(self.rotation_beds[-1])],
        )
        duplicate = self.client.post(
            GROUPS_URL,
            {**configuration, 'name': 'Another group'},
            format='json',
        )
        self.assertEqual(duplicate.status_code, 400, duplicate.data)

        foreign_project = Project.objects.create(name='Other farm', slug='other-rotation-farm')
        foreign_location = Location.objects.create(project=foreign_project, name='Other site')
        foreign_field = Field.objects.create(
            project=foreign_project,
            location=foreign_location,
            name='Other parcel',
        )
        foreign = self.client.put(
            group_url,
            {
                'name': 'Foreign configuration',
                'parcels': [{'id': foreign_field.pk}],
            },
            format='json',
        )
        self.assertEqual(foreign.status_code, 400, foreign.data)
        self.assertEqual(len(self.client.get(GROUPS_URL).data), 1)
        self.assertEqual(self.client.delete(group_url).status_code, 204)
        self.assertEqual(self.client.get(GROUPS_URL).data, [])

    def test_three_steps_restore_exact_areas_and_preserve_quantity_override(self):
        self._create_group()
        source = self._season(2026)
        originals = [
            self._plan(source, self.rotation_beds[0][0], area, notes=area, quantity=25)
            for area in ('3.33', '3.33', '3.34')
        ]
        for dest_index, year in zip((1, 2, 0), (2027, 2028, 2029), strict=True):
            target = self._season(year)
            record_project_checkpoint(self.project, capture_project_state(self.project))
            api = f'{SEASONS_URL}{target.pk}/'
            preview = self.client.get(
                f'{api}copy-preview/',
                {
                    'source_season_id': source.pk,
                    'rotate_parcels': True,
                },
            )
            self.assertEqual(preview.status_code, 200, preview.data)
            rotation = preview.data['parcel_rotation']
            self.assertTrue(rotation['enabled'], rotation)
            self.assertEqual(len(rotation['mappings']), 3)
            self.assertEqual(len(rotation['moves']), 3)
            response = self.client.post(
                f'{api}copy-from/',
                {
                    'source_season_id': source.pk,
                    'rotate_parcels': True,
                    'parcel_rotation_fingerprint': rotation['fingerprint'],
                },
                format='json',
            )
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(response.data['copied_count'], 3)
            target_bed = self.rotation_beds[dest_index][0]
            copies = list(PlantingPlan.objects.filter(season=target).order_by('pk'))
            self.assertEqual({plan.bed_id for plan in copies}, {target_bed.pk})
            self.assertEqual(sum(plan.area_usage_sqm for plan in copies), target_bed.area_sqm)
            self.assertEqual({plan.quantity for plan in copies}, {25})
            source = target
        self.assertEqual(
            sorted(plan.area_usage_sqm for plan in copies),
            sorted(plan.area_usage_sqm for plan in originals),
        )
        self.assertEqual(PlantingPlan.objects.filter(season=originals[0].season).count(), 3)

    def test_invalid_after_edit_and_stale_preview_do_not_create_the_target(self):
        group = self._create_group()
        source = self._season(2026)
        self._plan(source, self.rotation_beds[0][0], '5.00')
        params = {'copy_target': 'adopt', 'source_season_id': source.pk, 'rotate_parcels': True}
        preview = self.client.get(f'{SEASONS_URL}creation-options/', params)
        self.assertEqual(preview.status_code, 200, preview.data)
        rotation = preview.data['parcel_rotation']['adopt']
        self.assertTrue(rotation['enabled'], rotation)

        field = self.rotation_fields[0]
        Bed.objects.create(project=self.project, field=field, name='New bed')
        invalid = self.client.get(f'{SEASONS_URL}creation-options/', params)
        self.assertFalse(invalid.data['parcel_rotation']['adopt']['available'])
        self.assertEqual(
            invalid.data['parcel_rotation']['adopt']['issues'][0]['code'], 'unequal_bed_counts'
        )
        rejected = self.client.post(
            f'{SEASONS_URL}create-and-copy/',
            {
                **preview.data['due_period'],
                'source_season_id': source.pk,
                'rotate_parcels': True,
                'parcel_rotation_fingerprint': rotation['fingerprint'],
            },
            format='json',
        )
        self.assertEqual(rejected.status_code, 409, rejected.data)
        self.assertEqual(rejected.data['code'], 'parcel_rotation_preview_changed')
        self.assertEqual(Season.objects.filter(project=self.project).count(), 1)
        self.assertEqual(PlantingPlan.objects.filter(project=self.project).count(), 1)
        self.assertFalse(self.client.get(f'{GROUPS_URL}{group["id"]}/').data['valid'])

    def test_nonconsecutive_source_copies_without_rotating(self):
        self._create_group()
        source = self._season(2025)
        target = self._season(2027)
        original = self._plan(source, self.rotation_beds[0][0], '4')
        record_project_checkpoint(self.project, capture_project_state(self.project))
        api = f'{SEASONS_URL}{target.pk}/'
        preview = self.client.get(
            f'{api}copy-preview/',
            {
                'source_season_id': source.pk,
                'rotate_parcels': True,
            },
        )
        self.assertFalse(preview.data['parcel_rotation']['available'])
        result = self.client.post(
            f'{api}copy-from/', {'source_season_id': source.pk}, format='json'
        )
        self.assertEqual(result.status_code, 200, result.data)
        copied = PlantingPlan.objects.get(season=target)
        self.assertEqual(copied.bed_id, original.bed_id)
        self.assertEqual(copied.area_usage_sqm, original.area_usage_sqm)

    def test_rotated_bought_in_plants_have_no_seed_demand(self):
        self._create_group()
        source, target = self._season(2026), self._season(2027)
        self.crop.seed_rate_value = 2
        self.crop.seed_rate_unit = 'g_per_m2'
        self.crop.save()
        original = self._plan(source, self.rotation_beds[0][0], '4', quantity=25)
        PlantingPlan.objects.filter(pk=original.pk).update(
            cultivation_type=PlantingPlan.CULTIVATION_TYPE_PURCHASED_TRANSPLANT,
        )
        preview = self.client.get(f'{SEASONS_URL}{target.pk}/copy-preview/', {
            'source_season_id': source.pk, 'rotate_parcels': True,
        })
        self.assertEqual(preview.status_code, 200, preview.data)
        move = preview.data['parcel_rotation']['moves'][0]
        self.assertEqual(move['quantity_override'], 25)
        self.assertIsNone(move['seed_requirement'])
        self.assertIsNone(move['seed_unit'])

    def test_partial_coverage_and_date_basis_match_guided_copy(self):
        self._create_group()
        source = self._season(2026)
        first = self._plan(source, self.rotation_beds[0][0], '2', notes='First crop')
        self._plan(source, self.rotation_beds[0][0], '3', notes='Second crop')
        PlantingPlan.objects.filter(pk=first.pk).update(actual_sowing_date=date(2026, 4, 8))
        record_project_checkpoint(self.project, capture_project_state(self.project))
        params = {'copy_target': 'adopt', 'source_season_id': source.pk, 'rotate_parcels': True}
        planned = self.client.get(f'{SEASONS_URL}creation-options/', params)
        actual = self.client.get(
            f'{SEASONS_URL}creation-options/', {**params, 'use_actual_dates': True}
        )
        old = planned.data['parcel_rotation']['adopt']
        new = actual.data['parcel_rotation']['adopt']
        self.assertEqual(old['moves'][0]['planting_date'], date(2027, 4, 1))
        self.assertEqual(new['moves'][0]['planting_date'], date(2027, 4, 8))
        self.assertNotEqual(old['fingerprint'], new['fingerprint'])
        payload = {
            **actual.data['due_period'],
            'source_season_id': source.pk,
            'rotate_parcels': True,
            'use_actual_dates': True,
        }
        stale = self.client.post(
            f'{SEASONS_URL}create-and-copy/',
            {
                **payload,
                'parcel_rotation_fingerprint': old['fingerprint'],
            },
            format='json',
        )
        self.assertEqual(stale.status_code, 409, stale.data)
        confirmed = self.client.post(
            f'{SEASONS_URL}create-and-copy/',
            {
                **payload,
                'parcel_rotation_fingerprint': new['fingerprint'],
            },
            format='json',
        )
        self.assertEqual(confirmed.status_code, 201, confirmed.data)
        copies = PlantingPlan.objects.filter(season_id=confirmed.data['id']).order_by('pk')
        self.assertEqual(
            list(copies.values_list('bed_id', flat=True)), [self.rotation_beds[1][0].pk] * 2
        )
        self.assertEqual(
            list(copies.values_list('area_usage_sqm', flat=True)),
            [Decimal('1.62'), Decimal('2.43')],
        )
        self.assertEqual(copies.first().planting_date, date(2027, 4, 8))

    def test_continuing_plan_keeps_its_bed_and_blocks_insufficient_rotated_capacity(self):
        rotation = self._create_group()
        source = self._season(2026)
        target = self._season(2027)
        candidate = self._plan(source, self.rotation_beds[0][0], '9', notes='Spring')
        winter = self._plan(source, self.rotation_beds[1][0], '4', notes='Winter')
        PlantingPlan.objects.filter(pk=winter.pk).update(
            planting_date=date(2026, 10, 15),
            harvest_date=date(2027, 6, 15),
            harvest_end_date=date(2027, 7, 15),
        )
        previous = PlantingPlan.objects.values().get(pk=winter.pk)
        record_project_checkpoint(self.project, capture_project_state(self.project))
        path = f'{SEASONS_URL}{target.pk}/'
        params = {'source_season_id': source.pk}
        rotated = self.client.get(f'{path}copy-preview/', {**params, 'rotate_parcels': True})
        self.assertEqual(rotated.data['continuing_count'], 1)
        self.assertFalse(rotated.data['parcel_rotation']['available'])
        self.assertEqual(rotated.data['parcel_rotation']['issues'][0]['code'], 'bed_capacity')
        rejected = self.client.post(f'{path}copy-from/', {**params, 'rotate_parcels': True})
        self.assertEqual(rejected.status_code, 409, rejected.data)
        plain = self.client.get(f'{path}copy-preview/', params)
        self.assertTrue(plain.data['parcel_rotation']['available'])
        self.assertFalse(plain.data['parcel_rotation']['enabled'])
        self.assertEqual(plain.data['total'], 1)
        response = self.client.post(f'{path}copy-from/', params)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['continuing_count'], 1)
        self.assertEqual(PlantingPlan.objects.get(season=target).bed_id, candidate.bed_id)
        self.assertEqual(PlantingPlan.objects.values().get(pk=winter.pk), previous)
        self.assertTrue(self.client.get(f'{GROUPS_URL}{rotation["id"]}/').data['valid'])

    def test_transition_preview_matches_rotation_in_both_created_seasons(self):
        self._create_group()
        source = Season.objects.create(
            project=self.project,
            start_date=date(2025, 9, 1),
            end_date=date(2026, 8, 31),
        )
        first = self._plan(source, self.rotation_beds[0][0], '4', notes='October')
        second = self._plan(source, self.rotation_beds[0][1], '5', notes='April')
        PlantingPlan.objects.filter(pk=first.pk).update(planting_date=date(2025, 10, 12))
        PlantingPlan.objects.filter(pk=second.pk).update(planting_date=date(2026, 4, 10))
        record_project_checkpoint(self.project, capture_project_state(self.project))
        params = {'source_season_id': source.pk, 'rotate_parcels': True}
        preview = self.client.get(
            f'{SEASONS_URL}creation-options/',
            {
                **params,
                'copy_target': 'transition',
            },
        )
        report = preview.data['parcel_rotation']['transition']
        self.assertTrue(report['enabled'], report)
        response = self.client.post(
            f'{SEASONS_URL}create-transition/',
            {
                **params,
                'copy': True,
                'parcel_rotation_fingerprint': report['fingerprint'],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.data)
        for season_key, bed, planting_date in (
            ('transition_season', self.rotation_beds[1][0], date(2026, 10, 12)),
            ('followup_season', self.rotation_beds[1][1], date(2027, 4, 10)),
        ):
            copy = PlantingPlan.objects.get(season_id=response.data[season_key]['id'])
            self.assertEqual(copy.bed_id, bed.pk)
            self.assertEqual(copy.planting_date, planting_date)
