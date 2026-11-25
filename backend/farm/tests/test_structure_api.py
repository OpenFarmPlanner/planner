"""API tests for locations, fields, beds, and areas."""


from datetime import date
from unittest import mock

from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework import status
from rest_framework.test import APITestCase as DRFAPITestCase

from farm.models import (
    Bed,
    BedLayout,
    Crop,
    EntityRevision,
    Field,
    FieldLayout,
    Location,
    PlantingPlan,
    Project,
    ProjectMembership,
    Supplier,
)
from farm.structure.serializers import LocationSerializer
from farm.tests.api_base import ProjectApiTestCase, User


class TenantScopeApiTest(ProjectApiTestCase):
    """The active project's records must not be reassignable to other projects."""

    def test_update_cannot_move_location_to_foreign_project(self):
        foreign_project = Project.objects.create(name='Foreign', slug='foreign-scope-proj')
        self.client.patch(
            f'/openfarmplanner/api/locations/{self.location.id}/',
            {'project': foreign_project.id},
            format='json',
        )
        self.location.refresh_from_db()
        self.assertNotEqual(self.location.project_id, foreign_project.id)
        self.assertEqual(self.location.project_id, self.project.id)

    def test_update_cannot_move_field_to_foreign_project(self):
        foreign_project = Project.objects.create(name='Foreign2', slug='foreign-scope-proj-2')
        self.client.patch(
            f'/openfarmplanner/api/fields/{self.field.id}/',
            {'project': foreign_project.id},
            format='json',
        )
        self.field.refresh_from_db()
        self.assertEqual(self.field.project_id, self.project.id)

    def test_update_cannot_move_bed_to_foreign_project(self):
        foreign_project = Project.objects.create(name='Foreign3', slug='foreign-scope-proj-3')
        self.client.patch(
            f'/openfarmplanner/api/beds/{self.bed.id}/',
            {'project': foreign_project.id},
            format='json',
        )
        self.bed.refresh_from_db()
        self.assertEqual(self.bed.project_id, self.project.id)

    def test_update_cannot_move_crop_to_foreign_project(self):
        foreign_project = Project.objects.create(name='Foreign4', slug='foreign-scope-proj-4')
        self.client.patch(
            f'/openfarmplanner/api/crops/{self.crop.id}/',
            {'project': foreign_project.id},
            format='json',
        )
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.project_id, self.project.id)


class StructureApiTest(ProjectApiTestCase):
    def test_path_spacing_defaults_and_changes_do_not_modify_layout_or_measurements(self):
        url = f'/openfarmplanner/api/locations/{self.location.id}/'
        layouts_url = f'{url}layouts/'
        self.location.length_m = 40
        self.location.width_m = 25
        self.location.save(update_fields=['length_m', 'width_m'])
        FieldLayout.objects.create(
            field=self.field, location=self.location, project=self.project, x=12, y=20,
        )
        BedLayout.objects.create(
            bed=self.bed, location=self.location, project=self.project, x=3, y=5,
        )
        before = self.client.get(layouts_url).data
        defaults = {
            'bed_path_spacing_cm': 30,
            'parcel_path_spacing_cm': 75,
            'snap_to_path_spacing': True,
        }
        initial = self.client.get(url).data
        self.assertEqual({key: initial[key] for key in defaults}, defaults)
        self.assertNotIn('bed_path_spacing_m', initial)
        self.assertNotIn('parcel_path_spacing_m', initial)

        settings = {
            'bed_path_spacing_cm': 0,
            'parcel_path_spacing_cm': 62.5,
            'snap_to_path_spacing': False,
        }
        response = self.client.patch(url, settings, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        read = self.client.get(url).data
        self.assertEqual({key: read[key] for key in settings}, settings)
        self.assertEqual((read['length_m'], read['width_m'], read['area_sqm']), (40, 25, 1000))
        self.assertEqual(self.client.get(layouts_url).data, before)
        self.location.refresh_from_db()
        self.assertEqual(self.location.bed_path_spacing_m, 0)
        self.assertEqual(self.location.parcel_path_spacing_m, 0.625)

        reset = self.client.patch(url, defaults, format='json')
        self.assertEqual(reset.status_code, status.HTTP_200_OK, reset.data)
        self.assertEqual({key: reset.data[key] for key in defaults}, defaults)

    def test_path_spacing_rejects_invalid_gaps_and_foreign_location_writes(self):
        url = f'/openfarmplanner/api/locations/{self.location.id}/'
        for field in ('bed_path_spacing_cm', 'parcel_path_spacing_cm'):
            for invalid in (-1, None, True, 'nan', 'inf', 'unknown'):
                with self.subTest(field=field, invalid=invalid):
                    response = self.client.patch(url, {field: invalid}, format='json')
                    self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
                    self.assertIn(field, response.data)

        foreign_project = Project.objects.create(name='Foreign site', slug='foreign-spacing-site')
        foreign = Location.objects.create(name='Foreign location', project=foreign_project)
        response = self.client.patch(
            f'/openfarmplanner/api/locations/{foreign.id}/',
            {'bed_path_spacing_cm': 10}, format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        foreign.refresh_from_db()
        self.assertEqual(foreign.bed_path_spacing_m, 0.30)

    def test_spacing_patch_returns_a_boundary_saved_after_the_location_was_read(self):
        Location.objects.filter(pk=self.location.pk).update(boundary_x=20, boundary_y=40)
        serializer = LocationSerializer(
            self.location, data={'bed_path_spacing_cm': 45}, partial=True,
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()

        self.assertEqual((serializer.data['boundary_x'], serializer.data['boundary_y']), (20, 40))
        self.assertEqual(serializer.data['bed_path_spacing_cm'], 45)
        self.location.refresh_from_db()
        self.assertEqual((self.location.boundary_x, self.location.boundary_y), (20, 40))
        self.assertEqual(self.location.bed_path_spacing_m, 0.45)

    def test_location_create_and_update_with_agronomic_fields(self):
        create_response = self.client.post(
            '/openfarmplanner/api/locations/',
            {
                'name': 'Südfläche',
                'address': 'Dorfstraße 1',
                'description': 'Acker hinter Hof',
                'soil_type': 'loam',
                'exposure': 'south',
                'latitude': 48.1234,
                'longitude': 16.4321,
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(create_response.data['soil_type'], 'loam')
        self.assertEqual(create_response.data['exposure'], 'south')

        location_id = create_response.data['id']
        update_response = self.client.patch(
            f'/openfarmplanner/api/locations/{location_id}/',
            {'soil_type': None, 'exposure': None, 'description': ''},
            format='json',
        )
        self.assertEqual(update_response.status_code, status.HTTP_200_OK)
        self.assertIsNone(update_response.data['soil_type'])
        self.assertIsNone(update_response.data['exposure'])

    def test_location_dimensions_persist_validate_clear_and_give_gross_area(self):
        """#1190: optional outer dimensions in metres; area is length × width."""
        url = f'/openfarmplanner/api/locations/{self.location.id}/'
        response = self.client.patch(url, {'length_m': 42.5, 'width_m': '18,4'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        response = self.client.patch(url, {'length_m': 42.5, 'width_m': 18.4}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data['length_m'], 42.5)
        self.assertEqual(response.data['width_m'], 18.4)
        self.assertEqual(response.data['area_sqm'], 782.0)

        for invalid in (0, -3, 'nan', 'inf', 1e308, 200000):
            with self.subTest(length=invalid):
                response = self.client.patch(url, {'length_m': invalid}, format='json')
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
                self.assertIn('length_m', response.data)
        self.location.refresh_from_db()
        self.assertEqual(self.location.length_m, 42.5)

        response = self.client.patch(url, {'width_m': None}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data['width_m'])
        self.assertIsNone(response.data['area_sqm'])
        listed = self.client.get('/openfarmplanner/api/locations/').data
        rows = listed['results'] if isinstance(listed, dict) else listed
        row = next(item for item in rows if item['id'] == self.location.id)
        self.assertEqual((row['length_m'], row['width_m'], row['area_sqm']), (42.5, None, None))

    def test_field_update_with_length_and_width_overwrites_area(self):
        response = self.client.put(
            f'/openfarmplanner/api/fields/{self.field.id}/',
            {
                'name': self.field.name,
                'location': self.location.id,
                'area_sqm': 200.0,
                'length_m': 30.0,
                'width_m': 4.0,
                'notes': '',
                'project': self.project.id,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.field.refresh_from_db()
        self.assertEqual(float(self.field.area_sqm), 120.0)
        self.assertEqual(self.field.length_m, 30.0)
        self.assertEqual(self.field.width_m, 4.0)

    def test_field_update_with_single_dimension_keeps_area(self):
        response = self.client.put(
            f'/openfarmplanner/api/fields/{self.field.id}/',
            {
                'name': self.field.name,
                'location': self.location.id,
                'area_sqm': 200.0,
                'length_m': 25.0,
                'width_m': None,
                'notes': '',
                'project': self.project.id,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.field.refresh_from_db()
        self.assertEqual(float(self.field.area_sqm), 200.0)
        self.assertEqual(self.field.length_m, 25.0)
        self.assertIsNone(self.field.width_m)

    def test_field_create_rejects_location_from_other_project(self):
        other_project = Project.objects.create(name='Other project', slug='other-project')
        foreign_location = Location.objects.create(name='Foreign location', project=other_project)

        response = self.client.post(
            '/openfarmplanner/api/fields/',
            {
                'name': 'Cross-project field',
                'location': foreign_location.id,
                'area_sqm': 10.0,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('location', response.data)

    def test_bed_update_with_length_and_width_overwrites_area(self):
        response = self.client.put(
            f'/openfarmplanner/api/beds/{self.bed.id}/',
            {
                'name': self.bed.name,
                'field': self.field.id,
                'area_sqm': 20.0,
                'length_m': 5.0,
                'width_m': 3.0,
                'notes': '',
                'project': self.project.id,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.bed.refresh_from_db()
        self.assertEqual(float(self.bed.area_sqm), 15.0)
        self.assertEqual(self.bed.length_m, 5.0)
        self.assertEqual(self.bed.width_m, 3.0)

    def test_bed_update_with_single_dimension_keeps_area(self):
        response = self.client.put(
            f'/openfarmplanner/api/beds/{self.bed.id}/',
            {
                'name': self.bed.name,
                'field': self.field.id,
                'area_sqm': 20.0,
                'length_m': 7.0,
                'width_m': None,
                'notes': '',
                'project': self.project.id,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.bed.refresh_from_db()
        self.assertEqual(float(self.bed.area_sqm), 20.0)
        self.assertEqual(self.bed.length_m, 7.0)
        self.assertIsNone(self.bed.width_m)

    def test_bed_list(self):
        response = self.client.get('/openfarmplanner/api/beds/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 1)

    def test_field_create_with_valid_area(self):
        data = {
            'name': 'Valid Field',
            'location': self.location.id,
            'area_sqm': 500.50,
            'project': self.project.id,
        }
        response = self.client.post('/openfarmplanner/api/fields/', data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Field.objects.count(), 2)

    def test_field_create_with_invalid_area_too_small(self):
        data = {
            'name': 'Too Small Field',
            'location': self.location.id,
            'area_sqm': 0.001,
            'project': self.project.id,
        }
        response = self.client.post('/openfarmplanner/api/fields/', data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('area_sqm', response.data)

    def test_field_create_with_invalid_area_too_large(self):
        data = {
            'name': 'Too Large Field',
            'location': self.location.id,
            'area_sqm': 2000000,  # Greater than MAX_AREA_SQM (1,000,000)
            'project': self.project.id,
        }
        response = self.client.post('/openfarmplanner/api/fields/', data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('area_sqm', response.data)

    def test_bed_create_with_valid_area(self):
        data = {
            'name': 'Valid Bed',
            'field': self.field.id,
            'area_sqm': 50.2,
            'project': self.project.id,
        }
        response = self.client.post('/openfarmplanner/api/beds/', data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Bed.objects.count(), 2)

    def test_bed_create_with_invalid_area_too_small(self):
        data = {
            'name': 'Too Small Bed',
            'field': self.field.id,
            'area_sqm': 0.001,
            'project': self.project.id,
        }
        response = self.client.post('/openfarmplanner/api/beds/', data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('area_sqm', response.data)

    def test_bed_create_with_invalid_area_too_large(self):
        data = {
            'name': 'Too Large Bed',
            'field': self.field.id,
            'area_sqm': 20000,
            'project': self.project.id,
        }
        response = self.client.post('/openfarmplanner/api/beds/', data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('area_sqm', response.data)


class BedBulkCreateApiTest(ProjectApiTestCase):
    """POST /beds/bulk-create/ creates a whole series of beds atomically."""

    url = '/openfarmplanner/api/beds/bulk-create/'
    undo_url = '/openfarmplanner/api/beds/undo-bulk-create/'

    def _payload(self, names: list[str], **overrides) -> dict:
        payload = {
            'field': self.field.id,
            'beds': [{'name': name, 'length_m': 10, 'width_m': 1.2} for name in names],
        }
        payload.update(overrides)
        return payload

    def test_creates_all_beds_with_area_from_dimensions(self):
        response = self.client.post(self.url, self._payload(['E 1', 'E 2', 'E 3']), format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual([bed['name'] for bed in response.data], ['E 1', 'E 2', 'E 3'])
        self.assertEqual(response.data[0]['field_name'], self.field.name)
        created = Bed.objects.filter(field=self.field, name__startswith='E ')
        self.assertEqual(created.count(), 3)
        for bed in created:
            self.assertEqual(bed.project_id, self.project.id)
            self.assertEqual(float(bed.area_sqm), 12.0)

    def test_records_one_created_revision_per_bed(self):
        response = self.client.post(self.url, self._payload(['E 1', 'E 2']), format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        created_ids = [bed['id'] for bed in response.data]
        revisions = EntityRevision.objects.filter(
            project=self.project, entity_type='bed', object_id__in=created_ids,
            action=EntityRevision.ACTION_CREATED,
        )
        self.assertEqual(revisions.count(), 2)

    def _positioned_payload(self, count=2):
        payload = self._payload([f'Batch {index:03}' for index in range(count)])
        for index, entry in enumerate(payload['beds']):
            entry['layout'] = {'x': index * 25.2, 'y': 10, 'runs_across_parcel': True}
        return payload

    def test_persists_positioned_batch_and_undoes_it_together(self):
        BedLayout.objects.create(bed=self.bed, location=self.location, project=self.project, x=12)
        batch = self.client.post(self.url, self._positioned_payload(50), format='json')
        self.assertEqual(batch.status_code, status.HTTP_201_CREATED, batch.data)
        ids = [entry['id'] for entry in batch.data]
        positioned = BedLayout.objects.filter(bed_id__in=ids).order_by('x')
        self.assertEqual(positioned.count(), 50)
        self.assertEqual((positioned[1].x, positioned[1].y), (25.2, 10))
        self.assertTrue(positioned[1].runs_across_parcel)
        self.assertEqual(positioned[1].location_id, self.location.id)
        self.assertEqual(positioned[1].project_id, self.project.id)
        self.assertEqual((positioned[1].bed.length_m, positioned[1].bed.width_m), (10, 1.2))
        token = batch['X-Bulk-Bed-Undo']
        for _ in range(2):
            undone = self.client.post(self.undo_url, {'token': token}, format='json')
            self.assertEqual(undone.status_code, status.HTTP_204_NO_CONTENT, undone.data)
        self.assertFalse(positioned.exists())
        self.assertFalse(Bed.objects.filter(pk__in=ids).exists())
        self.assertEqual(BedLayout.objects.get(bed=self.bed).x, 12)

    def test_undo_rejects_forged_token_other_project_and_planting_references(self):
        batch = self.client.post(self.url, self._positioned_payload(), format='json')
        self.assertEqual(batch.status_code, status.HTTP_201_CREATED, batch.data)
        ids = [entry['id'] for entry in batch.data]
        token = batch['X-Bulk-Bed-Undo']
        forged = self.client.post(self.undo_url, {'token': 'forged'}, format='json')
        self.assertEqual(forged.status_code, status.HTTP_400_BAD_REQUEST)
        other = Project.objects.create(name='Other bulk', slug='other-bulk')
        ProjectMembership.objects.create(project=other, user=self.user, role='admin')
        foreign = self.client.post(
            self.undo_url, {'token': token}, format='json', HTTP_X_PROJECT_ID=other.pk,
        )
        self.assertEqual(foreign.status_code, status.HTTP_400_BAD_REQUEST)
        plan = PlantingPlan.objects.create(
            crop=self.crop, bed_id=ids[-1], planting_date=date(2026, 4, 1), project=self.project,
        )
        conflict = self.client.post(self.undo_url, {'token': token}, format='json')
        self.assertEqual(conflict.status_code, status.HTTP_409_CONFLICT, conflict.data)
        self.assertEqual(Bed.objects.filter(pk__in=ids).count(), 2)
        self.assertEqual(BedLayout.objects.filter(bed_id__in=ids).count(), 2)
        self.assertTrue(PlantingPlan.objects.filter(pk=plan.pk).exists())

    def test_invalid_layout_rejects_whole_batch(self):
        for invalid in (-1, 'NaN', 'Infinity'):
            with self.subTest(invalid=invalid):
                payload = self._positioned_payload()
                payload['beds'][1]['layout']['x'] = invalid
                response = self.client.post(self.url, payload, format='json')
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        payload = self._positioned_payload()
        del payload['beds'][1]['layout']
        self.assertEqual(self.client.post(self.url, payload, format='json').status_code, 400)
        self.assertFalse(Bed.objects.filter(name__startswith='Batch ').exists())

    def test_position_save_failure_rolls_back_all_beds_and_revisions(self):
        from django.db import IntegrityError

        original_create = BedLayout.objects.create
        def create_layout(**kwargs):
            if kwargs['bed'].name.endswith('001'):
                raise IntegrityError('Unable to save second layout')
            return original_create(**kwargs)

        with mock.patch(
            'farm.services.bed_layouts.BedLayout.objects.create', side_effect=create_layout,
        ):
            response = self.client.post(self.url, self._positioned_payload(), format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Bed.objects.filter(name__startswith='Batch ').exists())
        self.assertFalse(BedLayout.objects.filter(project=self.project).exists())
        self.assertFalse(EntityRevision.objects.filter(
            entity_type='bed_layout', project=self.project,
        ).exists())

    def test_existing_name_rejects_the_whole_series(self):
        payload = self._payload(['E 1', self.bed.name])
        response = self.client.post(self.url, payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['taken_names'], [self.bed.name])
        self.assertFalse(Bed.objects.filter(name='E 1').exists())

    def test_duplicate_names_in_payload_are_rejected(self):
        response = self.client.post(self.url, self._payload(['E 1', 'E 1']), format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Bed.objects.filter(name='E 1').exists())

    def test_dimensions_are_required_and_positive(self):
        payload = self._payload(['E 1'])
        payload['beds'][0]['width_m'] = 0
        response = self.client.post(self.url, payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        payload = {'field': self.field.id, 'beds': [{'name': 'E 1', 'length_m': 10}]}
        response = self.client.post(self.url, payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(Bed.objects.filter(name='E 1').exists())

    def test_invalid_bed_errors_preserve_input_positions(self) -> None:
        payload = self._payload(['E 1', 'E 2'])
        payload['beds'][1]['length_m'] = -1

        response = self.client.post(self.url, payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        errors = response.json()['beds']
        self.assertIsInstance(errors, list)
        self.assertEqual(len(errors), 2)
        self.assertEqual(errors[0], {})
        self.assertIn('length_m', errors[1])
        self.assertFalse(Bed.objects.filter(name__in=['E 1', 'E 2']).exists())

    def test_rejects_empty_and_oversized_series(self):
        self.assertEqual(
            self.client.post(self.url, self._payload([]), format='json').status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        names = [f'E {index}' for index in range(201)]
        self.assertEqual(
            self.client.post(self.url, self._payload(names), format='json').status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertFalse(Bed.objects.filter(name='E 1').exists())

    def test_rejects_field_from_another_project(self):
        foreign_project = Project.objects.create(name='Foreign bulk', slug='foreign-bulk-proj')
        foreign_location = Location.objects.create(name='Foreign', project=foreign_project)
        foreign_field = Field.objects.create(
            name='Foreign field', location=foreign_location, project=foreign_project
        )

        payload = self._payload(['E 1'], field=foreign_field.id)
        response = self.client.post(self.url, payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        # Same answer as for a field id that does not exist at all.
        missing = self.client.post(self.url, self._payload(['E 1'], field=999999), format='json')
        self.assertEqual(response.data['field'][0].code, 'does_not_exist')
        self.assertEqual(missing.data['field'][0].code, 'does_not_exist')
        self.assertFalse(Bed.objects.filter(field=foreign_field).exists())

    def test_query_count_does_not_depend_on_lookups_per_bed(self):
        from farm.history.project_restore import (
            capture_project_state,
            ensure_project_checkpoint,
            record_project_checkpoint,
        )

        ensure_project_checkpoint(self.project)
        # Validation reads the field and the taken names once for the whole
        # series; per bed there is only the insert, the revision snapshot
        # read and the revision insert (the same as a single create).
        with CaptureQueriesContext(connection) as small:
            self.client.post(self.url, self._payload(['S 1', 'S 2']), format='json')
        # Use the same starting history state for both guard preflights.
        record_project_checkpoint(self.project, capture_project_state(self.project))
        with CaptureQueriesContext(connection) as large:
            self.client.post(self.url, self._payload(['L 1', 'L 2', 'L 3', 'L 4']), format='json')

        per_bed = (len(large.captured_queries) - len(small.captured_queries)) / 2
        self.assertEqual(per_bed, 3)


class FieldDuplicateApiTest(ProjectApiTestCase):
    """POST /fields/{id}/duplicate/ copies a field and its beds atomically."""

    def setUp(self):
        super().setUp()
        self.field.length_m = 20
        self.field.width_m = 10
        self.field.notes = 'Field notes'
        self.field.save()
        self.bed.notes = 'Bed notes'
        self.bed.name = 'Nord 1'
        self.bed.length_m = 20
        self.bed.width_m = 1.2
        self.bed.save()
        Bed.objects.create(
            name='Nord 2', field=self.field, length_m=20, width_m=0.8, project=self.project,
        )
        PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, planting_date=date(2026, 4, 1), project=self.project,
        )
        FieldLayout.objects.create(
            field=self.field, location=self.location, project=self.project, x=1, y=2,
        )

    def _url(self, field_id: int | None = None) -> str:
        return f'/openfarmplanner/api/fields/{field_id or self.field.id}/duplicate/'

    def test_copies_field_and_beds_without_notes_plans_or_layout(self):
        response = self.client.post(self._url(), {'name': 'Kopie'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        new_field = Field.objects.get(pk=response.data['field']['id'])
        self.assertEqual(new_field.name, 'Kopie')
        self.assertEqual(new_field.location_id, self.location.id)
        self.assertEqual(new_field.project_id, self.project.id)
        self.assertEqual((new_field.length_m, new_field.width_m), (20, 10))
        self.assertEqual(float(new_field.area_sqm), 200.0)
        self.assertEqual(new_field.notes, '')
        self.assertFalse(FieldLayout.objects.filter(field=new_field).exists())

        self.assertEqual([bed['name'] for bed in response.data['beds']], ['Nord 1', 'Nord 2'])
        new_beds = Bed.objects.filter(field=new_field).order_by('name')
        self.assertEqual([(bed.length_m, bed.width_m) for bed in new_beds], [(20, 1.2), (20, 0.8)])
        for bed in new_beds:
            self.assertEqual((bed.notes, bed.project_id), ('', self.project.id))
        self.assertFalse(PlantingPlan.objects.filter(bed__field=new_field).exists())
        # The source is untouched.
        self.assertEqual(Bed.objects.filter(field=self.field).count(), 2)
        self.assertEqual(PlantingPlan.objects.filter(bed__field=self.field).count(), 1)

    def test_records_created_revisions(self):
        response = self.client.post(self._url(), {'name': 'Kopie'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        created = EntityRevision.objects.filter(
            project=self.project, action=EntityRevision.ACTION_CREATED,
        )
        field_id = response.data['field']['id']
        bed_ids = [bed['id'] for bed in response.data['beds']]
        self.assertTrue(created.filter(entity_type='field', object_id=field_id).exists())
        self.assertEqual(created.filter(entity_type='bed', object_id__in=bed_ids).count(), 2)

    def test_without_beds(self):
        payload = {'name': 'Leer', 'copy_beds': False}
        response = self.client.post(self._url(), payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['beds'], [])
        self.assertFalse(Bed.objects.filter(field_id=response.data['field']['id']).exists())

    def test_replaces_first_case_sensitive_occurrence_in_bed_names(self):
        payload = {'name': 'Süd', 'replace_search': 'Nord', 'replace_with': 'Süd'}
        response = self.client.post(self._url(), payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual([bed['name'] for bed in response.data['beds']], ['Süd 1', 'Süd 2'])

        additional_bed = self.client.post('/openfarmplanner/api/beds/', {
            'name': 'nord Nord Nord', 'field': self.field.pk,
        }, format='json')
        self.assertEqual(additional_bed.status_code, status.HTTP_201_CREATED)
        payload = {'name': 'Süd 2', 'replace_search': 'Nord', 'replace_with': 'X'}
        response = self.client.post(self._url(), payload, format='json')
        self.assertIn('nord X Nord', [bed['name'] for bed in response.data['beds']])

    def test_taken_field_name_is_409_and_creates_nothing(self):
        Field.objects.create(name='Belegt', location=self.location, project=self.project)
        fields_before = Field.objects.count()

        response = self.client.post(self._url(), {'name': 'Belegt'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['code'], 'field_name_taken')
        self.assertEqual(Field.objects.count(), fields_before)

    def test_bed_names_merged_by_the_replacement_are_409_and_roll_back(self):
        beds_before = Bed.objects.count()
        fields_before = Field.objects.count()
        payload = {'name': 'Kopie', 'replace_search': ' 2', 'replace_with': ' 1'}

        response = self.client.post(self._url(), payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['code'], 'bed_names_conflict')
        self.assertEqual(response.data['names'], ['Nord 1'])
        self.assertEqual(Field.objects.count(), fields_before)
        self.assertEqual(Bed.objects.count(), beds_before)

    def test_empty_bed_name_after_replacement_is_rejected(self):
        payload = {'name': 'Kopie', 'replace_search': 'Nord 1', 'replace_with': ''}

        response = self.client.post(self._url(), payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['names'], ['Nord 1'])
        self.assertFalse(Field.objects.filter(name='Kopie').exists())

    def test_rolls_back_the_field_when_a_bed_insert_fails(self):
        fields_before = Field.objects.count()
        original_create = Bed.objects.create
        calls = {'count': 0}

        def failing_create(**kwargs):
            calls['count'] += 1
            if calls['count'] == 2:
                raise RuntimeError('simulated')
            return original_create(**kwargs)

        with mock.patch.object(Bed.objects, 'create', side_effect=failing_create):
            with self.assertRaises(RuntimeError):
                self.client.post(self._url(), {'name': 'Kopie'}, format='json')

        self.assertEqual(Field.objects.count(), fields_before)
        self.assertFalse(Bed.objects.filter(field__name='Kopie').exists())

    def test_field_of_another_project_is_not_found(self):
        foreign_project = Project.objects.create(name='Foreign dup', slug='foreign-dup-proj')
        foreign_location = Location.objects.create(name='Foreign', project=foreign_project)
        foreign_field = Field.objects.create(
            name='Fremd', location=foreign_location, project=foreign_project,
        )

        response = self.client.post(self._url(foreign_field.id), {'name': 'Kopie'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertFalse(Field.objects.filter(name='Kopie').exists())

    def test_name_is_required(self):
        response = self.client.post(self._url(), {'name': '  '}, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_query_count_does_not_grow_with_lookups_per_bed(self):
        from farm.history.project_restore import (
            capture_project_state,
            ensure_project_checkpoint,
            record_project_checkpoint,
        )

        # Per copied bed there is only the insert, the revision snapshot read
        # and the revision insert, the same as in the bulk create.
        small_field = Field.objects.create(
            name='Klein', location=self.location, project=self.project,
        )
        large_field = Field.objects.create(
            name='Groß', location=self.location, project=self.project,
        )
        for index in range(2):
            Bed.objects.create(name=f'K {index}', field=small_field, project=self.project)
        for index in range(4):
            Bed.objects.create(name=f'G {index}', field=large_field, project=self.project)

        ensure_project_checkpoint(self.project)
        with CaptureQueriesContext(connection) as small:
            self.client.post(self._url(small_field.id), {'name': 'Klein 2'}, format='json')
        record_project_checkpoint(self.project, capture_project_state(self.project))
        with CaptureQueriesContext(connection) as large:
            self.client.post(self._url(large_field.id), {'name': 'Groß 2'}, format='json')

        per_bed = (len(large.captured_queries) - len(small.captured_queries)) / 2
        self.assertEqual(per_bed, 3)


class CropLayoutApiTest(DRFAPITestCase):
    """Tests for the bed/field layout endpoint on locations."""

    def setUp(self):
        self.user = User.objects.create_user(username='layoutuser', email='layoutuser@example.com', password='testpass', is_active=True)
        self.project = Project.objects.create(name='Layout Project', slug='layout-project')
        ProjectMembership.objects.create(user=self.user, project=self.project, role='admin')
        self.client.force_authenticate(user=self.user)
        self.client.defaults['HTTP_X_PROJECT_ID'] = str(self.project.id)
        self.supplier = Supplier.objects.create(name='Default Supplier', homepage_url='https://supplier.example', project=self.project)
        self.crop = Crop.objects.create(name='Tomate', variety='Roma', supplier=self.supplier, supplier_product_url='https://supplier.example/tomate', project=self.project)

    def test_layouts_get_and_put(self):
        location = Location.objects.create(name='Layout test location', project=self.project)
        field = Field.objects.create(name='Layout test field', location=location, project=self.project)
        bed = Bed.objects.create(name='Layout test bed', field=field, area_sqm=5, project=self.project)

        payload = {
            'bed_layouts': [
                {'bed': bed.id, 'location': location.id, 'x': 33.5, 'y': 44.5, 'version': 1},
            ],
            'field_layouts': [
                {'field': field.id, 'location': location.id, 'x': 66.0, 'y': 88.0, 'version': 1},
            ],
        }
        put_response = self.client.put(
            f'/openfarmplanner/api/locations/{location.id}/layouts/',
            payload,
            format='json',
        )
        self.assertEqual(put_response.status_code, status.HTTP_200_OK)
        self.assertEqual(put_response.data['bed_layouts'][0]['bed'], bed.id)
        self.assertEqual(put_response.data['field_layouts'][0]['field'], field.id)

        get_response = self.client.get(f'/openfarmplanner/api/locations/{location.id}/layouts/')
        self.assertEqual(get_response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(get_response.data['bed_layouts']), 1)
        self.assertEqual(get_response.data['bed_layouts'][0]['x'], 33.5)
        self.assertEqual(len(get_response.data['field_layouts']), 1)
        self.assertEqual(get_response.data['field_layouts'][0]['x'], 66.0)

    def test_bed_offsets_follow_a_parcel_to_its_current_location(self):
        first = Location.objects.create(name='Old location', project=self.project)
        second = Location.objects.create(name='New location', project=self.project)
        field = Field.objects.create(name='Moving parcel', location=first, project=self.project)
        bed = Bed.objects.create(name='Positioned bed', field=field, area_sqm=6, project=self.project)
        layout = BedLayout.objects.create(
            bed=bed, location=first, project=self.project, x=144, y=12,
            version=2, runs_across_parcel=True,
        )
        FieldLayout.objects.create(field=field, location=first, project=self.project, x=30, y=40)

        move = self.client.patch(
            f'/openfarmplanner/api/fields/{field.id}/', {'location': second.id}, format='json',
        )
        self.assertEqual(move.status_code, status.HTTP_200_OK)
        old_layouts = self.client.get(f'/openfarmplanner/api/locations/{first.id}/layouts/')
        current_layouts = self.client.get(f'/openfarmplanner/api/locations/{second.id}/layouts/')
        self.assertEqual(old_layouts.status_code, status.HTTP_200_OK)
        self.assertEqual(current_layouts.status_code, status.HTTP_200_OK)
        self.assertEqual(old_layouts.data['bed_layouts'], [])
        self.assertEqual(current_layouts.data['field_layouts'], [])
        self.assertEqual(len(current_layouts.data['bed_layouts']), 1)
        saved = current_layouts.data['bed_layouts'][0]
        expected = {
            'bed': bed.id, 'location': second.id, 'x': 144.0, 'y': 12.0,
            'version': 2, 'runs_across_parcel': True,
        }
        self.assertEqual({key: saved[key] for key in expected}, expected)
        layout.refresh_from_db()
        self.assertEqual(layout.location_id, first.id)

    def test_layouts_reject_bed_from_other_location(self):
        location = Location.objects.create(name='Layout test source location', project=self.project)
        other_location = Location.objects.create(name='Secondary location', project=self.project)
        other_field = Field.objects.create(name='Secondary field', location=other_location, project=self.project)
        other_bed = Bed.objects.create(name='Secondary bed', field=other_field, area_sqm=5, project=self.project)

        response = self.client.put(
            f'/openfarmplanner/api/locations/{location.id}/layouts/',
            {'bed_layouts': [{'bed': other_bed.id, 'location': location.id, 'x': 1, 'y': 1}], 'field_layouts': []},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['code'], 'invalid_location_layout')
        self.assertIn('does not belong to location', response.data['detail'])
        self.assertFalse(BedLayout.objects.filter(bed=other_bed).exists())

    def test_layouts_reject_field_from_other_location(self):
        location = Location.objects.create(name='Layout test source location', project=self.project)
        other_location = Location.objects.create(name='Secondary location', project=self.project)
        other_field = Field.objects.create(name='Secondary field', location=other_location, project=self.project)

        response = self.client.put(
            f'/openfarmplanner/api/locations/{location.id}/layouts/',
            {'bed_layouts': [], 'field_layouts': [{'field': other_field.id, 'location': location.id, 'x': 1, 'y': 1}]},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['code'], 'invalid_location_layout')
        self.assertIn('does not belong to location', response.data['detail'])
        self.assertFalse(FieldLayout.objects.filter(field=other_field).exists())

    def test_layouts_reject_non_list_collections_with_structured_error(self):
        location = Location.objects.create(name='Layout collection test', project=self.project)

        response = self.client.put(
            f'/openfarmplanner/api/locations/{location.id}/layouts/',
            {'bed_layouts': {}, 'field_layouts': []},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['code'], 'invalid_layout_collections')

    def _location_with_bed(self, name: str) -> tuple[Location, Field, Bed]:
        location = Location.objects.create(name=name, project=self.project)
        field = Field.objects.create(name=f'{name} field', location=location, project=self.project)
        bed = Bed.objects.create(name=f'{name} bed', field=field, area_sqm=5, project=self.project)
        return location, field, bed

    def _put_layouts(self, location: Location, payload):
        return self.client.put(
            f'/openfarmplanner/api/locations/{location.id}/layouts/',
            payload,
            format='json',
        )

    def test_layouts_reject_bed_from_another_project(self):
        """A layout must not be able to reach a bed the active project does not own."""
        location, _, _ = self._location_with_bed('Own location')
        foreign = Project.objects.create(name='Foreign layout', slug='foreign-layout-project')
        foreign_location = Location.objects.create(name='Foreign location', project=foreign)
        foreign_field = Field.objects.create(
            name='Foreign field', location=foreign_location, project=foreign,
        )
        foreign_bed = Bed.objects.create(
            name='Foreign bed', field=foreign_field, area_sqm=5, project=foreign,
        )

        response = self._put_layouts(
            location,
            {'bed_layouts': [{'bed': foreign_bed.id, 'x': 1, 'y': 1}], 'field_layouts': []},
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['code'], 'invalid_location_layout')
        self.assertFalse(BedLayout.objects.filter(bed=foreign_bed).exists())

    def test_layouts_reject_a_location_of_another_project(self):
        """The location itself is project-scoped, so a foreign one is not found."""
        foreign = Project.objects.create(name='Foreign target', slug='foreign-target-project')
        foreign_location = Location.objects.create(name='Foreign target location', project=foreign)

        response = self._put_layouts(foreign_location, {'bed_layouts': [], 'field_layouts': []})

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_layouts_reject_an_unknown_bed_or_field(self):
        location, _, _ = self._location_with_bed('Unknown reference location')

        bed_response = self._put_layouts(
            location,
            {'bed_layouts': [{'bed': 9999999, 'x': 1, 'y': 1}], 'field_layouts': []},
        )
        self.assertEqual(bed_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('does not exist', bed_response.data['detail'])

        field_response = self._put_layouts(
            location,
            {'bed_layouts': [], 'field_layouts': [{'field': 9999999, 'x': 1, 'y': 1}]},
        )
        self.assertEqual(field_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('does not exist', field_response.data['detail'])

    def test_layouts_reject_an_entry_that_is_not_an_object(self):
        location, _, _ = self._location_with_bed('Scalar entry location')

        response = self._put_layouts(
            location, {'bed_layouts': ['not-an-object'], 'field_layouts': []},
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('must be an object', response.data['detail'])

    def test_layouts_require_both_collections_when_either_modern_key_is_sent(self):
        """Sending only `bed_layouts` leaves `field_layouts` unset, which is not a list."""
        location, _, bed = self._location_with_bed('Single collection location')

        response = self._put_layouts(location, {'bed_layouts': [{'bed': bed.id, 'x': 1, 'y': 1}]})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['code'], 'invalid_layout_collections')
        self.assertFalse(BedLayout.objects.filter(bed=bed).exists())

    def test_layouts_accept_the_legacy_bare_list_payload(self):
        """Kept for clients that still send the Phase-1 shape. Regression test:
        this used to raise `AttributeError` on the list and answer with a 500."""
        location, _, bed = self._location_with_bed('Legacy list location')

        response = self._put_layouts(location, [{'bed': bed.id, 'x': 12.0, 'y': 34.0}])

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['bed_layouts'][0]['bed'], bed.id)
        self.assertEqual(response.data['field_layouts'], [])
        self.assertEqual(BedLayout.objects.get(bed=bed).x, 12.0)

    def test_layouts_accept_the_legacy_layouts_key(self):
        location, _, bed = self._location_with_bed('Legacy key location')

        response = self._put_layouts(location, {'layouts': [{'bed': bed.id, 'x': 56.0, 'y': 78.0}]})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(BedLayout.objects.get(bed=bed).y, 78.0)

    def test_layouts_update_the_existing_entry_instead_of_adding_a_second(self):
        location, _, bed = self._location_with_bed('Upsert location')

        self._put_layouts(
            location, {'bed_layouts': [{'bed': bed.id, 'x': 1.0, 'y': 2.0}], 'field_layouts': []},
        )
        response = self._put_layouts(
            location,
            {
                'bed_layouts': [{'bed': bed.id, 'x': 9.0, 'y': 8.0, 'version': 3}],
                'field_layouts': [],
            },
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(BedLayout.objects.filter(bed=bed).count(), 1)
        layout = BedLayout.objects.get(bed=bed)
        self.assertEqual((layout.x, layout.y, layout.version), (9.0, 8.0, 3))

    def test_layouts_fill_in_defaults_for_omitted_position_fields(self):
        location, _, bed = self._location_with_bed('Defaults location')

        response = self._put_layouts(
            location, {'bed_layouts': [{'bed': bed.id}], 'field_layouts': []},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        layout = BedLayout.objects.get(bed=bed)
        self.assertEqual((layout.x, layout.y), (0.0, 0.0))
        self.assertEqual(layout.version, 1)
        self.assertIsNone(layout.scale)
        self.assertEqual(layout.project_id, self.project.id)
        self.assertEqual(layout.location_id, location.id)

    def test_layouts_accept_numeric_strings_from_the_client(self):
        """The grid editor posts positions as strings. The explicit `float()`/`int()`
        in the service is belt-and-braces here — the model fields coerce as well —
        so this pins the endpoint contract rather than that one line."""
        location, _, bed = self._location_with_bed('Coercion location')

        response = self._put_layouts(
            location,
            {
                'bed_layouts': [{'bed': bed.id, 'x': '4.5', 'y': '6', 'version': '2'}],
                'field_layouts': [],
            },
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        layout = BedLayout.objects.get(bed=bed)
        self.assertEqual((layout.x, layout.y, layout.version), (4.5, 6.0, 2))

    def test_layouts_reject_a_scalar_body_without_raising(self):
        location, _, _ = self._location_with_bed('Scalar body location')

        response = self._put_layouts(location, 'not-a-payload')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['code'], 'invalid_layout_collections')

    def test_layouts_keep_entries_saved_before_an_invalid_one(self):
        """Documented failure semantics: the invalid entry returns from inside the
        transaction rather than raising, so earlier upserts stay committed."""
        location, _, bed = self._location_with_bed('Partial commit location')

        response = self._put_layouts(
            location,
            {
                'bed_layouts': [
                    {'bed': bed.id, 'x': 5.0, 'y': 5.0},
                    {'bed': 9999999, 'x': 1.0, 'y': 1.0},
                ],
                'field_layouts': [],
            },
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(BedLayout.objects.filter(bed=bed).exists())

    def test_layouts_return_no_boundary_origin_until_one_is_saved(self):
        location, _, _ = self._location_with_bed('Unanchored location')

        response = self.client.get(f'/openfarmplanner/api/locations/{location.id}/layouts/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data['location_boundary'])

    def test_layouts_save_and_return_the_boundary_origin(self):
        location, field, _ = self._location_with_bed('Anchored location')

        response = self._put_layouts(location, {
            'bed_layouts': [],
            'field_layouts': [{'field': field.id, 'x': 120.0, 'y': 80.0}],
            'location_boundary': {'x': 100, 'y': 60.5},
        })

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['location_boundary'], {'x': 100.0, 'y': 60.5})
        location.refresh_from_db()
        self.assertEqual((location.boundary_x, location.boundary_y), (100.0, 60.5))
        get_response = self.client.get(f'/openfarmplanner/api/locations/{location.id}/layouts/')
        self.assertEqual(get_response.data['location_boundary'], {'x': 100.0, 'y': 60.5})
        self.assertTrue(EntityRevision.objects.filter(
            project=self.project, entity_type='location', object_id=location.id,
            action=EntityRevision.ACTION_UPDATED,
        ).exists())

    def test_layouts_keep_the_boundary_origin_when_the_key_is_omitted(self):
        location, field, _ = self._location_with_bed('Kept anchor location')
        Location.objects.filter(pk=location.pk).update(boundary_x=10.0, boundary_y=20.0)

        response = self._put_layouts(location, {
            'bed_layouts': [],
            'field_layouts': [{'field': field.id, 'x': 1.0, 'y': 2.0}],
        })

        self.assertEqual(response.data['location_boundary'], {'x': 10.0, 'y': 20.0})

    def test_layouts_clear_the_boundary_origin_with_null(self):
        location, _, _ = self._location_with_bed('Cleared anchor location')
        Location.objects.filter(pk=location.pk).update(boundary_x=10.0, boundary_y=20.0)

        response = self._put_layouts(
            location, {'bed_layouts': [], 'field_layouts': [], 'location_boundary': None},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data['location_boundary'])
        location.refresh_from_db()
        self.assertIsNone(location.boundary_x)

    def test_layouts_reject_an_invalid_boundary_origin_without_saving(self):
        location, field, _ = self._location_with_bed('Invalid anchor location')

        for boundary in ({'x': 'left', 'y': 1}, {'x': 1}, [1, 2], {'x': True, 'y': 1}):
            with self.subTest(boundary=boundary):
                response = self._put_layouts(location, {
                    'bed_layouts': [],
                    'field_layouts': [{'field': field.id, 'x': 1.0, 'y': 2.0}],
                    'location_boundary': boundary,
                })
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
                self.assertEqual(response.data['code'], 'invalid_location_boundary')
        self.assertFalse(FieldLayout.objects.filter(field=field).exists())
        location.refresh_from_db()
        self.assertIsNone(location.boundary_x)

    def test_location_api_does_not_accept_the_boundary_origin(self):
        location, _, _ = self._location_with_bed('Read-only anchor location')

        response = self.client.patch(
            f'/openfarmplanner/api/locations/{location.id}/',
            {'boundary_x': 5.0, 'boundary_y': 6.0},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        location.refresh_from_db()
        self.assertIsNone(location.boundary_x)
