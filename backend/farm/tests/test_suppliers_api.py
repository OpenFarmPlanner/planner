"""API tests for the supplier endpoints."""

import json
from decimal import Decimal

from django.utils import timezone
from rest_framework import status

from farm.models import (
    Crop,
    CropSupplierData,
    Project,
    ProjectMembership,
    Supplier,
)
from farm.services.suppliers import (
    build_delete_undo_payload,
    build_delete_usage,
    unlink_supplier_references,
)
from farm.tests.api_base import ProjectApiTestCase


class SupplierApiTest(ProjectApiTestCase):
    def test_supplier_list(self):
        """Test listing suppliers"""
        response = self.client.get('/openfarmplanner/api/suppliers/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 1)
        self.assertEqual(response.data['results'][0]['name'], "Test Supplier Co.")

    def test_supplier_list_with_search(self):
        """Test searching suppliers"""
        Supplier.objects.create(name="Another Supplier", homepage_url='https://another-supplier.example', project=self.project)
        response = self.client.get('/openfarmplanner/api/suppliers/?q=Test Supplier')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(response.data['results']), 1)
        # At least one result should be "Test Supplier Co."
        supplier_names = [s['name'] for s in response.data['results']]
        self.assertIn("Test Supplier Co.", supplier_names)

    def test_supplier_create_new(self):
        """Test creating a new supplier"""
        data = {'name': 'New Supplier Inc.', 'homepage_url': 'https://new-supplier.example'}
        response = self.client.post('/openfarmplanner/api/suppliers/', data)
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Supplier.objects.count(), 2)
        self.assertEqual(response.data['name'], 'New Supplier Inc.')

    def test_supplier_create_existing(self):
        """Test creating supplier with exact duplicate name returns a field error."""
        data = {'name': 'Test Supplier Co.', 'homepage_url': 'https://test-supplier.example'}
        response = self.client.post('/openfarmplanner/api/suppliers/', data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Supplier.objects.count(), 1)
        self.assertIn('name', response.data)
        self.assertEqual(str(response.data['name'][0]), 'Ein Lieferant mit diesem Namen existiert bereits.')

    def test_supplier_create_normalized_match(self):
        """Test creating supplier with normalized match returns a field error."""
        data = {'name': '  TEST SUPPLIER co.  ', 'homepage_url': 'https://test-supplier.example'}
        response = self.client.post('/openfarmplanner/api/suppliers/', data)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(Supplier.objects.count(), 1)
        self.assertIn('name', response.data)

    def test_supplier_create_allows_same_normalized_name_in_different_projects(self):
        """Test creating the same supplier name in two projects."""
        other_project = Project.objects.create(name='Other Project', slug='other-project')
        ProjectMembership.objects.create(user=self.user, project=other_project, role='admin')
        response = self.client.post(
            '/openfarmplanner/api/suppliers/',
            {'name': self.supplier.name, 'homepage_url': 'https://other-supplier.example'},
            HTTP_X_PROJECT_ID=str(other_project.id),
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['name'], self.supplier.name)
        self.assertEqual(Supplier.objects.filter(name_normalized=self.supplier.name_normalized).count(), 2)

    def test_supplier_create_rejects_trimmed_case_duplicate(self):
        """Test creating normalized duplicates with whitespace and casing differences."""
        Supplier.objects.create(name='Reinsaat', homepage_url='https://reinsaat.example', project=self.project)
        response = self.client.post(
            '/openfarmplanner/api/suppliers/',
            {'name': ' reinsaat ', 'homepage_url': 'https://reinsaat-two.example'},
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('name', response.data)

    def test_supplier_create_allows_empty_homepage_url(self):
        """Test creating supplier without a website."""
        response = self.client.post('/openfarmplanner/api/suppliers/', {'name': 'Supplier Without Website', 'homepage_url': ''})
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['homepage_url'], '')

    def test_supplier_create_allows_full_homepage_url(self):
        """Test creating supplier with a full website URL."""
        response = self.client.post(
            '/openfarmplanner/api/suppliers/',
            {'name': 'Supplier With Website', 'homepage_url': 'https://supplier.example/path'},
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['homepage_url'], 'https://supplier.example/path')

    def test_supplier_delete_removes_supplier_and_returns_undo_payload(self):
        """Delete must persist immediately and hand back a restore payload for undo."""
        response = self.client.delete(f'/openfarmplanner/api/suppliers/{self.supplier.id}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(Supplier.objects.filter(pk=self.supplier.id).exists())
        undo_payload = response.data['undo_payload']
        self.assertEqual(undo_payload['supplier']['id'], self.supplier.id)
        self.assertEqual(undo_payload['supplier']['name'], self.supplier.name)
        self.assertEqual(undo_payload['crop_ids'], [])
        self.assertEqual(undo_payload['supplier_data'], [])

    def test_supplier_delete_undo_payload_restores_supplier(self):
        """The undo payload from a delete restores the supplier under its old id."""
        delete_response = self.client.delete(f'/openfarmplanner/api/suppliers/{self.supplier.id}/')
        self.assertEqual(delete_response.status_code, status.HTTP_200_OK)

        restore_response = self.client.post(
            '/openfarmplanner/api/suppliers/restore-unlinked-delete/',
            delete_response.data['undo_payload'],
            format='json',
        )

        self.assertEqual(restore_response.status_code, status.HTTP_200_OK)
        restored = Supplier.objects.get(pk=self.supplier.id)
        self.assertEqual(restored.name, self.supplier.name)
        self.assertEqual(restored.homepage_url, self.supplier.homepage_url)

    def test_supplier_delete_rejects_supplier_still_in_use(self):
        """A supplier referenced by a crop is kept and reported as a conflict."""
        self.crop.supplier = self.supplier
        self.crop.save(update_fields=['supplier'])

        response = self.client.delete(f'/openfarmplanner/api/suppliers/{self.supplier.id}/')

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertFalse(response.data['usage']['can_delete'])
        self.assertTrue(Supplier.objects.filter(pk=self.supplier.id).exists())

    def test_supplier_update_not_limited_by_list_slice(self):
        """Supplier updates must work even if list endpoint shows only first 20 rows."""
        for idx in range(30):
            Supplier.objects.create(
                name=f"A Supplier {idx:02d}",
                homepage_url=f"https://a-supplier-{idx:02d}.example",
                project=self.project,
            )

        target = Supplier.objects.create(name='ZZZ Supplier', homepage_url='https://zzz.example', project=self.project)

        response = self.client.put(
            f'/openfarmplanner/api/suppliers/{target.id}/',
            {
                'name': 'ZZZ Supplier Updated',
                'homepage_url': 'https://zzz-updated.example',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['name'], 'ZZZ Supplier Updated')

    def test_supplier_update_with_invalid_allowed_domain_returns_400(self):
        """Invalid allowed_domains input should be validated, not crash with 500."""
        response = self.client.put(
            f'/openfarmplanner/api/suppliers/{self.supplier.id}/',
            {
                'name': self.supplier.name,
                'homepage_url': 'https://lieferando.example',
                'allowed_domains': ['lieferando.example', 'www.lieferando.example', 'sdfasdad'],
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('allowed_domains', response.data)

    def test_supplier_create_with_invalid_domain_returns_400(self):
        """Test creating supplier with invalid allowed_domains returns 400."""
        data = {
            'name': 'Invalid Domain Supplier',
            'homepage_url': 'https://example.com',
            'allowed_domains': ['example.com', 'invalid domain', 'https://not-allowed.com']
        }
        response = self.client.post('/openfarmplanner/api/suppliers/', data, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('allowed_domains', response.data)

    def test_supplier_create_with_invalid_url_returns_400(self):
        """Test creating supplier with invalid homepage_url returns 400."""
        invalid_urls = ['invalid-url', 'htp://broken.com', 'just-text']
        for invalid_url in invalid_urls:
            data = {
                'name': f'Test Supplier {invalid_url}',
                'homepage_url': invalid_url,
            }
            response = self.client.post('/openfarmplanner/api/suppliers/', data, format='json')
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, f'Should reject invalid URL: {invalid_url}')
            self.assertIn('homepage_url', response.data, f'Should have homepage_url error for: {invalid_url}')

    def test_supplier_create_with_domain_only_normalizes_to_https(self):
        """Test creating supplier with domain-only URL prepends https://."""
        test_cases = [
            ('example.com', 'https://example.com'),
            ('www.example.com', 'https://www.example.com'),
            ('subdomain.example.co.uk', 'https://subdomain.example.co.uk'),
        ]
        
        for input_url, expected_url in test_cases:
            data = {
                'name': f'Test Supplier for {input_url}',
                'homepage_url': input_url,
            }
            response = self.client.post('/openfarmplanner/api/suppliers/', data, format='json')
            self.assertEqual(response.status_code, status.HTTP_201_CREATED, f'Should accept domain-only URL: {input_url}')
            self.assertEqual(response.data['homepage_url'], expected_url, f'Should normalize {input_url} to {expected_url}')



class SupplierDeleteUsageTest(ProjectApiTestCase):
    """`build_delete_usage` decides whether the delete button is a delete or a
    conflict dialog, and which crops that dialog names.

    A supplier can be referenced three separate ways, and the same crop can hold
    more than one of them — so the per-kind counts and the deduplicated total
    are different numbers, not the same number reported twice.
    """

    def _crop(self, name: str, **kwargs) -> Crop:
        return Crop.objects.create(name=name, project=self.project, **kwargs)

    def test_an_unreferenced_supplier_can_be_deleted(self):
        usage = build_delete_usage(self.supplier)

        self.assertTrue(usage['can_delete'])
        self.assertEqual(usage['total_crop_count'], 0)
        self.assertEqual(usage['crop_ids'], [])

    def test_counts_each_kind_of_reference_separately(self):
        by_supplier = self._crop('Kultur Lieferant', supplier=self.supplier)
        by_seed_demand = self._crop(
            'Kultur Saatgutbedarf', selected_seed_demand_supplier=self.supplier,
        )
        with_data_row = self._crop('Kultur Datenzeile')
        CropSupplierData.objects.create(
            crop=with_data_row, supplier=self.supplier, project=self.project,
        )

        usage = build_delete_usage(self.supplier)

        self.assertFalse(usage['can_delete'])
        self.assertEqual(usage['crop_count'], 1)
        self.assertEqual(usage['seed_demand_crop_count'], 1)
        self.assertEqual(usage['supplier_data_crop_count'], 1)
        self.assertEqual(usage['supplier_data_count'], 1)
        self.assertEqual(usage['total_crop_count'], 3)
        self.assertEqual(
            usage['crop_ids'], sorted([by_supplier.id, by_seed_demand.id, with_data_row.id]),
        )

    def test_counts_one_crop_once_even_when_it_holds_every_reference(self):
        crop = self._crop(
            'Dreifach', supplier=self.supplier, selected_seed_demand_supplier=self.supplier,
        )
        CropSupplierData.objects.create(crop=crop, supplier=self.supplier, project=self.project)

        usage = build_delete_usage(self.supplier)

        self.assertEqual(usage['crop_count'], 1)
        self.assertEqual(usage['seed_demand_crop_count'], 1)
        self.assertEqual(usage['supplier_data_crop_count'], 1)
        self.assertEqual(usage['total_crop_count'], 1)
        self.assertEqual(usage['crop_ids'], [crop.id])

    def test_the_row_count_and_the_crop_count_track_each_other(self):
        """`CropSupplierData` is unique per (crop, supplier), so for one supplier
        these two numbers can never diverge — worth stating, since the service
        reports both and a reader would otherwise expect them to."""
        for name in ('Kultur A', 'Kultur B'):
            CropSupplierData.objects.create(
                crop=self._crop(name), supplier=self.supplier, project=self.project,
            )

        usage = build_delete_usage(self.supplier)

        self.assertEqual(usage['supplier_data_count'], 2)
        self.assertEqual(usage['supplier_data_crop_count'], 2)
        self.assertEqual(usage['total_crop_count'], 2)

    def test_a_crop_reference_alone_blocks_the_delete(self):
        """Each reference kind blocks on its own — a supplier does not become
        deletable just because it has no data rows."""
        self._crop('Nur Lieferant', supplier=self.supplier)

        self.assertFalse(build_delete_usage(self.supplier)['can_delete'])

    def test_a_seed_demand_reference_alone_blocks_the_delete(self):
        self._crop('Nur Saatgutbedarf', selected_seed_demand_supplier=self.supplier)

        self.assertFalse(build_delete_usage(self.supplier)['can_delete'])

    def test_a_data_row_alone_blocks_the_delete(self):
        # Note: `can_delete`'s `and supplier_data_rows == 0` clause is redundant.
        # A data row always contributes its crop to `total_crop_ids`, so the
        # first half already covers this case; dropping the clause breaks
        # nothing. Kept as a test of the behaviour, not of that line.
        CropSupplierData.objects.create(
            crop=self._crop('Nur Datenzeile'), supplier=self.supplier, project=self.project,
        )

        self.assertFalse(build_delete_usage(self.supplier)['can_delete'])

    def test_ignores_soft_deleted_crops(self):
        """Usage answers "what would the user lose", so a crop already in the
        trash must not block the delete."""
        crop = self._crop(
            'Gelöscht', supplier=self.supplier, selected_seed_demand_supplier=self.supplier,
        )
        CropSupplierData.objects.create(crop=crop, supplier=self.supplier, project=self.project)
        crop.deleted_at = timezone.now()
        crop.save(update_fields=['deleted_at'])

        usage = build_delete_usage(self.supplier)

        self.assertTrue(usage['can_delete'])
        self.assertEqual(usage['total_crop_count'], 0)
        self.assertEqual(usage['supplier_data_count'], 0)

    def test_ignores_references_from_another_project(self):
        other_project = Project.objects.create(name='Anderes', slug='supplier-usage-other')
        Crop.objects.create(name='Fremd', project=other_project, supplier=self.supplier)

        usage = build_delete_usage(self.supplier)

        self.assertTrue(usage['can_delete'])
        self.assertEqual(usage['total_crop_count'], 0)

    def test_ignores_references_to_a_different_supplier(self):
        other_supplier = Supplier.objects.create(
            name='Anderer Lieferant', homepage_url='https://other.example', project=self.project,
        )
        self._crop('Andere Kultur', supplier=other_supplier)

        usage = build_delete_usage(self.supplier)

        self.assertTrue(usage['can_delete'])


class SupplierUnlinkAndRestoreTest(ProjectApiTestCase):
    """The undo payload has to survive a full unlink-delete-restore round trip.

    Unlike the usage summary, the payload and the unlink use `all_objects`: a
    soft-deleted crop still holds a foreign key, so it has to be detached too —
    and restored, or undo would silently drop it.
    """

    def setUp(self):
        super().setUp()
        self.linked_crop = Crop.objects.create(
            name='Verknüpft', project=self.project,
            supplier=self.supplier, selected_seed_demand_supplier=self.supplier,
        )
        self.data_row = CropSupplierData.objects.create(
            crop=self.linked_crop,
            supplier=self.supplier,
            project=self.project,
            supplier_product_name='Sorte A',
            supplier_product_url='https://supplier.example/a',
            germination_rate=85,
            notes='Notiz',
        )

    def test_payload_captures_every_reference_including_soft_deleted_crops(self):
        trashed = Crop.objects.create(
            name='Papierkorb', project=self.project, supplier=self.supplier,
        )
        trashed.deleted_at = timezone.now()
        trashed.save(update_fields=['deleted_at'])

        payload = build_delete_undo_payload(self.supplier)

        self.assertEqual(payload['supplier']['id'], self.supplier.id)
        self.assertEqual(payload['supplier']['name'], self.supplier.name)
        self.assertEqual(sorted(payload['crop_ids']), sorted([self.linked_crop.id, trashed.id]))
        self.assertEqual(payload['seed_demand_crop_ids'], [self.linked_crop.id])
        self.assertEqual(len(payload['supplier_data']), 1)
        self.assertEqual(payload['supplier_data'][0]['supplier_product_name'], 'Sorte A')

    def test_payload_serializes_decimals_as_strings_so_it_survives_json(self):
        self.data_row.price = Decimal('4.25')
        self.data_row.thousand_kernel_weight_g = Decimal('3.50')
        self.data_row.save(update_fields=['price', 'thousand_kernel_weight_g'])

        row = build_delete_undo_payload(self.supplier)['supplier_data'][0]

        self.assertEqual(row['price'], '4.25')
        self.assertEqual(row['thousand_kernel_weight_g'], '3.50')
        json.dumps(row)

    def test_payload_keeps_absent_decimals_as_null(self):
        row = build_delete_undo_payload(self.supplier)['supplier_data'][0]

        self.assertIsNone(row['price'])
        self.assertIsNone(row['thousand_kernel_weight_g'])

    def test_unlink_detaches_every_reference_and_drops_the_data_rows(self):
        unlink_supplier_references(self.supplier)
        self.linked_crop.refresh_from_db()

        self.assertIsNone(self.linked_crop.supplier)
        self.assertIsNone(self.linked_crop.selected_seed_demand_supplier)
        self.assertFalse(CropSupplierData.objects.filter(supplier=self.supplier).exists())

    def test_unlink_also_detaches_a_soft_deleted_crop(self):
        trashed = Crop.objects.create(
            name='Papierkorb', project=self.project, supplier=self.supplier,
        )
        trashed.deleted_at = timezone.now()
        trashed.save(update_fields=['deleted_at'])

        unlink_supplier_references(self.supplier)

        self.assertIsNone(Crop.all_objects.get(pk=trashed.pk).supplier)

    def test_unlink_leaves_other_suppliers_alone(self):
        other_supplier = Supplier.objects.create(
            name='Anderer', homepage_url='https://other.example', project=self.project,
        )
        other_crop = Crop.objects.create(
            name='Andere', project=self.project, supplier=other_supplier,
        )

        unlink_supplier_references(self.supplier)
        other_crop.refresh_from_db()

        self.assertEqual(other_crop.supplier_id, other_supplier.id)

    def test_the_endpoint_round_trip_restores_the_links_and_the_data_row(self):
        undo_payload = self.client.post(
            f'/openfarmplanner/api/suppliers/{self.supplier.id}/unlink-and-delete/'
        )

        self.assertEqual(undo_payload.status_code, status.HTTP_200_OK)
        self.assertFalse(Supplier.objects.filter(pk=self.supplier.id).exists())

        restore = self.client.post(
            '/openfarmplanner/api/suppliers/restore-unlinked-delete/',
            undo_payload.data['undo_payload'],
            format='json',
        )

        self.assertEqual(restore.status_code, status.HTTP_200_OK)
        self.linked_crop.refresh_from_db()
        self.assertEqual(self.linked_crop.supplier_id, self.supplier.id)
        self.assertEqual(self.linked_crop.selected_seed_demand_supplier_id, self.supplier.id)
        restored_row = CropSupplierData.objects.get(supplier_id=self.supplier.id)
        self.assertEqual(restored_row.supplier_product_name, 'Sorte A')
        self.assertEqual(restored_row.germination_rate, 85)
