"""Stored light tolerances and compatibility with legacy single values."""

from django.core.exceptions import ValidationError

CROP_LIGHT_CHOICES = (
    ('full_sun', 'Full sun'),
    ('partial_shade', 'Partial shade'),
    ('shade', 'Shade'),
)
CROP_LIGHT_VALUES = tuple(value for value, _label in CROP_LIGHT_CHOICES)


def normalize_crop_light(value: object) -> list[str]:
    """Canonicalize a scalar or collection, keeping an empty selection unset."""
    values = value if isinstance(value, list | tuple) else [value]
    return [choice for choice in CROP_LIGHT_VALUES if choice in values]


def validate_crop_light(value: object) -> None:
    if value is None or value == '':
        return
    values = value if isinstance(value, list) else [value]
    if (
        len(values) > len(CROP_LIGHT_VALUES)
        or any(item not in CROP_LIGHT_VALUES for item in values)
    ):
        raise ValidationError('Select full sun, partial shade or shade.')
