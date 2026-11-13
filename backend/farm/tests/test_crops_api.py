"""API tests for crops, supplier data, and seed demand."""

from datetime import date

from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework import status

from crops.models import CropSpecies, PlantFamily
from farm.models import (
    Crop,
    CropSupplierData,
    CropTaskTemplate,
    CropTimingWindow,
    EntityRevision,
    PlantingPlan,
    Project,
    PublicCrop,
    Season,
    SeedPackage,
    Supplier,
    Task,
)
from farm.services.tasks import generate_plan_tasks
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
        families = ['Brassicaceae', 'Solanaceae', 'Apiaceae', 'Fabaceae', 'Poaceae']
        for index in range(5):
            crop = Crop.objects.create(
                name=f'Extra Crop {index}',
                growth_duration_days=7,
                harvest_duration_days=2,
                project=self.project,
                supplier=self.supplier,
                crop_family_id=families[index],
            )
            CropTimingWindow.objects.create(
                crop=crop, kind='direct_sowing', unit='decade',
                start_month=3, start_decade=1, end_month=5, end_decade=3,
            )

        # One of the queries resolves the project's general Kulturen for the
        # whole page (see CropSerializer._general_crop_index); two more load
        # the plant-family list with its translations once for the page
        # (crop_family_display_name, effective_rotation_break_years); one
        # loads the project's timing windows (timing_windows,
        # effective_timing_windows, sowing_months).
        with self.assertNumQueries(12):
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

    def test_legacy_duplicate_general_group_cannot_rename_or_delete(self):
        species = CropSpecies.objects.create(name='Legacy synthetic tomato')
        first = Crop.objects.create(project=self.project, name='Legacy tomato', crop_species=species)
        second = Crop.objects.create(project=self.project, name='Legacy tomato (2)', crop_species=species)
        varieties = [Crop.objects.create(project=self.project, name=first.name, crop_species=species,
                                        variety=f'Legacy variety {index}') for index in range(12)]
        plan = PlantingPlan.objects.create(project=self.project, crop=varieties[0], bed=self.bed,
                                          planting_date=date(2026, 3, 1))
        response = self.client.patch(f'/openfarmplanner/api/crops/{first.pk}/',
                                     {'name': 'Renamed tomato'}, format='json')
        self.assertEqual(response.status_code, 409)
        first.refresh_from_db()
        self.assertEqual(first.name, 'Legacy tomato')
        preview = self.client.get(f'/openfarmplanner/api/crops/{second.pk}/delete-preview/')
        self.assertEqual(set(preview.data['crop_ids']), {first.pk, second.pk, *[v.pk for v in varieties]})
        self.assertEqual(preview.data['planning_data_count'], 1)
        response = self.client.delete(f'/openfarmplanner/api/crops/{second.pk}/')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(Crop.objects.filter(crop_species=species, project=self.project).count(), 14)
        plan.refresh_from_db()
        self.assertEqual(plan.crop_id, varieties[0].pk)

    def test_general_species_identity_cannot_be_duplicated_by_crud(self):
        species = CropSpecies.objects.create(name='Identity guard species')
        general = Crop.objects.create(
            project=self.project, name='Existing identity', crop_species=species,
        )
        response = self.client.post('/openfarmplanner/api/crops/', {
            'name': 'Another label', 'crop_species': species.pk,
        }, format='json')
        self.assertEqual(response.status_code, 409, response.data)
        unclassified = Crop.objects.create(project=self.project, name='Unclassified identity')
        response = self.client.patch(f'/openfarmplanner/api/crops/{unclassified.pk}/', {
            'crop_species': species.pk,
        }, format='json')
        self.assertEqual(response.status_code, 409, response.data)
        unclassified.refresh_from_db()
        self.assertIsNone(unclassified.crop_species_id)
        remaining = Crop.objects.get(project=self.project, crop_species=species)
        self.assertEqual(remaining.pk, general.pk)

    def test_undelete_rejects_conflicting_general_without_partial_restoration(self):
        species = CropSpecies.objects.create(name='Restore guard species')
        general = Crop.objects.create(
            project=self.project, name='Old general', crop_species=species,
        )
        variety = Crop.objects.create(
            project=self.project, name=general.name, crop_species=species, variety='Old variety',
        )
        deleted = self.client.delete(f'/openfarmplanner/api/crops/{general.pk}/')
        self.assertEqual(deleted.status_code, 204)
        replacement = Crop.objects.create(
            project=self.project, name='Replacement', crop_species=species,
        )
        response = self.client.post(f'/openfarmplanner/api/crops/{general.pk}/undelete/')
        self.assertEqual(response.status_code, 409, response.data)
        for row in (general, variety):
            row.refresh_from_db()
            self.assertIsNotNone(row.deleted_at)
        self.assertEqual(list(Crop.objects.filter(crop_species=species)), [replacement])

    def test_revision_restore_rejects_conflicting_general(self):
        species = CropSpecies.objects.create(name='Revision guard species')
        general = Crop.objects.create(
            project=self.project, name='Historical general', crop_species=species,
        )
        revision = EntityRevision.objects.filter(
            entity_type='crop', object_id=general.pk,
        ).latest('id')
        self.client.delete(f'/openfarmplanner/api/crops/{general.pk}/')
        replacement = Crop.objects.create(
            project=self.project, name='Current general', crop_species=species,
        )
        response = self.client.post(f'/openfarmplanner/api/crops/{general.pk}/restore/', {
            'history_id': revision.pk,
        }, format='json')
        self.assertEqual(response.status_code, 409, response.data)
        general.refresh_from_db()
        self.assertIsNotNone(general.deleted_at)
        self.assertEqual(list(Crop.objects.filter(crop_species=species)), [replacement])

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
        self.assertEqual(general.crop_family_id, 'Solanaceae')
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
        self.assertEqual(general.crop_family_id, 'Solanaceae')
        self.assertEqual(general.nutrient_demand, 'high')
        self.assertEqual(general.rotation_break_years, 4)
        # The values landed on the Kultur, not on the Sorte: the Sorte keeps
        # none of the three species-invariant fields itself.
        variety = Crop.objects.get(id=response.data['id'])
        self.assertIsNone(variety.crop_family_id)
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
            crop_family_id='Solanaceae',
            rotation_break_years=6,
        )

        response = self.client.post(
            '/openfarmplanner/api/crops/',
            {
                'name': 'Tomato',
                'variety': 'Matina',
                'crop_species': species.id,
                'growth_duration_days': 65,
                'nutrient_demand': 'high',
                'copy_values_to_crop': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        general.refresh_from_db()
        # The Kultur keeps every value it already had; only its gaps are filled.
        self.assertEqual(general.growth_duration_days, 80)
        self.assertEqual(general.crop_family_id, 'Solanaceae')
        self.assertEqual(general.nutrient_demand, 'high')
        self.assertEqual(general.rotation_break_years, 6)
        variety = Crop.objects.get(id=response.data['id'])
        self.assertIsNone(variety.crop_family_id)
        self.assertEqual(variety.nutrient_demand, '')
        self.assertIsNone(variety.rotation_break_years)

    def test_creating_variety_rejects_invariant_values_the_general_crop_contradicts(self):
        """A Sorte value that the Kultur already contradicts is rejected, not
        silently dropped: the caller has to change it on the Kultur."""
        species = CropSpecies.objects.create(name='Solanum lycopersicum')
        general = Crop.objects.create(
            name='Tomato',
            variety='',
            project=self.project,
            crop_species=species,
            crop_family_id='Solanaceae',
            rotation_break_years=6,
        )

        response = self.client.post(
            '/openfarmplanner/api/crops/',
            {
                'name': 'Tomato',
                'variety': 'Matina',
                'crop_species': species.id,
                'crop_family': 'Fabaceae',
                'nutrient_demand': 'high',
                'rotation_break_years': 4,
                'copy_values_to_crop': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('crop_family', response.data)
        self.assertIn('rotation_break_years', response.data)
        # The gap-filling value alone is not an error; the request still fails.
        self.assertNotIn('nutrient_demand', response.data)
        general.refresh_from_db()
        self.assertEqual(general.crop_family_id, 'Solanaceae')
        self.assertEqual(general.nutrient_demand, '')
        self.assertEqual(general.rotation_break_years, 6)
        self.assertFalse(Crop.objects.filter(project=self.project, variety='Matina').exists())

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
        self.assertEqual(general.crop_family_id, 'Solanaceae')
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
        # Content diverges (name, missing growth_duration_days), so this must
        # not be recorded as already synced to version 4 — that would hide
        # the divergence from has_pending_public_crop_update() and leave only
        # a push action that can never succeed for an entry this user doesn't
        # own. See link_project_crop_to_public_reference().
        self.assertIsNone(private_crop.source_public_version)
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
            'crop_family': 'Fabaceae',
            'nutrient_demand': 'medium',
            'project': self.project.id,
        }
        response = self.client.put(f'/openfarmplanner/api/crops/{self.crop.id}/', data, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['name'], 'Updated Crop')
        self.assertEqual(response.data['crop_family'], 'Fabaceae')

    def test_crop_family_is_written_as_botanical_name_and_read_with_its_display_name(self):
        url = f'/openfarmplanner/api/crops/{self.crop.id}/?language=de'
        response = self.client.patch(url, {'crop_family': ' brassicaceae '}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data['crop_family'], 'Brassicaceae')
        self.assertEqual(response.data['crop_family_display_name'], 'Kreuzblütler')
        self.assertEqual(response.data['effective_rotation_break_years'], 4)
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.crop_family_id, 'Brassicaceae')

        english = self.client.get(f'/openfarmplanner/api/crops/{self.crop.id}/?language=en')
        self.assertEqual(english.data['crop_family_display_name'], 'Cabbage family')

    def test_own_rotation_break_overrides_the_family_default(self):
        response = self.client.patch(
            f'/openfarmplanner/api/crops/{self.crop.id}/',
            {'crop_family': 'Brassicaceae', 'rotation_break_years': 2},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data['effective_rotation_break_years'], 2)

    def test_unknown_crop_family_is_rejected_with_a_clear_error(self):
        for value in ('Kreuzblütler', 'Rosaceae'):
            response = self.client.patch(
                f'/openfarmplanner/api/crops/{self.crop.id}/', {'crop_family': value}, format='json',
            )
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
            message = str(response.data['crop_family'][0])
            self.assertIn(f'Unknown plant family "{value}"', message)
            self.assertIn('/api/plant-families/', message)

    def test_blank_crop_family_clears_the_reference(self):
        Crop.objects.filter(pk=self.crop.pk).update(crop_family_id='Apiaceae')
        response = self.client.patch(
            f'/openfarmplanner/api/crops/{self.crop.id}/', {'crop_family': ''}, format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertIsNone(response.data['crop_family'])
        self.assertIsNone(response.data['crop_family_display_name'])
        self.crop.refresh_from_db()
        self.assertIsNone(self.crop.crop_family_id)

    def test_plant_family_list_returns_localized_names_and_default_breaks(self):
        response = self.client.get('/openfarmplanner/api/plant-families/?language=de')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        families = {item['botanical_name']: item for item in response.data}
        self.assertEqual(len(families), 16)
        self.assertEqual(families['Brassicaceae']['display_name'], 'Kreuzblütler')
        self.assertEqual(families['Brassicaceae']['default_rotation_break_years'], 4)
        self.assertEqual(families['Brassicaceae']['translations']['en'], 'Cabbage family')
        self.assertIsNone(families['Poaceae']['default_rotation_break_years'])
        self.assertEqual(
            families['Caprifoliaceae']['display_name'], 'Geißblattgewächse (Feldsalat)',
        )

    def test_plant_family_list_query_count_does_not_scale_with_family_count(self):
        with CaptureQueriesContext(connection) as first_queries:
            first = self.client.get('/openfarmplanner/api/plant-families/')
        PlantFamily.objects.create(botanical_name='Rosaceae')
        PlantFamily.objects.create(botanical_name='Juglandaceae')
        with CaptureQueriesContext(connection) as second_queries:
            second = self.client.get('/openfarmplanner/api/plant-families/')
        self.assertEqual(len(second.data), len(first.data) + 2)
        # Families plus one prefetch for their translations, whatever the count.
        for queries in (first_queries, second_queries):
            family_queries = [q for q in queries if 'crops_plantfamily' in q['sql']]
            self.assertEqual(len(family_queries), 2)

    def test_plant_family_list_is_read_only(self):
        response = self.client.post(
            '/openfarmplanner/api/plant-families/', {'botanical_name': 'Rosaceae'}, format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

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

    def test_conflicting_variety_rename_is_atomic_for_both_group_types_and_methods(self):
        for index, (linked, method) in enumerate([(False, 'patch'), (False, 'put'), (True, 'patch'), (True, 'put')]):
            with self.subTest(linked=linked, method=method):
                species = CropSpecies.objects.create(name=f'Rename conflict species {index}') if linked else None
                name = f'Source crop {index}'
                Crop.objects.create(project=self.project, name=name, crop_species=species)
                variety = Crop.objects.create(project=self.project, name=name, variety='Source variety', crop_species=species)
                Crop.objects.create(project=self.project, name=name, variety='Sibling variety', crop_species=species)
                target = f'Existing crop {index}'
                Crop.objects.create(project=self.project, name=target)
                before = list(Crop.objects.order_by('id').values())
                revisions = EntityRevision.objects.count()

                response = getattr(self.client, method)(f'/openfarmplanner/api/crops/{variety.pk}/', {
                    'name': f'  {target.upper()}   ', 'variety': variety.variety,
                    'notes': 'This change must also roll back',
                    'growth_duration_days': 60, 'harvest_duration_days': 14,
                }, format='json')

                self.assertEqual(response.status_code, status.HTTP_409_CONFLICT, response.data)
                self.assertEqual(response.data['code'], 'crop_name_conflict')
                self.assertEqual(list(Crop.objects.order_by('id').values()), before)
                self.assertEqual(EntityRevision.objects.count(), revisions)

    def test_general_name_database_conflict_rolls_back_the_whole_rename_cascade(self):
        from unittest.mock import patch

        variety = Crop.objects.create(project=self.project, name=self.crop.name, variety='Source variety')
        Crop.objects.create(project=self.project, name='Existing target')
        before = list(Crop.objects.order_by('id').values())
        revisions = EntityRevision.objects.count()
        with patch('farm.crops.views.crops.CropViewSet._validate_crop_group_rename'):
            response = self.client.patch(f'/openfarmplanner/api/crops/{variety.pk}/', {
                'name': 'Existing target', 'notes': 'Rejected update',
            }, format='json')
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT, response.data)
        self.assertEqual(response.data['code'], 'crop_name_conflict')
        self.assertEqual(list(Crop.objects.order_by('id').values()), before)
        self.assertEqual(EntityRevision.objects.count(), revisions)

    def test_named_postgresql_general_name_conflict_is_translated_after_rollback(self):
        from unittest.mock import patch

        from django.db import IntegrityError

        variety = Crop.objects.create(project=self.project, name=self.crop.name, variety='Source variety')
        before = list(Crop.objects.order_by('id').values())
        failure = IntegrityError('duplicate key value violates unique constraint "unique_general_crop_name_per_project"')
        with patch('farm.crops.views.crops.CropViewSet._rename_sibling_crops', side_effect=failure):
            response = self.client.patch(f'/openfarmplanner/api/crops/{variety.pk}/', {'name': 'New target'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT, response.data)
        self.assertEqual(response.data['code'], 'crop_name_conflict')
        self.assertEqual(list(Crop.objects.order_by('id').values()), before)

    def test_unrelated_database_errors_are_not_reported_as_name_conflicts(self):
        from unittest.mock import patch

        from django.db import IntegrityError

        before = list(Crop.objects.order_by('id').values())
        with patch('farm.crops.views.crops.CropViewSet._rename_sibling_crops', side_effect=IntegrityError('unrelated failure')):
            with self.assertRaisesRegex(IntegrityError, 'unrelated failure'):
                self.client.patch(f'/openfarmplanner/api/crops/{self.crop.pk}/', {'name': 'New target'}, format='json')
        self.assertEqual(list(Crop.objects.order_by('id').values()), before)

    def test_variety_rename_ignores_general_crops_in_other_projects_and_trash(self):
        from django.utils import timezone

        other_project = Project.objects.create(name='Other rename project', slug='other-rename-project')
        target = 'Available target'
        other = Crop.objects.create(project=other_project, name=target)
        archived = Crop.all_objects.create(project=self.project, name=target, deleted_at=timezone.now())
        variety = Crop.objects.create(project=self.project, name=self.crop.name, variety='Source variety')
        response = self.client.patch(f'/openfarmplanner/api/crops/{variety.pk}/', {'name': target}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.crop.refresh_from_db()
        variety.refresh_from_db()
        other.refresh_from_db()
        archived.refresh_from_db()
        self.assertEqual((self.crop.name, variety.name), (target, target))
        self.assertIsNotNone(archived.deleted_at)
        self.assertEqual(other.project_id, other_project.pk)

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

    def test_independent_supplier_patch_preserves_crop_and_package_identity(self) -> None:
        supplier = Supplier.objects.create(name='Independent', project=self.project)
        row = CropSupplierData.objects.create(
            crop=self.crop, supplier=supplier, project=self.project,
        )
        package = SeedPackage.objects.create(
            crop=self.crop, project=self.project, size_value=25, size_unit='g',
        )
        original_name = self.crop.name
        response = self.client.patch(f'/openfarmplanner/api/crops/{self.crop.pk}/', {
            'supplier_data_input': [{
                'id': row.pk, 'supplier_id': supplier.pk, 'supplier_product_name': 'Updated',
                'seed_status': 'conventional', 'seed_exemption_status': 'approved',
                'packaging_sizes': [{'size_value': 25, 'size_unit': 'g'}],
            }],
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.crop.refresh_from_db()
        row.refresh_from_db()
        self.assertEqual(self.crop.name, original_name)
        self.assertEqual(row.supplier_product_name, 'Updated')
        self.assertEqual(row.seed_status, 'conventional')
        self.assertTrue(SeedPackage.objects.filter(pk=package.pk, crop=self.crop).exists())
        self.assertEqual(float(row.packaging_sizes[0]['size_value']), 25)
        response = self.client.patch(f'/openfarmplanner/api/crops/{self.crop.pk}/', {
            'supplier_data_input': [],
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(CropSupplierData.objects.filter(pk=row.pk).exists())

    def test_supplier_offer_crud_preserves_other_offers_packages_and_task_rules(self) -> None:
        first_supplier = Supplier.objects.create(name='First offer', project=self.project)
        second_supplier = Supplier.objects.create(name='Second offer', project=self.project)
        first = CropSupplierData.objects.create(
            project=self.project, crop=self.crop, supplier=first_supplier,
            packaging_sizes=[{'size_value': 25, 'size_unit': 'g'}],
        )
        second = CropSupplierData.objects.create(
            project=self.project, crop=self.crop, supplier=second_supplier,
            packaging_sizes=[{'size_value': 100, 'size_unit': 'seeds'}], notes='Keep offer notes',
        )
        package = SeedPackage.objects.create(
            project=self.project, crop=self.crop, size_value=25, size_unit='g',
        )
        season = Season.objects.create(
            project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        template = CropTaskTemplate.objects.create(
            project=self.project, crop=self.crop, title='Cover crop', reference_event='sowing',
            day_offset=-2, repeat_interval_days=7, repeat_until='count', repeat_count=3,
        )
        plan = PlantingPlan.objects.create(
            project=self.project, crop=self.crop, bed=self.bed, season=season,
            planting_date=date(2026, 5, 1), cultivation_type='direct_sowing',
        )
        generate_plan_tasks(plan)
        tasks = Task.objects.filter(planting_plan=plan).order_by('pk')
        snapshot = list(tasks.values_list('pk', 'due_date', 'calculated_due_date', 'status'))
        self.assertTrue(snapshot)
        original_name = self.crop.name
        url = f'/openfarmplanner/api/crops/{self.crop.pk}/'
        response = self.client.patch(url, {'supplier_data_input': [
            {'id': first.pk, 'supplier_id': first_supplier.pk, 'supplier_product_name': 'Edited'},
            {'id': second.pk, 'supplier_id': second_supplier.pk},
        ]}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        second.refresh_from_db()
        self.assertEqual(second.notes, 'Keep offer notes')
        self.assertEqual(second.packaging_sizes, [{'size_value': 100, 'size_unit': 'seeds'}])
        response = self.client.patch(url, {'supplier_data_input': [
            {'id': second.pk, 'supplier_id': second_supplier.pk},
        ]}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(CropSupplierData.objects.filter(pk=first.pk).exists())
        self.assertTrue(Supplier.objects.filter(pk=first_supplier.pk).exists())
        self.assertTrue(SeedPackage.objects.filter(pk=package.pk).exists())
        self.assertTrue(CropTaskTemplate.objects.filter(pk=template.pk).exists())
        self.assertEqual(
            list(tasks.values_list('pk', 'due_date', 'calculated_due_date', 'status')), snapshot,
        )
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.name, original_name)

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
            crop_family_id='Apiaceae',
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

    def test_seed_type_is_set_on_a_sorte_and_defaults_to_blank(self):
        url = f'/openfarmplanner/api/crops/{self.sorte.id}/'
        self.assertEqual(self.client.get(url).data['seed_type'], '')

        response = self.client.patch(url, {'seed_type': 'open_pollinated'}, format='json')

        self.assertEqual(response.status_code, 200, response.data)
        self.sorte.refresh_from_db()
        self.assertEqual(self.sorte.seed_type, 'open_pollinated')

    def test_seed_type_is_rejected_on_a_general_kultur(self):
        response = self.client.patch(
            f'/openfarmplanner/api/crops/{self.general.id}/',
            {'seed_type': 'f1_hybrid'},
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('seed_type', response.data)
        self.general.refresh_from_db()
        self.assertEqual(self.general.seed_type, '')

    def test_seed_type_rejects_an_unknown_value(self):
        response = self.client.patch(
            f'/openfarmplanner/api/crops/{self.sorte.id}/',
            {'seed_type': 'unknown'},
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('seed_type', response.data)

    def test_seed_type_is_not_derived_from_the_variety_name(self):
        response = self.client.post(
            '/openfarmplanner/api/crops/',
            {
                'name': 'Karotte',
                'variety': 'Nerac F1',
                'crop_species': self.species.id,
                'growth_duration_days': 65,
                'harvest_duration_days': 14,
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['seed_type'], '')

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
            {'crop_family': 'Poaceae', 'nutrient_demand': 'high', 'rotation_break_years': 9},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        for field in ('crop_family', 'nutrient_demand', 'rotation_break_years'):
            self.assertIn(field, response.data)

        self.sorte.refresh_from_db()
        self.assertIsNone(self.sorte.crop_family_id)
        self.assertEqual(self.sorte.nutrient_demand, '')
        self.assertIsNone(self.sorte.rotation_break_years)

        row = self._row(self.sorte)
        self.assertEqual(row['effective_values']['crop_family'], 'Apiaceae')
        self.assertEqual(row['effective_values']['nutrient_demand'], 'medium')
        self.assertEqual(row['effective_values']['rotation_break_years'], 3)
        for field in ('crop_family', 'nutrient_demand', 'rotation_break_years'):
            self.assertIn(field, row['inherited_fields'])

    def test_unrelated_update_does_not_silently_clear_legacy_invariant_values(self):
        Crop.objects.filter(pk=self.sorte.pk).update(crop_family_id='Lamiaceae')

        response = self.client.patch(
            f'/openfarmplanner/api/crops/{self.sorte.id}/',
            {'notes': 'Unrelated edit'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.sorte.refresh_from_db()
        self.assertEqual(self.sorte.crop_family_id, 'Lamiaceae')

    def test_linked_orphan_preserves_and_can_edit_its_only_invariant_value(self):
        orphan_species = CropSpecies.objects.create(name='Pastinaca sativa')
        orphan = Crop.objects.create(
            name='Pastinake', variety='Halblange', project=self.project,
            crop_species=orphan_species, crop_family_id='Apiaceae',
        )

        response = self.client.patch(
            f'/openfarmplanner/api/crops/{orphan.id}/',
            {'crop_family': 'Asteraceae'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        orphan.refresh_from_db()
        self.assertEqual(orphan.crop_family_id, 'Asteraceae')
        row = self._row(orphan)
        self.assertEqual(row['crop_family'], 'Asteraceae')
        self.assertEqual(row['effective_values'], {})
        self.assertFalse(Crop.objects.filter(
            project=self.project, crop_species=orphan_species, variety_normalized__isnull=True,
        ).exists())

    def test_linked_sorte_ignores_a_raw_species_invariant_value_from_the_db(self):
        """A value written straight to the column (pre-rule, or by a migration
        that has not run yet) is still ignored when resolving."""
        Crop.objects.filter(pk=self.sorte.pk).update(
            crop_family_id='Lamiaceae', rotation_break_years=7,
        )
        row = self._row(self.sorte)
        self.assertEqual(row['crop_family'], 'Lamiaceae')  # raw field is untouched
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
        self.assertEqual(free_text.crop_family_id, 'Apiaceae')
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
        self.assertEqual(general.crop_family_id, 'Apiaceae')
        self.assertEqual(general.rotation_break_years, 5)

    def test_inheritance_payload_costs_one_query_for_a_whole_list_page(self):
        CropTimingWindow.objects.create(
            crop=self.general, kind='planting', unit='iso_week', start_week=20, end_week=30,
        )
        for index in range(5):
            crop = Crop.objects.create(
                name='Karotte', variety=f'Sorte {index}',
                project=self.project, crop_species=self.species,
            )
            CropTimingWindow.objects.create(
                crop=crop, kind='direct_sowing', unit='iso_week', start_week=10, end_week=14,
            )
        # +2 for the plant-family list, +1 for the timing windows, each loaded once per page.
        with self.assertNumQueries(14):
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
