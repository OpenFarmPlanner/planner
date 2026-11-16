"""End-to-end tests for the two-step crop import over the API."""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from farm.models import (
    Crop,
    CropImportDraft,
    EntityRevision,
    Location,
    Project,
    ProjectApiToken,
    ProjectMembership,
    Supplier,
)

User = get_user_model()

PREVIEW_URL = '/api/crop-imports/preview/'


class CropImportFlowTestCase(APITestCase):
    """One project reachable through a write-scoped API token."""

    def setUp(self):
        self.user = User.objects.create_user(
            username='importer', email='importer@example.com', password='pw', is_active=True
        )
        self.project = Project.objects.create(name='Import Farm', slug='import-farm')
        ProjectMembership.objects.create(user=self.user, project=self.project, role='admin')
        _, self.raw_token = ProjectApiToken.create_token(
            user=self.user,
            project=self.project,
            name='Importer',
            scope=ProjectApiToken.SCOPE_WRITE,
        )
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.raw_token}')

    def preview(self, *items, source_label=''):
        """Run the preview step and return the response."""
        return self.client.post(
            PREVIEW_URL,
            {'items': list(items), 'source_label': source_label},
            format='json',
        )

    def apply(self, draft, **overrides):
        """Run the apply step for a preview response body."""
        payload = {
            'confirm': True,
            'checksum': draft['checksum'],
            'acknowledge_warnings': True,
        }
        payload.update(overrides)
        return self.client.post(
            f'/api/crop-imports/{draft["draft_id"]}/apply/', payload, format='json'
        )


class PreviewIsReadOnlyTests(CropImportFlowTestCase):
    """The preview step must never touch crop data."""

    def test_valid_and_malformed_previews_create_no_project_versions_or_checkpoints(self):
        Location.objects.create(project=self.project, name='Untouched legacy location')
        Crop.objects.create(project=self.project, name='Legacy crop')
        before = list(EntityRevision.objects.filter(project=self.project).values())
        response = self.preview({'name': 'Preview candidate'})
        self.assertEqual(response.status_code, 200, response.data)
        malformed = self.client.post(PREVIEW_URL, {'items': 'invalid'}, format='json')
        self.assertEqual(malformed.status_code, 400, malformed.data)
        self.assertEqual(list(EntityRevision.objects.filter(project=self.project).values()), before)

    def test_preview_creates_no_crops(self):
        response = self.preview({'name': 'Brokkoli', 'variety': 'Calabrese', 'row_spacing_cm': 50})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(Crop.objects.filter(project=self.project).count(), 0)

    def test_preview_does_not_modify_a_matched_crop(self):
        existing = Crop.objects.create(
            name='Brokkoli', variety='Calabrese', project=self.project, row_spacing_m=0.4
        )
        self.preview({'name': 'Brokkoli', 'variety': 'Calabrese', 'row_spacing_cm': 50})

        existing.refresh_from_db()
        self.assertEqual(existing.row_spacing_m, 0.4)

    def test_preview_returns_draft_metadata_and_requires_confirmation(self):
        response = self.preview({'name': 'Brokkoli'}, source_label='order-2026.csv')

        self.assertIn('draft_id', response.data)
        self.assertIn('checksum', response.data)
        self.assertTrue(response.data['requires_confirmation'])
        self.assertEqual(response.data['source_label'], 'order-2026.csv')
        self.assertEqual(response.data['status'], 'pending')

    def test_preview_stores_the_draft_for_the_bound_project(self):
        response = self.preview({'name': 'Brokkoli'})
        draft = CropImportDraft.objects.get(pk=response.data['draft_id'])

        self.assertEqual(draft.project_id, self.project.id)
        self.assertEqual(draft.created_by_id, self.user.id)

    def test_preview_shows_source_and_api_values_per_field(self):
        response = self.preview({'name': 'Brokkoli', 'row_spacing_cm': 50})
        entry = next(
            item for item in response.data['items'][0]['fields'] if item['field'] == 'row_spacing_m'
        )

        self.assertEqual(entry['source_value'], 50)
        self.assertEqual(entry['source_unit'], 'cm')
        self.assertEqual(entry['api_value'], 0.5)
        self.assertEqual(entry['api_unit'], 'm')
        self.assertEqual(entry['confidence'], 'converted')

    def test_empty_payload_is_rejected(self):
        response = self.client.post(PREVIEW_URL, {'items': []}, format='json')
        self.assertEqual(response.status_code, 400)


class ApplyRequiresConfirmationTests(CropImportFlowTestCase):
    """Nothing is written without an explicit, checksum-bound confirmation."""

    def test_apply_without_confirm_writes_nothing(self):
        draft = self.preview({'name': 'Brokkoli'}).data
        response = self.apply(draft, confirm=False)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'], 'confirmation_required')
        self.assertEqual(Crop.objects.filter(project=self.project).count(), 0)

    def test_apply_with_a_wrong_checksum_is_refused(self):
        draft = self.preview({'name': 'Brokkoli'}).data
        response = self.apply(draft, checksum='0' * 64)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'], 'checksum_mismatch')
        self.assertEqual(Crop.objects.filter(project=self.project).count(), 0)

    def test_apply_of_an_expired_draft_is_refused(self):
        draft = self.preview({'name': 'Brokkoli'}).data
        CropImportDraft.objects.filter(pk=draft['draft_id']).update(
            expires_at=timezone.now() - timedelta(minutes=1)
        )

        response = self.apply(draft)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'], 'draft_expired')

    def test_confirmed_apply_creates_the_crop(self):
        draft = self.preview({
            'name': 'Brokkoli',
            'variety': 'Calabrese',
            'row_spacing_cm': 50,
            'distance_within_row_cm': 40,
        }).data
        response = self.apply(draft)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['created_count'], 1)

        crop = Crop.objects.get(project=self.project, name='Brokkoli')
        self.assertAlmostEqual(crop.row_spacing_m, 0.5)
        self.assertAlmostEqual(crop.distance_within_row_m, 0.4)

    def test_apply_updates_a_matched_crop(self):
        existing = Crop.objects.create(
            name='Brokkoli', variety='Calabrese', project=self.project, row_spacing_m=0.4
        )
        draft = self.preview(
            {'name': 'Brokkoli', 'variety': 'Calabrese', 'row_spacing_cm': 50}
        ).data
        response = self.apply(draft)

        self.assertEqual(response.data['updated_count'], 1)
        existing.refresh_from_db()
        self.assertAlmostEqual(existing.row_spacing_m, 0.5)


class ApplyBlocksErroneousDraftsTests(CropImportFlowTestCase):
    """A draft with any error row is refused as a whole."""

    def test_draft_with_errors_cannot_be_applied(self):
        draft = self.preview({'name': 'Karotte', 'row_spacing': 30}).data
        response = self.apply(draft)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'], 'draft_has_errors')
        self.assertEqual(Crop.objects.filter(project=self.project).count(), 0)

    def test_a_single_bad_row_blocks_the_valid_rows_too(self):
        draft = self.preview(
            {'name': 'Brokkoli', 'row_spacing_cm': 50},
            {'name': 'Karotte', 'row_spacing_m': 30},
        ).data
        response = self.apply(draft)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(Crop.objects.filter(project=self.project).count(), 0)


class WarningAcknowledgementTests(CropImportFlowTestCase):
    """Warnings must be visible in the preview and consciously accepted."""

    def test_warnings_are_visible_before_execution(self):
        response = self.preview({'name': 'Kuerbis', 'row_spacing_m': 2.5})

        self.assertTrue(response.data['has_warnings'])
        self.assertGreaterEqual(len(response.data['items'][0]['warnings']), 1)

    def test_apply_without_acknowledging_warnings_is_refused(self):
        draft = self.preview({'name': 'Kuerbis', 'row_spacing_m': 2.5}).data
        response = self.apply(draft, acknowledge_warnings=False)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'], 'warnings_not_acknowledged')
        self.assertEqual(Crop.objects.filter(project=self.project).count(), 0)

    def test_apply_with_acknowledged_warnings_succeeds(self):
        draft = self.preview({'name': 'Kuerbis', 'row_spacing_m': 2.5}).data
        response = self.apply(draft, acknowledge_warnings=True)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['created_count'], 1)

    def test_a_draft_without_warnings_needs_no_acknowledgement(self):
        draft = self.preview({'name': 'Brokkoli', 'row_spacing_cm': 50}).data
        response = self.apply(draft, acknowledge_warnings=False)

        self.assertEqual(response.status_code, 200)


class IdempotencyTests(CropImportFlowTestCase):
    """Re-running an import must converge, never duplicate."""

    def test_applying_the_same_draft_twice_creates_one_crop(self):
        draft = self.preview(
            {'name': 'Brokkoli', 'variety': 'Calabrese', 'row_spacing_cm': 50}
        ).data

        first = self.apply(draft)
        second = self.apply(draft)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertFalse(first.data['already_applied'])
        self.assertTrue(second.data['already_applied'])
        self.assertEqual(Crop.objects.filter(project=self.project, name='Brokkoli').count(), 1)

    def test_re_previewing_the_same_payload_yields_a_skip(self):
        payload = {'name': 'Brokkoli', 'variety': 'Calabrese', 'row_spacing_cm': 50}
        self.apply(self.preview(payload).data)

        second_preview = self.preview(payload)

        self.assertEqual(second_preview.data['items'][0]['action'], 'skip')
        self.assertEqual(second_preview.data['summary']['create'], 0)

    def test_running_the_whole_flow_twice_creates_one_crop(self):
        payload = {'name': 'Brokkoli', 'variety': 'Calabrese', 'row_spacing_cm': 50}
        self.apply(self.preview(payload).data)
        second = self.apply(self.preview(payload).data)

        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.data['created_count'], 0)
        self.assertEqual(second.data['skipped_count'], 1)
        self.assertEqual(Crop.objects.filter(project=self.project, name='Brokkoli').count(), 1)

    def test_applied_draft_reports_its_result_on_retrieval(self):
        draft = self.preview({'name': 'Brokkoli'}).data
        self.apply(draft)

        response = self.client.get(f'/api/crop-imports/{draft["draft_id"]}/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['status'], 'applied')
        self.assertFalse(response.data['requires_confirmation'])
        self.assertEqual(response.data['result']['created_count'], 1)


class TransactionalExecutionTests(CropImportFlowTestCase):
    """A rejection anywhere in the batch rolls the whole batch back."""

    def test_a_serializer_rejection_rolls_back_earlier_rows(self):
        draft = self.preview(
            {'name': 'Guter Datensatz', 'row_spacing_cm': 50},
            {'name': 'Schlechter Datensatz', 'variety': 'Rot', 'supplier_name': 'Neuer Lieferant'},
        ).data

        # Make the second row fail at write time only: the crop the draft
        # would create now collides with one created after the preview.
        supplier = Supplier.objects.create(
            name='Neuer Lieferant',
            homepage_url='https://neuer-lieferant.example',
            project=self.project,
        )
        Crop.objects.create(
            name='Schlechter Datensatz', variety='Rot', project=self.project, supplier=supplier
        )

        response = self.apply(draft)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'], 'execution_failed')
        self.assertFalse(Crop.objects.filter(name='Guter Datensatz').exists())

    def test_a_disappeared_match_is_reported_instead_of_creating_a_row(self):
        existing = Crop.objects.create(
            name='Brokkoli', variety='Calabrese', project=self.project, row_spacing_m=0.4
        )
        draft = self.preview(
            {'name': 'Brokkoli', 'variety': 'Calabrese', 'row_spacing_cm': 50}
        ).data
        existing.delete()

        response = self.apply(draft)
        self.assertEqual(response.status_code, 400)


class ImportProjectIsolationTests(CropImportFlowTestCase):
    """Drafts belong to a project and cannot be reached from another one."""

    def setUp(self):
        super().setUp()
        self.other_user = User.objects.create_user(
            username='other-importer', email='other@example.com', password='pw', is_active=True
        )
        self.other_project = Project.objects.create(name='Other Farm', slug='other-farm')
        ProjectMembership.objects.create(
            user=self.other_user, project=self.other_project, role='admin'
        )
        _, self.other_raw_token = ProjectApiToken.create_token(
            user=self.other_user,
            project=self.other_project,
            name='Other importer',
            scope=ProjectApiToken.SCOPE_WRITE,
        )
        self.other_client = APIClient()
        self.other_client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.other_raw_token}')

    def test_a_foreign_draft_is_not_retrievable(self):
        draft = self.preview({'name': 'Brokkoli'}).data
        response = self.other_client.get(f'/api/crop-imports/{draft["draft_id"]}/')
        self.assertEqual(response.status_code, 404)

    def test_a_foreign_draft_cannot_be_applied(self):
        draft = self.preview({'name': 'Brokkoli'}).data
        response = self.other_client.post(
            f'/api/crop-imports/{draft["draft_id"]}/apply/',
            {'confirm': True, 'checksum': draft['checksum'], 'acknowledge_warnings': True},
            format='json',
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(Crop.objects.filter(name='Brokkoli').count(), 0)

    def test_import_writes_into_the_bound_project_only(self):
        draft = self.preview({'name': 'Brokkoli'}).data
        self.apply(draft)

        crop = Crop.objects.get(name='Brokkoli')
        self.assertEqual(crop.project_id, self.project.id)

    def test_a_read_token_cannot_preview_or_apply(self):
        _, read_token = ProjectApiToken.create_token(
            user=self.user,
            project=self.project,
            name='Read only',
            scope=ProjectApiToken.SCOPE_READ,
        )
        read_client = APIClient()
        read_client.credentials(HTTP_AUTHORIZATION=f'Bearer {read_token}')

        response = read_client.post(PREVIEW_URL, {'items': [{'name': 'X'}]}, format='json')
        self.assertEqual(response.status_code, 403)

    def test_a_read_token_may_retrieve_an_existing_draft(self):
        draft = self.preview({'name': 'Brokkoli'}).data
        _, read_token = ProjectApiToken.create_token(
            user=self.user, project=self.project, name='Read only', scope=ProjectApiToken.SCOPE_READ
        )
        read_client = APIClient()
        read_client.credentials(HTTP_AUTHORIZATION=f'Bearer {read_token}')

        response = read_client.get(f'/api/crop-imports/{draft["draft_id"]}/')
        self.assertEqual(response.status_code, 200)


class ImportSessionAccessTests(CropImportFlowTestCase):
    """The same flow works for a signed-in browser user."""

    def test_session_user_can_run_the_flow_with_the_project_header(self):
        client = APIClient()
        client.force_authenticate(user=self.user)

        preview = client.post(
            PREVIEW_URL,
            {'items': [{'name': 'Brokkoli', 'row_spacing_cm': 50}]},
            format='json',
            HTTP_X_PROJECT_ID=str(self.project.id),
        )
        self.assertEqual(preview.status_code, 200)

        applied = client.post(
            f'/api/crop-imports/{preview.data["draft_id"]}/apply/',
            {'confirm': True, 'checksum': preview.data['checksum']},
            format='json',
            HTTP_X_PROJECT_ID=str(self.project.id),
        )
        self.assertEqual(applied.status_code, 200)
        self.assertEqual(applied.data['created_count'], 1)


class OrderDataImportTests(CropImportFlowTestCase):
    """An order export must contribute only what it actually states."""

    def test_only_recognized_fields_are_imported_from_an_order_row(self):
        order_row = {
            'name': 'Brokkoli',
            'product_name': 'Brokkoli Calabrese Bio 25 g',
            'article_no': 'BR-1234',
            'package_size': '25 g',
            'order_quantity': 2,
            'price_eur': 4.9,
        }
        draft = self.preview(order_row).data
        self.apply(draft)

        crop = Crop.objects.get(project=self.project, name='Brokkoli')
        self.assertEqual(crop.variety, '')
        self.assertIsNone(crop.seed_rate_direct_value)
        self.assertIsNone(crop.row_spacing_m)
        self.assertEqual(crop.seed_packages.count(), 0)


class LegacyCultureImportPathTests(CropImportFlowTestCase):
    """The pre-"Crop" agent-import paths must survive the rename.

    Migration 0100 rewrites the stored preview payload of drafts created before
    the rename so they stay applicable — which is only worth anything if the
    path that applies them still resolves. External agent integrations also
    keep posting the old spelling until they are updated.
    """

    def test_legacy_preview_and_apply_complete_a_full_import(self):
        preview = self.client.post(
            '/api/culture-imports/preview/',
            {'items': [{'name': 'Brokkoli', 'variety': 'Calabrese'}], 'source_label': 'legacy'},
            format='json',
        )
        self.assertEqual(preview.status_code, 200)
        draft = preview.json()

        applied = self.client.post(
            f'/api/culture-imports/{draft["draft_id"]}/apply/',
            {'confirm': True, 'checksum': draft['checksum'], 'acknowledge_warnings': True},
            format='json',
        )

        self.assertEqual(applied.status_code, 200)
        self.assertTrue(
            Crop.objects.filter(project=self.project, name='Brokkoli', variety='Calabrese').exists()
        )

    def test_a_draft_created_on_the_new_path_applies_through_the_legacy_one(self):
        """The mixed case a deploy actually produces, in both directions."""
        draft = self.preview({'name': 'Karotte', 'variety': 'Nantes'}).json()

        applied = self.client.post(
            f'/api/culture-imports/{draft["draft_id"]}/apply/',
            {'confirm': True, 'checksum': draft['checksum'], 'acknowledge_warnings': True},
            format='json',
        )

        self.assertEqual(applied.status_code, 200)
        self.assertTrue(Crop.objects.filter(project=self.project, name='Karotte').exists())

    def test_legacy_draft_detail_path_resolves(self):
        draft = self.preview({'name': 'Rote Bete'}).json()

        response = self.client.get(f'/api/culture-imports/{draft["draft_id"]}/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['draft_id'], draft['draft_id'])
