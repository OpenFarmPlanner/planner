"""Serializer for companion-planting relations (good and bad neighbours)."""

from typing import Any

from django.db.models import Q
from rest_framework import serializers

from farm.common.serializer_fields import _resolve_active_project_from_serializer
from farm.models import Crop, CropCompanion
from farm.services.crop_companions import active_relations, is_kultur
from farm.utils import normalize_text


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
        crop: Crop | None = merged['crop']
        companion_crop: Crop | None = merged['companion_crop']
        for field_name, value in (('crop', crop), ('companion_crop', companion_crop)):
            self._validate_kultur(field_name, value)

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
                raise serializers.ValidationError(
                    {'companion_crop': 'A crop cannot be its own neighbour.'},
                )
            if companion_crop.id < crop.id:
                attrs['crop'], attrs['companion_crop'] = companion_crop, crop
        if 'companion_text' in attrs:
            attrs['companion_text'] = (attrs['companion_text'] or '').strip()

        self._reject_duplicate({**merged, **attrs})
        return attrs

    def _validate_kultur(self, field_name: str, crop: Crop | None) -> None:
        """A relation's crop must be an active Kultur of the active project."""
        if crop is None:
            return
        project = _resolve_active_project_from_serializer(self)
        if project is not None and crop.project_id != project.id:
            raise serializers.ValidationError(
                {field_name: 'Crop does not belong to the active project.'},
            )
        if crop.deleted_at is not None:
            raise serializers.ValidationError({field_name: 'Crop has been deleted.'})
        if not is_kultur(crop):
            raise serializers.ValidationError(
                {field_name: 'Neighbours belong to the general crop, not to a variety.'},
            )

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


def _target_key(item: dict[str, Any]) -> tuple[str, Any] | None:
    """What one relation points at, seen from the Kultur, as a comparable key."""
    companion_crop = item.get('companion_crop')
    if companion_crop is not None:
        return ('crop', getattr(companion_crop, 'pk', companion_crop))
    family = item.get('companion_family')
    if family is not None:
        return ('family', getattr(family, 'pk', family))
    text = normalize_text(item.get('companion_text') or '')
    return ('text', text) if text else None


def relation_target_key(relation: CropCompanion, kultur_id: int) -> tuple[str, Any]:
    if relation.companion_crop_id is not None:
        other = relation.companion_crop_id if relation.crop_id == kultur_id else relation.crop_id
        return ('crop', other)
    if relation.companion_family_id is not None:
        return ('family', relation.companion_family_id)
    return ('text', normalize_text(relation.companion_text))


class CropCompanionReplaceSerializer(serializers.Serializer):
    """A Kultur's whole neighbour list, as the crop form saves it.

    Each item names the neighbour from the Kultur's side (``companion_crop``,
    ``companion_family`` or ``companion_text``). An item whose neighbour is
    already listed updates that relation, a new one is created, and every
    relation of the Kultur the list leaves out is deleted, a shared pair
    included.
    """

    crop = serializers.PrimaryKeyRelatedField(queryset=Crop.objects.all())
    relations = serializers.ListField(
        child=serializers.DictField(), allow_empty=True, max_length=200,
    )

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        kultur: Crop = attrs['crop']
        CropCompanionSerializer(context=self.context)._validate_kultur('crop', kultur)
        existing = {
            relation_target_key(relation, kultur.id): relation
            for relation in active_relations(kultur.project_id).filter(
                Q(crop=kultur) | Q(companion_crop=kultur),
            )
        }
        children: list[CropCompanionSerializer] = []
        errors: dict[int, Any] = {}
        seen: set[tuple[str, Any]] = set()
        for position, item in enumerate(attrs['relations']):
            data = {
                'companion_crop': item.get('companion_crop'),
                'companion_family': item.get('companion_family'),
                'companion_text': item.get('companion_text') or '',
                'kind': item.get('kind'),
                'reason': item.get('reason', CropCompanion.REASON_OTHER),
                'note': item.get('note') or '',
                'crop': kultur.id,
            }
            key = _target_key(data)
            if key is not None and key in seen:
                errors[position] = {'companion': ['This neighbour is already listed.']}
                continue
            if key is not None:
                seen.add(key)
            child = CropCompanionSerializer(
                instance=existing.get(key) if key is not None else None,
                data=data,
                context=self.context,
            )
            if not child.is_valid():
                errors[position] = child.errors
                continue
            children.append(child)
        if errors:
            raise serializers.ValidationError({'relations': errors})
        attrs['children'] = children
        kept = {id(child.instance) for child in children if child.instance is not None}
        attrs['removed'] = [relation for relation in existing.values() if id(relation) not in kept]
        return attrs
