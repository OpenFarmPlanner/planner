"""Project-scoped task template validation."""

from typing import Any

from rest_framework import serializers

from farm.common.serializer_fields import _resolve_active_project_from_serializer
from farm.models import CropTaskTemplate


class CropTaskTemplateSerializer(serializers.ModelSerializer):
    day_offset = serializers.IntegerField(min_value=-3650, max_value=3650, required=False)

    repeat_interval_days = serializers.IntegerField(
        min_value=1, max_value=3650, required=False, allow_null=True,
    )
    repeat_count = serializers.IntegerField(
        min_value=1, max_value=1000, required=False, allow_null=True,
    )

    class Meta:
        model = CropTaskTemplate
        fields = [
            'id', 'project', 'crop', 'title', 'description', 'reference_event',
            'day_offset', 'repeat_interval_days', 'repeat_until', 'repeat_count',
            'created_at', 'updated_at',
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
        interval = attrs.get(
            'repeat_interval_days', getattr(self.instance, 'repeat_interval_days', None),
        )
        until = attrs.get('repeat_until', getattr(self.instance, 'repeat_until', ''))
        count = attrs.get('repeat_count', getattr(self.instance, 'repeat_count', None))
        if interval is None:
            if until or count is not None:
                raise serializers.ValidationError({
                    'repeat_interval_days': 'Supply a repeat interval.',
                })
        elif not until or (until == 'count' and count is None):
            raise serializers.ValidationError({
                'repeat_until': 'Supply an end condition and count if needed.',
            })
        elif until != 'count' and count is not None:
            raise serializers.ValidationError({
                'repeat_count': 'Only valid with count as end condition.',
            })
        return attrs
