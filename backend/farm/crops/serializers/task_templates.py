"""Project-scoped task template validation."""

from typing import Any

from rest_framework import serializers

from farm.common.serializer_fields import _resolve_active_project_from_serializer
from farm.models import CropTaskTemplate


class CropTaskTemplateSerializer(serializers.ModelSerializer):
    day_offset = serializers.IntegerField(min_value=-3650, max_value=3650, required=False)

    class Meta:
        model = CropTaskTemplate
        fields = [
            'id', 'project', 'crop', 'title', 'description', 'reference_event',
            'day_offset', 'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'project', 'created_at', 'updated_at']

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        crop = attrs.get('crop', getattr(self.instance, 'crop', None))
        project = _resolve_active_project_from_serializer(self)
        if crop is not None and (crop.project_id != project.pk or crop.deleted_at is not None):
            raise serializers.ValidationError({'crop': 'Must be an active crop in the project.'})
        if self.instance is not None and crop.pk != self.instance.crop_id:
            raise serializers.ValidationError({
                'crop': 'A template cannot be moved to another crop.',
            })
        return attrs
