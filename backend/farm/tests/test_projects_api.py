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
from farm.services.project_invitations import (
    InvitationFlowError,
    accept_invitation,
    accept_pending_invitation_from_session,
    build_public_status,
    clear_pending_invitation_token,
    create_or_resend_invitation,
    get_invitation_by_token,
    get_pending_invitation_token,
    revoke_invitation,
    store_pending_invitation_token,
)

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
        self.assertEqual(response.data['code'], 'demo_project_creation_failed')
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


class PendingInvitationSessionTests(APITestCase):
    """Direct tests for the session helpers that carry a token through login."""

    def test_stores_and_reads_a_token_back(self):
        session = {}
        store_pending_invitation_token(session=session, token='abc')
        self.assertEqual(get_pending_invitation_token(session=session), 'abc')

    def test_has_no_token_when_none_was_stored(self):
        self.assertIsNone(get_pending_invitation_token(session={}))

    def test_treats_a_stored_value_that_is_not_a_usable_token_as_absent(self):
        # A blank or non-string value would send the accept flow looking up a
        # token that cannot match anything.
        for value in ('', None, 123, []):
            with self.subTest(value=value):
                session = {'pending_project_invitation_token': value}
                self.assertIsNone(get_pending_invitation_token(session=session))

    def test_clearing_removes_the_token(self):
        session = {}
        store_pending_invitation_token(session=session, token='abc')
        clear_pending_invitation_token(session=session)
        self.assertIsNone(get_pending_invitation_token(session=session))

    def test_clearing_an_empty_session_is_a_no_op(self):
        session = {}
        clear_pending_invitation_token(session=session)
        self.assertEqual(session, {})

    def test_marks_a_real_session_modified_so_the_change_is_persisted(self):
        # Django only writes the session back when `modified` is set; a plain
        # dict has no such attribute, which is why both helpers guard on it.
        class FakeSession(dict):
            modified = False

        session = FakeSession()
        store_pending_invitation_token(session=session, token='abc')
        self.assertTrue(session.modified)

        session.modified = False
        clear_pending_invitation_token(session=session)
        self.assertTrue(session.modified)

    def test_does_not_mark_a_session_modified_when_there_was_nothing_to_clear(self):
        class FakeSession(dict):
            modified = False

        session = FakeSession()
        clear_pending_invitation_token(session=session)
        self.assertFalse(session.modified)


class InvitationServiceFlowTests(APITestCase):
    """Direct tests for the invitation service, below the HTTP layer."""

    def setUp(self) -> None:
        self.admin = User.objects.create_user(
            username='inv-admin', email='admin@example.com', password='pass12345', is_active=True,
        )
        self.invitee = User.objects.create_user(
            username='inv-guest', email='guest@example.com', password='pass12345', is_active=True,
        )
        self.project = Project.objects.create(name='Invite P', slug='invite-p')
        ProjectMembership.objects.create(user=self.admin, project=self.project, role='admin')

    def invite(self, email='guest@example.com', role='member'):
        return create_or_resend_invitation(
            project=self.project, invited_by=self.admin, email=email, role=role,
        )

    def test_creating_an_invitation_reports_it_as_sent(self):
        result = self.invite()
        self.assertEqual(result.code, 'invitation_sent')
        self.assertEqual(result.invitation.email_normalized, 'guest@example.com')

    def test_a_second_invitation_to_the_same_address_is_a_resend(self):
        # Two admins inviting the same person must not produce two live tokens.
        first = self.invite()
        second = self.invite()
        self.assertEqual(second.code, 'invitation_resent')
        self.assertEqual(second.invitation.pk, first.invitation.pk)

    def test_rejects_an_address_that_normalizes_to_nothing(self):
        with self.assertRaises(InvitationFlowError) as ctx:
            self.invite(email='   ')
        self.assertEqual(ctx.exception.code, 'invalid_email')

    def test_rejects_inviting_someone_who_is_already_a_member(self):
        ProjectMembership.objects.create(user=self.invitee, project=self.project, role='member')
        with self.assertRaises(InvitationFlowError) as ctx:
            self.invite()
        self.assertEqual(ctx.exception.code, 'already_member')

    def test_matches_an_existing_member_whose_stored_address_is_mixed_case(self):
        # The invited address is lower-cased before the lookup, so the case of
        # the *input* proves nothing — only a stored address in a different case
        # shows that the query is case-insensitive. Without it, an account
        # registered as Guest@Example.com could be invited to a project it is
        # already a member of.
        mixed = User.objects.create_user(
            username='inv-mixed', email='Mixed@Example.com', password='pass12345', is_active=True,
        )
        ProjectMembership.objects.create(user=mixed, project=self.project, role='member')

        with self.assertRaises(InvitationFlowError) as ctx:
            self.invite(email='mixed@example.com')
        self.assertEqual(ctx.exception.code, 'already_member')

    def test_matches_an_existing_member_regardless_of_the_invited_address_case(self):
        ProjectMembership.objects.create(user=self.invitee, project=self.project, role='member')
        with self.assertRaises(InvitationFlowError) as ctx:
            self.invite(email='GUEST@Example.com')
        self.assertEqual(ctx.exception.code, 'already_member')

    def test_accepting_creates_the_membership_with_the_invited_role(self):
        invitation = self.invite(role='admin').invitation
        result = accept_invitation(invitation=invitation, user=self.invitee)
        self.assertEqual(result.code, 'accepted')
        membership = ProjectMembership.objects.get(project=self.project, user=self.invitee)
        self.assertEqual(membership.role, 'admin')

    def test_refuses_an_invitation_addressed_to_someone_else(self):
        invitation = self.invite(email='other@example.com').invitation
        with self.assertRaises(InvitationFlowError) as ctx:
            accept_invitation(invitation=invitation, user=self.invitee)
        self.assertEqual(ctx.exception.code, 'email_mismatch')
        self.assertFalse(
            ProjectMembership.objects.filter(project=self.project, user=self.invitee).exists(),
        )

    def test_refuses_an_expired_invitation(self):
        invitation = self.invite().invitation
        ProjectInvitation.objects.filter(pk=invitation.pk).update(
            expires_at=timezone.now() - timedelta(days=1),
        )
        invitation.refresh_from_db()
        with self.assertRaises(InvitationFlowError) as ctx:
            accept_invitation(invitation=invitation, user=self.invitee)
        self.assertEqual(ctx.exception.code, 'expired')

    def test_refuses_a_revoked_invitation(self):
        invitation = self.invite().invitation
        revoke_invitation(invitation=invitation, actor=self.admin)
        invitation.refresh_from_db()
        with self.assertRaises(InvitationFlowError) as ctx:
            accept_invitation(invitation=invitation, user=self.invitee)
        self.assertEqual(ctx.exception.code, 'revoked')

    def test_refuses_an_invitation_that_was_already_used(self):
        # The token stays valid-looking in the invitee's inbox, so a second
        # click has to be rejected rather than silently re-accepted.
        invitation = self.invite().invitation
        accept_invitation(invitation=invitation, user=self.invitee)
        invitation.refresh_from_db()
        with self.assertRaises(InvitationFlowError) as ctx:
            accept_invitation(invitation=invitation, user=self.invitee)
        self.assertEqual(ctx.exception.code, 'accepted')

    def test_marks_an_invitation_used_when_the_membership_already_existed(self):
        # Someone added directly while their invitation was open should not be
        # left with a token that still looks pending.
        invitation = self.invite().invitation
        ProjectMembership.objects.create(user=self.invitee, project=self.project, role='member')
        result = accept_invitation(invitation=invitation, user=self.invitee)
        self.assertEqual(result.code, 'already_member')
        self.assertEqual(result.invitation.status, ProjectInvitation.STATUS_ACCEPTED)

    def test_revoking_twice_leaves_the_first_revocation_record_intact(self):
        # A second revoke returns the same 'revoked' code either way, so the
        # code alone cannot show the early return does anything. What it
        # protects is the audit trail: without it the row is re-saved and
        # revoked_at/revoked_by are overwritten by whoever clicked last.
        invitation = self.invite().invitation
        first = revoke_invitation(invitation=invitation, actor=self.admin)
        original_revoked_at = first.invitation.revoked_at

        other_admin = User.objects.create_user(
            username='inv-admin2', email='admin2@example.com', password='pass12345', is_active=True,
        )
        ProjectMembership.objects.create(user=other_admin, project=self.project, role='admin')
        second = revoke_invitation(invitation=invitation, actor=other_admin)

        self.assertEqual(second.code, 'revoked')
        self.assertEqual(second.invitation.revoked_at, original_revoked_at)
        self.assertEqual(second.invitation.revoked_by_id, self.admin.id)

    def test_revoking_an_accepted_invitation_reports_that_it_is_too_late(self):
        invitation = self.invite().invitation
        accept_invitation(invitation=invitation, user=self.invitee)
        self.assertEqual(
            revoke_invitation(invitation=invitation, actor=self.admin).code, 'already_accepted',
        )

    def test_revoking_an_expired_invitation_reports_it_as_expired(self):
        invitation = self.invite().invitation
        ProjectInvitation.objects.filter(pk=invitation.pk).update(
            expires_at=timezone.now() - timedelta(days=1),
        )
        self.assertEqual(revoke_invitation(invitation=invitation, actor=self.admin).code, 'expired')

    def test_looking_up_an_unknown_token_is_a_flow_error(self):
        with self.assertRaises(InvitationFlowError) as ctx:
            get_invitation_by_token('no-such-token')
        self.assertEqual(ctx.exception.code, 'invalid_token')


class BuildPublicStatusTests(APITestCase):
    """Direct tests for the payload the public invitation page renders from."""

    def setUp(self) -> None:
        self.admin = User.objects.create_user(
            username='ps-admin', email='admin@example.com', password='pass12345', is_active=True,
        )
        self.invitee = User.objects.create_user(
            username='ps-guest', email='guest@example.com', password='pass12345', is_active=True,
        )
        self.project = Project.objects.create(name='Status P', slug='status-p')
        ProjectMembership.objects.create(user=self.admin, project=self.project, role='admin')
        self.invitation = create_or_resend_invitation(
            project=self.project, invited_by=self.admin, email='guest@example.com', role='member',
        ).invitation

    def test_an_anonymous_visitor_is_told_they_must_sign_in(self):
        status_payload = build_public_status(self.invitation, None)
        self.assertTrue(status_payload['requires_auth'])
        self.assertEqual(status_payload['code'], ProjectInvitation.STATUS_PENDING)

    def test_the_masked_address_is_shown_rather_than_the_real_one(self):
        # This endpoint answers without authentication, so the full address
        # must not be readable by anyone holding the link.
        payload = build_public_status(self.invitation, None)
        self.assertEqual(payload['email_masked'], 'g***@example.com')
        self.assertNotIn('guest@example.com', str(payload))

    def test_names_the_project_so_the_invitee_knows_what_they_are_joining(self):
        self.assertEqual(build_public_status(self.invitation, None)['project_name'], 'Status P')

    def test_a_signed_in_invitee_is_not_asked_to_sign_in_again(self):
        payload = build_public_status(self.invitation, self.invitee)
        self.assertFalse(payload['requires_auth'])
        self.assertEqual(payload['code'], ProjectInvitation.STATUS_PENDING)

    def test_a_signed_in_stranger_is_told_the_addresses_do_not_match(self):
        payload = build_public_status(self.invitation, self.admin)
        self.assertEqual(payload['code'], 'email_mismatch')

    def test_a_signed_in_invitee_who_already_joined_is_told_so(self):
        ProjectMembership.objects.create(user=self.invitee, project=self.project, role='member')
        payload = build_public_status(self.invitation, self.invitee)
        self.assertEqual(payload['code'], 'already_member')

    def test_a_resolved_invitation_keeps_its_own_status_for_a_stranger(self):
        # The email-mismatch check only applies while the invitation is still
        # pending; a revoked one reads as revoked to everyone.
        revoke_invitation(invitation=self.invitation, actor=self.admin)
        self.invitation.refresh_from_db()
        payload = build_public_status(self.invitation, self.admin)
        self.assertEqual(payload['code'], ProjectInvitation.STATUS_REVOKED)


class AcceptPendingInvitationFromSessionTests(APITestCase):
    """Direct tests for the post-login hand-off through the session."""

    def setUp(self) -> None:
        self.admin = User.objects.create_user(
            username='sess-admin', email='admin@example.com', password='pass12345', is_active=True,
        )
        self.invitee = User.objects.create_user(
            username='sess-guest', email='guest@example.com', password='pass12345', is_active=True,
        )
        self.project = Project.objects.create(name='Session P', slug='session-p')
        ProjectMembership.objects.create(user=self.admin, project=self.project, role='admin')
        self.invitation = create_or_resend_invitation(
            project=self.project, invited_by=self.admin, email='guest@example.com', role='member',
        ).invitation

    def test_accepts_the_stored_invitation_and_clears_the_token(self):
        session = {}
        store_pending_invitation_token(session=session, token=self.invitation.token)

        result = accept_pending_invitation_from_session(session=session, user=self.invitee)

        self.assertEqual(result.code, 'accepted')
        self.assertIsNone(get_pending_invitation_token(session=session))

    def test_reports_when_there_is_nothing_stored(self):
        with self.assertRaises(InvitationFlowError) as ctx:
            accept_pending_invitation_from_session(session={}, user=self.invitee)
        self.assertEqual(ctx.exception.code, 'no_pending_invitation')

    def test_drops_a_token_that_can_never_succeed(self):
        # An invalid, used, revoked or expired token would otherwise be retried
        # on every subsequent login.
        session = {}
        store_pending_invitation_token(session=session, token='no-such-token')

        with self.assertRaises(InvitationFlowError):
            accept_pending_invitation_from_session(session=session, user=self.invitee)

        self.assertIsNone(get_pending_invitation_token(session=session))

    def test_keeps_a_token_that_the_right_user_could_still_accept(self):
        # An email mismatch is about who is signed in, not about the token —
        # the invitee may yet log in as themselves, so it is kept.
        session = {}
        store_pending_invitation_token(session=session, token=self.invitation.token)

        with self.assertRaises(InvitationFlowError) as ctx:
            accept_pending_invitation_from_session(session=session, user=self.admin)

        self.assertEqual(ctx.exception.code, 'email_mismatch')
        self.assertEqual(get_pending_invitation_token(session=session), self.invitation.token)
