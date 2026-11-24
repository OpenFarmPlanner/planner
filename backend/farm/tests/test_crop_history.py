from datetime import date, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from crops.models import CropSpecies
from farm.germination import GERMINATION_FIELDS
from farm.history.records import _serialize_instance
from farm.models import (
    BatchOperation,
    Crop,
    CropLibraryUsageDay,
    CropRevision,
    EntityRevision,
    Location,
    MediaFile,
    Project,
    ProjectMembership,
    ProjectRevision,
    RetainedUpload,
    Supplier,
)
from farm.tests.api_base import record_later_revision

User = get_user_model()


def legacy_crop_snapshot(snapshot):
    """Represent a crop written before farm.0137."""
    added_fields = {
        *GERMINATION_FIELDS, 'seed_type', 'life_cycle', 'light_requirement',
        'pests_diseases', 'water_requirement', 'winter_hardiness', 'specific_properties',
        'plant_health', 'annual_harvest_window', 'first_harvest_delay_years',
    }
    return {
        **{key: value for key, value in snapshot.items() if key not in added_fields},
        'germination_types': ['cold'],
        'germination_days_min': 7,
    }


class CropHistoryTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='histuser', email='hist@example.com', password='testpass', is_active=True)
        self.client.force_login(self.user)
        self.project = Project.objects.create(name='History Project', slug='history-project')
        ProjectMembership.objects.create(user=self.user, project=self.project, role='admin')
        self.client.defaults['HTTP_X_PROJECT_ID'] = str(self.project.id)
        self.crop = Crop.objects.create(name='Carrot', variety='Nantes', growth_duration_days=60, harvest_duration_days=20, harvest_method='per_plant', project=self.project)

    def test_history_list_endpoint(self):
        self.crop.name = 'Carrot Updated'
        self.crop.save()

        response = self.client.get(f'/openfarmplanner/api/crops/{self.crop.id}/history/')
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(len(response.json()), 2)
        entry = response.json()[0]
        self.assertEqual(entry.get('object_type'), 'crop')
        self.assertIn('object_display_name', entry)
        self.assertIn('action', entry)
        self.assertTrue(entry.get('is_current_version'))
        self.assertFalse(response.json()[1].get('is_current_version'))
        self.assertIn(
            {'field': 'name', 'old_value': 'Carrot', 'new_value': 'Carrot Updated'},
            entry.get('changes'),
        )

    def test_restore_endpoint(self):
        history_before = self.client.get(f'/openfarmplanner/api/crops/{self.crop.id}/history/')
        original_revision_id = history_before.json()[0]['history_id']
        self.crop.name = 'Changed'
        self.crop.save()

        response = self.client.post(
            f'/openfarmplanner/api/crops/{self.crop.id}/restore/',
            data={'history_id': original_revision_id},
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.name, 'Carrot')

    def assert_rejected_crop_restore(self, fields, code, *, field=None):
        from farm.history.project_restore import capture_project_state

        version = EntityRevision.objects.create(
            project=self.project, entity_type='crop', object_id=self.crop.pk,
            action=EntityRevision.ACTION_UPDATED,
            snapshot={**_serialize_instance(self.crop), 'notes': 'Historical notes', **fields},
        )
        before = capture_project_state(self.project)
        history = list(EntityRevision.objects.filter(project=self.project).order_by('pk').values())
        for url in (f'/api/crops/{self.crop.pk}/restore/', '/api/history/global/restore/'):
            with self.subTest(url=url, code=code, field=field):
                response = self.client.post(
                    url, {'history_id': version.pk}, content_type='application/json',
                )
                self.assertEqual(response.status_code, 409, response.content)
                self.assertEqual(response.json()['code'], code)
                if field is not None:
                    self.assertEqual(response.json()['field'], field)
                self.assertEqual(capture_project_state(self.project), before)
                self.assertEqual(
                    list(EntityRevision.objects.filter(project=self.project).order_by('pk').values()),
                    history,
                )

    def test_crop_restore_rejects_unavailable_references_without_changing_history(self):
        species = CropSpecies.objects.create(name='Deleted historical crop species')
        species_id = species.pk
        species.delete()
        supplier = Supplier.objects.create(project=self.project, name='Deleted historical supplier')
        supplier_id = supplier.pk
        supplier.delete()
        media = MediaFile.objects.create(
            project=self.project, storage_path='crop-media/deleted.png',
        )
        media_id = media.pk
        media.delete()
        for field, pk in (
            ('crop_species_id', species_id), ('supplier_id', supplier_id),
            ('selected_seed_demand_supplier_id', supplier_id), ('image_file_id', media_id),
        ):
            self.assert_rejected_crop_restore(
                {field: pk}, 'crop_restore_reference_unavailable', field=field,
            )

    def test_crop_restore_rejects_foreign_supplier_and_image_references(self):
        other = Project.objects.create(name='Foreign history references')
        supplier = Supplier.objects.create(project=other, name='Foreign supplier')
        media = MediaFile.objects.create(project=other, storage_path='crop-media/foreign.png')
        for field, pk in (
            ('supplier_id', supplier.pk), ('selected_seed_demand_supplier_id', supplier.pk),
            ('image_file_id', media.pk),
        ):
            self.assert_rejected_crop_restore(
                {field: pk}, 'crop_restore_reference_unavailable', field=field,
            )

    def test_crop_restore_rejects_an_image_without_stored_content(self):
        media = MediaFile.objects.create(
            project=self.project, storage_path='crop-media/missing-history-image.png',
        )
        self.assert_rejected_crop_restore(
            {'image_file_id': media.pk}, 'crop_restore_image_unavailable', field='image_file_id',
        )

    def test_crop_restore_revalidates_species_and_variety_identity(self):
        species = CropSpecies.objects.create(name='Conflicting historical crop species')
        Crop.objects.create(project=self.project, name='Another crop', crop_species=species)
        Crop.objects.create(project=self.project, name=self.crop.name, variety='Historical variety')
        self.assert_rejected_crop_restore(
            {'crop_species_id': species.pk, 'variety': ''}, 'crop_name_conflict',
        )
        self.assert_rejected_crop_restore(
            {'variety': 'Historical variety'}, 'crop_variety_conflict',
        )

    def test_single_crop_restores_legacy_values_and_clears_variety_only_seed_type(self):
        historical = legacy_crop_snapshot(_serialize_instance(self.crop))
        historical.update(variety='', variety_normalized=None)
        version = EntityRevision.objects.create(
            project=self.project, entity_type='crop', object_id=self.crop.pk,
            snapshot=historical, action=EntityRevision.ACTION_UPDATED,
        )
        Crop.objects.filter(pk=self.crop.pk).update(
            seed_type='f1_hybrid', germination_temperature_requirement='none',
            germination_days_min=12, stratification_days_min=21, life_cycle='annual',
            pests_diseases='Later pest note', water_requirement='high', winter_hardiness='hardy',
            annual_harvest_window='09-01/10-15', first_harvest_delay_years=2,
        )

        response = self.client.post(
            f'/api/crops/{self.crop.pk}/restore/', {'history_id': version.pk},
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.variety, '')
        self.assertEqual(self.crop.annual_harvest_window, '')
        self.assertIsNone(self.crop.first_harvest_delay_years)
        self.assert_legacy_crop_values(self.crop)
        version.refresh_from_db()
        self.assertEqual(version.snapshot, historical)

    def legacy_crop_restore_rows(self):
        old_species = CropSpecies.objects.create(name='Historical snapshot species')
        potato = CropSpecies.objects.create(
            name='Historical snapshot potato', specific_property_profile='solanum_tuberosum',
        )
        existing = Crop.objects.create(
            project=self.project, name='Legacy existing crop', crop_species=old_species,
        )
        removed = Crop.objects.create(
            project=self.project, name='Legacy removed crop', variety='Old variety',
            crop_species=old_species,
        )
        current = Crop.objects.create(
            project=self.project, name='Current snapshot crop', variety='Current variety',
            crop_species=potato, seed_type='open_pollinated',
            germination_temperature_requirement='none',
            specific_properties={'cooking_type': 'waxy'}, life_cycle='perennial',
        )
        return existing, removed, current, old_species, potato

    @staticmethod
    def change_legacy_crop_restore_rows(existing, removed, current, potato):
        Crop.objects.filter(pk=existing.pk).update(
            variety='Later variety', variety_normalized='later variety', crop_species=potato,
            seed_type='f1_hybrid', germination_temperature_requirement='none',
            germination_days_min=16, germination_days_max=25, stratification_days_min=21,
            specific_properties={'cooking_type': 'floury'}, life_cycle='annual',
            pests_diseases='Later pest note', water_requirement='high', winter_hardiness='hardy',
        )
        Crop.all_objects.filter(pk=removed.pk).delete()
        Crop.objects.filter(pk=current.pk).update(
            seed_type='', specific_properties={}, life_cycle='',
        )

    def assert_legacy_crop_values(self, crop, *, light_requirement=''):
        self.assertEqual(crop.seed_type, '')
        self.assertEqual(crop.germination_types, ['cold'])
        self.assertEqual(crop.germination_temperature_requirement, 'cold_stratification')
        self.assertEqual(crop.germination_light_requirement, light_requirement)
        self.assertEqual(crop.germination_days_min, 7)
        self.assertIsNone(crop.germination_days_max)
        self.assertIsNone(crop.stratification_days_min)
        self.assertEqual(crop.specific_properties, {})
        self.assertEqual(
            (crop.life_cycle, crop.pests_diseases, crop.water_requirement, crop.winter_hardiness),
            ('', '', '', ''),
        )

    def assert_legacy_crop_restore_rows(self, existing, removed, current, old_species):
        for crop, light_requirement in ((existing, ''), (removed, 'none')):
            crop.refresh_from_db()
            self.assert_legacy_crop_values(crop, light_requirement=light_requirement)
            self.assertEqual(crop.crop_species_id, old_species.pk)
        self.assertEqual(existing.variety, '')
        self.assertEqual(removed.variety, 'Old variety')
        current.refresh_from_db()
        self.assertEqual(current.seed_type, 'open_pollinated')
        self.assertEqual(current.germination_temperature_requirement, 'none')
        self.assertEqual(current.specific_properties, {'cooking_type': 'waxy'})
        self.assertEqual(current.life_cycle, 'perennial')

    def test_project_restore_normalizes_existing_and_recreated_legacy_crops(self):
        from farm.history.project_restore import capture_project_state, record_project_checkpoint

        existing, removed, current, old_species, potato = self.legacy_crop_restore_rows()
        other_project = Project.objects.create(name='Unrelated legacy snapshot project')
        other = Crop.objects.create(project=other_project, name='Unrelated crop', notes='Unchanged')
        state = capture_project_state(self.project)
        for crop in (existing, removed):
            key = str(crop.pk)
            state['crop'][key] = legacy_crop_snapshot(state['crop'][key])
        record_project_checkpoint(self.project, state)
        version = EntityRevision.objects.filter(project=self.project).latest('pk')
        self.change_legacy_crop_restore_rows(existing, removed, current, potato)
        record_project_checkpoint(self.project, capture_project_state(self.project))

        response = self.client.post(
            '/api/history/project/restore/', {'history_id': version.pk},
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assert_legacy_crop_restore_rows(existing, removed, current, old_species)
        other.refresh_from_db()
        self.assertEqual(other.notes, 'Unchanged')

    def test_batch_revert_normalizes_existing_and_recreated_legacy_crops(self):
        existing, removed, current, old_species, potato = self.legacy_crop_restore_rows()
        batch = BatchOperation.objects.create(
            project=self.project, operation_type=BatchOperation.TYPE_REVERTED,
        )
        for crop in (existing, current):
            snapshot = _serialize_instance(crop)
            EntityRevision.objects.create(
                project=self.project, entity_type='crop', object_id=crop.pk,
                snapshot=legacy_crop_snapshot(snapshot) if crop is existing else snapshot,
                action=EntityRevision.ACTION_UPDATED,
            )
        EntityRevision.objects.create(
            project=self.project, entity_type='crop', object_id=removed.pk, batch_operation=batch,
            snapshot=legacy_crop_snapshot(_serialize_instance(removed)),
            action=EntityRevision.ACTION_DELETED,
        )
        self.change_legacy_crop_restore_rows(existing, removed, current, potato)
        for crop in (existing, current):
            EntityRevision.objects.create(
                project=self.project, entity_type='crop', object_id=crop.pk, batch_operation=batch,
                snapshot=_serialize_instance(crop), action=EntityRevision.ACTION_UPDATED,
            )

        response = self.client.post(f'/api/history/batch/{batch.pk}/revert/')

        self.assertEqual(response.status_code, 200, response.content)
        self.assert_legacy_crop_restore_rows(existing, removed, current, old_species)

    def test_restore_brings_back_the_plant_family(self):
        Crop.objects.filter(pk=self.crop.pk).update(crop_family_id='Apiaceae')
        self.crop.refresh_from_db()
        self.crop.name = 'With family'
        self.crop.save()
        revision_id = self.client.get(f'/openfarmplanner/api/crops/{self.crop.id}/history/').json()[0]['history_id']
        self.crop.crop_family_id = 'Fabaceae'
        self.crop.save()

        response = self.client.post(
            f'/openfarmplanner/api/crops/{self.crop.id}/restore/',
            data={'history_id': revision_id},
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 200)
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.crop_family_id, 'Apiaceae')

    def test_restore_maps_the_free_text_family_of_a_pre_plant_family_snapshot(self):
        revision = EntityRevision.objects.filter(
            project=self.project, entity_type='crop', object_id=self.crop.id,
        ).latest('created_at')
        snapshot = dict(revision.snapshot)
        snapshot.pop('crop_family_id', None)
        snapshot.pop('legacy_crop_family', None)
        snapshot['crop_family'] = 'Doldenblütler'
        revision.snapshot = snapshot
        revision.save(update_fields=['snapshot'])
        self.crop.name = 'Changed'
        self.crop.save()

        response = self.client.post(
            f'/openfarmplanner/api/crops/{self.crop.id}/restore/',
            data={'history_id': revision.id},
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 200)
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.name, 'Carrot')
        self.assertEqual(self.crop.crop_family_id, 'Apiaceae')

    def test_restore_cannot_access_another_projects_crop(self):
        other_project = Project.objects.create(name='Other Project', slug='other-project')
        other_crop = Crop.objects.create(
            name='Private Crop',
            variety='Secret',
            growth_duration_days=60,
            harvest_duration_days=20,
            project=other_project,
        )
        revision = EntityRevision.objects.filter(
            project=other_project,
            entity_type='crop',
            object_id=other_crop.pk,
        ).first()

        response = self.client.post(
            f'/openfarmplanner/api/crops/{other_crop.id}/restore/',
            data={'history_id': revision.id},
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 404)

    def test_crop_cannot_reference_another_projects_media(self):
        other_project = Project.objects.create(name='Media Project', slug='media-project')
        other_media = MediaFile.objects.create(
            project=other_project,
            storage_path='crop-media/private.png',
        )

        response = self.client.patch(
            f'/openfarmplanner/api/crops/{self.crop.id}/',
            data={'image_file_id': other_media.id},
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['image_file_id'], ['image_file_project_mismatch'])



    def test_restore_keeps_the_row_identity_and_creation_timestamp(self):
        """The snapshot carries id/created_at/updated_at, but writing them back
        would rewrite the row's identity and audit trail, so restore skips them."""
        original_created_at = self.crop.created_at
        self.crop.name = 'Carrot Renamed'
        self.crop.save()
        history = self.client.get(f'/openfarmplanner/api/crops/{self.crop.id}/history/').json()
        oldest_revision_id = history[-1]['history_id']

        response = self.client.post(
            f'/openfarmplanner/api/crops/{self.crop.id}/restore/',
            {'history_id': oldest_revision_id},
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 200)
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.name, 'Carrot')
        self.assertEqual(self.crop.created_at, original_created_at)

    def test_soft_delete_and_undelete(self):
        delete_response = self.client.delete(f'/openfarmplanner/api/crops/{self.crop.id}/')
        self.assertEqual(delete_response.status_code, 204)

        list_response = self.client.get('/openfarmplanner/api/crops/')
        ids = [item['id'] for item in list_response.json()['results']]
        self.assertNotIn(self.crop.id, ids)

        undelete_response = self.client.post(f'/openfarmplanner/api/crops/{self.crop.id}/undelete/')
        self.assertEqual(undelete_response.status_code, 200)
        self.crop.refresh_from_db()
        self.assertIsNone(self.crop.deleted_at)

    def test_global_history_lists_entries(self):
        self.crop.name = 'Global History Test'
        self.crop.save()

        response = self.client.get('/openfarmplanner/api/history/global/')
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(len(response.json()), 1)
        self.assertTrue(response.json()[0].get('is_current_version'))

    def test_global_history_summary_is_labelled_per_crop(self):
        """The global list spans crops, so its summaries name the crop; the
        per-crop list does not."""
        other_crop = Crop.objects.create(
            name='Beetroot', variety='Boro', growth_duration_days=70,
            harvest_duration_days=15, harvest_method='per_plant', project=self.project,
        )
        self.crop.name = 'Carrot Renamed'
        self.crop.save()
        other_crop.name = 'Beetroot Renamed'
        other_crop.save()

        global_entries = self.client.get('/openfarmplanner/api/history/global/').json()
        for entry in global_entries:
            self.assertTrue(
                entry['summary'].startswith(f"Crop #{entry['crop_id']}: "),
                entry['summary'],
            )

        crop_entries = self.client.get(f'/openfarmplanner/api/crops/{self.crop.id}/history/').json()
        for entry in crop_entries:
            self.assertFalse(entry['summary'].startswith('Crop #'), entry['summary'])

    def test_global_history_diffs_against_the_same_crop(self):
        """Revisions of different crops interleave in the global list, so each
        entry must diff against the previous revision of its own crop."""
        other_crop = Crop.objects.create(
            name='Beetroot', variety='Boro', growth_duration_days=70,
            harvest_duration_days=15, harvest_method='per_plant', project=self.project,
        )
        self.crop.name = 'Carrot Renamed'
        self.crop.save()
        other_crop.name = 'Beetroot Renamed'
        other_crop.save()

        entries = self.client.get('/openfarmplanner/api/history/global/').json()
        latest_carrot = next(entry for entry in entries if entry['crop_id'] == self.crop.id)
        self.assertIn(
            {'field': 'name', 'old_value': 'Carrot', 'new_value': 'Carrot Renamed'},
            latest_carrot['changes'],
        )

    def test_global_history_restore_undeletes_crop(self):
        delete_response = self.client.delete(f'/openfarmplanner/api/crops/{self.crop.id}/')
        self.assertEqual(delete_response.status_code, 204)

        global_history = self.client.get('/openfarmplanner/api/history/global/')
        revision_id = global_history.json()[0]['history_id']
        restore_response = self.client.post(
            '/openfarmplanner/api/history/global/restore/',
            data={'history_id': revision_id},
            content_type='application/json',
        )
        self.assertEqual(restore_response.status_code, 200)
        self.crop.refresh_from_db()
        self.assertIsNone(self.crop.deleted_at)



    def test_project_history_snapshot_created_on_mutation(self):
        mutation_response = self.client.patch(
            f'/openfarmplanner/api/crops/{self.crop.id}/',
            data={
                'name': 'Snapshot Trigger',
                'variety': self.crop.variety,
                'growth_duration_days': self.crop.growth_duration_days,
                'harvest_duration_days': self.crop.harvest_duration_days,
                'harvest_method': self.crop.harvest_method,
            },
            content_type='application/json',
        )
        self.assertEqual(mutation_response.status_code, 200)

        response = self.client.get('/openfarmplanner/api/history/project/')
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(len(response.json()), 1)
        entry = response.json()[0]
        self.assertIn('object_type', entry)
        self.assertIn('action', entry)
        self.assertNotIn('#', entry.get('object_display_name') or '')

    def test_project_restore_restores_previous_project_state(self):
        first_update_response = self.client.patch(
            f'/openfarmplanner/api/crops/{self.crop.id}/',
            data={
                'name': 'Carrot',
                'variety': self.crop.variety,
                'growth_duration_days': self.crop.growth_duration_days,
                'harvest_duration_days': self.crop.harvest_duration_days,
                'harvest_method': self.crop.harvest_method,
            },
            content_type='application/json',
        )
        self.assertEqual(first_update_response.status_code, 200)
        before = self.client.get('/openfarmplanner/api/history/project/')
        first_revision_id = before.json()[0]['history_id']

        second_update_response = self.client.patch(
            f'/openfarmplanner/api/crops/{self.crop.id}/',
            data={
                'name': 'Changed Name',
                'variety': self.crop.variety,
                'growth_duration_days': self.crop.growth_duration_days,
                'harvest_duration_days': self.crop.harvest_duration_days,
                'harvest_method': self.crop.harvest_method,
            },
            content_type='application/json',
        )
        self.assertEqual(second_update_response.status_code, 200)

        restore_response = self.client.post(
            '/openfarmplanner/api/history/project/restore/',
            data={'history_id': first_revision_id},
            content_type='application/json',
        )
        self.assertEqual(restore_response.status_code, 200)
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.name, 'Carrot')

    def test_project_history_marks_only_the_newest_revision_as_current(self):
        for name in ('Beetroot', 'Onion'):
            response = self.client.patch(
                f'/openfarmplanner/api/crops/{self.crop.id}/',
                data={'name': name},
                content_type='application/json',
            )
            self.assertEqual(response.status_code, 200)

        entries = self.client.get('/openfarmplanner/api/history/project/').json()

        self.assertGreaterEqual(len(entries), 2)
        self.assertTrue(entries[0]['is_current_version'])
        self.assertFalse(any(entry['is_current_version'] for entry in entries[1:]))

    def test_project_restore_refuses_the_current_version(self):
        response = self.client.patch(
            f'/openfarmplanner/api/crops/{self.crop.id}/',
            data={'name': 'Beetroot'},
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200)
        history = self.client.get('/openfarmplanner/api/history/project/').json()
        current_id = history[0]['history_id']
        revisions = EntityRevision.objects.filter(project=self.project)
        revision_count = revisions.count()

        restore_response = self.client.post(
            '/openfarmplanner/api/history/project/restore/',
            data={'history_id': current_id},
            content_type='application/json',
        )

        self.assertEqual(restore_response.status_code, 409)
        self.assertEqual(restore_response.json()['code'], 'already_current_version')
        self.assertEqual(revisions.count(), revision_count)

    def test_project_restore_ignores_fields_removed_since_the_snapshot_was_taken(self):
        """A restorable entity's revision may carry a field no longer on the model
        (renamed/removed in a later schema change) — restore must skip it, not crash."""
        location = Location.objects.create(project=self.project, name='Hauptstandort Alt')
        EntityRevision.objects.create(
            project=self.project,
            entity_type='location',
            object_id=location.id,
            action=EntityRevision.ACTION_CREATED,
            snapshot={
                'id': location.id,
                'name': 'Hauptstandort Alt',
                'project_id': self.project.id,
                'this_field_no_longer_exists_on_the_model': 'legacy value',
            },
            changed_fields=['created'],
        )

        mutation_response = self.client.patch(
            f'/openfarmplanner/api/crops/{self.crop.id}/',
            data={
                'name': 'Snapshot Trigger 2',
                'variety': self.crop.variety,
                'growth_duration_days': self.crop.growth_duration_days,
                'harvest_duration_days': self.crop.harvest_duration_days,
                'harvest_method': self.crop.harvest_method,
            },
            content_type='application/json',
        )
        self.assertEqual(mutation_response.status_code, 200)
        after = self.client.get('/openfarmplanner/api/history/project/')
        latest_revision_id = after.json()[0]['history_id']
        record_later_revision(self.project)

        restore_response = self.client.post(
            '/openfarmplanner/api/history/project/restore/',
            data={'history_id': latest_revision_id},
            content_type='application/json',
        )
        self.assertEqual(restore_response.status_code, 200)
        restored_location = Location.objects.get(project=self.project, name='Hauptstandort Alt')
        self.assertEqual(restored_location.id, location.id)

    def test_project_restore_nulls_out_stale_non_restorable_fk_reference(self):
        """A crop snapshot can reference a PublicCrop that was later hard-deleted
        (not soft-withdrawn). Restoring to that snapshot must null the dangling FK
        instead of crashing with an IntegrityError."""
        from crops.models import CropSpecies
        from farm.models import PublicCrop

        crop_species = CropSpecies.objects.create(name='Ghost Carrot Species', name_normalized='ghost-carrot-species')
        public_crop = PublicCrop.objects.create(name='Ghost Carrot', crop_species=crop_species)
        self.crop.source_public_crop = public_crop
        self.crop.save()

        before = self.client.get('/openfarmplanner/api/history/project/')
        target_revision_id = before.json()[0]['history_id']
        record_later_revision(self.project)

        # Simulate the referenced PublicCrop being hard-deleted later (e.g. a
        # data reset), which is not something the whole-project restore tracks.
        PublicCrop.objects.filter(pk=public_crop.pk).delete()

        restore_response = self.client.post(
            "/openfarmplanner/api/history/project/restore/",
            data={"history_id": target_revision_id},
            content_type="application/json",
        )
        self.assertEqual(restore_response.status_code, 200)
        self.crop.refresh_from_db()
        self.assertIsNone(self.crop.source_public_crop_id)

    def test_cleanup_history_command_prunes_legacy_crop_revisions(self):
        old = CropRevision.objects.create(crop=self.crop, snapshot={}, changed_fields=[])
        old.created_at = timezone.now() - timedelta(days=40)
        old.save(update_fields=["created_at"])

        call_command("cleanup_history")
        self.assertFalse(CropRevision.objects.filter(id=old.id).exists())

    def test_cleanup_history_expires_crop_library_usage_outside_window(self):
        today = timezone.now().date()
        kind = CropLibraryUsageDay.Kind.LINKED_UPDATE
        CropLibraryUsageDay.objects.create(project=self.crop.project, day=today - timedelta(days=31), kind=kind)
        kept = CropLibraryUsageDay.objects.create(
            project=self.crop.project, day=today - timedelta(days=28), kind=kind,
        )

        call_command("cleanup_history")

        self.assertEqual(list(CropLibraryUsageDay.objects.all()), [kept])

    def test_cleanup_history_keeps_pre_cutoff_anchor_and_prunes_older_revisions(self):
        self.crop.name = "Carrot intermediate"
        self.crop.save()
        self.crop.name = "Carrot Updated"
        self.crop.save()

        revisions = list(
            EntityRevision.objects.filter(
                project=self.project, entity_type="crop", object_id=self.crop.id
            ).order_by("created_at")
        )
        self.assertEqual(len(revisions), 3)
        oldest = revisions[0]
        oldest.created_at = timezone.now() - timedelta(days=50)
        oldest.save(update_fields=["created_at"])
        revisions[1].created_at = timezone.now() - timedelta(days=40)
        revisions[1].save(update_fields=["created_at"])

        call_command("cleanup_history")

        self.assertFalse(EntityRevision.objects.filter(id=oldest.id).exists())
        self.assertTrue(EntityRevision.objects.filter(id=revisions[1].id).exists())
        self.assertTrue(EntityRevision.objects.filter(id=revisions[2].id).exists())

    def test_cleanup_history_command_keeps_latest_entity_revision_indefinitely(self):
        """An entity's only/latest revision must survive cleanup even when old,
        otherwise point-in-time project restore would lose untouched entities."""
        revision = EntityRevision.objects.get(
            project=self.project, entity_type="crop", object_id=self.crop.id
        )
        revision.created_at = timezone.now() - timedelta(days=400)
        revision.save(update_fields=['created_at'])

        call_command('cleanup_history')

        self.assertTrue(EntityRevision.objects.filter(id=revision.id).exists())

    def test_cleanup_history_command_also_prunes_project_revisions(self):
        recent = ProjectRevision.objects.create(snapshot={}, summary='Recent snapshot', project=self.project)
        old = ProjectRevision.objects.create(snapshot={}, summary='Old snapshot', project=self.project)
        old.created_at = timezone.now() - timedelta(days=40)
        old.save(update_fields=['created_at'])

        call_command('cleanup_history')

        self.assertFalse(ProjectRevision.objects.filter(id=old.id).exists())
        self.assertTrue(ProjectRevision.objects.filter(id=recent.id).exists())

    def test_global_history_is_scoped_to_active_project(self):
        other_user = User.objects.create_user(username='otherhist', email='otherhist@example.com', password='testpass', is_active=True)
        other_project = Project.objects.create(name='Other History Project', slug='other-history-project')
        ProjectMembership.objects.create(user=other_user, project=other_project, role='admin')
        other_crop = Crop.objects.create(
            name='Hidden Crop',
            variety='Secret',
            growth_duration_days=55,
            harvest_duration_days=12,
            harvest_method='per_plant',
            project=other_project,
        )
        other_crop.name = 'Hidden Crop Updated'
        other_crop.save()

        response = self.client.get('/openfarmplanner/api/history/global/')
        self.assertEqual(response.status_code, 200)
        crop_ids = {entry['crop_id'] for entry in response.json()}
        self.assertIn(self.crop.id, crop_ids)
        self.assertNotIn(other_crop.id, crop_ids)

    def test_project_restore_requires_admin_role(self):
        self.client.post('/openfarmplanner/api/auth/logout/')
        member_user = User.objects.create_user(username='memberhist', email='memberhist@example.com', password='testpass', is_active=True)
        ProjectMembership.objects.create(user=member_user, project=self.project, role='member')
        self.client.force_login(member_user)
        self.client.defaults["HTTP_X_PROJECT_ID"] = str(self.project.id)

        response = self.client.post(
            "/openfarmplanner/api/history/project/restore/",
            data={"history_id": 1},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)


class MediaCleanupTests(TestCase):
    def test_cleanup_orphaned_media_command(self):
        media = MediaFile.objects.create(
            storage_path="crop-media/test.jpg", orphaned_at=timezone.now() - timedelta(days=40)
        )
        call_command("cleanup_orphaned_media")
        self.assertFalse(MediaFile.objects.filter(id=media.id).exists())

    def test_cleanup_preserves_stale_markers_with_live_crop_or_attachment_references(self):
        from farm.models import NoteAttachment, PlantingPlan

        with self.settings(STORAGES={
            'default': {'BACKEND': 'django.core.files.storage.InMemoryStorage'},
        }):
            project = Project.objects.create(name='Media owner', slug='media-owner')
            other = Project.objects.create(name='Other', slug='other-media-user')
            crop_path = default_storage.save('crop-media/live-crop.jpg', ContentFile(b'crop'))
            note_path = default_storage.save('crop-media/live-note.jpg', ContentFile(b'note'))
            crop_media = MediaFile.objects.create(project=project, storage_path=crop_path)
            note_media = MediaFile.objects.create(project=project, storage_path=note_path)
            crop = Crop.objects.create(project=project, name='Live crop', image_file=crop_media)
            other_crop = Crop.objects.create(project=other, name='Other crop')
            plan = PlantingPlan.objects.create(project=other, crop=other_crop)
            NoteAttachment.objects.create(project=other, planting_plan=plan, image=note_path)
            MediaFile.objects.filter(pk__in=[crop_media.pk, note_media.pk]).update(
                orphaned_at=timezone.now() - timedelta(days=40),
            )

            call_command('cleanup_orphaned_media')

            crop.refresh_from_db()
            self.assertEqual(crop.image_file_id, crop_media.pk)
            self.assertTrue(MediaFile.objects.filter(pk=note_media.pk).exists())
            self.assertTrue(default_storage.exists(crop_path))
            self.assertTrue(default_storage.exists(note_path))

    def test_retained_cleanup_preserves_live_files_and_survives_project_deletion(self):
        from farm.models import NoteAttachment, PlantingPlan

        with self.settings(STORAGES={
            'default': {'BACKEND': 'django.core.files.storage.InMemoryStorage'},
        }):
            project = Project.objects.create(name='Removed project', slug='removed-project')
            crop = Crop.objects.create(project=project, name='Attachment crop')
            plan = PlantingPlan.objects.create(project=project, crop=crop)
            attachment = NoteAttachment.objects.create(
                project=project, planting_plan=plan, image='notes/live.jpg',
            )
            paths = ['notes/live.jpg', 'crop-media/live.jpg', 'notes/expired.jpg']
            for path in paths:
                default_storage.save(path, ContentFile(b'fixture'))
                RetainedUpload.objects.create(
                    project=project, storage_path=path,
                    removed_at=timezone.now() - timedelta(days=31),
                )
            MediaFile.objects.create(storage_path='crop-media/live.jpg')
            call_command('cleanup_orphaned_media')
            self.assertTrue(default_storage.exists(attachment.image.name))
            self.assertTrue(default_storage.exists('crop-media/live.jpg'))
            self.assertFalse(default_storage.exists('notes/expired.jpg'))
            self.assertFalse(RetainedUpload.objects.exists())

            path = default_storage.save('notes/deleted-project.jpg', ContentFile(b'fixture'))
            retained = RetainedUpload.objects.create(
                project=project, storage_path=path,
                removed_at=timezone.now() - timedelta(days=31),
            )
            project.delete()
            retained.refresh_from_db()
            self.assertIsNone(retained.project_id)
            call_command('cleanup_orphaned_media')
            self.assertFalse(default_storage.exists(path))
            self.assertFalse(RetainedUpload.objects.exists())


class ImportOperationHistoryTests(TestCase):
    """Exercise real import, history, global restore and selective undo endpoints."""

    def setUp(self) -> None:
        CropHistoryTests.setUp(self)
        from uuid import uuid4

        self.import_id = str(uuid4())

    def apply(self, rows: list, *, phase: str = "crops", **extra):
        return self.client.post(
            "/openfarmplanner/api/crops/import/apply/",
            data={
                "items": rows,
                "phase": phase,
                "import_operation_id": self.import_id,
                "confirm_updates": True,
                **extra,
            },
            content_type="application/json",
        )

    def batch(self):
        from farm.models import BatchOperation

        return BatchOperation.objects.get(request_id=self.import_id)

    def undo(self, *, preview: bool = False):
        suffix = "undo-preview" if preview else "revert"
        return self.client.post(f"/openfarmplanner/api/history/batch/{self.batch().pk}/{suffix}/")

    def test_selective_undo_interprets_legacy_crop_snapshots(self):
        result = self.apply([
            {'name': self.crop.name, 'variety': self.crop.variety, 'notes': 'Imported'},
        ])
        self.assertEqual(result.status_code, 200, result.content)
        finalize = self.apply([], phase='finalize')
        self.assertEqual(finalize.status_code, 200, finalize.content)
        batch = self.batch()
        change = batch.context['_import_changes']['crop'][str(self.crop.pk)]
        change['before'] = legacy_crop_snapshot(change['before'])
        for field in (
            'seed_type', 'specific_properties', 'stratification_days_min',
            'life_cycle', 'light_requirement', 'pests_diseases',
            'water_requirement', 'winter_hardiness',
        ):
            change['after'].pop(field)
        batch.save(update_fields=['context'])

        preview = self.undo(preview=True)
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertEqual(preview.json()['conflicts'], [])
        reverted = self.undo()
        self.assertEqual(reverted.status_code, 200, reverted.content)
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.germination_temperature_requirement, 'cold_stratification')
        self.assertEqual(self.crop.germination_days_min, 7)
        self.assertEqual(self.crop.notes, '')

    def test_nested_crop_children_survive_exact_and_later_version_restore(self) -> None:
        from farm.models import CropSupplierData, SeedPackage, Supplier

        supplier = Supplier.objects.create(project=self.project, name='Nested history supplier')
        url = '/openfarmplanner/api/crops/'
        created = self.client.post(url, {
            'name': 'Nested history crop',
            'supplier_data_input': [{'supplier_id': supplier.pk, 'notes': 'Original offer'}],
            'seed_packages': [{'size_value': 5, 'size_unit': 'g'}],
        }, content_type='application/json')
        self.assertEqual(created.status_code, 201, created.content)
        crop_id = created.json()['id']
        versions = [EntityRevision.objects.filter(project=self.project).latest('id')]
        states = []
        states.append((
            list(CropSupplierData.objects.filter(crop_id=crop_id).values(
                    'id', 'crop_id', 'supplier_id', 'notes',
                )),
            list(SeedPackage.objects.filter(crop_id=crop_id).values(
                    'id', 'crop_id', 'size_value', 'size_unit',
                )),
        ))
        updated = self.client.patch(f'{url}{crop_id}/', {
            'supplier_data_input': [{
                'id': states[0][0][0]['id'], 'supplier_id': supplier.pk,
                'notes': 'Replacement offer',
            }],
            'seed_packages': [{'size_value': 10, 'size_unit': 'g'}],
        }, content_type='application/json')
        self.assertEqual(updated.status_code, 200, updated.content)
        versions.append(EntityRevision.objects.filter(project=self.project).latest('id'))
        states.append((
            list(CropSupplierData.objects.filter(crop_id=crop_id).values(
                    'id', 'crop_id', 'supplier_id', 'notes',
                )),
            list(SeedPackage.objects.filter(crop_id=crop_id).values(
                    'id', 'crop_id', 'size_value', 'size_unit',
                )),
        ))
        later = self.client.patch(f'{url}{self.crop.pk}/', {'notes': 'Later unrelated edit'},
                                 content_type='application/json')
        self.assertEqual(later.status_code, 200, later.content)
        versions.append(EntityRevision.objects.filter(project=self.project).latest('id'))
        states.append(states[-1])
        removed = self.client.patch(f'{url}{crop_id}/', {
            'supplier_data_input': [], 'seed_packages': [],
        }, content_type='application/json')
        self.assertEqual(removed.status_code, 200, removed.content)
        for version, expected in zip(versions, states, strict=True):
            with self.subTest(version=version.pk):
                restored = self.client.post('/openfarmplanner/api/history/project/restore/',
                                            {'history_id': version.pk},
                                            content_type='application/json')
                self.assertEqual(restored.status_code, 200, restored.content)
                self.assertEqual(list(CropSupplierData.objects.filter(crop_id=crop_id).values(
                    'id', 'crop_id', 'supplier_id', 'notes',
                )),
                                 expected[0])
                self.assertEqual(list(SeedPackage.objects.filter(crop_id=crop_id).values(
                    'id', 'crop_id', 'size_value', 'size_unit',
                )),
                                 expected[1])
        entries = self.client.get('/openfarmplanner/api/history/project/').json()
        internal = EntityRevision.objects.filter(
            project=self.project, snapshot__has_key='_project_version_internal',
        )
        self.assertTrue(internal.exists())
        self.assertFalse(set(internal.values_list('id', flat=True)) & {
            entry['history_id'] for entry in entries
        })
        rejected = self.client.post('/openfarmplanner/api/history/project/restore/',
                                    {'history_id': internal.first().pk},
                                    content_type='application/json')
        self.assertEqual(rejected.status_code, 409)

    def test_deleted_attachment_bytes_survive_restore_and_expire(self) -> None:
        from farm.models import NoteAttachment, PlantingPlan

        with self.settings(STORAGES={
            'default': {'BACKEND': 'django.core.files.storage.InMemoryStorage'},
        }):
            plan = PlantingPlan.objects.create(project=self.project, crop=self.crop)
            attachment = NoteAttachment.objects.create(
                project=self.project, planting_plan=plan,
                image=ContentFile(b'recoverable note fixture', name='deleted-note.jpg'),
            )
            path = attachment.image.name
            url = f'/openfarmplanner/api/attachments/{attachment.pk}/'
            with patch('farm.notes.views.record_entity_revision', side_effect=ValueError):
                with self.assertRaises(ValueError):
                    self.client.delete(url)
            self.assertTrue(NoteAttachment.objects.filter(pk=attachment.pk).exists())
            self.assertFalse(RetainedUpload.objects.exists())
            self.assertTrue(default_storage.exists(path))
            self.assertEqual(self.client.delete(url).status_code, 204)
            baseline = EntityRevision.objects.filter(
                project=self.project, entity_type='project',
            ).earliest('id')
            self.assertFalse(NoteAttachment.objects.filter(pk=attachment.pk).exists())
            self.assertTrue(RetainedUpload.objects.filter(storage_path=path).exists())
            call_command('cleanup_orphaned_media')
            self.assertTrue(default_storage.exists(path))
            restored = self.client.post('/openfarmplanner/api/history/project/restore/',
                                        {'history_id': baseline.pk},
                                        content_type='application/json')
            self.assertEqual(restored.status_code, 200, restored.content)
            recovered = NoteAttachment.objects.get(pk=attachment.pk)
            with recovered.image.open('rb') as image:
                self.assertEqual(image.read(), b'recoverable note fixture')
            self.assertEqual(self.client.delete(url).status_code, 204)
            RetainedUpload.objects.update(removed_at=timezone.now() - timedelta(days=31))
            call_command('cleanup_orphaned_media')
            self.assertFalse(default_storage.exists(path))

    def test_one_group_across_batches_with_inspectable_crop_details(self) -> None:
        self.assertEqual(self.apply([{"name": "Import A"}]).status_code, 200)
        self.assertEqual(self.apply([{"name": "Import B"}]).status_code, 200)
        self.assertEqual(self.apply([], phase="finalize").status_code, 200)
        entries = self.client.get("/openfarmplanner/api/history/project/").json()
        groups = [entry for entry in entries if entry.get("batch_operation_type") == "crop_import"]
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["batch_context"]["created_count"], 2)
        self.assertNotIn("_import_changes", groups[0]["batch_context"])
        self.assertEqual(
            {child["object_display_name"] for child in groups[0]["children"]},
            {"Import A", "Import B"},
        )
        self.assertTrue(groups[0]["is_current_version"])
        self.assertTrue(groups[0]["history_id"])

    def test_selective_undo_preserves_unrelated_later_crops_and_beds(self) -> None:
        from farm.models import Bed, Field

        response = self.apply([{"name": "Imported"}])
        self.assertEqual(response.status_code, 200, response.content)
        imported_id = response.json()["results"][0]["crop_id"]
        later = Crop.objects.create(project=self.project, name="Later independent crop")
        location = Location.objects.create(project=self.project, name="Later location")
        field = Field.objects.create(project=self.project, location=location, name="Later field")
        bed = Bed.objects.create(project=self.project, field=field, name="Later bed", area_sqm=3)
        preview = self.undo(preview=True)
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertEqual(preview.json(), {"created_count": 1, "updated_count": 0, "conflicts": []})
        response = self.undo()
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(Crop.objects.filter(pk=imported_id).exists())
        self.assertTrue(Crop.objects.filter(pk=later.pk).exists())
        self.assertTrue(Bed.objects.filter(pk=bed.pk).exists())

    def test_mixed_update_create_undo_restores_preimport_fields(self) -> None:
        self.crop.notes = "Before import"
        self.crop.save()
        response = self.apply(
            [
                {"name": self.crop.name, "variety": self.crop.variety, "notes": "Imported notes"},
                {"name": "Created by import"},
            ]
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.undo().status_code, 200)
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.notes, "Before import")
        self.assertFalse(Crop.objects.filter(name="Created by import").exists())

    def test_later_same_crop_edit_blocks_the_entire_inverse(self) -> None:
        self.apply([{"name": "Import A"}, {"name": "Import B"}])
        crop = Crop.objects.get(project=self.project, name="Import B")
        crop.notes = "Newer work"
        crop.save()
        before = EntityRevision.objects.count()
        self.assertTrue(self.undo(preview=True).json()["conflicts"])
        response = self.undo()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(EntityRevision.objects.count(), before)
        self.assertEqual(Crop.objects.filter(name__in=["Import A", "Import B"]).count(), 2)
        crop.refresh_from_db()
        self.assertEqual(crop.notes, "Newer work")

    def test_later_plan_reference_blocks_undo_without_cascading(self) -> None:
        from farm.models import Bed, Field, PlantingPlan

        self.apply([{"name": "Imported"}])
        crop = Crop.objects.get(project=self.project, name="Imported")
        location = Location.objects.create(project=self.project, name="Location")
        field = Field.objects.create(project=self.project, location=location, name="Field")
        bed = Bed.objects.create(project=self.project, field=field, name="Bed", area_sqm=1)
        plan = PlantingPlan.objects.create(
            project=self.project, crop=crop, bed=bed, planting_date="2026-04-01"
        )
        self.assertIn(
            "dependent_data", [c["code"] for c in self.undo(preview=True).json()["conflicts"]]
        )
        self.assertEqual(self.undo().status_code, 409)
        self.assertTrue(PlantingPlan.objects.filter(pk=plan.pk).exists())

    def test_full_restore_removes_later_entities_and_its_backup_is_restorable(self) -> None:
        from farm.models import Bed, Field

        self.apply([{"name": "Imported"}])
        target_id = self.client.get("/openfarmplanner/api/history/project/").json()[0]["history_id"]
        later = Crop.objects.create(project=self.project, name="Later crop")
        location = Location.objects.create(project=self.project, name="Later location")
        field = Field.objects.create(project=self.project, location=location, name="Later field")
        bed = Bed.objects.create(project=self.project, field=field, name="Later bed", area_sqm=2)
        before_ids = set(EntityRevision.objects.values_list("id", flat=True))
        response = self.client.post(
            "/openfarmplanner/api/history/project/restore/",
            data={"history_id": target_id},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(Crop.objects.filter(pk=later.pk).exists())
        self.assertFalse(Bed.objects.filter(pk=bed.pk).exists())
        backup = EntityRevision.objects.exclude(pk__in=before_ids).order_by("id").first()
        response = self.client.post(
            "/openfarmplanner/api/history/project/restore/",
            data={"history_id": backup.pk},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(Crop.objects.filter(pk=later.pk).exists())
        self.assertTrue(Bed.objects.filter(pk=bed.pk).exists())

    def test_undo_result_is_restorable_after_a_later_change(self) -> None:
        self.apply([{"name": "Imported"}])
        self.assertEqual(self.undo().status_code, 200)
        undo_id = self.client.get("/openfarmplanner/api/history/project/").json()[0]["history_id"]
        later = Crop.objects.create(project=self.project, name="Later crop")
        response = self.client.post(
            "/openfarmplanner/api/history/project/restore/",
            data={"history_id": undo_id},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(Crop.objects.filter(name="Imported").exists())
        self.assertFalse(Crop.objects.filter(pk=later.pk).exists())

    def test_closed_identifier_cannot_accept_more_rows(self) -> None:
        self.apply([{"name": "Imported"}])
        self.apply([], phase="finalize")
        self.assertEqual(self.apply([{"name": "Unexpected late row"}]).status_code, 409)
        self.assertFalse(Crop.objects.filter(name="Unexpected late row").exists())

    def test_another_project_cannot_append_to_the_import(self) -> None:
        self.apply([{"name": "Imported"}])
        other = Project.objects.create(name="Other", slug="other-import-project")
        ProjectMembership.objects.create(project=other, user=self.user, role="admin")
        self.client.defaults["HTTP_X_PROJECT_ID"] = str(other.pk)
        self.assertEqual(self.apply([{"name": "Not allowed"}]).status_code, 409)
        self.assertFalse(Crop.objects.filter(project=other).exists())

    def test_companion_phase_is_part_of_the_same_reversible_operation(self) -> None:
        from farm.models import CropCompanion

        response = self.apply([{"name": "Import A"}, {"name": "Import B"}])
        crop_ids = [row["crop_id"] for row in response.json()["results"]]
        response = self.apply(
            [
                {"crop_id": crop_ids[0], "good_companions": [{"name": "Import B"}]},
            ],
            phase="companions",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.apply([], phase="finalize").status_code, 200)
        self.assertTrue(CropCompanion.objects.filter(project=self.project).exists())
        self.assertEqual(self.undo(preview=True).json()["conflicts"], [])
        self.assertEqual(self.undo().status_code, 200)
        self.assertFalse(CropCompanion.objects.filter(project=self.project).exists())
        self.assertFalse(Crop.objects.filter(pk__in=crop_ids).exists())

    def test_private_supplier_rows_are_inverted_with_their_crops(self) -> None:
        from farm.models import CropSupplierData, Supplier

        response = self.apply([{"name": "Import A", "supplier_name": "Synthetic import supplier"}])
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(Supplier.objects.filter(project=self.project).exists())
        self.assertEqual(self.undo().status_code, 200)
        self.assertFalse(CropSupplierData.objects.filter(project=self.project).exists())
        self.assertFalse(Supplier.objects.filter(project=self.project).exists())

    def test_later_changes_are_rechecked_at_execution_time(self) -> None:
        self.apply([{"name": "Imported"}])
        self.assertEqual(self.undo(preview=True).json()["conflicts"], [])
        crop = Crop.objects.get(project=self.project, name="Imported")
        crop.notes = "Edit after preview"
        crop.save()
        self.assertEqual(self.undo().status_code, 409)
        self.assertTrue(Crop.objects.filter(pk=crop.pk).exists())

    def test_incomplete_old_history_refuses_full_restore_atomically(self) -> None:
        old_location = Location.objects.create(project=self.project, name="Untracked original")
        self.crop.notes = "Target"
        self.crop.save()
        target = EntityRevision.objects.filter(project=self.project, entity_type="crop").latest(
            "id"
        )
        later = Crop.objects.create(project=self.project, name="Later")
        before = EntityRevision.objects.count()
        response = self.client.post(
            "/openfarmplanner/api/history/project/restore/",
            data={"history_id": target.pk},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["code"], "project_restore_conflict")
        self.assertTrue(Location.objects.filter(pk=old_location.pk).exists())
        self.assertTrue(Crop.objects.filter(pk=later.pk).exists())
        self.assertEqual(EntityRevision.objects.count(), before)

    def test_pruned_prechange_history_is_not_interpreted_as_absence(self) -> None:
        self.crop.notes = "Target"
        self.crop.save()
        target = EntityRevision.objects.filter(project=self.project, entity_type="crop").latest(
            "id"
        )
        location = Location.objects.create(project=self.project, name="Untracked earlier row")
        Location.objects.filter(pk=location.pk).update(
            created_at=target.created_at - timedelta(days=1)
        )
        location.refresh_from_db()
        from farm.history.records import _serialize_instance

        EntityRevision.objects.create(
            project=self.project,
            entity_type="location",
            object_id=location.pk,
            action="deleted",
            snapshot=_serialize_instance(location),
        )
        location.delete()
        response = self.client.post(
            "/openfarmplanner/api/history/project/restore/",
            data={"history_id": target.pk},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 409)

    def test_read_only_preview_does_not_create_a_baseline_but_first_crud_does(self) -> None:
        from farm.history.project_restore import CHECKPOINT_KEY

        checkpoints = EntityRevision.objects.filter(
            project=self.project, snapshot__has_key=CHECKPOINT_KEY
        )
        self.assertFalse(checkpoints.exists())
        response = self.client.post(
            "/openfarmplanner/api/crops/import/preview/",
            data=[{"name": "Preview only"}],
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(checkpoints.exists())
        for notes in ("First edit", "Second edit"):
            self.assertEqual(
                self.client.patch(
                    f"/openfarmplanner/api/crops/{self.crop.pk}/",
                    data={"notes": notes},
                    content_type="application/json",
                ).status_code,
                200,
            )
        self.assertEqual(checkpoints.count(), 1)

    def test_unknown_post_baseline_data_is_not_silently_deleted(self) -> None:
        from farm.history.project_restore import capture_project_state, record_project_checkpoint

        record_project_checkpoint(self.project, capture_project_state(self.project))
        location = Location.objects.create(project=self.project, name="Untracked after baseline")
        self.crop.notes = "Target after untracked row creation"
        self.crop.save()
        target = EntityRevision.objects.filter(entity_type="crop", project=self.project).latest(
            "id"
        )
        self.crop.notes = "Later edit"
        self.crop.save()
        response = self.client.post(
            "/openfarmplanner/api/history/project/restore/",
            data={"history_id": target.pk},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 409)
        self.assertTrue(Location.objects.filter(pk=location.pk).exists())
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.notes, "Later edit")

    def test_later_untracked_creation_within_the_target_millisecond_is_removed(self) -> None:
        from farm.history.project_restore import capture_project_state, record_project_checkpoint

        record_project_checkpoint(self.project, capture_project_state(self.project))
        target = EntityRevision.objects.filter(project=self.project).latest("id")
        if target.created_at.microsecond % 1000 == 999:
            target.created_at -= timedelta(microseconds=1)
        EntityRevision.objects.filter(pk=target.pk).update(created_at=target.created_at)
        later = Location.objects.create(project=self.project, name="Later within millisecond")
        Location.objects.filter(pk=later.pk).update(
            created_at=target.created_at + timedelta(microseconds=1)
        )
        record_later_revision(self.project)
        response = self.client.post(
            "/openfarmplanner/api/history/project/restore/",
            {"history_id": target.pk},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(Location.objects.filter(pk=later.pk).exists())

    def test_first_custom_undelete_establishes_a_complete_pre_mutation_baseline(self) -> None:
        from farm.history.project_restore import CHECKPOINT_KEY

        archived_at = timezone.now()
        Crop.all_objects.filter(pk=self.crop.pk).update(deleted_at=archived_at)
        untouched = Location.objects.create(project=self.project, name="Untouched legacy location")
        EntityRevision.objects.filter(project=self.project).delete()
        response = self.client.post(f"/openfarmplanner/api/crops/{self.crop.pk}/undelete/")
        self.assertEqual(response.status_code, 200, response.content)
        baseline = EntityRevision.objects.get(
            project=self.project, snapshot__has_key=CHECKPOINT_KEY
        )
        self.assertIsNotNone(
            baseline.snapshot[CHECKPOINT_KEY]["crop"][str(self.crop.pk)]["deleted_at"]
        )
        target = EntityRevision.objects.filter(project=self.project, entity_type="crop").latest(
            "id"
        )
        self.crop.refresh_from_db()
        self.crop.notes = "Later edit"
        self.crop.save()
        response = self.client.post(
            "/openfarmplanner/api/history/project/restore/",
            {"history_id": target.pk},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(Location.objects.filter(pk=untouched.pk).exists())

    def test_legacy_archived_season_and_generated_task_require_complete_after_states(self) -> None:
        from farm.history import _serialize_instance, record_entity_revision
        from farm.history.project_restore import capture_project_state, record_project_checkpoint
        from farm.models import Season, Task

        season = Season.objects.create(
            project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31)
        )
        task = Task.objects.create(
            project=self.project, title="Generated legacy task", source_key="legacy-source"
        )
        for instance, label in ((season, "season"), (task, "task")):
            with self.subTest(entity_type=label):
                EntityRevision.objects.filter(project=self.project).delete()
                record_project_checkpoint(self.project, capture_project_state(self.project))
                snapshot = _serialize_instance(instance)
                type(instance)._base_manager.filter(pk=instance.pk).update(
                    deleted_at=timezone.now()
                )
                record_entity_revision(
                    project=self.project, entity_type=label, object_id=instance.pk,
                    action="deleted", snapshot=snapshot,
                )
                target = EntityRevision.objects.filter(project=self.project).latest("id")
                record_later_revision(self.project)
                count = EntityRevision.objects.filter(project=self.project).count()
                response = self.client.post(
                    "/openfarmplanner/api/history/project/restore/",
                    {"history_id": target.pk}, content_type="application/json",
                )
                self.assertEqual(response.status_code, 409, response.content)
                instance.refresh_from_db()
                self.assertIsNotNone(instance.deleted_at)
                self.assertEqual(EntityRevision.objects.filter(project=self.project).count(), count)

    def test_cleanup_keeps_the_state_needed_for_recent_restore(self) -> None:
        from farm.history.project_restore import capture_project_state, record_project_checkpoint

        record_project_checkpoint(
            self.project, capture_project_state(self.project), action="updated"
        )
        baseline = EntityRevision.objects.filter(
            project=self.project, entity_type="project"
        ).latest("id")
        EntityRevision.objects.filter(pk=baseline.pk).update(
            created_at=timezone.now() - timedelta(days=60)
        )
        self.crop.notes = "State before cutoff"
        self.crop.save()
        anchor = EntityRevision.objects.filter(project=self.project, entity_type="crop").latest(
            "id"
        )
        EntityRevision.objects.filter(pk=anchor.pk).update(
            created_at=timezone.now() - timedelta(days=40)
        )
        target = record_later_revision(self.project)
        EntityRevision.objects.filter(pk=target.pk).update(
            created_at=timezone.now() - timedelta(days=20)
        )
        self.crop.notes = "Recent edit after target"
        self.crop.save()
        call_command("cleanup_history")
        self.assertTrue(EntityRevision.objects.filter(pk=baseline.pk).exists())
        self.assertTrue(EntityRevision.objects.filter(pk=anchor.pk).exists())
        response = self.client.post(
            "/openfarmplanner/api/history/project/restore/",
            data={"history_id": target.pk},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.notes, "State before cutoff")

    def test_restore_retains_upload_bytes_for_backup_then_cleans_expired_files(self) -> None:
        from farm.history.project_restore import capture_project_state, record_project_checkpoint
        from farm.models import NoteAttachment, PlantingPlan

        with self.settings(STORAGES={
            'default': {'BACKEND': 'django.core.files.storage.InMemoryStorage'},
        }):
            record_project_checkpoint(self.project, capture_project_state(self.project))
            target = EntityRevision.objects.filter(project=self.project).latest('id')
            target.created_at = timezone.now().replace(microsecond=100)
            EntityRevision.objects.filter(pk=target.pk).update(created_at=target.created_at)
            plan = PlantingPlan.objects.create(project=self.project, crop=self.crop)
            PlantingPlan.objects.filter(pk=plan.pk).update(
                created_at=target.created_at + timedelta(microseconds=100),
            )
            attachment = NoteAttachment.objects.create(
                project=self.project, planting_plan=plan,
                image=ContentFile(b'note fixture', name='note.jpg'),
            )
            media_path = default_storage.save(
                'crop-media/restore.jpg', ContentFile(b'crop fixture'),
            )
            media = MediaFile.objects.create(project=self.project, storage_path=media_path)
            NoteAttachment.objects.filter(pk=attachment.pk).update(
                created_at=target.created_at + timedelta(microseconds=200),
            )
            MediaFile.objects.filter(pk=media.pk).update(
                uploaded_at=target.created_at + timedelta(microseconds=300),
            )
            self.crop.image_file = media
            self.crop.save()
            record_project_checkpoint(self.project, capture_project_state(self.project))
            revision_count = EntityRevision.objects.filter(project=self.project).count()
            last_id = EntityRevision.objects.latest('id').pk
            url = '/openfarmplanner/api/history/project/restore/'

            with patch('farm.history.project_restore._write_target_rows', side_effect=ValueError):
                failed = self.client.post(
                    url, {'history_id': target.pk}, content_type='application/json',
                )
            self.assertEqual(failed.status_code, 409)
            self.assertTrue(NoteAttachment.objects.filter(pk=attachment.pk).exists())
            self.assertTrue(MediaFile.objects.filter(pk=media.pk).exists())
            self.assertFalse(RetainedUpload.objects.exists())
            self.assertEqual(
                EntityRevision.objects.filter(project=self.project).count(), revision_count,
            )

            restored = self.client.post(
                url, {'history_id': target.pk}, content_type='application/json',
            )
            self.assertEqual(restored.status_code, 200, restored.content)
            self.assertFalse(PlantingPlan.objects.filter(pk=plan.pk).exists())
            self.assertFalse(NoteAttachment.objects.filter(pk=attachment.pk).exists())
            self.assertFalse(MediaFile.objects.filter(pk=media.pk).exists())
            paths = {attachment.image.name, media_path}
            self.assertEqual(
                set(RetainedUpload.objects.values_list('storage_path', flat=True)), paths,
            )
            call_command('cleanup_orphaned_media')
            self.assertEqual(RetainedUpload.objects.count(), 2)
            self.assertTrue(all(default_storage.exists(path) for path in paths))
            backup = EntityRevision.objects.filter(
                project=self.project, id__gt=last_id, entity_type='project', action='updated',
            ).earliest('id')

            restored = self.client.post(
                url, {'history_id': backup.pk}, content_type='application/json',
            )
            self.assertEqual(restored.status_code, 200, restored.content)
            self.assertTrue(PlantingPlan.objects.filter(pk=plan.pk).exists())
            self.assertEqual(
                NoteAttachment.objects.get(pk=attachment.pk).image.name, attachment.image.name,
            )
            self.assertEqual(MediaFile.objects.get(pk=media.pk).storage_path, media_path)
            RetainedUpload.objects.update(removed_at=timezone.now() - timedelta(days=31))
            call_command('cleanup_orphaned_media')
            self.assertFalse(RetainedUpload.objects.exists())
            self.assertTrue(all(default_storage.exists(path) for path in paths))

            RetainedUpload.objects.create(
                project=self.project, storage_path=media_path,
                removed_at=timezone.now() - timedelta(days=31),
            )
            restored = self.client.post(
                url, {'history_id': target.pk}, content_type='application/json',
            )
            self.assertEqual(restored.status_code, 200, restored.content)
            self.assertTrue(all(
                removed_at > timezone.now() - timedelta(minutes=1)
                for removed_at in RetainedUpload.objects.values_list('removed_at', flat=True)
            ))
            RetainedUpload.objects.update(removed_at=timezone.now() - timedelta(days=31))
            call_command('cleanup_orphaned_media')
            self.assertFalse(RetainedUpload.objects.exists())
            self.assertFalse(any(default_storage.exists(path) for path in paths))

    def test_global_media_reference_is_retained_without_taking_ownership(self) -> None:
        from farm.history.project_restore import capture_project_state, record_project_checkpoint

        media = MediaFile.objects.create(storage_path="crop-media/shared-history-fixture.jpg")
        self.crop.image_file = media
        self.crop.save()
        record_project_checkpoint(self.project, capture_project_state(self.project))
        target = EntityRevision.objects.filter(project=self.project).latest("id")
        self.crop.notes = "Later edit"
        self.crop.save()
        response = self.client.post(
            "/openfarmplanner/api/history/project/restore/",
            data={"history_id": target.pk},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.crop.refresh_from_db()
        media.refresh_from_db()
        self.assertEqual(self.crop.image_file_id, media.pk)
        self.assertIsNone(media.project_id)

    def test_restore_replays_recorded_cascades_and_nullable_foreign_keys(self) -> None:
        from farm.history.project_restore import capture_project_state, record_project_checkpoint
        from farm.models import Bed, Field, PlantingPlan, Task

        location = Location.objects.create(project=self.project, name="Recorded location")
        field = Field.objects.create(project=self.project, location=location, name="Recorded field")
        bed = Bed.objects.create(project=self.project, field=field, name="Recorded bed", area_sqm=1)
        plan = PlantingPlan.objects.create(
            project=self.project, crop=self.crop, bed=bed, planting_date=date(2026, 4, 1)
        )
        task = Task.objects.create(project=self.project, planting_plan=plan, title="Surviving task")
        record_project_checkpoint(self.project, capture_project_state(self.project))
        response = self.client.delete(f"/openfarmplanner/api/beds/{bed.pk}/")
        self.assertEqual(response.status_code, 204, response.content)
        target = EntityRevision.objects.filter(project=self.project).latest("id")
        self.crop.notes = "A later edit"
        self.crop.save()
        response = self.client.post(
            "/openfarmplanner/api/history/project/restore/",
            data={"history_id": target.pk},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(Bed.objects.filter(pk=bed.pk).exists())
        self.assertFalse(PlantingPlan.objects.filter(pk=plan.pk).exists())
        task.refresh_from_db()
        self.assertIsNone(task.planting_plan_id)

    def test_long_actor_names_fit_the_audit_label_without_losing_actor_identity(self) -> None:
        self.user.first_name = "A" * 120
        self.user.last_name = "B" * 120
        self.user.save(update_fields=["first_name", "last_name"])
        response = self.apply([{"name": "Imported with a long actor name"}])
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(self.batch().user_name), 150)
        self.assertEqual(self.batch().initiated_by_id, self.user.pk)

    def test_missing_shared_media_is_cleared_without_recreating_global_metadata(self) -> None:
        from farm.history.project_restore import capture_project_state, record_project_checkpoint

        media = MediaFile.objects.create(storage_path="crop-media/removed-global-history.jpg")
        self.crop.image_file = media
        self.crop.save()
        record_project_checkpoint(self.project, capture_project_state(self.project))
        target = EntityRevision.objects.filter(project=self.project).latest("id")
        media.delete()
        self.crop.notes = "Later edit"
        self.crop.image_file_id = None
        self.crop.save()
        response = self.client.post(
            "/openfarmplanner/api/history/project/restore/",
            data={"history_id": target.pk},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.crop.refresh_from_db()
        self.assertIsNone(self.crop.image_file_id)

    def test_task_template_revisions_and_legacy_labels_restore_the_target(self) -> None:
        from farm.history.project_restore import capture_project_state, record_project_checkpoint
        from farm.models import CropTaskTemplate

        template = CropTaskTemplate.objects.create(
            project=self.project,
            crop=self.crop,
            title="Original",
            reference_event="planting",
            day_offset=0,
        )
        record_project_checkpoint(self.project, capture_project_state(self.project))
        for legacy in (False, True):
            response = self.client.patch(
                f"/openfarmplanner/api/crop-task-templates/{template.pk}/",
                {"title": "At target", "day_offset": 5},
                content_type="application/json",
            )
            self.assertEqual(response.status_code, 200, response.content)
            target = EntityRevision.objects.filter(project=self.project).latest("id")
            self.assertEqual(target.entity_type, "croptasktemplate")
            if legacy:
                EntityRevision.objects.filter(pk=target.pk).update(entity_type="crop_task_template")
            self.client.patch(
                f"/openfarmplanner/api/crop-task-templates/{template.pk}/",
                {"title": "Later change", "day_offset": 9},
                content_type="application/json",
            )
            response = self.client.post(
                "/openfarmplanner/api/history/project/restore/",
                data={"history_id": target.pk},
                content_type="application/json",
            )
            self.assertEqual(response.status_code, 200, response.content)
            template.refresh_from_db()
            self.assertEqual(template.title, "At target")
            self.assertEqual(template.day_offset, 5)

    def test_full_restore_keeps_the_target_season_pattern(self) -> None:
        from farm.models import SeasonPattern

        self.client.patch(
            "/openfarmplanner/api/season-pattern/",
            {"start_month": 2},
            content_type="application/json",
        )
        target = EntityRevision.objects.filter(project=self.project).latest("id")
        self.assertEqual(target.entity_type, "season_pattern")
        self.client.patch(
            "/openfarmplanner/api/season-pattern/",
            {"start_month": 9},
            content_type="application/json",
        )
        response = self.client.post(
            "/openfarmplanner/api/history/project/restore/",
            data={"history_id": target.pk},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(SeasonPattern.objects.get(project=self.project).start_month, 2)

    def test_lazy_season_pattern_reads_do_not_advertise_project_versions(self) -> None:
        from farm.history.project_restore import CHECKPOINT_KEY

        before = self.client.get("/openfarmplanner/api/history/project/").json()
        for path in ("season-pattern/", "season-pattern/preview/", "season-setup/status/"):
            response = self.client.get(f"/openfarmplanner/api/{path}")
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(
                self.client.get("/openfarmplanner/api/history/project/").json(), before,
            )
        self.assertFalse(EntityRevision.objects.filter(
            project=self.project, snapshot__has_key=CHECKPOINT_KEY,
        ).exists())
        internal = EntityRevision.objects.get(project=self.project, entity_type="season_pattern")
        self.assertTrue(internal.snapshot["_project_version_internal"])
        rejected = self.client.post(
            "/openfarmplanner/api/history/project/restore/",
            {"history_id": internal.pk}, content_type="application/json",
        )
        self.assertEqual(rejected.status_code, 409)

    def test_season_setup_records_a_complete_final_version(self) -> None:
        from farm.history.project_restore import CHECKPOINT_KEY
        from farm.models import Bed, Field, PlantingPlan, Season, Task

        location = Location.objects.create(project=self.project, name="Setup location")
        field = Field.objects.create(project=self.project, location=location, name="Setup field")
        bed = Bed.objects.create(project=self.project, field=field, name="Setup bed", area_sqm=1)
        plan = PlantingPlan.objects.create(
            project=self.project, crop=self.crop, bed=bed, planting_date=date(2026, 4, 1),
        )
        response = self.client.post(
            "/openfarmplanner/api/season-setup/apply/", {"start_day": 1, "start_month": 2},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        season_id = response.json()["season"]["id"]
        target = EntityRevision.objects.filter(project=self.project).latest("id")
        self.assertIn(CHECKPOINT_KEY, target.snapshot)
        self.assertTrue(EntityRevision.objects.filter(
            project=self.project, entity_type="season", object_id=season_id, action="created",
        ).exists())
        task_ids = set(Task.objects.filter(project=self.project).values_list("pk", flat=True))
        self.assertTrue(task_ids)
        self.crop.notes = "Later setup edit"
        self.crop.save()
        restored = self.client.post(
            "/openfarmplanner/api/history/project/restore/",
            {"history_id": target.pk}, content_type="application/json",
        )
        self.assertEqual(restored.status_code, 200, restored.content)
        plan.refresh_from_db()
        self.assertEqual(plan.season_id, season_id)
        self.assertTrue(Season.objects.filter(pk=season_id).exists())
        self.assertEqual(set(Task.objects.filter(project=self.project).values_list(
            "pk", flat=True,
        )), task_ids)

    def test_layout_creation_and_updates_are_reconstructible_without_partial_versions(self) -> None:
        from farm.models import Bed, BedLayout, Field, FieldLayout

        location = Location.objects.create(project=self.project, name="Layout history location")
        field = Field.objects.create(project=self.project, location=location, name="Layout field")
        bed = Bed.objects.create(project=self.project, field=field, name="Layout bed", area_sqm=1)
        targets = []
        for coordinate in (10, 20, 30):
            response = self.client.put(
                f"/openfarmplanner/api/locations/{location.pk}/layouts/",
                {"bed_layouts": [{"bed": bed.pk, "x": coordinate, "y": 2}],
                 "field_layouts": [{"field": field.pk, "x": coordinate, "y": 3}]},
                content_type="application/json",
            )
            self.assertEqual(response.status_code, 200, response.content)
            target = EntityRevision.objects.filter(project=self.project).latest("id")
            self.assertEqual(target.entity_type, "project")
            targets.append(target.pk)
        for target_id, expected in ((targets[1], 20), (targets[0], 10)):
            restored = self.client.post(
                "/openfarmplanner/api/history/project/restore/",
                {"history_id": target_id}, content_type="application/json",
            )
            self.assertEqual(restored.status_code, 200, restored.content)
            self.assertEqual(BedLayout.objects.get(bed=bed).x, expected)
            self.assertEqual(FieldLayout.objects.get(field=field).x, expected)
        visible = self.client.get("/openfarmplanner/api/history/project/").json()
        self.assertFalse(any(entry.get("object_type") in {"bed_layout", "field_layout"}
                             for entry in visible))

    def test_plan_versions_include_created_and_rescheduled_automatic_tasks(self) -> None:
        from farm.models import Bed, Field, Season, Task

        location = Location.objects.create(project=self.project, name="Task history location")
        field = Field.objects.create(project=self.project, location=location, name="Task field")
        bed = Bed.objects.create(project=self.project, field=field, name="Task bed", area_sqm=1)
        season = Season.objects.create(
            project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        response = self.client.post(
            "/openfarmplanner/api/planting-plans/",
            {"crop": self.crop.pk, "bed": bed.pk, "season": season.pk,
             "cultivation_type": "direct_sowing", "planting_date": "2026-04-01"},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        plan_id = response.json()["id"]
        targets = []
        for planting_date in (None, "2026-05-01"):
            if planting_date:
                response = self.client.patch(
                    f"/openfarmplanner/api/planting-plans/{plan_id}/",
                    {"planting_date": planting_date}, content_type="application/json",
                )
                self.assertEqual(response.status_code, 200, response.content)
            target = EntityRevision.objects.filter(
                project=self.project, entity_type="planting_plan", object_id=plan_id,
            ).latest("id")
            tasks = dict(Task.objects.filter(planting_plan_id=plan_id).values_list(
                "pk", "due_date",
            ))
            self.assertTrue(tasks)
            targets.append((target.pk, tasks))
        self.crop.notes = "Later independent task edit"
        self.crop.save()
        for target_id, expected in reversed(targets):
            response = self.client.post(
                "/openfarmplanner/api/history/project/restore/",
                {"history_id": target_id}, content_type="application/json",
            )
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(dict(Task.objects.filter(planting_plan_id=plan_id).values_list(
                "pk", "due_date",
            )), expected)

    def test_template_versions_include_created_and_rescheduled_template_tasks(self) -> None:
        from farm.models import Bed, Field, PlantingPlan, Season, Task

        location = Location.objects.create(project=self.project, name="Template history location")
        field = Field.objects.create(project=self.project, location=location, name="Template field")
        bed = Bed.objects.create(project=self.project, field=field, name="Template bed", area_sqm=1)
        season = Season.objects.create(
            project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        plan = PlantingPlan.objects.create(
            project=self.project, crop=self.crop, bed=bed, season=season,
            cultivation_type="direct_sowing", planting_date=date(2026, 4, 1),
        )
        response = self.client.post(
            "/openfarmplanner/api/crop-task-templates/",
            {"crop": self.crop.pk, "title": "Check before harvest",
             "reference_event": "harvest_start", "day_offset": -1},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        template_id = response.json()["id"]
        targets = []
        for offset in (None, -3):
            if offset is not None:
                response = self.client.patch(
                    f"/openfarmplanner/api/crop-task-templates/{template_id}/",
                    {"day_offset": offset}, content_type="application/json",
                )
                self.assertEqual(response.status_code, 200, response.content)
            target = EntityRevision.objects.filter(
                project=self.project, entity_type="croptasktemplate", object_id=template_id,
            ).latest("id")
            tasks = dict(Task.objects.filter(planting_plan=plan).values_list("pk", "due_date"))
            self.assertTrue(Task.objects.filter(planting_plan=plan, origin="template").exists())
            targets.append((target.pk, tasks))
        self.crop.notes = "Later independent template edit"
        self.crop.save()
        for target_id, expected in reversed(targets):
            response = self.client.post(
                "/openfarmplanner/api/history/project/restore/",
                {"history_id": target_id}, content_type="application/json",
            )
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(dict(Task.objects.filter(planting_plan=plan).values_list(
                "pk", "due_date",
            )), expected)

    def test_crop_timing_side_effects_are_part_of_the_target_project_state(self) -> None:
        from farm.history.project_restore import capture_project_state, record_project_checkpoint
        from farm.models import Bed, Field, PlantingPlan

        location = Location.objects.create(project=self.project, name="Timing location")
        field = Field.objects.create(project=self.project, location=location, name="Timing field")
        bed = Bed.objects.create(project=self.project, field=field, name="Timing bed", area_sqm=1)
        plan = PlantingPlan.objects.create(
            project=self.project, crop=self.crop, bed=bed, planting_date=date(2026, 4, 1)
        )
        record_project_checkpoint(self.project, capture_project_state(self.project))
        response = self.client.patch(
            f"/openfarmplanner/api/crops/{self.crop.pk}/",
            {"growth_duration_days": 80},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        target = EntityRevision.objects.filter(project=self.project).latest("id")
        self.assertEqual(target.entity_type, "crop")
        derived = EntityRevision.objects.filter(
            project=self.project,
            entity_type="planting_plan",
            snapshot__has_key="_project_version_internal",
        ).latest("id")
        visible_ids = {
            entry["history_id"] for entry in self.client.get(
                "/openfarmplanner/api/history/project/"
            ).json()
        }
        self.assertIn(target.pk, visible_ids)
        self.assertNotIn(derived.pk, visible_ids)
        rejected = self.client.post(
            "/openfarmplanner/api/history/project/restore/",
            {"history_id": derived.pk}, content_type="application/json",
        )
        self.assertEqual(rejected.status_code, 409)
        plan.refresh_from_db()
        expected_harvest = plan.harvest_date
        self.client.patch(
            f"/openfarmplanner/api/crops/{self.crop.pk}/",
            {"notes": "After target"},
            content_type="application/json",
        )
        response = self.client.post(
            "/openfarmplanner/api/history/project/restore/",
            data={"history_id": target.pk},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        plan.refresh_from_db()
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.growth_duration_days, 80)
        self.assertEqual(plan.harvest_date, expected_harvest)

    def test_preview_explains_when_a_before_image_has_lost_its_parent(self) -> None:
        from farm.models import Supplier

        supplier = Supplier.objects.create(
            project=self.project, name="Before supplier", homepage_url="https://example.org"
        )
        self.crop.supplier = supplier
        self.crop.save()
        response = self.apply(
            [
                {
                    "name": self.crop.name,
                    "variety": self.crop.variety,
                    "supplier_name": "Imported supplier",
                }
            ]
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.crop.refresh_from_db()
        self.assertNotEqual(self.crop.supplier_id, supplier.pk)
        supplier.delete()
        preview = self.undo(preview=True)
        self.assertEqual(preview.status_code, 200)
        self.assertIn("unavailable_state", [row["code"] for row in preview.json()["conflicts"]])
        before = EntityRevision.objects.count()
        self.assertEqual(self.undo().status_code, 409)
        self.assertEqual(EntityRevision.objects.count(), before)

    def test_full_restore_recreates_rows_cascaded_from_a_later_parent(self) -> None:
        from farm.history.project_restore import capture_project_state, record_project_checkpoint
        from farm.models import Bed, Field, PlantingPlan, Task

        location = Location.objects.create(project=self.project, name="Original location")
        field = Field.objects.create(project=self.project, location=location, name="Original field")
        bed = Bed.objects.create(project=self.project, field=field, name="Original bed", area_sqm=1)
        plan = PlantingPlan.objects.create(
            project=self.project, crop=self.crop, bed=bed, planting_date=date(2026, 4, 1)
        )
        task = Task.objects.create(
            project=self.project, planting_plan=plan, title="Preserved linked task"
        )
        original_created_at = field.created_at
        record_project_checkpoint(self.project, capture_project_state(self.project))
        target = EntityRevision.objects.filter(project=self.project).latest("id")
        later = self.client.post(
            "/openfarmplanner/api/locations/",
            {"name": "Later location"},
            content_type="application/json",
        )
        self.assertEqual(later.status_code, 201)
        moved = self.client.patch(
            f"/openfarmplanner/api/fields/{field.pk}/",
            {"location": later.json()["id"]},
            content_type="application/json",
        )
        self.assertEqual(moved.status_code, 200)
        response = self.client.post(
            "/openfarmplanner/api/history/project/restore/",
            data={"history_id": target.pk},
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        field.refresh_from_db()
        bed.refresh_from_db()
        plan.refresh_from_db()
        task.refresh_from_db()
        self.assertEqual(field.location_id, location.pk)
        self.assertLess(abs(field.created_at - original_created_at), timedelta(milliseconds=1))
        self.assertEqual(bed.field_id, field.pk)
        self.assertEqual(plan.bed_id, bed.pk)
        self.assertEqual(task.planting_plan_id, plan.pk)

    def test_undo_restores_an_existing_crop_before_removing_its_imported_supplier(self) -> None:
        from farm.models import Supplier

        original = Supplier.objects.create(
            project=self.project, name="Original supplier", homepage_url="https://example.org"
        )
        self.crop.supplier = original
        self.crop.save()
        response = self.apply(
            [
                {
                    "name": self.crop.name,
                    "variety": self.crop.variety,
                    "supplier_name": "Imported supplier",
                }
            ]
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.undo(preview=True).json()["conflicts"], [])
        response = self.undo()
        self.assertEqual(response.status_code, 200, response.content)
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.supplier_id, original.pk)
        self.assertFalse(
            Supplier.objects.filter(project=self.project, name="Imported supplier").exists()
        )
