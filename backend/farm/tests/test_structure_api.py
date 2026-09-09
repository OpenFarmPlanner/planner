"""API tests for locations, fields, beds, and areas."""


from rest_framework import status
from rest_framework.test import APITestCase as DRFAPITestCase

from farm.models import (
    Bed,
    BedLayout,
    Crop,
    Field,
    FieldLayout,
    Location,
    Project,
    ProjectMembership,
    Supplier,
)
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
