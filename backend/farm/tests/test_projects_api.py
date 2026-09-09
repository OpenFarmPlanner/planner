from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import UserProjectSettings
from farm.models import (
    Bed,
    Crop,
    Field,
    Location,
    PlantingPlan,
    Project,
    ProjectInvitation,
    ProjectMembership,
)
from farm.services.demo_project import DEMO_PROJECT_NAME, DEMO_PROJECT_NAME_EN

User = get_user_model()


class ProjectsApiTests(APITestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(username='u1', email='u1@example.com', password='pass12345', is_active=True)
        self.other = User.objects.create_user(username='u2', email='u2@example.com', password='pass12345', is_active=True)
        self.invitee = User.objects.create_user(username='invitee', email='invitee@example.com', password='pass12345', is_active=True)
        self.project = Project.objects.create(name='P1', slug='p1')
        self.project2 = Project.objects.create(name='P2', slug='p2')
        ProjectMembership.objects.create(user=self.user, project=self.project, role='admin')
        ProjectMembership.objects.create(user=self.other, project=self.project2, role='admin')
        UserProjectSettings.objects.create(user=self.user, default_project=self.project, last_project=self.project)
        self.client.post('/openfarmplanner/api/auth/login/', {'email': 'u1@example.com', 'password': 'pass12345'}, format='json')

    def test_project_scoping_with_header(self) -> None:
        Location.objects.create(name='L1', project=self.project)
        Location.objects.create(name='L2', project=self.project2)

        response = self.client.get('/openfarmplanner/api/locations/', HTTP_X_PROJECT_ID=str(self.project.id))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 1)

    def test_yield_calendar_is_scoped_to_active_project(self) -> None:
        location1 = Location.objects.create(name='L1', project=self.project)
        field1 = location1.fields.create(name='F1', project=self.project)
        bed1 = field1.beds.create(name='B1', area_sqm=10, project=self.project)

        location2 = Location.objects.create(name='L2', project=self.project2)
        field2 = location2.fields.create(name='F2', project=self.project2)
        bed2 = field2.beds.create(name='B2', area_sqm=10, project=self.project2)

        from farm.models import Crop, PlantingPlan

        crop1 = Crop.objects.create(name='Karotte', expected_yield=12, project=self.project)
        crop2 = Crop.objects.create(name='Tomate', expected_yield=99, project=self.project2)

        plan1 = PlantingPlan.objects.create(
            crop=crop1,
            bed=bed1,
            planting_date='2026-03-01',
            project=self.project,
        )
        plan2 = PlantingPlan.objects.create(
            crop=crop2,
            bed=bed2,
            planting_date='2026-03-01',
            project=self.project2,
        )
        PlantingPlan.objects.filter(id=plan1.id).update(harvest_date='2026-03-03', harvest_end_date='2026-03-06')
        PlantingPlan.objects.filter(id=plan2.id).update(harvest_date='2026-03-03', harvest_end_date='2026-03-06')

        response = self.client.get('/openfarmplanner/api/yield-calendar/?year=2026', HTTP_X_PROJECT_ID=str(self.project.id))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['crops'][0]['crop_name'], 'Karotte')

    def test_switch_project_updates_last_project(self) -> None:
        ProjectMembership.objects.create(user=self.user, project=self.project2, role='member')

        response = self.client.post('/openfarmplanner/api/projects-switch/', {'project_id': self.project2.id}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['resolved_project_id'], self.project2.id)
        self.assertEqual(response.data['last_project_id'], self.project2.id)

        settings_obj = UserProjectSettings.objects.get(user=self.user)
        self.assertEqual(settings_obj.last_project_id, self.project2.id)

    def test_switch_project_errors_use_structured_codes(self) -> None:
        invalid = self.client.post('/openfarmplanner/api/projects-switch/', {'project_id': 'invalid'}, format='json')
        self.assertEqual(invalid.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(invalid.data['code'], 'invalid_project_id')

        inaccessible = self.client.post(
            '/openfarmplanner/api/projects-switch/',
            {'project_id': self.project2.id},
            format='json',
        )
        self.assertEqual(inaccessible.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(inaccessible.data['code'], 'project_membership_required')

    def test_project_history_restore_does_not_delete_other_project_data(self) -> None:
        create_response = self.client.post(
            '/openfarmplanner/api/locations/',
            {'name': 'P1 before restore', 'address': '', 'notes': ''},
            format='json',
            HTTP_X_PROJECT_ID=str(self.project.id),
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        Location.objects.create(name='P2 untouched', project=self.project2)

        history_response = self.client.get(
            '/openfarmplanner/api/history/project/',
            HTTP_X_PROJECT_ID=str(self.project.id),
        )
        self.assertEqual(history_response.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(history_response.data), 1)
        history_id = history_response.data[0]['history_id']

        Location.objects.filter(project=self.project).delete()

        restore_response = self.client.post(
            '/openfarmplanner/api/history/project/restore/',
            {'history_id': history_id},
            format='json',
            HTTP_X_PROJECT_ID=str(self.project.id),
        )
        self.assertEqual(restore_response.status_code, status.HTTP_200_OK)
        self.assertTrue(Location.objects.filter(project=self.project, name='P1 before restore').exists())
        self.assertTrue(Location.objects.filter(project=self.project2, name='P2 untouched').exists())

    def test_project_history_restore_after_cascade_deleted_location_does_not_500(self) -> None:
        """Deleting a Location DB-cascades its Fields/Beds without recording an
        EntityRevision for them, so their last snapshot can still look "active".
        Restoring must drop such orphans instead of recreating rows that
        reference a parent that was correctly not recreated."""
        headers = {'HTTP_X_PROJECT_ID': str(self.project.id)}
        location_response = self.client.post(
            '/openfarmplanner/api/locations/', {'name': 'L1', 'address': '', 'notes': ''}, format='json', **headers,
        )
        self.assertEqual(location_response.status_code, status.HTTP_201_CREATED)
        field_response = self.client.post(
            '/openfarmplanner/api/fields/', {'name': 'F1', 'location': location_response.data['id']}, format='json', **headers,
        )
        self.assertEqual(field_response.status_code, status.HTTP_201_CREATED)
        bed_response = self.client.post(
            '/openfarmplanner/api/beds/', {'name': 'B1', 'field': field_response.data['id']}, format='json', **headers,
        )
        self.assertEqual(bed_response.status_code, status.HTTP_201_CREATED)

        delete_response = self.client.delete(f'/openfarmplanner/api/locations/{location_response.data["id"]}/', **headers)
        self.assertIn(delete_response.status_code, (status.HTTP_200_OK, status.HTTP_204_NO_CONTENT))

        # A history point after the cascade delete, so restoring to it must
        # not try to recreate the orphaned Field/Bed.
        Location.objects.create(name='L2', project=self.project)

        history_response = self.client.get('/openfarmplanner/api/history/project/', **headers)
        self.assertEqual(history_response.status_code, status.HTTP_200_OK)
        history_id = history_response.data[0]['history_id']

        restore_response = self.client.post(
            '/openfarmplanner/api/history/project/restore/',
            {'history_id': history_id},
            format='json',
            **headers,
        )
        self.assertEqual(restore_response.status_code, status.HTTP_200_OK, restore_response.data)
        self.assertFalse(Field.objects.filter(project=self.project).exists())
        self.assertFalse(Bed.objects.filter(project=self.project).exists())

    def test_project_history_restore_survives_stale_duplicate_snapshots(self) -> None:
        """A crop hard-deleted without an ACTION_DELETED revision (e.g. an
        old demo reset) leaves a snapshot that still looks 'active'. Restoring
        must not 500 on the unique-constraint collision with the live crop —
        the newest snapshot wins, the stale one is skipped."""
        from farm.history import record_entity_revision
        from farm.models import EntityRevision

        headers = {'HTTP_X_PROJECT_ID': str(self.project.id)}
        # A ghost general 'Tomate': created, then hard-deleted by a queryset
        # delete that records no ACTION_DELETED revision (as a demo reset does),
        # so its "created" snapshot still looks active.
        ghost = Crop.objects.create(name='Tomate', variety='', project=self.project)
        ghost_id = ghost.pk
        Crop.objects.filter(pk=ghost_id).delete()
        record_entity_revision(
            project=self.project, entity_type='crop', object_id=ghost_id,
            action=EntityRevision.ACTION_CREATED,
            snapshot={'id': ghost_id, 'name': 'Tomate', 'variety': '',
                      'name_normalized': 'tomate', 'variety_normalized': '',
                      'deleted_at': None, 'project_id': self.project.id},
        )
        live = Crop.objects.create(name='Tomate', variety='', project=self.project)
        Location.objects.create(name='anchor', project=self.project)

        history = self.client.get('/openfarmplanner/api/history/project/', **headers).data
        history_id = next(entry['history_id'] for entry in history if not entry.get('is_batch'))
        response = self.client.post(
            '/openfarmplanner/api/history/project/restore/',
            {'history_id': history_id}, format='json', **headers,
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        general_tomate = Crop.objects.filter(
            project=self.project, name_normalized='tomate', variety_normalized__isnull=True,
        )
        self.assertEqual(general_tomate.count(), 1)
        self.assertEqual(general_tomate.first().pk, live.pk)

    def test_project_history_restore_leaves_untracked_rows_untouched(self) -> None:
        """Rows created outside the API (the demo seeder, the auto default
        location) have no EntityRevision. A restore rebuilds only what history
        recorded and must leave those rows alone — not delete them, which once
        emptied a whole demo project."""
        headers = {'HTTP_X_PROJECT_ID': str(self.project.id)}
        location = Location.objects.create(name='Seeded L', project=self.project)
        field = location.fields.create(name='Seeded F', project=self.project)
        bed = field.beds.create(name='Seeded B', area_sqm=10, project=self.project)
        # A tracked crop so a restore point exists and the rebuild has work.
        crop_response = self.client.post(
            '/openfarmplanner/api/crops/', {'name': 'Tracked', 'variety': ''}, format='json', **headers,
        )
        self.client.patch(
            f'/openfarmplanner/api/crops/{crop_response.data["id"]}/',
            {'name': 'Tracked renamed'}, format='json', **headers,
        )

        history = self.client.get('/openfarmplanner/api/history/project/', **headers).data
        history_id = next(
            entry['history_id'] for entry in history
            if not entry.get('is_batch') and entry.get('action') == 'created'
        )
        response = self.client.post(
            '/openfarmplanner/api/history/project/restore/',
            {'history_id': history_id}, format='json', **headers,
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertTrue(Location.objects.filter(pk=location.pk).exists())
        self.assertTrue(Field.objects.filter(pk=field.pk).exists())
        self.assertTrue(Bed.objects.filter(pk=bed.pk).exists())
        # The tracked crop was rolled back to its pre-rename snapshot.
        self.assertEqual(
            Crop.objects.get(pk=crop_response.data['id']).name, 'Tracked',
        )

    def test_create_project_without_slug_succeeds(self) -> None:
        response = self.client.post('/openfarmplanner/api/projects/', {'name': 'Neues Projekt', 'description': ''}, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['name'], 'Neues Projekt')
        self.assertEqual(response.data['region'], Project.REGION_GERMANY)
        self.assertTrue(response.data['slug'])

    def test_updates_project_region_and_exposes_it_on_auth_memberships(self) -> None:
        response = self.client.patch(
            f'/openfarmplanner/api/projects/{self.project.id}/',
            {'region': Project.REGION_AUSTRIA},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['region'], Project.REGION_AUSTRIA)
        me_response = self.client.get('/openfarmplanner/api/auth/me/')
        membership = next(
            row for row in me_response.data['memberships']
            if row['project_id'] == self.project.id
        )
        self.assertEqual(membership['project_region'], Project.REGION_AUSTRIA)

    def test_create_project_with_duplicate_name_assigns_unique_slug(self) -> None:
        Project.objects.create(name='Neues Projekt', slug='neues-projekt')

        response = self.client.post('/openfarmplanner/api/projects/', {'name': 'Neues Projekt', 'description': ''}, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['slug'], 'neues-projekt-2')
        self.assertTrue(ProjectMembership.objects.filter(user=self.user, project_id=response.data['id'], role='admin').exists())

    def test_superuser_can_create_project(self) -> None:
        self.client.post('/openfarmplanner/api/auth/logout/')
        superuser = User.objects.create_superuser(username='admin', email='admin@example.com', password='pass12345')
        self.client.post('/openfarmplanner/api/auth/login/', {'email': superuser.email, 'password': 'pass12345'}, format='json')

        response = self.client.post('/openfarmplanner/api/projects/', {'name': 'Admin Project', 'description': ''}, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(ProjectMembership.objects.filter(user=superuser, project_id=response.data['id'], role='admin').exists())

    def test_unauthenticated_user_cannot_create_project(self) -> None:
        self.client.post('/openfarmplanner/api/auth/logout/')

        response = self.client.post('/openfarmplanner/api/projects/', {'name': 'Denied', 'description': ''}, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_authenticated_user_can_create_personal_demo_project(self) -> None:
        response = self.client.post('/openfarmplanner/api/projects/create-demo/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['name'], DEMO_PROJECT_NAME)
        project = Project.objects.get(id=response.data['id'])
        self.assertTrue(ProjectMembership.objects.filter(user=self.user, project=project, role='admin').exists())
        settings_obj = UserProjectSettings.objects.get(user=self.user)
        self.assertEqual(settings_obj.last_project_id, project.id)
        self.assertEqual(Location.objects.filter(project=project).count(), 2)
        self.assertEqual(Bed.objects.filter(project=project).count(), 12)
        crops = Crop.objects.filter(project=project)
        self.assertEqual(crops.count(), 20)
        self.assertEqual(crops.filter(variety='').count(), 8)
        self.assertEqual(crops.exclude(variety='').count(), 12)
        self.assertTrue(crops.filter(name='Tomate', variety='').exists())
        self.assertTrue(crops.filter(name='Tomate', variety='Roma').exists())
        self.assertEqual(PlantingPlan.objects.filter(project=project).count(), 17)

        me_response = self.client.get('/openfarmplanner/api/auth/me/')
        demo_membership = next(
            row for row in me_response.data['memberships']
            if row['project_id'] == project.id
        )
        self.assertTrue(demo_membership['is_demo_project'])

    def test_authenticated_user_can_create_english_demo_project(self) -> None:
        response = self.client.post(
            '/openfarmplanner/api/projects/create-demo/',
            {},
            format='json',
            HTTP_ACCEPT_LANGUAGE='en-US,en;q=0.9',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['name'], DEMO_PROJECT_NAME_EN)
        project = Project.objects.get(id=response.data['id'])
        self.assertTrue(Location.objects.filter(project=project, name='Farm Garden').exists())
        self.assertTrue(Crop.objects.filter(project=project, name='Carrot').exists())

        me_response = self.client.get('/openfarmplanner/api/auth/me/')
        demo_membership = next(
            row for row in me_response.data['memberships']
            if row['project_id'] == project.id
        )
        self.assertTrue(demo_membership['is_demo_project'])

    def test_demo_project_creation_is_idempotent_for_repeated_requests(self) -> None:
        first = self.client.post('/openfarmplanner/api/projects/create-demo/', {}, format='json')
        second = self.client.post('/openfarmplanner/api/projects/create-demo/', {}, format='json')

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(second.data['id'], first.data['id'])
        self.assertEqual(Project.objects.filter(memberships__user=self.user, name=DEMO_PROJECT_NAME).count(), 1)

    def test_two_users_get_separate_demo_projects_from_api(self) -> None:
        first = self.client.post('/openfarmplanner/api/projects/create-demo/', {}, format='json')
        self.client.post('/openfarmplanner/api/auth/logout/')
        self.client.post('/openfarmplanner/api/auth/login/', {'email': 'u2@example.com', 'password': 'pass12345'}, format='json')
        second = self.client.post('/openfarmplanner/api/projects/create-demo/', {}, format='json')

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_201_CREATED)
        self.assertNotEqual(first.data['id'], second.data['id'])
        self.assertFalse(ProjectMembership.objects.filter(user=self.user, project_id=second.data['id']).exists())
        self.assertTrue(ProjectMembership.objects.filter(user=self.other, project_id=second.data['id'], role='admin').exists())

    @patch('farm.services.demo_project.populate_demo_project', side_effect=RuntimeError('boom'))
    def test_demo_project_creation_error_leaves_no_partial_project(self, _mocked_populate) -> None:
        response = self.client.post('/openfarmplanner/api/projects/create-demo/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        self.assertEqual(response.data['detail'], 'Demo project could not be created.')
        self.assertFalse(Project.objects.filter(memberships__user=self.user, name=DEMO_PROJECT_NAME).exists())

    def test_unauthenticated_user_cannot_create_demo_project(self) -> None:
        self.client.post('/openfarmplanner/api/auth/logout/')

        response = self.client.post('/openfarmplanner/api/projects/create-demo/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_can_invite_member(self) -> None:
        response = self.client.post(
            f'/openfarmplanner/api/projects/{self.project.id}/invitations/',
            {'email': 'invitee@example.com', 'role': 'member'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['code'], 'invitation_sent')

    def test_member_cannot_invite(self) -> None:
        ProjectMembership.objects.update_or_create(user=self.user, project=self.project, defaults={'role': 'member'})
        response = self.client.post(
            f'/openfarmplanner/api/projects/{self.project.id}/invitations/',
            {'email': 'invitee@example.com', 'role': 'member'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_invitation_for_existing_member_is_rejected(self) -> None:
        ProjectMembership.objects.create(user=self.invitee, project=self.project, role='member')
        response = self.client.post(
            f'/openfarmplanner/api/projects/{self.project.id}/invitations/',
            {'email': 'invitee@example.com', 'role': 'member'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['code'], 'self_role_change_forbidden')
        self.assertEqual(response.data['code'], 'already_member')

    def test_second_open_invitation_is_resent_not_duplicated(self) -> None:
        first = self.client.post(
            f'/openfarmplanner/api/projects/{self.project.id}/invitations/',
            {'email': 'invitee@example.com', 'role': 'member'},
            format='json',
        )
        second = self.client.post(
            f'/openfarmplanner/api/projects/{self.project.id}/invitations/',
            {'email': 'INVITEE@example.com', 'role': 'admin'},
            format='json',
        )

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(second.data['code'], 'invitation_resent')
        self.assertEqual(ProjectInvitation.objects.filter(project=self.project, email_normalized='invitee@example.com', status='pending').count(), 1)

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.console.EmailBackend')
    def test_invitation_returns_mail_not_sent_on_console_backend(self) -> None:
        response = self.client.post(
            f'/openfarmplanner/api/projects/{self.project.id}/invitations/',
            {'email': 'invitee@example.com', 'role': 'member'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertFalse(response.data['mail_sent'])
        self.assertIn('invite_link', response.data)
        self.assertIn('/invite/accept?token=', response.data['invite_link'])
        self.assertEqual(response.data.get('mail_error_code'), 'email_send_failed')
        self.assertIn('Die E-Mail konnte nicht gesendet werden.', response.data.get('mail_error', ''))
        self.assertNotIn('email_backend', response.data)

    @patch('farm.projects.emails.send_mail', side_effect=RuntimeError('SMTP stacktrace details'))
    def test_invitation_mail_failure_returns_safe_warning(self, _mocked_send_mail) -> None:
        response = self.client.post(
            f'/openfarmplanner/api/projects/{self.project.id}/invitations/',
            {'email': 'invitee@example.com', 'role': 'member'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertFalse(response.data['mail_sent'])
        self.assertEqual(response.data.get('mail_error_code'), 'email_send_failed')
        self.assertIn('Die E-Mail konnte nicht gesendet werden.', response.data.get('mail_error', ''))
        self.assertNotIn('SMTP stacktrace details', response.data.get('mail_error', ''))

    @override_settings(
        EMAIL_BACKEND='django.core.mail.backends.console.EmailBackend',
        FRONTEND_URL='http://localhost:5173/openfarmplanner',
        PUBLIC_FRONTEND_URL='https://zwiebelzopf.at/openfarmplanner',
    )
    def test_invitation_link_uses_public_frontend_url_setting(self) -> None:
        response = self.client.post(
            f'/openfarmplanner/api/projects/{self.project.id}/invitations/',
            {'email': 'invitee@example.com', 'role': 'member'},
            format='json',
            HTTP_ORIGIN='https://app.example.org',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data['invite_link'].startswith('https://zwiebelzopf.at/openfarmplanner/invite/accept?token='))


    def test_accept_invitation_invalid_token(self) -> None:
        response = self.client.post('/openfarmplanner/api/project-invitations/not-a-real-token/accept/')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['code'], 'invalid_token')

    def test_accept_invitation_matches_email_case_insensitively(self) -> None:
        invitation = ProjectInvitation.objects.create(
            project=self.project,
            email='INVITEE@EXAMPLE.COM',
            role='member',
            token='token-case-match',
            invited_by=self.user,
            expires_at=timezone.now() + timedelta(days=14),
        )
        self.client.post('/openfarmplanner/api/auth/logout/')
        self.client.post('/openfarmplanner/api/auth/login/', {'email': 'invitee@example.com', 'password': 'pass12345'}, format='json')

        response = self.client.post(f'/openfarmplanner/api/project-invitations/{invitation.token}/accept/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['code'], 'accepted')
        self.assertTrue(ProjectMembership.objects.filter(project=self.project, user=self.invitee).exists())

    def test_accept_invitation_success(self) -> None:
        invitation = ProjectInvitation.objects.create(
            project=self.project,
            email='invitee@example.com',
            role='member',
            token='token123',
            invited_by=self.user,
            expires_at=timezone.now() + timedelta(days=14),
        )
        self.client.post('/openfarmplanner/api/auth/logout/')
        self.client.post('/openfarmplanner/api/auth/login/', {'email': 'invitee@example.com', 'password': 'pass12345'}, format='json')

        response = self.client.post(f'/openfarmplanner/api/project-invitations/{invitation.token}/accept/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['code'], 'accepted')
        self.assertTrue(ProjectMembership.objects.filter(project=self.project, user=self.invitee).exists())
        self.assertEqual(response.data['project']['id'], self.project.id)

    def test_accept_invitation_via_body_endpoint_sets_project_as_active_default(self) -> None:
        invitation = ProjectInvitation.objects.create(
            project=self.project2,
            email='invitee@example.com',
            role='member',
            token='token-body-endpoint',
            invited_by=self.user,
            expires_at=timezone.now() + timedelta(days=14),
        )
        self.client.post('/openfarmplanner/api/auth/logout/')
        self.client.post('/openfarmplanner/api/auth/login/', {'email': 'invitee@example.com', 'password': 'pass12345'}, format='json')

        response = self.client.post('/openfarmplanner/api/invitations/accept/', {'token': invitation.token}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['code'], 'accepted')
        self.assertEqual(response.data['project']['id'], self.project2.id)

        settings_obj = UserProjectSettings.objects.get(user=self.invitee)
        self.assertEqual(settings_obj.default_project_id, self.project2.id)
        self.assertEqual(settings_obj.last_project_id, self.project2.id)

    def test_public_status_stores_pending_token_for_anonymous_user(self) -> None:
        invitation = ProjectInvitation.objects.create(
            project=self.project,
            email='invitee@example.com',
            role='member',
            token='token-store',
            invited_by=self.user,
            expires_at=timezone.now() + timedelta(days=14),
        )
        self.client.post('/openfarmplanner/api/auth/logout/')

        response = self.client.get(f'/openfarmplanner/api/project-invitations/{invitation.token}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(self.client.session.get('pending_project_invitation_token'), invitation.token)

    def test_pending_invitation_can_be_accepted_after_login(self) -> None:
        invitation = ProjectInvitation.objects.create(
            project=self.project,
            email='invitee@example.com',
            role='member',
            token='token-pending-login',
            invited_by=self.user,
            expires_at=timezone.now() + timedelta(days=14),
        )
        self.client.post('/openfarmplanner/api/auth/logout/')
        self.client.get(f'/openfarmplanner/api/project-invitations/{invitation.token}/')
        self.client.post('/openfarmplanner/api/auth/login/', {'email': 'invitee@example.com', 'password': 'pass12345'}, format='json')

        response = self.client.post('/openfarmplanner/api/project-invitations/pending/accept/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['code'], 'accepted')
        self.assertTrue(ProjectMembership.objects.filter(project=self.project, user=self.invitee).exists())
        self.assertIsNone(self.client.session.get('pending_project_invitation_token'))

    def test_pending_invitation_accept_without_session_token_is_noop(self) -> None:
        self.client.post('/openfarmplanner/api/auth/logout/')
        self.client.post('/openfarmplanner/api/auth/login/', {'email': 'invitee@example.com', 'password': 'pass12345'}, format='json')

        response = self.client.post('/openfarmplanner/api/project-invitations/pending/accept/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['code'], 'no_pending_invitation')
        self.assertIsNone(response.data['project_id'])

    def test_pending_invitation_rejects_other_email_and_keeps_token(self) -> None:
        invitation = ProjectInvitation.objects.create(
            project=self.project,
            email='invitee@example.com',
            role='member',
            token='token-pending-mismatch',
            invited_by=self.user,
            expires_at=timezone.now() + timedelta(days=14),
        )
        self.client.post('/openfarmplanner/api/auth/logout/')
        self.client.get(f'/openfarmplanner/api/project-invitations/{invitation.token}/')
        self.client.post('/openfarmplanner/api/auth/login/', {'email': 'u2@example.com', 'password': 'pass12345'}, format='json')

        response = self.client.post('/openfarmplanner/api/project-invitations/pending/accept/')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['code'], 'email_mismatch')
        self.assertEqual(self.client.session.get('pending_project_invitation_token'), invitation.token)

    def test_accept_invitation_email_mismatch(self) -> None:
        invitation = ProjectInvitation.objects.create(
            project=self.project,
            email='third@example.com',
            role='member',
            token='token-mismatch',
            invited_by=self.user,
            expires_at=timezone.now() + timedelta(days=14),
        )
        with self.assertLogs('farm.services.project_invitations', level='WARNING') as captured:
            response = self.client.post(f'/openfarmplanner/api/project-invitations/{invitation.token}/accept/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['code'], 'email_mismatch')
        joined = '\n'.join(captured.output)
        self.assertNotIn(invitation.email, joined)
        self.assertNotIn(self.user.email, joined)

    def test_expired_invitation_cannot_be_accepted(self) -> None:
        invitation = ProjectInvitation.objects.create(
            project=self.project,
            email=self.user.email,
            role='member',
            token='token-expired',
            invited_by=self.other,
            expires_at=timezone.now() - timedelta(minutes=1),
        )
        response = self.client.post(f'/openfarmplanner/api/project-invitations/{invitation.token}/accept/')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['code'], 'expired')

    def test_revoked_invitation_cannot_be_accepted(self) -> None:
        invitation = ProjectInvitation.objects.create(
            project=self.project,
            email=self.user.email,
            role='member',
            token='token-revoked',
            invited_by=self.other,
            expires_at=timezone.now() + timedelta(days=14),
            status='revoked',
            revoked_at=timezone.now(),
        )
        response = self.client.post(f'/openfarmplanner/api/project-invitations/{invitation.token}/accept/')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['code'], 'revoked')

    def test_accept_invitation_can_only_succeed_once(self) -> None:
        invitation = ProjectInvitation.objects.create(
            project=self.project,
            email=self.user.email,
            role='member',
            token='token-idempotent',
            invited_by=self.other,
            expires_at=timezone.now() + timedelta(days=14),
        )

        first = self.client.post(f'/openfarmplanner/api/project-invitations/{invitation.token}/accept/')
        second = self.client.post(f'/openfarmplanner/api/project-invitations/{invitation.token}/accept/')

        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(second.data['code'], 'accepted')
        self.assertEqual(ProjectMembership.objects.filter(project=self.project, user=self.user).count(), 1)

    def test_used_invitation_cannot_restore_membership_after_member_removal(self) -> None:
        invitation = ProjectInvitation.objects.create(
            project=self.project,
            email='invitee@example.com',
            role='member',
            token='token-remove-reuse',
            invited_by=self.user,
            expires_at=timezone.now() + timedelta(days=14),
        )
        self.client.post('/openfarmplanner/api/auth/logout/')
        self.client.post('/openfarmplanner/api/auth/login/', {'email': 'invitee@example.com', 'password': 'pass12345'}, format='json')

        first = self.client.post(f'/openfarmplanner/api/project-invitations/{invitation.token}/accept/')
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertTrue(ProjectMembership.objects.filter(project=self.project, user=self.invitee).exists())

        ProjectMembership.objects.filter(project=self.project, user=self.invitee).delete()

        second = self.client.post(f'/openfarmplanner/api/project-invitations/{invitation.token}/accept/')
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(second.data['code'], 'accepted')
        self.assertFalse(ProjectMembership.objects.filter(project=self.project, user=self.invitee).exists())

    def test_removed_member_can_rejoin_only_with_new_invitation(self) -> None:
        old_invitation = ProjectInvitation.objects.create(
            project=self.project,
            email='invitee@example.com',
            role='member',
            token='token-old-used',
            invited_by=self.user,
            expires_at=timezone.now() + timedelta(days=14),
        )
        self.client.post('/openfarmplanner/api/auth/logout/')
        self.client.post('/openfarmplanner/api/auth/login/', {'email': 'invitee@example.com', 'password': 'pass12345'}, format='json')
        self.client.post(f'/openfarmplanner/api/project-invitations/{old_invitation.token}/accept/')
        ProjectMembership.objects.filter(project=self.project, user=self.invitee).delete()

        old_retry = self.client.post(f'/openfarmplanner/api/project-invitations/{old_invitation.token}/accept/')
        self.assertEqual(old_retry.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(old_retry.data['code'], 'accepted')

        self.client.post('/openfarmplanner/api/auth/logout/')
        self.client.post('/openfarmplanner/api/auth/login/', {'email': 'u1@example.com', 'password': 'pass12345'}, format='json')
        create_response = self.client.post(
            f'/openfarmplanner/api/projects/{self.project.id}/invitations/',
            {'email': 'invitee@example.com', 'role': 'member'},
            format='json',
        )
        self.assertIn(create_response.status_code, {status.HTTP_200_OK, status.HTTP_201_CREATED})
        new_token = create_response.data['token']

        self.client.post('/openfarmplanner/api/auth/logout/')
        self.client.post('/openfarmplanner/api/auth/login/', {'email': 'invitee@example.com', 'password': 'pass12345'}, format='json')
        new_accept = self.client.post(f'/openfarmplanner/api/project-invitations/{new_token}/accept/')
        self.assertEqual(new_accept.status_code, status.HTTP_200_OK)
        self.assertEqual(new_accept.data['code'], 'accepted')
        self.assertTrue(ProjectMembership.objects.filter(project=self.project, user=self.invitee).exists())

    def test_pending_invitation_returns_already_member_without_duplicate_membership(self) -> None:
        ProjectMembership.objects.create(user=self.invitee, project=self.project, role='member')
        invitation = ProjectInvitation.objects.create(
            project=self.project,
            email='invitee@example.com',
            role='member',
            token='token-pending-member',
            invited_by=self.user,
            expires_at=timezone.now() + timedelta(days=14),
        )
        self.client.post('/openfarmplanner/api/auth/logout/')
        self.client.get(f'/openfarmplanner/api/project-invitations/{invitation.token}/')
        self.client.post('/openfarmplanner/api/auth/login/', {'email': 'invitee@example.com', 'password': 'pass12345'}, format='json')

        response = self.client.post('/openfarmplanner/api/project-invitations/pending/accept/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['code'], 'already_member')
        self.assertEqual(ProjectMembership.objects.filter(project=self.project, user=self.invitee).count(), 1)
        self.assertIsNone(self.client.session.get('pending_project_invitation_token'))
        invitation.refresh_from_db()
        self.assertEqual(invitation.status, ProjectInvitation.STATUS_ACCEPTED)
        self.assertIsNotNone(invitation.accepted_at)

    def test_public_status_handles_invalid_token(self) -> None:
        response = self.client.get('/openfarmplanner/api/project-invitations/does-not-exist/')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.data['code'], 'invalid_token')

    def test_admin_can_revoke_invitation(self) -> None:
        invitation = ProjectInvitation.objects.create(
            project=self.project,
            email='invitee@example.com',
            role='member',
            token='token-revoke',
            invited_by=self.user,
            expires_at=timezone.now() + timedelta(days=14),
        )
        response = self.client.post(f'/openfarmplanner/api/projects/{self.project.id}/invitations/{invitation.id}/revoke/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        invitation.refresh_from_db()
        self.assertEqual(invitation.status, 'revoked')

    def test_admin_can_change_member_role(self) -> None:
        member = ProjectMembership.objects.create(user=self.invitee, project=self.project, role='member')
        response = self.client.patch(
            f'/openfarmplanner/api/projects/{self.project.id}/members/',
            {'membership_id': member.id, 'role': 'admin'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        member.refresh_from_db()
        self.assertEqual(member.role, 'admin')

    def test_member_list_includes_account_display_name(self) -> None:
        self.invitee.first_name = 'Martin'
        self.invitee.last_name = 'Stipsitz'
        self.invitee.save(update_fields=['first_name', 'last_name'])
        ProjectMembership.objects.create(user=self.invitee, project=self.project, role='member')

        response = self.client.get(f'/openfarmplanner/api/projects/{self.project.id}/members/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        invitee_row = next(row for row in response.data if row['user'] == self.invitee.id)
        self.assertEqual(invitee_row['user_display_name'], 'Martin Stipsitz')

    def test_cannot_change_own_project_role(self) -> None:
        own_membership = ProjectMembership.objects.get(user=self.user, project=self.project)
        response = self.client.patch(
            f'/openfarmplanner/api/projects/{self.project.id}/members/',
            {'membership_id': own_membership.id, 'role': 'member'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['code'], 'self_role_change_forbidden')

    def test_admin_can_remove_member(self) -> None:
        member = ProjectMembership.objects.create(user=self.invitee, project=self.project, role='member')
        response = self.client.delete(
            f'/openfarmplanner/api/projects/{self.project.id}/members/',
            {'membership_id': member.id},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(ProjectMembership.objects.filter(id=member.id).exists())

    def test_cannot_remove_self_from_project_settings(self) -> None:
        own_membership = ProjectMembership.objects.get(user=self.user, project=self.project)
        response = self.client.delete(
            f'/openfarmplanner/api/projects/{self.project.id}/members/',
            {'membership_id': own_membership.id},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['code'], 'self_removal_forbidden')

    def test_restore_deleted_project_before_retention_expires(self) -> None:
        trashed_project = Project.objects.create(
            name='Recently trashed',
            slug='recently-trashed',
            deleted_at=timezone.now() - timedelta(days=29),
        )
        ProjectMembership.objects.create(user=self.user, project=trashed_project, role='admin')

        response = self.client.post(f'/openfarmplanner/api/projects/{trashed_project.id}/restore/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        trashed_project.refresh_from_db()
        self.assertIsNone(trashed_project.deleted_at)

    def test_permanent_project_delete_endpoint_removes_trashed_project_immediately(self) -> None:
        trashed_project = Project.objects.create(
            name='Delete now',
            slug='delete-now',
            deleted_at=timezone.now(),
        )
        ProjectMembership.objects.create(user=self.user, project=trashed_project, role='admin')
        location = Location.objects.create(name='Cascade location', project=trashed_project)

        response = self.client.delete(
            f'/openfarmplanner/api/projects/{trashed_project.id}/permanent/',
        )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Project.objects.filter(id=trashed_project.id).exists())
        self.assertFalse(Location.objects.filter(id=location.id).exists())

    def test_cleanup_deleted_projects_command_purges_expired_trash_only(self) -> None:
        self.project2.deleted_at = timezone.now() - timedelta(days=31)
        self.project2.save(update_fields=['deleted_at'])
        expired_location = Location.objects.create(name='Expired location', project=self.project2)

        recently_trashed = Project.objects.create(
            name='P3',
            slug='p3',
            deleted_at=timezone.now() - timedelta(days=1),
        )
        never_deleted = Project.objects.create(name='P4', slug='p4')

        call_command('cleanup_deleted_projects')
        call_command('cleanup_deleted_projects')

        self.assertFalse(Project.objects.filter(id=self.project2.id).exists())
        self.assertFalse(Location.objects.filter(id=expired_location.id).exists())
        self.assertTrue(Project.objects.filter(id=recently_trashed.id).exists())
        self.assertTrue(Project.objects.filter(id=self.project.id).exists())
        self.assertTrue(Project.objects.filter(id=never_deleted.id).exists())
