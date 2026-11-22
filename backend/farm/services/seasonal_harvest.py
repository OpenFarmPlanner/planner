"""Project a perennial crop's recurring harvest within a plan's occupancy."""

from calendar import monthrange
from dataclasses import dataclass
from datetime import date, timedelta
from typing import TypedDict

from farm.models import PlantingPlan, Season
from farm.services.crop_inheritance import GeneralCropIndex, resolve_crop_field
from farm.services.tasks import plan_cultivation_type


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


class SeasonalHarvestPayload(TypedDict):
    periods: list[SeasonalHarvestPeriod]
    actual_start_date: date | None
    actual_end_date: date | None


def seasonal_harvest_payload(
    plan: PlantingPlan, season: Season, projections: list[HarvestProjection],
) -> SeasonalHarvestPayload:
    def within_season(value: date | None) -> date | None:
        return value if value and season.start_date <= value <= season.end_date else None

    return {
        'periods': [
            {'start_date': projection.start_date, 'end_date': projection.end_date}
            for projection in projections
        ],
        'actual_start_date': within_season(plan.actual_harvest_start_date),
        'actual_end_date': within_season(plan.recorded_harvest_end_date),
    }


@dataclass(frozen=True)
class RecurringHarvestSchedule:
    start: tuple[int, int]
    end: tuple[int, int]
    eligible_from: date | None
    occupied_until: date | None

    def project(self, start_date: date, end_date: date) -> list[HarvestProjection]:
        """Intersect the annual windows, eligibility, occupancy and requested period."""
        if self.eligible_from is None or self.occupied_until is None:
            return []
        start_date = max(start_date, self.eligible_from)
        end_date = min(end_date, self.occupied_until)
        if start_date > end_date:
            return []

        crosses_new_year = self.end < self.start
        first_year = max(date.min.year, start_date.year - int(crosses_new_year))
        projections = []
        for year in range(first_year, end_date.year + 1):
            end_year = year + int(crosses_new_year)
            window_start = _day_in_year(year, self.start)
            window_end = _day_in_year(end_year, self.end) if end_year <= date.max.year else date.max
            if crosses_new_year and end_year <= date.max.year:
                # A clamped February 29 start can coincide with the preceding end.
                window_end = min(window_end, _day_in_year(end_year, self.start) - timedelta(days=1))
            start = max(window_start, start_date)
            end = min(window_end, end_date)
            if start <= end:
                projections.append(HarvestProjection(start, end, window_start, window_end))
        return projections


def _day_in_year(year: int, month_day: tuple[int, int]) -> date:
    month, day = month_day
    return date(year, month, min(day, monthrange(year, month)[1]))


def _first_eligible_day(plan: PlantingPlan, crop_index: GeneralCropIndex | None) -> date | None:
    if plan.planting_date is None:
        return None
    cultivation = plan_cultivation_type(plan, crop_index)
    if cultivation == 'direct_sowing':
        planted = plan.actual_sowing_date or plan.planting_date
    else:
        planted = plan.actual_transplanting_date or plan.planting_date
    delay = resolve_crop_field(plan.crop, 'first_harvest_delay_years', crop_index) or 0
    eligibility_year = planted.year + delay
    if eligibility_year > date.max.year:
        return None
    return max(plan.planting_date, _day_in_year(eligibility_year, (planted.month, planted.day)))


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
    return RecurringHarvestSchedule(
        (start_month, start_day), (end_month, end_day),
        _first_eligible_day(plan, crop_index), plan.occupancy_end_date,
    )
