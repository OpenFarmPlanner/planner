"""Version-history invariants: every completed version restores exactly, every restore is undoable.

A scripted scenario drives the real API through every model in
`PROJECT_STATE_MODELS`. Each completed write records a version and the
captured project state. Every recorded version is then restored and compared
with its capture, and the automatic backup is restored and compared with the
pre-restore state. See docs/versioning-and-history.md#what-to-check-before-changing-this.
"""

import io
from dataclasses import dataclass
from datetime import timedelta
from itertools import pairwise
from typing import Any
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APITestCase

from crops.models import CropSpecies
from farm.history.project_restore import (
    AUTOMATIC_BACKUP_KEY,
    CHECKPOINT_KEY,
    PROJECT_STATE_MODELS,
    ProjectState,
    capture_project_state,
    record_project_checkpoint,
)
from farm.history.records import revision_batch
from farm.history.throttling import (
    ProjectRestorePreviewIpThrottle,
    ProjectRestorePreviewUserThrottle,
)
from farm.models import (
    BatchOperation,
    Crop,
    CropCompanion,
    CropSupplierData,
    EntityRevision,
    Location,
    MediaFile,
    Project,
    ProjectMembership,
    PublicCrop,
    RetainedUpload,
)
from farm.tests.history_guard import latest_selectable_revision, state_diff

API = '/openfarmplanner/api'
RESTORE_URL = f'{API}/history/project/restore/'
RESTORE_PREVIEW_URL = f'{API}/history/project/restore-preview/'
IN_MEMORY_STORAGE = {
    'default': {'BACKEND': 'django.core.files.storage.InMemoryStorage'},
    'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
}

def _png(name: str) -> SimpleUploadedFile:
    buffer = io.BytesIO()
    Image.new('RGB', (4, 4), color=(20, 120, 40)).save(buffer, format='PNG')
    return SimpleUploadedFile(name, buffer.getvalue(), content_type='image/png')


@dataclass(frozen=True)
class Version:
    step: str
    revision: EntityRevision
    state: ProjectState


@override_settings(STORAGES=IN_MEMORY_STORAGE)
class HistoryInvariantTestCase(APITestCase):
    """A project created empty, so every row is written through the API."""

    def setUp(self) -> None:
        self.user = get_user_model().objects.create_user(
            username='history-invariants',
            email='history@example.com',
            password='pw',
            is_active=True,
        )
        self.project = Project.objects.create(
            name='History invariants', slug=f'history-{uuid4().hex[:8]}'
        )
        ProjectMembership.objects.create(user=self.user, project=self.project, role='admin')
        self.client.force_authenticate(user=self.user)
        self.client.defaults['HTTP_X_PROJECT_ID'] = str(self.project.pk)
        self.versions: list[Version] = []

    def write(
        self, step: str, method: str, path: str, data: Any = None, *, multipart: bool = False
    ) -> dict:
        """Send one API write and record the completed version it produced."""
        kwargs = {'format': 'multipart'} if multipart else {'format': 'json'}
        response = getattr(self.client, method)(f'{API}{path}', data, **kwargs)
        self.assertLess(
            response.status_code, 300, f'{step}: {response.status_code} {response.content[:500]!r}'
        )
        revision = latest_selectable_revision(self.project)
        self.assertIsNotNone(revision, step)
        self.versions.append(Version(step, revision, capture_project_state(self.project)))
        return response.json() if response.content else {}

    def restore(self, revision: EntityRevision) -> int:
        return self.client.post(RESTORE_URL, {'history_id': revision.pk}, format='json').status_code

    def latest_backup(self) -> EntityRevision:
        """The automatic pre-restore checkpoint recorded just before the restore result."""
        return EntityRevision.objects.filter(
            project=self.project,
            entity_type='project',
            snapshot__has_key=AUTOMATIC_BACKUP_KEY,
            action=EntityRevision.ACTION_UPDATED,
        ).latest('created_at', 'id')

    def assert_backup_listed(self, backup: EntityRevision) -> None:
        entries = self.client.get(f'{API}/history/project/').json()
        entry = next(item for item in entries if item['history_id'] == backup.pk)
        self.assertTrue(entry['is_automatic_backup'])
        self.assertFalse(entry.get('is_batch', False))
        self.assertFalse(entry['is_current_version'])
        self.assertFalse(entries[0].get('is_automatic_backup', False))

    def assert_state(self, expected: ProjectState, message: str) -> None:
        diff = state_diff(expected, capture_project_state(self.project))
        self.assertEqual(diff, [], f'{message}:\n  ' + '\n  '.join(diff))

    def assert_refusal_is_atomic(
        self, status_code: int, before: ProjectState, counts: tuple[int, int]
    ) -> None:
        self.assertEqual(status_code, 409)
        self.assert_state(before, 'a refused restore changed the project')
        self.assertEqual(
            self.history_counts(), counts, 'a refused restore wrote history or retained uploads'
        )

    def history_counts(self) -> tuple[int, int]:
        return (
            EntityRevision.objects.filter(project=self.project).count(),
            RetainedUpload.objects.filter(project=self.project).count(),
        )

    def round_trip_every_version(self) -> None:
        """Restore each recorded version, compare, then restore its backup and compare."""
        for version in self.versions[:-1]:
            with self.subTest(step=version.step):
                before = capture_project_state(self.project)
                self.assertEqual(
                    self.restore(version.revision), 200, f'restoring {version.step} was refused'
                )
                self.assert_state(version.state, f'restoring {version.step} does not reproduce it')
                backup = self.latest_backup()
                self.assertEqual(
                    self.restore(backup),
                    200,
                    f'the backup of restoring {version.step} was refused',
                )
                self.assert_state(
                    before, f'the backup of restoring {version.step} does not reproduce it'
                )


class CompositeMutationHistoryTests(HistoryInvariantTestCase):
    def assert_completed_action(
        self, previous: EntityRevision, parent: str, children: list[str],
    ) -> None:
        completed = self.versions[-1].revision
        self.assertEqual(completed.entity_type, parent)
        entries = self.client.get(f'{API}/history/project/').json()
        self.assertEqual(
            [entry['history_id'] for entry in entries if entry['history_id'] > previous.pk],
            [completed.pk],
        )
        related = self.project.entity_revisions.filter(pk__gt=previous.pk, pk__lt=completed.pk)
        self.assertCountEqual([revision.entity_type for revision in related], children)
        for revision in related:
            before, counts = capture_project_state(self.project), self.history_counts()
            self.assert_refusal_is_atomic(self.restore(revision), before, counts)

    def test_field_duplicate_restores_the_complete_structure(self) -> None:
        location = self.write('create location', 'post', '/locations/', {'name': 'North'})
        field = self.write('create field', 'post', '/fields/', {
            'name': 'North field', 'location': location['id'], 'length_m': 24, 'width_m': 10,
            'light_condition': 'shade', 'cultivation_environment': 'greenhouse',
        })
        self.write('create first bed', 'post', '/beds/', {
            'name': 'North 1', 'field': field['id'], 'length_m': 12, 'width_m': 1.5,
        })
        self.write('create second bed', 'post', '/beds/', {
            'name': 'North 2', 'field': field['id'], 'area_sqm': 8,
            'irrigation': 'available',
        })
        before = self.versions[-1]
        path = f"/fields/{field['id']}/duplicate/"
        counts = self.history_counts()
        rejected = self.client.post(f'{API}{path}', {
            'name': 'South field', 'replace_search': '2', 'replace_with': '1',
        }, format='json')
        self.assertEqual(rejected.json()['code'], 'bed_names_conflict')
        self.assert_refusal_is_atomic(rejected.status_code, before.state, counts)

        copy = self.write('duplicate field', 'post', path, {
            'name': 'South field', 'replace_search': 'North', 'replace_with': 'South',
        })
        self.assert_completed_action(before.revision, 'field', ['bed', 'bed'])
        after = self.versions[-1].state
        copied_id = copy['field']['id']
        self.assertEqual(after['field'][str(copied_id)]['light_condition'], 'shade')
        copied_beds = [row for row in after['bed'].values() if row['field_id'] == copied_id]
        self.assertCountEqual([row['name'] for row in copied_beds], ['South 1', 'South 2'])
        self.write('rename the first copied bed', 'patch', f"/beds/{copy['beds'][0]['id']}/", {
            'name': 'First copy renamed',
        })
        self.round_trip_every_version()

    def test_supplier_unlink_undo_restores_complete_versions_after_a_crop_edit(self) -> None:
        supplier = self.write('create supplier', 'post', '/suppliers/', {'name': 'Seed nursery'})
        supplier_id = supplier['id']
        crop = self.write('create crop and offer', 'post', '/crops/', {
            'name': 'Lettuce', 'supplier_id': supplier_id,
            'selected_seed_demand_supplier': supplier_id,
            'supplier_data_input': [{
                'supplier_id': supplier_id, 'seed_status': 'conventional',
                'seed_exemption_status': 'approved', 'price': '4.25',
            }],
        })
        before = self.versions[-1].revision
        result = self.write('unlink and delete supplier', 'post',
                            f'/suppliers/{supplier_id}/unlink-and-delete/')
        self.assert_completed_action(before, 'supplier', ['crop', 'crop_supplier_data'])
        crop_path = f"/crops/{crop['id']}/"
        self.write('edit crop while unlinked', 'patch', crop_path, {'notes': 'Keep the edit'})
        before_undo = self.versions[-1].revision
        self.write('undo supplier unlink', 'post', '/suppliers/restore-unlinked-delete/',
                   result['undo_payload'])
        self.assert_completed_action(before_undo, 'supplier', ['crop', 'crop_supplier_data'])
        after = self.versions[-1].state
        offer_id = result['undo_payload']['supplier_data'][0]['id']
        self.assertEqual(after['crop_supplier_data'][str(offer_id)]['price'], '4.25')
        restored_crop = after['crop'][str(crop['id'])]
        self.assertEqual(restored_crop['selected_seed_demand_supplier_id'], supplier_id)
        self.assertEqual(after['crop'][str(crop['id'])]['notes'], 'Keep the edit')
        self.write('rename restored supplier', 'patch', f'/suppliers/{supplier_id}/', {
            'name': 'New name',
        })
        self.round_trip_every_version()


class ProjectRestorePreviewTests(HistoryInvariantTestCase):
    def preview(self, revision: EntityRevision):
        return self.client.get(RESTORE_PREVIEW_URL, {'history_id': revision.pk})

    def confirm(self, revision: EntityRevision, token: str):
        return self.client.post(
            RESTORE_URL, {'history_id': revision.pk, 'preview_token': token}, format='json',
        )

    def test_preview_counts_named_scope_and_exact_restore_are_read_only_until_confirmed(self):
        location = self.write('location', 'post', '/locations/', {'name': 'North'})
        field = self.write('field', 'post', '/fields/', {
            'name': 'Courtyard', 'location': location['id'],
        })
        bed = self.write('bed', 'post', '/beds/', {
            'name': 'Bed One', 'field': field['id'], 'area_sqm': 12,
        })
        season = self.write('season', 'post', '/seasons/', {
            'start_date': '2026-03-01', 'end_date': '2027-02-28',
        })
        crop = self.write('general crop', 'post', '/crops/', {'name': 'Tomato'})
        variety = self.write('variety', 'post', '/crops/', {'name': 'Tomato', 'variety': 'Roma'})
        self.write('planting plan', 'post', '/planting-plans/', {
            'crop': crop['id'], 'bed': bed['id'], 'season': season['id'],
            'planting_date': '2026-05-01', 'area_usage_sqm': 4,
        })
        historical = self.versions[-1]
        self.write('delete variety', 'delete', f"/crops/{variety['id']}/")
        self.write('edit general crop', 'patch', f"/crops/{crop['id']}/", {'notes': 'New notes'})
        self.write('delete growing area', 'delete', f"/locations/{location['id']}/")
        for index in range(7):
            self.write('add later crop', 'post', '/crops/', {'name': f'Later crop {index}'})
        before, counts = capture_project_state(self.project), self.history_counts()

        response = self.preview(historical.revision)
        self.assertEqual(response.status_code, 200, response.json())
        self.assertIn('no-store', response['Cache-Control'])
        payload = response.json()
        impact = {row['category']: row for row in payload['impact']}
        self.assertEqual(set(impact), {
            'crops', 'varieties', 'planting_plans', 'locations', 'fields', 'beds', 'other',
        })
        self.assertEqual(impact['crops']['removed'], {
            'count': 7, 'names': [f'Later crop {index}' for index in range(5)],
        })
        self.assertEqual(impact['crops']['changed'], {'count': 1, 'names': ['Tomato']})
        self.assertEqual(impact['varieties']['restored'], {
            'count': 1, 'names': ['Tomato (Roma)'],
        })
        self.assertEqual(impact['planting_plans']['restored'], {
            'count': 1, 'names': ['Tomato · Bed One'],
        })
        self.assertEqual(impact['locations']['restored'], {'count': 1, 'names': ['North']})
        self.assertEqual(impact['fields']['restored'], {'count': 1, 'names': ['Courtyard']})
        self.assertEqual(impact['beds']['restored'], {'count': 1, 'names': ['Bed One']})
        self.assertEqual(impact['other']['changed'], {'count': 1, 'names': []})
        self.assertEqual(impact['crops']['restored'], {'count': 0, 'names': []})
        self.assertEqual(capture_project_state(self.project), before)
        self.assertEqual(self.history_counts(), counts)

        response = self.confirm(historical.revision, payload['token'])
        self.assertEqual(response.status_code, 200, response.json())
        self.assert_state(historical.state, 'preview should describe the exact resulting state')
        self.assertEqual(self.latest_backup().snapshot[CHECKPOINT_KEY], before)

    def test_layout_changes_count_as_changed_growing_areas_once(self):
        location = self.write('location', 'post', '/locations/', {'name': 'West'})
        field = self.write('field', 'post', '/fields/', {
            'name': 'Small field', 'location': location['id'],
        })
        bed = self.write('bed', 'post', '/beds/', {
            'name': 'Small bed', 'field': field['id'], 'area_sqm': 12,
        })
        layouts_url = f"/locations/{location['id']}/layouts/"
        for coordinate in (2, 6):
            self.write('configure layouts', 'put', layouts_url, {
                'bed_layouts': [{'bed': bed['id'], 'x': coordinate, 'y': 1}],
                'field_layouts': [{'field': field['id'], 'x': 1, 'y': coordinate}],
            })
        historical = self.versions[-2]
        self.write('rename bed too', 'patch', f"/beds/{bed['id']}/", {'name': 'Renamed bed'})
        response = self.preview(historical.revision)
        self.assertEqual(response.status_code, 200, response.json())
        impact = {row['category']: row for row in response.json()['impact']}
        self.assertEqual(set(impact), {'fields', 'beds'})
        self.assertEqual(impact['fields']['changed'], {'count': 1, 'names': ['Small field']})
        self.assertEqual(impact['beds']['changed'], {'count': 1, 'names': ['Small bed']})
        confirmed = self.confirm(historical.revision, response.json()['token'])
        self.assertEqual(confirmed.status_code, 200, confirmed.json())
        self.assert_state(historical.state, 'restore should match previewed layout positions')

    def test_unsampled_intervening_edit_rejects_confirmation_until_previewed_again(self):
        self.write('target crop', 'post', '/crops/', {'name': 'Baseline'})
        target = self.versions[-1].revision
        for index in range(6):
            outside_sample = self.write('extra crop', 'post', '/crops/', {'name': f'Extra {index}'})
        first_preview = self.preview(target).json()
        self.write('edit outside the sample', 'patch', f"/crops/{outside_sample['id']}/", {
            'notes': 'Save this unless newly confirmed',
        })
        before, counts = capture_project_state(self.project), self.history_counts()

        response = self.confirm(target, first_preview['token'])
        self.assertEqual(response.json()['code'], 'project_restore_preview_changed')
        self.assert_refusal_is_atomic(response.status_code, before, counts)
        self.assert_refusal_is_atomic(self.confirm(target, 'invalid').status_code, before, counts)
        fresh_preview = self.preview(target).json()
        self.assertEqual(fresh_preview['impact'], first_preview['impact'])
        self.assertNotEqual(fresh_preview['token'], first_preview['token'])
        self.assertEqual(self.confirm(target, fresh_preview['token']).status_code, 200)

    def test_no_active_changes_preview_is_distinct_from_an_incomplete_target(self):
        crop = self.write('baseline', 'post', '/crops/', {'name': 'Chard'})
        complete = self.versions[-1].revision
        self.write('temporary edit', 'patch', f"/crops/{crop['id']}/", {'notes': 'Temporary'})
        self.write('reverse edit', 'patch', f"/crops/{crop['id']}/", {'notes': ''})
        response = self.preview(complete)
        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(response.json()['impact'], [])

        Location.objects.create(project=self.project, name='Untracked legacy location')
        chard = Crop.objects.get(pk=crop['id'])
        chard.notes = 'Target'
        chard.save()
        incomplete = latest_selectable_revision(self.project)
        chard.notes = 'Current'
        chard.save()
        before, counts = capture_project_state(self.project), self.history_counts()
        response = self.preview(incomplete)
        self.assertEqual(response.json()['code'], 'project_restore_conflict')
        self.assertNotIn('impact', response.json())
        self.assertNotIn('token', response.json())
        self.assert_refusal_is_atomic(response.status_code, before, counts)

    def test_preview_and_token_use_project_admin_scope_and_selected_revision(self):
        self.write('first version', 'post', '/crops/', {'name': 'First crop'})
        first = self.versions[-1].revision
        self.write('second version', 'post', '/crops/', {'name': 'Second crop'})
        second = self.versions[-1].revision
        self.write('third version', 'post', '/crops/', {'name': 'Third crop'})
        token = self.preview(first).json()['token']
        before, counts = capture_project_state(self.project), self.history_counts()
        self.assert_refusal_is_atomic(self.confirm(second, token).status_code, before, counts)

        other = Project.objects.create(name='Other project', slug='other-preview-project')
        ProjectMembership.objects.create(user=self.user, project=other, role='admin')
        self.client.defaults['HTTP_X_PROJECT_ID'] = str(other.pk)
        self.assertEqual(self.preview(first).status_code, 404)
        self.assertEqual(self.confirm(first, token).status_code, 404)

        self.client.defaults['HTTP_X_PROJECT_ID'] = str(self.project.pk)
        ProjectMembership.objects.filter(user=self.user, project=self.project).update(role='member')
        self.assertEqual(self.preview(first).status_code, 403)
        self.assertEqual(self.confirm(first, token).status_code, 403)
        self.assertEqual(capture_project_state(self.project), before)
        self.assertEqual(self.history_counts(), counts)

    def test_oversized_projects_are_refused_before_capture_without_changes(self):
        self.write('first crop', 'post', '/crops/', {'name': 'First crop'})
        historical = self.versions[-1].revision
        self.write('second crop', 'post', '/crops/', {'name': 'Second crop'})
        token = self.preview(historical).json()['token']
        before, counts = capture_project_state(self.project), self.history_counts()
        for limit in ('MAX_PREVIEW_REVISIONS', 'MAX_PREVIEW_HISTORY_BYTES', 'MAX_PREVIEW_ROWS'):
            with (
                self.subTest(limit=limit),
                patch(f'farm.history.project_restore.{limit}', 1),
                patch('farm.history.project_restore.capture_project_state') as capture,
            ):
                response = self.preview(historical)
                self.assertEqual(response.status_code, 409, response.json())
                self.assertEqual(response.json()['code'], 'project_restore_preview_too_large')
                self.assertNotIn('impact', response.json())
                self.assertNotIn('token', response.json())
                refused_restore = self.confirm(historical, token)
                self.assertEqual(refused_restore.status_code, 409, refused_restore.json())
                self.assertEqual(
                    refused_restore.json()['code'], 'project_restore_preview_too_large',
                )
                capture.assert_not_called()
            self.assert_refusal_is_atomic(response.status_code, before, counts)

    def test_preview_limits_historical_storage_checks(self):
        image = self.write('upload', 'post', '/media-files/upload/', {'file': _png('preview.png')},
                           multipart=True)
        crop = self.write('add crop', 'post', '/crops/', {
            'name': 'Picture crop', 'image_file_id': image['id'],
        })
        historical = self.versions[-1].revision
        self.write('detach photo', 'patch', f"/crops/{crop['id']}/", {'image_file_id': None})
        before, counts = capture_project_state(self.project), self.history_counts()
        with (
            patch('farm.history.project_restore.MAX_PREVIEW_STORAGE_CHECKS', 0),
            patch('farm.history.project_restore.default_storage.exists') as exists,
        ):
            response = self.preview(historical)
            self.assertEqual(response.status_code, 409, response.json())
            self.assertEqual(response.json()['code'], 'project_restore_preview_too_large')
            exists.assert_not_called()
        self.assert_refusal_is_atomic(response.status_code, before, counts)

    def test_preview_requests_are_rate_limited_independently_by_user_and_ip(self):
        self.write('first crop', 'post', '/crops/', {'name': 'First crop'})
        target = self.versions[-1].revision
        self.write('second crop', 'post', '/crops/', {'name': 'Second crop'})
        another_admin = get_user_model().objects.create_user(username='preview-admin')
        ProjectMembership.objects.create(user=another_admin, project=self.project, role='admin')
        before, counts = capture_project_state(self.project), self.history_counts()

        def preview_as(user, ip):
            self.client.force_authenticate(user=user)
            return self.client.get(RESTORE_PREVIEW_URL, {'history_id': target.pk}, REMOTE_ADDR=ip)

        for throttle in (ProjectRestorePreviewUserThrottle, ProjectRestorePreviewIpThrottle):
            scope = f'test_preview_{uuid4().hex}'
            with (
                self.subTest(throttle=throttle.__name__),
                patch.object(throttle, 'scope', scope),
                patch.object(throttle, 'THROTTLE_RATES', {scope: '1/minute'}),
            ):
                self.assertEqual(preview_as(self.user, '192.0.2.1').status_code, 200)
                if throttle is ProjectRestorePreviewUserThrottle:
                    response = preview_as(self.user, '192.0.2.2')
                else:
                    response = preview_as(another_admin, '192.0.2.1')
                self.assertEqual(response.status_code, 429, response.json())
                self.assertIn('Retry-After', response)
                self.assertEqual(capture_project_state(self.project), before)
                self.assertEqual(self.history_counts(), counts)


class HistoryRoundTripScenarioTests(HistoryInvariantTestCase):
    def build_scenario(self) -> dict[str, int]:
        """Create, update and delete rows of every restorable model through the API."""
        ids: dict[str, int] = {}
        ids['location'] = self.write('create location', 'post', '/locations/', {'name': 'North'})[
            'id'
        ]
        ids['field'] = self.write(
            'create field',
            'post',
            '/fields/',
            {
                'name': 'Field A',
                'location': ids['location'],
            },
        )['id']
        ids['bed'] = self.write(
            'create bed',
            'post',
            '/beds/',
            {
                'name': 'Bed 1',
                'field': ids['field'],
                'area_sqm': 12,
            },
        )['id']
        ids['spare_bed'] = self.write(
            'create spare bed',
            'post',
            '/beds/',
            {
                'name': 'Bed 2',
                'field': ids['field'],
                'area_sqm': 8,
            },
        )['id']
        self.write(
            'place beds and fields',
            'put',
            f"/locations/{ids['location']}/layouts/",
            {
                'bed_layouts': [{'bed': ids['bed'], 'x': 1, 'y': 2}],
                'field_layouts': [{'field': ids['field'], 'x': 3, 'y': 4}],
            },
        )
        self.write(
            'rename location', 'patch', f"/locations/{ids['location']}/", {'name': 'North garden'}
        )
        self.write('rename field', 'patch', f"/fields/{ids['field']}/", {'name': 'Field A (east)'})
        self.write(
            'move beds and fields',
            'put',
            f"/locations/{ids['location']}/layouts/",
            {
                'bed_layouts': [{'bed': ids['bed'], 'x': 5, 'y': 6}],
                'field_layouts': [{'field': ids['field'], 'x': 7, 'y': 8}],
            },
        )
        ids['supplier'] = self.write(
            'create supplier', 'post', '/suppliers/', {'name': 'Seeds & Co'}
        )['id']
        ids['media'] = self.write(
            'upload crop image',
            'post',
            '/media-files/upload/',
            {
                'file': _png('crop.png'),
            },
            multipart=True,
        )['id']
        crop = self.write(
            'create crop with supplier data and seed package',
            'post',
            '/crops/',
            {
                'name': 'Tomate',
                'growth_duration_days': 90,
                'harvest_duration_days': 30,
                'image_file_id': ids['media'],
                'supplier_data_input': [{'supplier_id': ids['supplier'], 'notes': 'First offer'}],
                'seed_packages': [{'size_value': 5, 'size_unit': 'g'}],
            },
        )
        ids['crop'] = crop['id']
        ids['variety'] = self.write(
            'create variety',
            'post',
            '/crops/',
            {
                'name': 'Tomate',
                'variety': 'Roma',
                'growth_duration_days': 85,
                'harvest_duration_days': 25,
            },
        )['id']
        ids['neighbour'] = self.write(
            'create neighbour crop',
            'post',
            '/crops/',
            {
                'name': 'Basilikum',
                'growth_duration_days': 60,
                'harvest_duration_days': 40,
            },
        )['id']
        ids['companion'] = self.write(
            'create companion',
            'post',
            '/crop-companions/',
            {
                'crop': ids['crop'],
                'companion_crop': ids['neighbour'],
                'kind': 'good',
                'reason': 'other',
            },
        )['id']
        ids['template'] = self.write(
            'create task template',
            'post',
            '/crop-task-templates/',
            {
                'crop': ids['crop'],
                'title': 'Stake plants',
                'reference_event': 'planting',
                'offset_days': 7,
            },
        )['id']
        self.write(
            'change season pattern', 'patch', '/season-pattern/', {'start_day': 1, 'start_month': 3}
        )
        ids['season'] = self.write(
            'create season',
            'post',
            '/seasons/',
            {
                'start_date': '2026-03-01',
                'end_date': '2027-02-28',
            },
        )['id']
        self.write('change season pattern again', 'patch', '/season-pattern/', {'start_day': 15})
        self.write(
            'extend season', 'patch', f"/seasons/{ids['season']}/", {'end_date': '2027-03-14'}
        )
        ids['plan'] = self.write(
            'create planting plan',
            'post',
            '/planting-plans/',
            {
                'crop': ids['crop'],
                'bed': ids['bed'],
                'season': ids['season'],
                'planting_date': '2026-05-01',
                'area_usage_sqm': 4,
            },
        )['id']
        ids['harvest'] = self.write(
            'record harvest', 'post', '/harvests/', {
                'crop': ids['crop'], 'date': '2026-08-06', 'quantity': '5', 'unit': 'kg',
                'allocations': [{'planting_plan': ids['plan'], 'quantity': '3'}],
            },
        )['id']
        self.write(
            'adjust harvest allocation', 'patch', f"/harvests/{ids['harvest']}/", {
                'quantity': '6', 'allocations': [{'planting_plan': ids['plan'], 'quantity': '4'}],
            },
        )
        ids['loss'] = self.write(
            'record crop loss', 'post', '/crop-losses/', {
                'planting_plan': ids['plan'], 'date': '2026-05-08', 'loss_type': 'partial',
                'cause': 'frost', 'extent_value': '20', 'extent_unit': 'percent',
            },
        )['id']
        self.write(
            'add crop loss note', 'patch', f"/crop-losses/{ids['loss']}/", {'note': 'Outer row'},
        )
        ids['task'] = self.write(
            'create manual task',
            'post',
            '/tasks/',
            {
                'title': 'Water seedlings',
                'season': ids['season'],
                'planting_plan': ids['plan'],
            },
        )['id']
        ids['attachment'] = self.write(
            'attach note image',
            'post',
            f"/notes/{ids['plan']}/attachments/",
            {
                'image': _png('note.png'),
            },
            multipart=True,
        )['id']

        self.write('rename bed', 'patch', f"/beds/{ids['bed']}/", {'name': 'Bed 1 (south)'})
        self.write(
            'edit crop, supplier data and seed package',
            'patch',
            f"/crops/{ids['crop']}/",
            {
                'notes': 'Grow under cover',
                'supplier_data_input': [
                    {
                        'id': CropSupplierData.objects.get(crop_id=ids['crop']).pk,
                        'supplier_id': ids['supplier'],
                        'notes': 'Second offer',
                    }
                ],
                'seed_packages': [{'size_value': 10, 'size_unit': 'g'}],
            },
        )
        self.write(
            'edit companion',
            'patch',
            f"/crop-companions/{ids['companion']}/",
            {'reason': 'pest_control'},
        )
        self.write('complete task', 'patch', f"/tasks/{ids['task']}/", {'status': 'completed'})
        self.write(
            'move planting plan',
            'patch',
            f"/planting-plans/{ids['plan']}/",
            {'planting_date': '2026-05-15'},
        )

        self.write('delete note image', 'delete', f"/attachments/{ids['attachment']}/")
        self.write('delete manual task', 'delete', f"/tasks/{ids['task']}/")
        self.write('delete companion', 'delete', f"/crop-companions/{ids['companion']}/")
        self.write('delete task template', 'delete', f"/crop-task-templates/{ids['template']}/")
        self.write(
            'remove supplier data, seed package and image',
            'patch',
            f"/crops/{ids['crop']}/",
            {
                'supplier_data_input': [],
                'seed_packages': [],
                'image_file_id': None,
            },
        )
        self.write('delete planting plan', 'delete', f"/planting-plans/{ids['plan']}/")
        self.write('delete unassigned harvest', 'delete', f"/harvests/{ids['harvest']}/")
        self.write('delete spare bed', 'delete', f"/beds/{ids['spare_bed']}/")
        self.write('delete supplier', 'delete', f"/suppliers/{ids['supplier']}/")
        self.write('delete variety', 'delete', f"/crops/{ids['variety']}/")
        return ids

    def test_every_version_and_every_backup_restores_exactly(self) -> None:
        self.build_scenario()
        self.round_trip_every_version()
        self.assert_backup_listed(self.latest_backup())

        self.write('crop after backup recovery', 'post', '/crops/', {'name': 'Chard'})
        new_version = self.versions[-1]
        self.write('another crop after recovery', 'post', '/crops/', {'name': 'Rosemary'})
        self.assertEqual(self.restore(new_version.revision), 200)
        self.assert_state(new_version.state, 'a version after backup recovery did not restore')

    def test_untracked_rows_in_the_replay_interval_still_block_restore(self) -> None:
        crop_id = self.write('establish baseline', 'post', '/crops/', {'name': 'Chard'})['id']
        Location.objects.create(project=self.project, name='Untracked legacy location')
        crop = Crop.objects.get(pk=crop_id)
        crop.notes = 'Selected revision'
        crop.save()
        target = latest_selectable_revision(self.project)
        crop.notes = 'Newer work'
        crop.save()

        before = capture_project_state(self.project)
        counts = self.history_counts()
        response = self.client.post(RESTORE_URL, {'history_id': target.pk}, format='json')
        self.assertEqual(response.json()['code'], 'project_restore_conflict')
        self.assert_refusal_is_atomic(response.status_code, before, counts)

    def test_scenario_covers_every_restorable_model(self) -> None:
        """A new entry in PROJECT_STATE_MODELS must come with scenario coverage."""
        self.build_scenario()
        created = {
            label for version in self.versions for label, rows in version.state.items() if rows
        }
        changed = {
            label
            for earlier, later in pairwise(self.versions)
            for label in later.state
            if earlier.state[label] and earlier.state[label] != later.state[label]
        }
        labels = {label for _model, label in PROJECT_STATE_MODELS}
        self.assertEqual(labels - created, set(), 'models the scenario never creates')
        self.assertEqual(labels - changed, set(), 'models the scenario never updates or deletes')

    def test_refused_restores_are_atomic(self) -> None:
        self.build_scenario()
        before = capture_project_state(self.project)
        counts = self.history_counts()
        current = self.client.post(
            RESTORE_URL, {'history_id': self.versions[-1].revision.pk}, format='json'
        )
        self.assertEqual(current.json()['code'], 'already_current_version')
        self.assert_refusal_is_atomic(current.status_code, before, counts)
        internal = EntityRevision.objects.filter(
            project=self.project,
            snapshot__has_key='_project_version_internal',
        ).first()
        self.assertIsNotNone(internal, 'the scenario records no internal derived revision')
        self.assert_refusal_is_atomic(self.restore(internal), before, counts)


class HistoryGroupedOperationRoundTripTests(HistoryInvariantTestCase):
    def test_restore_before_spreadsheet_and_library_imports_replays_complete_state(self) -> None:
        season = self.write('existing season', 'post', '/seasons/', {
            'start_date': '2026-01-01', 'end_date': '2026-12-31',
        })['id']
        existing = self.write('existing crop', 'post', '/crops/', {'name': 'Lettuce'})['id']
        location = self.write('existing location', 'post', '/locations/', {'name': 'Garden'})['id']
        field = self.write('existing field', 'post', '/fields/', {
            'name': 'Field', 'location': location,
        })['id']
        bed = self.write('existing bed', 'post', '/beds/', {
            'name': 'Bed', 'field': field, 'area_sqm': 20,
        })['id']
        self.write('existing planting plan', 'post', '/planting-plans/', {
            'crop': existing, 'bed': bed, 'season': season,
            'planting_date': '2026-03-15', 'area_usage_sqm': 5,
        })
        target = self.versions[-1]

        import_id = str(uuid4())
        for phase, items in (
            ('crops', [
                {'name': 'Spreadsheet basil'}, {'name': 'Spreadsheet basil', 'variety': 'Green'},
            ]),
            ('finalize', []),
        ):
            self.write(f'spreadsheet {phase}', 'post', '/crops/import/apply/', {
                'items': items, 'phase': phase, 'import_operation_id': import_id,
            })
        sheet = Crop.objects.filter(project=self.project, name='Spreadsheet basil').order_by('pk')
        self.assertEqual(list(sheet.values_list('variety', flat=True)), ['', 'Green'])
        species = CropSpecies.objects.create(name='History library herb')
        public_ids, imported = [], []
        for variety in ('', 'Purple'):
            public = PublicCrop.objects.create(
                name='History library herb', variety=variety, crop_species=species,
                status=PublicCrop.STATUS_PUBLISHED, created_by=self.user,
            )
            public_ids.append(public.pk)
            result = self.write('library import', 'post', f'/public-crops/{public.pk}/import/', {})
            imported.append(result['crop']['id'])

        later_bed = self.write('later bed', 'post', '/beds/', {
            'name': 'Later bed', 'field': field, 'area_sqm': 20,
        })['id']
        for crop in (sheet.last().pk, imported[-1]):
            self.write('later planting plan', 'post', '/planting-plans/', {
                'crop': crop, 'bed': later_bed, 'season': season,
                'planting_date': '2026-04-15', 'area_usage_sqm': 5,
            })

        batch = BatchOperation.objects.get(request_id=import_id)
        before_counts = self.history_counts()
        refused = self.client.post(f'{API}/history/batch/{batch.pk}/revert/')
        self.assert_refusal_is_atomic(refused.status_code, self.versions[-1].state, before_counts)
        originals = PublicCrop.objects.filter(pk__in=public_ids).order_by('pk')
        public_state = list(originals.values())
        revisions = EntityRevision.objects.filter(project=self.project).values_list('pk', flat=True)
        audit_ids = set(revisions)

        self.assertEqual(self.restore(target.revision), 200)
        self.assert_state(target.state, 'full restore did not match the pre-import version')
        active_crops = Crop.objects.filter(project=self.project).values_list('pk', flat=True)
        self.assertEqual(list(active_crops), [existing])
        self.assertEqual(list(originals.values()), public_state)
        self.assertEqual(EntityRevision.objects.filter(pk__in=audit_ids).count(), len(audit_ids))

    def test_import_undo_and_its_backup_restore_exactly(self) -> None:
        self.write(
            'create existing crop',
            'post',
            '/crops/',
            {
                'name': 'Möhre',
                'growth_duration_days': 80,
                'harvest_duration_days': 20,
                'notes': 'before import',
            },
        )
        import_id = str(uuid4())
        for phase, items in (
            ('crops', [{'name': 'Möhre', 'notes': 'imported'}, {'name': 'Lauch'}]),
            ('finalize', []),
        ):
            self.write(
                f'import {phase}',
                'post',
                '/crops/import/apply/',
                {
                    'items': items,
                    'phase': phase,
                    'import_operation_id': import_id,
                    'confirm_updates': True,
                },
            )
        batch = BatchOperation.objects.get(request_id=import_id)
        before_undo = capture_project_state(self.project)
        self.write('undo import', 'post', f'/history/batch/{batch.pk}/revert/')
        self.assert_state(
            self.versions[0].state, 'undoing the import does not return to the pre-import state'
        )
        backup = self.latest_backup()
        self.assert_backup_listed(backup)
        # Older import undos stored the before-checkpoint in the undo group.
        undo_group = BatchOperation.objects.get(
            project=self.project, operation_type=BatchOperation.TYPE_REVERTED,
        )
        EntityRevision.objects.filter(pk=backup.pk).update(
            batch_operation=undo_group, snapshot={CHECKPOINT_KEY: backup.snapshot[CHECKPOINT_KEY]},
        )
        self.assert_backup_listed(backup)
        self.assertEqual(
            self.restore(backup), 200, 'the backup of the import undo was refused'
        )
        self.assert_state(
            before_undo, 'the backup of the import undo does not reproduce the imported state'
        )

    def test_legacy_season_batch_revert_and_its_backup_restore_exactly(self) -> None:
        self.write(
            'create crop',
            'post',
            '/crops/',
            {
                'name': 'Salat',
                'growth_duration_days': 50,
                'harvest_duration_days': 14,
            },
        )
        self.write(
            'create season',
            'post',
            '/seasons/',
            {'start_date': '2026-03-01', 'end_date': '2027-02-28'},
        )
        batch = BatchOperation.objects.filter(
            project=self.project,
            operation_type=BatchOperation.TYPE_SEASON_CREATE,
        ).latest('id')
        before_revert = capture_project_state(self.project)
        self.write('revert season creation', 'post', f'/history/batch/{batch.pk}/revert/')
        self.assert_state(
            self.versions[0].state, 'reverting the season creation does not remove it'
        )
        backup = self.latest_backup()
        self.assert_backup_listed(backup)
        self.assertEqual(
            self.restore(backup), 200, 'the backup of the batch revert was refused'
        )
        self.assert_state(
            before_revert, 'the backup of the batch revert does not reproduce the season'
        )


CROP_RESTORE_PATH_DIFFERENCES_1195 = frozenset()


class HistoryRestorePathConsistencyTests(HistoryInvariantTestCase):
    def crop_row(self, crop_id: int) -> dict[str, Any]:
        return capture_project_state(self.project)['crop'][str(crop_id)]

    def upload_image(self, name: str) -> MediaFile:
        receipt = self.write(
            'upload image', 'post', '/media-files/upload/', {'file': _png(name)}, multipart=True,
        )
        return MediaFile.objects.get(pk=receipt['id'])

    def assert_orphan(self, image: MediaFile, expected: bool) -> None:
        image.refresh_from_db()
        self.assertEqual(image.orphaned_at is not None, expected)

    def test_restore_reconciles_shared_images_and_retains_bytes_until_cleanup(self) -> None:
        now = timezone.now()
        with patch('django.utils.timezone.now', return_value=now - timedelta(days=45)):
            replaced = self.upload_image('replaced.png')
            shared = self.upload_image('shared.png')
            first = self.write('attach first', 'post', '/crops/', {
                'name': 'First crop', 'image_file_id': shared.pk,
            })['id']
            second = self.write('attach second', 'post', '/crops/', {
                'name': 'Second crop', 'image_file_id': shared.pk,
            })['id']
            self.write('replace one reference', 'patch', f'/crops/{first}/', {
                'image_file_id': replaced.pk,
            })
            self.assert_orphan(shared, False)
            self.write('clear replacement', 'patch', f'/crops/{first}/', {'image_file_id': None})
            orphan_version = self.versions[-1]
        self.write('reattach replacement', 'patch', f'/crops/{first}/', {
            'image_file_id': replaced.pk,
        })
        self.assert_orphan(replaced, False)

        other = Project.objects.create(name='Other project', slug='other-media-project')
        other_path = default_storage.save('other.png', _png('other.png'))
        other_media = MediaFile.objects.create(project=other, storage_path=other_path)
        Crop.objects.create(project=other, name='Other crop', image_file=other_media)

        self.assertEqual(self.restore(orphan_version.revision), 200)
        self.assert_state(orphan_version.state, 'restoring a detached image changed its marker')
        backup = self.latest_backup()
        call_command('cleanup_orphaned_media')
        self.assertTrue(default_storage.exists(replaced.storage_path))
        self.assertEqual(self.restore(backup), 200)
        self.assert_orphan(replaced, False)
        self.assertEqual(self.restore(orphan_version.revision), 200)
        self.assert_orphan(replaced, True)
        self.assert_orphan(shared, False)

        with patch('django.utils.timezone.now', return_value=now + timedelta(days=31)):
            call_command('cleanup_orphaned_media')
        self.assertFalse(MediaFile.objects.filter(pk=replaced.pk).exists())
        self.assertFalse(default_storage.exists(replaced.storage_path))
        self.assertTrue(default_storage.exists(shared.storage_path))
        self.assertTrue(default_storage.exists(other_path))
        self.assert_orphan(other_media, False)
        self.assertEqual(Crop.objects.get(pk=second).image_file_id, shared.pk)
        before, counts = capture_project_state(self.project), self.history_counts()
        self.assert_refusal_is_atomic(self.restore(backup), before, counts)
        self.assert_refusal_is_atomic(self.restore(orphan_version.revision), before, counts)

    def test_batch_revert_reconciles_images_after_reverting_a_legacy_group(self) -> None:
        old = self.upload_image('before-batch.png')
        introduced = self.upload_image('introduced-in-batch.png')
        crop_id = self.write('attach old', 'post', '/crops/', {
            'name': 'Batch crop', 'image_file_id': old.pk,
        })['id']
        batch = BatchOperation.objects.create(
            project=self.project, operation_type=BatchOperation.TYPE_SEASON_COPY_DATA,
        )
        # Legacy grouped revisions could include crop fields without a media revision.
        with revision_batch(batch):
            self.write('replace image in group', 'patch', f'/crops/{crop_id}/', {
                'image_file_id': introduced.pk,
            })
        batch.revisions.filter(entity_type='media_file').update(batch_operation=None)
        self.assert_orphan(old, True)
        self.assert_orphan(introduced, False)
        self.write('revert image group', 'post', f'/history/batch/{batch.pk}/revert/')
        self.assertEqual(Crop.objects.get(pk=crop_id).image_file_id, old.pk)
        self.assert_orphan(old, False)
        self.assert_orphan(introduced, True)
        self.assertEqual(self.restore(self.latest_backup()), 200)
        self.assert_orphan(old, True)
        self.assert_orphan(introduced, False)

    def test_full_restore_repairs_a_legacy_snapshot_with_an_unrecorded_orphan(self) -> None:
        media = self.upload_image('legacy-orphan.png')
        crop_id = self.write('create crop', 'post', '/crops/', {'name': 'Legacy crop'})['id']
        state = capture_project_state(self.project)
        state['media_file'][str(media.pk)]['orphaned_at'] = None
        record_project_checkpoint(self.project, state)
        legacy = latest_selectable_revision(self.project)
        self.write('attach image', 'patch', f'/crops/{crop_id}/', {'image_file_id': media.pk})

        self.assertEqual(self.restore(legacy), 200)
        self.assertIsNone(Crop.objects.get(pk=crop_id).image_file_id)
        self.assert_orphan(media, True)
        self.assertTrue(default_storage.exists(media.storage_path))

    def test_import_undo_reconciles_restored_and_detached_images(self) -> None:
        old = self.upload_image('before-import.png')
        introduced = self.upload_image('introduced-in-import.png')
        crop_id = self.write('attach old', 'post', '/crops/', {
            'name': 'Import crop', 'image_file_id': old.pk,
        })['id']
        import_id = str(uuid4())
        self.write('import crop image', 'post', '/crops/import/apply/', {
            'items': [{'name': 'Import crop', 'image_file_id': introduced.pk}],
            'confirm_updates': True, 'import_operation_id': import_id,
        })
        self.assert_orphan(old, True)
        self.assert_orphan(introduced, False)
        batch = BatchOperation.objects.get(request_id=import_id)
        self.write('undo import', 'post', f'/history/batch/{batch.pk}/revert/')
        self.assertEqual(Crop.objects.get(pk=crop_id).image_file_id, old.pk)
        self.assert_orphan(old, False)
        self.assert_orphan(introduced, True)
        self.assertEqual(self.restore(self.latest_backup()), 200)
        self.assertEqual(Crop.objects.get(pk=crop_id).image_file_id, introduced.pk)
        self.assert_orphan(old, True)
        self.assert_orphan(introduced, False)

    def test_per_crop_and_full_project_restore_agree_on_a_crop_version(self) -> None:
        first_species = CropSpecies.objects.create(name='Earlier restore species')
        second_species = CropSpecies.objects.create(name='Later restore species')
        media = self.write(
            'upload image', 'post', '/media-files/upload/', {'file': _png('a.png')}, multipart=True
        )['id']
        newer_media = self.write(
            'upload replacement', 'post', '/media-files/upload/', {'file': _png('b.png')},
            multipart=True,
        )['id']
        first_supplier = self.write('first supplier', 'post', '/suppliers/', {'name': 'First'})
        second_supplier = self.write('second supplier', 'post', '/suppliers/', {'name': 'Second'})
        crop_id = self.write(
            'create crop',
            'post',
            '/crops/',
            {
                'name': 'Erbse',
                'growth_duration_days': 70,
                'harvest_duration_days': 21,
                'notes': 'old',
                'crop_species': first_species.pk,
                'image_file_id': media,
                'supplier_id': first_supplier['id'],
                'selected_seed_demand_supplier': second_supplier['id'],
            },
        )['id']
        created = self.versions[-1].revision
        self.write(
            'edit crop',
            'patch',
            f'/crops/{crop_id}/',
            {
                'notes': 'new',
                'crop_species': second_species.pk,
                'image_file_id': newer_media,
                'supplier_id': second_supplier['id'],
                'selected_seed_demand_supplier': first_supplier['id'],
            },
        )
        edited = self.versions[-1]

        per_crop = self.client.post(
            f'{API}/crops/{crop_id}/restore/', {'history_id': created.pk}, format='json'
        )
        self.assertEqual(per_crop.status_code, 200, per_crop.content)
        per_crop_row = self.crop_row(crop_id)
        self.assertIsNone(MediaFile.objects.get(pk=media).orphaned_at)
        self.assertIsNotNone(MediaFile.objects.get(pk=newer_media).orphaned_at)

        self.assertEqual(self.restore(edited.revision), 200)
        global_restore = self.client.post(
            f'{API}/history/global/restore/', {'history_id': created.pk}, format='json'
        )
        self.assertEqual(global_restore.status_code, 200, global_restore.content)
        global_row = self.crop_row(crop_id)
        self.assertEqual(self.restore(edited.revision), 200)
        self.assertEqual(self.restore(created), 200)
        project_row = self.crop_row(crop_id)

        ignored = {'updated_at'}
        differences = {
            name
            for name in per_crop_row.keys() | project_row.keys()
            if name not in ignored and per_crop_row.get(name) != project_row.get(name)
        }
        self.assertEqual(differences, CROP_RESTORE_PATH_DIFFERENCES_1195)
        self.assertEqual(
            {key: value for key, value in project_row.items() if key not in ignored},
            {key: value for key, value in global_row.items() if key not in ignored},
        )
        self.assertEqual(project_row['crop_species_id'], first_species.pk)
        self.assertEqual(project_row['image_file_id'], media)
        self.assertEqual(project_row['supplier_id'], first_supplier['id'])
        self.assertEqual(project_row['selected_seed_demand_supplier_id'], second_supplier['id'])


class HistoryImplicitCropSaveTests(HistoryInvariantTestCase):
    def test_completed_crop_version_includes_implicit_supplier_and_general_changes(self) -> None:
        species = CropSpecies.objects.create(name='Crop history promotion species')
        general = self.write('general crop', 'post', '/crops/', {
            'name': 'History bean', 'crop_species': species.pk,
        })['id']
        prior_version = self.versions[-1].revision.pk
        variety = self.write('create linked variety', 'post', '/crops/', {
            'name': 'History bean', 'variety': 'Sample variety', 'crop_species': species.pk,
            'crop_family': 'Fabaceae', 'cultivation_types': ['pre_cultivation'],
            'supplier_name': 'Implicit history supplier',
        })
        supplier = variety['supplier']['id']
        completed = self.versions[-1]
        self.assertEqual((completed.revision.entity_type, completed.revision.object_id), (
            'crop', variety['id'],
        ))
        revisions = EntityRevision.objects.filter(project=self.project, pk__gt=prior_version)
        visible = revisions.exclude(snapshot__has_key='_project_version_internal')
        self.assertEqual(list(visible.values_list('pk', flat=True)), [completed.revision.pk])
        internal = revisions.filter(snapshot__has_key='_project_version_internal')
        self.assertTrue(internal.filter(entity_type='supplier', object_id=supplier).exists())
        self.assertTrue(internal.filter(entity_type='crop', object_id=general).exists())
        history = self.client.get(f"{API}/crops/{variety['id']}/history/")
        self.assertEqual(history.status_code, 200)
        self.assertEqual([row['history_id'] for row in history.json()], [completed.revision.pk])

        variety_url = f"/crops/{variety['id']}/"
        self.write('fill linked general field', 'patch', variety_url, {'nutrient_demand': 'high'})
        saved_edit = self.versions[-1].revision
        self.assertEqual(saved_edit.snapshot['nutrient_demand'], '')
        history = self.client.get(f'{API}{variety_url}history/').json()
        self.assertEqual(history[0]['history_id'], saved_edit.pk)
        self.assertEqual(history[0]['changes'], [
            {'field': 'nutrient_demand', 'old_value': '', 'new_value': 'high'},
        ])
        general_url = f'/crops/{general}/'
        for restore_url in (f'{variety_url}restore/', '/history/global/restore/'):
            with self.subTest(restore_url=restore_url):
                self.write('change shared nutrient demand', 'patch', general_url, {
                    'nutrient_demand': 'low',
                })
                self.write('restore promoted value', 'post', restore_url, {
                    'history_id': saved_edit.pk,
                })
                self.assertEqual(Crop.objects.get(pk=general).nutrient_demand, 'high')
                restored = self.versions[-1].revision
                self.assertEqual(restored.action, EntityRevision.ACTION_RESTORED)
                self.assertEqual(restored.object_id, variety['id'])
                self.assertEqual(restored.snapshot['nutrient_demand'], '')

        self.write(
            'remove supplier link', 'patch', variety_url, {'supplier_id': None},
        )
        self.write('delete unused supplier', 'delete', f'/suppliers/{supplier}/')
        self.write(
            'later general crop edit', 'patch', f'/crops/{general}/', {'rotation_break_years': 6},
        )

        self.assertEqual(self.restore(completed.revision), 200)
        self.assert_state(completed.state, 'implicit crop save restores its completed version')

        self.write('delete original general crop', 'delete', general_url)
        self.write('new general for the same species', 'post', '/crops/', {
            'name': 'History bean', 'crop_species': species.pk, 'nutrient_demand': 'low',
        })
        before = capture_project_state(self.project)
        counts = self.history_counts()
        conflict = self.client.post(f'{API}{variety_url}restore/', {
            'history_id': saved_edit.pk,
        }, format='json')
        self.assertEqual(conflict.json()['field'], 'general_crop')
        self.assert_refusal_is_atomic(conflict.status_code, before, counts)


class HistoryLibraryCompanionRoundTripTests(HistoryInvariantTestCase):
    """Library import, update and link write neighbours with their history (#1192)."""

    def library_entry(self, name: str, species: CropSpecies, companions: list[dict]) -> PublicCrop:
        return PublicCrop.objects.create(
            name=name,
            variety='',
            status=PublicCrop.STATUS_PUBLISHED,
            created_by=self.user,
            crop_species=species,
            growth_duration_days=90,
            harvest_duration_days=30,
            companions=companions,
        )

    @staticmethod
    def neighbour(species: CropSpecies, kind: str, name: str) -> dict:
        return {
            'species': species.pk, 'species_name': name, 'family': None,
            'kind': kind, 'reason': 'other', 'note': '',
        }

    def library_state(self) -> list[tuple]:
        return list(
            PublicCrop.objects.order_by('pk')
            .values_list('pk', 'version', 'companions', 'updated_at')
        )

    def test_library_neighbour_writes_restore_exactly(self) -> None:
        potato = CropSpecies.objects.create(name='History companion potato')
        pepper = CropSpecies.objects.create(name='History companion pepper')
        tomato = CropSpecies.objects.create(name='History companion tomato')
        sage = CropSpecies.objects.create(name='History companion sage')
        cabbages = {
            'species': None, 'species_name': '', 'family': 'Brassicaceae',
            'kind': 'good', 'reason': 'other', 'note': '',
        }
        pepper_entry = self.library_entry(
            'Paprika', pepper, [self.neighbour(potato, 'bad', 'Kartoffel'), cabbages],
        )
        tomato_entry = self.library_entry(
            'Tomate', tomato, [self.neighbour(potato, 'bad', 'Kartoffel')],
        )
        crop = {'variety': '', 'growth_duration_days': 90, 'harvest_duration_days': 30}
        potato_id = self.write(
            'create potato Kultur', 'post', '/crops/',
            {**crop, 'name': 'Kartoffel', 'crop_species': potato.pk},
        )['id']
        tomato_id = self.write(
            'create tomato Kultur', 'post', '/crops/',
            {**crop, 'name': 'Tomate', 'crop_species': tomato.pk},
        )['id']
        self.write(
            'import pepper with neighbours', 'post', f'/public-crops/{pepper_entry.pk}/import/', {},
        )
        self.write('edit potato', 'patch', f'/crops/{potato_id}/', {'notes': 'early'})

        pepper_entry.companions = [
            self.neighbour(potato, 'good', 'Kartoffel'), self.neighbour(sage, 'good', 'Salbei'),
        ]
        pepper_entry.version += 1
        pepper_entry.save()
        self.write(
            'update pepper from the library', 'post', f'/public-crops/{pepper_entry.pk}/import/',
            {'mode': 'update'},
        )
        self.write(
            'link tomato taking neighbours', 'post', f'/crops/{tomato_id}/link-public-crop/',
            {
                'public_crop_id': tomato_entry.pk, 'base_version': tomato_entry.version,
                'pull_fields': ['companions'],
            },
        )
        self.write('edit tomato', 'patch', f'/crops/{tomato_id}/', {'notes': 'staked'})

        relations = CropCompanion.objects.filter(project=self.project)
        self.assertEqual(relations.filter(companion_family__isnull=False).count(), 0)
        self.assertEqual(relations.filter(companion_text='Salbei', kind='good').count(), 1)
        self.assertEqual(relations.filter(companion_crop__isnull=False, kind='good').count(), 1)
        self.assertEqual(relations.filter(companion_crop__isnull=False, kind='bad').count(), 1)
        library = self.library_state()
        self.round_trip_every_version()
        self.assertEqual(self.library_state(), library, 'restoring changed library records')
