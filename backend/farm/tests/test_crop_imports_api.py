"""API tests for the public-crop import preview/apply endpoints."""


from rest_framework.test import APITestCase as DRFAPITestCase

from farm.models import (
    Crop,
    MediaFile,
    Project,
    ProjectMembership,
    Supplier,
)
from farm.crops.serializers import CropSerializer
from farm.services.demo_project import populate_demo_project
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

    def test_import_preview_ignores_numbers_that_only_differ_in_notation(self):
        """A re-imported export reports no change for "5.60" vs 5.6 or 55 cm vs 0.55 m."""
        self.existing_crop.expected_yield = '5.60'
        self.existing_crop.distance_within_row_m = 0.55
        self.existing_crop.save()
        data = [{
            'name': 'Tomato',
            'variety': 'Cherry',
            'supplier_id': self.supplier.id,
            'expected_yield': 5.6,
            'distance_within_row_cm': 55,
            'growth_duration_days': 60,
        }]

        response = self.client.post('/openfarmplanner/api/crops/import/preview/', data, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['results'][0]['diff'], [])

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

    def test_import_apply_maps_a_family_name_and_rejects_an_unknown_one(self):
        data = {
            'items': [
                {'name': 'Gurke', 'crop_family': 'Kürbisgewächse'},
                {'name': 'Apfel', 'crop_family': 'Rosengewächse'},
            ],
            'confirm_updates': False,
        }

        response = self.client.post('/openfarmplanner/api/crops/import/apply/', data, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['created_count'], 1)
        self.assertEqual(Crop.objects.get(name_normalized='gurke').crop_family_id, 'Cucurbitaceae')
        self.assertEqual(response.data['errors'][0]['index'], 1)
        self.assertIn('crop_family', response.data['errors'][0]['error'])

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


# The keys of CROP_COLUMNS in frontend/src/crops/spreadsheetColumns.ts: what a
# spreadsheet export writes and the import sends back.
SPREADSHEET_COLUMN_KEYS = (
    'name', 'variety', 'supplier_name', 'crop_family', 'nutrient_demand', 'cultivation_type',
    'growth_duration_days', 'harvest_duration_days', 'propagation_duration_days',
    'harvest_method', 'expected_yield', 'distance_within_row_cm', 'row_spacing_cm',
    'sowing_depth_cm', 'thousand_kernel_weight_g', 'sowing_calculation_safety_percent',
    'seed_rate_direct_value', 'seed_rate_direct_unit', 'sowing_calculation_safety_percent_direct',
    'seed_rate_pre_cultivation_value', 'seed_rate_pre_cultivation_unit',
    'sowing_calculation_safety_percent_pre_cultivation', 'notes',
)
# The columns of type 'number' there: a sheet cell comes back as a number, not
# as the API's decimal string ("5.60").
SPREADSHEET_NUMBER_KEYS = frozenset({
    'growth_duration_days', 'harvest_duration_days', 'propagation_duration_days',
    'expected_yield', 'distance_within_row_cm', 'row_spacing_cm', 'sowing_depth_cm',
    'thousand_kernel_weight_g', 'sowing_calculation_safety_percent',
    'seed_rate_direct_value', 'seed_rate_pre_cultivation_value',
    'sowing_calculation_safety_percent_direct', 'sowing_calculation_safety_percent_pre_cultivation',
})


def _same_value(left: object, right: object) -> bool:
    """Equal, with numbers compared by value ("5.60" == 5.6) and empty == missing."""
    if left in (None, '', []) and right in (None, '', []):
        return True
    try:
        return float(left) == float(right)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return left == right


class CropSpreadsheetRoundTripTest(DRFAPITestCase):
    """The demo project's crops, exported as a sheet, import back without loss.

    The demo crops are the realistic case: they are what a new user exports
    first, and they cover species, varieties, suppliers and every seed unit.
    """

    def setUp(self) -> None:
        self.user = User.objects.create_user(
            username='roundtrip', email='roundtrip@example.com', password='testpass', is_active=True,
        )
        self.client.force_authenticate(user=self.user)
        self.source = Project.objects.create(name='Solawi Sonnenacker', slug='roundtrip-source')
        self.target = Project.objects.create(name='Test', slug='roundtrip-target')
        for project in (self.source, self.target):
            ProjectMembership.objects.create(user=self.user, project=project, role='admin')
        populate_demo_project(self.source, owner=self.user, language_code='de')

    def _export_rows(self) -> list[dict]:
        rows = []
        for crop in Crop.objects.filter(project=self.source).select_related('supplier').order_by('id'):
            data = dict(CropSerializer(crop).data)
            data['supplier_name'] = crop.supplier.name if crop.supplier else crop.seed_supplier
            # Empty cells are left out on import, exactly like here.
            rows.append({
                key: float(data[key]) if key in SPREADSHEET_NUMBER_KEYS else data[key]
                for key in SPREADSHEET_COLUMN_KEYS
                if data.get(key) not in (None, '')
            })
        return rows

    def _post(self, project: Project, path: str, payload: object):
        return self.client.post(
            f'/openfarmplanner/api/crops/import/{path}/',
            payload,
            format='json',
            HTTP_X_PROJECT_ID=str(project.id),
        )

    def test_exported_demo_crops_import_into_an_empty_project_without_errors(self) -> None:
        rows = self._export_rows()
        self.assertGreater(len(rows), 20)

        response = self._post(self.target, 'apply', {'items': rows, 'confirm_updates': False})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['errors'], [])
        self.assertEqual(response.data['created_count'], len(rows))

    @staticmethod
    def _effective_columns(project: Project) -> dict[tuple[str, str], dict]:
        """Per crop, each sheet column's value as the app shows it, inheritance included."""
        result = {}
        for crop in Crop.objects.filter(project=project).select_related('supplier'):
            data = dict(CropSerializer(crop).data)
            data['supplier_name'] = crop.supplier.name if crop.supplier else crop.seed_supplier
            effective = data.get('effective_values') or {}
            result[(crop.name, crop.variety or '')] = {
                key: effective.get(key, data.get(key)) for key in SPREADSHEET_COLUMN_KEYS
            }
        return result

    def test_imported_varieties_keep_what_they_inherit_from_their_species(self) -> None:
        rows = self._export_rows()
        self._post(self.target, 'apply', {'items': rows, 'confirm_updates': False})

        source = self._effective_columns(self.source)
        target = self._effective_columns(self.target)
        differences = {
            crop: {key: (value, target.get(crop, {}).get(key)) for key, value in values.items()
                   if not _same_value(value, target.get(crop, {}).get(key))}
            for crop, values in source.items()
        }
        self.assertEqual({crop: diff for crop, diff in differences.items() if diff}, {})

    def test_re_importing_into_an_imported_project_changes_nothing(self) -> None:
        """Second import of the same sheet: the first one moved the Sorten's
        family and nutrient demand onto their Kultur, which must not read as a change."""
        rows = self._export_rows()
        self._post(self.target, 'apply', {'items': rows, 'confirm_updates': False})

        response = self._post(self.target, 'preview', self._export_rows())

        changes = [
            (result['import_data']['name'], result['import_data'].get('variety'), result.get('diff'))
            for result in response.data['results'] if result.get('diff')
        ]
        self.assertEqual(changes, [])

    def test_re_importing_the_export_into_its_own_project_changes_nothing(self) -> None:
        rows = self._export_rows()

        response = self._post(self.source, 'preview', rows)

        self.assertEqual(response.status_code, 200)
        problems = [
            (result['import_data']['name'], result.get('variety'), result.get('error') or result.get('diff'))
            for result in response.data['results']
            if result.get('status') != 'update_candidate' or result.get('diff')
        ]
        self.assertEqual(problems, [])

