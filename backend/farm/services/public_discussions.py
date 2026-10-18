"""Soft deletion of public-crop discussion comments.

An author deletion clears the body. A moderation removal keeps the original
text in the database for later review; the serializer never exposes the body
of a deleted comment.
"""

from typing import Any

from django.utils import timezone

from farm.models import PublicCropDiscussionComment


def delete_comment_by_author(comment: PublicCropDiscussionComment) -> None:
    if comment.deleted_at:
        return
    comment.body = ''
    comment.deleted_at = timezone.now()
    comment.deleted_by_id = comment.created_by_id
    comment.save(update_fields=['body', 'deleted_at', 'deleted_by', 'updated_at'])


def remove_comment_by_moderation(comment: PublicCropDiscussionComment, moderator: Any) -> None:
    if comment.deleted_at:
        return
    comment.deleted_at = timezone.now()
    comment.deleted_by = moderator
    comment.save(update_fields=['deleted_at', 'deleted_by', 'updated_at'])
