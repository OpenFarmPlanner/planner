"""Tests for project-bound API tokens: storage, lifecycle, scope, and isolation."""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.request import Request
from rest_framework.test import APIClient, APIRequestFactory, APITestCase

from farm.agent_api.authentication import (
    ProjectApiTokenAuthentication,
    header_carries_api_token,
)
from farm.models import (
    API_TOKEN_PREFIX,
    Crop,
    Project,
    ProjectApiToken,
    ProjectMembership,
    Supplier,
)

User = get_user_model()


class ApiTokenTestBase(APITestCase):
    """Two projects with separate owners and one crop each."""

    def setUp(self):
        self.user = User.objects.create_user(
            username='agent-owner', email='owner@example.com', password='pw', is_active=True
        )
        self.other_user = User.objects.create_user(
            username='outsider', email='outsider@example.com', password='pw', is_active=True
        )
        self.project = Project.objects.create(name='Home Farm', slug='home-farm')
        self.foreign_project = Project.objects.create(name='Foreign Farm', slug='foreign-farm')
        ProjectMembership.objects.create(user=self.user, project=self.project, role='admin')
        ProjectMembership.objects.create(
            user=self.other_user, project=self.foreign_project, role='admin'
        )
        self.crop = Crop.objects.create(
            name='Brokkoli', variety='Calabrese', project=self.project
        )
        self.foreign_crop = Crop.objects.create(
            name='Foreign Crop', variety='Secret', project=self.foreign_project
        )

    def issue_token(self, *, scope=ProjectApiToken.SCOPE_READ, project=None, user=None, **kwargs):
        """Create a token and return the (instance, plaintext) pair."""
        return ProjectApiToken.create_token(
            user=user or self.user,
            project=project or self.project,
            name=kwargs.pop('name', 'Test token'),
            scope=scope,
            expires_at=kwargs.pop('expires_at', None),
        )

    def bearer_client(self, raw_token: str) -> APIClient:
        """Return a client that authenticates with the given bearer token."""
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {raw_token}')
        return client


class ApiTokenStorageTests(ApiTokenTestBase):
    """The plaintext token must never be recoverable from the database."""

    def test_token_is_stored_only_as_hash(self):
        token, raw_token = self.issue_token()

        self.assertTrue(raw_token.startswith(API_TOKEN_PREFIX))
        self.assertNotEqual(token.token_hash, raw_token)
        self.assertEqual(token.token_hash, ProjectApiToken.hash_token(raw_token))
        self.assertEqual(len(token.token_hash), 64)

        stored = ProjectApiToken.objects.filter(pk=token.pk).values().first()
        self.assertNotIn(raw_token, str(stored))
        secret_part = raw_token[len(API_TOKEN_PREFIX):]
        self.assertNotIn(secret_part, str(stored))

    def test_display_prefix_is_short_and_not_the_secret(self):
        token, raw_token = self.issue_token()
        secret_part = raw_token[len(API_TOKEN_PREFIX):]

        self.assertEqual(token.token_prefix, secret_part[:8])
        self.assertLess(len(token.token_prefix), len(secret_part))

    def test_two_tokens_never_share_a_value(self):
        _, first = self.issue_token(name='first')
        _, second = self.issue_token(name='second')
        self.assertNotEqual(first, second)

    def test_last_used_at_is_recorded_on_use(self):
        token, raw_token = self.issue_token()
        self.assertIsNone(token.last_used_at)

        self.bearer_client(raw_token).get('/api/crops/')

        token.refresh_from_db()
        self.assertIsNotNone(token.last_used_at)


class ApiTokenLifecycleTests(ApiTokenTestBase):
    """Expired, revoked, and orphaned tokens must stop working immediately."""

    def test_valid_token_authenticates(self):
        _, raw_token = self.issue_token()
        response = self.bearer_client(raw_token).get('/api/crops/')
        self.assertEqual(response.status_code, 200)

    def test_expired_token_is_rejected(self):
        _, raw_token = self.issue_token(expires_at=timezone.now() - timedelta(minutes=1))
        response = self.bearer_client(raw_token).get('/api/crops/')
        self.assertEqual(response.status_code, 401)

    def test_revoked_token_is_rejected(self):
        token, raw_token = self.issue_token()
        token.revoke()

        response = self.bearer_client(raw_token).get('/api/crops/')
        self.assertEqual(response.status_code, 401)

    def test_unknown_token_is_rejected(self):
        client = self.bearer_client(f'{API_TOKEN_PREFIX}definitely-not-issued')
        response = client.get('/api/crops/')
        self.assertEqual(response.status_code, 401)

    def test_token_stops_working_when_membership_is_removed(self):
        _, raw_token = self.issue_token()
        ProjectMembership.objects.filter(user=self.user, project=self.project).delete()

        response = self.bearer_client(raw_token).get('/api/crops/')
        self.assertEqual(response.status_code, 401)

    def test_token_stops_working_when_project_is_deactivated(self):
        _, raw_token = self.issue_token()
        self.project.is_active = False
        self.project.save(update_fields=['is_active'])

        response = self.bearer_client(raw_token).get('/api/crops/')
        self.assertEqual(response.status_code, 401)

    def test_revoking_twice_keeps_the_first_timestamp(self):
        token, _ = self.issue_token()
        token.revoke()
        first_revoked_at = token.revoked_at
        token.revoke()

        token.refresh_from_db()
        self.assertEqual(token.revoked_at, first_revoked_at)


class ApiTokenScopeTests(ApiTokenTestBase):
    """`read` must not mutate; destructive actions require the delete scope."""

    def test_read_token_can_fetch_bound_project_context(self):
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_READ)

        response = self.bearer_client(raw_token).get('/api/agent/context/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.data,
            {
                'project_id': self.project.id,
                'project_name': self.project.name,
                'token_scope': ProjectApiToken.SCOPE_READ,
            },
        )

    def test_session_user_cannot_use_token_context_endpoint(self):
        client = APIClient()
        client.force_authenticate(user=self.user)

        response = client.get('/api/agent/context/')

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['code'], 'api_token_required')

    def test_read_token_can_list_and_retrieve(self):
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_READ)
        client = self.bearer_client(raw_token)

        self.assertEqual(client.get('/api/crops/').status_code, 200)
        self.assertEqual(client.get(f'/api/crops/{self.crop.id}/').status_code, 200)

    def test_read_token_cannot_create(self):
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_READ)
        response = self.bearer_client(raw_token).post(
            '/api/crops/', {'name': 'Neu', 'variety': 'X'}, format='json'
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Crop.objects.filter(name='Neu').exists())

    def test_read_token_cannot_patch(self):
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_READ)
        response = self.bearer_client(raw_token).patch(
            f'/api/crops/{self.crop.id}/', {'notes': 'changed'}, format='json'
        )
        self.assertEqual(response.status_code, 403)
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.notes, '')

    def test_write_token_can_create_and_patch(self):
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_WRITE)
        client = self.bearer_client(raw_token)

        created = client.post('/api/crops/', {'name': 'Neu', 'variety': 'X'}, format='json')
        self.assertEqual(created.status_code, 201)
        self.assertEqual(Crop.objects.get(name='Neu').project_id, self.project.id)

        patched = client.patch(
            f'/api/crops/{self.crop.id}/', {'notes': 'via token'}, format='json'
        )
        self.assertEqual(patched.status_code, 200)

    def test_write_token_can_create_and_patch_general_crop_data(self):
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_WRITE)
        client = self.bearer_client(raw_token)

        created = client.post(
            '/api/crops/',
            {
                'name': 'General Carrot',
                'variety': None,
                'crop_family': 'Apiaceae',
                'growth_duration_days': 100,
                'row_spacing_cm': 30,
            },
            format='json',
        )

        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data['variety'], '')
        crop = Crop.objects.get(pk=created.data['id'])
        self.assertEqual(crop.project_id, self.project.id)

        patched = client.patch(
            f'/api/crops/{crop.id}/',
            {'variety': None, 'growth_duration_days': 110, 'notes': 'Token baseline'},
            format='json',
        )

        self.assertEqual(patched.status_code, 200)
        self.assertEqual(patched.data['variety'], '')
        crop.refresh_from_db()
        self.assertEqual(crop.growth_duration_days, 110)
        self.assertEqual(crop.notes, 'Token baseline')

    def test_write_token_cannot_delete(self):
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_WRITE)
        response = self.bearer_client(raw_token).delete(f'/api/crops/{self.crop.id}/')

        self.assertEqual(response.status_code, 403)
        self.crop.refresh_from_db()
        self.assertIsNone(self.crop.deleted_at)

    def test_write_token_cannot_undelete(self):
        self.crop.deleted_at = timezone.now()
        self.crop.save(update_fields=['deleted_at'])
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_WRITE)
        response = self.bearer_client(raw_token).post(f'/api/crops/{self.crop.id}/undelete/')

        self.assertEqual(response.status_code, 403)
        self.crop.refresh_from_db()
        self.assertIsNotNone(self.crop.deleted_at)

    def test_delete_token_can_soft_delete_and_undelete_crops(self):
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_DELETE)
        client = self.bearer_client(raw_token)

        deleted = client.delete(f'/api/crops/{self.crop.id}/')
        self.assertEqual(deleted.status_code, 204)
        self.crop.refresh_from_db()
        self.assertIsNotNone(self.crop.deleted_at)

        restored = client.post(f'/api/crops/{self.crop.id}/undelete/')
        self.assertEqual(restored.status_code, 200)
        self.crop.refresh_from_db()
        self.assertIsNone(self.crop.deleted_at)

    def test_delete_token_can_still_create_and_patch(self):
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_DELETE)
        client = self.bearer_client(raw_token)

        created = client.post(
            '/api/crops/',
            {'name': 'Delete Scope', 'variety': 'X'},
            format='json',
        )
        self.assertEqual(created.status_code, 201)

        patched = client.patch(
            f'/api/crops/{created.data["id"]}/', {'notes': 'via delete token'}, format='json'
        )
        self.assertEqual(patched.status_code, 200)

    def test_supporting_collections_are_read_only(self):
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_WRITE)
        client = self.bearer_client(raw_token)

        self.assertEqual(client.get('/api/suppliers/').status_code, 200)
        response = client.post(
            '/api/suppliers/', {'name': 'X', 'homepage_url': 'https://x.example'}, format='json'
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Supplier.objects.filter(name='X').exists())

    def test_crop_task_templates_are_read_only_for_tokens(self) -> None:
        from farm.models import CropTaskTemplate

        template = CropTaskTemplate.objects.create(
            project=self.project, crop=self.crop, title='Water', reference_event='planting',
        )
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_DELETE)
        client = self.bearer_client(raw_token)
        url = '/api/crop-task-templates/'
        self.assertEqual(client.get(url).status_code, 200)
        self.assertEqual(client.get(f'{url}{template.pk}/').status_code, 200)
        self.assertEqual(client.post(url, {
            'crop': self.crop.pk, 'title': 'Write', 'reference_event': 'planting',
        }, format='json').status_code, 403)
        response = client.patch(f'{url}{template.pk}/', {'title': 'Changed'})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(client.delete(f'{url}{template.pk}/').status_code, 403)
        template.refresh_from_db()
        self.assertIsNone(template.deleted_at)
        self.assertEqual(template.title, 'Water')

    def test_tasks_are_read_only_even_for_delete_scoped_tokens(self) -> None:
        from farm.models import Season, Task

        season = Season.objects.create(
            project=self.project, start_date='2026-01-01', end_date='2026-12-31',
        )
        task = Task.objects.create(
            project=self.project, season=season, title='Keep task', origin='automatic',
            source_key='plan:123:event:planting',
        )
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_DELETE)
        client = self.bearer_client(raw_token)
        self.assertEqual(client.get('/api/tasks/').status_code, 200)
        self.assertEqual(client.get(f'/api/tasks/{task.pk}/').status_code, 200)
        self.assertEqual(client.post('/api/tasks/', {
            'title': 'Forbidden', 'season': season.pk,
        }, format='json').status_code, 403)
        response = client.patch(f'/api/tasks/{task.pk}/', {'status': 'completed'})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(client.delete(f'/api/tasks/{task.pk}/').status_code, 403)
        task.refresh_from_db()
        self.assertEqual(task.status, 'pending')
        self.assertIsNone(task.deleted_at)

    def test_delete_token_cannot_delete_supporting_collections(self):
        supplier = Supplier.objects.create(project=self.project, name='Keep Me')
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_DELETE)
        response = self.bearer_client(raw_token).delete(f'/api/suppliers/{supplier.id}/')

        self.assertEqual(response.status_code, 403)
        self.assertTrue(Supplier.objects.filter(pk=supplier.id).exists())


class ApiTokenHeaderCasingTests(ApiTokenTestBase):
    """The surface gate must see a token however the bearer scheme is spelled.

    Regression test. HTTP auth schemes are case-insensitive and DRF splits the
    header on arbitrary whitespace, so `bearer`, `BEARER`, and a double space
    all authenticate. The middleware originally matched a literal
    `'Bearer ofp_pat_'` prefix and therefore did not see those spellings —
    which let a read-scoped token reach every view that sets its own
    `permission_classes`, including the account data export.
    """

    # Endpoints that are not on the agent allowlist and additionally define
    # their own permission_classes, so the middleware is their only guard.
    UNREACHABLE_PATHS = (
        '/api/auth/me/',
        '/api/auth/account/data-export/',
        '/api/public-crops/',
    )

    SPELLINGS = ('Bearer {}', 'bearer {}', 'BEARER {}', 'BeArEr {}', 'Bearer  {}')

    def test_every_bearer_spelling_is_refused_on_forbidden_endpoints(self):
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_READ)

        for spelling in self.SPELLINGS:
            for path in self.UNREACHABLE_PATHS:
                with self.subTest(spelling=spelling, path=path):
                    client = APIClient()
                    client.credentials(HTTP_AUTHORIZATION=spelling.format(raw_token))
                    self.assertEqual(client.get(path).status_code, 403)

    def test_every_bearer_spelling_still_authenticates_allowlisted_endpoints(self):
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_READ)

        for spelling in ('Bearer {}', 'bearer {}', 'BEARER {}'):
            with self.subTest(spelling=spelling):
                client = APIClient()
                client.credentials(HTTP_AUTHORIZATION=spelling.format(raw_token))
                self.assertEqual(client.get('/api/crops/').status_code, 200)

    def test_lowercase_spelling_cannot_write_with_a_read_token(self):
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_READ)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'bearer {raw_token}')

        response = client.post('/api/crops/', {'name': 'Sneaky', 'variety': 'X'}, format='json')

        self.assertEqual(response.status_code, 403)
        self.assertFalse(Crop.objects.filter(name='Sneaky').exists())

    def test_lowercase_spelling_cannot_reach_a_foreign_project(self):
        _, raw_token = self.issue_token()
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'bearer {raw_token}')

        response = client.get('/api/crops/', HTTP_X_PROJECT_ID=str(self.foreign_project.id))
        self.assertEqual(response.status_code, 403)

    def test_a_foreign_bearer_scheme_still_falls_through_to_session_auth(self):
        # A bearer credential that is not one of ours must not be treated as an
        # API token, or unrelated integrations would start getting 403s.
        client = APIClient()
        client.force_authenticate(user=self.user)
        client.credentials(HTTP_AUTHORIZATION='bearer some-other-systems-token')

        response = client.get('/api/auth/me/')
        self.assertEqual(response.status_code, 200)


class ApiTokenForbiddenSurfaceTests(ApiTokenTestBase):
    """Administration, membership, and account endpoints stay out of reach."""

    def test_token_cannot_read_project_members(self):
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_WRITE)
        response = self.bearer_client(raw_token).get(f'/api/projects/{self.project.id}/members/')
        self.assertEqual(response.status_code, 403)

    def test_token_cannot_invite_members(self):
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_WRITE)
        response = self.bearer_client(raw_token).post(
            f'/api/projects/{self.project.id}/invitations/',
            {'email': 'x@example.com', 'role': 'member'},
            format='json',
        )
        self.assertEqual(response.status_code, 403)

    def test_token_cannot_read_account_profile(self):
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_WRITE)
        response = self.bearer_client(raw_token).get('/api/auth/me/')
        self.assertEqual(response.status_code, 403)

    def test_token_cannot_manage_api_tokens(self):
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_WRITE)
        client = self.bearer_client(raw_token)

        self.assertEqual(client.get('/api/api-tokens/').status_code, 403)
        self.assertEqual(
            client.post(
                '/api/api-tokens/',
                {'name': 'escalation', 'project': self.project.id, 'scope': 'write'},
                format='json',
            ).status_code,
            403,
        )

    def test_token_cannot_switch_projects(self):
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_WRITE)
        response = self.bearer_client(raw_token).post(
            '/api/projects-switch/', {'project_id': self.foreign_project.id}, format='json'
        )
        self.assertEqual(response.status_code, 403)

    def test_token_cannot_restore_project_history(self):
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_WRITE)
        response = self.bearer_client(raw_token).post(
            '/api/history/project/restore/', {'history_id': 1}, format='json'
        )
        self.assertEqual(response.status_code, 403)


class ApiTokenProjectIsolationTests(ApiTokenTestBase):
    """The bound project is derived server-side and cannot be widened."""

    def test_listing_returns_only_bound_project_data(self):
        _, raw_token = self.issue_token()
        response = self.bearer_client(raw_token).get('/api/crops/')

        names = {row['name'] for row in response.data['results']}
        self.assertIn('Brokkoli', names)
        self.assertNotIn('Foreign Crop', names)

    def test_foreign_project_header_is_rejected(self):
        _, raw_token = self.issue_token()
        client = self.bearer_client(raw_token)

        response = client.get('/api/crops/', HTTP_X_PROJECT_ID=str(self.foreign_project.id))
        self.assertEqual(response.status_code, 403)

    def test_matching_project_header_is_accepted(self):
        _, raw_token = self.issue_token()
        client = self.bearer_client(raw_token)

        response = client.get('/api/crops/', HTTP_X_PROJECT_ID=str(self.project.id))
        self.assertEqual(response.status_code, 200)

    def test_missing_project_header_is_fine_for_tokens(self):
        _, raw_token = self.issue_token()
        response = self.bearer_client(raw_token).get('/api/crops/')
        self.assertEqual(response.status_code, 200)

    def test_foreign_object_id_is_not_retrievable(self):
        _, raw_token = self.issue_token()
        response = self.bearer_client(raw_token).get(f'/api/crops/{self.foreign_crop.id}/')
        self.assertEqual(response.status_code, 404)

    def test_foreign_object_id_is_not_writable(self):
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_WRITE)
        response = self.bearer_client(raw_token).patch(
            f'/api/crops/{self.foreign_crop.id}/', {'notes': 'hijacked'}, format='json'
        )

        self.assertEqual(response.status_code, 404)
        self.foreign_crop.refresh_from_db()
        self.assertEqual(self.foreign_crop.notes, '')

    def test_token_owner_membership_elsewhere_does_not_widen_the_token(self):
        # The owner joins the other project too; the token stays bound to the
        # project it was issued for.
        ProjectMembership.objects.create(
            user=self.user, project=self.foreign_project, role='member'
        )
        _, raw_token = self.issue_token()

        response = self.bearer_client(raw_token).get(
            '/api/crops/', HTTP_X_PROJECT_ID=str(self.foreign_project.id)
        )
        self.assertEqual(response.status_code, 403)

    def test_payload_project_field_is_ignored_on_create(self):
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_WRITE)
        response = self.bearer_client(raw_token).post(
            '/api/crops/',
            {'name': 'Injected', 'variety': 'Y', 'project': self.foreign_project.id},
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Crop.objects.get(name='Injected').project_id, self.project.id)


class ApiTokenCsrfTests(ApiTokenTestBase):
    """Token auth needs no CSRF token; session auth keeps needing one."""

    def test_token_post_succeeds_without_csrf_token(self):
        _, raw_token = self.issue_token(scope=ProjectApiToken.SCOPE_WRITE)
        client = APIClient(enforce_csrf_checks=True)
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {raw_token}')

        response = client.post(
            '/api/crops/', {'name': 'CSRF-free', 'variety': 'Z'}, format='json'
        )
        self.assertEqual(response.status_code, 201)

    def test_session_post_without_csrf_token_is_still_rejected(self):
        client = APIClient(enforce_csrf_checks=True)
        self.assertTrue(client.login(username='agent-owner', password='pw'))

        response = client.post(
            '/api/crops/',
            {'name': 'Session', 'variety': 'Z'},
            format='json',
            HTTP_X_PROJECT_ID=str(self.project.id),
        )
        self.assertEqual(response.status_code, 403)


class SessionAuthenticationRegressionTests(ApiTokenTestBase):
    """Adding token auth must not change existing browser behaviour."""

    def test_session_user_still_uses_the_project_header(self):
        client = APIClient()
        client.force_authenticate(user=self.user)

        response = client.get('/api/crops/', HTTP_X_PROJECT_ID=str(self.project.id))
        self.assertEqual(response.status_code, 200)
        self.assertIn('Brokkoli', {row['name'] for row in response.data['results']})

    def test_session_user_can_still_delete(self):
        client = APIClient()
        client.force_authenticate(user=self.user)

        response = client.delete(
            f'/api/crops/{self.crop.id}/', HTTP_X_PROJECT_ID=str(self.project.id)
        )
        self.assertEqual(response.status_code, 204)

    def test_session_user_can_still_reach_account_endpoints(self):
        client = APIClient()
        client.force_authenticate(user=self.user)

        self.assertEqual(client.get('/api/auth/me/').status_code, 200)

    def test_session_user_can_switch_between_their_projects(self):
        ProjectMembership.objects.create(
            user=self.user, project=self.foreign_project, role='member'
        )
        client = APIClient()
        client.force_authenticate(user=self.user)

        response = client.get('/api/crops/', HTTP_X_PROJECT_ID=str(self.foreign_project.id))
        self.assertEqual(response.status_code, 200)
        self.assertIn('Foreign Crop', {row['name'] for row in response.data['results']})

    def test_non_bearer_authorization_header_falls_through(self):
        client = APIClient()
        client.force_authenticate(user=self.user)
        client.credentials(HTTP_AUTHORIZATION='Basic irrelevant')

        response = client.get('/api/crops/', HTTP_X_PROJECT_ID=str(self.project.id))
        self.assertEqual(response.status_code, 200)


class ApiTokenManagementEndpointTests(ApiTokenTestBase):
    """Token self-service: create once, list without the secret, revoke."""

    def setUp(self):
        super().setUp()
        self.client.force_authenticate(user=self.user)

    def test_create_returns_the_plaintext_exactly_once(self):
        response = self.client.post(
            '/api/api-tokens/',
            {'name': 'Codex', 'project': self.project.id, 'scope': 'write'},
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        raw_token = response.data['token']
        self.assertTrue(raw_token.startswith(API_TOKEN_PREFIX))

        listed = self.client.get('/api/api-tokens/')
        self.assertEqual(listed.status_code, 200)
        self.assertNotIn('token', listed.data[0])
        self.assertEqual(listed.data[0]['token_prefix'], raw_token[len(API_TOKEN_PREFIX):][:8])

    def test_cannot_create_a_token_for_a_project_the_user_is_not_in(self):
        response = self.client.post(
            '/api/api-tokens/',
            {'name': 'Sneaky', 'project': self.foreign_project.id, 'scope': 'write'},
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(ProjectApiToken.objects.filter(project=self.foreign_project).exists())

    def test_expiry_must_be_in_the_future(self):
        response = self.client.post(
            '/api/api-tokens/',
            {
                'name': 'Past',
                'project': self.project.id,
                'expires_at': (timezone.now() - timedelta(days=1)).isoformat(),
            },
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_create_accepts_a_future_expiry(self):
        expires_at = timezone.now() + timedelta(days=30)

        response = self.client.post(
            '/api/api-tokens/',
            {
                'name': 'Claude',
                'project': self.project.id,
                'scope': 'write',
                'expires_at': expires_at.isoformat(),
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['name'], 'Claude')
        self.assertEqual(response.data['scope'], 'write')
        self.assertIsNotNone(response.data['expires_at'])

    def test_listing_never_exposes_other_users_tokens(self):
        ProjectApiToken.create_token(
            user=self.other_user, project=self.foreign_project, name='Theirs'
        )
        response = self.client.get('/api/api-tokens/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['name'] for row in response.data], [])

    def test_cannot_revoke_another_users_token(self):
        foreign_token, _ = ProjectApiToken.create_token(
            user=self.other_user, project=self.foreign_project, name='Theirs'
        )
        response = self.client.delete(f'/api/api-tokens/{foreign_token.id}/')

        self.assertEqual(response.status_code, 404)
        foreign_token.refresh_from_db()
        self.assertIsNone(foreign_token.revoked_at)

    def test_revoke_marks_the_token_and_disables_it(self):
        created = self.client.post(
            '/api/api-tokens/', {'name': 'Temp', 'project': self.project.id}, format='json'
        )
        raw_token = created.data['token']

        revoked = self.client.delete(f'/api/api-tokens/{created.data["id"]}/')
        self.assertEqual(revoked.status_code, 200)
        self.assertEqual(revoked.data['status'], 'revoked')

        self.assertEqual(self.bearer_client(raw_token).get('/api/crops/').status_code, 401)


class ApiTokenHeaderDetectionInvariantTests(APITestCase):
    """The surface gate's detection must never be narrower than the authenticator's.

    The two parse the same header in different places: the authenticator sees
    it through DRF, the middleware sees it raw, before any view runs. If the
    middleware's view is the narrower one, a credential can authenticate while
    slipping past the deny-by-default gate — which is exactly how the bearer
    casing bypass happened. This test compares the two directly, so a future
    change to either side fails here rather than silently opening the gate.
    """

    SPELLINGS = (
        'Bearer {}',
        'bearer {}',
        'BEARER {}',
        'BeArEr {}',
        'Bearer  {}',
        'Bearer\t{}',
        '  bearer   {}  ',
    )

    def test_detection_accepts_everything_the_authenticator_accepts(self):
        raw_token = ProjectApiToken.generate_raw_token()
        authenticator = ProjectApiTokenAuthentication()

        for spelling in self.SPELLINGS:
            header = spelling.format(raw_token)
            with self.subTest(header=repr(header)):
                request = APIRequestFactory().get('/', HTTP_AUTHORIZATION=header)
                authenticator_accepts = (
                    authenticator._extract_bearer_token(Request(request)) == raw_token
                )
                if authenticator_accepts:
                    self.assertTrue(
                        header_carries_api_token(header),
                        'Authenticator accepts this header but the surface gate does not see it.',
                    )

    def test_detection_ignores_credentials_that_are_not_ours(self):
        for header in (
            '',
            'Basic dXNlcjpwYXNz',
            'Bearer some-other-systems-token',
            'Token ofp_pat_looks-like-ours-but-wrong-scheme',
        ):
            with self.subTest(header=header):
                self.assertFalse(header_carries_api_token(header))
