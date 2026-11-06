"""The task-moving hint retires per user across projects and devices."""

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from accounts.models import UserProjectSettings


class TaskDragHintTest(APITestCase):
    url = '/openfarmplanner/api/auth/account/task-drag-hint/'

    def setUp(self) -> None:
        self.user = get_user_model().objects.create_user(username='drag-hint', password='testpass')
        self.client.force_authenticate(self.user)

    def test_reads_without_creating_settings_and_retires_idempotently(self) -> None:
        self.assertEqual(self.client.get(self.url).data, {'done': False})
        self.assertFalse(UserProjectSettings.objects.filter(user=self.user).exists())
        for event in ('dismissed', 'moved'):
            response = self.client.post(self.url, {'event': event}, format='json')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data, {'done': True})
        me = self.client.get('/openfarmplanner/api/auth/me/')
        self.assertTrue(me.data['task_drag_hint_done'])
        self.assertEqual(UserProjectSettings.objects.filter(user=self.user).count(), 1)

    def test_state_is_private_and_other_settings_survive(self) -> None:
        UserProjectSettings.objects.create(user=self.user, ui_language='fr')
        self.client.post(self.url, {'event': 'moved'}, format='json')
        self.assertEqual(UserProjectSettings.objects.get(user=self.user).ui_language, 'fr')
        other = get_user_model().objects.create_user(username='other-hint', password='testpass')
        self.client.force_authenticate(other)
        self.assertEqual(self.client.get(self.url).data, {'done': False})

    def test_invalid_events_and_anonymous_requests_do_not_write(self) -> None:
        self.assertEqual(self.client.post(self.url, {'event': 'reset'}).status_code, 400)
        self.client.force_authenticate(None)
        self.assertIn(self.client.post(self.url, {'event': 'dismissed'}).status_code, (401, 403))
        self.assertFalse(UserProjectSettings.objects.filter(user=self.user).exists())
