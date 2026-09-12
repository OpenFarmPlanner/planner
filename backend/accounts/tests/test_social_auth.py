"""Tests for Google/Microsoft social login and the account-linking policy.

The providers themselves are never contacted: the token exchange and the
provider profile call are mocked, everything from the provider's raw response
onwards (claim extraction, linking policy, session login, redirects) runs for
real.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from allauth.account.models import EmailAddress
from allauth.socialaccount.models import SocialAccount
from django.contrib.auth import get_user_model
from django.test import Client, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status

from accounts.consent import CURRENT_VERSIONS
from accounts.models import AccountDeletionRequest, DocumentConsent
from accounts.services import finalize_account_deletion
from accounts.social_auth import (
    OpenFarmPlannerGoogleOAuth2Adapter,
    OpenFarmPlannerMicrosoftOAuth2Adapter,
    social_callback_base_url,
)

User = get_user_model()

SOCIAL_PROVIDER_SETTINGS = {
    'google': {
        'provider_class': 'accounts.social_auth.OpenFarmPlannerGoogleProvider',
        'APPS': [
            {'client_id': 'test-google-client', 'secret': 'test-google-secret', 'settings': {}}
        ],
        'SCOPE': ['profile', 'email'],
        'OAUTH_PKCE_ENABLED': True,
    },
    'microsoft': {
        'provider_class': 'accounts.social_auth.OpenFarmPlannerMicrosoftProvider',
        'APPS': [
            {
                'client_id': 'test-microsoft-client',
                'secret': 'test-microsoft-secret',
                'settings': {'tenant': 'common'},
            }
        ],
        'SCOPE': ['User.Read'],
        'OAUTH_PKCE_ENABLED': True,
    },
}

PROVIDER_ADAPTERS = {
    'google': OpenFarmPlannerGoogleOAuth2Adapter,
    'microsoft': OpenFarmPlannerMicrosoftOAuth2Adapter,
}

FRONTEND_URL = 'http://localhost:5173'


def google_claims(
    *,
    sub: str = 'google-sub-1',
    email: str | None = 'user@example.com',
    email_verified: bool = True,
) -> dict[str, Any]:
    """Build an ID-token payload as Google would return it."""
    claims: dict[str, Any] = {
        'iss': 'https://accounts.google.com',
        'aud': 'test-google-client',
        'sub': sub,
        'given_name': 'Grete',
        'family_name': 'Gaertner',
    }
    if email is not None:
        claims['email'] = email
        claims['email_verified'] = email_verified
    return claims


def microsoft_profile(
    *,
    object_id: str = 'microsoft-oid-1',
    mail: str | None = 'user@example.com',
) -> dict[str, Any]:
    """Build a Microsoft Graph ``/me`` payload."""
    profile: dict[str, Any] = {
        'id': object_id,
        'givenName': 'Max',
        'surname': 'Mustermann',
        'mailNickname': 'max',
    }
    if mail is not None:
        profile['mail'] = mail
    return profile


@override_settings(
    SOCIALACCOUNT_PROVIDERS=SOCIAL_PROVIDER_SETTINGS,
    PUBLIC_FRONTEND_URL=FRONTEND_URL,
    FRONTEND_URL=FRONTEND_URL,
    SOCIAL_AUTH_CALLBACK_BASE_URL=FRONTEND_URL,
)
class SocialLoginTestCase(TestCase):
    """Shared helpers to drive a full provider round trip through the views."""

    def start_login(self, provider: str, *, process: str = 'login') -> str:
        """Start a provider login and return the generated ``state`` value."""
        response = self.client.post(reverse(f'{provider}_login'), {'process': process})
        self.assertEqual(response.status_code, status.HTTP_302_FOUND)
        query = parse_qs(urlparse(response['Location']).query)
        return query['state'][0]

    def complete_login(self, provider: str, payload: dict[str, Any], *, process: str = 'login'):
        """Run a provider round trip that returns ``payload`` as profile data."""
        state = self.start_login(provider, process=process)
        adapter_class = PROVIDER_ADAPTERS[provider]

        def fake_complete_login(self, request, app, token, **kwargs):  # noqa: ANN001, ANN202 - allauth signature
            return self.get_provider().sociallogin_from_response(request, payload)

        with (
            patch.object(
                adapter_class,
                'get_access_token_data',
                return_value={'access_token': 'test-access-token'},
            ),
            patch.object(adapter_class, 'complete_login', fake_complete_login),
        ):
            return self.client.get(
                reverse(f'{provider}_callback'),
                {'code': 'test-code', 'state': state},
            )

    def assertRedirectsToFrontend(
        self,
        response,
        path: str,
        params: dict[str, str] | None = None,
    ) -> None:
        """Assert a redirect into the SPA, optionally carrying query parameters."""
        self.assertEqual(response.status_code, status.HTTP_302_FOUND)
        location = urlparse(response['Location'])
        self.assertEqual(f'{location.scheme}://{location.netloc}', FRONTEND_URL)
        self.assertEqual(location.path, path)
        for key, value in (params or {}).items():
            self.assertEqual(parse_qs(location.query).get(key), [value])

    def assertLoggedInAs(self, user: User) -> None:
        """Assert that the test client holds a session for ``user``."""
        self.assertEqual(self.client.session.get('_auth_user_id'), str(user.pk))

    def assertNotLoggedIn(self) -> None:
        """Assert that the test client holds no authenticated session."""
        self.assertIsNone(self.client.session.get('_auth_user_id'))


class SocialSignupTest(SocialLoginTestCase):
    def test_google_login_creates_new_account(self) -> None:
        response = self.complete_login('google', google_claims())

        self.assertRedirectsToFrontend(response, '/app')
        user = User.objects.get(email='user@example.com')
        self.assertTrue(user.is_active)
        self.assertFalse(user.has_usable_password())
        self.assertEqual(user.first_name, 'Grete')
        self.assertLoggedInAs(user)

        identity = SocialAccount.objects.get(user=user)
        self.assertEqual(identity.provider, 'google')
        self.assertEqual(identity.uid, 'google-sub-1')
        self.assertTrue(
            EmailAddress.objects.filter(user=user, email='user@example.com', verified=True).exists()
        )

    def test_google_signup_records_terms_consent(self) -> None:
        self.complete_login('google', google_claims())

        user = User.objects.get(email='user@example.com')
        consent = DocumentConsent.objects.get(user=user, document=DocumentConsent.DOCUMENT_TERMS)
        self.assertEqual(consent.version, CURRENT_VERSIONS[DocumentConsent.DOCUMENT_TERMS])

    def test_microsoft_login_without_existing_account_is_rejected_as_unverified(self) -> None:
        # Microsoft asserts no verification state for its email claim, so it
        # must not be trusted to create a brand-new account either — the same
        # "nOAuth" concern that already blocks it from auto-linking to an
        # *existing* account (test_microsoft_email_never_links_automatically).
        # Without this, anyone able to set an arbitrary `mail` attribute on a
        # self-service Entra tenant could sign in as, and permanently
        # pre-empt, someone else's address.
        response = self.complete_login('microsoft', microsoft_profile())

        self.assertRedirectsToFrontend(response, '/login', {'social_error': 'unverified_email'})
        self.assertFalse(User.objects.exists())
        self.assertFalse(SocialAccount.objects.exists())
        self.assertNotLoggedIn()

    def test_google_login_without_existing_account_and_unverified_email_is_rejected(self) -> None:
        # Applies to any provider, not just Microsoft: an unverified email
        # claim must never be trusted to create a new account.
        response = self.complete_login('google', google_claims(email_verified=False))

        self.assertRedirectsToFrontend(response, '/login', {'social_error': 'unverified_email'})
        self.assertFalse(User.objects.exists())
        self.assertFalse(SocialAccount.objects.exists())

    def test_google_login_without_email_is_rejected(self) -> None:
        response = self.complete_login('google', google_claims(email=None))

        self.assertRedirectsToFrontend(response, '/login', {'social_error': 'missing_email'})
        self.assertFalse(User.objects.exists())
        self.assertNotLoggedIn()

    def test_microsoft_login_without_email_is_rejected(self) -> None:
        response = self.complete_login('microsoft', microsoft_profile(mail=None))

        self.assertRedirectsToFrontend(response, '/login', {'social_error': 'missing_email'})
        self.assertFalse(User.objects.exists())

    def test_repeated_google_login_reuses_the_same_account(self) -> None:
        self.complete_login('google', google_claims())
        self.client.logout()
        self.complete_login('google', google_claims())

        self.assertEqual(User.objects.count(), 1)
        self.assertEqual(SocialAccount.objects.count(), 1)

    def test_known_google_identity_logs_in_without_creating_an_account(self) -> None:
        user = User.objects.create_user(
            username='known', email='known@example.com', is_active=True
        )
        SocialAccount.objects.create(
            user=user, provider='google', uid='google-sub-1', extra_data={}
        )

        response = self.complete_login('google', google_claims(email='other@example.com'))

        self.assertRedirectsToFrontend(response, '/app')
        self.assertEqual(User.objects.count(), 1)
        self.assertLoggedInAs(user)

    def test_known_microsoft_identity_logs_in_without_creating_an_account(self) -> None:
        user = User.objects.create_user(
            username='known', email='known@example.com', is_active=True
        )
        SocialAccount.objects.create(
            user=user, provider='microsoft', uid='microsoft-oid-1', extra_data={}
        )

        response = self.complete_login('microsoft', microsoft_profile(mail='other@example.com'))

        self.assertRedirectsToFrontend(response, '/app')
        self.assertEqual(User.objects.count(), 1)
        self.assertLoggedInAs(user)


class SocialAccountLinkingTest(SocialLoginTestCase):
    def _create_password_user(
        self,
        *,
        email: str = 'user@example.com',
        is_active: bool = True,
    ) -> User:
        user = User.objects.create_user(
            username='existing',
            email=email,
            password='safe-password-123',
            is_active=is_active,
        )
        return user

    def test_verified_google_email_links_to_existing_password_account(self) -> None:
        user = self._create_password_user()

        response = self.complete_login('google', google_claims())

        self.assertRedirectsToFrontend(response, '/app')
        self.assertEqual(User.objects.count(), 1)
        self.assertLoggedInAs(user)
        self.assertTrue(SocialAccount.objects.filter(user=user, provider='google').exists())

    def test_password_login_still_works_after_linking_google(self) -> None:
        user = self._create_password_user()
        self.complete_login('google', google_claims())
        self.client.logout()

        response = self.client.post(
            '/api/auth/login/',
            {'email': 'user@example.com', 'password': 'safe-password-123'},
            content_type='application/json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertLoggedInAs(user)

    def test_unverified_google_email_does_not_link_to_existing_account(self) -> None:
        self._create_password_user()

        response = self.complete_login('google', google_claims(email_verified=False))

        self.assertRedirectsToFrontend(response, '/login', {'social_error': 'email_conflict'})
        self.assertEqual(User.objects.count(), 1)
        self.assertFalse(SocialAccount.objects.exists())
        self.assertNotLoggedIn()

    def test_microsoft_email_never_links_automatically(self) -> None:
        self._create_password_user()

        response = self.complete_login('microsoft', microsoft_profile())

        self.assertRedirectsToFrontend(response, '/login', {'social_error': 'email_conflict'})
        self.assertEqual(User.objects.count(), 1)
        self.assertFalse(SocialAccount.objects.exists())

    def test_google_does_not_link_to_an_account_without_a_verified_email(self) -> None:
        # An account can end up without any verified-email proof if it was
        # created outside the normal flows (e.g. directly via the admin, or
        # a data migration). Even then, a Google login for the same address
        # must not be handed that account.
        user = User.objects.create_user(
            username='unverified', email='user@example.com', is_active=True
        )
        user.set_unusable_password()
        user.save(update_fields=['password'])

        response = self.complete_login('google', google_claims())

        self.assertRedirectsToFrontend(response, '/login', {'social_error': 'email_conflict'})
        self.assertEqual(User.objects.count(), 1)
        self.assertFalse(SocialAccount.objects.filter(user=user).exists())

    def test_login_is_rejected_for_account_pending_deletion(self) -> None:
        user = self._create_password_user()
        AccountDeletionRequest.objects.create(
            user=user,
            deletion_requested_at=timezone.now(),
            scheduled_deletion_at=timezone.now() + timedelta(days=14),
        )

        response = self.complete_login('google', google_claims())

        self.assertRedirectsToFrontend(
            response, '/login', {'social_error': 'account_pending_deletion'}
        )
        self.assertNotLoggedIn()

    def test_login_is_rejected_for_unactivated_account_with_same_email(self) -> None:
        self._create_password_user(is_active=False)

        response = self.complete_login('google', google_claims())

        self.assertRedirectsToFrontend(response, '/login', {'social_error': 'account_inactive'})
        self.assertFalse(SocialAccount.objects.exists())
        self.assertNotLoggedIn()

    def test_confirmed_email_change_keeps_linking_possible(self) -> None:
        user = User.objects.create_user(
            username='social', email='old@example.com', is_active=True
        )
        SocialAccount.objects.create(
            user=user, provider='microsoft', uid='microsoft-oid-1', extra_data={}
        )
        EmailAddress.objects.create(
            user=user, email='old@example.com', verified=False, primary=True
        )

        from accounts.services import record_verified_email

        user.email = 'user@example.com'
        user.save(update_fields=['email'])
        record_verified_email(user, user.email)

        response = self.complete_login('google', google_claims())

        self.assertRedirectsToFrontend(response, '/app')
        self.assertEqual(User.objects.count(), 1)
        self.assertEqual(SocialAccount.objects.filter(user=user).count(), 2)


class SocialConnectFlowTest(SocialLoginTestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(
            username='existing',
            email='user@example.com',
            password='safe-password-123',
            is_active=True,
        )

    def test_google_and_microsoft_can_be_connected_to_the_same_account(self) -> None:
        self.client.force_login(self.user)

        google_response = self.complete_login('google', google_claims(), process='connect')
        microsoft_response = self.complete_login(
            'microsoft', microsoft_profile(), process='connect'
        )

        self.assertRedirectsToFrontend(
            google_response, '/app/account-settings', {'social_status': 'connected'}
        )
        self.assertRedirectsToFrontend(
            microsoft_response, '/app/account-settings', {'social_status': 'connected'}
        )
        self.assertEqual(User.objects.count(), 1)
        self.assertEqual(
            sorted(SocialAccount.objects.filter(user=self.user).values_list('provider', flat=True)),
            ['google', 'microsoft'],
        )

    def test_connecting_an_identity_owned_by_another_account_is_rejected(self) -> None:
        other = User.objects.create_user(
            username='other', email='other@example.com', is_active=True
        )
        SocialAccount.objects.create(
            user=other, provider='google', uid='google-sub-1', extra_data={}
        )
        self.client.force_login(self.user)

        response = self.complete_login('google', google_claims(), process='connect')

        self.assertRedirectsToFrontend(
            response, '/app/account-settings', {'social_error': 'identity_already_linked'}
        )
        self.assertFalse(SocialAccount.objects.filter(user=self.user).exists())

    def test_connecting_from_a_guest_demo_session_is_rejected(self) -> None:
        from accounts.guest_demo import create_guest_demo_session

        demo_session = create_guest_demo_session()
        self.client.force_login(demo_session.user)

        response = self.complete_login('google', google_claims(), process='connect')

        self.assertRedirectsToFrontend(
            response, '/app/account-settings', {'social_error': 'login_required'}
        )
        self.assertFalse(SocialAccount.objects.filter(user=demo_session.user).exists())

    def test_connecting_without_a_session_is_rejected(self) -> None:
        response = self.complete_login('google', google_claims(), process='connect')

        self.assertRedirectsToFrontend(
            response, '/app/account-settings', {'social_error': 'login_required'}
        )
        self.assertFalse(SocialAccount.objects.exists())


class SocialLoginErrorTest(SocialLoginTestCase):
    def test_unknown_state_is_rejected(self) -> None:
        response = self.client.get(
            reverse('google_callback'),
            {'code': 'test-code', 'state': 'not-a-known-state'},
        )

        self.assertRedirectsToFrontend(response, '/login', {'social_error': 'invalid_state'})
        self.assertFalse(User.objects.exists())

    def test_cancelled_login_is_reported_as_cancelled(self) -> None:
        state = self.start_login('google')

        response = self.client.get(
            reverse('google_callback'),
            {'error': 'access_denied', 'state': state},
        )

        self.assertRedirectsToFrontend(response, '/login', {'social_error': 'cancelled'})

    def test_provider_error_is_reported(self) -> None:
        state = self.start_login('google')

        response = self.client.get(
            reverse('google_callback'),
            {'error': 'server_error', 'state': state},
        )

        self.assertRedirectsToFrontend(response, '/login', {'social_error': 'provider_error'})

    def test_invalid_provider_response_is_reported(self) -> None:
        from allauth.socialaccount.providers.oauth2.client import OAuth2Error

        state = self.start_login('google')
        with patch.object(
            OpenFarmPlannerGoogleOAuth2Adapter,
            'get_access_token_data',
            side_effect=OAuth2Error('Invalid id_token'),
        ):
            response = self.client.get(
                reverse('google_callback'),
                {'code': 'test-code', 'state': state},
            )

        self.assertRedirectsToFrontend(response, '/login', {'social_error': 'invalid_response'})
        self.assertFalse(User.objects.exists())

    def test_login_cannot_be_started_with_a_get_request(self) -> None:
        response = self.client.get(reverse('google_login'))

        self.assertRedirectsToFrontend(response, '/login', {'social_error': 'provider_error'})

    def test_login_requires_a_csrf_token(self) -> None:
        csrf_client = Client(enforce_csrf_checks=True)

        response = csrf_client.post(reverse('google_login'))

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_redirect_uri_uses_the_configured_public_base_url(self) -> None:
        response = self.client.post(reverse('google_login'))

        redirect_uri = parse_qs(urlparse(response['Location']).query)['redirect_uri'][0]
        self.assertEqual(
            redirect_uri,
            f'{FRONTEND_URL}/api/auth/social/google/login/callback/',
        )

    def test_callback_base_url_strips_a_path_component(self) -> None:
        # Subpath deployments (URL_PREFIX) configure PUBLIC_FRONTEND_URL /
        # SOCIAL_AUTH_CALLBACK_BASE_URL with a path, e.g.
        # "https://host/openfarmplanner" — which is the same segment
        # reverse() already bakes into the route via URL_PREFIX. Keeping
        # that path here would double it into the redirect URI actually
        # registered with Google/Microsoft (observed in production as
        # ".../openfarmplanner/openfarmplanner/api/auth/social/...").
        with override_settings(
            SOCIAL_AUTH_CALLBACK_BASE_URL='https://host.example/openfarmplanner'
        ):
            self.assertEqual(social_callback_base_url(), 'https://host.example')

    @override_settings(SOCIALACCOUNT_PROVIDERS={'google': {'APPS': []}, 'microsoft': {'APPS': []}})
    def test_login_for_unconfigured_provider_is_not_available(self) -> None:
        response = self.client.post(reverse('google_login'))

        self.assertRedirectsToFrontend(response, '/login', {'social_error': 'provider_error'})


class SocialApiEndpointTest(SocialLoginTestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(
            username='existing',
            email='user@example.com',
            password='safe-password-123',
            is_active=True,
        )

    def test_providers_endpoint_lists_configured_providers(self) -> None:
        response = self.client.get('/api/auth/social/providers/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.json(),
            [
                {
                    'id': 'google',
                    'name': 'Google',
                    'login_url': '/api/auth/social/google/login/',
                },
                {
                    'id': 'microsoft',
                    'name': 'Microsoft',
                    'login_url': '/api/auth/social/microsoft/login/',
                },
            ],
        )

    @override_settings(
        SOCIALACCOUNT_PROVIDERS={
            'google': SOCIAL_PROVIDER_SETTINGS['google'],
            'microsoft': {'APPS': []},
        }
    )
    def test_providers_endpoint_hides_unconfigured_providers(self) -> None:
        response = self.client.get('/api/auth/social/providers/')

        self.assertEqual([provider['id'] for provider in response.json()], ['google'])

    def test_connections_endpoint_lists_linked_identities(self) -> None:
        SocialAccount.objects.create(
            user=self.user,
            provider='google',
            uid='g-1',
            extra_data={'email': 'google-user@example.com'},
        )
        self.client.force_login(self.user)

        response = self.client.get('/api/auth/social/connections/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        connections = response.json()
        self.assertEqual(len(connections), 1)
        self.assertEqual(connections[0]['provider'], 'google')
        self.assertEqual(connections[0]['provider_name'], 'Google')
        self.assertEqual(connections[0]['email'], 'google-user@example.com')
        self.assertTrue(connections[0]['can_disconnect'])
        self.assertNotIn('uid', connections[0])

    def test_connections_endpoint_requires_authentication(self) -> None:
        response = self.client.get('/api/auth/social/connections/')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_disconnect_removes_the_identity(self) -> None:
        identity = SocialAccount.objects.create(
            user=self.user, provider='google', uid='g-1', extra_data={}
        )
        self.client.force_login(self.user)

        response = self.client.post(
            '/api/auth/social/disconnect/',
            {'id': identity.pk},
            content_type='application/json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(SocialAccount.objects.filter(pk=identity.pk).exists())

    def test_disconnect_is_rejected_for_the_last_login_method(self) -> None:
        social_only_user = User.objects.create_user(
            username='social-only', email='social@example.com', is_active=True
        )
        social_only_user.set_unusable_password()
        social_only_user.save(update_fields=['password'])
        identity = SocialAccount.objects.create(
            user=social_only_user, provider='google', uid='g-2', extra_data={}
        )
        self.client.force_login(social_only_user)

        response = self.client.post(
            '/api/auth/social/disconnect/',
            {'id': identity.pk},
            content_type='application/json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.json()['code'], 'last_login_method')
        self.assertTrue(SocialAccount.objects.filter(pk=identity.pk).exists())

    def test_disconnect_ignores_identities_of_other_accounts(self) -> None:
        other = User.objects.create_user(
            username='other', email='other@example.com', is_active=True
        )
        identity = SocialAccount.objects.create(
            user=other, provider='google', uid='g-3', extra_data={}
        )
        self.client.force_login(self.user)

        response = self.client.post(
            '/api/auth/social/disconnect/',
            {'id': identity.pk},
            content_type='application/json',
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(response.json()['code'], 'social_account_not_found')
        self.assertIn('detail', response.json())
        self.assertTrue(SocialAccount.objects.filter(pk=identity.pk).exists())


class SocialAccountDeletionTest(SocialLoginTestCase):
    def test_account_deletion_removes_provider_identities(self) -> None:
        user = User.objects.create_user(
            username='social', email='user@example.com', is_active=True
        )
        SocialAccount.objects.create(user=user, provider='google', uid='g-1', extra_data={})
        EmailAddress.objects.create(
            user=user, email='user@example.com', verified=True, primary=True
        )
        deletion = AccountDeletionRequest.objects.create(
            user=user,
            deletion_requested_at=timezone.now(),
            scheduled_deletion_at=timezone.now(),
        )

        finalize_account_deletion(deletion=deletion)

        self.assertFalse(SocialAccount.objects.filter(user=user).exists())
        self.assertFalse(EmailAddress.objects.filter(user=user).exists())

    def test_social_only_account_can_be_deleted_without_a_password(self) -> None:
        user = User.objects.create_user(
            username='social', email='user@example.com', is_active=True
        )
        user.set_unusable_password()
        user.save(update_fields=['password'])
        SocialAccount.objects.create(user=user, provider='google', uid='g-1', extra_data={})
        self.client.force_login(user)

        response = self.client.post(
            '/api/auth/account/delete-request/',
            {},
            content_type='application/json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(AccountDeletionRequest.objects.get(user=user).is_pending)

    def test_password_account_still_needs_its_password_to_be_deleted(self) -> None:
        user = User.objects.create_user(
            username='pw', email='pw@example.com', password='safe-password-123', is_active=True
        )
        self.client.force_login(user)

        response = self.client.post(
            '/api/auth/account/delete-request/',
            {'password': 'wrong-password'},
            content_type='application/json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(AccountDeletionRequest.objects.filter(user=user).exists())


class RecordVerifiedEmailTest(TestCase):
    def test_conflicting_verified_address_does_not_break_the_request(self) -> None:
        from accounts.services import record_verified_email

        owner = User.objects.create_user(
            username='owner', email='shared@example.com', is_active=True
        )
        EmailAddress.objects.create(
            user=owner, email='shared@example.com', verified=True, primary=True
        )
        other = User.objects.create_user(
            username='other', email='other@example.com', is_active=True
        )

        record_verified_email(other, 'shared@example.com')

        # The record is skipped rather than stolen, and the connection stays usable.
        self.assertFalse(EmailAddress.objects.filter(user=other).exists())
        self.assertTrue(User.objects.filter(pk=other.pk).exists())
