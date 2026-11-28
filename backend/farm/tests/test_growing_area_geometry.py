"""Dated growing-area geometry: versions, resolution, timeline upkeep and reads (#1634)."""

from datetime import date, timedelta
from decimal import Decimal

from django.db import connection
from django.db.models import RestrictedError
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from farm.history.project_restore import (
    ProjectRestoreConflict,
    _validate_delete,
    capture_project_state,
    record_project_checkpoint,
    restore_project_version,
)
from farm.models import (
    Bed,
    EntityRevision,
    Field,
    GrowingAreaGeometryVersion,
    Location,
    Project,
    ProjectApiToken,
    Season,
)
from farm.services.growing_area_geometry import (
    STATUS_ACTIVE,
    STATUS_NOT_YET_AVAILABLE,
    STATUS_RETIRED,
    STATUS_UNKNOWN,
    GeometryFacts,
    batched_initial_versions,
    geometry_creation_season,
    geometry_view_date,
    mirror_version,
    reconcile_project_geometry,
    resolve_geometry,
)
from farm.tests.api_base import ProjectApiTestCase

Version = GrowingAreaGeometryVersion
GEOMETRY_URL = '/openfarmplanner/api/growing-area-geometry/'
TIMELINE_URL = '/openfarmplanner/api/growing-area-geometry/timeline/'


def _version(bed: Bed, effective_from: date, **values) -> Version:
    defaults = {
        'project': bed.project, 'bed': bed, 'parent_field': bed.field,
        'effective_from': effective_from, 'origin': Version.ORIGIN_PHYSICAL_CHANGE,
        'measurement_basis': Version.BASIS_DIMENSIONS,
    }
    return Version.objects.create(**{**defaults, **values})


class GeometryFactsTest(TestCase):
    def test_both_sides_derive_the_area_with_the_present_rounding(self):
        facts = GeometryFacts.from_measurements('bed', 3.33, 3, Decimal('10.0'), 7)
        self.assertEqual(facts.area_sqm, Decimal('10.0'))
        self.assertEqual(facts.basis, Version.BASIS_DIMENSIONS)
        site = GeometryFacts.from_measurements('location', 3.333, 3, None, None)
        self.assertEqual(site.area_sqm, Decimal('10.00'))

    def test_declared_area_counts_only_without_both_sides(self):
        facts = GeometryFacts.from_measurements('field', 12, None, Decimal('80.0'), 3)
        self.assertEqual(
            (facts.length_m, facts.width_m, facts.area_sqm, facts.basis),
            (12, None, Decimal('80.0'), Version.BASIS_DECLARED_AREA),
        )

    def test_contradictory_zero_and_non_finite_values_are_unknown(self):
        contradictory = GeometryFacts.from_measurements('bed', 4, 1, Decimal('9.0'), 1)
        self.assertEqual(contradictory.basis, Version.BASIS_UNKNOWN)
        self.assertIsNone(contradictory.area_sqm)
        self.assertIsNone(contradictory.length_m)
        for length in (0, -1, float('nan'), float('inf'), True):
            facts = GeometryFacts.from_measurements('bed', length, 2, None, 1)
            self.assertIsNone(facts.length_m)
            self.assertEqual(facts.basis, Version.BASIS_UNKNOWN)


class GeometryTimelineTestCase(TestCase):
    def setUp(self):
        self.project = Project.objects.create(name='Geometry', slug='geometry')
        self.location = Location.objects.create(project=self.project, name='Hof', length_m=50, width_m=20)
        self.parcel = Field.objects.create(
            project=self.project, location=self.location, name='Nord', length_m=20, width_m=10,
        )
        self.bed = Bed.objects.create(
            project=self.project, field=self.parcel, name='Bed 42', length_m=10, width_m=1,
        )


class InitialVersionTest(GeometryTimelineTestCase):
    def test_an_area_without_a_chosen_season_starts_as_an_undated_observation(self):
        version = Version.objects.get(bed=self.bed)
        self.assertEqual(version.origin, Version.ORIGIN_LEGACY_OBSERVATION)
        self.assertEqual(version.effective_from, date.today())
        self.assertEqual(version.parent_field_id, self.parcel.pk)
        self.assertEqual(version.confirmed_area_sqm, Decimal('10.0'))
        self.assertEqual(Version.objects.get(field=self.parcel).parent_location_id, self.location.pk)

    def test_an_area_created_in_a_selected_season_is_not_available_before_it(self):
        season = Season.objects.create(
            project=self.project, start_date=date(2026, 10, 1), end_date=date(2027, 9, 30),
        )
        with geometry_creation_season(season):
            bed = Bed.objects.create(project=self.project, field=self.parcel, name='New bed')
        version = Version.objects.get(bed=bed)
        self.assertEqual(version.origin, Version.ORIGIN_NEW_AREA)
        self.assertEqual(version.effective_from, date(2026, 10, 1))
        self.assertEqual(version.original_season, season)
        before = resolve_geometry(self.project, date(2026, 9, 30), beds=[bed.pk]).get('bed', bed.pk)
        self.assertEqual(before.status, STATUS_NOT_YET_AVAILABLE)
        self.assertFalse(before.assignable)
        self.assertEqual(before.next_effective_from, date(2026, 10, 1))

    def test_a_foreign_project_season_never_dates_an_area(self):
        other = Project.objects.create(name='Other', slug='other-geometry')
        season = Season.objects.create(
            project=other, start_date=date(2020, 1, 1), end_date=date(2020, 12, 31),
        )
        with geometry_creation_season(season):
            bed = Bed.objects.create(project=self.project, field=self.parcel, name='Scoped bed')
        self.assertEqual(Version.objects.get(bed=bed).origin, Version.ORIGIN_LEGACY_OBSERVATION)

    def test_batched_creation_inserts_all_first_versions_with_one_query(self):
        with batched_initial_versions():
            beds = [
                Bed.objects.create(project=self.project, field=self.parcel, name=f'Batch {index}')
                for index in range(3)
            ]
            self.assertFalse(Version.objects.filter(bed__in=beds).exists())
        self.assertEqual(Version.objects.filter(bed__in=beds).count(), 3)


class SaveSyncTest(GeometryTimelineTestCase):
    def test_names_notes_and_conditions_write_no_version_and_no_query(self):
        bed = Bed.objects.get(pk=self.bed.pk)
        bed.name = 'Renamed'
        bed.notes = 'Mulched'
        bed.light_condition = 'sunny'
        with CaptureQueriesContext(connection) as queries:
            bed.save()
        self.assertFalse(any('geometryversion' in query['sql'] for query in queries))
        self.assertEqual(Version.objects.get(bed=bed).revision, 1)

    def test_changed_measurements_correct_the_mirrored_version(self):
        bed = Bed.objects.get(pk=self.bed.pk)
        bed.width_m = 1.5
        bed.save()
        version = Version.objects.get(bed=bed)
        self.assertEqual(version.confirmed_area_sqm, Decimal('15.0'))
        self.assertEqual(version.revision, 2)
        self.assertEqual(Version.objects.filter(bed=bed).count(), 1)

    def test_moving_a_bed_corrects_the_parent_of_its_interval(self):
        other = Field.objects.create(project=self.project, location=self.location, name='Süd')
        bed = Bed.objects.get(pk=self.bed.pk)
        bed.field = other
        bed.save()
        self.assertEqual(Version.objects.get(bed=bed).parent_field_id, other.pk)

    def test_a_scheduled_later_version_is_left_intact(self):
        later = _version(self.bed, date.today() + timedelta(days=30), length_m=10, width_m=1.8,
                         confirmed_area_sqm=Decimal('18.0'))
        bed = Bed.objects.get(pk=self.bed.pk)
        bed.length_m = 11
        bed.save()
        later.refresh_from_db()
        self.assertEqual(later.confirmed_area_sqm, Decimal('18.0'))
        self.assertEqual(later.revision, 1)
        self.assertEqual(mirror_version('bed', bed.pk).confirmed_area_sqm, Decimal('11.0'))

    def test_update_fields_without_geometry_skip_the_timeline(self):
        bed = Bed.objects.get(pk=self.bed.pk)
        bed.length_m = 99
        bed.notes = 'Only notes are saved'
        bed.save(update_fields=['notes'])
        self.assertEqual(Version.objects.get(bed=bed).length_m, 10)


class ResolverTest(GeometryTimelineTestCase):
    def setUp(self):
        super().setUp()
        self.first = Version.objects.get(bed=self.bed)
        self.first.effective_from = date(2025, 10, 1)
        self.first.save()
        Version.objects.filter(field=self.parcel).update(effective_from=date(2025, 1, 1))
        Version.objects.filter(location=self.location).update(effective_from=date(2025, 1, 1))
        self.resized = _version(self.bed, date(2026, 10, 1), length_m=10, width_m=1.5,
                                confirmed_area_sqm=Decimal('15.0'))

    def _bed(self, as_of: date):
        return resolve_geometry(self.project, as_of, beds=[self.bed.pk]).get('bed', self.bed.pk)

    def test_each_side_of_a_boundary_resolves_its_own_interval(self):
        before = self._bed(date(2026, 9, 30))
        self.assertEqual(before.area_sqm, Decimal('10.0'))
        self.assertEqual(before.version_id, self.first.pk)
        self.assertEqual(before.next_effective_from, date(2026, 10, 1))
        after = self._bed(date(2026, 10, 1))
        self.assertEqual(after.area_sqm, Decimal('15.0'))
        self.assertIsNone(after.next_effective_from)
        self.assertTrue(after.capacity_known)

    def test_an_inserted_version_preserves_a_later_scheduled_one(self):
        later = _version(self.bed, date(2028, 10, 1), length_m=10, width_m=1.8,
                         confirmed_area_sqm=Decimal('18.0'))
        _version(self.bed, date(2027, 10, 1), length_m=10, width_m=1.6,
                 confirmed_area_sqm=Decimal('16.0'))
        self.assertEqual(self._bed(date(2027, 12, 1)).area_sqm, Decimal('16.0'))
        self.assertEqual(self._bed(date(2027, 12, 1)).next_effective_from, date(2028, 10, 1))
        self.assertEqual(self._bed(date(2029, 1, 1)).version_id, later.pk)

    def test_dates_before_the_first_observation_are_unknown_not_zero(self):
        entry = self._bed(date(2024, 5, 1))
        self.assertEqual(entry.status, STATUS_UNKNOWN)
        self.assertIsNone(entry.area_sqm)
        self.assertFalse(entry.capacity_known)
        # Unknown history is no proof of unavailability.
        self.assertTrue(entry.assignable)

    def test_a_retired_parent_makes_its_children_unassignable(self):
        Version.objects.create(
            project=self.project, field=self.parcel, parent_location=self.location,
            effective_from=date(2027, 1, 1), state=Version.STATE_RETIRED,
            origin=Version.ORIGIN_RETIREMENT,
        )
        resolution = resolve_geometry(self.project, date(2027, 2, 1), beds=[self.bed.pk],
                                      fields=[self.parcel.pk])
        self.assertEqual(resolution.get('field', self.parcel.pk).status, STATUS_RETIRED)
        bed = resolution.get('bed', self.bed.pk)
        self.assertEqual(bed.status, STATUS_ACTIVE)
        self.assertFalse(bed.assignable)
        self.assertTrue(self._bed(date(2026, 12, 1)).assignable)

    def test_foreign_ids_are_ignored(self):
        other = Project.objects.create(name='Foreign', slug='foreign-geometry')
        location = Location.objects.create(project=other, name='Foreign site')
        self.assertIsNone(
            resolve_geometry(self.project, date.today(), locations=[location.pk])
            .get('location', location.pk)
        )

    def test_resolution_costs_the_same_queries_for_more_areas(self):
        with CaptureQueriesContext(connection) as few:
            resolve_geometry(self.project, date(2026, 12, 1), beds=[self.bed.pk])
        beds = [
            Bed.objects.create(project=self.project, field=Field.objects.create(
                project=self.project, location=self.location, name=f'Parcel {index}',
            ), name=f'Bed {index}')
            for index in range(5)
        ]
        with CaptureQueriesContext(connection) as many:
            resolve_geometry(self.project, date(2026, 12, 1), beds=[bed.pk for bed in beds])
        self.assertEqual(len(few), len(many))


class ViewDateTest(TestCase):
    def test_current_season_uses_today_and_other_seasons_their_start(self):
        season = Season(start_date=date(2026, 1, 1), end_date=date(2026, 12, 31))
        self.assertEqual(geometry_view_date(season, date(2026, 11, 28)), date(2026, 11, 28))
        self.assertEqual(geometry_view_date(season, date(2027, 3, 1)), date(2026, 1, 1))
        self.assertEqual(geometry_view_date(season, date(2025, 3, 1)), date(2026, 1, 1))
        self.assertEqual(geometry_view_date(None, date(2026, 5, 5)), date(2026, 5, 5))


class RestoreAndDeletionTest(GeometryTimelineTestCase):
    def test_reconciliation_dates_untracked_rows_and_corrects_mirrors(self):
        Version.objects.filter(bed=self.bed).delete()
        Field.objects.filter(pk=self.parcel.pk).update(length_m=30, area_sqm=Decimal('300.0'))
        reconcile_project_geometry(self.project)
        self.assertEqual(Version.objects.get(bed=self.bed).origin, Version.ORIGIN_LEGACY_OBSERVATION)
        parcel = Version.objects.get(field=self.parcel)
        self.assertEqual(parcel.confirmed_area_sqm, Decimal('300.0'))
        self.assertEqual(parcel.revision, 2)

    def test_project_restore_brings_back_matching_geometry(self):
        record_project_checkpoint(self.project, capture_project_state(self.project))
        checkpoint = EntityRevision.objects.filter(project=self.project).latest('created_at')
        bed = Bed.objects.get(pk=self.bed.pk)
        bed.width_m = 2
        bed.save()
        extra = Bed.objects.create(project=self.project, field=self.parcel, name='Later bed')
        EntityRevision.objects.create(
            project=self.project, entity_type='bed', object_id=extra.pk,
            action=EntityRevision.ACTION_CREATED, snapshot={'id': extra.pk},
        )
        restore_project_version(self.project, checkpoint, user_name='tester')
        self.assertFalse(Bed.objects.filter(pk=extra.pk).exists())
        self.assertEqual(Version.objects.get(bed=self.bed).confirmed_area_sqm, Decimal('10.0'))

    def test_only_setup_records_cascade_with_a_removed_area(self):
        _validate_delete(self.project, [self.bed])
        _version(self.bed, date.today() + timedelta(days=10), length_m=12, width_m=1,
                 confirmed_area_sqm=Decimal('12.0'))
        with self.assertRaises(ProjectRestoreConflict):
            _validate_delete(self.project, [self.bed])

    def test_an_old_parent_of_a_moved_bed_cannot_be_deleted(self):
        other = Field.objects.create(project=self.project, location=self.location, name='Neu')
        _version(self.bed, date.today() + timedelta(days=1), parent_field=other)
        with self.assertRaises(RestrictedError):
            other.delete()
        self.location.delete()
        self.assertFalse(Version.objects.filter(project=self.project).exists())


class GeometryApiTest(ProjectApiTestCase):
    def setUp(self):
        super().setUp()
        self.bed.length_m, self.bed.width_m = 10, 1
        self.bed.save()
        Version.objects.filter(project=self.project).update(effective_from=date(2025, 10, 1))
        self.season = Season.objects.create(
            project=self.project, start_date=date(2026, 10, 1), end_date=date(2027, 9, 30),
        )
        self.previous = Season.objects.create(
            project=self.project, start_date=date(2025, 10, 1), end_date=date(2026, 9, 30),
        )
        _version(self.bed, date(2026, 10, 1), length_m=10, width_m=1.5,
                 confirmed_area_sqm=Decimal('15.0'), original_season=self.season)

    def _bed_entry(self, response):
        return next(row for row in response.data['results']
                    if row['kind'] == 'bed' and row['id'] == self.bed.pk)

    def test_season_views_resolve_the_same_bed_differently(self):
        earlier = self.client.get(GEOMETRY_URL, {'season': self.previous.pk, 'kind': 'bed'})
        self.assertEqual(earlier.status_code, 200)
        self.assertEqual(earlier.data['as_of'], date(2025, 10, 1))
        self.assertEqual(self._bed_entry(earlier)['area_sqm'], 10.0)
        later = self.client.get(GEOMETRY_URL, {'date': '2026-10-01', 'kind': 'bed'})
        entry = self._bed_entry(later)
        self.assertEqual(entry['area_sqm'], 15.0)
        self.assertEqual(entry['status'], STATUS_ACTIVE)
        self.assertEqual(entry['parent_id'], self.field.pk)

    def test_the_selected_season_header_sets_the_default_view_date(self):
        response = self.client.get(GEOMETRY_URL, HTTP_X_SEASON_ID=str(self.previous.pk))
        self.assertEqual(response.data['season'], self.previous.pk)
        self.assertEqual(self._bed_entry(response)['area_sqm'], 10.0)

    def test_unknown_entries_can_carry_a_labeled_reference(self):
        response = self.client.get(
            GEOMETRY_URL, {'date': '2020-01-01', 'kind': 'bed', 'include_reference': 'true'},
        )
        entry = self._bed_entry(response)
        self.assertEqual(entry['status'], STATUS_UNKNOWN)
        self.assertIsNone(entry['area_sqm'])
        self.assertEqual(entry['reference']['area_sqm'], 10.0)

    def test_ids_and_pagination_narrow_the_result(self):
        response = self.client.get(
            GEOMETRY_URL, {'kind': 'bed', 'ids': str(self.bed.pk), 'page_size': 1},
        )
        self.assertEqual(response.data['count'], 1)
        all_areas = self.client.get(GEOMETRY_URL, {'page_size': 1})
        self.assertEqual(all_areas.data['count'], 3)
        self.assertEqual(len(all_areas.data['results']), 1)
        self.assertIsNotNone(all_areas.data['next'])

    def test_invalid_parameters_are_rejected(self):
        for params, code in (
            ({'date': '2026-13-01'}, 'invalid_geometry_date'),
            ({'season': '999999'}, 'invalid_geometry_season'),
            ({'kind': 'parcel'}, 'invalid_geometry_kind'),
            ({'ids': '1,2'}, 'invalid_geometry_kind'),
            ({'kind': 'bed', 'ids': 'x'}, 'invalid_geometry_ids'),
        ):
            response = self.client.get(GEOMETRY_URL, params)
            self.assertEqual(response.status_code, 400, params)
            self.assertEqual(response.data['code'], code)

    def test_timeline_lists_versions_in_order(self):
        response = self.client.get(TIMELINE_URL, {'kind': 'bed', 'id': self.bed.pk})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [row['area_sqm'] for row in response.data['versions']], [10.0, 15.0],
        )
        self.assertEqual(response.data['versions'][1]['original_season']['id'], self.season.pk)
        self.assertFalse(response.data['truncated'])

    def test_other_projects_areas_are_not_readable(self):
        other = Project.objects.create(name='Other API', slug='other-api-geometry')
        location = Location.objects.create(project=other, name='Hidden')
        response = self.client.get(TIMELINE_URL, {'kind': 'location', 'id': location.pk})
        self.assertEqual(response.status_code, 404)
        listed = self.client.get(GEOMETRY_URL, {'kind': 'location', 'ids': str(location.pk)})
        self.assertEqual(listed.data['count'], 0)

    def test_api_tokens_cannot_reach_the_unpublished_reads(self):
        _, raw_token = ProjectApiToken.create_token(
            project=self.project, user=self.user, name='reader', scope=ProjectApiToken.SCOPE_READ,
        )
        self.client.force_authenticate(user=None)
        response = self.client.get(GEOMETRY_URL, HTTP_AUTHORIZATION=f'Bearer {raw_token}')
        self.assertEqual(response.status_code, 403)
