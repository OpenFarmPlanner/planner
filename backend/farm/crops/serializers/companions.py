"""Serializer for companion-planting relations (good and bad neighbours)."""

from typing import Any

from rest_framework import serializers

from farm.common.serializer_fields import _resolve_active_project_from_serializer
from farm.models import Crop, CropCompanion
from farm.services.crop_companions import is_kultur


class CropCompanionSerializer(serializers.ModelSerializer):
    """One relation; between two Kulturen the lower crop id is stored as ``crop``.

    A client may send the pair in either order; it is stored canonically, so
    the same pair cannot exist twice.
    """

    class Meta:
        model = CropCompanion
        fields = [
            'id',
            'crop',
            'companion_crop',
            'companion_family',
            'companion_text',
            'kind',
            'reason',
            'note',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']
        validators = []

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        attrs = super().validate(attrs)
        merged = self._merged_values(attrs)
        project = _resolve_active_project_from_serializer(self)
        crop: Crop | None = merged['crop']
        companion_crop: Crop | None = merged['companion_crop']

        for field_name, value in (('crop', crop), ('companion_crop', companion_crop)):
            if value is None:
                continue
            if project is not None and value.project_id != project.id:
                raise serializers.ValidationError({field_name: 'Crop does not belong to the active project.'})
            if value.deleted_at is not None:
                raise serializers.ValidationError({field_name: 'Crop has been deleted.'})
            if not is_kultur(value):
                raise serializers.ValidationError(
                    {field_name: 'Neighbours belong to the general crop, not to a variety.'},
                )

        targets = [
            companion_crop is not None,
            merged['companion_family'] is not None,
            bool((merged['companion_text'] or '').strip()),
        ]
        if sum(targets) != 1:
            raise serializers.ValidationError(
                'Exactly one of companion_crop, companion_family or companion_text is required.',
            )
        if companion_crop is not None and crop is not None:
            if companion_crop.id == crop.id:
                raise serializers.ValidationError({'companion_crop': 'A crop cannot be its own neighbour.'})
            if companion_crop.id < crop.id:
                attrs['crop'], attrs['companion_crop'] = companion_crop, crop
        if 'companion_text' in attrs:
            attrs['companion_text'] = (attrs['companion_text'] or '').strip()

        self._reject_duplicate({**merged, **attrs})
        return attrs

    def _merged_values(self, attrs: dict[str, Any]) -> dict[str, Any]:
        """The values after this write: the payload over the instance's current ones."""
        names = ('crop', 'companion_crop', 'companion_family', 'companion_text')
        return {
            name: attrs[name] if name in attrs else getattr(self.instance, name, None)
            for name in names
        }

    def _reject_duplicate(self, values: dict[str, Any]) -> None:
        crop = values['crop']
        if crop is None:
            return
        if values['companion_crop'] is not None:
            lookup = {'companion_crop': values['companion_crop']}
        elif values['companion_family'] is not None:
            lookup = {'companion_family': values['companion_family']}
        else:
            lookup = {'companion_text': (values['companion_text'] or '').strip()}
        existing = CropCompanion.objects.filter(crop=crop, **lookup)
        if self.instance is not None:
            existing = existing.exclude(pk=self.instance.pk)
        if existing.exists():
            raise serializers.ValidationError(
                {'companion': 'This neighbour is already listed.'}, code='duplicate_companion',
            )
