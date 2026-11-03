"""Serializers for a crop's timing windows (Anzucht, Direktsaat, Pflanzung, Ernte)."""

from typing import Any

from rest_framework import serializers

from farm.services.timing_windows import (
    DECADES,
    MAX_ISO_WEEK,
    TIMING_WINDOW_KINDS,
    TIMING_WINDOW_UNITS,
    UNIT_DECADE,
    UNIT_ISO_WEEK,
    TimingWindow,
    validate_timing_window,
)

_UNIT_FIELDS: dict[str, tuple[str, ...]] = {
    UNIT_DECADE: ('start_month', 'start_decade', 'end_month', 'end_decade'),
    UNIT_ISO_WEEK: ('start_week', 'end_week'),
}

_WINDOW_ERRORS: dict[str, str] = {
    'incomplete': 'Start and end are required.',
    'invalid_month': 'Months must be between 1 and 12.',
    'invalid_decade': 'Thirds of a month must be early, mid or late.',
    'invalid_week': 'Calendar weeks must be between 1 and 52.',
    'mixed_units': 'A window uses either thirds of a month or calendar weeks, never both.',
    'invalid_kind': 'Unknown window kind.',
    'invalid_unit': 'Unknown window unit.',
}


class TimingWindowSerializer(serializers.Serializer):
    """One window in exactly one unit; the other unit's fields stay null."""

    kind = serializers.ChoiceField(
        choices=TIMING_WINDOW_KINDS,
        help_text=(
            'pre_cultivation (Anzucht), direct_sowing or planting. There is no harvest kind: '
            'the harvest follows from the planting date and the growth duration.'
        ),
    )
    unit = serializers.ChoiceField(
        choices=TIMING_WINDOW_UNITS,
        help_text=(
            'decade: start/end month plus third of the month (early = day 1-10, '
            'mid = 11-20, late = 21 to month end); iso_week: start/end ISO week 1-52. '
            'A start after the end wraps the year end.'
        ),
    )
    start_month = serializers.IntegerField(
        min_value=1, max_value=12, required=False, allow_null=True,
    )
    start_decade = serializers.ChoiceField(choices=DECADES, required=False, allow_null=True)
    end_month = serializers.IntegerField(min_value=1, max_value=12, required=False, allow_null=True)
    end_decade = serializers.ChoiceField(choices=DECADES, required=False, allow_null=True)
    start_week = serializers.IntegerField(
        min_value=1, max_value=MAX_ISO_WEEK, required=False, allow_null=True,
    )
    end_week = serializers.IntegerField(
        min_value=1, max_value=MAX_ISO_WEEK, required=False, allow_null=True,
    )

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        unit_fields = _UNIT_FIELDS[attrs['unit']]
        window = TimingWindow.from_dict({
            'kind': attrs['kind'],
            'unit': attrs['unit'],
            **{field: attrs.get(field) for field in unit_fields},
        })
        foreign_values = [
            field for fields in _UNIT_FIELDS.values() for field in fields
            if field not in unit_fields and attrs.get(field) is not None
        ]
        error = 'mixed_units' if foreign_values else validate_timing_window(window)
        if error:
            raise serializers.ValidationError(_WINDOW_ERRORS[error], code=error)
        return window.as_dict()


class EffectiveTimingWindowSerializer(TimingWindowSerializer):
    """A window a crop plans with, flagged when it comes from the general Kultur."""

    inherited = serializers.BooleanField(
        help_text="True when the window is the general Kultur's (the Sorte has none of this kind).",
    )


class TimingWindowListField(serializers.ListField):
    """The crop's own windows: written as a whole list, read from the parent's per-request index."""

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(child=TimingWindowSerializer(), **kwargs)

    def get_attribute(self, instance: Any) -> list[dict[str, Any]]:
        return self.parent.own_timing_windows(instance)

    def to_representation(self, data: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return data
