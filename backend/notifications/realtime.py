from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction


def user_notifications_group(user_id: int) -> str:
    """Return the Channels group for one user's notification stream."""
    return f'user.{user_id}.notifications'


def broadcast_notification_update(recipient_id: int, notification_id: int | None) -> None:
    """Publish a lightweight notification invalidation for one signed-in user.

    ``notification_id`` is ``None`` for a bulk change that touched several rows.
    """
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    async_to_sync(channel_layer.group_send)(
        user_notifications_group(recipient_id),
        {
            'type': 'notifications.updated',
            'notification_id': notification_id,
        },
    )


def schedule_notification_update(recipient_id: int, notification_id: int | None) -> None:
    transaction.on_commit(
        lambda: broadcast_notification_update(recipient_id, notification_id)
    )
