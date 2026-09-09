from __future__ import annotations

import json
import re
from datetime import timedelta
from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core import mail
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone
from django.utils.http import urlsafe_base64_encode
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.consent import CURRENT_VERSIONS
from accounts.models import (
    AccountDeletionRequest,
    AccountEmailChangeRequest,
    DocumentConsent,
    PendingActivation,
    PublicProfile,
)
from farm.models import Crop, Location, Project, ProjectMembership, PublicCrop

User = get_user_model()


@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend', FRONTEND_URL='http://localhost:5173')
class AuthApiTest(APITestCase):
    def setUp(self) -> None:
        self.password = 'safe-password-123'
        self.user = User.objects.create_user(
            username='demo',
            email='demo@example.com',
            password=self.password,
            is_active=True,
        )

    def test_registration_and_duplicate_prevention(self) -> None:
        response = self.client.post(
            '/openfarmplanner/api/auth/register/',
            {
                'email': 'NEW@Example.com',
                'display_name': 'New User',
                'password': 'new-safe-password-123',
                'password_confirm': 'new-safe-password-123',
                'accept_terms': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(
            response.data['detail'],
            'Registration successful. Please check your email to activate your account.',
        )
        created = User.objects.get(email='new@example.com')
        self.assertFalse(created.is_active)
        self.assertEqual(created.first_name, 'New User')
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ['new@example.com'])
        pending = PendingActivation.objects.get(user=created)
        expected = timezone.now() + timedelta(days=7)
        self.assertLess(abs((pending.activation_expires_at - expected).total_seconds()), 15)
        activation_email_body = mail.outbox[0].body
        self.assertIn('/activate?uid=', activation_email_body)
        self.assertIn('&token=', activation_email_body)
        self.assertNotIn('&amp;token=', activation_email_body)
        terms_acceptance = DocumentConsent.objects.get(user=created, document=DocumentConsent.DOCUMENT_TERMS)
        self.assertEqual(terms_acceptance.version, CURRENT_VERSIONS[DocumentConsent.DOCUMENT_TERMS])

        duplicate = self.client.post(
            '/openfarmplanner/api/auth/register/',
            {
                'email': 'new@example.com',
                'password': 'new-safe-password-123',
                'password_confirm': 'new-safe-password-123',
                'accept_terms': True,
            },
            format='json',
        )
        self.assertEqual(duplicate.status_code, status.HTTP_400_BAD_REQUEST)

    @patch('accounts.emails.send_mail', side_effect=RuntimeError('SMTP 500: trace details'))
    def test_registration_returns_safe_message_when_activation_mail_fails(self, mocked_send_mail) -> None:
        response = self.client.post(
            '/openfarmplanner/api/auth/register/',
            {
                'email': 'mail-fail@example.com',
                'password': 'new-safe-password-123',
                'password_confirm': 'new-safe-password-123',
                'accept_terms': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data.get('code'), 'email_send_failed')
        self.assertIn('Aktivierungs-E-Mail konnte nicht gesendet werden', response.data.get('message', ''))
        self.assertNotIn('SMTP 500', response.data.get('message', ''))
        self.assertTrue(User.objects.filter(email='mail-fail@example.com').exists())
        self.assertEqual(mocked_send_mail.call_count, 1)

    @override_settings(PUBLIC_FRONTEND_URL='https://zwiebelzopf.at/openfarmplanner')
    def test_activation_email_uses_public_frontend_url(self) -> None:
        response = self.client.post(
            '/openfarmplanner/api/auth/register/',
            {
                'email': 'mail-link@example.com',
                'password': 'new-safe-password-123',
                'password_confirm': 'new-safe-password-123',
                'accept_terms': True,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(mail.outbox), 1)
        activation_email_body = mail.outbox[-1].body
        self.assertIn('https://zwiebelzopf.at/openfarmplanner/activate?uid=', activation_email_body)
        self.assertNotIn('http://localhost:5173/', activation_email_body)

    def test_registration_validation_errors_are_localized_to_german(self) -> None:
        response = self.client.post(
            '/openfarmplanner/api/auth/register/',
            {
                'email': 'invalid-email',
                'password': '123',
                'password_confirm': '123',
                'accept_terms': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('email', response.data)
        self.assertIn('password', response.data)
        email_error = ' '.join(response.data['email'])
        password_error = ' '.join(response.data['password'])
        self.assertNotIn('Enter a valid email address', email_error)
        self.assertNotIn('This password is too common', password_error)
        self.assertIn('gültige', email_error.lower())
        self.assertNotIn('This password', password_error)
        self.assertTrue(any(term in password_error.lower() for term in ('mindestens', 'passwort', 'zeichen')))

    def test_registration_requires_all_mandatory_fields(self) -> None:
        response = self.client.post('/openfarmplanner/api/auth/register/', {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('email', response.data)
        self.assertIn('password', response.data)
        self.assertIn('password_confirm', response.data)

    def test_registration_succeeds_without_an_accept_terms_field(self) -> None:
        # Creating an account implies agreement to the Terms of Service for
        # both email/password and social registration alike - there is no
        # separate consent checkbox to fail validation on.
        response = self.client.post(
            '/openfarmplanner/api/auth/register/',
            {
                'email': 'no-checkbox@example.com',
                'password': 'new-safe-password-123',
                'password_confirm': 'new-safe-password-123',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        created = User.objects.get(email='no-checkbox@example.com')
        record = DocumentConsent.objects.get(user=created, document=DocumentConsent.DOCUMENT_TERMS)
        self.assertEqual(record.version, CURRENT_VERSIONS[DocumentConsent.DOCUMENT_TERMS])

    def test_registration_records_acceptance_of_the_current_terms_version(self) -> None:
        response = self.client.post(
            '/openfarmplanner/api/auth/register/',
            {
                'email': 'implicit-consent@example.com',
                'password': 'new-safe-password-123',
                'password_confirm': 'new-safe-password-123',
                'accept_terms': True,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        created = User.objects.get(email='implicit-consent@example.com')
        record = DocumentConsent.objects.get(user=created, document=DocumentConsent.DOCUMENT_TERMS)
        self.assertEqual(record.version, CURRENT_VERSIONS[DocumentConsent.DOCUMENT_TERMS])

    def test_registration_rejects_password_confirmation_mismatch(self) -> None:
        response = self.client.post(
            '/openfarmplanner/api/auth/register/',
            {
                'email': 'mismatch@example.com',
                'password': 'new-safe-password-123',
                'password_confirm': 'different-password-123',
                'accept_terms': True,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('password_confirm', response.data)

    def test_login_required_field_error_is_localized_to_german(self) -> None:
        response = self.client.post(
            '/openfarmplanner/api/auth/login/',
            {'email': 'demo@example.com'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('password', response.data)
        self.assertIn('erforderlich', ' '.join(response.data['password']).lower())

    def test_activation_success_and_invalid_token(self) -> None:
        register_response = self.client.post(
            '/openfarmplanner/api/auth/register/',
            {
                'email': 'pending@example.com',
                'display_name': 'Pending User',
                'password': self.password,
                'password_confirm': self.password,
                'accept_terms': True,
            },
            format='json',
        )
        self.assertEqual(register_response.status_code, status.HTTP_201_CREATED)

        user = User.objects.get(email='pending@example.com')
        pending = PendingActivation.objects.get(user=user)
        self.assertIsNotNone(pending.activation_expires_at)

        uid = urlsafe_base64_encode(str(user.pk).encode('utf-8'))
        token = default_token_generator.make_token(user)

        invalid = self.client.post('/openfarmplanner/api/auth/activate/', {'uid': uid, 'token': 'bad-token'}, format='json')
        self.assertEqual(invalid.status_code, status.HTTP_400_BAD_REQUEST)

        valid = self.client.post('/openfarmplanner/api/auth/activate/', {'uid': uid, 'token': token}, format='json')
        self.assertEqual(valid.status_code, status.HTTP_200_OK)
        user.refresh_from_db()
        self.assertTrue(user.is_active)
        self.assertFalse(PendingActivation.objects.filter(user=user).exists())

    def test_activation_rejects_invalid_uid(self) -> None:
        response = self.client.post(
            '/openfarmplanner/api/auth/activate/',
            {'uid': 'not-a-valid-uid', 'token': 'token'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data.get('detail'), 'Invalid activation link.')

    def test_activation_expired_pending_record_deletes_user(self) -> None:
        self.client.post(
            '/openfarmplanner/api/auth/register/',
            {
                'email': 'expired-activation@example.com',
                'password': self.password,
                'password_confirm': self.password,
                'accept_terms': True,
            },
            format='json',
        )
        user = User.objects.get(email='expired-activation@example.com')
        PendingActivation.objects.filter(user=user).update(
            activation_expires_at=timezone.now() - timedelta(minutes=1)
        )
        uid = urlsafe_base64_encode(str(user.pk).encode('utf-8'))
        token = default_token_generator.make_token(user)

        response = self.client.post('/openfarmplanner/api/auth/activate/', {'uid': uid, 'token': token}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data.get('detail'), 'Invalid or expired activation token.')
        self.assertFalse(User.objects.filter(pk=user.pk).exists())

    def test_activation_token_cannot_be_reused_after_successful_activation(self) -> None:
        self.client.post(
            '/openfarmplanner/api/auth/register/',
            {
                'email': 'one-time-token@example.com',
                'password': self.password,
                'password_confirm': self.password,
                'accept_terms': True,
            },
            format='json',
        )
        user = User.objects.get(email='one-time-token@example.com')
        uid = urlsafe_base64_encode(str(user.pk).encode('utf-8'))
        token = default_token_generator.make_token(user)

        first = self.client.post('/openfarmplanner/api/auth/activate/', {'uid': uid, 'token': token}, format='json')
        second = self.client.post('/openfarmplanner/api/auth/activate/', {'uid': uid, 'token': token}, format='json')
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_400_BAD_REQUEST)

        login_response = self.client.post(
            '/openfarmplanner/api/auth/login/',
            {'email': user.email, 'password': self.password},
            format='json',
        )
        self.assertEqual(login_response.status_code, status.HTTP_200_OK)

    def test_login_success_and_block_before_activation(self) -> None:
        blocked_user = User.objects.create_user(
            username='inactive',
            email='inactive@example.com',
            password=self.password,
            is_active=False,
        )

        blocked = self.client.post(
            '/openfarmplanner/api/auth/login/',
            {'email': blocked_user.email, 'password': self.password},
            format='json',
        )
        self.assertEqual(blocked.status_code, status.HTTP_403_FORBIDDEN)

        success = self.client.post(
            '/openfarmplanner/api/auth/login/',
            {'email': 'DEMO@EXAMPLE.COM', 'password': self.password},
            format='json',
        )
        self.assertEqual(success.status_code, status.HTTP_200_OK)
        self.assertEqual(success.data['email'], self.user.email)

    def test_logout_and_me(self) -> None:
        self.client.post('/openfarmplanner/api/auth/login/', {'email': self.user.email, 'password': self.password}, format='json')

        me_response = self.client.get('/openfarmplanner/api/auth/me/')
        self.assertEqual(me_response.status_code, status.HTTP_200_OK)

        logout_response = self.client.post('/openfarmplanner/api/auth/logout/', {}, format='json')
        self.assertEqual(logout_response.status_code, status.HTTP_200_OK)

        me_after_logout = self.client.get('/openfarmplanner/api/auth/me/')
        self.assertEqual(me_after_logout.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_password_reset_request_and_confirm(self) -> None:
        reset_request = self.client.post('/openfarmplanner/api/auth/password-reset/', {'email': self.user.email}, format='json')
        self.assertEqual(reset_request.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, [self.user.email])
        self.assertIn('/reset-password?uid=', mail.outbox[0].body)
        self.assertIn('&token=', mail.outbox[0].body)

        uid = urlsafe_base64_encode(str(self.user.pk).encode('utf-8'))
        token = default_token_generator.make_token(self.user)
        confirm = self.client.post(
            '/openfarmplanner/api/auth/password-reset-confirm/',
            {
                'uid': uid,
                'token': token,
                'password': 'even-safer-password-123',
                'password_confirm': 'even-safer-password-123',
            },
            format='json',
        )
        self.assertEqual(confirm.status_code, status.HTTP_200_OK)

        login_response = self.client.post(
            '/openfarmplanner/api/auth/login/',
            {'email': self.user.email, 'password': 'even-safer-password-123'},
            format='json',
        )
        self.assertEqual(login_response.status_code, status.HTTP_200_OK)

    def test_password_reset_confirm_rejects_invalid_token(self) -> None:
        uid = urlsafe_base64_encode(str(self.user.pk).encode('utf-8'))
        response = self.client.post(
            '/openfarmplanner/api/auth/password-reset-confirm/',
            {
                'uid': uid,
                'token': 'invalid-token',
                'password': 'even-safer-password-123',
                'password_confirm': 'even-safer-password-123',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_password_reset_confirm_rejects_invalid_uid(self) -> None:
        response = self.client.post(
            '/openfarmplanner/api/auth/password-reset-confirm/',
            {
                'uid': 'invalid-uid',
                'token': 'token',
                'password': 'even-safer-password-123',
                'password_confirm': 'even-safer-password-123',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data.get('detail'), 'Invalid reset link.')

    @override_settings(PUBLIC_FRONTEND_URL='https://zwiebelzopf.at/openfarmplanner')
    def test_password_reset_email_uses_public_frontend_url(self) -> None:
        response = self.client.post('/openfarmplanner/api/auth/password-reset/', {'email': self.user.email}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mail.outbox), 1)
        reset_email_body = mail.outbox[-1].body
        self.assertIn('https://zwiebelzopf.at/openfarmplanner/reset-password?uid=', reset_email_body)
        self.assertNotIn('http://localhost:5173/', reset_email_body)

    def test_resend_activation_does_not_leak_user_existence(self) -> None:
        inactive = User.objects.create_user(
            username='pending2',
            email='pending2@example.com',
            password=self.password,
            is_active=False,
        )
        old_expiry = timezone.now() + timedelta(days=1)
        PendingActivation.objects.update_or_create(
            user=inactive,
            defaults={'activation_expires_at': old_expiry},
        )

        first = self.client.post('/openfarmplanner/api/auth/resend-activation/', {'email': inactive.email}, format='json')
        second = self.client.post('/openfarmplanner/api/auth/resend-activation/', {'email': 'unknown@example.com'}, format='json')
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(first.data['detail'], second.data['detail'])

        refreshed_expiry = PendingActivation.objects.get(user=inactive).activation_expires_at
        self.assertGreater(refreshed_expiry, old_expiry)

    def test_resend_activation_sends_email_for_inactive_account(self) -> None:
        inactive = User.objects.create_user(
            username='pending_mail',
            email='pending-mail@example.com',
            password=self.password,
            is_active=False,
        )
        mail.outbox.clear()

        response = self.client.post('/openfarmplanner/api/auth/resend-activation/', {'email': inactive.email}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, [inactive.email])
        self.assertIn('/activate?uid=', mail.outbox[0].body)
        self.assertIn('&token=', mail.outbox[0].body)

    @patch('accounts.emails.send_mail', side_effect=RuntimeError('SMTP exploded'))
    def test_resend_activation_returns_safe_error_when_mail_fails(self, _mocked_send_mail) -> None:
        inactive = User.objects.create_user(
            username='pending_mail_failed',
            email='pending-mail-failed@example.com',
            password=self.password,
            is_active=False,
        )

        response = self.client.post('/openfarmplanner/api/auth/resend-activation/', {'email': inactive.email}, format='json')
        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(response.data.get('code'), 'email_send_failed')
        self.assertIn('Die E-Mail konnte nicht gesendet werden.', response.data.get('message', ''))
        self.assertNotIn('SMTP exploded', response.data.get('message', ''))

    def test_resend_activation_skips_active_accounts(self) -> None:
        active_user = User.objects.create_user(
            username='already_active',
            email='already-active@example.com',
            password=self.password,
            is_active=True,
        )
        mail.outbox.clear()
        response = self.client.post('/openfarmplanner/api/auth/resend-activation/', {'email': active_user.email}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(mail.outbox), 0)

    def test_password_reset_request_does_not_send_for_inactive_or_unknown_email(self) -> None:
        inactive = User.objects.create_user(
            username='inactive_reset',
            email='inactive-reset@example.com',
            password=self.password,
            is_active=False,
        )
        mail.outbox.clear()

        inactive_response = self.client.post('/openfarmplanner/api/auth/password-reset/', {'email': inactive.email}, format='json')
        unknown_response = self.client.post('/openfarmplanner/api/auth/password-reset/', {'email': 'unknown@example.com'}, format='json')

        self.assertEqual(inactive_response.status_code, status.HTTP_200_OK)
        self.assertEqual(unknown_response.status_code, status.HTTP_200_OK)
        self.assertEqual(inactive_response.data.get('detail'), unknown_response.data.get('detail'))
        self.assertEqual(len(mail.outbox), 0)

    @patch('accounts.emails.send_mail', side_effect=RuntimeError('SMTP timeout detail'))
    def test_password_reset_returns_safe_error_when_mail_fails(self, _mocked_send_mail) -> None:
        response = self.client.post('/openfarmplanner/api/auth/password-reset/', {'email': self.user.email}, format='json')
        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        self.assertEqual(response.data.get('code'), 'email_send_failed')
        self.assertIn('Die E-Mail konnte nicht gesendet werden.', response.data.get('message', ''))
        self.assertNotIn('SMTP timeout detail', response.data.get('message', ''))

    def test_cleanup_command_keeps_non_expired_inactive_user(self) -> None:
        inactive = User.objects.create_user(
            username='inactive_keep',
            email='inactive_keep@example.com',
            password=self.password,
            is_active=False,
        )
        PendingActivation.objects.update_or_create(
            user=inactive,
            defaults={'activation_expires_at': timezone.now() + timedelta(days=2)},
        )

        output = StringIO()
        call_command('delete_expired_inactive_users', stdout=output)

        self.assertTrue(User.objects.filter(pk=inactive.pk).exists())
        self.assertIn('Found 0 expired inactive users.', output.getvalue())

    def test_cleanup_command_deletes_expired_inactive_user(self) -> None:
        inactive = User.objects.create_user(
            username='inactive_delete',
            email='inactive_delete@example.com',
            password=self.password,
            is_active=False,
        )
        PendingActivation.objects.update_or_create(
            user=inactive,
            defaults={'activation_expires_at': timezone.now() - timedelta(days=1)},
        )

        output = StringIO()
        call_command('delete_expired_inactive_users', stdout=output)

        self.assertFalse(User.objects.filter(pk=inactive.pk).exists())
        self.assertIn('Found 1 expired inactive users.', output.getvalue())
        self.assertIn('Deleted 1 expired inactive users.', output.getvalue())

    def test_cleanup_command_never_deletes_active_user(self) -> None:
        active = User.objects.create_user(
            username='active_keep',
            email='active_keep@example.com',
            password=self.password,
            is_active=True,
        )
        PendingActivation.objects.update_or_create(
            user=active,
            defaults={'activation_expires_at': timezone.now() - timedelta(days=3)},
        )

        call_command('delete_expired_inactive_users')

        self.assertTrue(User.objects.filter(pk=active.pk).exists())

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.console.EmailBackend')
    def test_registration_message_for_console_email_backend(self) -> None:
        response = self.client.post(
            '/openfarmplanner/api/auth/register/',
            {
                'email': 'console-message@example.com',
                'password': 'new-safe-password-123',
                'password_confirm': 'new-safe-password-123',
                'accept_terms': True,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(
            response.data['detail'],
            'Registration successful. In local development, the activation email is written '
            'to the server log/terminal and is not delivered to an inbox.',
        )


    def test_account_delete_request_requires_password(self) -> None:
        self.client.post('/openfarmplanner/api/auth/login/', {'email': self.user.email, 'password': self.password}, format='json')
        response = self.client.post('/openfarmplanner/api/auth/account/delete-request/', {'password': 'wrong'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_account_delete_request_and_login_block(self) -> None:
        self.client.post('/openfarmplanner/api/auth/login/', {'email': self.user.email, 'password': self.password}, format='json')
        with self.assertLogs('accounts.views', level='INFO') as captured:
            response = self.client.post(
                '/openfarmplanner/api/auth/account/delete-request/',
                {'password': self.password},
                format='json',
            )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        deletion = AccountDeletionRequest.objects.get(user=self.user)
        self.assertIsNotNone(deletion.scheduled_deletion_at)
        self.assertEqual(len(captured.records), 1)
        record = captured.records[0]
        self.assertEqual(record.account_deletion_event, 'requested')
        self.assertEqual(record.account_deletion_request_id, deletion.pk)
        self.assertEqual(record.user_id, self.user.pk)
        self.assertFalse(hasattr(record, 'username'))
        self.assertNotIn(self.user.email, record.getMessage())
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_active)

        blocked = self.client.post('/openfarmplanner/api/auth/login/', {'email': self.user.email, 'password': self.password}, format='json')
        self.assertEqual(blocked.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(blocked.data.get('code'), 'account_pending_deletion')

    def test_account_restore_within_grace_period(self) -> None:
        self.client.post('/openfarmplanner/api/auth/login/', {'email': self.user.email, 'password': self.password}, format='json')
        with self.assertLogs('accounts.views', level='INFO'):
            self.client.post(
                '/openfarmplanner/api/auth/account/delete-request/',
                {'password': self.password},
                format='json',
            )
        with self.assertLogs('accounts.views', level='INFO') as captured:
            response = self.client.post(
                '/openfarmplanner/api/auth/account/restore/',
                {'email': self.user.email, 'password': self.password},
                format='json',
            )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        deletion = AccountDeletionRequest.objects.get(user=self.user)
        self.assertIsNone(deletion.deletion_requested_at)
        self.assertIsNone(deletion.scheduled_deletion_at)
        self.assertEqual(len(captured.records), 1)
        record = captured.records[0]
        self.assertEqual(record.account_deletion_event, 'restored')
        self.assertEqual(record.account_deletion_request_id, deletion.pk)
        self.assertEqual(record.user_id, self.user.pk)
        self.assertFalse(hasattr(record, 'username'))
        self.assertNotIn(self.user.email, record.getMessage())

    def test_account_restore_after_grace_period_fails(self) -> None:
        AccountDeletionRequest.objects.create(
            user=self.user,
            deletion_requested_at=timezone.now() - timedelta(days=15),
            scheduled_deletion_at=timezone.now() - timedelta(days=1),
        )
        self.user.is_active = False
        self.user.save(update_fields=['is_active'])

        response = self.client.post(
            '/openfarmplanner/api/auth/account/restore/',
            {'email': self.user.email, 'password': self.password},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_profile_update_changes_display_name(self) -> None:
        self.client.post('/openfarmplanner/api/auth/login/', {'email': self.user.email, 'password': self.password}, format='json')
        response = self.client.patch('/openfarmplanner/api/auth/account/profile/', {'display_name': 'Neuer Name'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertEqual(self.user.first_name, 'Neuer Name')

    def test_public_profile_update_sets_public_display_name(self) -> None:
        self.client.post('/openfarmplanner/api/auth/login/', {'email': self.user.email, 'password': self.password}, format='json')
        response = self.client.patch(
            '/openfarmplanner/api/auth/account/public-profile/', {'public_display_name': 'Grüner Hof'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['user']['public_display_name'], 'Grüner Hof')
        self.user.refresh_from_db()
        self.assertEqual(self.user.public_profile.public_display_name, 'Grüner Hof')

    def test_public_profile_update_rejects_name_already_used_case_insensitively(self) -> None:
        other = User.objects.create_user(
            username='other', email='other@example.com', password=self.password, is_active=True,
        )
        PublicProfile.objects.create(user=other, public_display_name='Grüner Hof')

        self.client.post('/openfarmplanner/api/auth/login/', {'email': self.user.email, 'password': self.password}, format='json')
        response = self.client.patch(
            '/openfarmplanner/api/auth/account/public-profile/', {'public_display_name': 'grüner hof'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(PublicProfile.objects.filter(user=self.user).exists())

    def test_public_profile_update_allows_reusing_own_current_name(self) -> None:
        self.client.post('/openfarmplanner/api/auth/login/', {'email': self.user.email, 'password': self.password}, format='json')
        self.client.patch('/openfarmplanner/api/auth/account/public-profile/', {'public_display_name': 'Grüner Hof'}, format='json')
        response = self.client.patch(
            '/openfarmplanner/api/auth/account/public-profile/', {'public_display_name': 'Grüner Hof'}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_public_profile_update_allows_multiple_users_to_stay_anonymous(self) -> None:
        other = User.objects.create_user(
            username='other', email='other@example.com', password=self.password, is_active=True,
        )
        PublicProfile.objects.create(user=other, public_display_name='')

        self.client.post('/openfarmplanner/api/auth/login/', {'email': self.user.email, 'password': self.password}, format='json')
        response = self.client.patch(
            '/openfarmplanner/api/auth/account/public-profile/', {'public_display_name': ''}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_public_profile_defaults_to_blank_not_username_or_display_name(self) -> None:
        self.client.post('/openfarmplanner/api/auth/login/', {'email': self.user.email, 'password': self.password}, format='json')
        response = self.client.get('/openfarmplanner/api/auth/me/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['public_display_name'], '')

    def test_account_data_export_returns_structured_self_service_export(self) -> None:
        project = Project.objects.create(name='Export Project', slug='export-project')
        ProjectMembership.objects.create(user=self.user, project=project, role=ProjectMembership.ROLE_ADMIN)
        location = Location.objects.create(name='Export Location', project=project)
        crop = Crop.objects.create(name='Export Kale', variety='Winter', project=project)
        PublicCrop.objects.create(
            name='Export Kale',
            variety='Winter',
            status=PublicCrop.STATUS_PUBLISHED,
            source_project=project,
            source_project_crop=crop,
            created_by=self.user,
        )

        login_response = self.client.post(
            '/openfarmplanner/api/auth/login/',
            {'email': self.user.email, 'password': self.password},
            format='json',
        )
        self.assertEqual(login_response.status_code, status.HTTP_200_OK)
        response = self.client.get('/openfarmplanner/api/auth/account/data-export/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response['Content-Disposition'], 'attachment; filename="openfarmplanner-data-export.json"')
        payload = json.loads(response.content)
        self.assertEqual(payload['account']['email'], self.user.email)
        self.assertNotIn('password', payload['account'])
        self.assertEqual(payload['memberships'][0]['project_id'], project.id)
        self.assertEqual(payload['projects'][0]['project']['name'], 'Export Project')
        self.assertEqual(payload['projects'][0]['locations'][0]['id'], location.id)
        self.assertEqual(payload['projects'][0]['crops'][0]['name'], 'Export Kale')
        self.assertEqual(payload['public_library_contributions'][0]['name'], 'Export Kale')

    def test_email_change_rejects_wrong_password(self) -> None:
        self.client.post('/openfarmplanner/api/auth/login/', {'email': self.user.email, 'password': self.password}, format='json')
        response = self.client.post(
            '/openfarmplanner/api/auth/account/change-email/',
            {'new_email': 'neu@example.com', 'current_password': 'wrong'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(AccountEmailChangeRequest.objects.exists())

    def test_email_change_sends_confirmation_mail_without_immediate_update(self) -> None:
        self.client.post('/openfarmplanner/api/auth/login/', {'email': self.user.email, 'password': self.password}, format='json')
        response = self.client.post(
            '/openfarmplanner/api/auth/account/change-email/',
            {'new_email': 'neu@example.com', 'current_password': self.password},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, 'demo@example.com')
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('/confirm-email-change?uid=', mail.outbox[0].body)
        self.assertIn('&request_id=', mail.outbox[0].body)

    def test_confirm_email_change_updates_user_email(self) -> None:
        self.client.post('/openfarmplanner/api/auth/login/', {'email': self.user.email, 'password': self.password}, format='json')
        self.client.post(
            '/openfarmplanner/api/auth/account/change-email/',
            {'new_email': 'neu@example.com', 'current_password': self.password},
            format='json',
        )
        body = mail.outbox[-1].body
        uid_match = re.search(r'uid=([^&\n]+)', body)
        token_match = re.search(r'token=([^&\n]+)', body)
        request_id_match = re.search(r'request_id=([0-9a-fA-F-]+)', body)
        self.assertIsNotNone(uid_match)
        self.assertIsNotNone(token_match)
        self.assertIsNotNone(request_id_match)
        response = self.client.post(
            '/openfarmplanner/api/auth/account/confirm-email-change/',
            {
                'uid': uid_match.group(1),
                'token': token_match.group(1),
                'request_id': request_id_match.group(1),
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, 'neu@example.com')

    def test_confirm_email_change_rejects_invalid_or_expired_token(self) -> None:
        request_obj = AccountEmailChangeRequest.objects.create(
            user=self.user,
            new_email='neu@example.com',
            expires_at=timezone.now() - timedelta(minutes=1),
        )
        uid = urlsafe_base64_encode(str(self.user.pk).encode('utf-8'))
        token = default_token_generator.make_token(self.user)
        response = self.client.post(
            '/openfarmplanner/api/auth/account/confirm-email-change/',
            {'uid': uid, 'token': token, 'request_id': str(request_obj.id)},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_password_change_rejects_wrong_current_password(self) -> None:
        self.client.post('/openfarmplanner/api/auth/login/', {'email': self.user.email, 'password': self.password}, format='json')
        response = self.client.post(
            '/openfarmplanner/api/auth/account/change-password/',
            {'current_password': 'wrong', 'new_password': 'New-safe-password-1234', 'new_password_confirm': 'New-safe-password-1234'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_password_change_with_valid_data(self) -> None:
        self.client.post('/openfarmplanner/api/auth/login/', {'email': self.user.email, 'password': self.password}, format='json')
        response = self.client.post(
            '/openfarmplanner/api/auth/account/change-password/',
            {'current_password': self.password, 'new_password': 'New-safe-password-1234', 'new_password_confirm': 'New-safe-password-1234'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.client.post('/openfarmplanner/api/auth/logout/', {}, format='json')
        login_with_new = self.client.post(
            '/openfarmplanner/api/auth/login/',
            {'email': self.user.email, 'password': 'New-safe-password-1234'},
            format='json',
        )
        self.assertEqual(login_with_new.status_code, status.HTTP_200_OK)

    def test_purge_deleted_accounts_anonymizes_and_is_idempotent(self) -> None:
        AccountDeletionRequest.objects.create(
            user=self.user,
            deletion_requested_at=timezone.now() - timedelta(days=20),
            scheduled_deletion_at=timezone.now() - timedelta(days=2),
        )
        output = StringIO()
        with self.assertLogs('accounts.services', level='INFO') as captured:
            call_command('purge_deleted_accounts', stdout=output)
        self.user.refresh_from_db()
        deletion = AccountDeletionRequest.objects.get(user=self.user)
        self.assertIsNotNone(deletion.deleted_at)
        self.assertFalse(self.user.is_active)
        self.assertTrue(self.user.email.startswith('deleted-user-'))
        self.assertIn('Finalized 1 accounts.', output.getvalue())
        self.assertIn(f'user_ids=[{self.user.pk}]', output.getvalue())
        self.assertEqual(len(captured.records), 1)
        record = captured.records[0]
        self.assertEqual(record.account_deletion_event, 'finalized')
        self.assertEqual(record.account_deletion_request_id, deletion.pk)
        self.assertEqual(record.user_id, self.user.pk)
        self.assertFalse(hasattr(record, 'username'))
        self.assertNotIn('demo@example.com', record.getMessage())

        second = StringIO()
        call_command('purge_deleted_accounts', stdout=second)
        self.assertIn('Finalized 0 accounts.', second.getvalue())
        self.assertIn('user_ids=[]', second.getvalue())

    def test_purge_deleted_accounts_deletes_projects_without_remaining_members(self) -> None:
        solo_project = Project.objects.create(name='Solo Project', slug='solo-project')
        ProjectMembership.objects.create(user=self.user, project=solo_project, role=ProjectMembership.ROLE_ADMIN)
        Location.objects.create(name='Solo Location', project=solo_project)
        source_crop = Crop.objects.create(name='Kale', project=solo_project)
        public_crop = PublicCrop.objects.create(
            name='Kale',
            status=PublicCrop.STATUS_PUBLISHED,
            source_project=solo_project,
            source_project_crop=source_crop,
            created_by=self.user,
        )
        AccountDeletionRequest.objects.create(
            user=self.user,
            deletion_requested_at=timezone.now() - timedelta(days=20),
            scheduled_deletion_at=timezone.now() - timedelta(days=2),
        )

        call_command('purge_deleted_accounts')

        self.assertFalse(Project.objects.filter(id=solo_project.id).exists())
        self.assertFalse(Location.objects.filter(project_id=solo_project.id).exists())
        public_crop.refresh_from_db()
        self.assertIsNone(public_crop.source_project)
        self.assertIsNone(public_crop.source_project_crop)
        self.assertEqual(public_crop.status, PublicCrop.STATUS_PUBLISHED)

    def test_purge_deleted_accounts_keeps_projects_with_remaining_members(self) -> None:
        other_user = User.objects.create_user(
            username='other-member',
            email='other-member@example.com',
            password=self.password,
            is_active=True,
        )
        shared_project = Project.objects.create(name='Shared Project', slug='shared-project')
        ProjectMembership.objects.create(user=self.user, project=shared_project, role=ProjectMembership.ROLE_ADMIN)
        ProjectMembership.objects.create(user=other_user, project=shared_project, role=ProjectMembership.ROLE_MEMBER)
        Location.objects.create(name='Shared Location', project=shared_project)
        AccountDeletionRequest.objects.create(
            user=self.user,
            deletion_requested_at=timezone.now() - timedelta(days=20),
            scheduled_deletion_at=timezone.now() - timedelta(days=2),
        )

        call_command('purge_deleted_accounts')

        self.assertTrue(Project.objects.filter(id=shared_project.id).exists())
        self.assertTrue(Location.objects.filter(project=shared_project, name='Shared Location').exists())
        self.assertFalse(ProjectMembership.objects.filter(user=self.user, project=shared_project).exists())
        remaining_membership = ProjectMembership.objects.get(user=other_user, project=shared_project)
        self.assertEqual(remaining_membership.role, ProjectMembership.ROLE_ADMIN)

    def test_delete_expired_inactive_users_removes_only_expired_accounts(self) -> None:
        expired = User.objects.create_user(
            username='expired',
            email='expired@example.com',
            password=self.password,
            is_active=False,
        )
        PendingActivation.objects.update_or_create(
            user=expired,
            defaults={'activation_expires_at': timezone.now() - timedelta(days=1)},
        )

        still_pending = User.objects.create_user(
            username='stillpending',
            email='stillpending@example.com',
            password=self.password,
            is_active=False,
        )
        PendingActivation.objects.update_or_create(
            user=still_pending,
            defaults={'activation_expires_at': timezone.now() + timedelta(days=1)},
        )

        output = StringIO()
        call_command('delete_expired_inactive_users', stdout=output)

        self.assertFalse(User.objects.filter(id=expired.id).exists())
        self.assertTrue(User.objects.filter(id=still_pending.id).exists())
        self.assertTrue(User.objects.filter(id=self.user.id).exists())
        self.assertIn('Deleted 1 expired inactive users.', output.getvalue())


@override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend', FRONTEND_URL='http://localhost:5173')
class ConsentApiTest(APITestCase):
    def setUp(self) -> None:
        self.password = 'safe-password-123'
        # Simulates a user who registered before the Terms of Service / consent
        # tracking existed: no DocumentConsent row at all.
        self.user = User.objects.create_user(
            username='pre-existing',
            email='pre-existing@example.com',
            password=self.password,
            is_active=True,
        )

    def test_existing_user_without_any_acceptance_is_flagged_as_pending_on_login(self) -> None:
        response = self.client.post(
            '/openfarmplanner/api/auth/login/',
            {'email': self.user.email, 'password': self.password},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['pending_consents'], ['terms'])
        self.assertFalse(response.data['public_library_terms_accepted'])

    def test_existing_user_who_accepted_an_older_version_is_flagged_as_pending(self) -> None:
        DocumentConsent.objects.create(user=self.user, document=DocumentConsent.DOCUMENT_TERMS, version='2020-01-01')

        response = self.client.post(
            '/openfarmplanner/api/auth/login/',
            {'email': self.user.email, 'password': self.password},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['pending_consents'], ['terms'])

    def test_me_endpoint_reports_pending_consents_for_an_existing_session(self) -> None:
        self.client.post('/openfarmplanner/api/auth/login/', {'email': self.user.email, 'password': self.password}, format='json')

        response = self.client.get('/openfarmplanner/api/auth/me/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['pending_consents'], ['terms'])

    def test_accepting_current_terms_clears_the_pending_consent(self) -> None:
        self.client.post('/openfarmplanner/api/auth/login/', {'email': self.user.email, 'password': self.password}, format='json')

        response = self.client.post('/openfarmplanner/api/auth/consent/accept/', {'document': 'terms'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['pending_consents'], [])

        record = DocumentConsent.objects.get(user=self.user, document=DocumentConsent.DOCUMENT_TERMS)
        self.assertEqual(record.version, CURRENT_VERSIONS[DocumentConsent.DOCUMENT_TERMS])

        me_response = self.client.get('/openfarmplanner/api/auth/me/')
        self.assertEqual(me_response.data['pending_consents'], [])

    def test_accept_endpoint_records_current_privacy_policy_version(self) -> None:
        self.client.post('/openfarmplanner/api/auth/login/', {'email': self.user.email, 'password': self.password}, format='json')

        response = self.client.post('/openfarmplanner/api/auth/consent/accept/', {'document': 'privacy'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        record = DocumentConsent.objects.get(user=self.user, document=DocumentConsent.DOCUMENT_PRIVACY)
        self.assertEqual(record.version, CURRENT_VERSIONS[DocumentConsent.DOCUMENT_PRIVACY])

    def test_me_endpoint_reports_public_library_terms_acceptance(self) -> None:
        DocumentConsent.objects.create(
            user=self.user,
            document=DocumentConsent.DOCUMENT_PUBLIC_LIBRARY,
            version=CURRENT_VERSIONS[DocumentConsent.DOCUMENT_PUBLIC_LIBRARY],
        )
        self.client.post('/openfarmplanner/api/auth/login/', {'email': self.user.email, 'password': self.password}, format='json')

        response = self.client.get('/openfarmplanner/api/auth/me/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['public_library_terms_accepted'])

    def test_accept_endpoint_requires_authentication(self) -> None:
        response = self.client.post('/openfarmplanner/api/auth/consent/accept/', {'document': 'terms'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_accept_endpoint_rejects_unknown_document(self) -> None:
        self.client.post('/openfarmplanner/api/auth/login/', {'email': self.user.email, 'password': self.password}, format='json')

        response = self.client.post('/openfarmplanner/api/auth/consent/accept/', {'document': 'cookies'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('document', response.data)

    def test_newly_registered_user_has_no_pending_consent_after_activation(self) -> None:
        register_response = self.client.post(
            '/openfarmplanner/api/auth/register/',
            {
                'email': 'brand-new@example.com',
                'password': 'new-safe-password-123',
                'password_confirm': 'new-safe-password-123',
                'accept_terms': True,
            },
            format='json',
        )
        self.assertEqual(register_response.status_code, status.HTTP_201_CREATED)

        new_user = User.objects.get(email='brand-new@example.com')
        new_user.is_active = True
        new_user.save(update_fields=['is_active'])

        login_response = self.client.post(
            '/openfarmplanner/api/auth/login/',
            {'email': 'brand-new@example.com', 'password': 'new-safe-password-123'},
            format='json',
        )
        self.assertEqual(login_response.status_code, status.HTTP_200_OK)
        self.assertEqual(login_response.data['pending_consents'], [])
