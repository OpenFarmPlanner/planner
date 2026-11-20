"""API endpoints for project-wide and crop history listing and restore."""

from datetime import timedelta

from django.db.models import BooleanField, Case, Q, When
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from config.responses import api_error_response
from farm.crops.serializers import CropSerializer
from farm.models import BatchOperation, Crop, EntityRevision
from farm.project_context import get_active_project_or_400, require_project_admin

from .import_operations import ImportOperationConflict, import_undo_preview, undo_crop_import
from .payloads import build_crop_history_payload
from .project_restore import (
    AUTOMATIC_BACKUP_KEY,
    CHECKPOINT_KEY,
    ProjectRestoreConflict,
    ensure_project_checkpoint,
    restore_project_version,
)
from .records import _current_actor_label
from .restore import (
    BatchRevertError,
    is_latest_project_revision,
    restore_crop_from_revision,
    revert_batch_operation,
)
from .serializers import CropHistoryEntrySerializer, CropRestoreSerializer


class ProjectHistoryListView(APIView):
    """List recent per-entity revisions across the whole project.

    Revisions produced by the same cascading action (see `BatchOperation`) are
    folded into one `is_batch` entry; ungrouped revisions remain flat. The
    newest entry carries `is_current_version`. Snapshots and per-row copies
    of the operation's private context are not needed by this list.
    """

    def get(self, request):
        active_project = get_active_project_or_400(request)
        since = timezone.now() - timedelta(days=30)
        rows = list(
            EntityRevision.objects
            .filter(project=active_project, created_at__gte=since)
            .exclude(
                batch_operation_id__isnull=True, snapshot__has_key="_project_version_internal"
            )
            .annotate(is_automatic_backup=Case(
                When(
                    Q(entity_type='project', action=EntityRevision.ACTION_UPDATED,
                      snapshot__has_key=CHECKPOINT_KEY)
                    & (Q(snapshot__has_key=AUTOMATIC_BACKUP_KEY) | Q(
                        batch_operation__operation_type=BatchOperation.TYPE_REVERTED,
                        batch_operation__context__reverted_operation_type=BatchOperation.TYPE_CROP_IMPORT,
                    )),
                    then=True,
                ),
                default=False, output_field=BooleanField(),
            ))
            .defer('snapshot')
            .order_by('-created_at', '-id')
        )
        batches = BatchOperation.objects.in_bulk({
            row.batch_operation_id for row in rows if row.batch_operation_id
        })
        current_revision_id = rows[0].id if rows else None

        def revision_payload(row):
            entry = {
                'history_id': row.id,
                'history_date': row.created_at,
                'history_type': 'project_snapshot',
                'history_user': row.user_name or None,
                'summary': f'{row.entity_type} {row.action} #{row.object_id}',
                'object_type': row.entity_type,
                'object_id': row.object_id,
                'object_display_name': row.display_name or None,
                'action': row.action,
                'actor_label': row.user_name or None,
                'is_current_version': row.id == current_revision_id,
            }
            if row.is_automatic_backup:
                entry['is_automatic_backup'] = True
            return entry

        payload = []
        groups_by_batch = {}
        for row in rows:
            batch = batches.get(row.batch_operation_id)
            if batch is None or row.is_automatic_backup:
                payload.append(revision_payload(row))
                continue
            group = groups_by_batch.get(batch.id)
            if group is None:
                group = {
                    "is_batch": True,
                    "batch_id": batch.id,
                    "history_id": row.id,
                    "batch_operation_type": batch.operation_type,
                    "batch_context": {
                        key: value
                        for key, value in (batch.context or {}).items()
                        if not key.startswith("_")
                    },
                    "history_date": row.created_at,
                    "is_current_version": row.id == current_revision_id,
                    "history_type": "batch",
                    "history_user": batch.user_name or None,
                    "actor_label": batch.user_name or None,
                    "summary": f"{batch.operation_type} #{batch.id}",
                    "children": [],
                }
                groups_by_batch[batch.id] = group
                payload.append(group)
            if row.entity_type != "project":
                group["children"].append(revision_payload(row))

        for group in groups_by_batch.values():
            group['children'] = CropHistoryEntrySerializer(group['children'], many=True).data

        return Response(CropHistoryEntrySerializer(payload, many=True).data)


class ProjectHistoryRestoreView(APIView):
    """Restore whole project state to a past point in time."""

    def post(self, request):
        active_project = get_active_project_or_400(request)
        require_project_admin(request.user, active_project.id, request=request)
        serializer = CropRestoreSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        revision_id = serializer.validated_data['history_id']

        revision = get_object_or_404(
            EntityRevision.objects.filter(project=active_project), id=revision_id
        )
        if revision.snapshot.get("_project_version_internal"):
            return api_error_response(
                code="project_restore_conflict",
                detail="Select the completed crop action instead of an internal derived revision.",
                status_code=status.HTTP_409_CONFLICT,
            )
        if is_latest_project_revision(active_project, revision):
            return api_error_response(
                code="already_current_version",
                detail="This version is already the current state of the project.",
                status_code=status.HTTP_409_CONFLICT,
            )
        try:
            restore_project_version(
                active_project, revision, user_name=_current_actor_label(request)
            )
        except ProjectRestoreConflict:
            return api_error_response(
                code="project_restore_conflict",
                detail=(
                    "This historical state is incomplete or conflicts with dependent data. "
                    "No changes were made."
                ),
                status_code=status.HTTP_409_CONFLICT,
            )

        return Response({"detail": "Project restored successfully."}, status=status.HTTP_200_OK)


class BatchOperationRevertView(APIView):
    """Undo a whole `BatchOperation` — the single revert action behind a
    grouped history entry."""

    def post(self, request, batch_id):
        active_project = get_active_project_or_400(request)
        require_project_admin(request.user, active_project.id, request=request)
        batch = get_object_or_404(
            BatchOperation.objects.filter(project=active_project),
            id=batch_id,
        )
        try:
            if batch.operation_type == BatchOperation.TYPE_CROP_IMPORT:
                preview = undo_crop_import(
                    active_project, batch, user_name=_current_actor_label(request)
                )
                if preview["conflicts"]:
                    return api_error_response(
                        code="crop_import_undo_conflict",
                        detail="Later edits or dependent records prevent undoing this import.",
                        status_code=status.HTTP_409_CONFLICT,
                        **preview,
                    )
            else:
                revert_batch_operation(
                    active_project, batch, user_name=_current_actor_label(request)
                )
        except ImportOperationConflict as exc:
            return api_error_response(
                code=exc.code, detail='This import cannot be undone.',
                status_code=status.HTTP_409_CONFLICT,
            )
        except (BatchRevertError, ProjectRestoreConflict):
            return api_error_response(
                code="batch_not_revertible",
                detail="This action cannot be reverted.",
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        return Response({"detail": "Reverted."}, status=status.HTTP_200_OK)


class ImportUndoPreviewView(APIView):
    """Preview the same checks used by the atomic selective undo."""

    def post(self, request, batch_id):
        project = get_active_project_or_400(request)
        require_project_admin(request.user, project.pk, request=request)
        batch = get_object_or_404(BatchOperation.objects.filter(project=project), pk=batch_id)
        try:
            return Response(import_undo_preview(project, batch))
        except ImportOperationConflict as exc:
            return api_error_response(
                code=exc.code,
                detail="This import cannot be undone.",
                status_code=status.HTTP_409_CONFLICT,
            )


class GlobalHistoryListView(APIView):
    """List recent history entries across all crops."""

    def get(self, request):
        active_project = get_active_project_or_400(request)
        since = timezone.now() - timedelta(days=30)
        rows = list(
            EntityRevision.objects.filter(
                project=active_project, entity_type="crop", created_at__gte=since
            ).order_by("-created_at")
        )
        payload = build_crop_history_payload(rows, label_crop_in_summary=True)
        return Response(CropHistoryEntrySerializer(payload, many=True).data)


class GlobalHistoryRestoreView(APIView):
    """Restore a crop from a global history entry (supports soft-deleted crops)."""

    def post(self, request):
        active_project = get_active_project_or_400(request)
        require_project_admin(request.user, active_project.id, request=request)
        serializer = CropRestoreSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        revision_id = serializer.validated_data['history_id']

        revision = get_object_or_404(
            EntityRevision.objects.filter(project=active_project, entity_type='crop'),
            id=revision_id,
        )
        crop = get_object_or_404(Crop.all_objects.filter(project=active_project), pk=revision.object_id)
        ensure_project_checkpoint(active_project, user_name=_current_actor_label(request))
        restore_crop_from_revision(crop, revision)

        return Response(CropSerializer(crop).data, status=status.HTTP_200_OK)
