"""Planting-plan hints for dates outside a crop's timing windows.

Never blocks saving. A date is only checked when the crop has effective
windows of the matching kind; without them there is no hint:

- direct sowing: the planting date (which is the sowing date) against the
  Direktsaat windows;
- transplanting from own propagation: the planting date against the
  Pflanzung windows. Only when the crop has no effective Pflanzung windows is
  the sowing date (planting date minus the effective propagation duration)
  checked against the Anzucht windows instead, so one wrong planting date
  gives exactly one hint;
- transplanting bought-in plants: the planting date against the Pflanzung windows.

There are no harvest windows: the harvest follows from the planting date and
the growth duration.

Each date is resolved in its own year (see ``farm/services/timing_windows.py``).
Details: ``docs/timing-windows.md``.
"""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from farm.models import Crop, PlantingPlan
from farm.services.crop_inheritance import (
    GeneralCropIndex,
    build_general_crop_index,
    resolve_crop_field,
    resolve_effective_timing_window_list,
)
from farm.services.timing_windows import (
    KIND_DIRECT_SOWING,
    KIND_PLANTING,
    KIND_PRE_CULTIVATION,
    TimingWindow,
    TimingWindowIndex,
    any_window_contains,
    load_timing_window_index,
    windows_by_kind,
)

PRE_CULTIVATION = 'pre_cultivation'


@dataclass(frozen=True)
class TimingWindowFinding:
    """A plan date outside every window of one kind."""

    kind: str
    checked_date: date
    windows: tuple[TimingWindow, ...]

    def as_dict(self) -> dict[str, Any]:
        return {
            'kind': self.kind,
            'date': self.checked_date.isoformat(),
            'windows': [window.as_dict() for window in self.windows],
        }


def plan_uses_own_propagation(
    plan: PlantingPlan,
    crop: Crop,
    index: GeneralCropIndex | None,
) -> bool:
    """Whether the plan is transplanted from own Anzucht (same rule as the sowing-date column)."""
    if plan.cultivation_type:
        return plan.cultivation_type == PRE_CULTIVATION
    crop_type = resolve_crop_field(crop, 'cultivation_type', index)
    crop_types = resolve_crop_field(crop, 'cultivation_types', index) or []
    return crop_type == PRE_CULTIVATION or PRE_CULTIVATION in crop_types


def dates_to_check(
    plan: PlantingPlan,
    crop: Crop,
    kinds_with_windows: Collection[str],
    index: GeneralCropIndex | None = None,
) -> list[tuple[str, date]]:
    """The (window kind, date) pairs the plan is checked with.

    ``kinds_with_windows`` are the kinds the crop has effective windows of; it
    decides whether own propagation is checked by planting or by sowing date.
    """
    planting_date = plan.planting_date
    if planting_date is None:
        return []
    if plan.cultivation_type == PlantingPlan.CULTIVATION_TYPE_PURCHASED_TRANSPLANT:
        return [(KIND_PLANTING, planting_date)]
    if not plan_uses_own_propagation(plan, crop, index):
        return [(KIND_DIRECT_SOWING, planting_date)]
    if KIND_PLANTING in kinds_with_windows:
        return [(KIND_PLANTING, planting_date)]
    propagation_days = resolve_crop_field(crop, 'propagation_duration_days', index)
    if not propagation_days:
        return []
    try:
        return [(KIND_PRE_CULTIVATION, planting_date - timedelta(days=propagation_days))]
    except OverflowError:
        return []


class TimingWindowChecker:
    """Loads one project's windows once and checks any number of its plans.

    A list response therefore costs one extra query, whatever its length.
    """

    def __init__(self, project_id: int, general_crop_index: GeneralCropIndex | None = None) -> None:
        self.project_id = project_id
        self._general_crop_index = general_crop_index
        self._windows: TimingWindowIndex | None = None

    @property
    def general_crop_index(self) -> GeneralCropIndex:
        if self._general_crop_index is None:
            self._general_crop_index = build_general_crop_index(self.project_id)
        return self._general_crop_index

    @property
    def windows(self) -> TimingWindowIndex:
        if self._windows is None:
            self._windows = load_timing_window_index(project_id=self.project_id)
        return self._windows

    def check_plan(self, plan: PlantingPlan) -> list[TimingWindowFinding]:
        crop = plan.crop
        if crop is None or not self.windows:
            return []
        effective = windows_by_kind(resolve_effective_timing_window_list(
            crop, self.windows, self.general_crop_index,
        ))
        if not effective:
            return []
        findings: list[TimingWindowFinding] = []
        checks = dates_to_check(plan, crop, effective.keys(), self.general_crop_index)
        for kind, checked_date in checks:
            windows = effective.get(kind)
            if windows and not any_window_contains(windows, checked_date):
                findings.append(TimingWindowFinding(kind, checked_date, tuple(windows)))
        return findings
