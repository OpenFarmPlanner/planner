"""Per-user UI language preference: storage, validation and exposure."""

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase as DRFAPITestCase

from accounts.models import UserProjectSettings

User = get_user_model()

LANGUAGE_URL = '/openfarmplanner/api/auth/account/language/'
ME_URL = '/openfarmplanner/api/auth/me/'


class AccountLanguageApiTest(DRFAPITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='lang-user', email='lang@example.com', password='testpass', is_active=True,
        )
        self.client.force_authenticate(user=self.user)

    def test_defaults_to_auto_for_a_user_who_never_chose(self):
        response = self.client.get(LANGUAGE_URL)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['ui_language'], 'auto')

    def test_stores_an_explicit_language(self):
        response = self.client.put(LANGUAGE_URL, {'ui_language': 'en'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['ui_language'], 'en')
        self.assertEqual(UserProjectSettings.objects.get(user=self.user).ui_language, 'en')

    def test_stores_the_auto_preference(self):
        self.client.put(LANGUAGE_URL, {'ui_language': 'de'}, format='json')
        response = self.client.put(LANGUAGE_URL, {'ui_language': 'auto'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(UserProjectSettings.objects.get(user=self.user).ui_language, 'auto')

    def test_accepts_every_supported_code(self):
        for code in ('auto', 'de', 'en', 'fr', 'es'):
            response = self.client.put(LANGUAGE_URL, {'ui_language': code}, format='json')
            self.assertEqual(response.status_code, status.HTTP_200_OK, code)

    def test_rejects_unsupported_language_codes(self):
        for code in ('it', 'de-AT', 'nonsense', ''):
            response = self.client.put(LANGUAGE_URL, {'ui_language': code}, format='json')
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, code)

    def test_an_unsupported_value_leaves_the_stored_preference_untouched(self):
        self.client.put(LANGUAGE_URL, {'ui_language': 'de'}, format='json')
        self.client.put(LANGUAGE_URL, {'ui_language': 'it'}, format='json')

        self.assertEqual(UserProjectSettings.objects.get(user=self.user).ui_language, 'de')

    def test_the_preference_survives_a_new_session(self):
        self.client.put(LANGUAGE_URL, {'ui_language': 'en'}, format='json')

        self.client.force_authenticate(user=None)
        self.client.force_authenticate(user=User.objects.get(pk=self.user.pk))
        response = self.client.get(LANGUAGE_URL)

        self.assertEqual(response.data['ui_language'], 'en')

    def test_requires_authentication(self):
        self.client.force_authenticate(user=None)

        response = self.client.put(LANGUAGE_URL, {'ui_language': 'en'}, format='json')

        self.assertIn(
            response.status_code,
            {status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN},
        )

    def test_keeps_the_existing_project_selection_when_the_language_changes(self):
        settings_row = UserProjectSettings.objects.create(user=self.user)
        self.client.put(LANGUAGE_URL, {'ui_language': 'en'}, format='json')

        settings_row.refresh_from_db()
        self.assertEqual(settings_row.ui_language, 'en')
        self.assertIsNone(settings_row.default_project)


class UserSerializerLanguageTest(DRFAPITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='me-lang', email='melang@example.com', password='testpass', is_active=True,
        )
        self.client.force_authenticate(user=self.user)

    def test_me_reports_auto_when_nothing_was_chosen(self):
        response = self.client.get(ME_URL)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['ui_language'], 'auto')

    def test_me_reports_the_stored_preference(self):
        UserProjectSettings.objects.update_or_create(user=self.user, defaults={'ui_language': 'de'})

        response = self.client.get(ME_URL)

        self.assertEqual(response.data['ui_language'], 'de')

    def test_the_preference_belongs_to_the_user_not_to_a_project(self):
        """Two members of one project can use different interface languages."""
        other = User.objects.create_user(
            username='other-lang', email='otherlang@example.com',
            password='testpass', is_active=True,
        )
        UserProjectSettings.objects.update_or_create(user=self.user, defaults={'ui_language': 'de'})
        UserProjectSettings.objects.update_or_create(user=other, defaults={'ui_language': 'en'})

        self.assertEqual(self.client.get(ME_URL).data['ui_language'], 'de')

        self.client.force_authenticate(user=other)
        self.assertEqual(self.client.get(ME_URL).data['ui_language'], 'en')
