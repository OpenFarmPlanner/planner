"""API tests for crops, supplier data, and seed demand."""

from datetime import date

from rest_framework import status

from crops.models import CropSpecies
from farm.models import (
    Crop,
    CropSupplierData,
    EntityRevision,
    PlantingPlan,
    Project,
    PublicCrop,
    SeedPackage,
    Supplier,
)
from farm.tests.api_base import ProjectApiTestCase


class CropApiTest(ProjectApiTestCase):
    def test_crop_with_supplier(self):
        """Test creating crop with supplier"""
        data = {
            'name': 'Crop with Supplier',
            'growth_duration_days': 8,
            'harvest_duration_days': 3,
            'harvest_method': 'per_plant',
            'supplier_name': self.supplier.name,
            'project': self.project.id,
        }
        response = self.client.post('/openfarmplanner/api/crops/', data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['supplier']['id'], self.supplier.id)

    def test_crop_list(self):
        response = self.client.get('/openfarmplanner/api/crops/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 1)

    def test_crop_list_query_count_does_not_scale_with_result_count(self):
        # Regression test: get_queryset() previously dropped the select_related/
        # prefetch_related applied on the class-level `queryset`, causing one extra
        # query per crop for `supplier`, `image_file`, `source_public_crop`,
        # `seed_packages`, and the owned-public-crop lookup.
        for index in range(5):
            Crop.objects.create(
                name=f'Extra Crop {index}',
                growth_duration_days=7,
                harvest_duration_days=2,
                project=self.project,
                supplier=self.supplier,
            )

        # One of the queries resolves the project's general Kulturen for the
        # whole page (see CropSerializer._general_crop_index).
        with self.assertNumQueries(9):
            response = self.client.get('/openfarmplanner/api/crops/')
            self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 6)

    def test_crop_detail_returns_all_supplier_data_rows(self):
        supplier_a = Supplier.objects.create(name='Supplier A', homepage_url='https://supplier-a.example', project=self.project)
        supplier_b = Supplier.objects.create(name='Supplier B', homepage_url='https://supplier-b.example', project=self.project)
        CropSupplierData.objects.create(
            crop=self.crop,
            supplier=supplier_a,
            project=self.project,
            supplier_product_name='Alpha Product',
            packaging_sizes=[{'size_value': 5, 'size_unit': 'g'}],
        )
        CropSupplierData.objects.create(
            crop=self.crop,
            supplier=supplier_b,
            project=self.project,
            supplier_product_name='Beta Product',
            packaging_sizes=[{'size_value': 10, 'size_unit': 'g'}],
        )

        response = self.client.get(f'/openfarmplanner/api/crops/{self.crop.id}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['supplier_data']), 2)
        supplier_names = {entry['supplier']['name'] for entry in response.data['supplier_data']}
        self.assertEqual(supplier_names, {'Supplier A', 'Supplier B'})

    def test_crop_create(self):
        data = {
            'name': 'New Crop',
            'variety': 'Test Variety',
            'growth_duration_days': 6,
            'harvest_duration_days': 2,
            'harvest_method': 'per_plant',
            'project': self.project.id,
        }
        response = self.client.post('/openfarmplanner/api/crops/', data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Crop.objects.count(), 2)
        # Check that display color was auto-generated
        self.assertIn('display_color', response.data)
        self.assertTrue(response.data['display_color'].startswith('#'))

    def test_delete_preview_reports_cascaded_varieties_and_planning_data(self):
        species = CropSpecies.objects.create(name='Daucus carota')
        general = Crop.objects.create(name='Karotte', variety='', project=self.project, crop_species=species)
        nantaise = Crop.objects.create(name='Karotte', variety='Nantaise 2', project=self.project, crop_species=species)
        milan = Crop.objects.create(name='Karotte', variety='Milan', project=self.project, crop_species=species)
        PlantingPlan.objects.create(project=self.project, crop=nantaise, bed=self.bed, planting_date=date(2026, 3, 1))
        PlantingPlan.objects.create(project=self.project, crop=milan, bed=self.bed, planting_date=date(2026, 3, 2))

        response = self.client.get(f'/openfarmplanner/api/crops/{general.id}/delete-preview/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(set(response.data['crop_ids']), {general.id, nantaise.id, milan.id})
        self.assertEqual(response.data['variety_count'], 2)
        self.assertEqual(
            [variety['name'] for variety in response.data['varieties']],
            ['Nantaise 2', 'Milan'],
        )
        self.assertEqual(response.data['planning_data_count'], 2)
        self.assertTrue(response.data['deletes_general_crop'])
        self.assertFalse(response.data['group_without_general'])

    def test_deleting_general_crop_cascades_to_its_varieties_and_undo_restores_all(self):
        species = CropSpecies.objects.create(name='Daucus carota')
        general = Crop.objects.create(name='Karotte', variety='', project=self.project, crop_species=species)
        nantaise = Crop.objects.create(name='Karotte', variety='Nantaise 2', project=self.project, crop_species=species)
        milan = Crop.objects.create(name='Karotte', variety='Milan', project=self.project, crop_species=species)

        response = self.client.delete(f'/openfarmplanner/api/crops/{general.id}/')

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        for crop in (general, nantaise, milan):
            crop.refresh_from_db()
            self.assertIsNotNone(crop.deleted_at)
        self.assertEqual(Crop.objects.filter(crop_species=species).count(), 0)

        restore_response = self.client.post(f'/openfarmplanner/api/crops/{general.id}/undelete/')

        self.assertEqual(restore_response.status_code, status.HTTP_200_OK)
        for crop in (general, nantaise, milan):
            crop.refresh_from_db()
            self.assertIsNone(crop.deleted_at)
        self.assertEqual(Crop.objects.filter(crop_species=species).count(), 3)

    def test_deleting_variety_group_without_general_cascades_to_sibling_varieties(self):
        nantaise = Crop.objects.create(name='Karotte', variety='Nantaise 2', project=self.project)
        milan = Crop.objects.create(name='Karotte', variety='Milan', project=self.project)
        other = Crop.objects.create(name='Pastinake', variety='Halblange', project=self.project)

        response = self.client.delete(f'/openfarmplanner/api/crops/{nantaise.id}/')

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        nantaise.refresh_from_db()
        milan.refresh_from_db()
        other.refresh_from_db()
        self.assertIsNotNone(nantaise.deleted_at)
        self.assertIsNotNone(milan.deleted_at)
        self.assertIsNone(other.deleted_at)

    def test_deleting_single_variety_with_general_keeps_sibling_varieties(self):
        species = CropSpecies.objects.create(name='Daucus carota')
        general = Crop.objects.create(name='Karotte', variety='', project=self.project, crop_species=species)
        nantaise = Crop.objects.create(name='Karotte', variety='Nantaise 2', project=self.project, crop_species=species)
        milan = Crop.objects.create(name='Karotte', variety='Milan', project=self.project, crop_species=species)

        response = self.client.delete(f'/openfarmplanner/api/crops/{nantaise.id}/')

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        general.refresh_from_db()
        nantaise.refresh_from_db()
        milan.refresh_from_db()
        self.assertIsNone(general.deleted_at)
        self.assertIsNotNone(nantaise.deleted_at)
        self.assertIsNone(milan.deleted_at)

    def test_creating_linked_variety_copies_species_fields_only_by_default(self):
        species = CropSpecies.objects.create(name='Solanum lycopersicum')

        response = self.client.post(
            '/openfarmplanner/api/crops/',
            {
                'name': 'Tomato',
                'variety': 'Matina',
                'crop_species': species.id,
                'growth_duration_days': 65,
                'harvest_method': 'per_sqm',
                'expected_yield': '2.50',
                'row_spacing_cm': 50,
                'seed_rate_direct_value': 12,
                'seed_rate_direct_unit': 'seeds_per_lfm',
                'crop_family': 'Solanaceae',
                'nutrient_demand': 'high',
                'rotation_break_years': 4,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        general = Crop.objects.get(
            project=self.project,
            crop_species=species,
            variety_normalized__isnull=True,
        )
        self.assertIsNone(general.growth_duration_days)
        self.assertEqual(general.harvest_method, '')
        self.assertIsNone(general.expected_yield)
        self.assertIsNone(general.row_spacing_m)
        self.assertIsNone(general.seed_rate_direct_value)
        self.assertIsNone(general.seed_rate_direct_unit)
        self.assertEqual(general.crop_family, 'Solanaceae')
        self.assertEqual(general.nutrient_demand, 'high')
        self.assertEqual(general.rotation_break_years, 4)

    def test_creating_linked_variety_can_fill_empty_general_crop_fields(self):
        species = CropSpecies.objects.create(name='Solanum lycopersicum')

        response = self.client.post(
            '/openfarmplanner/api/crops/',
            {
                'name': 'Tomato',
                'variety': 'Matina',
                'crop_species': species.id,
                'growth_duration_days': 65,
                'harvest_method': 'per_sqm',
                'expected_yield': '2.50',
                'row_spacing_cm': 50,
                'seed_rate_direct_value': 12,
                'seed_rate_direct_unit': 'seeds_per_lfm',
                'crop_family': 'Solanaceae',
                'nutrient_demand': 'high',
                'rotation_break_years': 4,
                'copy_values_to_crop': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        general = Crop.objects.get(
            project=self.project,
            crop_species=species,
            variety_normalized__isnull=True,
        )
        self.assertEqual(general.growth_duration_days, 65)
        self.assertEqual(general.harvest_method, 'per_sqm')
        self.assertEqual(str(general.expected_yield), '2.50')
        self.assertEqual(general.row_spacing_m, 0.5)
        self.assertEqual(general.seed_rate_direct_value, 12)
        self.assertEqual(general.seed_rate_direct_unit, 'seeds_per_lfm')
        self.assertEqual(general.crop_family, 'Solanaceae')
        self.assertEqual(general.nutrient_demand, 'high')
        self.assertEqual(general.rotation_break_years, 4)
        # The values landed on the Kultur, not on the Sorte: the Sorte keeps
        # none of the three species-invariant fields itself.
        variety = Crop.objects.get(id=response.data['id'])
        self.assertEqual(variety.crop_family, '')
        self.assertEqual(variety.nutrient_demand, '')
        self.assertIsNone(variety.rotation_break_years)

    def test_copying_variety_values_never_overwrites_general_crop_fields(self):
        species = CropSpecies.objects.create(name='Solanum lycopersicum')
        general = Crop.objects.create(
            name='Tomato',
            variety='',
            project=self.project,
            crop_species=species,
            growth_duration_days=80,
            crop_family='Solanaceae',
            rotation_break_years=6,
        )

        response = self.client.post(
            '/openfarmplanner/api/crops/',
            {
                'name': 'Tomato',
                'variety': 'Matina',
                'crop_species': species.id,
                'growth_duration_days': 65,
                'crop_family': 'Nightshade',
                'nutrient_demand': 'high',
                'rotation_break_years': 4,
                'copy_values_to_crop': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        general.refresh_from_db()
        self.assertEqual(general.growth_duration_days, 80)
        self.assertEqual(general.crop_family, 'Solanaceae')
        self.assertEqual(general.nutrient_demand, 'high')
        self.assertEqual(general.rotation_break_years, 6)
        variety = Crop.objects.get(id=response.data['id'])
        self.assertEqual(variety.crop_family, '')
        self.assertEqual(variety.nutrient_demand, '')
        self.assertIsNone(variety.rotation_break_years)

    def test_creating_first_variety_skips_auto_general_when_name_taken_by_other_species(self):
        tomato_species = CropSpecies.objects.create(name='Solanum lycopersicum')
        pepper_species = CropSpecies.objects.create(name='Capsicum annuum')
        Crop.objects.create(name='Tomate', variety='', project=self.project, crop_species=None)

        response = self.client.post(
            '/openfarmplanner/api/crops/',
            {
                'name': 'Tomate',
                'variety': 'San Marzano',
                'crop_species': tomato_species.id,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertFalse(
            Crop.objects.filter(
                project=self.project,
                crop_species=tomato_species,
                variety_normalized__isnull=True,
            ).exists()
        )
        # Sanity check: a differently-named variety for an unrelated species
        # still gets its own auto-created general crop as usual.
        other_response = self.client.post(
            '/openfarmplanner/api/crops/',
            {
                'name': 'Paprika',
                'variety': 'Sweet',
                'crop_species': pepper_species.id,
            },
            format='json',
        )
        self.assertEqual(other_response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(
            Crop.objects.filter(
                project=self.project,
                crop_species=pepper_species,
                variety_normalized__isnull=True,
            ).exists()
        )

    def test_creating_first_variety_attributes_actor_to_auto_created_general_crop(self):
        species = CropSpecies.objects.create(name='Solanum lycopersicum')

        response = self.client.post(
            '/openfarmplanner/api/crops/',
            {'name': 'Tomato', 'variety': 'Matina', 'crop_species': species.id},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        general = Crop.objects.get(
            project=self.project,
            crop_species=species,
            variety_normalized__isnull=True,
        )
        revision = (
            EntityRevision.objects
            .filter(project=self.project, entity_type='crop', object_id=general.id)
            .order_by('-id')
            .first()
        )
        self.assertIsNotNone(revision)
        self.assertTrue(revision.user_name)

    def test_updating_linked_variety_copies_species_fields_only(self):
        species = CropSpecies.objects.create(name='Solanum lycopersicum')
        general = Crop.objects.create(
            name='Tomato',
            variety='',
            project=self.project,
            crop_species=species,
        )
        variety = Crop.objects.create(
            name='Tomato',
            variety='Matina',
            project=self.project,
            crop_species=species,
        )

        response = self.client.patch(
            f'/openfarmplanner/api/crops/{variety.id}/',
            {
                'growth_duration_days': 65,
                'crop_family': 'Solanaceae',
                'nutrient_demand': 'high',
                'rotation_break_years': 4,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        general.refresh_from_db()
        self.assertIsNone(general.growth_duration_days)
        self.assertEqual(general.crop_family, 'Solanaceae')
        self.assertEqual(general.nutrient_demand, 'high')
        self.assertEqual(general.rotation_break_years, 4)

    def test_crop_create_allows_same_name_with_different_variety(self):
        data = {
            'name': self.crop.name,
            'variety': 'Different Variety',
            'project': self.project.id,
        }
        response = self.client.post('/openfarmplanner/api/crops/', data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_crop_create_allows_new_variety_for_existing_general_crop(self):
        Crop.objects.create(
            name='Bean',
            variety='',
            project=self.project,
        )
        data = {
            'name': 'Bean',
            'variety': 'Faraday',
            'project': self.project.id,
        }

        response = self.client.post('/openfarmplanner/api/crops/', data, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['name'], 'Bean')
        self.assertEqual(response.data['variety'], 'Faraday')

    def test_crop_create_rejects_duplicate_general_name_with_conflict_code(self):
        existing = Crop.objects.create(
            name='General Duplicate Crop',
            variety='',
            project=self.project,
        )
        data = {
            'name': f"  {existing.name.upper()}  ",
            'variety': '',
            'project': self.project.id,
        }

        response = self.client.post('/openfarmplanner/api/crops/', data, format='json')

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['code'], 'crop_name_conflict')

    def test_crop_create_aggregates_name_conflict_with_other_validation_errors(self):
        existing = Crop.objects.create(
            name='General Duplicate Crop',
            variety='',
            project=self.project,
        )
        data = {
            'name': existing.name,
            'variety': '',
            'project': self.project.id,
            'cultivation_types': ['not_a_real_type'],
        }

        response = self.client.post('/openfarmplanner/api/crops/', data, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('name', response.data)
        self.assertIn('cultivation_types', response.data)

    def test_crop_create_and_update_general_data_with_null_variety(self):
        response = self.client.post(
            '/openfarmplanner/api/crops/',
            {
                'name': 'General Tomato',
                'variety': None,
                'crop_family': 'Solanaceae',
                'growth_duration_days': 80,
                'row_spacing_cm': 60,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['variety'], '')

        update_response = self.client.patch(
            f'/openfarmplanner/api/crops/{response.data["id"]}/',
            {'variety': None, 'growth_duration_days': 90, 'notes': 'General baseline'},
            format='json',
        )

        self.assertEqual(update_response.status_code, status.HTTP_200_OK)
        self.assertEqual(update_response.data['variety'], '')
        self.assertEqual(update_response.data['growth_duration_days'], 90)
        self.assertEqual(update_response.data['notes'], 'General baseline')

    def test_seed_rate_constraints_endpoint_returns_backend_owned_unit_rules(self):
        response = self.client.get('/openfarmplanner/api/crops/seed-rate-constraints/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data['units']['seeds_per_plant'],
            {'value_type': 'integer', 'step': 1, 'minimum': 1},
        )
        self.assertEqual(response.data['units']['g_per_m2']['value_type'], 'number')

    def test_crop_create_rejects_fractional_seeds_per_plant_requirement(self):
        response = self.client.post(
            '/openfarmplanner/api/crops/',
            {
                'name': 'Aubergine',
                'variety': '',
                'cultivation_types': ['pre_cultivation'],
                'seed_requirements': {
                    'pre_cultivation': {
                        'value': 1.1,
                        'unit': 'seeds_per_plant',
                    },
                },
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('seed_requirements', response.data)

    def test_crop_create_accepts_whole_number_seeds_per_plant_requirement(self):
        response = self.client.post(
            '/openfarmplanner/api/crops/',
            {
                'name': 'Aubergine',
                'variety': '',
                'cultivation_types': ['pre_cultivation'],
                'seed_requirements': {
                    'pre_cultivation': {
                        'value': 1,
                        'unit': 'seeds_per_plant',
                    },
                },
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['seed_requirements']['pre_cultivation']['value'], 1.0)

    def test_crop_create_rejects_duplicate_name_and_variety(self):
        existing = Crop.objects.create(
            name='Duplicate Test Crop',
            variety='Nantaise',
            project=self.project,
        )
        data = {
            'name': existing.name,
            'variety': existing.variety,
            'project': self.project.id,
        }
        response = self.client.post('/openfarmplanner/api/crops/', data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('name', response.data)

    def test_crop_create_rejects_duplicate_name_and_variety_case_and_whitespace_insensitive(self):
        existing = Crop.objects.create(
            name='Duplicate Whitespace Crop',
            variety='Nantaise',
            project=self.project,
        )
        data = {
            'name': f"  {existing.name.upper()}  ",
            'variety': f"  {existing.variety.upper()}  ",
            'project': self.project.id,
        }
        response = self.client.post('/openfarmplanner/api/crops/', data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('name', response.data)

    def test_crop_duplicate_check_is_project_scoped_and_excludes_public_crops(self):
        Crop.objects.create(name='Tomate', variety='', project=self.project)
        other_project = Project.objects.create(name='Other Project', slug='other-project')
        Crop.objects.create(name='Paprika', variety='', project=other_project)
        PublicCrop.objects.create(name='Bohne', variety='Neckargold', status='published')

        matching_response = self.client.get(
            '/openfarmplanner/api/crops/duplicate-check/',
            {'name': ' tomate ', 'variety': ''},
        )
        other_project_response = self.client.get(
            '/openfarmplanner/api/crops/duplicate-check/',
            {'name': 'Paprika', 'variety': ''},
        )
        public_response = self.client.get(
            '/openfarmplanner/api/crops/duplicate-check/',
            {'name': 'Bohne', 'variety': 'Neckargold'},
        )

        self.assertEqual(matching_response.status_code, status.HTTP_200_OK)
        self.assertTrue(matching_response.data['exists'])
        self.assertTrue(matching_response.data['name_exists'])
        self.assertFalse(other_project_response.data['exists'])
        self.assertFalse(other_project_response.data['name_exists'])
        self.assertFalse(public_response.data['exists'])
        self.assertFalse(public_response.data['name_exists'])

    def test_crop_duplicate_check_supports_general_data_without_variety(self):
        Crop.objects.create(name='General Bean', variety='', project=self.project)

        response = self.client.get(
            '/openfarmplanner/api/crops/duplicate-check/',
            {'name': ' general bean ', 'variety': ''},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['exists'])

    def test_crop_duplicate_check_name_exists_ignores_variety_only_matches(self):
        Crop.objects.create(name='Karotte', variety='Nantaise 2', project=self.project)
        Crop.objects.create(name='Karotte', variety='Milan', project=self.project)

        response = self.client.get(
            '/openfarmplanner/api/crops/duplicate-check/',
            {'name': 'Karotte', 'variety': ''},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data['exists'])
        self.assertFalse(response.data['name_exists'])

    def test_crop_duplicate_check_ignores_invalid_exclusion_id(self):
        Crop.objects.create(name='Tomate', variety='', project=self.project)

        response = self.client.get(
            '/openfarmplanner/api/crops/duplicate-check/',
            {'name': 'Tomate', 'variety': '', 'exclude_id': 'not-an-integer'},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['exists'])
        self.assertTrue(response.data['name_exists'])

    def test_public_crop_match_returns_exact_normalized_match(self):
        PublicCrop.objects.create(name='Tomate', variety='Roma', status='published')

        response = self.client.get(
            '/openfarmplanner/api/public-crops/match/',
            {'name': ' tomate ', 'variety': 'ROMA'},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['exists'])
        self.assertEqual(response.data['crop']['name'], 'Tomate')

    def test_link_public_crop_updates_private_reference_without_creating_public_entry(self):
        species = CropSpecies.objects.get(name_normalized='tomate')
        public_crop = PublicCrop.objects.create(
            name='Tomate',
            variety='Roma',
            status=PublicCrop.STATUS_PUBLISHED,
            crop_species=species,
            version=4,
        )
        private_crop = Crop.objects.create(
            name='Paradeiser',
            variety='Roma',
            growth_duration_days=88,
            project=self.project,
        )
        public_count_before = PublicCrop.objects.count()

        response = self.client.post(
            f'/openfarmplanner/api/crops/{private_crop.id}/link-public-crop/',
            {'public_crop_id': public_crop.id},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        private_crop.refresh_from_db()
        self.assertEqual(PublicCrop.objects.count(), public_count_before)
        self.assertEqual(private_crop.source_public_crop_id, public_crop.id)
        self.assertEqual(private_crop.source_public_version, 4)
        self.assertEqual(private_crop.crop_species_id, species.id)
        self.assertEqual(private_crop.name, 'Paradeiser')
        self.assertTrue(private_crop.is_modified_from_source)

    def test_crop_create_with_all_fields(self):
        """Test creating crop with all manual planning fields"""
        data = {
            'name': 'Comprehensive Crop',
            'variety': 'Special Edition',
            'notes': 'Test notes',
            'crop_family': 'Solanaceae',
            'nutrient_demand': 'high',
            'rotation_break_years': 3,
            'cultivation_type': 'pre_cultivation',
            'growth_duration_days': 8,
            'harvest_duration_days': 3,
            'propagation_duration_days': 4,
            'harvest_method': 'per_plant',
            'expected_yield': 500.0,
            'distance_within_row_cm': 40.0,
            'row_spacing_cm': 60.0,
            'sowing_depth_cm': 1.5,
            'thousand_kernel_weight_g': 472.02,
            'display_color': '#FF5733',
            'project': self.project.id,
        }
        response = self.client.post('/openfarmplanner/api/crops/', data, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['name'], 'Comprehensive Crop')
        self.assertEqual(response.data['crop_family'], 'Solanaceae')
        self.assertEqual(response.data['nutrient_demand'], 'high')
        self.assertEqual(response.data['rotation_break_years'], 3)
        self.assertEqual(response.data['thousand_kernel_weight_g'], 472.02)
        self.assertEqual(response.data['display_color'], '#FF5733')

    def test_crop_create_without_durations(self):
        """Test that creating crop without durations is allowed"""
        data = {
            'name': 'Crop Without Durations',
            'variety': 'Optional Timing',
            'supplier_name': self.supplier.name,
            'project': self.project.id,
        }
        response = self.client.post('/openfarmplanner/api/crops/', data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIsNone(response.data['growth_duration_days'])
        self.assertIsNone(response.data['harvest_duration_days'])
        self.assertIsNone(response.data['rotation_break_years'])

    def test_crop_create_rejects_negative_rotation_break_years(self):
        """Test that a negative rotation break in years is rejected by the API"""
        data = {
            'name': 'Crop With Bad Rotation Break',
            'rotation_break_years': -2,
            'project': self.project.id,
        }
        response = self.client.post('/openfarmplanner/api/crops/', data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('rotation_break_years', response.data)

    def test_crop_create_invalid_display_color(self):
        """Test that invalid display color format is rejected"""
        data = {
            'name': 'Test Crop',
            'growth_duration_days': 6,
            'harvest_duration_days': 2,
            'harvest_method': 'per_plant',
            'display_color': 'invalid',  # Not hex format
            'project': self.project.id,
        }
        response = self.client.post('/openfarmplanner/api/crops/', data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('display_color', response.data)

    def test_crop_update(self):
        """Test updating a crop"""
        data = {
            'name': 'Updated Crop',
            'growth_duration_days': 8,
            'harvest_duration_days': 3,
            'harvest_method': 'per_plant',
            'crop_family': 'Updated Family',
            'nutrient_demand': 'medium',
            'project': self.project.id,
        }
        response = self.client.put(f'/openfarmplanner/api/crops/{self.crop.id}/', data, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['name'], 'Updated Crop')
        self.assertEqual(response.data['crop_family'], 'Updated Family')

    def test_crop_update_persists_thousand_kernel_weight_on_crop(self):
        data = {
            'name': self.crop.name,
            'variety': self.crop.variety,
            'growth_duration_days': self.crop.growth_duration_days,
            'harvest_duration_days': self.crop.harvest_duration_days,
            'harvest_method': self.crop.harvest_method,
            'thousand_kernel_weight_g': 4.2,
            'project': self.project.id,
        }
        response = self.client.put(f'/openfarmplanner/api/crops/{self.crop.id}/', data, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['thousand_kernel_weight_g'], 4.2)
        self.crop.refresh_from_db()
        self.assertEqual(float(self.crop.thousand_kernel_weight_g), 4.2)

    def test_crop_rename_cascades_to_sibling_varieties_grouped_by_name(self):
        """Renaming one row of a crop (grouped by name, no crop_species link)
        must rename its siblings too, so the variety stays in the same crop
        group instead of splitting off into what looks like a new crop."""
        variety_a = Crop.objects.create(
            name=self.crop.name, variety='Variety A', project=self.project,
        )
        variety_b = Crop.objects.create(
            name=self.crop.name, variety='Variety B', project=self.project,
        )
        unrelated = Crop.objects.create(
            name='Unrelated Crop', variety='', project=self.project,
        )

        response = self.client.patch(
            f'/openfarmplanner/api/crops/{variety_a.id}/',
            {'name': 'Renamed Crop'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.crop.refresh_from_db()
        variety_b.refresh_from_db()
        unrelated.refresh_from_db()
        self.assertEqual(self.crop.name, 'Renamed Crop')
        self.assertEqual(variety_b.name, 'Renamed Crop')
        self.assertEqual(unrelated.name, 'Unrelated Crop')

    def test_crop_rename_cascades_to_siblings_grouped_by_crop_species(self):
        """When rows are linked via crop_species, renaming groups by that
        link instead of the (possibly stale) name, matching the frontend's
        own grouping logic."""
        species = CropSpecies.objects.create(name='Rename Species Test')
        self.crop.crop_species = species
        self.crop.save(update_fields=['crop_species'])
        linked_variety = Crop.objects.create(
            name=self.crop.name, variety='Linked Variety', crop_species=species,
            project=self.project,
        )
        same_name_unlinked = Crop.objects.create(
            name=self.crop.name, variety='Unlinked Same Name', project=self.project,
        )

        response = self.client.patch(
            f'/openfarmplanner/api/crops/{self.crop.id}/',
            {'name': 'Renamed Species Crop'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        linked_variety.refresh_from_db()
        same_name_unlinked.refresh_from_db()
        self.assertEqual(linked_variety.name, 'Renamed Species Crop')
        self.assertEqual(same_name_unlinked.name, 'API Test Crop')

    def test_crop_partial_update_persists_thousand_kernel_weight_on_crop(self):
        response = self.client.patch(
            f'/openfarmplanner/api/crops/{self.crop.id}/',
            {'thousand_kernel_weight_g': 3.8},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['thousand_kernel_weight_g'], 3.8)
        self.crop.refresh_from_db()
        self.assertEqual(float(self.crop.thousand_kernel_weight_g), 3.8)

    def test_crop_update_with_seed_packages_payload_from_get(self):
        """PUT with seed package objects (including id/crop) should stay valid."""
        supplier = Supplier.objects.create(name='Seed Supplier', homepage_url='https://seed-supplier.example', project=self.project)
        crop = Crop.objects.create(
            name='Payload Crop',
            variety='Classic',
            supplier=supplier,
            growth_duration_days=10,
            harvest_duration_days=2,
            harvest_method='per_plant',
            project=self.project,
        )
        package = SeedPackage.objects.create(crop=crop, size_value='25.0', size_unit='g', project=self.project)

        payload = {
            'id': crop.id,
            'name': crop.name,
            'variety': crop.variety,
            'supplier_id': supplier.id,
            'growth_duration_days': crop.growth_duration_days,
            'harvest_duration_days': crop.harvest_duration_days,
            'harvest_method': crop.harvest_method,
            'project': self.project.id,
            'seed_packages': [
                {
                    'id': package.id,
                    'crop': crop.id,
                    'size_value': 25.0,
                    'size_unit': 'g',
                                    }
            ],
        }

        response = self.client.put(f'/openfarmplanner/api/crops/{crop.id}/', payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['seed_packages']), 1)
        self.assertEqual(response.data['seed_packages'][0]['size_unit'], 'g')
        self.assertEqual(float(response.data['seed_packages'][0]['size_value']), 25.0)
        self.assertEqual(SeedPackage.objects.get(crop=crop).project, self.project)

    def test_crop_update_creates_supplier_data_without_crop_in_payload(self):
        """Nested supplier rows should inherit the parent crop automatically."""
        supplier = Supplier.objects.create(name='Nested Supplier', homepage_url='https://nested-supplier.example', project=self.project)
        crop = Crop.objects.create(
            name='Nested Crop',
            variety='Create',
            growth_duration_days=10,
            harvest_duration_days=3,
            harvest_method='per_plant',
            project=self.project,
        )
        payload = {
            'id': crop.id,
            'name': crop.name,
            'variety': crop.variety,
            'growth_duration_days': crop.growth_duration_days,
            'harvest_duration_days': crop.harvest_duration_days,
            'harvest_method': crop.harvest_method,
            'project': self.project.id,
            'supplier_data_input': [
                {
                    'supplier_id': supplier.id,
                    'supplier_product_name': 'Nested product',
                    'packaging_sizes': [{'size_value': 50, 'size_unit': 'g'}],
                }
            ],
        }

        response = self.client.put(f'/openfarmplanner/api/crops/{crop.id}/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['supplier_data']), 1)
        row = CropSupplierData.objects.get(crop=crop, supplier=supplier)
        self.assertEqual(row.supplier_product_name, 'Nested product')
        self.assertEqual(row.project_id, self.project.id)

    def test_crop_update_updates_existing_supplier_data_rows(self):
        """Rows with ids should update in place instead of being recreated."""
        supplier = Supplier.objects.create(name='Update Supplier', homepage_url='https://update-supplier.example', project=self.project)
        crop = Crop.objects.create(
            name='Nested Update',
            variety='Update',
            growth_duration_days=10,
            harvest_duration_days=3,
            harvest_method='per_plant',
            project=self.project,
        )
        existing = CropSupplierData.objects.create(
            crop=crop,
            supplier=supplier,
            project=self.project,
            supplier_product_name='Before',
        )
        payload = {
            'id': crop.id,
            'name': crop.name,
            'variety': crop.variety,
            'growth_duration_days': crop.growth_duration_days,
            'harvest_duration_days': crop.harvest_duration_days,
            'harvest_method': crop.harvest_method,
            'project': self.project.id,
            'supplier_data_input': [
                {
                    'id': existing.id,
                    'supplier_id': supplier.id,
                    'supplier_product_name': 'After',
                    'packaging_sizes': [{'size_value': 25, 'size_unit': 'g'}],
                }
            ],
        }

        response = self.client.put(f'/openfarmplanner/api/crops/{crop.id}/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(CropSupplierData.objects.filter(crop=crop).count(), 1)
        existing.refresh_from_db()
        self.assertEqual(existing.supplier_product_name, 'After')
        self.assertEqual(existing.packaging_sizes, [{'size_value': 25, 'size_unit': 'g'}])

    def test_crop_update_changes_existing_supplier_data_supplier(self):
        """Changing the supplier on an existing supplier-data row should persist."""
        supplier_a = Supplier.objects.create(name='Lieferant2', homepage_url='https://supplier-a.example', project=self.project)
        supplier_b = Supplier.objects.create(name='Reinsaat', homepage_url='https://reinsaat.example', project=self.project)
        crop = Crop.objects.create(
            name='Supplier Switch',
            variety='A to B',
            growth_duration_days=10,
            harvest_duration_days=3,
            harvest_method='per_plant',
            project=self.project,
        )
        existing = CropSupplierData.objects.create(
            crop=crop,
            supplier=supplier_a,
            project=self.project,
            supplier_product_name='Before',
            packaging_sizes=[{'size_value': 10, 'size_unit': 'g'}],
        )
        payload = {
            'id': crop.id,
            'name': crop.name,
            'variety': crop.variety,
            'growth_duration_days': crop.growth_duration_days,
            'harvest_duration_days': crop.harvest_duration_days,
            'harvest_method': crop.harvest_method,
            'project': self.project.id,
            'supplier_data_input': [
                {
                    'id': existing.id,
                    'supplier_id': supplier_b.id,
                    'supplier_product_name': 'After',
                    'packaging_sizes': [{'size_value': 25, 'size_unit': 'g'}],
                }
            ],
        }

        response = self.client.put(f'/openfarmplanner/api/crops/{crop.id}/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(CropSupplierData.objects.filter(crop=crop).count(), 1)
        existing.refresh_from_db()
        self.assertEqual(existing.supplier_id, supplier_b.id)
        self.assertEqual(existing.supplier_product_name, 'After')
        self.assertEqual(response.data['supplier_data'][0]['supplier']['name'], 'Reinsaat')

        payload['supplier_data_input'][0]['supplier_id'] = supplier_a.id
        payload['supplier_data_input'][0]['supplier_product_name'] = 'Back to A'

        response = self.client.put(f'/openfarmplanner/api/crops/{crop.id}/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(CropSupplierData.objects.filter(crop=crop).count(), 1)
        existing.refresh_from_db()
        self.assertEqual(existing.supplier_id, supplier_a.id)
        self.assertEqual(existing.supplier_product_name, 'Back to A')
        self.assertEqual(response.data['supplier_data'][0]['supplier']['name'], 'Lieferant2')

    def test_crop_update_supplier_data_without_crop_field_regression(self):
        """Regression: nested supplier rows must not fail with crop required 400."""
        supplier = Supplier.objects.create(name='Regression Supplier', homepage_url='https://regression-supplier.example', project=self.project)
        payload = {
            'id': self.crop.id,
            'name': self.crop.name,
            'growth_duration_days': self.crop.growth_duration_days,
            'harvest_duration_days': self.crop.harvest_duration_days,
            'project': self.project.id,
            'supplier_data_input': [
                {
                    'supplier_id': supplier.id,
                    'supplier_product_name': 'Regression row',
                }
            ],
        }

        response = self.client.put(f'/openfarmplanner/api/crops/{self.crop.id}/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotIn('crop', response.data)
        self.assertEqual(CropSupplierData.objects.filter(crop=self.crop, supplier=supplier).count(), 1)

    def test_crop_update_ignores_empty_supplier_data_rows(self):
        payload = {
            'id': self.crop.id,
            'name': self.crop.name,
            'growth_duration_days': self.crop.growth_duration_days,
            'harvest_duration_days': self.crop.harvest_duration_days,
            'project': self.project.id,
            'supplier_data_input': [
                {
                    'packaging_sizes': [],
                    'supplier_product_name': '',
                    'notes': '',
                }
            ],
        }

        response = self.client.put(f'/openfarmplanner/api/crops/{self.crop.id}/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(CropSupplierData.objects.filter(crop=self.crop).count(), 0)

    def test_crop_update_rejects_supplier_data_without_supplier(self):
        payload = {
            'id': self.crop.id,
            'name': self.crop.name,
            'growth_duration_days': self.crop.growth_duration_days,
            'harvest_duration_days': self.crop.harvest_duration_days,
            'project': self.project.id,
            'supplier_data_input': [
                {
                    'supplier_product_name': 'Product without supplier',
                    'packaging_sizes': [{'size_value': 25, 'size_unit': 'g'}],
                }
            ],
        }

        response = self.client.put(f'/openfarmplanner/api/crops/{self.crop.id}/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('supplier_data_input', response.data)
        self.assertEqual(CropSupplierData.objects.filter(crop=self.crop).count(), 0)

    def test_seed_demand_uses_supplier_specific_packages_for_existing_crops(self):
        """Supplier-scoped package sizes should appear in seed demand for existing crops."""
        crop = Crop.objects.create(
            name='Legacy Bean',
            variety='Classic',
            growth_duration_days=70,
            harvest_duration_days=14,
            harvest_method='per_plant',
            seed_rate_value=5,
            seed_rate_unit='g_per_m2',
            project=self.project,
        )
        supplier = Supplier.objects.create(
            name='Bean Supplier',
            homepage_url='https://beans.example',
            project=self.project,
        )
        CropSupplierData.objects.create(
            crop=crop,
            supplier=supplier,
            project=self.project,
            packaging_sizes=[{'size_value': 25.0, 'size_unit': 'g'}],
        )
        PlantingPlan.objects.create(
            crop=crop,
            bed=self.bed,
            planting_date=date(2025, 3, 1),
            area_usage_sqm=5,
            project=self.project,
        )

        response = self.client.get('/openfarmplanner/api/seed-demand/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        row = next(item for item in response.data['results'] if item['crop_name'] == 'Legacy Bean')
        self.assertEqual(row['seed_packages'], [{'size_value': 25.0, 'size_unit': 'g'}])
        self.assertEqual(row['package_suggestion']['pack_count'], 1)

    def test_crop_supplier_product_url_domain_mismatch_rejected(self):
        data = {
            'name': 'Crop with URL mismatch',
            'variety': 'X',
            'supplier_id': self.supplier.id,
            'supplier_product_url': 'https://other.example/product',
            'growth_duration_days': 8,
            'harvest_duration_days': 3,
            'harvest_method': 'per_plant',
            'project': self.project.id,
        }
        response = self.client.post('/openfarmplanner/api/crops/', data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('supplier_product_url', response.data)


class CropInheritanceApiTest(ProjectApiTestCase):
    """A Sorte's API row exposes its own values and the resolved effective ones."""

    def setUp(self):
        super().setUp()
        self.species = CropSpecies.objects.create(name='Daucus carota')
        self.general = Crop.objects.create(
            name='Karotte',
            variety='',
            project=self.project,
            crop_species=self.species,
            growth_duration_days=70,
            harvest_duration_days=21,
            row_spacing_m=0.3,
            distance_within_row_m=0.05,
            crop_family='Apiaceae',
            seed_rate_direct_value=2.0,
            seed_rate_direct_unit='g/m²',
        )
        self.sorte = Crop.objects.create(
            name='Karotte',
            variety='Nantaise',
            project=self.project,
            crop_species=self.species,
            growth_duration_days=65,
        )

    def _row(self, crop: Crop) -> dict:
        response = self.client.get(f'/openfarmplanner/api/crops/{crop.id}/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data

    def test_sorte_exposes_raw_and_effective_values_per_field(self):
        row = self._row(self.sorte)
        self.assertEqual(row['general_crop'], self.general.id)
        # Raw own values stay untouched, so the client can still tell them apart.
        self.assertEqual(row['growth_duration_days'], 65)
        self.assertIsNone(row['harvest_duration_days'])
        self.assertEqual(row['effective_values']['growth_duration_days'], 65)
        self.assertEqual(row['effective_values']['harvest_duration_days'], 21)
        self.assertEqual(row['inherited_fields'].count('harvest_duration_days'), 1)
        self.assertNotIn('growth_duration_days', row['inherited_fields'])

    def test_effective_values_use_the_api_units_of_the_own_fields(self):
        row = self._row(self.sorte)
        self.assertIsNone(row['row_spacing_cm'])
        self.assertEqual(row['effective_values']['row_spacing_cm'], 30.0)
        self.assertIn('row_spacing_cm', row['inherited_fields'])
        # Units go through the same normalization as the own-value field.
        self.assertEqual(row['effective_values']['seed_rate_direct_unit'], 'g_per_m2')

    def test_plants_per_m2_is_computed_from_the_effective_spacing(self):
        """A Sorte with inherited spacing must report the same plants/m² the
        planting-plan side plans with — otherwise the grid shows a plant count
        it then refuses to let the user edit."""
        row = self._row(self.sorte)
        self.assertIsNone(row['row_spacing_cm'])
        # 30 cm x 5 cm -> 10000 / 150.
        self.assertEqual(float(row['plants_per_m2']), 66.67)

    def test_an_own_spacing_value_still_drives_plants_per_m2(self):
        self.sorte.row_spacing_m = 0.5
        self.sorte.save(update_fields=['row_spacing_m'])
        row = self._row(self.sorte)
        # 50 cm x the inherited 5 cm -> 10000 / 250.
        self.assertEqual(float(row['plants_per_m2']), 40.0)

    def test_general_kultur_has_no_inheritance_payload(self):
        row = self._row(self.general)
        self.assertIsNone(row['general_crop'])
        self.assertEqual(row['effective_values'], {})
        self.assertEqual(row['inherited_fields'], [])

    def test_free_text_sorte_without_species_keeps_its_own_values_only(self):
        free_text = Crop.objects.create(
            name='Karotte', variety='Freitext', project=self.project,
        )
        row = self._row(free_text)
        self.assertIsNone(row['general_crop'])
        self.assertEqual(row['effective_values'], {})
        self.assertEqual(row['inherited_fields'], [])

    def test_clearing_an_own_value_falls_back_to_the_general_value(self):
        response = self.client.patch(
            f'/openfarmplanner/api/crops/{self.sorte.id}/',
            {'growth_duration_days': None},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        row = self._row(self.sorte)
        self.assertIsNone(row['growth_duration_days'])
        self.assertEqual(row['effective_values']['growth_duration_days'], 70)
        self.assertIn('growth_duration_days', row['inherited_fields'])

    def test_species_invariant_fields_are_read_only_for_a_linked_sorte(self):
        """crop_family / nutrient_demand / rotation_break_years belong to the
        Kultur, so an attempted Sorte override is rejected explicitly."""
        self.general.nutrient_demand = 'medium'
        self.general.rotation_break_years = 3
        self.general.save(update_fields=['nutrient_demand', 'rotation_break_years'])

        response = self.client.patch(
            f'/openfarmplanner/api/crops/{self.sorte.id}/',
            {'crop_family': 'Wrong', 'nutrient_demand': 'high', 'rotation_break_years': 9},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        for field in ('crop_family', 'nutrient_demand', 'rotation_break_years'):
            self.assertIn(field, response.data)

        self.sorte.refresh_from_db()
        self.assertEqual(self.sorte.crop_family, '')
        self.assertEqual(self.sorte.nutrient_demand, '')
        self.assertIsNone(self.sorte.rotation_break_years)

        row = self._row(self.sorte)
        self.assertEqual(row['effective_values']['crop_family'], 'Apiaceae')
        self.assertEqual(row['effective_values']['nutrient_demand'], 'medium')
        self.assertEqual(row['effective_values']['rotation_break_years'], 3)
        for field in ('crop_family', 'nutrient_demand', 'rotation_break_years'):
            self.assertIn(field, row['inherited_fields'])

    def test_unrelated_update_does_not_silently_clear_legacy_invariant_values(self):
        Crop.objects.filter(pk=self.sorte.pk).update(crop_family='Legacy')

        response = self.client.patch(
            f'/openfarmplanner/api/crops/{self.sorte.id}/',
            {'notes': 'Unrelated edit'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.sorte.refresh_from_db()
        self.assertEqual(self.sorte.crop_family, 'Legacy')

    def test_linked_sorte_ignores_a_raw_species_invariant_value_from_the_db(self):
        """A value written straight to the column (pre-rule, or by a migration
        that has not run yet) is still ignored when resolving."""
        Crop.objects.filter(pk=self.sorte.pk).update(
            crop_family='Legacy', rotation_break_years=7,
        )
        row = self._row(self.sorte)
        self.assertEqual(row['crop_family'], 'Legacy')  # raw field is untouched
        self.assertEqual(row['effective_values']['crop_family'], 'Apiaceae')
        self.assertIn('crop_family', row['inherited_fields'])

    def test_free_text_sorte_can_still_edit_species_invariant_fields(self):
        free_text = Crop.objects.create(
            name='Karotte', variety='Freitext', project=self.project,
        )
        response = self.client.patch(
            f'/openfarmplanner/api/crops/{free_text.id}/',
            {'crop_family': 'Apiaceae', 'rotation_break_years': 2},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        free_text.refresh_from_db()
        self.assertEqual(free_text.crop_family, 'Apiaceae')
        self.assertEqual(free_text.rotation_break_years, 2)

    def test_general_kultur_can_still_edit_species_invariant_fields(self):
        species = CropSpecies.objects.create(name='Petroselinum crispum')
        general = Crop.objects.create(
            name='Petersilie', variety='', project=self.project, crop_species=species,
        )
        response = self.client.patch(
            f'/openfarmplanner/api/crops/{general.id}/',
            {'crop_family': 'Apiaceae', 'rotation_break_years': 5},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        general.refresh_from_db()
        self.assertEqual(general.crop_family, 'Apiaceae')
        self.assertEqual(general.rotation_break_years, 5)

    def test_inheritance_payload_costs_one_query_for_a_whole_list_page(self):
        for index in range(5):
            Crop.objects.create(
                name='Karotte', variety=f'Sorte {index}',
                project=self.project, crop_species=self.species,
            )
        with self.assertNumQueries(11):
            response = self.client.get('/openfarmplanner/api/crops/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        inherited_rows = [
            item for item in response.data['results'] if item['general_crop'] == self.general.id
        ]
        self.assertEqual(len(inherited_rows), 6)
        for item in inherited_rows:
            self.assertEqual(item['effective_values']['harvest_duration_days'], 21)


class LegacyCultureEndpointAliasTest(ProjectApiTestCase):
    """The pre-"Crop" paths must keep working after the rename.

    A deploy restarts the backend while browsers keep the JS bundle they
    already loaded, and external agent integrations are not ours to update, so
    both keep calling the old spellings until they are replaced.
    """

    def test_legacy_crop_list_and_detail_serve_the_same_rows(self):
        crop = Crop.objects.create(name='Legacy Kale', project=self.project)

        list_response = self.client.get('/openfarmplanner/api/cultures/')
        detail_response = self.client.get(f'/openfarmplanner/api/cultures/{crop.id}/')

        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)
        self.assertEqual(detail_response.data['name'], 'Legacy Kale')
        self.assertIn(crop.id, [row['id'] for row in list_response.data['results']])

    def test_legacy_crop_path_still_writes(self):
        response = self.client.post(
            '/openfarmplanner/api/cultures/',
            {
                'name': 'Written Through Legacy Path',
                'growth_duration_days': 8,
                'harvest_duration_days': 3,
                'harvest_method': 'per_plant',
                'project': self.project.id,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(Crop.objects.filter(name='Written Through Legacy Path').exists())

    def test_legacy_crop_detail_routes_expose_custom_actions(self):
        crop = Crop.objects.create(name='Legacy History', project=self.project)

        response = self.client.get(f'/openfarmplanner/api/cultures/{crop.id}/history/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_legacy_supplier_data_and_public_crop_paths_resolve(self):
        public_crop = PublicCrop.objects.create(
            name='Legacy Public', variety='Alpha', status=PublicCrop.STATUS_PUBLISHED
        )

        supplier_data_response = self.client.get('/openfarmplanner/api/culture-supplier-data/')
        public_list_response = self.client.get('/openfarmplanner/api/public-cultures/')
        public_detail_response = self.client.get(
            f'/openfarmplanner/api/public-cultures/{public_crop.id}/'
        )

        self.assertEqual(supplier_data_response.status_code, status.HTTP_200_OK)
        self.assertEqual(public_list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(public_detail_response.status_code, status.HTTP_200_OK)

    def test_legacy_paths_stay_out_of_the_browsable_api_index(self):
        """Only the current names should be discoverable."""
        response = self.client.get('/openfarmplanner/api/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('crops', response.data)
        self.assertNotIn('cultures', response.data)
