"""Version-history invariants: every completed version restores exactly, every restore is undoable.

A scripted scenario drives the real API through every model in
`PROJECT_STATE_MODELS`. Each completed write records a version and the
captured project state. Every recorded version is then restored and compared
with its capture, and the automatic backup is restored and compared with the
pre-restore state. See docs/versioning-and-history.md#what-to-check-before-changing-this.
"""

import io
from dataclasses import dataclass
from itertools import pairwise
from typing import Any
from uuid import uuid4

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image
from rest_framework.test import APITestCase

from crops.models import CropSpecies
from farm.history.project_restore import (
    CHECKPOINT_KEY,
    PROJECT_STATE_MODELS,
    ProjectState,
    capture_project_state,
)
from farm.models import (
    BatchOperation,
    CropCompanion,
    CropSupplierData,
    EntityRevision,
    MediaFile,
    Project,
    ProjectMembership,
    PublicCrop,
    RetainedUpload,
)
from farm.tests.history_guard import latest_selectable_revision, state_diff

API = '/openfarmplanner/api'
RESTORE_URL = f'{API}/history/project/restore/'
IN_MEMORY_STORAGE = {
    'default': {'BACKEND': 'django.core.files.storage.InMemoryStorage'},
    'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
}

# Clearing a crop image marks its media orphaned with a plain queryset update
# that records no revision (#1196); versions therefore disagree on this field.
ORPHAN_MARKER_GAP_1196 = r'media_file#\d+\.orphaned_at'
KNOWN_DIFF_FIELDS_1196 = frozenset({'media_file.orphaned_at'})

# #1194: the backup of a restore is refused whenever the restore re-created a
# row that is absent from the pre-restore state (a row deleted later in the
# scenario). Such refusals must stay atomic. The test fails as soon as one of
# them succeeds; the fix for #1194 then sets this to False.
BACKUP_REFUSED_AFTER_RECREATION_1194 = True


def recreates_absent_rows(version: ProjectState, current: ProjectState) -> bool:
    """Whether restoring `version` brings back a row that `current` does not hold."""
    return any(pk not in current[label] for label, rows in version.items() for pk in rows)


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
            snapshot__has_key=CHECKPOINT_KEY,
            action=EntityRevision.ACTION_UPDATED,
        ).latest('created_at', 'id')

    def assert_state(self, expected: ProjectState, message: str) -> None:
        diff = [
            line
            for line in state_diff(expected, capture_project_state(self.project))
            if f"{line.split('#', 1)[0]}.{line.split(':', 1)[0].rsplit('.', 1)[-1]}"
            not in KNOWN_DIFF_FIELDS_1196
        ]
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
        final = self.versions[-1].state
        for version in self.versions[:-1]:
            with self.subTest(step=version.step):
                before = capture_project_state(self.project)
                self.assertEqual(
                    self.restore(version.revision), 200, f'restoring {version.step} was refused'
                )
                self.assert_state(version.state, f'restoring {version.step} does not reproduce it')
                backup = self.latest_backup()
                if BACKUP_REFUSED_AFTER_RECREATION_1194 and recreates_absent_rows(
                    version.state, final
                ):
                    after, counts = capture_project_state(self.project), self.history_counts()
                    self.assert_refusal_is_atomic(self.restore(backup), after, counts)
                else:
                    self.assertEqual(
                        self.restore(backup),
                        200,
                        f'the backup of restoring {version.step} was refused',
                    )
                    self.assert_state(
                        before, f'the backup of restoring {version.step} does not reproduce it'
                    )
            # Every step starts from the same end state, reached the way users can today (#1194),
            # so the outcome of one step does not depend on the known refusals of another.
            self.assertEqual(self.restore(self.versions[-1].revision), 200)
            self.assert_state(
                self.versions[-1].state, 'restoring the final version does not reproduce it'
            )


@pytest.mark.history_gap(
    issue=1196,
    match=ORPHAN_MARKER_GAP_1196,
    reason='clearing a crop image updates the media orphan marker without a revision',
)
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
        self.write('delete spare bed', 'delete', f"/beds/{ids['spare_bed']}/")
        self.write('delete supplier', 'delete', f"/suppliers/{ids['supplier']}/")
        self.write('delete variety', 'delete', f"/crops/{ids['variety']}/")
        return ids

    def test_every_version_and_every_backup_restores_exactly(self) -> None:
        self.build_scenario()
        self.round_trip_every_version()

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
        self.assertEqual(
            self.restore(self.latest_backup()), 200, 'the backup of the import undo was refused'
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
        self.assertEqual(
            self.restore(self.latest_backup()), 200, 'the backup of the batch revert was refused'
        )
        self.assert_state(
            before_revert, 'the backup of the batch revert does not reproduce the season'
        )


CROP_RESTORE_PATH_DIFFERENCES_1195 = frozenset()


@pytest.mark.history_gap(
    issue=1196,
    match=ORPHAN_MARKER_GAP_1196,
    reason='clearing a crop image updates the media orphan marker without a revision',
)
class HistoryRestorePathConsistencyTests(HistoryInvariantTestCase):
    def crop_row(self, crop_id: int) -> dict[str, Any]:
        return capture_project_state(self.project)['crop'][str(crop_id)]

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
        self.write(
            'remove supplier link', 'patch', variety_url, {'supplier_id': None},
        )
        self.write('delete unused supplier', 'delete', f'/suppliers/{supplier}/')
        self.write(
            'later general crop edit', 'patch', f'/crops/{general}/', {'rotation_break_years': 6},
        )

        self.assertEqual(self.restore(completed.revision), 200)
        self.assert_state(completed.state, 'implicit crop save restores its completed version')


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
