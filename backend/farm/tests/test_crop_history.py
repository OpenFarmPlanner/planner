from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

from farm.models import Crop, EntityRevision, Location, MediaFile, CropRevision, Project, ProjectMembership, ProjectRevision

User = get_user_model()


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

        # Simulate the referenced PublicCrop being hard-deleted later (e.g. a
        # data reset), which is not something the whole-project restore tracks.
        PublicCrop.objects.filter(pk=public_crop.pk).delete()

        restore_response = self.client.post(
            '/openfarmplanner/api/history/project/restore/',
            data={'history_id': target_revision_id},
            content_type='application/json',
        )
        self.assertEqual(restore_response.status_code, 200)
        self.crop.refresh_from_db()
        self.assertIsNone(self.crop.source_public_crop_id)

    def test_cleanup_history_command_prunes_legacy_crop_revisions(self):
        old = CropRevision.objects.create(crop=self.crop, snapshot={}, changed_fields=[])
        old.created_at = timezone.now() - timedelta(days=40)
        old.save(update_fields=['created_at'])

        call_command('cleanup_history')
        self.assertFalse(CropRevision.objects.filter(id=old.id).exists())

    def test_cleanup_history_command_prunes_old_non_latest_entity_revisions(self):
        self.crop.name = 'Carrot Updated'
        self.crop.save()

        revisions = list(
            EntityRevision.objects.filter(project=self.project, entity_type='crop', object_id=self.crop.id)
            .order_by('created_at')
        )
        self.assertEqual(len(revisions), 2)
        oldest = revisions[0]
        oldest.created_at = timezone.now() - timedelta(days=40)
        oldest.save(update_fields=['created_at'])

        call_command('cleanup_history')

        self.assertFalse(EntityRevision.objects.filter(id=oldest.id).exists())
        self.assertTrue(EntityRevision.objects.filter(id=revisions[1].id).exists())

    def test_cleanup_history_command_keeps_latest_entity_revision_indefinitely(self):
        """An entity's only/latest revision must survive cleanup even when old,
        otherwise point-in-time project restore would lose untouched entities."""
        revision = EntityRevision.objects.get(project=self.project, entity_type='crop', object_id=self.crop.id)
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
        self.client.defaults['HTTP_X_PROJECT_ID'] = str(self.project.id)

        response = self.client.post(
            '/openfarmplanner/api/history/project/restore/',
            data={'history_id': 1},
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)


class MediaCleanupTests(TestCase):
    def test_cleanup_orphaned_media_command(self):
        media = MediaFile.objects.create(storage_path='crop-media/test.jpg', orphaned_at=timezone.now() - timedelta(days=40))
        call_command('cleanup_orphaned_media')
        self.assertFalse(MediaFile.objects.filter(id=media.id).exists())
