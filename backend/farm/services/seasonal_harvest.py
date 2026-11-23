"""Project a perennial crop's recurring harvest within a plan's occupancy."""

from calendar import monthrange
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import TypedDict

from django.db.models import F, Q, QuerySet

from farm.models import PlantingPlan, Season
from farm.services.crop_inheritance import (
    GeneralCropIndex,
    build_general_crop_index,
    plan_cultivation_type,
    resolve_crop_field,
)

HARVEST_YEARS_PER_PAGE = 20


@dataclass(frozen=True)
class HarvestProjection:
    """Inclusive display dates and the full window used to prorate yield."""

    start_date: date
    end_date: date
    window_start: date
    window_end: date


class SeasonalHarvestPeriod(TypedDict):
    start_date: date
    end_date: date


@dataclass(frozen=True)
class HarvestActualDates:
    start_date: date | None = None
    end_date: date | None = None

    def intersects(self, season: Season) -> bool:
        dates = [value for value in (self.start_date, self.end_date) if value is not None]
        return bool(dates and min(dates) <= season.end_date and max(dates) >= season.start_date)

    def __bool__(self) -> bool:
        return self.start_date is not None or self.end_date is not None


class HarvestActualOccurrencePayload(TypedDict):
    year: int | None
    planned_start_date: date | None
    planned_end_date: date | None
    actual_start_date: date | None
    actual_end_date: date | None


class HarvestOccurrencePayload(TypedDict):
    year: int
    default: SeasonalHarvestPeriod | None
    override: SeasonalHarvestPeriod | None
    conflict: bool
    actual_start_date: date | None
    actual_end_date: date | None


class HarvestOccurrencesPage(TypedDict):
    occurrences: list[HarvestOccurrencePayload]
    previous_year: int | None
    next_year: int | None


class SeasonalHarvestPayload(TypedDict):
    periods: list[SeasonalHarvestPeriod]
    occupancy_start_date: date | None
    planting_recorded: bool
    actual_start_date: date | None
    actual_end_date: date | None


def seasonal_harvest_payload(
    plan: PlantingPlan, season: Season, schedule: 'RecurringHarvestSchedule',
) -> SeasonalHarvestPayload:
    projected = list(schedule.project_by_year(season.start_date, season.end_date))
    occurrences = recurring_actual_occurrences(plan, season, schedule, projected)
    primary = occurrences[0] if occurrences else None
    return {
        'periods': [
            {'start_date': projection.start_date, 'end_date': projection.end_date}
            for _, projection in projected
        ],
        'occupancy_start_date': schedule.occupied_from,
        'planting_recorded': schedule.planting_recorded,
        'actual_start_date': primary['actual_start_date'] if primary is not None else None,
        'actual_end_date': primary['actual_end_date'] if primary is not None else None,
    }


@dataclass(frozen=True)
class RecurringHarvestSchedule:
    start: tuple[int, int]
    end: tuple[int, int]
    eligible_from: date | None
    occupied_until: date | None
    # These dates guide season visibility and editing. Eligibility and clearing
    # determine whether copies have the same forecast.
    occupied_from: date | None = field(compare=False)
    planting_recorded: bool = field(compare=False)
    overrides: dict[int, tuple[date, date]] = field(default_factory=dict, hash=False)

    @property
    def crosses_new_year(self) -> bool:
        return self.end < self.start

    def default_window(self, year: int) -> tuple[date, date]:
        start = _day_in_year(year, self.start)
        end_year = year + self.crosses_new_year
        if end_year > date.max.year:
            return start, date.max
        end = _day_in_year(end_year, self.end)
        if self.crosses_new_year:
            # A clamped February 29 start can coincide with the preceding end.
            end = min(end, _day_in_year(end_year, self.start) - timedelta(days=1))
        return start, end

    def eligible_window(self, year: int) -> tuple[date, date] | None:
        if self.eligible_from is None or self.occupied_until is None:
            return None
        start, end = self.default_window(year)
        start = max(start, self.eligible_from)
        end = min(end, self.occupied_until)
        return (start, end) if start <= end else None

    def override_fits(self, year: int, start: date, end: date) -> bool:
        if self.eligible_window(year) is None:
            return False
        _, default_end = self.default_window(year)
        lower = date(year, 1, 1)
        if year > date.min.year:
            _, previous_end = self.default_window(year - 1)
            if start <= previous_end:
                return False
        # Keep the dates attached to the same occurrence, including an
        # existing January tail of a window that started the previous year.
        upper_start = max(date(year, 12, 31), default_end)
        upper_end = date(min(date.max.year, year + self.crosses_new_year), 12, 31)
        if year < date.max.year:
            next_start, _ = self.default_window(year + 1)
            upper_end = min(upper_end, next_start - timedelta(days=1))
        return (
            max(lower, self.eligible_from) <= start <= min(upper_start, end)
            and end <= min(upper_end, self.occupied_until)
        )

    def _eligible_override(self, year: int) -> tuple[date, date] | None:
        override = self.overrides.get(year)
        return override if override and self.override_fits(year, *override) else None

    def _separate_from_neighbours(self, year: int, start: date, end: date) -> bool:
        previous = self._eligible_override(year - 1)
        following = self._eligible_override(year + 1)
        return (
            (previous is None or previous[1] < start)
            and (following is None or end < following[0])
        )

    def effective_override(self, year: int) -> tuple[date, date] | None:
        override = self._eligible_override(year)
        if override and self._separate_from_neighbours(year, *override):
            return override
        return None

    def can_override(self, year: int, start: date, end: date) -> bool:
        return self.override_fits(year, start, end) and self._separate_from_neighbours(
            year, start, end,
        )

    def _eligible_years(self) -> range:
        if (
            self.eligible_from is None or self.occupied_until is None
            or self.eligible_from > self.occupied_until
        ):
            return range(0)
        first = max(date.min.year, self.eligible_from.year - self.crosses_new_year)
        last = self.occupied_until.year
        while first <= last and self.eligible_window(first) is None:
            first += 1
        if first <= last and self.eligible_window(last) is None:
            last -= 1
        return range(first, last + 1)

    def first_conflicting_year(self) -> int | None:
        return min(
            (year for year in self.overrides if self.effective_override(year) is None),
            default=None,
        )

    def year_for_season(self, season: Season) -> int:
        start = season.start_date
        first = max(date.min.year, start.year - self.crosses_new_year)
        last = min(date.max.year, start.year + 1, season.end_date.year)
        for year in range(first, last + 1):
            window = self.effective_override(year) or self.eligible_window(year)
            if window and window[0] <= season.end_date and window[1] >= start:
                return year
        return start.year

    def harvest_starts_between(self, start: date, end: date) -> Iterator[tuple[int, date]]:
        """Yield each occurrence's stable year and its eligible first day."""
        eligible = self._eligible_years()
        first = max(eligible.start, start.year - self.crosses_new_year)
        stop = min(eligible.stop, end.year + 1)
        for year in range(first, stop):
            window = self.effective_override(year) or self.eligible_window(year)
            if window is not None and start <= window[0] <= end:
                yield year, window[0]

    def harvest_start_dates(
        self, seasons: Iterable[tuple[int, date, date]],
    ) -> dict[int, tuple[date, int]]:
        """Assign each start to the first concrete season containing it."""
        expected = {}
        for season_id, start, end in seasons:
            for year, due in self.harvest_starts_between(start, end):
                expected.setdefault(year, (due, season_id))
        return expected

    def legacy_harvest_year(self, due: date | None) -> int | None:
        if due is None:
            return None
        if self.crosses_new_year and due.year > date.min.year:
            start, end = self.default_window(due.year - 1)
            if start <= due <= end:
                return due.year - 1
        return due.year

    def occurrence_details(
        self, year: int | None = None, *, actuals: dict[int, HarvestActualDates],
        recorded_years: set[int],
    ) -> HarvestOccurrencesPage:
        eligible = self._eligible_years()
        stored_years = self.overrides.keys() | recorded_years
        if not eligible and not stored_years:
            return {'occurrences': [], 'previous_year': None, 'next_year': None}

        first = min(stored_years, default=eligible.start)
        if eligible:
            first = min(first, eligible.start)
        anchor = first if year is None else year
        candidates = set(stored_years)
        if eligible:
            candidates.add(max(eligible.start, min(anchor, eligible.stop - 1)))
        anchor = min(candidates, key=lambda candidate: (abs(candidate - anchor), candidate))
        page_start = first + (anchor - first) // HARVEST_YEARS_PER_PAGE * HARVEST_YEARS_PER_PAGE
        page_end = page_start + HARVEST_YEARS_PER_PAGE

        years = (
            year for year in range(page_start, page_end)
            if year in eligible or year in stored_years
        )
        previous_default = min(eligible.stop, page_start) - 1
        next_default = max(eligible.start, page_end)
        if previous_default in eligible:
            candidates.add(previous_default)
        if next_default in eligible:
            candidates.add(next_default)
        return {
            'occurrences': [
                self._occurrence_detail(year, actuals.get(year, HarvestActualDates()))
                for year in years
            ],
            'previous_year': max((year for year in candidates if year < page_start), default=None),
            'next_year': min((year for year in candidates if year >= page_end), default=None),
        }

    def _occurrence_detail(self, year: int, actual: HarvestActualDates) -> HarvestOccurrencePayload:
        override = self.overrides.get(year)
        return {
            'year': year,
            'default': _period(self.eligible_window(year)),
            'override': _period(override),
            'conflict': bool(override and self.effective_override(year) is None),
            'actual_start_date': actual.start_date,
            'actual_end_date': actual.end_date,
        }

    def project(self, start_date: date, end_date: date) -> list[HarvestProjection]:
        """Intersect the annual windows, eligibility, occupancy and requested period."""
        return [projection for _, projection in self.project_by_year(start_date, end_date)]

    def project_by_year(
        self, start_date: date, end_date: date,
    ) -> Iterator[tuple[int, HarvestProjection]]:
        """Keep the occurrence year even when clipping or overriding its dates."""
        if self.eligible_from is None or self.occupied_until is None:
            return
        start_date = max(start_date, self.eligible_from)
        end_date = min(end_date, self.occupied_until)
        if start_date > end_date:
            return

        first_year = max(date.min.year, start_date.year - self.crosses_new_year)
        for year in range(first_year, end_date.year + 1):
            window_start, window_end = self.effective_override(year) or self.default_window(year)
            start = max(window_start, start_date)
            end = min(window_end, end_date)
            if start <= end:
                yield year, HarvestProjection(start, end, window_start, window_end)


def one_off_harvest_actuals(plan: PlantingPlan) -> HarvestActualDates:
    return HarvestActualDates(plan.actual_harvest_start_date, plan.recorded_harvest_end_date)


def legacy_actual_occurrence_year(
    plan: PlantingPlan, schedule: RecurringHarvestSchedule,
) -> int | None:
    if 'legacy_year' in plan.harvest_occurrence_actuals:
        return plan.harvest_occurrence_actuals['legacy_year']
    actual = one_off_harvest_actuals(plan)
    anchor = actual.start_date or actual.end_date
    if anchor is None:
        return None
    return next(
        (year for year, _ in schedule.project_by_year(anchor, anchor)),
        schedule.legacy_harvest_year(anchor),
    )


def recurring_harvest_actuals(
    plan: PlantingPlan, schedule: RecurringHarvestSchedule,
) -> dict[int, HarvestActualDates]:
    raw = one_off_harvest_actuals(plan)
    legacy_year = legacy_actual_occurrence_year(plan, schedule)
    actuals = {legacy_year: raw} if raw and legacy_year is not None else {}
    return actuals | recorded_occurrence_dates(plan.harvest_occurrence_actuals)


def recorded_occurrence_dates(storage: dict) -> dict[int, HarvestActualDates]:
    return {
        int(year): HarvestActualDates(*(
            date.fromisoformat(dates[field]) if dates.get(field) is not None else None
            for field in ('start_date', 'end_date')
        ))
        for year, dates in storage.get('occurrences', {}).items()
    }


def harvest_occurrence_page(
    plan: PlantingPlan, schedule: RecurringHarvestSchedule, year: int | None,
) -> HarvestOccurrencesPage:
    actuals = recurring_harvest_actuals(plan, schedule)
    # Only saved occurrence records extend the lifetime page. The old
    # plan-level dates can still supply actuals for a scheduled year.
    recorded = {
        int(key) for key in plan.harvest_occurrence_actuals.get('occurrences', {})
        if actuals[int(key)]
    }
    return schedule.occurrence_details(year, actuals=actuals, recorded_years=recorded)


def recurring_actual_occurrences(
    plan: PlantingPlan, season: Season, schedule: RecurringHarvestSchedule,
    projected: Iterable[tuple[int, HarvestProjection]] | None = None,
) -> list[HarvestActualOccurrencePayload]:
    if projected is None:
        projected = schedule.project_by_year(season.start_date, season.end_date)
    planned_years = {year for year, _ in projected}
    actuals = recurring_harvest_actuals(plan, schedule)
    years = planned_years | {year for year, actual in actuals.items() if actual.intersects(season)}
    result: list[HarvestActualOccurrencePayload] = []
    for year in sorted(years):
        window = schedule.effective_override(year) or schedule.eligible_window(year)
        actual = actuals.get(year, HarvestActualDates())
        result.append({
            'year': year,
            'planned_start_date': window[0] if window is not None else None,
            'planned_end_date': window[1] if window is not None else None,
            'actual_start_date': actual.start_date,
            'actual_end_date': actual.end_date,
        })
    def starts_in_season(occurrence: HarvestActualOccurrencePayload) -> bool:
        return any(
            value is not None and season.start_date <= value <= season.end_date
            for value in (occurrence['planned_start_date'], occurrence['actual_start_date'])
        )

    # The occurrence starting in the selected season takes precedence over
    # the tail of the preceding occurrence when both fall in the same season.
    return sorted(result, key=lambda occurrence: not starts_in_season(occurrence))


def _period(interval: tuple[date, date] | None) -> SeasonalHarvestPeriod | None:
    return {'start_date': interval[0], 'end_date': interval[1]} if interval else None


def _day_in_year(year: int, month_day: tuple[int, int]) -> date:
    month, day = month_day
    return date(year, month, min(day, monthrange(year, month)[1]))


def _first_eligible_day(planted: date | None, delay: int) -> date | None:
    if planted is None:
        return None
    eligibility_year = planted.year + delay
    if eligibility_year > date.max.year:
        return None
    return _day_in_year(eligibility_year, (planted.month, planted.day))


def recurring_harvest_schedule(
    plan: PlantingPlan, crop_index: GeneralCropIndex | None = None,
) -> RecurringHarvestSchedule | None:
    """Return a schedule for configured perennials and None for one-off plans."""
    if resolve_crop_field(plan.crop, 'life_cycle', crop_index) != 'perennial':
        return None
    window = resolve_crop_field(plan.crop, 'annual_harvest_window', crop_index)
    if not window:
        return None
    start, end = window.split('/')
    start_month, start_day = map(int, start.split('-'))
    end_month, end_day = map(int, end.split('-'))
    cultivation = plan_cultivation_type(plan, crop_index)
    actual = (
        plan.actual_sowing_date if cultivation == 'direct_sowing'
        else plan.actual_transplanting_date
    )
    planted = (actual or plan.planting_date) if plan.planting_date is not None else None
    occupied_from = min(planted, plan.planting_date) if planted is not None else None
    delay = resolve_crop_field(plan.crop, 'first_harvest_delay_years', crop_index) or 0
    overrides = {
        int(year): (
            date.fromisoformat(period['start_date']), date.fromisoformat(period['end_date']),
        )
        for year, period in plan.harvest_window_overrides.items()
    }
    return RecurringHarvestSchedule(
        (start_month, start_day), (end_month, end_day),
        _first_eligible_day(planted, delay), plan.occupancy_end_date, occupied_from,
        actual is not None, overrides,
    )


def early_recorded_planting_candidates(start: date, end: date) -> Q:
    """Select possible early carry-ins before resolving crop inheritance in bulk."""
    return Q(
        bed__isnull=False, crop__isnull=False, planting_date__gte=start,
        occupied_until__gte=start,
    ) & (
        Q(actual_sowing_date__lte=end, actual_sowing_date__lt=F('planting_date'))
        | Q(actual_transplanting_date__lte=end, actual_transplanting_date__lt=F('planting_date'))
    )


def early_recorded_perennial_plan_ids(
    plans: QuerySet[PlantingPlan], project_id: int, start: date, end: date,
) -> tuple[list[int], GeneralCropIndex | None]:
    """Resolve the few plans whose actual occupancy starts before their planned date."""
    candidates = list(plans.alias(occupied_until=PlantingPlan.occupancy_end_expression()).filter(
        early_recorded_planting_candidates(start, end),
    ).select_related('crop').order_by())
    if not candidates:
        return [], None

    crop_index = build_general_crop_index(project_id)
    return [
        plan.pk for plan in candidates
        if (schedule := recurring_harvest_schedule(plan, crop_index)) is not None
        and schedule.occupied_from is not None
        and schedule.occupied_from < plan.planting_date
        and schedule.occupied_from <= end
    ], crop_index


def recurring_plan_visible_in_season(
    plan: PlantingPlan, season: Season, schedule: RecurringHarvestSchedule,
) -> bool:
    """Keep the owning plan and any assigned bed occupancy intersecting the season."""
    if plan.season_id == season.pk:
        return True
    return bool(
        plan.bed_id is not None
        and plan.planting_date is not None
        and schedule.occupied_from is not None and schedule.occupied_from <= season.end_date
        and schedule.occupied_until is not None and schedule.occupied_until >= season.start_date
        and (plan.planting_date < season.start_date or schedule.occupied_from < plan.planting_date)
    )
