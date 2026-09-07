"""DRF serializers for note attachments."""

from rest_framework import serializers

from farm.common.serializer_fields import AuditUserSerializer
from farm.models import NoteAttachment


class NoteAttachmentUploadSerializer(serializers.ModelSerializer):
    """Validate the user-controlled metadata for a note image upload."""

    class Meta:
        model = NoteAttachment
        fields = ["caption"]
        extra_kwargs = {
            "caption": {
                "default": "",
                "trim_whitespace": False,
            },
        }


class NoteAttachmentSerializer(serializers.ModelSerializer):
    """Serializer for note image attachments."""

    image_url = serializers.SerializerMethodField()
    created_by_user = AuditUserSerializer(source='created_by', read_only=True)
    updated_by_user = AuditUserSerializer(source='updated_by', read_only=True)

    def get_image_file(self, obj):
        if not obj.image_file_id:
            return None
        return {
            'id': obj.image_file_id,
            'storage_path': obj.image_file.storage_path,
        }

    class Meta:
        model = NoteAttachment
        fields = [
            "id",
            "planting_plan",
            "image",
            "image_url",
            "caption",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
            "created_by_user",
            "updated_by_user",
            "width",
            "height",
            "size_bytes",
            "mime_type",
        ]
        read_only_fields = [
            "id",
            "planting_plan",
            "created_at",
            "updated_at",
            "created_by",
            "updated_by",
            "width",
            "height",
            "size_bytes",
            "mime_type",
        ]

    def get_image_url(self, obj):
        request = self.context.get("request")
        if not obj.image:
            return None
        if request:
            return request.build_absolute_uri(obj.image.url)
        return obj.image.url
