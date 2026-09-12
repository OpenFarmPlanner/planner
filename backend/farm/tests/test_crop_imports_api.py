"""API tests for the public-crop import preview/apply endpoints."""


from rest_framework.test import APITestCase as DRFAPITestCase

from farm.models import (
    Crop,
    MediaFile,
    Project,
    ProjectMembership,
    Supplier,
)
from farm.tests.api_base import User


class CropImportAPITest(DRFAPITestCase):
    """Tests for crop import API endpoints."""

    def setUp(self):
        """Set up test data."""
        self.user = User.objects.create_user(username='importuser', email='import@example.com', password='testpass', is_active=True)
        self.project = Project.objects.create(name='Import Project', slug='import-project')
        ProjectMembership.objects.create(user=self.user, project=self.project, role='admin')
        self.client.force_authenticate(user=self.user)
        self.client.defaults['HTTP_X_PROJECT_ID'] = str(self.project.id)
        self.supplier = Supplier.objects.create(name="Test Supplier", homepage_url='https://test-supplier.example', project=self.project)
        self.existing_crop = Crop.objects.create(
            name="Tomato",
            variety="Cherry",
            supplier=self.supplier,
            growth_duration_days=60,
            harvest_duration_days=30,
            harvest_method='per_plant',
            notes="Existing notes",
            project=self.project,
        )

    def test_import_preview_new_crop(self):
        """Test preview endpoint for new crop."""
        data = [{
            'name': 'Cucumber',
            'variety': 'English',
            'growth_duration_days': 50,
            'harvest_duration_days': 20
        }]

        response = self.client.post('/openfarmplanner/api/crops/import/preview/', data, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['results']), 1)
        self.assertEqual(response.data['results'][0]['status'], 'create')

    def test_import_preview_rejects_non_list_with_standard_error(self):
        response = self.client.post(
            '/openfarmplanner/api/crops/import/preview/',
            {'name': 'Cucumber'},
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'], 'invalid_crop_import_payload')
        self.assertIn('detail', response.data)

    def test_import_apply_rejects_non_list_items_with_standard_error(self):
        response = self.client.post(
            '/openfarmplanner/api/crops/import/apply/',
            {'items': {'name': 'Cucumber'}},
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'], 'invalid_crop_import_items')
        self.assertIn('detail', response.data)

    def test_import_preview_update_candidate(self):
        """Test preview endpoint for matching crop."""
        data = [{
            'name': 'Tomato',
            'variety': 'Cherry',
            'supplier_id': self.supplier.id,
            'growth_duration_days': 65,  # Different value
            'harvest_duration_days': 30,
            'notes': 'Updated notes'  # Different value
        }]

        response = self.client.post('/openfarmplanner/api/crops/import/preview/', data, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['results']), 1)
        result = response.data['results'][0]
        self.assertEqual(result['status'], 'update_candidate')
        self.assertEqual(result['matched_crop_id'], self.existing_crop.id)
        self.assertIsInstance(result['diff'], list)
        self.assertGreater(len(result['diff']), 0)

    def test_import_preview_supplier_by_name(self):
        """Test preview resolves supplier by name."""
        data = [{
            'name': 'Tomato',
            'variety': 'Cherry',
            'supplier_name': 'test supplier',  # Same normalized name
            'growth_duration_days': 60,
            'harvest_duration_days': 30
        }]

        response = self.client.post('/openfarmplanner/api/crops/import/preview/', data, format='json')

        self.assertEqual(response.status_code, 200)
        result = response.data['results'][0]
        self.assertEqual(result['status'], 'update_candidate')

    def test_import_preview_supplier_name_matches_seed_supplier_case_insensitive(self):
        """Test preview matches legacy seed_supplier case-insensitively."""
        Crop.objects.create(
            name="Lettuce",
            variety="Batavia",
            seed_supplier="Rainsaat R-Codes",
            growth_duration_days=45,
            harvest_duration_days=20,
            project=self.project,
        )
        data = [{
            'name': 'Lettuce',
            'variety': 'Batavia',
            'seed_supplier': 'RAINSAAT r-codes',
            'growth_duration_days': 45,
            'harvest_duration_days': 20,
        }]

        response = self.client.post('/openfarmplanner/api/crops/import/preview/', data, format='json')

        self.assertEqual(response.status_code, 200)
        result = response.data['results'][0]
        self.assertEqual(result['status'], 'update_candidate')

    def test_import_apply_supplier_name_matches_seed_supplier_case_insensitive(self):
        """Test apply updates existing crop when seed_supplier differs only by case."""
        existing = Crop.objects.create(
            name="Carrot",
            variety="Nantes",
            seed_supplier="Rainsaat R-Codes",
            growth_duration_days=70,
            harvest_duration_days=30,
            harvest_method='per_plant',
            notes="Before import",
            project=self.project,
        )
        data = {
            'items': [{
                'name': 'carrot',
                'variety': 'nantes',
                'seed_supplier': 'rainsaat r-codes',
                'growth_duration_days': 70,
                'harvest_duration_days': 30,
                'harvest_method': 'per_plant',
                'notes': 'After import',
                'project': self.project.id,
            }],
            'confirm_updates': True,
        }

        response = self.client.post('/openfarmplanner/api/crops/import/apply/', data, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['created_count'], 0)
        self.assertEqual(response.data['updated_count'], 1)

        existing.refresh_from_db()
        self.assertEqual(existing.notes, 'After import')

    def test_import_apply_create_new(self):
        """Test apply endpoint creates new crops."""
        data = {
            'items': [{
                'name': 'Cucumber',
                'variety': 'English',
                'growth_duration_days': 50,
                'harvest_duration_days': 20,
                'harvest_method': 'per_plant',
                'project': self.project.id,
            }],
            'confirm_updates': False
        }

        response = self.client.post('/openfarmplanner/api/crops/import/apply/', data, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['created_count'], 1)
        self.assertEqual(response.data['updated_count'], 0)
        self.assertEqual(response.data['skipped_count'], 0)

        # Verify crop was created
        self.assertTrue(Crop.objects.filter(name_normalized='cucumber').exists())

    def test_import_apply_skip_update_without_confirmation(self):
        """Test apply endpoint skips updates without confirmation."""
        data = {
            'items': [{
                'name': 'Tomato',
                'variety': 'Cherry',
                'supplier_id': self.supplier.id,
                'growth_duration_days': 65,
                'harvest_duration_days': 30,
                'notes': 'Updated notes',
                'project': self.project.id,
            }],
            'confirm_updates': False
        }

        response = self.client.post('/openfarmplanner/api/crops/import/apply/', data, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['created_count'], 0)
        self.assertEqual(response.data['updated_count'], 0)
        self.assertEqual(response.data['skipped_count'], 1)

        # Verify crop was not updated
        crop = Crop.objects.get(id=self.existing_crop.id)
        self.assertEqual(crop.growth_duration_days, 60)  # Original value
        self.assertEqual(crop.notes, "Existing notes")  # Original value

    def test_import_apply_update_with_confirmation(self):
        """Test apply endpoint updates crops with confirmation."""
        data = {
            'items': [{
                'name': 'Tomato',
                'variety': 'Cherry',
                'supplier_id': self.supplier.id,
                'growth_duration_days': 65,
                'harvest_duration_days': 30,
                'harvest_method': 'per_plant',
                'notes': 'Updated notes',
                'project': self.project.id,
            }],
            'confirm_updates': True
        }

        response = self.client.post('/openfarmplanner/api/crops/import/apply/', data, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['created_count'], 0)
        self.assertEqual(response.data['updated_count'], 1)
        self.assertEqual(response.data['skipped_count'], 0)

        # Verify crop was updated
        crop = Crop.objects.get(id=self.existing_crop.id)
        self.assertEqual(crop.growth_duration_days, 65)
        self.assertEqual(crop.notes, "Updated notes")

    def test_import_apply_mixed_operations(self):
        """Test apply endpoint with both create and update operations."""
        data = {
            'items': [
                {
                    'name': 'Cucumber',
                    'variety': 'English',
                    'growth_duration_days': 50,
                    'harvest_duration_days': 20,
                    'harvest_method': 'per_plant',
                    'project': self.project.id,
                },
                {
                    'name': 'Tomato',
                    'variety': 'Cherry',
                    'supplier_id': self.supplier.id,
                    'growth_duration_days': 65,
                    'harvest_duration_days': 30,
                    'harvest_method': 'per_plant',
                    'project': self.project.id,
                }
            ],
            'confirm_updates': True
        }

        response = self.client.post('/openfarmplanner/api/crops/import/apply/', data, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['created_count'], 1)
        self.assertEqual(response.data['updated_count'], 1)
        self.assertEqual(response.data['skipped_count'], 0)


class CropImportProjectBoundaryTest(DRFAPITestCase):
    """The import endpoints must not accept references from another project.

    `/api/crops/` already rejects a foreign `image_file_id`/`supplier_id`; the
    import route reaches the same serializer on a different path, so it needs
    its own coverage or the two can drift apart.
    """

    def setUp(self) -> None:
        self.user = User.objects.create_user(
            username='importboundary', email='import-boundary@example.com',
            password='testpass', is_active=True,
        )
        self.project = Project.objects.create(name='Attacker Project', slug='attacker-project')
        ProjectMembership.objects.create(user=self.user, project=self.project, role='admin')

        self.other_project = Project.objects.create(name='Victim Project', slug='victim-project')
        self.other_supplier = Supplier.objects.create(
            name='Victim Supplier',
            homepage_url='https://victim-supplier.example',
            project=self.other_project,
        )
        self.other_media = MediaFile.objects.create(
            project=self.other_project,
            storage_path='crop-media/victim/secret.jpg',
        )

        self.client.force_authenticate(user=self.user)
        self.client.defaults['HTTP_X_PROJECT_ID'] = str(self.project.id)

    def _apply(self, item: dict) -> object:
        return self.client.post(
            '/openfarmplanner/api/crops/import/apply/',
            {'items': [item], 'confirm_updates': True},
            format='json',
        )

    def _base_item(self) -> dict:
        return {
            'name': 'Boundary Probe',
            'variety': 'Cross Project',
            'growth_duration_days': 50,
            'harvest_duration_days': 20,
            'harvest_method': 'per_plant',
        }

    def test_import_apply_rejects_media_file_from_other_project(self) -> None:
        response = self._apply({**self._base_item(), 'image_file_id': self.other_media.id})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['created_count'], 0)
        self.assertEqual(len(response.data['errors']), 1)
        self.assertIn('image_file_id', response.data['errors'][0]['error'])
        self.assertFalse(
            Crop.all_objects.filter(image_file=self.other_media).exists(),
            'a crop must never end up referencing another project\'s media file',
        )

    def test_import_apply_rejects_supplier_from_other_project(self) -> None:
        response = self._apply({**self._base_item(), 'supplier_id': self.other_supplier.id})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['created_count'], 0)
        self.assertFalse(
            Crop.all_objects.filter(supplier=self.other_supplier).exists(),
            'a crop must never end up referencing another project\'s supplier',
        )

    def test_import_apply_rejects_seed_demand_supplier_from_other_project(self) -> None:
        response = self._apply(
            {**self._base_item(), 'selected_seed_demand_supplier': self.other_supplier.id},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['created_count'], 0)
        self.assertFalse(
            Crop.all_objects.filter(selected_seed_demand_supplier=self.other_supplier).exists(),
            'a crop must never end up referencing another project\'s supplier',
        )

    def test_import_apply_still_accepts_own_project_references(self) -> None:
        own_supplier = Supplier.objects.create(
            name='Own Supplier',
            homepage_url='https://own-supplier.example',
            project=self.project,
        )
        own_media = MediaFile.objects.create(
            project=self.project, storage_path='crop-media/own/picture.jpg',
        )

        response = self._apply({
            **self._base_item(),
            'supplier_id': own_supplier.id,
            'image_file_id': own_media.id,
        })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['created_count'], 1, response.data['errors'])
        crop = Crop.objects.get(project=self.project, name='Boundary Probe')
        self.assertEqual(crop.supplier_id, own_supplier.id)
        self.assertEqual(crop.image_file_id, own_media.id)
