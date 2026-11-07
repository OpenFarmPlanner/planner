"""Sowing depth as a range: `sowing_depth_m` is the lower bound, `sowing_depth_max_m` the upper.

A single depth is a range of one value, so both bounds are always stored
together: when only one is set, the other gets the same value. Before the
range existed, `sowing_depth_m` (`sowing_depth_cm` in the API) was the only
field; a write that still sends only that field means one depth and sets both
bounds. Details: docs/sowing-depth.md.
"""

import math
from typing import Any

SOWING_DEPTH_MIN_FIELD = 'sowing_depth_m'
SOWING_DEPTH_MAX_FIELD = 'sowing_depth_max_m'
SOWING_DEPTH_FIELDS = (SOWING_DEPTH_MIN_FIELD, SOWING_DEPTH_MAX_FIELD)

RANGE_ORDER_MESSAGE = 'The maximum must be greater than or equal to the minimum.'


def complete_single_depth_write(values: dict[str, Any]) -> None:
    """A write that sets only the lower bound is a single depth: set the upper bound too.

    Keeps clients from before the range working (the agent API, open tabs,
    library proposals); they send `sowing_depth_m` alone.
    """
    if SOWING_DEPTH_MIN_FIELD in values and SOWING_DEPTH_MAX_FIELD not in values:
        values[SOWING_DEPTH_MAX_FIELD] = values[SOWING_DEPTH_MIN_FIELD]


def fill_missing_depth_bound(instance: Any) -> None:
    """Give a missing bound the value of the other one, so one depth is a range of one."""
    lower = getattr(instance, SOWING_DEPTH_MIN_FIELD)
    upper = getattr(instance, SOWING_DEPTH_MAX_FIELD)
    if lower is None and upper is not None:
        setattr(instance, SOWING_DEPTH_MIN_FIELD, upper)
    elif upper is None and lower is not None:
        setattr(instance, SOWING_DEPTH_MAX_FIELD, lower)


def sowing_depth_errors(instance: Any, values: dict[str, Any] | None = None) -> dict[str, str]:
    """Validate the bounds a write would leave, falling back to the stored row."""
    values = values or {}

    def value(field: str) -> Any:
        return values.get(field, getattr(instance, field, None))

    errors: dict[str, str] = {}
    for field in SOWING_DEPTH_FIELDS:
        depth = value(field)
        if depth is not None and (not math.isfinite(depth) or depth < 0):
            errors[field] = 'Sowing depth must be non-negative.'
    lower, upper = value(SOWING_DEPTH_MIN_FIELD), value(SOWING_DEPTH_MAX_FIELD)
    if not errors and lower is not None and upper is not None and lower > upper:
        errors[SOWING_DEPTH_MAX_FIELD] = RANGE_ORDER_MESSAGE
    return errors
