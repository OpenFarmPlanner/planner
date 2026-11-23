"""Resolve and record harvest dates without changing forecasts or occupancy."""

from dataclasses import replace
from datetime import date

from django.core.exceptions import ValidationError
from django.db.models import QuerySet

from farm.models import PlantingPlan, Season
from farm.services.seasonal_harvest import (
    HarvestActualDates,
    HarvestActualOccurrencePayload,
    RecurringHarvestSchedule,
    actual_occurrence_year_for_date,
    legacy_actual_occurrence_year,
    one_off_harvest_actuals,
    recorded_occurrence_dates,
    recurring_actual_occurrences,
    recurring_harvest_actuals,
)

HARVEST_DATE_FIELDS = ('actual_harvest_start_date', 'recorded_harvest_end_date')


def recorded_harvest_plan_ids(plans: QuerySet[PlantingPlan], season: Season) -> list[int]:
    """Find plans with a saved occurrence after their planned occupancy ended."""
    recorded = plans.filter(
        bed__isnull=False, planting_date__lte=season.end_date,
        harvest_occurrence_actuals__has_key='occurrences',
    ).values_list('pk', 'harvest_occurrence_actuals').order_by()
    return [
        plan_id for plan_id, storage in recorded.iterator()
        if any(actual.intersects(season) for actual in recorded_occurrence_dates(storage).values())
    ]


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


def apply_legacy_harvest_patch(
    plan: PlantingPlan, schedule: RecurringHarvestSchedule, season: Season | None,
    fields: dict[str, date | None],
) -> bool:
    """Keep the old plan PATCH effective when its occurrence already has actuals."""
    storage = plan.harvest_occurrence_actuals
    records = storage.get('occurrences', {})
    legacy_year = legacy_actual_occurrence_year(plan, schedule)
    changes = {
        field: fields[model_field]
        for field, model_field in zip(('start_date', 'end_date'), HARVEST_DATE_FIELDS, strict=True)
        if model_field in fields
    }
    year = legacy_year
    start = changes.get('start_date')
    if start is not None and str(legacy_year) not in records:
        year = actual_occurrence_year_for_date(schedule, start)
    if year is None and season is not None:
        occurrences = recurring_actual_occurrences(plan, season, schedule)
        primary = occurrences[0]['year'] if occurrences else None
        if str(primary) in records:
            year = primary
    end = changes.get('end_date')
    if year is None and end is not None:
        year = actual_occurrence_year_for_date(schedule, end)
    if year is None:
        return False
    if str(year) in records:
        update_harvest_actuals(plan, schedule, year, changes)
    current = plan.harvest_occurrence_actuals
    historical = one_off_harvest_actuals(plan)
    if legacy_year is not None and legacy_year != year and historical:
        current = {**current, 'occurrences': {
            str(legacy_year): _serialize_actuals(historical), **current.get('occurrences', {}),
        }}
    plan.harvest_occurrence_actuals = {**current, 'legacy_year': year}
    return plan.harvest_occurrence_actuals != storage


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
    # A shorter forecast cannot invalidate a record already saved for that
    # occurrence. Corrections still have to fit its cycle and recorded neighbours.
    window = schedule.eligible_window(year)
    _validate_dates(
        updated, changes, schedule.occupied_from if window is not None else None,
        schedule.occupied_until if window is not None else None,
    )
    boundary = tuple(value for value in (updated.start_date, updated.end_date) if value is not None)
    if boundary:
        _validate_occurrence_cycle(schedule, year, changes)
        _validate_neighbouring_actuals(year, boundary, dates_by_year)

    storage = plan.harvest_occurrence_actuals
    legacy_year = legacy_actual_occurrence_year(plan, schedule)
    occurrences = dict(storage.get('occurrences', {}))
    if updated or year == legacy_year:
        # A cleared legacy entry still overrides the legacy plan-level dates.
        occurrences[str(year)] = _serialize_actuals(updated)
    else:
        occurrences.pop(str(year), None)
    plan.harvest_occurrence_actuals = {'occurrences': occurrences}
    if legacy_year is not None:
        plan.harvest_occurrence_actuals['legacy_year'] = legacy_year
    return ('harvest_occurrence_actuals',)


def _serialize_actuals(actual: HarvestActualDates) -> dict[str, str | None]:
    return {
        'start_date': actual.start_date.isoformat() if actual.start_date else None,
        'end_date': actual.end_date.isoformat() if actual.end_date else None,
    }


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
