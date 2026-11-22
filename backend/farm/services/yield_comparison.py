"""Compare crop yields across actual season periods with explicit data coverage."""

from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Exists, OuterRef, Prefetch, Q

from farm.models import (
    Crop,
    CropLoss,
    HarvestAllocation,
    HarvestRecord,
    PlantingPlan,
    Project,
    Season,
)
from farm.services.crop_display import format_crop_label
from farm.services.crop_inheritance import (
    GeneralCropIndex,
    build_general_crop_index,
    resolve_crop_field,
)
from farm.services.harvests import (
    HarvestTotals,
    estimated_weight_kg,
    harvest_number,
    measured_weight_kg,
)
from farm.services.seasonal_harvest import (
    RecurringHarvestSchedule,
    recurring_harvest_schedule,
    seasonal_harvest_payload,
)
from farm.services.yield_calendar import (
    compute_plan_expected_yield,
    distinct_forecast_plans,
    forecast_yield_for_projection,
    legacy_harvest_projection,
)

_ACTIVITY_DATE_FIELDS = (
    'planting_date', 'planned_propagation_start_date', 'planned_sowing_date',
    'harvest_date', 'harvest_end_date', *PlantingPlan.ACTUAL_DATE_FIELDS,
)
_CROP_TIMING_FIELDS = ('cultivation_type', 'cultivation_types', 'propagation_duration_days')


@dataclass
class SeasonYield:
    season: Season
    forecast: dict[int, Decimal | None] = field(default_factory=dict)
    recorded: HarvestTotals = field(default_factory=HarvestTotals)
    unassigned: HarvestTotals = field(default_factory=HarvestTotals)
    assigned: dict[int, HarvestTotals] = field(default_factory=lambda: defaultdict(HarvestTotals))
    plan_dates: list[dict] = field(default_factory=list)
    harvested_areas: list[dict] = field(default_factory=list)
    losses: list[dict] = field(default_factory=list)


def comparison_crops(project: Project, language_code: str) -> list[dict]:
    plans = PlantingPlan.objects.filter(
        project=project, crop_id=OuterRef('pk'), season__deleted_at__isnull=True,
    )
    harvests = HarvestRecord.objects.filter(project=project, crop_id=OuterRef('pk'))
    crops = (
        Crop.all_objects.filter(project=project).filter(Exists(plans) | Exists(harvests))
        .select_related('crop_species').prefetch_related('crop_species__translations').order_by('pk')
    )
    return [
        {'id': crop.pk, 'name': format_crop_label(crop, language_code, project.region)}
        for crop in crops
    ]


def _season_on(rows: list[SeasonYield], starts: list[date], day: date) -> SeasonYield | None:
    index = bisect_right(starts, day) - 1
    if index >= 0 and day <= rows[index].season.end_date:
        return rows[index]
    return None


def _forecast_for_plan(
    plan: PlantingPlan, rows: list[SeasonYield], starts: list[date],
    by_id: dict[int, SeasonYield], crop_index: GeneralCropIndex,
    schedule: RecurringHarvestSchedule | None,
) -> None:
    if schedule is not None and plan.planting_date is not None:
        _forecast_recurring_plan(plan, schedule, rows, crop_index)
        return

    start, end = plan.harvest_date, plan.harvest_end_date
    original = by_id.get(plan.season_id)
    if schedule is not None or start is None or end is None or end <= start:
        if original is not None:
            original.forecast[plan.pk] = None
        diagnostic = start or end or plan.planting_date
        other = _season_on(rows, starts, diagnostic) if diagnostic else None
        if other is not None and _plan_visible_in_season(plan, other.season):
            other.forecast[plan.pk] = None
        return

    expected = compute_plan_expected_yield(plan, crop_index).kilograms
    first = max(0, bisect_right(starts, start) - 1)
    last = bisect_right(starts, end - timedelta(days=1))
    for row in rows[first:last]:
        season = row.season
        if season.end_date < start or not _plan_visible_in_season(plan, season):
            continue
        projections = legacy_harvest_projection(plan, season.start_date, season.end_date)
        if not projections:
            continue
        portion = (
            forecast_yield_for_projection(expected, projections[0])
            if expected is not None else None
        )
        row.forecast[plan.pk] = portion


def _forecast_recurring_plan(
    plan: PlantingPlan, schedule: RecurringHarvestSchedule, rows: list[SeasonYield],
    crop_index: GeneralCropIndex,
) -> None:
    expected = compute_plan_expected_yield(plan, crop_index).kilograms
    for row in rows:
        season = row.season
        if plan.season_id != season.pk and not plan.bed_id:
            continue
        if not _plan_visible_in_season(plan, season):
            continue
        projections = schedule.project(season.start_date, season.end_date)
        if projections:
            row.forecast[plan.pk] = (
                sum(
                    (forecast_yield_for_projection(expected, part) for part in projections),
                    Decimal(0),
                )
                if expected is not None else None
            )


def _plan_visible_in_season(plan: PlantingPlan, season: Season) -> bool:
    return plan.season_id == season.pk or (
        plan.planting_date is not None
        and plan.planting_date < season.start_date <= plan.occupancy_end_date
    )


def _activity_dates(plan: PlantingPlan, *, original: bool) -> dict:
    return {
        'id': plan.pk, 'bed_name': plan.bed.name if plan.bed_id else '',
        'cultivation_type': plan.cultivation_type,
        **{name: getattr(plan, name) if original else None for name in _ACTIVITY_DATE_FIELDS},
    }


def _record_activity_dates(
    plan: PlantingPlan, rows: list[SeasonYield], by_id: dict[int, SeasonYield],
    crop_index: GeneralCropIndex,
) -> None:
    schedule = recurring_harvest_schedule(plan, crop_index)
    origin = by_id.get(plan.season_id)
    if schedule is None:
        if origin is not None:
            origin.plan_dates.append(_activity_dates(plan, original=True))
        return

    for row in rows:
        if row is not origin and (not plan.bed_id or not _plan_visible_in_season(plan, row.season)):
            continue
        projections = schedule.project(row.season.start_date, row.season.end_date)
        harvest = seasonal_harvest_payload(plan, row.season, projections)
        has_actual = harvest['actual_start_date'] or harvest['actual_end_date']
        if row is origin or projections or has_actual:
            row.plan_dates.append({
                **_activity_dates(plan, original=row is origin), 'seasonal_harvest': harvest,
            })


def _record_harvest(
    row: SeasonYield, harvest: HarvestRecord, plans: dict[int, PlantingPlan],
) -> None:
    row.recorded.add(harvest.quantity, harvest.unit, harvest.grams_per_unit)
    remainder = harvest.quantity
    for allocation in harvest.comparison_allocations:
        plan = plans.get(allocation.planting_plan_id)
        if plan is None:
            continue
        row.assigned[plan.pk].add(allocation.quantity, harvest.unit, harvest.grams_per_unit)
        remainder -= allocation.quantity
        if allocation.harvested_area_sqm is not None:
            measured = measured_weight_kg(allocation.quantity, harvest.unit)
            estimated = estimated_weight_kg(allocation.quantity, harvest.grams_per_unit)
            weight = measured if measured is not None else estimated
            row.harvested_areas.append({
                'id': allocation.pk, 'date': harvest.date, 'plan_id': plan.pk,
                'bed_name': plan.bed.name if plan.bed_id else '',
                'area_sqm': harvest_number(allocation.harvested_area_sqm),
                'kg_per_sqm': (
                    harvest_number(weight / allocation.harvested_area_sqm)
                    if weight is not None else None
                ),
                'estimated': estimated is not None,
            })
    if remainder > 0:
        row.unassigned.add(remainder, harvest.unit, harvest.grams_per_unit)


def _total_plan_area(plan_ids, plans: dict[int, PlantingPlan]) -> Decimal | None:
    areas = [plans[pk].area_usage_sqm for pk in plan_ids]
    return sum(areas, Decimal(0)) if areas and all(area and area > 0 for area in areas) else None


def _season_payload(row: SeasonYield, plans: dict[int, PlantingPlan]) -> dict:
    forecast = {pk: amount for pk, amount in row.forecast.items() if amount is not None}
    forecast_kg = sum(forecast.values(), Decimal(0)) if forecast else None
    forecast_area = _total_plan_area(forecast, plans)
    assigned_area = _total_plan_area(row.assigned, plans)
    mixed = any(totals.has_unconvertible for totals in row.assigned.values())
    estimated = any(totals.has_estimated for totals in row.assigned.values())
    assigned_kg = sum(totals.measured_kg + totals.estimated_kg for totals in row.assigned.values())
    # A chart pair needs the same plan cohort, complete forecast inputs and
    # measured harvest throughout. Crop totals are available independently.
    comparable = (
        bool(forecast) and len(forecast) == len(row.forecast)
        and forecast.keys() == row.assigned.keys() and not row.unassigned.quantities
        and not mixed and not estimated
    )
    return {
        'id': row.season.pk, 'label': row.season.label,
        'start_date': row.season.start_date, 'end_date': row.season.end_date,
        'forecast_kg': harvest_number(forecast_kg),
        'forecast_kg_per_sqm': (
            harvest_number(forecast_kg / forecast_area) if forecast_area else None
        ),
        'forecast_plan_count': len(forecast), 'expected_plan_count': len(row.forecast),
        'recorded': {
            'quantities': row.recorded.quantities_payload(), **row.recorded.weight_payload(),
        },
        'unassigned': row.unassigned.quantities_payload(),
        'assigned_plan_count': len(row.assigned),
        'assigned_forecast_plan_count': len(row.forecast.keys() & row.assigned.keys()),
        'recorded_kg_per_plan_sqm': (
            harvest_number(assigned_kg / assigned_area) if assigned_area and not mixed else None
        ),
        'recorded_kg_per_plan_sqm_estimated': estimated and assigned_area is not None and not mixed,
        'comparable': comparable,
        'harvested_areas': row.harvested_areas,
        'losses': row.losses,
        'plan_dates': row.plan_dates,
    }


def build_yield_comparison(project: Project, crop: Crop) -> dict:
    seasons = Season.objects.filter(project=project).order_by('start_date')
    rows = [SeasonYield(season) for season in seasons]
    starts = [row.season.start_date for row in rows]
    by_id = {row.season.pk: row for row in rows}
    crop_index = build_general_crop_index(project.pk)
    crop_timing = {
        f'crop_{name}': resolve_crop_field(crop, name, crop_index) for name in _CROP_TIMING_FIELDS
    }
    if not rows:
        return {'crop_timing': crop_timing, 'seasons': []}

    plans = {
        plan.pk: plan for plan in PlantingPlan.objects.filter(
            project=project, crop=crop,
        ).filter(
            Q(season__project=project, season__deleted_at__isnull=True) | Q(season__isnull=True),
        ).select_related('bed', 'crop').order_by('pk')
    }
    for plan, schedule in distinct_forecast_plans(plans.values(), crop_index):
        _forecast_for_plan(plan, rows, starts, by_id, crop_index, schedule)
    for plan in plans.values():
        _record_activity_dates(plan, rows, by_id, crop_index)

    date_range = (starts[0], rows[-1].season.end_date)
    harvests = HarvestRecord.objects.filter(
        project=project, crop=crop, date__range=date_range,
    ).prefetch_related(
        Prefetch(
            'allocations', queryset=HarvestAllocation.objects.filter(project=project),
            to_attr='comparison_allocations',
        ),
    )
    for harvest in harvests:
        row = _season_on(rows, starts, harvest.date)
        if row is not None:
            _record_harvest(row, harvest, plans)

    losses = CropLoss.objects.filter(
        project=project, planting_plan__project=project,
        planting_plan__crop=crop, date__range=date_range,
    ).values(
        'id', 'planting_plan_id', 'date', 'loss_type', 'cause', 'extent_value', 'extent_unit',
    )
    for loss in losses:
        row = _season_on(rows, starts, loss['date'])
        plan = plans.get(loss['planting_plan_id'])
        if row is not None and plan is not None:
            row.losses.append({
                **loss,
                'extent_value': harvest_number(loss['extent_value']),
                'bed_name': plan.bed.name if plan.bed_id else '',
            })
    return {
        'crop_timing': crop_timing,
        'seasons': [_season_payload(row, plans) for row in reversed(rows)],
    }
