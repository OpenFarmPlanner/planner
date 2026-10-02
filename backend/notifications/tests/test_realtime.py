from asgiref.sync import async_to_sync, sync_to_async
from channels.testing import WebsocketCommunicator
from django.contrib.auth import get_user_model
from django.test import Client, TransactionTestCase

from config.asgi import application
from notifications.models import Notification
from notifications.services import create_notification, mark_all_notifications_read

User = get_user_model()


class NotificationWebSocketTests(TransactionTestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(
            username='notification-recipient', password='test-password'
        )
        self.other_user = User.objects.create_user(
            username='other-notification-recipient', password='test-password'
        )
        client = Client()
        client.force_login(self.user)
        self.cookie_header = (
            b'cookie', f'sessionid={client.cookies["sessionid"].value}'.encode()
        )

    def test_authenticated_connection_receives_only_own_notification_updates(self) -> None:
        async_to_sync(self._assert_isolated_delivery)()

    async def _assert_isolated_delivery(self) -> None:
        communicator = self._communicator(authenticated=True)
        self.assertTrue((await communicator.connect())[0])

        await sync_to_async(create_notification)(
            recipient=self.other_user,
            notification_type=Notification.TYPE_CROP_SPECIES_PROPOSAL_ACCEPTED,
            message='Other user notification',
        )
        self.assertTrue(await communicator.receive_nothing(timeout=0.1))

        notification = await sync_to_async(create_notification)(
            recipient=self.user,
            notification_type=Notification.TYPE_CROP_SPECIES_PROPOSAL_ACCEPTED,
            message='Own notification',
        )
        event = await communicator.receive_json_from()
        self.assertEqual(event, {
            'type': 'notifications.updated',
            'notification_id': notification.id,
        })
        await communicator.disconnect()

    def test_mark_all_read_sends_one_bulk_update_and_none_when_nothing_changed(self) -> None:
        async_to_sync(self._assert_bulk_update)()

    async def _assert_bulk_update(self) -> None:
        for name in ('First', 'Second'):
            await sync_to_async(create_notification)(
                recipient=self.user,
                notification_type=Notification.TYPE_CROP_SPECIES_PROPOSAL_ACCEPTED,
                message=name,
            )
        communicator = self._communicator(authenticated=True)
        self.assertTrue((await communicator.connect())[0])

        await sync_to_async(mark_all_notifications_read)(self.user)
        event = await communicator.receive_json_from()
        self.assertEqual(event, {'type': 'notifications.updated', 'notification_id': None})
        self.assertTrue(await communicator.receive_nothing(timeout=0.1))

        await sync_to_async(mark_all_notifications_read)(self.user)
        self.assertTrue(await communicator.receive_nothing(timeout=0.1))
        await communicator.disconnect()

    def test_unauthenticated_connection_is_rejected(self) -> None:
        async_to_sync(self._assert_rejected)()

    async def _assert_rejected(self) -> None:
        communicator = self._communicator(authenticated=False)
        connected, close_code = await communicator.connect()
        self.assertFalse(connected)
        self.assertEqual(close_code, 4401)

    def _communicator(self, *, authenticated: bool) -> WebsocketCommunicator:
        headers = [(b'host', b'localhost'), (b'origin', b'http://localhost')]
        if authenticated:
            headers.append(self.cookie_header)
        return WebsocketCommunicator(
            application,
            '/ws/notifications/',
            headers=headers,
        )
