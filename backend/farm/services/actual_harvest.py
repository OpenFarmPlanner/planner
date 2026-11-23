"""Resolve and record harvest dates without changing forecasts or occupancy."""

from dataclasses import replace
from datetime import date

from django.core.exceptions import ValidationError

from farm.models import PlantingPlan, Season
from farm.services.seasonal_harvest import (
    HarvestActualDates,
    HarvestActualOccurrencePayload,
    RecurringHarvestSchedule,
    legacy_actual_occurrence_year,
    one_off_harvest_actuals,
    recurring_actual_occurrences,
    recurring_harvest_actuals,
)

HARVEST_DATE_FIELDS = ('actual_harvest_start_date', 'recorded_harvest_end_date')


def harvest_actual_occurrences(
    plan: PlantingPlan, season: Season, schedule: RecurringHarvestSchedule | None,
    planned: tuple[date | None, date | None],
) -> list[HarvestActualOccurrencePayload]:
    if schedule is not None:
        return recurring_actual_occurrences(plan, season, schedule)
    actual = one_off_harvest_actuals(plan)
    planned_start, planned_end = planned
    planned_here = HarvestActualDates(planned_start, planned_end).intersects(season)
    if plan.season_id != season.pk and not (
        plan.bed_id and plan.planting_date and plan.planting_date <= season.end_date
        and (planned_here or actual.intersects(season))
    ):
        return []
    return [{
        'year': None,
        'planned_start_date': planned_start if planned_here else None,
        'planned_end_date': planned_end if planned_here else None,
        'actual_start_date': actual.start_date,
        'actual_end_date': actual.end_date,
    }]


def update_harvest_actuals(
    plan: PlantingPlan, schedule: RecurringHarvestSchedule | None, year: int | None,
    changes: dict[str, date | None],
) -> tuple[str, ...]:
    """Apply a partial edit to a locked plan. The caller verifies season scope."""
    if schedule is None:
        previous = one_off_harvest_actuals(plan)
        updated = replace(previous, **changes)
        if updated == previous:
            return ()
        planting = min(
            (value for value in (
                plan.planting_date, plan.actual_sowing_date, plan.actual_transplanting_date,
            ) if value is not None), default=None,
        )
        _validate_dates(updated, changes, planting)
        fields = []
        for name, model_field in zip(('start_date', 'end_date'), HARVEST_DATE_FIELDS, strict=True):
            if getattr(previous, name) != getattr(updated, name):
                setattr(plan, model_field, getattr(updated, name))
                fields.append(model_field)
        return tuple(fields)

    if year is None:
        raise ValueError('An occurrence year is required for a recurring harvest.')
    dates_by_year = recurring_harvest_actuals(plan, schedule)
    previous = dates_by_year.get(year, HarvestActualDates())
    updated = replace(previous, **changes)
    if updated == previous:
        return ()
    _validate_dates(updated, changes, schedule.occupied_from, schedule.occupied_until)
    boundary = tuple(value for value in (updated.start_date, updated.end_date) if value is not None)
    if boundary:
        _validate_occurrence_cycle(schedule, year, changes)
        _validate_neighbouring_actuals(year, boundary, dates_by_year)

    storage = plan.harvest_occurrence_actuals
    legacy_year = legacy_actual_occurrence_year(plan, schedule)
    occurrences = dict(storage.get('occurrences', {}))
    if updated or year == legacy_year:
        # A cleared legacy entry still overrides the legacy plan-level dates.
        occurrences[str(year)] = {
            'start_date': updated.start_date.isoformat() if updated.start_date else None,
            'end_date': updated.end_date.isoformat() if updated.end_date else None,
        }
    else:
        occurrences.pop(str(year), None)
    plan.harvest_occurrence_actuals = {'occurrences': occurrences}
    if legacy_year is not None:
        plan.harvest_occurrence_actuals['legacy_year'] = legacy_year
    return ('harvest_occurrence_actuals',)


def _validate_dates(
    actual: HarvestActualDates, changes: dict[str, date | None],
    planting: date | None, clearing: date | None = None,
) -> None:
    if actual.start_date and actual.end_date and actual.start_date > actual.end_date:
        raise ValidationError({
            'end_date': 'The harvest end must be on or after the harvest start.',
        })
    for field, value in changes.items():
        if value and ((planting and value < planting) or (clearing and value > clearing)):
            raise ValidationError({field: 'Use a date within the crop’s occupancy.'})


def _validate_occurrence_cycle(
    schedule: RecurringHarvestSchedule, year: int, changes: dict[str, date | None],
) -> None:
    if schedule.eligible_window(year) is None:
        return
    previous = schedule.default_window(year - 1)[0] if year > date.min.year else None
    following = schedule.default_window(year + 1)[0] if year < date.max.year else None
    for field, value in changes.items():
        if value and ((previous and value <= previous) or (following and value >= following)):
            raise ValidationError({field: 'Use a date for the selected harvest occurrence.'})


def _validate_neighbouring_actuals(
    year: int, dates: tuple[date, ...], actuals: dict[int, HarvestActualDates],
) -> None:
    for other_year, actual in actuals.items():
        if other_year == year or not actual:
            continue
        other_dates = tuple(
            value for value in (actual.start_date, actual.end_date) if value is not None
        )
        if (other_year < year and max(other_dates) >= min(dates)) or (
            other_year > year and min(other_dates) <= max(dates)
        ):
            raise ValidationError({
                'year': 'Recorded harvests must be ordered by occurrence and cannot overlap.',
            })
