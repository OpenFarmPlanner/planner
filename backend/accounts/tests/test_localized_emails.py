from __future__ import annotations

from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.test import SimpleTestCase
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.email_templates import (
    EMAIL_KINDS,
    EMAIL_TEMPLATE_ROOT,
    PASSWORD_RESET_EMAIL,
    email_template_files,
    project_role_label_file,
    public_website_url,
    render_email,
    render_project_role_label,
)
from accounts.models import UserProjectSettings
from config.languages import SUPPORTED_LANGUAGE_CODES, resolve_email_language
from farm.models import ProjectInvitation

User = get_user_model()

TEMPLATE_DIR = Path(settings.BASE_DIR) / 'accounts' / 'templates' / EMAIL_TEMPLATE_ROOT
PASSWORD = 'safe-password-123'

ACTIVATION_SUBJECTS = {
    'de': 'Registrierung bei OpenFarmPlanner bestätigen',
    'en': 'Confirm your registration with OpenFarmPlanner',
    'fr': 'Confirmez votre inscription à OpenFarmPlanner',
    'es': 'Confirma tu registro en OpenFarmPlanner',
}
PASSWORD_RESET_SUBJECTS = {
    'de': 'OpenFarmPlanner-Passwort zurücksetzen',
    'en': 'Reset your OpenFarmPlanner password',
    'fr': 'Réinitialisez votre mot de passe OpenFarmPlanner',
    'es': 'Restablece tu contraseña de OpenFarmPlanner',
}
EMAIL_CHANGE_SUBJECTS = {
    'de': 'E-Mail-Änderung bei OpenFarmPlanner bestätigen',
    'en': 'Confirm your email change at OpenFarmPlanner',
}


def _create_user(email: str, *, ui_language: str | None = None, is_active: bool = True) -> User:
    user = User.objects.create_user(
        username=email.split('@')[0],
        email=email,
        password=PASSWORD,
        is_active=is_active,
    )
    if ui_language is not None:
        UserProjectSettings.objects.create(user=user, ui_language=ui_language)
    return user


class EmailTemplateParityTests(SimpleTestCase):
    """Every supported language must ship every email template."""

    def test_every_language_has_every_email_template(self) -> None:
        role_files = [project_role_label_file(role) for role, _label in ProjectInvitation.ROLE_CHOICES]
        for language in SUPPORTED_LANGUAGE_CODES:
            for file_name in [*(f for kind in EMAIL_KINDS for f in email_template_files(kind)), *role_files]:
                with self.subTest(language=language, file=file_name):
                    self.assertTrue(
                        (TEMPLATE_DIR / language / file_name).is_file(),
                        f'Missing email template {language}/{file_name}',
                    )

    def test_templates_render_every_placeholder_in_every_language(self) -> None:
        for language in SUPPORTED_LANGUAGE_CODES:
            for kind in EMAIL_KINDS:
                context = {key: f'<<{key}-value>>' for key in kind.required_context}
                email = render_email(kind, language, context)
                with self.subTest(language=language, kind=kind.name):
                    self.assertTrue(email.subject)
                    self.assertNotIn('\n', email.subject)
                    self.assertNotIn('–', email.subject)
                    self.assertNotIn('{{', email.text)
                    for key, value in context.items():
                        self.assertIn(value, email.text, f'{language}/{kind.name}.txt does not use {key}')
                        if kind.has_html:
                            self.assertIn(
                                value.replace('<', '&lt;').replace('>', '&gt;'),
                                email.html,
                                f'{language}/{kind.name}.html does not use {key}',
                            )

    def test_role_labels_are_readable_in_every_language(self) -> None:
        for language in SUPPORTED_LANGUAGE_CODES:
            for role, _label in ProjectInvitation.ROLE_CHOICES:
                with self.subTest(language=language, role=role):
                    self.assertTrue(render_project_role_label(role, language))
        self.assertEqual(render_project_role_label('member', 'de'), 'Mitglied')
        self.assertEqual(render_project_role_label('member', 'en'), 'Member')
        self.assertEqual(render_project_role_label('member', 'fr'), 'Membre')
        self.assertEqual(render_project_role_label('member', 'es'), 'Miembro')

    def test_french_and_spanish_render_their_own_templates(self) -> None:
        for language in ('fr', 'es'):
            with self.subTest(language=language):
                email = render_email(PASSWORD_RESET_EMAIL, language, {'reset_link': 'https://example.org/reset'})
                self.assertEqual(email.subject, PASSWORD_RESET_SUBJECTS[language])
                self.assertIn('https://example.org/reset', email.text)

    def test_unsupported_language_falls_back_to_english(self) -> None:
        email = render_email(PASSWORD_RESET_EMAIL, 'it', {'reset_link': 'https://example.org/reset'})
        self.assertEqual(email.subject, PASSWORD_RESET_SUBJECTS['en'])

    def test_public_website_url_is_language_specific(self) -> None:
        self.assertEqual(public_website_url('de'), 'https://openfarmplanner.org')
        self.assertEqual(public_website_url('en'), 'https://openfarmplanner.org/en')
        self.assertEqual(public_website_url('fr'), 'https://openfarmplanner.org/fr')
        self.assertEqual(public_website_url('es-419'), 'https://openfarmplanner.org/es')

    def test_resolve_email_language_without_any_hint_is_english(self) -> None:
        self.assertEqual(resolve_email_language(), 'en')


class LocalizedAccountEmailTests(APITestCase):
    def setUp(self) -> None:
        cache.clear()

    def _register(self, email: str, *, query: str = '', **headers: str):
        return self.client.post(
            f'/openfarmplanner/api/auth/register/{query}',
            {
                'email': email,
                'password': 'new-safe-password-123',
                'password_confirm': 'new-safe-password-123',
                'accept_terms': True,
            },
            format='json',
            **headers,
        )

    # Activation (registration)

    def test_registration_with_german_language_sends_german_mail_and_stores_preference(self) -> None:
        response = self._register('de-guest@example.com', query='?language=de', HTTP_ACCEPT_LANGUAGE='en')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(mail.outbox[-1].subject, ACTIVATION_SUBJECTS['de'])
        self.assertIn('https://openfarmplanner.org\n', mail.outbox[-1].body)
        user = User.objects.get(email='de-guest@example.com')
        self.assertEqual(user.project_settings.ui_language, 'de')

    def test_registration_with_english_language_sends_english_mail(self) -> None:
        response = self._register('en-guest@example.com', query='?language=en', HTTP_ACCEPT_LANGUAGE='de')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        message = mail.outbox[-1]
        self.assertEqual(message.subject, ACTIVATION_SUBJECTS['en'])
        self.assertIn('https://openfarmplanner.org/en', message.body)
        html_body, mime_type = message.alternatives[0]
        self.assertEqual(mime_type, 'text/html')
        self.assertIn('lang="en"', html_body)
        self.assertIn('/activate?uid=', html_body)
        self.assertEqual(User.objects.get(email='en-guest@example.com').project_settings.ui_language, 'en')

    def test_registration_without_language_uses_accept_language_and_stores_nothing(self) -> None:
        self._register('header-guest@example.com', HTTP_ACCEPT_LANGUAGE='de-AT,de;q=0.9')

        self.assertEqual(mail.outbox[-1].subject, ACTIVATION_SUBJECTS['de'])
        self.assertFalse(UserProjectSettings.objects.filter(user__email='header-guest@example.com').exists())

    def test_registration_without_any_language_hint_sends_english(self) -> None:
        self._register('plain-guest@example.com')

        self.assertEqual(mail.outbox[-1].subject, ACTIVATION_SUBJECTS['en'])

    def test_registration_ignores_unsupported_language(self) -> None:
        self._register('it-guest@example.com', query='?language=it')

        self.assertEqual(mail.outbox[-1].subject, ACTIVATION_SUBJECTS['en'])
        self.assertFalse(UserProjectSettings.objects.filter(user__email='it-guest@example.com').exists())

    def test_registration_in_french_and_spanish_sends_localized_mail_and_stores_preference(self) -> None:
        for language in ('fr', 'es'):
            with self.subTest(language=language):
                email = f'{language}-guest@example.com'
                response = self._register(email, query=f'?language={language}', HTTP_ACCEPT_LANGUAGE='de')

                self.assertEqual(response.status_code, status.HTTP_201_CREATED)
                message = mail.outbox[-1]
                self.assertEqual(message.subject, ACTIVATION_SUBJECTS[language])
                self.assertIn(f'https://openfarmplanner.org/{language}', message.body)
                html_body, _ = message.alternatives[0]
                self.assertIn(f'lang="{language}"', html_body)
                self.assertEqual(User.objects.get(email=email).project_settings.ui_language, language)

    # Activation (resend)

    def _resend(self, email: str, *, query: str = '', **headers: str):
        return self.client.post(
            f'/openfarmplanner/api/auth/resend-activation/{query}', {'email': email}, format='json', **headers,
        )

    def test_resend_activation_uses_explicit_account_language_over_request(self) -> None:
        _create_user('pending-de@example.com', ui_language='de', is_active=False)
        _create_user('pending-en@example.com', ui_language='en', is_active=False)

        self._resend('pending-de@example.com', query='?language=en')
        self.assertEqual(mail.outbox[-1].subject, ACTIVATION_SUBJECTS['de'])
        cache.clear()
        self._resend('pending-en@example.com', query='?language=de')
        self.assertEqual(mail.outbox[-1].subject, ACTIVATION_SUBJECTS['en'])

    def test_resend_activation_for_auto_account_uses_request_language(self) -> None:
        _create_user('pending-auto@example.com', ui_language='auto', is_active=False)

        self._resend('pending-auto@example.com', query='?language=de')

        self.assertEqual(mail.outbox[-1].subject, ACTIVATION_SUBJECTS['de'])

    def test_resend_activation_without_any_language_hint_sends_english(self) -> None:
        _create_user('pending-plain@example.com', is_active=False)

        self._resend('pending-plain@example.com')

        self.assertEqual(mail.outbox[-1].subject, ACTIVATION_SUBJECTS['en'])

    # Password reset

    def _reset(self, email: str, *, query: str = '', **headers: str):
        return self.client.post(
            f'/openfarmplanner/api/auth/password-reset/{query}', {'email': email}, format='json', **headers,
        )

    def test_password_reset_uses_explicit_account_language(self) -> None:
        _create_user('reset-de@example.com', ui_language='de')
        _create_user('reset-en@example.com', ui_language='en')

        self._reset('reset-de@example.com', query='?language=en')
        self.assertEqual(mail.outbox[-1].subject, PASSWORD_RESET_SUBJECTS['de'])
        self.assertIn('verwende den folgenden Link', mail.outbox[-1].body)
        self._reset('reset-en@example.com', query='?language=de')
        self.assertEqual(mail.outbox[-1].subject, PASSWORD_RESET_SUBJECTS['en'])
        self.assertIn('/reset-password?uid=', mail.outbox[-1].body)
        self.assertNotIn('&amp;token=', mail.outbox[-1].body)

    def test_password_reset_for_auto_account_uses_request_language(self) -> None:
        _create_user('reset-auto@example.com', ui_language='auto')

        self._reset('reset-auto@example.com', HTTP_ACCEPT_LANGUAGE='de')

        self.assertEqual(mail.outbox[-1].subject, PASSWORD_RESET_SUBJECTS['de'])

    def test_password_reset_without_any_language_hint_sends_english(self) -> None:
        _create_user('reset-plain@example.com')

        self._reset('reset-plain@example.com')

        self.assertEqual(mail.outbox[-1].subject, PASSWORD_RESET_SUBJECTS['en'])

    # Email change

    def _change_email(self, user: User, *, query: str = '', **headers: str):
        self.client.force_authenticate(user)
        return self.client.post(
            f'/openfarmplanner/api/auth/account/change-email/{query}',
            {'new_email': f'new-{user.email}', 'current_password': PASSWORD},
            format='json',
            **headers,
        )

    def test_email_change_uses_explicit_account_language(self) -> None:
        response = self._change_email(_create_user('change-de@example.com', ui_language='de'), query='?language=en')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(mail.outbox[-1].subject, EMAIL_CHANGE_SUBJECTS['de'])
        self.assertIn('new-change-de@example.com', mail.outbox[-1].body)

        self._change_email(_create_user('change-en@example.com', ui_language='en'), query='?language=de')
        self.assertEqual(mail.outbox[-1].subject, EMAIL_CHANGE_SUBJECTS['en'])

    def test_email_change_for_auto_account_uses_request_language(self) -> None:
        self._change_email(_create_user('change-auto@example.com', ui_language='auto'), query='?language=de')

        self.assertEqual(mail.outbox[-1].subject, EMAIL_CHANGE_SUBJECTS['de'])

    def test_email_change_without_any_language_hint_sends_english(self) -> None:
        self._change_email(_create_user('change-plain@example.com'))

        self.assertEqual(mail.outbox[-1].subject, EMAIL_CHANGE_SUBJECTS['en'])
