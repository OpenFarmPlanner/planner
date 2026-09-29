from __future__ import annotations

from unittest.mock import MagicMock, patch

import requests
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.checks import run_checks
from django.test import SimpleTestCase, override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.turnstile import TURNSTILE_VERIFY_URL, TurnstileOutcome, verify_turnstile_token

User = get_user_model()

REGISTER_URL = '/openfarmplanner/api/auth/register/'
TURNSTILE_SETTINGS = {
    'TURNSTILE_SITE_KEY': 'site-key',
    'TURNSTILE_SECRET_KEY': 'secret-key',
}


def _siteverify_response(payload: object) -> MagicMock:
    response = MagicMock()
    response.json.return_value = payload
    response.raise_for_status.return_value = None
    return response


@override_settings(**TURNSTILE_SETTINGS)
class VerifyTurnstileTokenTest(SimpleTestCase):
    @patch('accounts.turnstile.requests.post')
    def test_successful_verification_passes_secret_token_and_ip(
        self, mocked_post: MagicMock
    ) -> None:
        mocked_post.return_value = _siteverify_response({'success': True})

        outcome = verify_turnstile_token('valid-token', '203.0.113.9')

        self.assertIs(outcome, TurnstileOutcome.PASSED)
        mocked_post.assert_called_once()
        self.assertEqual(mocked_post.call_args.args[0], TURNSTILE_VERIFY_URL)
        self.assertEqual(
            mocked_post.call_args.kwargs['data'],
            {'secret': 'secret-key', 'response': 'valid-token', 'remoteip': '203.0.113.9'},
        )
        self.assertIn('timeout', mocked_post.call_args.kwargs)

    @patch('accounts.turnstile.requests.post')
    def test_client_ip_is_optional(self, mocked_post: MagicMock) -> None:
        mocked_post.return_value = _siteverify_response({'success': True})

        verify_turnstile_token('valid-token')

        self.assertNotIn('remoteip', mocked_post.call_args.kwargs['data'])

    @patch('accounts.turnstile.requests.post')
    def test_missing_token_is_rejected_without_calling_cloudflare(
        self, mocked_post: MagicMock
    ) -> None:
        with self.assertLogs('accounts.turnstile', level='WARNING') as logs:
            outcome = verify_turnstile_token('   ')

        self.assertIs(outcome, TurnstileOutcome.REJECTED)
        mocked_post.assert_not_called()
        self.assertIn('reason=missing_token', logs.output[0])

    @patch('accounts.turnstile.requests.post')
    def test_oversized_token_is_rejected_without_calling_cloudflare(
        self, mocked_post: MagicMock
    ) -> None:
        with self.assertLogs('accounts.turnstile', level='WARNING'):
            outcome = verify_turnstile_token('x' * 5000)

        self.assertIs(outcome, TurnstileOutcome.REJECTED)
        mocked_post.assert_not_called()

    @patch('accounts.turnstile.requests.post')
    def test_invalid_token_is_rejected_and_logged_without_sensitive_data(
        self, mocked_post: MagicMock
    ) -> None:
        mocked_post.return_value = _siteverify_response(
            {'success': False, 'error-codes': ['invalid-input-response']},
        )

        with self.assertLogs('accounts.turnstile', level='WARNING') as logs:
            outcome = verify_turnstile_token('forged-token', '203.0.113.9')

        self.assertIs(outcome, TurnstileOutcome.REJECTED)
        log_line = logs.output[0]
        self.assertIn('invalid-input-response', log_line)
        self.assertNotIn('forged-token', log_line)
        self.assertNotIn('203.0.113.9', log_line)
        self.assertNotIn('secret-key', log_line)

    @patch('accounts.turnstile.requests.post')
    def test_network_error_is_reported_as_unavailable(self, mocked_post: MagicMock) -> None:
        mocked_post.side_effect = requests.ConnectionError('unreachable')

        with self.assertLogs('accounts.turnstile', level='ERROR'):
            outcome = verify_turnstile_token('valid-token')

        self.assertIs(outcome, TurnstileOutcome.UNAVAILABLE)

    @patch('accounts.turnstile.requests.post')
    def test_timeout_is_reported_as_unavailable(self, mocked_post: MagicMock) -> None:
        mocked_post.side_effect = requests.Timeout('slow')

        with self.assertLogs('accounts.turnstile', level='ERROR'):
            outcome = verify_turnstile_token('valid-token')

        self.assertIs(outcome, TurnstileOutcome.UNAVAILABLE)

    @patch('accounts.turnstile.requests.post')
    def test_http_error_is_reported_as_unavailable(self, mocked_post: MagicMock) -> None:
        response = _siteverify_response({})
        response.raise_for_status.side_effect = requests.HTTPError('502')
        mocked_post.return_value = response

        with self.assertLogs('accounts.turnstile', level='ERROR'):
            outcome = verify_turnstile_token('valid-token')

        self.assertIs(outcome, TurnstileOutcome.UNAVAILABLE)

    @patch('accounts.turnstile.requests.post')
    def test_non_json_response_is_reported_as_unavailable(self, mocked_post: MagicMock) -> None:
        response = _siteverify_response(None)
        response.json.side_effect = ValueError('not json')
        mocked_post.return_value = response

        with self.assertLogs('accounts.turnstile', level='ERROR'):
            outcome = verify_turnstile_token('valid-token')

        self.assertIs(outcome, TurnstileOutcome.UNAVAILABLE)

    @patch('accounts.turnstile.requests.post')
    def test_misconfigured_secret_is_not_blamed_on_the_visitor(
        self, mocked_post: MagicMock
    ) -> None:
        mocked_post.return_value = _siteverify_response(
            {'success': False, 'error-codes': ['invalid-input-secret']},
        )

        with self.assertLogs('accounts.turnstile', level='ERROR'):
            outcome = verify_turnstile_token('valid-token')

        self.assertIs(outcome, TurnstileOutcome.UNAVAILABLE)


@override_settings(
    EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend', **TURNSTILE_SETTINGS
)
class TurnstileRegistrationTest(APITestCase):
    def _register(self, **extra: object) -> object:
        payload: dict[str, object] = {
            'email': 'turnstile-user@example.com',
            'password': 'new-safe-password-123',
            'password_confirm': 'new-safe-password-123',
            **extra,
        }
        return self.client.post(REGISTER_URL, payload, format='json')

    @patch('accounts.turnstile.requests.post')
    def test_registration_with_valid_token_creates_account(self, mocked_post: MagicMock) -> None:
        mocked_post.return_value = _siteverify_response({'success': True})

        response = self._register(turnstile_token='valid-token')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(User.objects.filter(email='turnstile-user@example.com').exists())
        self.assertEqual(mocked_post.call_args.kwargs['data']['remoteip'], '127.0.0.1')

    @patch('accounts.turnstile.requests.post')
    def test_registration_without_token_is_rejected_with_400(self, mocked_post: MagicMock) -> None:
        with self.assertLogs('accounts.turnstile', level='WARNING'):
            response = self._register()

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.json()['code'], 'turnstile_failed')
        self.assertTrue(response.json()['detail'])
        self.assertFalse(User.objects.filter(email='turnstile-user@example.com').exists())
        self.assertEqual(len(mail.outbox), 0)
        mocked_post.assert_not_called()

    @patch('accounts.turnstile.requests.post')
    def test_non_string_token_is_rejected_with_400(self, mocked_post: MagicMock) -> None:
        with self.assertLogs('accounts.turnstile', level='WARNING'):
            response = self._register(turnstile_token={'nested': 'value'})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.json()['code'], 'turnstile_failed')
        mocked_post.assert_not_called()

    @patch('accounts.turnstile.requests.post')
    def test_registration_with_invalid_token_is_rejected_with_400(
        self, mocked_post: MagicMock
    ) -> None:
        mocked_post.return_value = _siteverify_response(
            {'success': False, 'error-codes': ['timeout-or-duplicate']},
        )

        with self.assertLogs('accounts.turnstile', level='WARNING'):
            response = self._register(turnstile_token='expired-token')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.json()['code'], 'turnstile_failed')
        self.assertFalse(User.objects.filter(email='turnstile-user@example.com').exists())

    @patch('accounts.turnstile.requests.post')
    def test_unreachable_cloudflare_returns_clean_503(self, mocked_post: MagicMock) -> None:
        mocked_post.side_effect = requests.Timeout('slow')

        with self.assertLogs('accounts.turnstile', level='ERROR'):
            response = self._register(turnstile_token='valid-token')

        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(response.json()['code'], 'turnstile_unavailable')
        self.assertFalse(User.objects.filter(email='turnstile-user@example.com').exists())

    @patch('accounts.turnstile.requests.post')
    def test_honeypot_still_short_circuits_before_turnstile(self, mocked_post: MagicMock) -> None:
        response = self._register(website='https://spam.example.com')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertFalse(User.objects.filter(email='turnstile-user@example.com').exists())
        mocked_post.assert_not_called()

    @override_settings(TURNSTILE_SECRET_KEY='')
    @patch('accounts.turnstile.requests.post')
    def test_registration_skips_turnstile_when_not_configured(self, mocked_post: MagicMock) -> None:
        response = self._register()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        mocked_post.assert_not_called()


class TurnstileSystemCheckTest(SimpleTestCase):
    def _warning_ids(self) -> set[str]:
        return {message.id for message in run_checks(tags=['security'])}

    @override_settings(TURNSTILE_SITE_KEY='', TURNSTILE_SECRET_KEY='secret-key')
    def test_secret_without_site_key_warns(self) -> None:
        self.assertIn('accounts.W001', self._warning_ids())

    @override_settings(TURNSTILE_SITE_KEY='site-key', TURNSTILE_SECRET_KEY='')
    def test_site_key_without_secret_warns(self) -> None:
        self.assertIn('accounts.W002', self._warning_ids())

    @override_settings(**TURNSTILE_SETTINGS)
    def test_complete_pair_has_no_turnstile_warning(self) -> None:
        self.assertFalse({'accounts.W001', 'accounts.W002'} & self._warning_ids())
