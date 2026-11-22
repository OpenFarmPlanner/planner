"""Validate the yearless interval stored on perennial crop records."""

import re
from datetime import date

from django.core.exceptions import ValidationError

_MONTH_DAY_RANGE = re.compile(r'([0-9]{2})-([0-9]{2})/([0-9]{2})-([0-9]{2})')


def validate_annual_harvest_window(value: str) -> None:
    """Validate both endpoints in a leap year, including windows through New Year."""
    if value == '':
        return
    match = _MONTH_DAY_RANGE.fullmatch(value)
    if match:
        start_month, start_day, end_month, end_day = map(int, match.groups())
        try:
            date(2000, start_month, start_day)
            date(2000, end_month, end_day)
        except ValueError:
            pass
        else:
            return
    raise ValidationError(
        'Enter two valid month-day dates as MM-DD/MM-DD.',
        code='invalid_annual_harvest_window',
    )
