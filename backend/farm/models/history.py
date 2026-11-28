"""Entity revision history models (current + deprecated drain-only)."""


from django.conf import settings
from django.db import models

from .projects import Project


class CropRevision(models.Model):
    """Deprecated: superseded by EntityRevision. Retained only so existing rows
    can drain via the cleanup_history command; no new rows are written here."""

    crop = models.ForeignKey('Crop', on_delete=models.CASCADE, related_name='revisions')
    snapshot = models.JSONField()
    changed_fields = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)
    user_name = models.CharField(max_length=150, blank=True)

    class Meta:
        ordering = ['-created_at']


class ProjectRevision(models.Model):
    """Deprecated: superseded by EntityRevision. Retained only so existing rows
    can drain via the cleanup_history command; no new rows are written here."""

    snapshot = models.JSONField()
    summary = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='project_revisions')

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['project', '-created_at']),
        ]


class BatchOperation(models.Model):
    """Groups the EntityRevisions produced by one cascading user action.

    A single user action can cascade into many entity mutations — deleting a
    season, for instance, also deletes every planting plan scheduled in it,
    recording one EntityRevision per plan. A BatchOperation ties those
    revisions together so the version history shows them as one entry with a
    single "undo" that reverts the whole action.

    Deliberately generic: only `operation_type` and `context` vary, so future
    cascades (applying a season pattern, crop-rotation batch edits) reuse this
    without a schema change. `context` carries whatever the frontend needs to
    phrase the summary (e.g. `{"season_label": "25/26"}`).
    """

    TYPE_SEASON_CREATE = 'season_create'
    TYPE_SEASON_DELETE = 'season_delete'
    TYPE_SEASON_UNDELETE = 'season_undelete'
    TYPE_SEASON_COPY_DATA = 'season_copy_data'
    TYPE_REVERTED = 'batch_reverted'
    TYPE_CROP_IMPORT = 'crop_import'
    TYPE_CROP_BULK_DELETE = 'crop_bulk_delete'
    TYPE_CROP_BULK_UNDELETE = 'crop_bulk_undelete'
    TYPE_INDIVIDUAL_PLACEMENT = 'individual_placement'
    TYPE_INDIVIDUAL_REMOVAL = 'individual_removal'
    TYPE_GEOMETRY_CHANGE = 'geometry_change'
    TYPE_CHOICES = [
        (TYPE_SEASON_CREATE, 'Season created'),
        (TYPE_SEASON_DELETE, 'Season deleted'),
        (TYPE_SEASON_UNDELETE, 'Season restored'),
        (TYPE_SEASON_COPY_DATA, 'Season data copied'),
        (TYPE_REVERTED, 'Batch operation reverted'),
        (TYPE_CROP_IMPORT, 'Crops imported'),
        (TYPE_CROP_BULK_DELETE, 'Crops archived'),
        (TYPE_CROP_BULK_UNDELETE, 'Archived crops restored'),
        (TYPE_INDIVIDUAL_PLACEMENT, 'Individual plants placed'),
        (TYPE_INDIVIDUAL_REMOVAL, 'Individual plants removed'),
        (TYPE_GEOMETRY_CHANGE, 'Growing-area geometry changed'),
    ]

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='batch_operations')
    operation_type = models.CharField(max_length=40, choices=TYPE_CHOICES)
    context = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    user_name = models.CharField(max_length=150, blank=True)
    reverted_at = models.DateTimeField(null=True, blank=True)
    request_id = models.UUIDField(null=True, blank=True, unique=True)
    initiated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='+',
    )
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['project', '-created_at']),
            models.Index(
                fields=['operation_type', 'completed_at'], name='farm_batch_type_completed_idx',
            ),
        ]

    def __str__(self) -> str:
        """Return a short description for admin and debug output."""
        return f'{self.operation_type} #{self.pk}'


class EntityRevision(models.Model):
    """Per-entity snapshot recorded on every create/update/delete/restore.

    Replaces the old ProjectRevision (full-project JSON dump per mutation) and
    CropRevision (per-crop only) with one generic, per-entity-sized
    record. A revision's `snapshot` holds the full field dict of the single
    entity at that point in time (not the whole project), so write cost scales
    with entity size instead of project size. Point-in-time project restore is
    reconstructed by taking, for every (entity_type, object_id), the latest
    revision at or before the target time.

    `batch_operation` is set when the revision was produced as part of a
    cascading action (see `BatchOperation`); it stays NULL for ordinary
    single-entity edits.
    """

    ACTION_CREATED = 'created'
    ACTION_UPDATED = 'updated'
    ACTION_DELETED = 'deleted'
    ACTION_RESTORED = 'restored'
    ACTION_CHOICES = [
        (ACTION_CREATED, 'Created'),
        (ACTION_UPDATED, 'Updated'),
        (ACTION_DELETED, 'Deleted'),
        (ACTION_RESTORED, 'Restored'),
    ]

    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='entity_revisions')
    entity_type = models.CharField(max_length=32)
    object_id = models.PositiveIntegerField()
    action = models.CharField(max_length=10, choices=ACTION_CHOICES)
    display_name = models.CharField(max_length=255, blank=True)
    snapshot = models.JSONField()
    changed_fields = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    user_name = models.CharField(max_length=150, blank=True)
    batch_operation = models.ForeignKey(
        BatchOperation,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='revisions',
    )

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['project', '-created_at']),
            models.Index(fields=['project', 'entity_type', 'object_id', '-created_at']),
        ]
