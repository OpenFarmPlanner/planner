"""API representation of the curated plant-family list.

Kept apart from ``crops.serializers`` so the farm crop serializers can use the
field and the display-name lookup without importing the crop-library
serializer module (which itself depends on farm's serializers).
"""

from __future__ import annotations

from typing import Any

from rest_framework import serializers

from config.languages import DEFAULT_LANGUAGE_CODE, resolve_request_language

from .models import PlantFamily

PLANT_FAMILY_FIELD_HELP_TEXT = (
    'Plant family as its botanical name, e.g. "Brassicaceae". Must be one of the '
    'families listed by /api/plant-families/; null or "" clears it.'
)

_PLANT_FAMILY_CONTEXT_CACHE_KEY = '_plant_families_by_key'


def _request_language(context: dict[str, Any]) -> str:
    request = context.get('request')
    if request is None:
        return DEFAULT_LANGUAGE_CODE
    return resolve_request_language(request)


def get_plant_families_by_key(context: dict[str, Any]) -> dict[str, PlantFamily]:
    """Every plant family keyed by botanical name, loaded once per serializer context.

    The list is small and global, so one query (plus one for translations)
    serves a whole response instead of one lookup per serialized crop.
    """
    cached = context.get(_PLANT_FAMILY_CONTEXT_CACHE_KEY)
    if cached is None:
        cached = {
            family.pk: family
            for family in PlantFamily.objects.prefetch_related('translations')
        }
        context[_PLANT_FAMILY_CONTEXT_CACHE_KEY] = cached
    return cached


def plant_family_display_name(context: dict[str, Any], family_key: str | None) -> str | None:
    """Localized display name for a botanical-name key, or ``None`` when unset."""
    if not family_key:
        return None
    family = get_plant_families_by_key(context).get(family_key)
    if family is None:
        return family_key
    return family.localized_name(_request_language(context))[0]


def plant_family_default_breaks(context: dict[str, Any]) -> dict[str, int | None]:
    """Botanical name → default rotation break, from the per-context family cache."""
    return {
        key: family.default_rotation_break_years
        for key, family in get_plant_families_by_key(context).items()
    }


class PlantFamilyField(serializers.PrimaryKeyRelatedField):
    """Reads and writes a plant-family reference as its botanical name.

    Matching is case- and whitespace-insensitive (" brassicaceae" finds
    "Brassicaceae"); anything else that is not on the list is rejected with
    a message that says where the valid names come from. Like every DRF
    relational field, ``""`` is treated as ``null``.
    """

    default_error_messages = {
        'does_not_exist': (
            'Unknown plant family "{pk_value}". Use the botanical name of a family '
            'listed by /api/plant-families/, e.g. "Brassicaceae".'
        ),
        'incorrect_type': (
            'Plant family must be given as its botanical name (a string), not {data_type}.'
        ),
    }

    def __init__(self, **kwargs: Any) -> None:
        if not kwargs.get('read_only'):
            kwargs.setdefault('queryset', PlantFamily.objects.all())
        kwargs.setdefault('allow_null', True)
        kwargs.setdefault('required', False)
        kwargs.setdefault('help_text', PLANT_FAMILY_FIELD_HELP_TEXT)
        super().__init__(**kwargs)

    def to_internal_value(self, data: Any) -> PlantFamily:
        if not isinstance(data, str):
            self.fail('incorrect_type', data_type=type(data).__name__)
        key = ' '.join(data.split())
        family = self.get_queryset().filter(botanical_name__iexact=key).first()
        if family is None:
            self.fail('does_not_exist', pk_value=key)
        return family

    def to_representation(self, value: Any) -> str:
        # Effective values arrive as the raw key already; model rows (and
        # DRF's pk-only stand-in) carry it as ``pk``.
        return value if isinstance(value, str) else value.pk


class PlantFamilySerializer(serializers.ModelSerializer):
    """One plant family with its name in the request language."""

    display_name = serializers.SerializerMethodField(
        help_text=(
            'Family name in the request language (falls back to English, then '
            'the botanical name).'
        ),
    )
    translations = serializers.SerializerMethodField(
        help_text='Display name per language code.',
    )

    class Meta:
        model = PlantFamily
        fields = [
            'botanical_name',
            'display_name',
            'translations',
            'default_rotation_break_years',
        ]
        read_only_fields = fields

    def get_display_name(self, obj: PlantFamily) -> str:
        return obj.localized_name(_request_language(self.context))[0]

    def get_translations(self, obj: PlantFamily) -> dict[str, str]:
        return {
            translation.language_code: translation.name
            for translation in obj.translations.all()
        }
