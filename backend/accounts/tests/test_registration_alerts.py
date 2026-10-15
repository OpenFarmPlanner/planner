from __future__ import annotations

import smtplib
from io import StringIO
from unittest.mock import MagicMock, patch

import requests
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.core.checks import run_checks
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.registration_alerts import (
    MISSING_TOKEN_THRESHOLD,
    SUBJECT_PREFIX,
    RegistrationFailure,
    mask_email,
    record_missing_turnstile_token,
    report_registration_failure,
    scrub_sensitive_text,
)
from accounts.throttling import ClientErrorReportGlobalRateThrottle, ClientErrorReportIpRateThrottle

User = get_user_model()

REGISTER_URL = '/openfarmplanner/api/auth/register/'
RESEND_URL = '/openfarmplanner/api/auth/resend-activation/'
LOGIN_URL = '/openfarmplanner/api/auth/login/'
CLIENT_ERROR_URL = '/openfarmplanner/api/client-errors/turnstile/'
ALERT_RECIPIENT = 'ops@example.org'
ALERT_SETTINGS = {
    'REGISTRATION_ALERT_EMAILS': [ALERT_RECIPIENT],
    'DEPLOYMENT_ENVIRONMENT': 'staging',
}
TURNSTILE_SETTINGS = {
    'TURNSTILE_SITE_KEY': '0x4AAAAAAexpected',
    'TURNSTILE_SECRET_KEY': 'secret-key-value',
}
REGISTRATION_PAYLOAD = {
    'email': 'martin@gmx.at',
    'password': 'Very-Secret-Pass-123!',
    'password_confirm': 'Very-Secret-Pass-123!',
    'display_name': 'Martin',
    'turnstile_token': 'cf-token-value',
}


def _siteverify_response(payload: object) -> MagicMock:
    response = MagicMock()
    response.json.return_value = payload
    response.raise_for_status.return_value = None
    return response


def _alert_mails() -> list[mail.EmailMessage]:
    return [message for message in mail.outbox if message.subject.startswith(SUBJECT_PREFIX)]


class AlertTestMixin:
    def setUp(self) -> None:
        super().setUp()  # type: ignore[misc]
        cache.clear()


@override_settings(**ALERT_SETTINGS)
class ReportRegistrationFailureTest(AlertTestMixin, TestCase):
    def test_alert_contains_context_and_is_logged(self) -> None:
        with self.assertLogs('accounts.registration_alerts', level='ERROR') as logs:
            try:
                raise RuntimeError('database exploded')
            except RuntimeError as exc:
                report_registration_failure(RegistrationFailure.SERVER_ERROR, exc=exc)

        [message] = _alert_mails()
        self.assertEqual(message.subject, f'{SUBJECT_PREFIX}: server_error')
        self.assertEqual(message.to, [ALERT_RECIPIENT])
        self.assertIn('Environment: staging', message.body)
        self.assertIn('Exception: RuntimeError', message.body)
        self.assertIn('Message: database exploded', message.body)
        self.assertIn('Traceback:', message.body)
        self.assertIn('server_error', logs.output[0])

    def test_alerts_are_throttled_per_type_and_count_suppressed_failures(self) -> None:
        with self.assertLogs('accounts.registration_alerts', level='ERROR') as logs:
            for _ in range(3):
                report_registration_failure(RegistrationFailure.TURNSTILE_UNREACHABLE)
            report_registration_failure(RegistrationFailure.SERVER_ERROR)

        self.assertEqual(len(logs.output), 4, 'every failure is logged, even during the cooldown')
        self.assertEqual(
            sorted(message.subject for message in _alert_mails()),
            [f'{SUBJECT_PREFIX}: server_error', f'{SUBJECT_PREFIX}: turnstile_unreachable'],
        )

        # The cooldown ends: the next alert of that type carries the count.
        cache.delete('registration_alert:cooldown:turnstile_unreachable')
        mail.outbox.clear()
        with self.assertLogs('accounts.registration_alerts', level='ERROR'):
            report_registration_failure(RegistrationFailure.TURNSTILE_UNREACHABLE)
        [message] = _alert_mails()
        self.assertIn('suppressed since the previous alert of this type: 2', message.body)

    @override_settings(REGISTRATION_ALERT_EMAILS=[])
    def test_no_recipients_only_logs(self) -> None:
        with self.assertLogs('accounts.registration_alerts', level='ERROR'):
            report_registration_failure(RegistrationFailure.SERVER_ERROR)
        self.assertEqual(mail.outbox, [])

    @patch('accounts.registration_alerts.send_mail', side_effect=smtplib.SMTPException('down'))
    def test_failure_to_send_the_alert_is_swallowed(self, _send_mail: MagicMock) -> None:
        with self.assertLogs('accounts.registration_alerts', level='ERROR') as logs:
            report_registration_failure(RegistrationFailure.SERVER_ERROR)
        self.assertTrue(
            any('Failed to send registration failure alert' in line for line in logs.output)
        )

    def test_sensitive_data_is_masked_in_body_and_log(self) -> None:
        exc = smtplib.SMTPRecipientsRefused({'martin@gmx.at': (550, b'rejected by 203.0.113.9')})
        with self.assertLogs('accounts.registration_alerts', level='ERROR') as logs:
            report_registration_failure(
                RegistrationFailure.VERIFICATION_EMAIL,
                exc=exc,
                email='martin@gmx.at',
                details={'Peer': 'connect to 2001:db8::1 failed'},
            )

        [message] = _alert_mails()
        for text in (message.body, logs.output[0]):
            self.assertNotIn('martin@gmx.at', text)
            self.assertNotIn('203.0.113.9', text)
            self.assertNotIn('2001:db8::1', text)
            self.assertIn('ma***@gmx.at', text)


class MaskingHelpersTest(SimpleTestCase):
    def test_mask_email(self) -> None:
        self.assertEqual(mask_email('martin@gmx.at'), 'ma***@gmx.at')
        self.assertEqual(mask_email('not-an-address'), '***')

    def test_scrub_keeps_clock_times(self) -> None:
        self.assertEqual(scrub_sensitive_text('at 12:30:45'), 'at 12:30:45')
        self.assertEqual(scrub_sensitive_text('from 10.0.0.1'), 'from [IP removed]')


@override_settings(**ALERT_SETTINGS)
class RegistrationFlowAlertTest(AlertTestMixin, APITestCase):
    def test_unexpected_exception_triggers_server_error_alert(self) -> None:
        self.client.raise_request_exception = False
        with patch('accounts.views.RegisterSerializer', side_effect=RuntimeError('boom')):
            with self.assertLogs('accounts.registration_alerts', level='ERROR'):
                response = self.client.post(REGISTER_URL, REGISTRATION_PAYLOAD, format='json')

        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)
        [message] = _alert_mails()
        self.assertEqual(message.subject, f'{SUBJECT_PREFIX}: server_error')
        self.assertIn(f'Request: POST {REGISTER_URL}', message.body)
        self.assertIn('Exception: RuntimeError', message.body)

    def test_failed_verification_email_triggers_alert(self) -> None:
        with patch('accounts.emails.send_mail', side_effect=smtplib.SMTPException('auth failed')):
            with self.assertLogs('accounts', level='ERROR'):
                response = self.client.post(REGISTER_URL, REGISTRATION_PAYLOAD, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['code'], 'email_send_failed')
        [message] = _alert_mails()
        self.assertEqual(message.subject, f'{SUBJECT_PREFIX}: verification_email')
        self.assertIn('Exception: SMTPException', message.body)
        self.assertIn('Email (masked): ma***@gmx.at', message.body)

    def test_failed_activation_resend_triggers_alert_once(self) -> None:
        User.objects.create_user(
            username='pending', email='martin@gmx.at', password='x', is_active=False
        )
        with patch('accounts.emails.send_mail', side_effect=TimeoutError('smtp timeout')):
            with self.assertLogs('accounts', level='ERROR'):
                response = self.client.post(RESEND_URL, {'email': 'martin@gmx.at'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(
            [message.subject for message in _alert_mails()],
            [f'{SUBJECT_PREFIX}: verification_email'],
            'the 503 must not raise a second server_error alert',
        )

    def test_validation_errors_do_not_alert(self) -> None:
        User.objects.create_user(username='taken', email='taken@example.org', password='x')
        cases = [
            {**REGISTRATION_PAYLOAD, 'password': 'short', 'password_confirm': 'short'},
            {**REGISTRATION_PAYLOAD, 'email': 'taken@example.org'},
            {**REGISTRATION_PAYLOAD, 'email': 'not-an-email'},
        ]
        for payload in cases:
            response = self.client.post(REGISTER_URL, payload, format='json')
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, payload)
        self.assertEqual(_alert_mails(), [])

    def test_throttled_request_does_not_alert(self) -> None:
        with patch('accounts.views.registration_ip_limit_exceeded', return_value=True):
            response = self.client.post(REGISTER_URL, REGISTRATION_PAYLOAD, format='json')
        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(_alert_mails(), [])


@override_settings(**ALERT_SETTINGS, **TURNSTILE_SETTINGS)
class TurnstileServerAlertTest(AlertTestMixin, APITestCase):
    def _register_with_siteverify(self, mocked_post: MagicMock, payload: object) -> int:
        mocked_post.return_value = _siteverify_response(payload)
        return self.client.post(REGISTER_URL, REGISTRATION_PAYLOAD, format='json').status_code

    @patch('accounts.turnstile.requests.post')
    def test_user_side_codes_do_not_alert(self, mocked_post: MagicMock) -> None:
        for code in ('invalid-input-response', 'timeout-or-duplicate', 'missing-input-response'):
            with self.assertLogs('accounts.turnstile', level='WARNING'):
                status_code = self._register_with_siteverify(
                    mocked_post, {'success': False, 'error-codes': [code]}
                )
            self.assertEqual(status_code, status.HTTP_400_BAD_REQUEST, code)
        self.assertEqual(_alert_mails(), [])

    @patch('accounts.turnstile.requests.post')
    def test_configuration_codes_alert_as_server_config(self, mocked_post: MagicMock) -> None:
        for code in ('invalid-input-secret', 'missing-input-secret', 'bad-request'):
            cache.clear()
            mail.outbox.clear()
            with self.assertLogs('accounts', level='ERROR'):
                status_code = self._register_with_siteverify(
                    mocked_post, {'success': False, 'error-codes': [code]}
                )
            self.assertEqual(status_code, status.HTTP_503_SERVICE_UNAVAILABLE, code)
            [message] = _alert_mails()
            self.assertEqual(message.subject, f'{SUBJECT_PREFIX}: turnstile_server_config')
            self.assertIn(code, message.body)
            self.assertIn('Expected site key (backend): 0x4AAAAAAexpected', message.body)
            self.assertNotIn('secret-key-value', message.body)
            self.assertNotIn('cf-token-value', message.body)

    @patch('accounts.turnstile.requests.post')
    def test_cloudflare_internal_error_alerts_as_unreachable(self, mocked_post: MagicMock) -> None:
        with self.assertLogs('accounts', level='ERROR'):
            status_code = self._register_with_siteverify(
                mocked_post, {'success': False, 'error-codes': ['internal-error']}
            )
        self.assertEqual(status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(
            [m.subject for m in _alert_mails()], [f'{SUBJECT_PREFIX}: turnstile_unreachable']
        )

    @patch('accounts.turnstile.requests.post', side_effect=requests.Timeout('slow'))
    def test_timeout_alerts_as_unreachable(self, _mocked_post: MagicMock) -> None:
        with self.assertLogs('accounts', level='ERROR'):
            response = self.client.post(REGISTER_URL, REGISTRATION_PAYLOAD, format='json')
        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        [message] = _alert_mails()
        self.assertEqual(message.subject, f'{SUBJECT_PREFIX}: turnstile_unreachable')
        self.assertIn('Exception: Timeout', message.body)

    @patch('accounts.turnstile.requests.post')
    def test_missing_tokens_alert_only_above_threshold(self, mocked_post: MagicMock) -> None:
        payload = {**REGISTRATION_PAYLOAD, 'turnstile_token': ''}
        with self.assertLogs('accounts.turnstile', level='WARNING'):
            for _ in range(MISSING_TOKEN_THRESHOLD):
                self.client.post(REGISTER_URL, payload, format='json')
        self.assertEqual(_alert_mails(), [])

        with self.assertLogs('accounts', level='ERROR'):
            response = self.client.post(REGISTER_URL, payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        [message] = _alert_mails()
        self.assertEqual(message.subject, f'{SUBJECT_PREFIX}: turnstile_missing_token')
        self.assertIn(
            'Registrations without Turnstile token in the last 15 minutes: 6', message.body
        )
        mocked_post.assert_not_called()

    def test_missing_tokens_outside_the_window_are_forgotten(self) -> None:
        for offset in range(MISSING_TOKEN_THRESHOLD):
            record_missing_turnstile_token(now=1000.0 + offset)
        record_missing_turnstile_token(now=1000.0 + 16 * 60)
        self.assertEqual(_alert_mails(), [])


@override_settings(**ALERT_SETTINGS, **TURNSTILE_SETTINGS)
class TurnstileClientErrorEndpointTest(AlertTestMixin, APITestCase):
    def _report(self, **overrides: str) -> int:
        payload = {
            'error_code': '110200',
            'page_path': '/register?next=/invite&token=secret',
            'hostname': 'staging.openfarmplanner.org',
            'site_key': '0x4AAAAAAwrong',
            **overrides,
        }
        return self.client.post(CLIENT_ERROR_URL, payload, format='json').status_code

    def test_configuration_code_triggers_alert_with_both_site_keys(self) -> None:
        with self.assertLogs('accounts.registration_alerts', level='ERROR'):
            self.assertEqual(self._report(), status.HTTP_204_NO_CONTENT)

        [message] = _alert_mails()
        self.assertEqual(message.subject, f'{SUBJECT_PREFIX}: turnstile_client_config')
        self.assertIn('Widget error code: 110200', message.body)
        self.assertIn('Hostname: staging.openfarmplanner.org', message.body)
        self.assertIn('Site key reported by the client: 0x4AAAAAAwrong', message.body)
        self.assertIn('Expected site key (backend): 0x4AAAAAAexpected', message.body)
        self.assertIn('Page path: /register\n', message.body)
        self.assertNotIn('token=secret', message.body)

    def test_every_documented_configuration_code_is_accepted(self) -> None:
        for code in ('110100', '110110', '110200', '400020', '400021', '400070'):
            with self.assertLogs('accounts.registration_alerts', level='ERROR'):
                self.assertEqual(self._report(error_code=code), status.HTTP_204_NO_CONTENT, code)

    def test_non_allowlisted_codes_are_rejected_without_alert(self) -> None:
        for code in ('110600', '300010', '600010', '200500', 'arbitrary text'):
            self.assertEqual(self._report(error_code=code), status.HTTP_400_BAD_REQUEST, code)
        self.assertEqual(self._report(hostname='evil host<script>'), status.HTTP_400_BAD_REQUEST)
        self.assertEqual(_alert_mails(), [])

    def test_endpoint_is_rate_limited_per_ip(self) -> None:
        with patch.object(ClientErrorReportIpRateThrottle, 'rate', '2/hour', create=True):
            with self.assertLogs('accounts.registration_alerts', level='ERROR'):
                statuses = [self._report() for _ in range(3)]
        self.assertEqual(statuses[:2], [status.HTTP_204_NO_CONTENT] * 2)
        self.assertEqual(statuses[2], status.HTTP_429_TOO_MANY_REQUESTS)

    def test_endpoint_is_rate_limited_globally_across_ips(self) -> None:
        with patch.object(ClientErrorReportGlobalRateThrottle, 'rate', '2/hour', create=True):
            with self.assertLogs('accounts.registration_alerts', level='ERROR'):
                statuses = [
                    self.client.post(
                        CLIENT_ERROR_URL,
                        {'error_code': '110100'},
                        format='json',
                        REMOTE_ADDR=f'198.51.100.{index}',
                    ).status_code
                    for index in range(1, 4)
                ]
        self.assertEqual(statuses, [204, 204, 429])


@override_settings(**ALERT_SETTINGS, ADMINS=[('ops', 'admins@example.org')])
class AdminEmailDeduplicationTest(AlertTestMixin, APITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.client.raise_request_exception = False

    def test_registration_exception_sends_only_the_registration_alert(self) -> None:
        # No assertLogs here: it would stop the record from propagating to the
        # 'django' logger, where AdminEmailHandler is attached.
        with patch('accounts.views.RegisterSerializer', side_effect=RuntimeError('boom')):
            response = self.client.post(REGISTER_URL, REGISTRATION_PAYLOAD, format='json')

        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)

        self.assertEqual([message.to for message in mail.outbox], [[ALERT_RECIPIENT]])

    def test_exception_elsewhere_still_reaches_admins(self) -> None:
        with patch('accounts.views.LoginSerializer', side_effect=RuntimeError('boom')):
            response = self.client.post(
                LOGIN_URL, {'email': 'a@example.org', 'password': 'x'}, format='json'
            )

        self.assertEqual(response.status_code, status.HTTP_500_INTERNAL_SERVER_ERROR)

        self.assertEqual([message.to for message in mail.outbox], [['admins@example.org']])


class SendTestRegistrationAlertCommandTest(AlertTestMixin, TestCase):
    @override_settings(**ALERT_SETTINGS)
    def test_sends_marked_alert_of_the_chosen_type_despite_cooldown(self) -> None:
        with self.assertLogs('accounts.registration_alerts', level='ERROR'):
            report_registration_failure(RegistrationFailure.TURNSTILE_CLIENT_CONFIG)
        mail.outbox.clear()

        out = StringIO()
        call_command(
            'send_test_registration_alert', '--type', 'turnstile_client_config', stdout=out
        )

        [message] = mail.outbox
        self.assertEqual(message.subject, f'{SUBJECT_PREFIX}: turnstile_client_config (TEST)')
        self.assertIn('send_test_registration_alert', message.body)
        self.assertIn(ALERT_RECIPIENT, out.getvalue())

    @override_settings(REGISTRATION_ALERT_EMAILS=[])
    def test_fails_without_recipients(self) -> None:
        with self.assertRaises(CommandError):
            call_command('send_test_registration_alert')


class RegistrationAlertSystemCheckTest(SimpleTestCase):
    def _warning_ids(self) -> set[str]:
        return {message.id for message in run_checks()}

    @override_settings(DJANGO_ENV='production', TURNSTILE_SITE_KEY='', TURNSTILE_SECRET_KEY='')
    def test_missing_keys_warn_outside_local_development(self) -> None:
        self.assertIn('accounts.I001', self._warning_ids())

    @override_settings(
        DJANGO_ENV='production',
        TURNSTILE_SITE_KEY='1x00000000000000000000AA',
        TURNSTILE_SECRET_KEY='1x0000000000000000000000000000000AA',
    )
    def test_test_keys_warn_outside_local_development(self) -> None:
        self.assertIn('accounts.W004', self._warning_ids())

    @override_settings(DJANGO_ENV='production', **TURNSTILE_SETTINGS, REGISTRATION_ALERT_EMAILS=[])
    def test_missing_alert_recipients_warn_outside_local_development(self) -> None:
        warning_ids = self._warning_ids()
        self.assertIn('accounts.I002', warning_ids)
        self.assertFalse({'accounts.I001', 'accounts.W004'} & warning_ids)

    @override_settings(DJANGO_ENV='test', TURNSTILE_SITE_KEY='', TURNSTILE_SECRET_KEY='')
    def test_local_development_has_no_warnings(self) -> None:
        self.assertFalse({'accounts.I001', 'accounts.W004', 'accounts.I002'} & self._warning_ids())
