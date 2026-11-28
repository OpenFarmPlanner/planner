"""Preview/confirm geometry writes, the dated structure contract and checked Undo (#1634)."""

from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

from farm.history.project_restore import (
    capture_project_state,
    record_project_checkpoint,
    restore_project_version,
)
from farm.models import (
    BatchOperation,
    Bed,
    BedLayout,
    Crop,
    EntityRevision,
    Field,
    GrowingAreaGeometryVersion,
    Location,
    PlantingPlan,
    Project,
    Season,
)
from farm.services.bed_capacity import calculate_bed_capacity
from farm.services.growing_area_geometry import resolve_geometry
from farm.tests.api_base import ProjectApiTestCase

Version = GrowingAreaGeometryVersion
PREVIEW_URL = '/openfarmplanner/api/growing-area-geometry/preview/'
CONFIRM_URL = '/openfarmplanner/api/growing-area-geometry/confirm/'
NEXT_YEAR = date.today().year + 1


class GeometryChangeTestCase(ProjectApiTestCase):
    def setUp(self):
        super().setUp()
        self.bed.length_m, self.bed.width_m = 10, 1
        self.bed.save()
        self.next_season = Season.objects.create(
            project=self.project, start_date=date(NEXT_YEAR, 1, 1),
            end_date=date(NEXT_YEAR, 12, 31),
        )
        self.crop_ = Crop.objects.create(
            name='Salat', project=self.project, growth_duration_days=60, harvest_duration_days=10,
        )

    def plan(self, start: date, end: date, area: str, bed: Bed | None = None) -> PlantingPlan:
        return PlantingPlan.objects.create(
            project=self.project, crop=self.crop_, bed=bed or self.bed, planting_date=start,
            harvest_date=end - timedelta(days=5), harvest_end_date=end,
            area_usage_sqm=Decimal(area),
        )

    def preview(self, **body):
        payload = {'kind': 'bed', 'id': self.bed.pk, 'action': 'physical_change',
                   'season': self.next_season.pk, **body}
        return self.client.post(PREVIEW_URL, payload, format='json')

    def confirm(self, preview, request_id=None):
        return self.client.post(CONFIRM_URL, {
            'token': preview.data['token'], 'request_id': str(request_id or uuid4()),
        }, format='json')

    def bed_at(self, day: date):
        return resolve_geometry(self.project, day, beds=[self.bed.pk]).get('bed', self.bed.pk)


class PhysicalChangeTest(GeometryChangeTestCase):
    def test_a_resize_from_a_season_keeps_the_earlier_interval(self):
        earlier = self.plan(date(NEXT_YEAR - 1, 12, 1), date(NEXT_YEAR, 2, 1), '8')
        preview = self.preview(width_m=1.5)
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertTrue(preview.data['can_confirm'])
        self.assertEqual(preview.data['effective_from'], date(NEXT_YEAR, 1, 1))
        self.assertEqual(preview.data['previous']['area_sqm'], 10.0)
        self.assertEqual(preview.data['proposed']['area_sqm'], 15.0)
        self.assertEqual(preview.data['affected_plans']['count'], 1)
        self.assertEqual(preview.data['affected_plans']['results'][0]['id'], earlier.pk)

        confirmed = self.confirm(preview)
        self.assertEqual(confirmed.status_code, 200, confirmed.data)
        self.assertEqual(self.bed_at(date(NEXT_YEAR - 1, 12, 31)).area_sqm, Decimal('10.0'))
        self.assertEqual(self.bed_at(date(NEXT_YEAR, 1, 1)).area_sqm, Decimal('15.0'))
        self.bed.refresh_from_db()
        self.assertEqual(self.bed.area_sqm, Decimal('10.0'))  # today's mirror is unchanged
        earlier.refresh_from_db()
        self.assertEqual(earlier.area_usage_sqm, Decimal('8'))
        batch = BatchOperation.objects.get(operation_type=BatchOperation.TYPE_GEOMETRY_CHANGE)
        self.assertEqual(batch.context['proposed']['area_sqm'], 15.0)
        self.assertNotIn('_request_hash', confirmed.data)
        self.assertTrue(batch.revisions.filter(entity_type='bed', object_id=self.bed.pk).exists())

    def test_a_smaller_area_conflicts_with_a_continuing_plan(self):
        self.plan(date(NEXT_YEAR - 1, 12, 1), date(NEXT_YEAR, 3, 1), '8')
        preview = self.preview(width_m=0.5)
        self.assertFalse(preview.data['can_confirm'])
        self.assertIsNone(preview.data['token'])
        conflict = preview.data['conflicts'][0]
        self.assertEqual(conflict['code'], 'geometry_capacity_exceeded')
        self.assertEqual(conflict['used_area_sqm'], 8.0)

    def test_confirmation_replays_and_rejects_a_reused_request_id(self):
        preview = self.preview(width_m=1.5)
        request_id = uuid4()
        first = self.confirm(preview, request_id)
        replay = self.confirm(preview, request_id)
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.data, first.data)
        self.assertEqual(Version.objects.filter(bed=self.bed).count(), 2)
        other = self.preview(season=None, action='correction', version_id=first.data['version_id'],
                             width_m=1.6)
        reused = self.confirm(other, request_id)
        self.assertEqual(reused.status_code, 409)
        self.assertEqual(reused.data['code'], 'geometry_request_changed')

    def test_a_plan_changed_after_the_preview_makes_it_stale(self):
        plan = self.plan(date(NEXT_YEAR, 2, 1), date(NEXT_YEAR, 4, 1), '5')
        preview = self.preview(width_m=1.5)
        plan.area_usage_sqm = Decimal('6')
        plan.save()
        response = self.confirm(preview)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['code'], 'geometry_preview_stale')
        self.assertEqual(Version.objects.filter(bed=self.bed).count(), 1)

    def test_a_second_change_on_the_same_date_asks_for_a_correction(self):
        self.confirm(self.preview(width_m=1.5))
        again = self.preview(width_m=2)
        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.data['code'], 'geometry_version_exists_on_date')
        self.assertIn('version_id', again.data)

    def test_a_season_before_the_first_observation_is_refused(self):
        past = Season.objects.create(
            project=self.project, start_date=date(2020, 1, 1), end_date=date(2020, 12, 31),
        )
        response = self.preview(season=past.pk, width_m=1.5)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['code'], 'geometry_not_recorded_at_date')

    def test_a_preview_of_another_user_cannot_be_confirmed(self):
        preview = self.preview(width_m=1.5)
        other = type(self.user).objects.create_user(username='other', password='x', is_active=True)
        self.project.memberships.create(user=other, role='admin')
        self.client.force_authenticate(user=other)
        response = self.confirm(preview)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['code'], 'geometry_preview_stale')

    def test_other_projects_areas_are_not_found(self):
        other = Project.objects.create(name='Other', slug='other-geometry-change')
        location = Location.objects.create(project=other, name='Hidden')
        response = self.client.post(PREVIEW_URL, {
            'kind': 'location', 'id': location.pk, 'action': 'physical_change',
            'season': self.next_season.pk, 'length_m': 5,
        }, format='json')
        self.assertEqual(response.status_code, 404)

    def test_invalid_measurements_are_rejected(self):
        for body in ({'width_m': -1}, {'width_m': 0}, {'area_sqm': '20000'}):
            with self.subTest(body=body):
                self.assertEqual(self.preview(**body).status_code, 400)


class CorrectionAndUndoTest(GeometryChangeTestCase):
    def test_a_correction_needs_the_current_revision(self):
        version = Version.objects.get(bed=self.bed)
        stale = self.preview(action='correction', season=None, version_id=version.pk,
                             revision=version.revision + 1, width_m=1.2)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.data['code'], 'geometry_version_changed')
        confirmed = self.confirm(self.preview(
            action='correction', season=None, version_id=version.pk,
            revision=version.revision, width_m=1.2,
        ))
        self.assertEqual(confirmed.status_code, 200)
        self.bed.refresh_from_db()
        self.assertEqual(self.bed.area_sqm, Decimal('12.0'))  # the mirrored version changed

    def test_a_parent_correction_moves_the_schematic_layout_along(self):
        other_site = Location.objects.create(project=self.project, name='Pachtacker')
        other_parcel = Field.objects.create(project=self.project, location=other_site, name='Süd')
        layout = BedLayout.objects.create(
            project=self.project, location=self.location, bed=self.bed, x=4, y=2,
        )
        self.plan(date.today(), date.today() + timedelta(days=10), '1')
        version = Version.objects.get(bed=self.bed)
        moved = self.confirm(self.preview(
            action='correction', season=None, version_id=version.pk, parent_id=other_parcel.pk,
        ))
        self.assertEqual(moved.status_code, 200, moved.data)
        self.bed.refresh_from_db()
        layout.refresh_from_db()
        self.assertEqual(self.bed.field_id, other_parcel.pk)
        self.assertEqual((layout.location_id, layout.x, layout.y), (other_site.pk, 4, 2))

    def test_undo_removes_an_unused_scheduled_change(self):
        self.confirm(self.preview(width_m=1.5))
        batch = BatchOperation.objects.get(operation_type=BatchOperation.TYPE_GEOMETRY_CHANGE)
        url = f'/openfarmplanner/api/history/batch/{batch.pk}/revert/'
        self.assertEqual(self.client.post(url).status_code, 200)
        self.assertEqual(Version.objects.filter(bed=self.bed).count(), 1)
        self.assertEqual(self.bed_at(date(NEXT_YEAR, 6, 1)).area_sqm, Decimal('10.0'))
        again = self.client.post(url)
        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.data['code'], 'geometry_undo_done')

    def test_undo_is_blocked_when_a_plan_relies_on_the_new_size(self):
        self.confirm(self.preview(width_m=1.5))
        self.plan(date(NEXT_YEAR, 3, 1), date(NEXT_YEAR, 6, 1), '14')
        batch = BatchOperation.objects.get(operation_type=BatchOperation.TYPE_GEOMETRY_CHANGE)
        response = self.client.post(f'/openfarmplanner/api/history/batch/{batch.pk}/revert/')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['code'], 'geometry_undo_blocked')
        self.assertEqual(Version.objects.filter(bed=self.bed).count(), 2)

    def test_project_restore_keeps_a_later_scheduled_version(self):
        record_project_checkpoint(self.project, capture_project_state(self.project))
        checkpoint = EntityRevision.objects.filter(project=self.project).latest('created_at')
        self.confirm(self.preview(width_m=1.5))
        restore_project_version(self.project, checkpoint, user_name='tester')
        self.assertEqual(self.bed_at(date(NEXT_YEAR, 6, 1)).area_sqm, Decimal('15.0'))


class DatedStructureContractTest(GeometryChangeTestCase):
    def setUp(self):
        super().setUp()
        self.confirm(self.preview(width_m=1.5))
        self.url = f'/openfarmplanner/api/beds/{self.bed.pk}/'

    def test_reads_follow_the_selected_season(self):
        today = self.client.get(self.url)
        self.assertEqual(today.data['area_sqm'], '10.0')
        self.assertEqual(today.data['geometry']['status'], 'active')
        later = self.client.get(self.url, HTTP_X_SEASON_ID=str(self.next_season.pk))
        self.assertEqual(later.data['area_sqm'], '15.0')
        self.assertEqual(later.data['width_m'], 1.5)
        self.assertEqual(later.data['geometry']['effective_from'], date(NEXT_YEAR, 1, 1))
        listed = self.client.get('/openfarmplanner/api/beds/',
                                 HTTP_X_SEASON_ID=str(self.next_season.pk))
        row = next(item for item in listed.data['results'] if item['id'] == self.bed.pk)
        self.assertEqual(row['area_sqm'], '15.0')

    def test_saving_unchanged_dated_values_never_touches_the_mirror(self):
        later = self.client.get(self.url, HTTP_X_SEASON_ID=str(self.next_season.pk)).data
        response = self.client.put(self.url, {
            'name': 'Renamed', 'field': self.field.pk, 'length_m': later['length_m'],
            'width_m': later['width_m'], 'area_sqm': later['area_sqm'],
        }, format='json', HTTP_X_SEASON_ID=str(self.next_season.pk))
        self.assertEqual(response.status_code, 200, response.data)
        self.bed.refresh_from_db()
        self.assertEqual((self.bed.name, self.bed.width_m), ('Renamed', 1))

    def test_a_used_area_needs_a_preview_for_new_measurements(self):
        self.plan(date.today(), date.today() + timedelta(days=30), '2')
        response = self.client.patch(self.url, {'width_m': 2}, format='json')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['code'], 'geometry_preview_required')
        self.assertEqual(response.data['proposed']['area_sqm'], 20.0)
        self.assertIsInstance(response.data['version_id'], int)

    def test_an_unused_area_corrects_the_viewed_interval_directly(self):
        response = self.client.patch(self.url, {'width_m': 1.8}, format='json',
                                     HTTP_X_SEASON_ID=str(self.next_season.pk))
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.bed_at(date(NEXT_YEAR, 6, 1)).area_sqm, Decimal('18.0'))
        self.bed.refresh_from_db()
        self.assertEqual(self.bed.width_m, 1)

    def test_capacity_checks_each_date_slice_against_its_own_size(self):
        self.plan(date(NEXT_YEAR - 1, 12, 1), date(NEXT_YEAR, 3, 1), '9')
        before = calculate_bed_capacity(self.bed, start=date(NEXT_YEAR - 1, 12, 1),
                                        end=date(NEXT_YEAR - 1, 12, 20))
        self.assertEqual(before.free_area_sqm, Decimal('1.0'))
        after = calculate_bed_capacity(self.bed, start=date(NEXT_YEAR, 4, 1),
                                       end=date(NEXT_YEAR, 5, 1))
        self.assertEqual(after.bed_area_sqm, Decimal('15.0'))
        crossing = calculate_bed_capacity(self.bed, start=date(NEXT_YEAR - 1, 12, 25),
                                          end=date(NEXT_YEAR, 1, 10))
        self.assertEqual(crossing.bed_area_sqm, Decimal('10.0'))

    def test_a_later_smaller_size_limits_new_stem_positions(self):
        parcel = Field.objects.create(project=self.project, location=self.location, name='Orchard',
                                      length_m=10, width_m=10)
        Version.objects.create(
            project=self.project, field=parcel, parent_location=self.location,
            effective_from=date(NEXT_YEAR, 1, 1), origin=Version.ORIGIN_PHYSICAL_CHANGE,
            length_m=10, width_m=5, confirmed_area_sqm=Decimal('50.0'),
            measurement_basis=Version.BASIS_DIMENSIONS,
        )
        from farm.planning.individual_planting import positions_fit_parent

        self.assertTrue(positions_fit_parent(parcel, [{'id': 'a', 'x_m': 4, 'y_m': 4}]))
        self.assertFalse(positions_fit_parent(parcel, [{'id': 'a', 'x_m': 7, 'y_m': 4}]))


class MirrorRefreshTest(GeometryChangeTestCase):
    def test_a_change_that_came_into_effect_updates_the_present_row(self):
        earlier = date.today() - timedelta(days=30)
        Version.objects.filter(bed=self.bed).update(effective_from=earlier)
        Version.objects.create(
            project=self.project, bed=self.bed, parent_field=self.field,
            effective_from=date.today(), origin=Version.ORIGIN_PHYSICAL_CHANGE,
            length_m=10, width_m=2, confirmed_area_sqm=Decimal('20.0'),
            measurement_basis=Version.BASIS_DIMENSIONS,
        )
        response = self.client.post('/openfarmplanner/api/locations/', {'name': 'Trigger'},
                                    format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.bed.refresh_from_db()
        self.assertEqual((self.bed.width_m, self.bed.area_sqm), (2, Decimal('20.0')))
        revision = EntityRevision.objects.filter(entity_type='bed', object_id=self.bed.pk).latest(
            'created_at',
        )
        self.assertTrue(revision.snapshot['_project_version_internal'])


class ChildAreaTest(GeometryChangeTestCase):
    def test_used_children_block_and_unused_children_warn(self):
        self.field.length_m, self.field.width_m = 10, 5
        self.field.save()
        version = Version.objects.get(field=self.field)
        body = {'kind': 'field', 'id': self.field.pk, 'action': 'correction',
                'version_id': version.pk, 'length_m': 3, 'width_m': 3}
        unused = self.client.post(PREVIEW_URL, body, format='json')
        self.assertTrue(unused.data['can_confirm'])
        self.assertEqual(unused.data['warnings'][0]['code'], 'geometry_children_exceed_area')
        self.plan(date.today(), date.today() + timedelta(days=20), '1')
        used = self.client.post(PREVIEW_URL, body, format='json')
        self.assertFalse(used.data['can_confirm'])
        self.assertEqual(used.data['conflicts'][0]['code'], 'geometry_children_exceed_area')


class RetirementTest(GeometryChangeTestCase):
    def retire(self, kind='bed', area_id=None, season=None):
        return self.client.post(PREVIEW_URL, {
            'kind': kind, 'id': area_id or self.bed.pk, 'action': 'retirement',
            'season': (season or self.next_season).pk,
        }, format='json')

    def test_a_retired_bed_takes_no_new_plans_but_keeps_its_history(self):
        earlier = self.plan(date(NEXT_YEAR - 1, 3, 1), date(NEXT_YEAR - 1, 6, 1), '5')
        preview = self.retire()
        self.assertTrue(preview.data['can_confirm'], preview.data)
        self.assertEqual(self.confirm(preview).status_code, 200)
        self.assertEqual(self.bed_at(date(NEXT_YEAR, 1, 1)).status, 'retired')
        self.assertEqual(self.bed_at(date(NEXT_YEAR - 1, 12, 31)).status, 'active')
        earlier.refresh_from_db()
        self.assertEqual(earlier.bed_id, self.bed.pk)
        created = self.client.post('/openfarmplanner/api/planting-plans/', {
            'crop': self.crop_.pk, 'bed': self.bed.pk, 'season': self.next_season.pk,
            'planting_date': f'{NEXT_YEAR}-04-01',
        }, format='json')
        self.assertEqual(created.status_code, 400, created.data)
        self.assertIn('bed', created.data)
        edit = self.client.patch(f'/openfarmplanner/api/beds/{self.bed.pk}/', {'width_m': 2},
                                 format='json', HTTP_X_SEASON_ID=str(self.next_season.pk))
        self.assertEqual(edit.status_code, 409)
        self.assertEqual(edit.data['code'], 'geometry_area_retired')

    def test_plans_continuing_into_the_season_block_retirement(self):
        self.plan(date(NEXT_YEAR - 1, 12, 1), date(NEXT_YEAR, 2, 1), '5')
        preview = self.retire()
        self.assertFalse(preview.data['can_confirm'])
        self.assertEqual(preview.data['conflicts'][0]['code'], 'geometry_retirement_plans')

    def test_a_parcel_retires_with_its_beds_and_undo_brings_all_back(self):
        preview = self.retire('field', self.field.pk)
        self.assertTrue(preview.data['can_confirm'], preview.data)
        self.assertEqual(self.confirm(preview).status_code, 200)
        self.assertEqual(self.bed_at(date(NEXT_YEAR, 2, 1)).status, 'retired')
        batch = BatchOperation.objects.get(operation_type=BatchOperation.TYPE_GEOMETRY_CHANGE)
        self.assertEqual(len(batch.context['version_ids']), 2)
        undo = self.client.post(f'/openfarmplanner/api/history/batch/{batch.pk}/revert/')
        self.assertEqual(undo.status_code, 200, undo.data)
        self.assertEqual(self.bed_at(date(NEXT_YEAR, 2, 1)).status, 'active')

    def test_a_later_scheduled_version_blocks_retirement(self):
        self.confirm(self.preview(width_m=1.5))
        earlier = Season.objects.create(
            project=self.project, start_date=date(NEXT_YEAR - 1, 12, 1),
            end_date=date(NEXT_YEAR - 1, 12, 31),
        )
        preview = self.retire(season=earlier)
        self.assertEqual(preview.data['conflicts'][0]['code'], 'geometry_retirement_later_versions')


class DeletionProtectionTest(GeometryChangeTestCase):
    def test_used_areas_answer_with_the_retirement_context(self):
        self.plan(date.today(), date.today() + timedelta(days=20), '1')
        for kind, area in (('bed', self.bed), ('field', self.field), ('location', self.location)):
            with self.subTest(kind=kind):
                response = self.client.delete(
                    f'/openfarmplanner/api/{kind}s/{area.pk}/',
                    HTTP_X_SEASON_ID=str(self.next_season.pk),
                )
                self.assertEqual(response.status_code, 409)
                self.assertEqual(response.data['code'], 'area_in_use')
                self.assertEqual(response.data['season'], self.next_season.pk)
        self.assertTrue(Bed.objects.filter(pk=self.bed.pk).exists())

    def test_an_unused_bed_is_still_deleted(self):
        spare = Bed.objects.create(project=self.project, field=self.field, name='Spare')
        response = self.client.delete(f'/openfarmplanner/api/beds/{spare.pk}/')
        self.assertEqual(response.status_code, 204)

    def test_the_model_never_deletes_plans_with_their_area(self):
        from django.db.models import RestrictedError

        self.plan(date.today(), date.today() + timedelta(days=20), '1')
        with self.assertRaises(RestrictedError):
            Bed.objects.filter(pk=self.bed.pk).delete()
        self.project.delete()
        self.assertFalse(PlantingPlan.objects.filter(project_id=self.project.pk).exists())


class SeasonCopyAvailabilityTest(GeometryChangeTestCase):
    def test_a_copy_onto_a_retired_bed_keeps_no_bed(self):
        from farm.services.seasons import build_planting_plan_copies

        source = Season.objects.create(
            project=self.project, start_date=date(NEXT_YEAR - 1, 1, 1),
            end_date=date(NEXT_YEAR - 1, 12, 31),
        )
        plan = self.plan(date(NEXT_YEAR - 1, 4, 1), date(NEXT_YEAR - 1, 7, 1), '5')
        PlantingPlan.objects.filter(pk=plan.pk).update(season=source)
        self.confirm(self.client.post(PREVIEW_URL, {
            'kind': 'bed', 'id': self.bed.pk, 'action': 'retirement',
            'season': self.next_season.pk,
        }, format='json'))
        pairs, _skipped, _continuing, _unconfigured = build_planting_plan_copies(
            source_season=source, target_season=self.next_season,
        )
        self.assertEqual(len(pairs), 1)
        self.assertIsNone(pairs[0][1].bed)
