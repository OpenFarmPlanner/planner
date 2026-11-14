import json
from typing import Any

from django.core.serializers.json import DjangoJSONEncoder


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


def same_snapshot_value(value: Any, snapshot_value: Any) -> bool:
    """Equality for snapshots, with every empty spelling counting as the same."""
    if value in _EMPTY_SNAPSHOT_VALUES and snapshot_value in _EMPTY_SNAPSHOT_VALUES:
        return True
    return value == snapshot_value
