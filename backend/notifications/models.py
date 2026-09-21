"""In-app notifications addressed to a single user.

Deliberately generic: the app knows nothing about crop species, crops, or
any other domain. Producers hand in a ``notification_type``, a ``context``
payload, and an optional target reference; consumers decide what to render and
where to navigate. Adding a notification kind is a choices entry plus a
frontend translation, never a schema change.

The stored ``message`` is English on purpose (see CLAUDE.md: API responses stay
English) and exists for the admin, logs, and non-UI API consumers. The app UI
never renders it — the frontend builds the localized text from
``notification_type`` + ``context`` through i18n, so the same row reads German
for a German user and English for an English one.
"""
from __future__ import annotations

from django.conf import settings
from django.db import models


class Notification(models.Model):
    TYPE_CROP_SPECIES_PROPOSAL_ACCEPTED = 'crop_species_proposal_accepted'
    TYPE_CROP_SPECIES_PROPOSAL_REJECTED = 'crop_species_proposal_rejected'
    TYPE_CROP_SPECIES_PROPOSAL_SUBMITTED = 'crop_species_proposal_submitted'
    TYPE_MODERATOR_REQUEST_SUBMITTED = 'moderator_request_submitted'
    TYPE_PUBLIC_CROP_REMOVED = 'public_crop_removed'
    TYPE_PUBLIC_CROP_SPECIES_RELINK_CANCELLED = 'public_crop_species_relink_cancelled'
    TYPE_CROP_SPECIES_REASSIGNED = 'crop_species_reassigned'
    TYPE_CHOICES = [
        (TYPE_CROP_SPECIES_PROPOSAL_ACCEPTED, 'Crop species proposal accepted'),
        (TYPE_CROP_SPECIES_PROPOSAL_REJECTED, 'Crop species proposal rejected'),
        (TYPE_CROP_SPECIES_PROPOSAL_SUBMITTED, 'Crop species proposal submitted'),
        (TYPE_MODERATOR_REQUEST_SUBMITTED, 'Moderator request submitted'),
        (TYPE_PUBLIC_CROP_REMOVED, 'Public crop removed'),
        (TYPE_PUBLIC_CROP_SPECIES_RELINK_CANCELLED, 'Public crop species correction cancelled'),
        (TYPE_CROP_SPECIES_REASSIGNED, 'Crop species reassigned'),
    ]

    TARGET_CROP = 'crop'
    TARGET_PUBLIC_CROP = 'public_crop'
    TARGET_CROP_SPECIES = 'crop_species'
    TARGET_PUBLIC_LIBRARY_MODERATION = 'public_library_moderation'
    TARGET_TYPE_CHOICES = [
        (TARGET_CROP, 'Project crop'),
        (TARGET_PUBLIC_CROP, 'Public crop'),
        (TARGET_CROP_SPECIES, 'Crop species'),
        (TARGET_PUBLIC_LIBRARY_MODERATION, 'Public library moderation queue'),
    ]

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='notifications',
    )
    notification_type = models.CharField(max_length=64, choices=TYPE_CHOICES)
    message = models.TextField(
        help_text='English fallback text for admin/API consumers; the app UI localizes '
                  'notification_type + context instead.',
    )
    context = models.JSONField(
        default=dict,
        blank=True,
        help_text='Placeholder values for the localized message, e.g. {"name": "Pumpkin"}.',
    )
    target_type = models.CharField(max_length=32, choices=TARGET_TYPE_CHOICES, blank=True)
    target_id = models.IntegerField(null=True, blank=True)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [
            # The bell polls "my unread count" on every app load, so the
            # recipient + is_read pair is the one access path worth indexing.
            models.Index(fields=['recipient', 'is_read']),
        ]

    def __str__(self) -> str:
        return f'{self.notification_type} → {self.recipient_id}'
