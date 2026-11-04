from unittest.mock import AsyncMock, patch

from django.db import transaction
from redis.exceptions import ConnectionError as RedisConnectionError
from asgiref.sync import async_to_sync, sync_to_async
from channels.testing import WebsocketCommunicator
from channels_redis.core import RedisChannelLayer
from django.contrib.auth import get_user_model
from django.test import Client, TransactionTestCase
from redis.exceptions import TimeoutError as RedisTimeoutError

from config.asgi import application
from farm.models import (
    PublicCrop,
    PublicCropDiscussionComment,
    PublicCropDiscussionTopic,
)
from farm.realtime.channel_layers import IdleTolerantRedisChannelLayer


def test_redis_channel_layer_treats_idle_timeout_as_empty_receive(monkeypatch) -> None:
    async def raise_idle_timeout(self, index: int, channel: str, timeout: int) -> bytes | None:
        raise RedisTimeoutError('Timeout reading from redis socket')

    monkeypatch.setattr(RedisChannelLayer, '_brpop_with_clean', raise_idle_timeout)
    layer = IdleTolerantRedisChannelLayer(hosts=[{'host': 'localhost', 'port': 6379}])

    result = async_to_sync(layer._brpop_with_clean)(0, 'asgitest-channel', 5)

    assert result is None


class DiscussionWebSocketTests(TransactionTestCase):
    def setUp(self) -> None:
        self.user = get_user_model().objects.create_user(
            username='realtime-user', password='test-password'
        )
        self.first_crop = PublicCrop.objects.create(
            name='Tomato', status=PublicCrop.STATUS_PUBLISHED, created_by=self.user
        )
        self.second_crop = PublicCrop.objects.create(
            name='Bean', status=PublicCrop.STATUS_PUBLISHED, created_by=self.user
        )
        client = Client()
        client.force_login(self.user)
        self.cookie_header = (
            b'cookie', f'sessionid={client.cookies["sessionid"].value}'.encode()
        )

    def test_redis_failure_does_not_fail_committed_write_or_later_callbacks(self) -> None:
        later_callbacks: list[str] = []
        with patch('farm.realtime.signals.get_channel_layer') as get_layer:
            get_layer.return_value.group_send = AsyncMock(side_effect=RedisConnectionError('Redis unavailable'))
            with self.assertLogs('django.db.backends.base', level='ERROR') as logs:
                with transaction.atomic():
                    topic = PublicCropDiscussionTopic.objects.create(public_crop=self.first_crop, title='Committed during Redis outage', created_by=self.user)
                    transaction.on_commit(lambda: later_callbacks.append('ran'))
        self.assertTrue(PublicCropDiscussionTopic.objects.filter(pk=topic.pk).exists())
        self.assertEqual(later_callbacks, ['ran'])
        self.assertIn('Redis unavailable', logs.output[0])

    def test_authenticated_connection_receives_only_its_resource_updates(self) -> None:
        async_to_sync(self._assert_isolated_delivery)()

    async def _assert_isolated_delivery(self) -> None:
        first = self._communicator(self.first_crop.id, authenticated=True)
        second = self._communicator(self.second_crop.id, authenticated=True)
        self.assertTrue((await first.connect())[0])
        self.assertTrue((await second.connect())[0])

        unrelated_topic = await sync_to_async(PublicCropDiscussionTopic.objects.create)(
            public_crop=self.second_crop,
            title='Unrelated',
            created_by=self.user,
        )
        await sync_to_async(PublicCropDiscussionComment.objects.create)(
            topic=unrelated_topic, body='Not for the first subscriber', created_by=self.user
        )
        self.assertTrue(await first.receive_nothing(timeout=0.1))
        unrelated_event = await second.receive_json_from()
        self.assertEqual(unrelated_event['public_crop_id'], self.second_crop.id)
        # Topic creation and its first comment are distinct committed changes.
        await second.receive_json_from()

        topic = await sync_to_async(PublicCropDiscussionTopic.objects.create)(
            public_crop=self.first_crop,
            title='Expected',
            created_by=self.user,
        )
        event = await first.receive_json_from()
        self.assertEqual(event, {
            'type': 'discussion.updated',
            'public_crop_id': self.first_crop.id,
            'discussion_id': topic.id,
        })
        self.assertTrue(await second.receive_nothing(timeout=0.1))
        await first.disconnect()
        await second.disconnect()

    def test_unauthenticated_connection_is_rejected(self) -> None:
        async_to_sync(self._assert_rejected)(self.first_crop.id, False)

    def test_unpublished_resource_is_rejected(self) -> None:
        hidden = PublicCrop.objects.create(name='Hidden', status='removed')
        async_to_sync(self._assert_rejected)(hidden.id, True)

    async def _assert_rejected(self, crop_id: int, authenticated: bool) -> None:
        communicator = self._communicator(crop_id, authenticated=authenticated)
        connected, close_code = await communicator.connect()
        self.assertFalse(connected)
        self.assertIn(close_code, {4401, 4403})

    def test_legacy_culture_path_still_connects_and_delivers(self) -> None:
        """A browser running the pre-rename bundle keeps its live discussion.

        A deploy restarts the ASGI process but does not reload open tabs, so
        the old spelling has to stay routable until those clients reconnect.
        """
        async_to_sync(self._assert_legacy_path_delivers)()

    async def _assert_legacy_path_delivers(self) -> None:
        communicator = self._communicator(
            self.first_crop.id, authenticated=True, path_segment='public-cultures'
        )
        self.assertTrue((await communicator.connect())[0])

        topic = await sync_to_async(PublicCropDiscussionTopic.objects.create)(
            public_crop=self.first_crop,
            title='Delivered over the legacy path',
            created_by=self.user,
        )

        event = await communicator.receive_json_from()
        self.assertEqual(event, {
            'type': 'discussion.updated',
            'public_crop_id': self.first_crop.id,
            'discussion_id': topic.id,
        })
        await communicator.disconnect()

    def _communicator(
        self, crop_id: int, *, authenticated: bool, path_segment: str = 'public-crops'
    ) -> WebsocketCommunicator:
        headers = [(b'host', b'localhost'), (b'origin', b'http://localhost')]
        if authenticated:
            headers.append(self.cookie_header)
        return WebsocketCommunicator(
            application,
            f'/ws/{path_segment}/{crop_id}/discussions/',
            headers=headers,
        )
