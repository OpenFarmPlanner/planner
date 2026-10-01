"""Creation and bulk-update helpers for in-app notifications.

Producers call :func:`create_notification` instead of writing ``Notification``
rows directly, so the "never notify an inactive/missing recipient" rule and the
context/target shape stay in one place.
"""
from __future__ import annotations

from typing import Any

from django.contrib.auth.models import AbstractBaseUser

from .models import Notification
from .realtime import schedule_notification_update


def create_notification(
    *,
    recipient: AbstractBaseUser | None,
    notification_type: str,
    message: str,
    context: dict[str, Any] | None = None,
    target_type: str = '',
    target_id: int | None = None,
) -> Notification | None:
    """Store one notification, or return ``None`` when there is nobody to notify.

    ``message`` is the English fallback text (admin/API); the UI renders
    ``notification_type`` + ``context`` through its own translations.
    """
    if recipient is None or not getattr(recipient, 'is_active', True):
        return None
    return Notification.objects.create(
        recipient=recipient,
        notification_type=notification_type,
        message=message,
        context=context or {},
        target_type=target_type,
        target_id=target_id,
    )


def mark_all_notifications_read(recipient: AbstractBaseUser) -> int:
    """Mark every unread notification of ``recipient`` as read in one UPDATE.

    Covers exactly the rows the unread badge counts, so the badge drops to zero
    afterwards. Idempotent: a second call finds nothing left and returns ``0``.
    A queryset ``update()`` fires no ``post_save``, so the recipient's other
    open tabs are invalidated here — once, and only when something changed.
    """
    updated = Notification.objects.filter(recipient=recipient, is_read=False).update(is_read=True)
    if updated:
        schedule_notification_update(recipient.pk, None)
    return updated
