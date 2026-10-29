"""Shared state of the inline table edit hint: storage, retirement rules and exposure."""

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase as DRFAPITestCase

from accounts.models import UserProjectSettings
from accounts.table_edit_hint import TABLE_EDIT_HINT_MAX_SHOWN

User = get_user_model()

HINT_URL = '/openfarmplanner/api/auth/account/table-edit-hint/'
ME_URL = '/openfarmplanner/api/auth/me/'


class AccountTableEditHintApiTest(DRFAPITestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(
            username='hint-user', email='hint@example.com', password='testpass', is_active=True,
        )
        self.client.force_authenticate(user=self.user)

    def post_event(self, event: str):
        return self.client.post(HINT_URL, {'event': event}, format='json')

    def test_a_user_without_settings_has_never_seen_the_hint(self) -> None:
        response = self.client.get(HINT_URL)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, {'done': False, 'shown_count': 0})
        self.assertFalse(UserProjectSettings.objects.filter(user=self.user).exists())

    def test_each_display_is_counted_and_the_last_one_retires_the_hint(self) -> None:
        for expected_count in range(1, TABLE_EDIT_HINT_MAX_SHOWN + 1):
            response = self.post_event('shown')
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertEqual(response.data['shown_count'], expected_count)

        self.assertTrue(response.data['done'])
        self.assertEqual(self.post_event('shown').data['shown_count'], TABLE_EDIT_HINT_MAX_SHOWN)

    def test_editing_the_spreadsheet_way_retires_the_hint(self) -> None:
        self.post_event('shown')

        response = self.post_event('edited')

        self.assertEqual(response.data, {'done': True, 'shown_count': 1})
        self.assertTrue(UserProjectSettings.objects.get(user=self.user).table_edit_hint_done)

    def test_dismissing_retires_the_hint_and_keeps_other_settings(self) -> None:
        UserProjectSettings.objects.create(user=self.user, ui_language='fr')

        response = self.post_event('dismissed')

        self.assertTrue(response.data['done'])
        settings_row = UserProjectSettings.objects.get(user=self.user)
        self.assertEqual(settings_row.ui_language, 'fr')

    def test_a_retired_hint_is_no_longer_counted(self) -> None:
        self.post_event('edited')

        response = self.post_event('shown')

        self.assertEqual(response.data, {'done': True, 'shown_count': 0})

    def test_the_state_is_part_of_the_me_payload(self) -> None:
        self.post_event('shown')

        response = self.client.get(ME_URL)

        self.assertEqual(response.data['table_edit_hint'], {'done': False, 'shown_count': 1})

    def test_rejects_unknown_events(self) -> None:
        for event in ('', 'reset', 'SHOWN'):
            response = self.post_event(event)
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, event)

    def test_requires_authentication(self) -> None:
        self.client.force_authenticate(user=None)

        response = self.post_event('shown')

        self.assertIn(
            response.status_code,
            (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
        )
        self.assertFalse(UserProjectSettings.objects.filter(user=self.user).exists())
