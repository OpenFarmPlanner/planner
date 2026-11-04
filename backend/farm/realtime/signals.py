from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from farm.models import PublicCropDiscussionComment, PublicCropDiscussionTopic

from .groups import public_crop_discussion_group


def broadcast_discussion_update(public_crop_id: int, discussion_id: int) -> None:
    """Publish a small invalidation after the surrounding write commits."""
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return
    async_to_sync(channel_layer.group_send)(
        public_crop_discussion_group(public_crop_id),
        {
            'type': 'discussion.updated',
            'public_crop_id': public_crop_id,
            'discussion_id': discussion_id,
        },
    )


def _schedule(public_crop_id: int, discussion_id: int) -> None:
    transaction.on_commit(
        lambda: broadcast_discussion_update(public_crop_id, discussion_id),
        robust=True,
    )


@receiver([post_save, post_delete], sender=PublicCropDiscussionTopic)
def topic_changed(
    sender: type[PublicCropDiscussionTopic],
    instance: PublicCropDiscussionTopic,
    **kwargs: object,
) -> None:
    _schedule(instance.public_crop_id, instance.id)


@receiver([post_save, post_delete], sender=PublicCropDiscussionComment)
def comment_changed(
    sender: type[PublicCropDiscussionComment],
    instance: PublicCropDiscussionComment,
    **kwargs: object,
) -> None:
    _schedule(instance.topic.public_crop_id, instance.topic_id)
