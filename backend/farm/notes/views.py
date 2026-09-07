"""API endpoints for media uploads and note image attachments."""

from django.core.files.storage import default_storage
from django.shortcuts import get_object_or_404
from rest_framework import parsers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.demo_access import guest_demo_forbidden_response, is_active_guest_demo_user
from farm.history import _current_actor_label, _serialize_instance, record_entity_revision
from farm.image_processing import (
    ImageProcessingBackendUnavailableError,
    ImageProcessingError,
    process_note_image,
    validate_image_upload,
)
from farm.models import (
    EntityRevision,
    MediaFile,
    NoteAttachment,
    PlantingPlan,
    crop_media_upload_path,
)
from farm.project_context import get_active_project_or_400

from .serializers import NoteAttachmentSerializer

MAX_MEDIA_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_MEDIA_UPLOAD_CONTENT_TYPES = {
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
}


class MediaFileUploadView(APIView):
    parser_classes = [parsers.MultiPartParser, parsers.FormParser]

    def post(self, request):
        if is_active_guest_demo_user(request.user):
            return guest_demo_forbidden_response()
        active_project = get_active_project_or_400(request)
        upload = request.FILES.get('file')
        if upload is None:
            return Response({'file': ['This field is required.']}, status=status.HTTP_400_BAD_REQUEST)
        if upload.size > MAX_MEDIA_UPLOAD_BYTES:
            return Response({'file': ['File is too large. Maximum allowed size is 10 MB.']}, status=status.HTTP_400_BAD_REQUEST)
        content_type = (getattr(upload, 'content_type', '') or '').lower()
        if content_type not in ALLOWED_MEDIA_UPLOAD_CONTENT_TYPES:
            return Response({'file': ['Unsupported file type. Only image uploads are allowed.']}, status=status.HTTP_400_BAD_REQUEST)

        # The client-supplied Content-Type header and filename are both
        # attacker-controlled, so validate the actual bytes and derive the
        # stored extension from the decoded image format. Without this a member
        # could upload HTML/SVG/script content under an image/* header and have
        # it persisted with a dangerous extension (stored-XSS vector).
        try:
            extension, _mime_type = validate_image_upload(upload)
        except ImageProcessingBackendUnavailableError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except ImageProcessingError:
            return Response({'file': ['Unsupported file type. Only image uploads are allowed.']}, status=status.HTTP_400_BAD_REQUEST)

        rel_path = crop_media_upload_path(None, f'image.{extension}')
        saved_path = default_storage.save(rel_path, upload)
        media = MediaFile.objects.create(project=active_project, storage_path=saved_path)
        record_entity_revision(
            project=active_project,
            entity_type='media_file',
            object_id=media.pk,
            action=EntityRevision.ACTION_CREATED,
            snapshot=_serialize_instance(media),
            user_name=_current_actor_label(request),
        )
        return Response({'id': media.id, 'storage_path': media.storage_path, 'uploaded_at': media.uploaded_at}, status=status.HTTP_201_CREATED)


class NoteAttachmentListCreateView(APIView):
    """List and upload image attachments for a planting plan note."""

    parser_classes = [parsers.MultiPartParser, parsers.FormParser]

    def get(self, request, note_id: int):
        active_project = get_active_project_or_400(request)
        plan = get_object_or_404(PlantingPlan, pk=note_id, project=active_project)
        attachments = plan.attachments.all()
        serializer = NoteAttachmentSerializer(attachments, many=True, context={'request': request})
        return Response(serializer.data)

    def post(self, request, note_id: int):
        if is_active_guest_demo_user(request.user):
            return guest_demo_forbidden_response()
        active_project = get_active_project_or_400(request)
        plan = get_object_or_404(PlantingPlan, pk=note_id, project=active_project)

        if plan.attachments.count() >= 10:
            return Response({'detail': 'Attachment limit per note reached (10).'}, status=status.HTTP_400_BAD_REQUEST)

        upload = request.FILES.get('image')
        if upload is None:
            return Response({'image': ['This field is required.']}, status=status.HTTP_400_BAD_REQUEST)

        caption = request.data.get('caption', '')

        try:
            content, metadata = process_note_image(upload)
        except ImageProcessingBackendUnavailableError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        except ImageProcessingError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        attachment = NoteAttachment(
            planting_plan=plan,
            caption=caption,
            created_by=request.user if request.user.is_authenticated else None,
            updated_by=request.user if request.user.is_authenticated else None,
            project=plan.project,
            width=metadata['width'],
            height=metadata['height'],
            size_bytes=metadata['size_bytes'],
            mime_type=metadata['mime_type'],
        )
        attachment.image.save(str(metadata.get('filename', 'processed.webp')), content, save=False)
        attachment.save()

        serializer = NoteAttachmentSerializer(attachment, context={'request': request})
        record_entity_revision(
            project=attachment.project,
            entity_type='note_attachment',
            object_id=attachment.pk,
            action=EntityRevision.ACTION_CREATED,
            snapshot=_serialize_instance(attachment),
            user_name=_current_actor_label(request),
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class NoteAttachmentDeleteView(APIView):
    """Delete a note attachment."""

    def delete(self, request, attachment_id: int):
        active_project = get_active_project_or_400(request)
        attachment = get_object_or_404(NoteAttachment, pk=attachment_id, project=active_project)
        attachment_id = attachment.pk
        attachment_project = attachment.project
        snapshot = _serialize_instance(attachment)
        attachment.image.delete(save=False)
        attachment.delete()
        record_entity_revision(
            project=attachment_project,
            entity_type='note_attachment',
            object_id=attachment_id,
            action=EntityRevision.ACTION_DELETED,
            snapshot=snapshot,
            changed_fields=[],
            user_name=_current_actor_label(request),
        )
        return Response(status=status.HTTP_204_NO_CONTENT)
