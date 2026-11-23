from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from farm.models import Crop, CropSupplierData, Project, ProjectMembership, Supplier


User = get_user_model()


class CropSupplierDataApiTest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='supplierdata', email='supplierdata@example.com', password='testpass', is_active=True)
        self.project = Project.objects.create(name='Supplier Data Project', slug='supplier-data-project')
        ProjectMembership.objects.create(user=self.user, project=self.project, role='admin')
        self.client.force_authenticate(user=self.user)
        self.client.defaults['HTTP_X_PROJECT_ID'] = str(self.project.id)

        self.supplier = Supplier.objects.create(name='Reinsaat', homepage_url='https://reinsaat.example', project=self.project)
        self.crop = Crop.objects.create(name='Karotte', variety='Nantaise', project=self.project)

    def test_create_supplier_data_record(self):
        payload = {
            'crop': self.crop.id,
            'supplier_id': self.supplier.id,
            'supplier_product_name': 'Nantaise fein',
            'supplier_product_url': 'https://reinsaat.example/karotte',
            'packaging_sizes': [{'size_value': 25, 'size_unit': 'g'}],
        }

        response = self.client.post('/openfarmplanner/api/crop-supplier-data/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(CropSupplierData.objects.count(), 1)
        row = CropSupplierData.objects.get()
        self.assertEqual(row.crop_id, self.crop.id)
        self.assertEqual(row.supplier_id, self.supplier.id)

    def test_package_prices_distinguish_zero_missing_and_legacy_amounts(self):
        offer = CropSupplierData.objects.create(
            crop=self.crop, supplier=self.supplier, project=self.project, price='2.50',
        )
        url = f'/openfarmplanner/api/crops/{self.crop.id}/'
        small = {'size_value': 100, 'size_unit': 'seeds'}
        large = {'size_value': 500, 'size_unit': 'seeds'}
        response = self.client.patch(url, {'supplier_data_input': [{
            'id': offer.id,
            'supplier_id': self.supplier.id,
            'package_currency': 'GBP',
            'packaging_sizes': [{**small, 'price': 0}, {**large, 'price': '12.75'}],
            'notes': 'Order early',
            'supplier_product_url': 'https://supplier.example/product',
            'source_url': 'https://supplier.example/catalogue',
            'germination_rate': 85,
        }]}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        row = response.data['supplier_data'][0]
        self.assertEqual(row['package_currency'], 'GBP')
        self.assertEqual(row['price'], '2.50')
        self.assertEqual(row['germination_rate'], 85)
        self.assertEqual(row['notes'], 'Order early')
        self.assertEqual(row['supplier_product_url'], 'https://supplier.example/product')
        self.assertEqual(row['source_url'], 'https://supplier.example/catalogue')
        self.assertEqual(row['packaging_sizes'], [
            {**small, 'price': '0.0000'}, {**large, 'price': '12.7500'},
        ])

        # Older clients send package sizes without prices. Clearing is explicit.
        for packages in ([large, small], [large, {**small, 'price': None}]):
            response = self.client.patch(url, {'supplier_data_input': [{
                'id': offer.id, 'supplier_id': self.supplier.id, 'packaging_sizes': packages,
            }]}, format='json')
            self.assertEqual(response.status_code, 200, response.data)
            row = response.data['supplier_data'][0]
            self.assertEqual(row['packaging_sizes'][0]['price'], '12.7500')
            self.assertEqual(row['packaging_sizes'][1]['price'], packages[1].get('price', '0.0000'))
            self.assertEqual(row['package_currency'], 'GBP')
            self.assertEqual(row['price'], '2.50')

    def test_invalid_package_pricing_leaves_saved_offer_unchanged(self):
        offer = CropSupplierData.objects.create(
            crop=self.crop, supplier=self.supplier, project=self.project, notes='Keep this',
        )
        url = f'/openfarmplanner/api/crop-supplier-data/{offer.id}/'
        package = {'size_value': 25, 'size_unit': 'g', 'price': 4}
        for currency, packages, field in (
            ('', [package], 'packaging_sizes'),
            ('XXX', [package], 'package_currency'),
            ('EUR', [{**package, 'price': -1}], 'packaging_sizes'),
            ('EUR', [{**package, 'size_value': 0}], 'packaging_sizes'),
            ('EUR', [package, package], 'packaging_sizes'),
        ):
            with self.subTest(currency=currency, packages=packages):
                response = self.client.patch(url, {
                    'notes': 'Unsaved', 'package_currency': currency, 'packaging_sizes': packages,
                }, format='json')
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.data)
                offer.refresh_from_db()
                self.assertEqual(offer.notes, 'Keep this')
                self.assertEqual(offer.packaging_sizes, [])

    def test_crop_detail_includes_supplier_data(self):
        CropSupplierData.objects.create(
            crop=self.crop,
            project=self.project,
            supplier=self.supplier,
            supplier_name='Reinsaat',
            supplier_product_name='Nantaise fein',
            packaging_sizes=[{'size_value': 5, 'size_unit': 'g'}, {'size_value': 25, 'size_unit': 'g'}],
        )

        response = self.client.get(f'/openfarmplanner/api/crops/{self.crop.id}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('supplier_data', response.data)
        self.assertEqual(len(response.data['supplier_data']), 1)
        self.assertEqual(response.data['supplier_data'][0]['supplier_product_name'], 'Nantaise fein')
        self.assertEqual(
            response.data['supplier_data'][0]['packaging_sizes'],
            [{'size_value': 5, 'size_unit': 'g'}, {'size_value': 25, 'size_unit': 'g'}],
        )

    def test_supplier_tkg_input_is_rejected(self):
        payload = {
            'crop': self.crop.id,
            'supplier_id': self.supplier.id,
            'supplier_product_name': 'Nantaise fein',
            'packaging_sizes': [{'size_value': 25, 'size_unit': 'g'}],
            'thousand_kernel_weight_g': 3.9,
        }

        response = self.client.post('/openfarmplanner/api/crop-supplier-data/', payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('thousand_kernel_weight_g', response.data)

    def test_seed_status_defaults_and_optional_update(self) -> None:
        response = self.client.post('/openfarmplanner/api/crop-supplier-data/', {
            'crop': self.crop.id, 'supplier_id': self.supplier.id,
        }, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['seed_status'], 'unknown')
        self.assertEqual(response.data['seed_exemption_status'], 'unknown')
        url = f"/openfarmplanner/api/crop-supplier-data/{response.data['id']}/"
        for seed_status, exemption in zip(
            ['organic', 'in_conversion', 'conventional', 'unknown'],
            ['not_required', 'approved', 'not_approved', 'unknown'], strict=True,
        ):
            response = self.client.patch(url, {
                'seed_status': seed_status, 'seed_exemption_status': exemption,
            }, format='json')
            self.assertEqual(response.status_code, 200)
            row = CropSupplierData.objects.get()
            self.assertEqual(row.seed_status, seed_status)
            self.assertEqual(row.seed_exemption_status, exemption)
        self.client.patch(url, {'seed_status': 'organic'}, format='json')
        response = self.client.put(url, {
            'crop': self.crop.id, 'supplier_id': self.supplier.id, 'notes': 'Legacy client',
        }, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['seed_status'], 'organic')

    def test_invalid_seed_status_values_are_rejected(self) -> None:
        for field in ['seed_status', 'seed_exemption_status']:
            for value in ['invalid', '', None]:
                with self.subTest(field=field, value=value):
                    response = self.client.post('/openfarmplanner/api/crop-supplier-data/', {
                        'crop': self.crop.id, 'supplier_id': self.supplier.id, field: value,
                    }, format='json')
                    self.assertEqual(response.status_code, 400)
                    self.assertIn(field, response.data)
        self.assertFalse(CropSupplierData.objects.exists())

    def test_nested_statuses_are_supplier_specific_and_preserved_by_legacy_updates(self) -> None:
        second = Supplier.objects.create(
            name='Second supplier', project=self.project, homepage_url='https://second.example',
        )
        url = f'/openfarmplanner/api/crops/{self.crop.id}/'
        response = self.client.patch(url, {'supplier_data_input': [
            {'supplier_id': self.supplier.id, 'seed_status': 'organic',
             'seed_exemption_status': 'not_required'},
            {'supplier_id': second.id, 'seed_status': 'conventional',
             'seed_exemption_status': 'approved'},
        ]}, format='json')
        self.assertEqual(response.status_code, 200)
        rows = {row['supplier']['id']: row for row in response.data['supplier_data']}
        self.assertEqual(rows[self.supplier.id]['seed_status'], 'organic')
        self.assertEqual(rows[second.id]['seed_status'], 'conventional')
        response = self.client.patch(
            url, {'notes': 'Old import without supplier rows'}, format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            CropSupplierData.objects.get(supplier=second).seed_exemption_status, 'approved',
        )
        response = self.client.patch(url, {'supplier_data_input': [
            {'id': rows[self.supplier.id]['id'], 'supplier_id': self.supplier.id},
            {'id': rows[second.id]['id'], 'supplier_id': second.id},
        ]}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(CropSupplierData.objects.get(supplier=second).seed_status, 'conventional')

    def test_status_without_supplier_is_not_silently_discarded(self) -> None:
        for field, value in [('seed_status', 'organic'), ('seed_exemption_status', 'approved')]:
            response = self.client.patch(f'/openfarmplanner/api/crops/{self.crop.id}/', {
                'supplier_data_input': [{field: value}],
            }, format='json')
            self.assertEqual(response.status_code, 400)
            self.assertIn('supplier_data_input', response.data)

    def test_legacy_file_import_preserves_offer_statuses(self) -> None:
        from farm.services.crop_import.spreadsheet import apply_crop_import

        offer = CropSupplierData.objects.create(
            crop=self.crop, supplier=self.supplier, project=self.project,
            seed_status='conventional', seed_exemption_status='approved',
        )
        result = apply_crop_import(self.project, [{
            'name': self.crop.name, 'variety': self.crop.variety, 'notes': 'Imported notes',
        }], confirm_updates=True)
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['updated_count'], 1)
        offer.refresh_from_db()
        self.assertEqual(offer.seed_status, 'conventional')
        self.assertEqual(offer.seed_exemption_status, 'approved')
