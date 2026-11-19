import json
from typing import Any

from django.core.serializers.json import DjangoJSONEncoder

from crops.plant_health_values import plant_health_identities
from farm.crop_light import normalize_crop_light


def comparable_copy_fields(payload: dict[str, Any]) -> dict[str, Any]:
    """Comparison-only normalization; never change the payload used for writes.

    A seed-rate unit without a seed rate carries no information. The crop
    form drops it on save, while a library entry may still hold one.
    """
    if payload.get('seed_rate_value') is None and not payload.get('seed_rate_by_cultivation'):
        return {**payload, 'seed_rate_unit': None}
    return payload


def json_safe(value: Any) -> Any:
    return json.loads(json.dumps(value, cls=DjangoJSONEncoder))


_EMPTY_SNAPSHOT_VALUES: tuple[Any, ...] = (None, '', [], {})


def same_public_field_value(field: str, value: Any, other: Any) -> bool:
    if field == 'plant_health':
        return plant_health_identities(value) == plant_health_identities(other)
    if field == 'light_requirement':
        return normalize_crop_light(value) == normalize_crop_light(other)
    return value == other


def same_snapshot_value(value: Any, snapshot_value: Any, *, field: str | None = None) -> bool:
    """Legacy empty spellings compare equally; health overrides preserve inheritance intent."""
    if field in {'plant_health', 'light_requirement'}:
        return same_public_field_value(field, value, snapshot_value)
    if value in _EMPTY_SNAPSHOT_VALUES and snapshot_value in _EMPTY_SNAPSHOT_VALUES:
        return True
    return value == snapshot_value
