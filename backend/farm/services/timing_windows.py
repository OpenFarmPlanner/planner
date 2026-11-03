"""Timing windows of a crop (Anzucht, Direktsaat, Pflanzung).

There is deliberately no harvest kind: a plan's harvest follows from its
planting date and the crop's growth duration
(``PlantingPlan.calculate_effective_harvest_dates``), so a separate harvest
window would be a second, contradicting source.

A window is stored in the unit it was entered in, never as a converted date:

- ``decade``: a start and an end month (1-12), each with a third of the month
  (``early`` = day 1-10, ``mid`` = day 11-20, ``late`` = day 21 to the last day).
- ``iso_week``: a start and an end ISO calendar week, 1-52. Week 53 is never
  accepted; a window across the year end covers it anyway.

A window turns into real dates only for a concrete year, here: the month end
and leap years come from the real calendar, ISO weeks run from the Monday of
the start week to the Sunday of the end week. A window whose start lies after
its end wraps the year end; for a date in year ``Y`` both candidates count,
start in ``Y-1`` to end in ``Y`` and start in ``Y`` to end in ``Y+1``.

Every rule lives here, so the import, the planning hints and the sowing-month
filter resolve windows identically. The frontend keeps a small equivalent
(``frontend/src/crops/timingWindows.ts``); the shared cases in
``tests/fixtures/timing_windows.json`` keep both sides consistent.
Details: ``docs/timing-windows.md``.
"""

from __future__ import annotations

import calendar
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from farm.models import Crop, CropTimingWindow

KIND_PRE_CULTIVATION = 'pre_cultivation'
KIND_DIRECT_SOWING = 'direct_sowing'
KIND_PLANTING = 'planting'
# Display, form and export order.
TIMING_WINDOW_KINDS: tuple[str, ...] = (
    KIND_PRE_CULTIVATION,
    KIND_DIRECT_SOWING,
    KIND_PLANTING,
)
# The kinds the "sowing possible in month" filter reads.
SOWING_KINDS: tuple[str, ...] = (KIND_PRE_CULTIVATION, KIND_DIRECT_SOWING)

UNIT_DECADE = 'decade'
UNIT_ISO_WEEK = 'iso_week'
TIMING_WINDOW_UNITS: tuple[str, ...] = (UNIT_DECADE, UNIT_ISO_WEEK)

DECADE_EARLY = 'early'
DECADE_MID = 'mid'
DECADE_LATE = 'late'
DECADES: tuple[str, ...] = (DECADE_EARLY, DECADE_MID, DECADE_LATE)
# Stored as 1-3 so a database constraint can range-check it.
DECADE_NUMBERS: dict[str, int] = {DECADE_EARLY: 1, DECADE_MID: 2, DECADE_LATE: 3}
DECADE_BY_NUMBER: dict[int, str] = {number: decade for decade, number in DECADE_NUMBERS.items()}
_DECADE_FIRST_DAY: dict[str, int] = {DECADE_EARLY: 1, DECADE_MID: 11, DECADE_LATE: 21}

MAX_ISO_WEEK = 52


@dataclass(frozen=True)
class TimingWindow:
    """One window of one kind, in exactly one unit.

    Decade windows set the four month/decade fields, week windows the two week
    fields; the other unit's fields stay ``None``.
    """

    kind: str
    unit: str
    start_month: int | None = None
    start_decade: str | None = None
    end_month: int | None = None
    end_decade: str | None = None
    start_week: int | None = None
    end_week: int | None = None

    @classmethod
    def decade(
        cls, kind: str, start_month: int, start_decade: str, end_month: int, end_decade: str,
    ) -> TimingWindow:
        return cls(
            kind=kind, unit=UNIT_DECADE,
            start_month=start_month, start_decade=start_decade,
            end_month=end_month, end_decade=end_decade,
        )

    @classmethod
    def weeks(cls, kind: str, start_week: int, end_week: int) -> TimingWindow:
        return cls(kind=kind, unit=UNIT_ISO_WEEK, start_week=start_week, end_week=end_week)

    @classmethod
    def from_model(cls, row: CropTimingWindow) -> TimingWindow:
        return cls(
            kind=row.kind,
            unit=row.unit,
            start_month=row.start_month,
            start_decade=DECADE_BY_NUMBER.get(row.start_decade) if row.start_decade else None,
            end_month=row.end_month,
            end_decade=DECADE_BY_NUMBER.get(row.end_decade) if row.end_decade else None,
            start_week=row.start_week,
            end_week=row.end_week,
        )

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> TimingWindow:
        """From the API/snapshot shape (see :meth:`as_dict`); no validation."""
        return cls(
            kind=data['kind'],
            unit=data['unit'],
            start_month=data.get('start_month'),
            start_decade=data.get('start_decade'),
            end_month=data.get('end_month'),
            end_decade=data.get('end_decade'),
            start_week=data.get('start_week'),
            end_week=data.get('end_week'),
        )

    def as_dict(self) -> dict[str, Any]:
        """The API and history-snapshot shape: every field, unused ones ``None``."""
        return {
            'kind': self.kind,
            'unit': self.unit,
            'start_month': self.start_month,
            'start_decade': self.start_decade,
            'end_month': self.end_month,
            'end_decade': self.end_decade,
            'start_week': self.start_week,
            'end_week': self.end_week,
        }

    def model_kwargs(self) -> dict[str, Any]:
        """Keyword arguments for a ``CropTimingWindow`` row (decades as 1-3)."""
        return {
            'kind': self.kind,
            'unit': self.unit,
            'start_month': self.start_month,
            'start_decade': DECADE_NUMBERS.get(self.start_decade or ''),
            'end_month': self.end_month,
            'end_decade': DECADE_NUMBERS.get(self.end_decade or ''),
            'start_week': self.start_week,
            'end_week': self.end_week,
        }

    @property
    def wraps_year_end(self) -> bool:
        """Whether the start lies after the end, i.e. the window spans New Year."""
        if self.unit == UNIT_ISO_WEEK:
            return (self.start_week or 0) > (self.end_week or 0)
        start = ((self.start_month or 0), DECADE_NUMBERS.get(self.start_decade or '', 0))
        end = ((self.end_month or 0), DECADE_NUMBERS.get(self.end_decade or '', 0))
        return start > end


def validate_timing_window(window: TimingWindow) -> str | None:
    """A machine code for what makes the window invalid, or ``None`` when it is valid.

    Mirrors the ``CropTimingWindow`` database constraints, so the API can
    reject a window with a readable error before the database would.
    """
    if window.kind not in TIMING_WINDOW_KINDS:
        return 'invalid_kind'
    if window.unit == UNIT_DECADE:
        return _validate_decade_window(window)
    if window.unit == UNIT_ISO_WEEK:
        return _validate_week_window(window)
    return 'invalid_unit'


def _validate_decade_window(window: TimingWindow) -> str | None:
    if None in (window.start_month, window.start_decade, window.end_month, window.end_decade):
        return 'incomplete'
    if not all(1 <= month <= 12 for month in (window.start_month, window.end_month)):
        return 'invalid_month'
    if window.start_decade not in DECADES or window.end_decade not in DECADES:
        return 'invalid_decade'
    if window.start_week is not None or window.end_week is not None:
        return 'mixed_units'
    return None


def _validate_week_window(window: TimingWindow) -> str | None:
    if window.start_week is None or window.end_week is None:
        return 'incomplete'
    if not all(1 <= week <= MAX_ISO_WEEK for week in (window.start_week, window.end_week)):
        return 'invalid_week'
    decade_fields = (window.start_month, window.start_decade, window.end_month, window.end_decade)
    if any(value is not None for value in decade_fields):
        return 'mixed_units'
    return None


# --------------------------------------------------------------------------
# Resolution to real dates
# --------------------------------------------------------------------------

def _decade_start(year: int, month: int, decade: str) -> date:
    return date(year, month, _DECADE_FIRST_DAY[decade])


def _decade_end(year: int, month: int, decade: str) -> date:
    if decade == DECADE_EARLY:
        return date(year, month, 10)
    if decade == DECADE_MID:
        return date(year, month, 20)
    return date(year, month, calendar.monthrange(year, month)[1])


def _start_in(window: TimingWindow, year: int) -> date:
    if window.unit == UNIT_ISO_WEEK:
        return date.fromisocalendar(year, window.start_week, 1)
    return _decade_start(year, window.start_month, window.start_decade)


def _end_in(window: TimingWindow, year: int) -> date:
    if window.unit == UNIT_ISO_WEEK:
        return date.fromisocalendar(year, window.end_week, 7)
    return _decade_end(year, window.end_month, window.end_decade)


def resolve_window(window: TimingWindow, year: int) -> list[tuple[date, date]]:
    """The date ranges (inclusive) the window stands for when checking a date in ``year``.

    One range for an ordinary window; two for one across the year end (start in
    ``year - 1`` to end in ``year``, and start in ``year`` to end in ``year + 1``).
    """
    if window.wraps_year_end:
        return [
            (_start_in(window, year - 1), _end_in(window, year)),
            (_start_in(window, year), _end_in(window, year + 1)),
        ]
    return [(_start_in(window, year), _end_in(window, year))]


def window_contains(window: TimingWindow, day: date) -> bool:
    """Whether ``day`` lies in the window, resolved in ``day``'s year.

    A week window is also resolved in ``day``'s ISO year, which differs from the
    calendar year for the first and last days of a year (31 Dec 2025 is in
    week 1 of 2026).
    """
    years = {day.year}
    if window.unit == UNIT_ISO_WEEK:
        years.add(day.isocalendar()[0])
    return any(
        start <= day <= end
        for year in years
        for start, end in resolve_window(window, year)
    )


def any_window_contains(windows: Iterable[TimingWindow], day: date) -> bool:
    return any(window_contains(window, day) for window in windows)


def window_overlaps_month(window: TimingWindow, year: int, month: int) -> bool:
    """Whether the window, resolved in ``year``, shares a day with ``month`` of ``year``."""
    month_start = date(year, month, 1)
    month_end = date(year, month, calendar.monthrange(year, month)[1])
    return any(
        start <= month_end and end >= month_start
        for start, end in resolve_window(window, year)
    )


def months_covered(windows: Iterable[TimingWindow], year: int) -> list[int]:
    """The months (1-12) of ``year`` any of the windows overlaps, ascending."""
    window_list = list(windows)
    return [
        month for month in range(1, 13)
        if any(window_overlaps_month(window, year, month) for window in window_list)
    ]


# --------------------------------------------------------------------------
# Canonical text (display and export)
# --------------------------------------------------------------------------

# Kept identical to the frontend's i18n resources (`common:months` and
# `crops:timingWindows`); tests/fixtures/timing_windows.json pins both.
_MONTH_NAMES: dict[str, tuple[str, ...]] = {
    'de': (
        'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
        'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
    ),
    'en': (
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
    ),
    'fr': (
        'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
        'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
    ),
    'es': (
        'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
    ),
}


@dataclass(frozen=True)
class _TextForms:
    decade_month: Mapping[str, str]
    range: str
    week: str
    week_range: str


_TEXT_FORMS: dict[str, _TextForms] = {
    'de': _TextForms(
        decade_month={
            DECADE_EARLY: 'Anfang {month}',
            DECADE_MID: 'Mitte {month}',
            DECADE_LATE: 'Ende {month}',
        },
        range='{start} bis {end}',
        week='KW {week}',
        week_range='KW {start} bis {end}',
    ),
    'en': _TextForms(
        decade_month={
            DECADE_EARLY: 'early {month}', DECADE_MID: 'mid {month}', DECADE_LATE: 'late {month}',
        },
        range='{start} to {end}',
        week='week {week}',
        week_range='week {start} to {end}',
    ),
    'fr': _TextForms(
        decade_month={
            DECADE_EARLY: 'début {month}', DECADE_MID: 'mi-{month}', DECADE_LATE: 'fin {month}',
        },
        range='{start} à {end}',
        week='semaine {week}',
        week_range='semaines {start} à {end}',
    ),
    'es': _TextForms(
        decade_month={
            DECADE_EARLY: 'principios de {month}',
            DECADE_MID: 'mediados de {month}',
            DECADE_LATE: 'finales de {month}',
        },
        range='{start} a {end}',
        week='semana {week}',
        week_range='semanas {start} a {end}',
    ),
}

WINDOW_LIST_SEPARATOR = '; '
DEFAULT_TEXT_LANGUAGE = 'de'


def _language(language_code: str | None) -> str:
    code = (language_code or '').split('-')[0].lower()
    return code if code in _TEXT_FORMS else DEFAULT_TEXT_LANGUAGE


def format_window(window: TimingWindow, language_code: str | None = None) -> str:
    """The canonical text of one window, e.g. "Anfang März bis Mitte Mai" or "KW 10 bis 14"."""
    language = _language(language_code)
    forms = _TEXT_FORMS[language]
    if window.unit == UNIT_ISO_WEEK:
        if window.start_week == window.end_week:
            return forms.week.format(week=window.start_week)
        return forms.week_range.format(start=window.start_week, end=window.end_week)

    months = _MONTH_NAMES[language]
    start_month = months[window.start_month - 1]
    end_month = months[window.end_month - 1]
    if window.start_decade == DECADE_EARLY and window.end_decade == DECADE_LATE:
        if window.start_month == window.end_month:
            return start_month
        return forms.range.format(start=start_month, end=end_month)
    start_text = forms.decade_month[window.start_decade].format(month=start_month)
    if window.start_month == window.end_month and window.start_decade == window.end_decade:
        return start_text
    end_text = forms.decade_month[window.end_decade].format(month=end_month)
    return forms.range.format(start=start_text, end=end_text)


def format_windows(windows: Iterable[TimingWindow], language_code: str | None = None) -> str:
    """Several windows of one kind, joined with "; "."""
    return WINDOW_LIST_SEPARATOR.join(format_window(window, language_code) for window in windows)


# --------------------------------------------------------------------------
# Loading and inheritance helpers
# --------------------------------------------------------------------------

def sort_windows(windows: Iterable[TimingWindow]) -> list[TimingWindow]:
    """Group by kind in display order, keeping the given order within a kind."""
    order = {kind: index for index, kind in enumerate(TIMING_WINDOW_KINDS)}
    return sorted(windows, key=lambda window: order.get(window.kind, len(order)))


def windows_by_kind(windows: Iterable[TimingWindow]) -> dict[str, list[TimingWindow]]:
    grouped: dict[str, list[TimingWindow]] = defaultdict(list)
    for window in windows:
        grouped[window.kind].append(window)
    return dict(grouped)


TimingWindowIndex = dict[int, list[TimingWindow]]


def load_timing_window_index(
    crop_ids: Iterable[int] | None = None,
    *,
    project_id: int | None = None,
) -> TimingWindowIndex:
    """Every window of the given crops (or of a whole project), keyed by crop id, in one query."""
    from farm.models import CropTimingWindow

    queryset = CropTimingWindow.objects.order_by('crop_id', 'position', 'id')
    if project_id is not None:
        queryset = queryset.filter(crop__project_id=project_id)
    if crop_ids is not None:
        queryset = queryset.filter(crop_id__in=list(crop_ids))
    index: TimingWindowIndex = defaultdict(list)
    for row in queryset:
        index[row.crop_id].append(TimingWindow.from_model(row))
    return {crop_id: sort_windows(windows) for crop_id, windows in index.items()}


def replace_crop_timing_windows(crop: Crop, windows: Sequence[TimingWindow]) -> None:
    """Make ``windows`` the crop's own windows, numbering them per kind in the given order.

    Use ``crop._pending_timing_windows`` and ``crop.save()`` instead when the
    change should show up in the crop's history.
    """
    from farm.models import CropTimingWindow

    CropTimingWindow.objects.filter(crop=crop).delete()
    positions: dict[str, int] = defaultdict(int)
    rows = []
    for window in windows:
        position = positions[window.kind]
        rows.append(CropTimingWindow(crop=crop, position=position, **window.model_kwargs()))
        positions[window.kind] += 1
    if rows:
        CropTimingWindow.objects.bulk_create(rows)
