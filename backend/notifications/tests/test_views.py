from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase as DRFAPITestCase

from notifications.models import Notification
from notifications.services import create_notification, mark_all_notifications_read

User = get_user_model()


class NotificationViewSetTest(DRFAPITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='notified', email='notified@example.com', password='testpass', is_active=True,
        )
        self.other_user = User.objects.create_user(
            username='someone-else', email='else@example.com', password='testpass', is_active=True,
        )

    def _create(self, recipient, *, is_read=False, name='Pumpkin'):
        notification = create_notification(
            recipient=recipient,
            notification_type=Notification.TYPE_CROP_SPECIES_PROPOSAL_ACCEPTED,
            message=f'Your proposal for the crop species "{name}" was accepted.',
            context={'name': name},
            target_type=Notification.TARGET_CROP_SPECIES,
            target_id=7,
        )
        if is_read:
            notification.is_read = True
            notification.save(update_fields=['is_read'])
        return notification

    def test_requires_authentication(self):
        response = self.client.get('/openfarmplanner/api/notifications/')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_lists_only_own_notifications_newest_first_with_unread_count(self):
        older = self._create(self.user, name='Older')
        newer = self._create(self.user, name='Newer')
        newest = self._create(self.user, name='Read one', is_read=True)
        self._create(self.other_user, name='Not mine')
        self.client.force_authenticate(user=self.user)

        response = self.client.get('/openfarmplanner/api/notifications/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        returned_ids = [item['id'] for item in response.data['results']]
        self.assertEqual(returned_ids, [newest.id, newer.id, older.id])
        self.assertEqual(response.data['unread_count'], 2)
        self.assertNotIn('Not mine', [item['context'].get('name') for item in response.data['results']])

    def test_filters_by_is_read_while_the_unread_count_stays_account_wide(self):
        unread = self._create(self.user, name='Unread')
        self._create(self.user, name='Read one', is_read=True)
        self._create(self.other_user, name='Not mine')
        self.client.force_authenticate(user=self.user)

        response = self.client.get('/openfarmplanner/api/notifications/?is_read=false')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([item['id'] for item in response.data['results']], [unread.id])
        # The dropdown lists the filtered rows but badges the whole account, so
        # the count must not follow the filter.
        self.assertEqual(response.data['unread_count'], 1)

    def test_unread_filter_reaches_past_the_first_page_of_the_history(self):
        for index in range(3):
            self._create(self.user, name=f'Read {index}', is_read=True)
        buried = self._create(self.user, name='Buried unread')
        for index in range(3):
            self._create(self.user, name=f'Newer read {index}', is_read=True)
        self.client.force_authenticate(user=self.user)

        response = self.client.get('/openfarmplanner/api/notifications/?is_read=false&page_size=2')

        self.assertEqual([item['id'] for item in response.data['results']], [buried.id])

    def test_ignores_an_unparsable_is_read_value(self):
        self._create(self.user, name='Unread')
        self._create(self.user, name='Read one', is_read=True)
        self.client.force_authenticate(user=self.user)

        response = self.client.get('/openfarmplanner/api/notifications/?is_read=maybe')

        self.assertEqual(len(response.data['results']), 2)

    def test_is_read_parameter_does_not_block_marking_as_read(self):
        notification = self._create(self.user)
        self.client.force_authenticate(user=self.user)

        response = self.client.post(
            f'/openfarmplanner/api/notifications/{notification.id}/read/?is_read=true',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        notification.refresh_from_db()
        self.assertTrue(notification.is_read)

    def test_marking_one_as_read_lowers_the_unread_count(self):
        notification = self._create(self.user)
        self._create(self.user, name='Still unread')
        self.client.force_authenticate(user=self.user)

        read_response = self.client.post(f'/openfarmplanner/api/notifications/{notification.id}/read/')
        list_response = self.client.get('/openfarmplanner/api/notifications/')

        self.assertEqual(read_response.status_code, status.HTTP_200_OK)
        self.assertTrue(read_response.data['is_read'])
        self.assertEqual(list_response.data['unread_count'], 1)

    def test_cannot_mark_someone_elses_notification_as_read(self):
        notification = self._create(self.other_user)
        self.client.force_authenticate(user=self.user)

        response = self.client.post(f'/openfarmplanner/api/notifications/{notification.id}/read/')

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        notification.refresh_from_db()
        self.assertFalse(notification.is_read)

    def test_mark_all_read_requires_authentication(self):
        notification = self._create(self.user)

        response = self.client.post('/openfarmplanner/api/notifications/read-all/')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        notification.refresh_from_db()
        self.assertFalse(notification.is_read)

    def test_mark_all_read_affects_only_own_unread_notifications(self):
        first = self._create(self.user, name='First')
        second = self._create(self.user, name='Second')
        self._create(self.user, name='Already read', is_read=True)
        foreign = self._create(self.other_user, name='Not mine')
        self.client.force_authenticate(user=self.user)

        response = self.client.post('/openfarmplanner/api/notifications/read-all/')
        list_response = self.client.get('/openfarmplanner/api/notifications/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, {'marked_read': 2})
        first.refresh_from_db()
        second.refresh_from_db()
        foreign.refresh_from_db()
        self.assertTrue(first.is_read)
        self.assertTrue(second.is_read)
        self.assertFalse(foreign.is_read)
        self.assertEqual(list_response.data['unread_count'], 0)

    def test_mark_all_read_is_idempotent(self):
        self._create(self.user)
        self.client.force_authenticate(user=self.user)

        first_response = self.client.post('/openfarmplanner/api/notifications/read-all/')
        second_response = self.client.post('/openfarmplanner/api/notifications/read-all/')

        self.assertEqual(first_response.data, {'marked_read': 1})
        self.assertEqual(second_response.status_code, status.HTTP_200_OK)
        self.assertEqual(second_response.data, {'marked_read': 0})
        self.assertFalse(Notification.objects.filter(recipient=self.user, is_read=False).exists())

    def test_mark_all_read_ignores_an_is_read_filter_on_the_url(self):
        self._create(self.user)
        self.client.force_authenticate(user=self.user)

        response = self.client.post('/openfarmplanner/api/notifications/read-all/?is_read=true')

        self.assertEqual(response.data, {'marked_read': 1})
        self.assertFalse(Notification.objects.filter(recipient=self.user, is_read=False).exists())

    def test_mark_all_read_is_one_update_regardless_of_row_count(self):
        for index in range(5):
            self._create(self.user, name=f'Unread {index}')

        with self.assertNumQueries(1):
            marked_read = mark_all_notifications_read(self.user)

        self.assertEqual(marked_read, 5)

    def test_notifications_cannot_be_created_through_the_api(self):
        self.client.force_authenticate(user=self.user)

        response = self.client.post('/openfarmplanner/api/notifications/', {
            'notification_type': Notification.TYPE_CROP_SPECIES_PROPOSAL_ACCEPTED,
            'message': 'Injected',
        }, format='json')

        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self.assertFalse(Notification.objects.filter(message='Injected').exists())


class CreateNotificationServiceTest(DRFAPITestCase):
    def test_skips_missing_and_inactive_recipients(self):
        inactive = User.objects.create_user(
            username='inactive', email='inactive@example.com', password='testpass', is_active=False,
        )

        self.assertIsNone(create_notification(
            recipient=None,
            notification_type=Notification.TYPE_CROP_SPECIES_PROPOSAL_ACCEPTED,
            message='No recipient',
        ))
        self.assertIsNone(create_notification(
            recipient=inactive,
            notification_type=Notification.TYPE_CROP_SPECIES_PROPOSAL_ACCEPTED,
            message='Inactive recipient',
        ))
        self.assertEqual(Notification.objects.count(), 0)
