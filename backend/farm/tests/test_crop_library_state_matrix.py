"""Matrix tests for the private-crop <-> public-library lifecycle.

Every cell comes from `farm.dev_fixtures.library_state_matrix` (the same
fixtures the dev seed command and the Playwright exploration use). The
invariants under test are listed in docs/crop-library-state-matrix.md.
"""

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase as DRFAPITestCase

from crops.permissions import grant_public_library_moderator_access
from farm.dev_fixtures.library_state_matrix import (
    CELL_SPECS,
    ESTABLISHED_USERNAME,
    PUBLISHER_USERNAME,
    MatrixCell,
    build_library_state_matrix,
)
from farm.models import Crop, PublicCrop, PublicCropChangeProposal
from farm.services.public_crops import reinstate_removed_public_crop, remove_public_crop

API = '/openfarmplanner/api'
UNPUBLISHED_CELLS = [
    'own_withdrawn', 'own_removed', 'foreign_withdrawn', 'foreign_removed',
]


class LibraryStateMatrixTest(DRFAPITestCase):
    def setUp(self):
        self.fixture = build_library_state_matrix()

    def _login(self, cell: MatrixCell) -> None:
        self.client.force_authenticate(user=self.fixture.users[cell.username])
        self.client.defaults['HTTP_X_PROJECT_ID'] = str(self.fixture.projects[cell.username].id)

    def _get(self, cell: MatrixCell):
        self._login(cell)
        return self.client.get(f'{API}/crops/{cell.crop_id}/')

    def test_crop_serializer_reports_the_defined_state_of_every_cell(self):
        for cell in self.fixture.cells.values():
            with self.subTest(cell=cell.key):
                response = self._get(cell)
                self.assertEqual(response.status_code, status.HTTP_200_OK)
                actual = {name: response.data[name] for name in cell.expected}
                self.assertEqual(actual, cell.expected)

    def test_unlink_is_offered_exactly_when_the_endpoint_accepts_it(self):
        for cell in self.fixture.cells.values():
            with self.subTest(cell=cell.key):
                data = self._get(cell).data
                response = self.client.post(f'{API}/crops/{cell.crop_id}/unlink-public-crop/')
                if data['can_unlink_public_crop']:
                    self.assertEqual(response.status_code, status.HTTP_200_OK)
                    self.assertIsNone(response.data['source_public_crop'])
                else:
                    self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
                    self.assertEqual(response.data['code'], data['unlink_public_crop_blocked_reason'])

    def test_linked_entry_is_described_by_the_crop_itself(self):
        for key, cell in self.fixture.cells.items():
            if cell.public_crop_id is None:
                continue
            with self.subTest(cell=key):
                data = self._get(cell).data
                self.assertEqual(data['source_public_crop_title'], f'Matrix {key}')

    def test_push_and_sync_are_rejected_with_a_stable_code_for_unpublished_entries(self):
        for key in UNPUBLISHED_CELLS:
            cell = self.fixture.cells[key]
            self._login(cell)
            with self.subTest(cell=key, action='sync-preview'):
                response = self.client.get(
                    f'{API}/crops/{cell.crop_id}/public-sync/', {'public_crop_id': cell.public_crop_id},
                )
                self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
                self.assertEqual(response.data['code'], 'public_crop_link_unavailable')
            with self.subTest(cell=key, action='sync-apply'):
                response = self.client.post(
                    f'{API}/crops/{cell.crop_id}/public-sync/',
                    {'public_crop_id': cell.public_crop_id, 'push_fields': ['growth_duration_days']},
                    format='json',
                )
                self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
                self.assertEqual(response.data['code'], 'public_crop_link_unavailable')

    def test_publish_is_rejected_for_removed_and_foreign_withdrawn_entries(self):
        for key in ('own_removed', 'foreign_withdrawn', 'foreign_removed'):
            cell = self.fixture.cells[key]
            self._login(cell)
            with self.subTest(cell=key):
                response = self.client.post(
                    f'{API}/crops/{cell.crop_id}/publish-public/',
                    {'accepted_public_library_terms': True}, format='json',
                )
                self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
                self.assertEqual(response.data['code'], 'public_crop_link_unavailable')

    def test_status_changes_never_touch_private_values_and_restore_resumes_the_link(self):
        cell = self.fixture.cells['foreign_published_local_changes']
        moderator = self.fixture.users[PUBLISHER_USERNAME]
        grant_public_library_moderator_access(moderator)
        entry = PublicCrop.objects.get(pk=cell.public_crop_id)
        before = Crop.objects.values().get(pk=cell.crop_id)

        remove_public_crop(
            public_crop=entry, user=moderator, reason=PublicCrop.REMOVAL_REASON_TEST_DATA,
            force_moderator_reason=True,
        )
        removed = self._get(cell).data
        self.assertEqual(removed['public_publish_blocked_reason'], 'entry_removed')
        self.assertFalse(removed['public_update_available'])
        self.assertEqual(Crop.objects.values().get(pk=cell.crop_id), before)

        reinstate_removed_public_crop(public_crop=entry, user=moderator)
        restored = self._get(cell).data
        self.assertEqual(restored['source_public_crop_status'], 'published')
        self.assertIsNone(restored['public_publish_blocked_reason'])
        self.assertEqual(Crop.objects.values().get(pk=cell.crop_id), before)

    def test_a_crop_unlinked_while_removed_stays_unlinked_after_a_restore(self):
        cell = self.fixture.cells['foreign_removed']
        moderator = self.fixture.users[PUBLISHER_USERNAME]
        grant_public_library_moderator_access(moderator)
        self._login(cell)
        self.assertEqual(
            self.client.post(f'{API}/crops/{cell.crop_id}/unlink-public-crop/').status_code, 200,
        )

        reinstate_removed_public_crop(
            public_crop=PublicCrop.objects.get(pk=cell.public_crop_id), user=moderator,
        )

        data = self._get(cell).data
        self.assertIsNone(data['source_public_crop'])
        self.assertIsNone(data['source_public_crop_status'])

    def test_unlink_keeps_provenance_of_an_unpublished_link(self):
        cell = self.fixture.cells['own_removed']
        self._login(cell)

        self.client.post(f'{API}/crops/{cell.crop_id}/unlink-public-crop/')

        crop = Crop.objects.get(pk=cell.crop_id)
        self.assertEqual(crop.derived_from_public_crop_id, cell.public_crop_id)

    def test_no_cell_needs_a_public_endpoint_or_produces_an_error_on_the_detail_read(self):
        self.assertEqual(set(self.fixture.cells), set(CELL_SPECS))
        for cell in self.fixture.cells.values():
            with self.subTest(cell=cell.key):
                self.assertLess(self._get(cell).status_code, 400)
                self.assertLess(
                    self.client.get(f'{API}/crops/{cell.crop_id}/public-update/').status_code, 400,
                )

    def test_rejected_change_proposal_brings_the_push_back_instead_of_reading_as_synced(self):
        cell = self.fixture.cells['new_account_proposal_pending']
        self.assertTrue(self._get(cell).data['public_change_proposal_pending'])

        PublicCropChangeProposal.objects.filter(public_crop_id=cell.public_crop_id).update(
            status=PublicCropChangeProposal.STATUS_REJECTED,
        )

        data = self._get(cell).data
        self.assertFalse(data['public_change_proposal_pending'])
        self.assertIsNone(data['public_publish_blocked_reason'])
        self.assertTrue(data['is_modified_from_source'])

    def test_builder_is_idempotent(self):
        first = {key: cell.crop_id for key, cell in self.fixture.cells.items()}

        second = build_library_state_matrix()

        self.assertEqual({key: cell.crop_id for key, cell in second.cells.items()}, first)
        self.assertEqual(
            PublicCrop.objects.filter(name__startswith='Matrix ').count(),
            len([cell for cell in second.cells.values() if cell.public_crop_id]),
        )


class SeedLibraryStateMatrixCommandTest(DRFAPITestCase):
    @override_settings(DEBUG=False)
    def test_refuses_to_run_without_debug(self):
        with self.assertRaises(CommandError):
            call_command('seed_library_state_matrix')

    @override_settings(DEBUG=True)
    def test_seeds_every_cell_twice_without_duplicates(self):
        call_command('seed_library_state_matrix', verbosity=0)
        call_command('seed_library_state_matrix', verbosity=0)

        self.assertEqual(
            Crop.objects.filter(name__startswith='Matrix ').count(), len(CELL_SPECS),
        )
        self.assertTrue(
            Crop.objects.filter(project__memberships__user__username=ESTABLISHED_USERNAME).exists(),
        )
