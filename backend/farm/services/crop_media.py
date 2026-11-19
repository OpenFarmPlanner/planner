from django.db.models import Exists, OuterRef
from django.utils import timezone

from farm.models import Crop, EntityRevision, MediaFile, NoteAttachment


def with_live_media_reference(queryset):
    return queryset.annotate(
        has_live_reference=(
            Exists(Crop.objects.filter(image_file_id=OuterRef('pk')))
            | Exists(NoteAttachment.objects.filter(image=OuterRef('storage_path')))
        ),
    )


def reconcile_media_orphans(
    project_id: int, *, media_ids: set[int] | None = None, record_history: bool = False,
) -> None:
    """Reconcile project-owned media after reference changes under the project lock."""
    media = MediaFile.objects.filter(project_id=project_id)
    if media_ids is not None:
        media = media.filter(pk__in=media_ids)
    update_time = None
    for row in with_live_media_reference(media).order_by('pk'):
        if row.has_live_reference == (row.orphaned_at is None):
            continue
        if not row.has_live_reference and update_time is None:
            update_time = timezone.now()
        row.orphaned_at = None if row.has_live_reference else update_time
        row.save(update_fields=['orphaned_at'])
        if record_history:
            _record_orphan_marker(row)


def _record_orphan_marker(media: MediaFile) -> None:
    from farm.history.records import (
        _serialize_instance,
        internal_project_versions,
        record_entity_revision,
    )

    with internal_project_versions():
        record_entity_revision(
            project=media.project, entity_type='media_file', object_id=media.pk,
            action=EntityRevision.ACTION_UPDATED, snapshot=_serialize_instance(media),
            changed_fields=['orphaned_at'],
        )
