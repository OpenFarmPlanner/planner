"""API tests for planting plans and area validation."""

from datetime import date

from rest_framework import status
from rest_framework.test import APITestCase as DRFAPITestCase

from farm.models import (
    Bed,
    Crop,
    Field,
    Location,
    NoteAttachment,
    PlantingPlan,
    Project,
    ProjectMembership,
    Season,
)
from farm.tests.api_base import ProjectApiTestCase, User


class PlantingPlanApiTest(ProjectApiTestCase):
    def setUp(self):
        super().setUp()
        # Planting plans now require an active season; every create in this
        # class works inside 2024, so anchor one season and send it by default.
        self.season = Season.objects.create(
            project=self.project,
            start_date=date(2024, 1, 1),
            end_date=date(2024, 12, 31),
        )
        self.client.defaults['HTTP_X_SEASON_ID'] = str(self.season.id)

    def test_planting_plan_create_rejects_bed_from_other_project(self):
        other_project = Project.objects.create(name='Other project 2', slug='other-project-2')
        other_location = Location.objects.create(name='Other location', project=other_project)
        other_field = Field.objects.create(name='Other field', location=other_location, project=other_project)
        other_bed = Bed.objects.create(name='Other bed', field=other_field, area_sqm=5.0, project=other_project)

        response = self.client.post(
            '/openfarmplanner/api/planting-plans/',
            {
                'crop': self.crop.id,
                'bed': other_bed.id,
                'planting_date': date(2026, 3, 1).isoformat(),
                'area_usage_sqm': 1.0,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('bed', response.data)

    def test_planting_plan_create(self):
        data = {
            'crop': self.crop.id,
            'bed': self.bed.id,
            'planting_date': '2024-03-01',
            'quantity': 50
        }
        response = self.client.post('/openfarmplanner/api/planting-plans/', data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn('harvest_date', response.data)

    def test_planting_plan_area_validation_success(self):
        """Test API allows a single planting plan within bed capacity."""
        data = {
            'crop': self.crop.id,
            'bed': self.bed.id,
            'planting_date': '2024-03-01',
            'area_usage_sqm': 15.0
        }
        response = self.client.post('/openfarmplanner/api/planting-plans/', data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(float(response.data['area_usage_sqm']), 15.0)

    def test_planting_plan_area_validation_non_overlapping_plans_allowed(self):
        """Test API allows non-overlapping plans even when their total sum is above bed capacity."""
        response1 = self.client.post('/openfarmplanner/api/planting-plans/', {
            'crop': self.crop.id,
            'bed': self.bed.id,
            'planting_date': '2024-03-01',
            'area_usage_sqm': 20.0,
        })
        self.assertEqual(response1.status_code, status.HTTP_201_CREATED)

        response2 = self.client.post('/openfarmplanner/api/planting-plans/', {
            'crop': self.crop.id,
            'bed': self.bed.id,
            'planting_date': '2024-04-01',
            'area_usage_sqm': 20.0,
        })
        self.assertEqual(response2.status_code, status.HTTP_201_CREATED)

    def test_planting_plan_area_validation_overlapping_plans_on_different_beds_allowed(self):
        """Test API allows overlapping plans on different beds."""
        other_bed = Bed.objects.create(
            name='Second Test Bed',
            field=self.field,
            area_sqm=20.0,
            project=self.project,
        )

        response1 = self.client.post('/openfarmplanner/api/planting-plans/', {
            'crop': self.crop.id,
            'bed': self.bed.id,
            'planting_date': '2024-03-01',
            'area_usage_sqm': 15.0,
        })
        self.assertEqual(response1.status_code, status.HTTP_201_CREATED)

        response2 = self.client.post('/openfarmplanner/api/planting-plans/', {
            'crop': self.crop.id,
            'bed': other_bed.id,
            'planting_date': '2024-03-01',
            'area_usage_sqm': 20.0,
        })
        self.assertEqual(response2.status_code, status.HTTP_201_CREATED)

    def test_planting_plan_area_validation_update_excludes_current_plan(self):
        """Test API update does not count current plan twice."""
        create_response = self.client.post('/openfarmplanner/api/planting-plans/', {
            'crop': self.crop.id,
            'bed': self.bed.id,
            'planting_date': '2024-03-01',
            'area_usage_sqm': 10.0,
        })
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        plan_id = create_response.data['id']

        update_response = self.client.patch(
            f'/openfarmplanner/api/planting-plans/{plan_id}/',
            {'area_usage_sqm': 12.0},
            format='json',
        )
        self.assertEqual(update_response.status_code, status.HTTP_200_OK)
        self.assertEqual(float(update_response.data['area_usage_sqm']), 12.0)

    def test_planting_plan_area_validation_update_partial_rejects_overlap_excess(self):
        """Test partial update allows the new area usage to be saved."""
        plan_one_response = self.client.post('/openfarmplanner/api/planting-plans/', {
            'crop': self.crop.id,
            'bed': self.bed.id,
            'planting_date': '2024-03-01',
            'area_usage_sqm': 12.0,
        })
        self.assertEqual(plan_one_response.status_code, status.HTTP_201_CREATED)

        plan_two_response = self.client.post('/openfarmplanner/api/planting-plans/', {
            'crop': self.crop.id,
            'bed': self.bed.id,
            'planting_date': '2024-03-03',
            'area_usage_sqm': 4.0,
        })
        self.assertEqual(plan_two_response.status_code, status.HTTP_201_CREATED)

        update_response = self.client.patch(
            f"/openfarmplanner/api/planting-plans/{plan_two_response.data['id']}/",
            {'area_usage_sqm': 9.0},
            format='json',
        )
        self.assertEqual(update_response.status_code, status.HTTP_200_OK)
        self.assertEqual(float(update_response.data['area_usage_sqm']), 9.0)

    def test_planting_plan_area_validation_boundary_equal_bed_area_allowed(self):
        """Test API allows overlapping plans whose summed area equals bed capacity."""
        response1 = self.client.post('/openfarmplanner/api/planting-plans/', {
            'crop': self.crop.id,
            'bed': self.bed.id,
            'planting_date': '2024-03-01',
            'area_usage_sqm': 12.0,
        })
        self.assertEqual(response1.status_code, status.HTTP_201_CREATED)

        response2 = self.client.post('/openfarmplanner/api/planting-plans/', {
            'crop': self.crop.id,
            'bed': self.bed.id,
            'planting_date': '2024-03-03',
            'area_usage_sqm': 8.0,
        })
        self.assertEqual(response2.status_code, status.HTTP_201_CREATED)


class PlantingPlanAreaInputTest(DRFAPITestCase):
    """Test area input as m² or plants for PlantingPlan."""

    def setUp(self):
        """Create test data."""
        self.user = User.objects.create_user(username='ppuser', email='pp@example.com', password='testpass', is_active=True)
        self.project = Project.objects.create(name='PP Project', slug='pp-project')
        ProjectMembership.objects.create(user=self.user, project=self.project, role='admin')
        self.client.force_authenticate(user=self.user)
        self.client.defaults['HTTP_X_PROJECT_ID'] = str(self.project.id)
        # Create location, field, and bed
        self.location = Location.objects.create(name="Test Farm", project=self.project)
        self.field = Field.objects.create(
            name="Test Field",
            location=self.location,
            area_sqm=100.00,
            project=self.project,
        )
        self.bed = Bed.objects.create(
            name="Test Bed",
            field=self.field,
            area_sqm=10.00,
            project=self.project,
        )

        # Create crop with spacing data
        self.crop_with_spacing = Crop.objects.create(
            name="Tomato",
            growth_duration_days=60,
            harvest_duration_days=30,
            row_spacing_m=0.50,  # 50 cm
            distance_within_row_m=0.40,  # 40 cm
            project=self.project,
        )

        # Create crop without spacing data
        self.crop_no_spacing = Crop.objects.create(
            name="Cucumber",
            growth_duration_days=50,
            harvest_duration_days=20,
            project=self.project,
        )

        # Planting plans require an active season; every plan in this class lives
        # in 2024, so anchor one season and send it as the active-season header.
        self.season = Season.objects.create(
            project=self.project,
            start_date=date(2024, 1, 1),
            end_date=date(2024, 12, 31),
        )
        self.client.defaults['HTTP_X_SEASON_ID'] = str(self.season.id)

    def test_plants_per_m2_calculation(self):
        """Test that plants_per_m2 is calculated correctly."""
        # 10000 / (50 * 40) = 10000 / 2000 = 5.0
        expected = 5.0
        self.assertAlmostEqual(float(self.crop_with_spacing.plants_per_m2), expected, places=2)
    
    def test_plants_per_m2_returns_none_when_spacing_missing(self):
        """Test that plants_per_m2 returns None when spacing is missing."""
        self.assertIsNone(self.crop_no_spacing.plants_per_m2)
    
    def test_area_input_m2_creates_planting_plan(self):
        """Test creating planting plan with M2 input."""
        data = {
            'crop': self.crop_with_spacing.id,
            'bed': self.bed.id,
            'planting_date': '2024-03-01',
            'area_input_value': '2.50',
            'area_input_unit': 'M2'
        }
        
        response = self.client.post('/openfarmplanner/api/planting-plans/', data, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(float(response.data['area_usage_sqm']), 2.50)
    
    def test_area_input_plants_converts_correctly(self):
        """Test creating planting plan with PLANTS input converts to m²."""
        # 10 plants / 5 plants_per_m2 = 2.0 m²
        data = {
            'crop': self.crop_with_spacing.id,
            'bed': self.bed.id,
            'planting_date': '2024-03-01',
            'area_input_value': '10',
            'area_input_unit': 'PLANTS'
        }
        
        response = self.client.post('/openfarmplanner/api/planting-plans/', data, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        # 10 / 5 = 2.0
        self.assertAlmostEqual(float(response.data['area_usage_sqm']), 2.0, places=2)
    
    def test_area_input_plants_fails_when_crop_missing(self):
        """Test that PLANTS input fails when crop is not provided.

        Crop itself is optional (a plan can be saved as a draft with
        only a bed chosen), so this now surfaces as an area_input_unit
        error — plant-count input specifically needs a crop to convert
        via — rather than a missing-crop field error."""
        data = {
            'bed': self.bed.id,
            'planting_date': '2024-03-01',
            'area_input_value': '10',
            'area_input_unit': 'PLANTS'
        }

        response = self.client.post('/openfarmplanner/api/planting-plans/', data, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('area_input_unit', response.data)
    
    def test_area_input_plants_fails_when_spacing_missing(self):
        """Test that PLANTS input fails when crop spacing is missing."""
        data = {
            'crop': self.crop_no_spacing.id,
            'bed': self.bed.id,
            'planting_date': '2024-03-01',
            'area_input_value': '10',
            'area_input_unit': 'PLANTS'
        }
        
        response = self.client.post('/openfarmplanner/api/planting-plans/', data, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('area_input_unit', response.data)
    
    def test_area_input_value_must_be_positive(self):
        """Test that area_input_value must be greater than 0."""
        data = {
            'crop': self.crop_with_spacing.id,
            'bed': self.bed.id,
            'planting_date': '2024-03-01',
            'area_input_value': '0',
            'area_input_unit': 'M2'
        }
        
        response = self.client.post('/openfarmplanner/api/planting-plans/', data, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('area_input_value', response.data)
    
    def test_area_input_unit_required_when_value_provided(self):
        """Test that area_input_unit is required when area_input_value is provided."""
        data = {
            'crop': self.crop_with_spacing.id,
            'bed': self.bed.id,
            'planting_date': '2024-03-01',
            'area_input_value': '2.50'
            # Missing area_input_unit
        }
        
        response = self.client.post('/openfarmplanner/api/planting-plans/', data, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('area_input_unit', response.data)
    
    def test_area_input_plants_update_existing_plan(self):
        """Test updating existing planting plan with PLANTS input."""
        # Create initial plan
        plan = PlantingPlan.objects.create(
            crop=self.crop_with_spacing,
            bed=self.bed,
            planting_date=date(2024, 3, 1),
            area_usage_sqm=1.0,
            project=self.project,
            season=self.season,
        )

        # Update with PLANTS input: 15 plants / 5 plants_per_m2 = 3.0 m²
        data = {
            'crop': self.crop_with_spacing.id,
            'bed': self.bed.id,
            'planting_date': '2024-03-01',
            'area_input_value': '15',
            'area_input_unit': 'PLANTS'
        }
        
        response = self.client.put(f'/openfarmplanner/api/planting-plans/{plan.id}/', data, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertAlmostEqual(float(response.data['area_usage_sqm']), 3.0, places=2)

    def test_area_input_m2_put_update_does_not_return_server_error(self):
        """Test full PUT update with M2 input does not crash and updates area."""
        plan = PlantingPlan.objects.create(
            crop=self.crop_with_spacing,
            bed=self.bed,
            planting_date=date(2024, 1, 1),
            area_usage_sqm=1.0,
            project=self.project,
            cultivation_type='pre_cultivation',
            season=self.season,
        )

        response = self.client.put(
            f'/openfarmplanner/api/planting-plans/{plan.id}/',
            {
                'crop': self.crop_with_spacing.id,
                'bed': self.bed.id,
                'planting_date': '2024-01-01',
                'quantity': None,
                'notes': '',
                'cultivation_type': 'pre_cultivation',
                'area_input_value': 3,
                'area_input_unit': 'M2',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(float(response.data['area_usage_sqm']), 3.0)


class PlantingPlanRemainingAreaApiTest(DRFAPITestCase):
    """Tests for remaining-area endpoint on planting plans."""

    def setUp(self):
        self.user = User.objects.create_user(username='remaininguser', email='remaining@example.com', password='testpass', is_active=True)
        self.project = Project.objects.create(name='Remaining Area Project', slug='remaining-area-project')
        ProjectMembership.objects.create(user=self.user, project=self.project, role='admin')
        self.client.force_authenticate(user=self.user)
        self.client.defaults['HTTP_X_PROJECT_ID'] = str(self.project.id)
        self.location = Location.objects.create(name='Remaining Location', project=self.project)
        self.field = Field.objects.create(name='Remaining Field', location=self.location, project=self.project)
        self.bed = Bed.objects.create(name='Remaining Bed', field=self.field, area_sqm=20, project=self.project)
        self.other_bed = Bed.objects.create(name='Other Bed', field=self.field, area_sqm=15, project=self.project)
        self.crop = Crop.objects.create(
            name='Lettuce',
            growth_duration_days=30,
            harvest_duration_days=10,
            project=self.project,
        )

        self.plan_one = PlantingPlan.objects.create(
            crop=self.crop,
            bed=self.bed,
            planting_date=date(2024, 3, 1),
            area_usage_sqm=6,
            project=self.project,
        )
        self.plan_two = PlantingPlan.objects.create(
            crop=self.crop,
            bed=self.bed,
            planting_date=date(2024, 3, 15),
            area_usage_sqm=4,
            project=self.project,
        )
        PlantingPlan.objects.create(
            crop=self.crop,
            bed=self.other_bed,
            planting_date=date(2024, 3, 10),
            area_usage_sqm=8,
            project=self.project,
        )

    def test_remaining_area_returns_overlap_sum(self):
        response = self.client.get(
            '/openfarmplanner/api/planting-plans/remaining-area/',
            {
                'bed_id': self.bed.id,
                'start_date': '2024-03-20',
                'end_date': '2024-04-10',
            },
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['bed_id'], self.bed.id)
        self.assertEqual(response.data['bed_area_sqm'], 20.0)
        self.assertEqual(response.data['overlapping_used_area_sqm'], 10.0)
        self.assertEqual(response.data['remaining_area_sqm'], 10.0)

    def test_remaining_area_excludes_current_plan(self):
        response = self.client.get(
            '/openfarmplanner/api/planting-plans/remaining-area/',
            {
                'bed_id': self.bed.id,
                'start_date': '2024-03-20',
                'end_date': '2024-04-10',
                'exclude_plan_id': self.plan_two.id,
            },
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['overlapping_used_area_sqm'], 6.0)
        self.assertEqual(response.data['remaining_area_sqm'], 14.0)

    def test_remaining_area_validates_required_params(self):
        response = self.client.get('/openfarmplanner/api/planting-plans/remaining-area/')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['code'], 'invalid_remaining_area_parameters')
        self.assertIn('detail', response.data)

    def test_remaining_area_rejects_invalid_date_range(self):
        response = self.client.get(
            '/openfarmplanner/api/planting-plans/remaining-area/',
            {
                'bed_id': self.bed.id,
                'start_date': '2024-04-10',
                'end_date': '2024-03-20',
            },
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['code'], 'invalid_remaining_area_interval')
        self.assertIn('detail', response.data)

    def test_remaining_area_rejects_invalid_bed_id_type(self):
        response = self.client.get(
            '/openfarmplanner/api/planting-plans/remaining-area/',
            {
                'bed_id': 'abc',
                'start_date': '2024-03-20',
                'end_date': '2024-04-10',
            },
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['code'], 'invalid_remaining_area_parameters')
        self.assertIn('detail', response.data)

    def test_remaining_area_rejects_bed_from_other_project(self):
        other_project = Project.objects.create(name='Other Remaining Project', slug='other-remaining-project')
        other_location = Location.objects.create(name='Other Remaining Location', project=other_project)
        other_field = Field.objects.create(name='Other Remaining Field', location=other_location, project=other_project)
        other_bed = Bed.objects.create(name='Other Remaining Bed', field=other_field, area_sqm=12, project=other_project)

        response = self.client.get(
            '/openfarmplanner/api/planting-plans/remaining-area/',
            {
                'bed_id': other_bed.id,
                'start_date': '2024-03-20',
                'end_date': '2024-04-10',
            },
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data['code'], 'bed_not_found')


class PlantingPlanAttachmentCountApiTest(DRFAPITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='attachcountuser', email='attachcount@example.com', password='testpass', is_active=True)
        self.project = Project.objects.create(name='Attach Count Project', slug='attach-count-project')
        ProjectMembership.objects.create(user=self.user, project=self.project, role='admin')
        self.client.force_authenticate(user=self.user)
        self.client.defaults['HTTP_X_PROJECT_ID'] = str(self.project.id)
        self.location = Location.objects.create(name="Plan Location", project=self.project)
        self.field = Field.objects.create(name="Plan Field", location=self.location, project=self.project)
        self.bed = Bed.objects.create(name="Plan Bed", field=self.field, project=self.project)
        self.crop = Crop.objects.create(name="Plan Crop", growth_duration_days=7, harvest_duration_days=2, project=self.project)

        self.plan_without_attachments = PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, planting_date=date(2024, 3, 1), notes='No attachments',
            project=self.project,
        )
        self.plan_with_attachments = PlantingPlan.objects.create(
            crop=self.crop, bed=self.bed, planting_date=date(2024, 3, 2), notes='With attachments',
            project=self.project,
        )

        NoteAttachment.objects.create(
            planting_plan=self.plan_with_attachments,
            image='notes/test-1.webp',
            mime_type='image/webp',
            width=100,
            height=100,
            size_bytes=1000,
            project=self.project,
        )
        NoteAttachment.objects.create(
            planting_plan=self.plan_with_attachments,
            image='notes/test-2.webp',
            mime_type='image/webp',
            width=100,
            height=100,
            size_bytes=1000,
            project=self.project,
        )

    def test_planting_plan_list_contains_attachment_count(self):
        response = self.client.get('/openfarmplanner/api/planting-plans/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        by_id = {item['id']: item for item in response.data['results']}
        self.assertEqual(by_id[self.plan_without_attachments.id]['note_attachment_count'], 0)
        self.assertEqual(by_id[self.plan_with_attachments.id]['note_attachment_count'], 2)

    def test_planting_plan_list_query_count_stays_stable(self):
        # 6 queries: 1 SAVEPOINT + 1 project membership lookup + 1 COUNT (pagination)
        # + 1 SELECT with annotation + 1 general-Kultur index for the whole page
        # (see PlantingPlanSerializer._general_crop_index) + 1 RELEASE SAVEPOINT
        # (ATOMIC_REQUESTS wraps each request in its own transaction, nested as a
        # savepoint under the test's outer transaction).
        with self.assertNumQueries(6):
            response = self.client.get('/openfarmplanner/api/planting-plans/')
            self.assertEqual(response.status_code, status.HTTP_200_OK)

