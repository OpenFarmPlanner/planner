"""Read/mark-read API for the signed-in user's own notifications.

Strictly self-scoped: the queryset filters on ``request.user`` and there is no
create endpoint — notifications are produced server-side by
``notifications.services.create_notification``.
"""
from __future__ import annotations

from django.db.models import QuerySet
from django.shortcuts import get_object_or_404
from rest_framework import mixins, permissions, viewsets
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response

from .models import Notification
from .serializers import NotificationSerializer
from .services import mark_all_notifications_read

_BOOLEAN_QUERY_VALUES = {'true': True, 'false': False, '1': True, '0': False}


class NotificationViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def _recipient_queryset(self) -> QuerySet[Notification]:
        return Notification.objects.filter(recipient=self.request.user)

    def get_queryset(self) -> QuerySet[Notification]:
        """The user's own notifications, optionally narrowed by ``is_read``.

        The topbar dropdown lists unread entries only. Without this filter it
        would have to pick them out of one page of the full history, which
        silently disagrees with the unread count once the newest page holds no
        unread row.
        """
        queryset = self._recipient_queryset()
        requested = str(self.request.query_params.get('is_read', '')).lower()
        is_read = _BOOLEAN_QUERY_VALUES.get(requested)
        if is_read is not None:
            queryset = queryset.filter(is_read=is_read)
        return queryset

    def list(self, request: Request, *args, **kwargs) -> Response:
        """Newest first, with the unread count attached to the same payload.

        The bell needs both numbers on every app load; folding the count into
        the list response keeps that a single request instead of two. The count
        always covers the whole account, never just the filtered page.
        """
        response = super().list(request, *args, **kwargs)
        unread_count = self._recipient_queryset().filter(is_read=False).count()
        if isinstance(response.data, dict):
            response.data['unread_count'] = unread_count
        else:
            response.data = {'results': response.data, 'unread_count': unread_count}
        return response

    @action(detail=True, methods=['post'], url_path='read')
    def mark_read(self, request: Request, pk: str | None = None) -> Response:
        # Resolved against the unfiltered recipient queryset: an `is_read`
        # parameter left on the URL must not decide whether a row can be
        # marked read. Someone else's id still 404s.
        notification = get_object_or_404(self._recipient_queryset(), pk=pk)
        if not notification.is_read:
            notification.is_read = True
            notification.save(update_fields=['is_read'])
        return Response(self.get_serializer(notification).data)

    @action(detail=False, methods=['post'], url_path='read-all')
    def mark_all_read(self, request: Request) -> Response:
        """Mark every unread notification of the caller as read, in one request.

        The scope is the unread badge's, never the list filter's: an ``is_read``
        parameter left on the URL is ignored, so the badge is always zero after.
        """
        marked_read = mark_all_notifications_read(request.user)
        return Response({'marked_read': marked_read})
