"""Compare crop yields across actual season periods with explicit data coverage."""

from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Exists, OuterRef, Prefetch, Q, QuerySet

from farm.models import (
    Bed,
    Crop,
    CropLoss,
    Field,
    HarvestAllocation,
    HarvestRecord,
    Location,
    PlantingPlan,
    Project,
    Season,
)
from farm.services.crop_display import format_crop_label, resolve_crop_display_name
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
    recurring_plan_visible_in_season,
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
    excluded_unassigned_records: int = 0


def _crop_group_key(crop: Crop) -> int | str:
    # Match the crop filter: linked varieties share a species, other names are case-insensitive.
    return crop.crop_species_id or ' '.join(crop.name.split()).lower()


@dataclass
class YieldWindowSummary:
    planned_crops: set[int | str] = field(default_factory=set)
    recorded_crops: set[int | str] = field(default_factory=set)
    recorded: HarvestTotals = field(default_factory=HarvestTotals)
    planned_area: Decimal | None = None
    plans_without_area: int = 0

    def add_plan(self, plan: PlantingPlan) -> None:
        self.planned_crops.add(_crop_group_key(plan.crop))
        area = plan.area_usage_sqm
        if area is not None and area > 0:
            self.planned_area = (self.planned_area or Decimal(0)) + area
        else:
            self.plans_without_area += 1

    def add_harvest(self, harvest: HarvestRecord, quantity: Decimal) -> None:
        self.recorded_crops.add(_crop_group_key(harvest.crop))
        self.recorded.add(quantity, harvest.unit, harvest.grams_per_unit)

    def payload(self, rows: list[SeasonYield]) -> dict:
        return {
            'planned_area_sqm': harvest_number(self.planned_area),
            'plans_without_area_count': self.plans_without_area,
            'recorded_quantities': self.recorded.quantities_payload(),
            'excluded_unassigned_records': sum(row.excluded_unassigned_records for row in rows),
            'crop_count': len(self.planned_crops | self.recorded_crops),
            'recorded_crop_count': len(self.recorded_crops),
        }


@dataclass(frozen=True)
class YieldComparisonScope:
    crop_ids: tuple[int, ...] = ()
    variety_id: int | None = None
    location_id: int | None = None
    field_id: int | None = None
    bed_id: int | None = None
    season_limit: int | None = None

    @property
    def has_area_filter(self) -> bool:
        return any((self.location_id, self.field_id, self.bed_id))

    def includes_plan(self, plan: PlantingPlan) -> bool:
        if not self.has_area_filter:
            return True
        bed = _assigned_bed(plan)
        return bool(bed and (
            (self.location_id is None or bed.field.location_id == self.location_id)
            and (self.field_id is None or bed.field_id == self.field_id)
            and (self.bed_id is None or bed.pk == self.bed_id)
        ))


def _assigned_bed(plan: PlantingPlan) -> Bed | None:
    bed = plan.bed
    if bed is None or bed.project_id != plan.project_id:
        return None
    if bed.field.project_id != plan.project_id or bed.field.location.project_id != plan.project_id:
        return None
    return bed


def _comparison_crops(project: Project) -> QuerySet[Crop]:
    plans = PlantingPlan.objects.filter(
        project=project, crop_id=OuterRef('pk'), season__deleted_at__isnull=True,
    )
    harvests = HarvestRecord.objects.filter(project=project, crop_id=OuterRef('pk'))
    return (
        Crop.all_objects.filter(project=project).filter(Exists(plans) | Exists(harvests))
        .select_related('crop_species').prefetch_related('crop_species__translations').order_by('pk')
    )


def comparison_crops(project: Project, language_code: str) -> list[dict]:
    return [
        {'id': crop.pk, 'name': format_crop_label(crop, language_code, project.region)}
        for crop in _comparison_crops(project)
    ]


def comparison_filter_options(project: Project, language_code: str) -> dict:
    return {
        'crops': [
            {
                'id': crop.pk, 'name': format_crop_label(crop, language_code, project.region),
                'variety': (crop.variety or '').strip(),
                'culture': crop.name,
                'culture_label': resolve_crop_display_name(crop, language_code, project.region)[0],
                'crop_species': crop.crop_species_id,
                'search_names': crop.crop_species.search_names() if crop.crop_species else [],
            }
            for crop in _comparison_crops(project)
        ],
        'locations': list(Location.objects.filter(project=project).values('id', 'name')),
        'fields': list(Field.objects.filter(
            project=project, location__project=project,
        ).values('id', 'name', 'location_id')),
        'beds': list(Bed.objects.filter(
            project=project, field__project=project, field__location__project=project,
        ).values('id', 'name', 'field_id')),
    }


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
        if not recurring_plan_visible_in_season(plan, season, schedule):
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


def _plan_in_window(
    plan: PlantingPlan, schedule: RecurringHarvestSchedule | None,
    rows: list[SeasonYield], starts: list[date], by_id: dict[int, SeasonYield],
) -> bool:
    if plan.season_id in by_id:
        return True
    if schedule is not None:
        return any(recurring_plan_visible_in_season(plan, row.season, schedule) for row in rows)
    start, end = plan.planting_date, plan.occupancy_end_date
    if start is None or end is None or end < start:
        return False
    last = bisect_right(starts, end) - 1
    return last >= 0 and start <= rows[last].season.end_date


def _crop_timing(crop: Crop | None, crop_index: GeneralCropIndex) -> dict:
    return {
        f'crop_{name}': resolve_crop_field(crop, name, crop_index) for name in _CROP_TIMING_FIELDS
    } if crop is not None else {}


def _activity_dates(
    plan: PlantingPlan, *, original: bool, crop_index: GeneralCropIndex, language_code: str,
) -> dict:
    return {
        'id': plan.pk, 'bed_name': plan.bed.name if plan.bed_id else '',
        'cultivation_type': plan.cultivation_type,
        'crop_label': format_crop_label(plan.crop, language_code, plan.crop.project.region),
        **_crop_timing(plan.crop, crop_index),
        **{name: getattr(plan, name) if original else None for name in _ACTIVITY_DATE_FIELDS},
    }


def _record_activity_dates(
    plan: PlantingPlan, rows: list[SeasonYield], by_id: dict[int, SeasonYield],
    crop_index: GeneralCropIndex, language_code: str,
) -> None:
    schedule = recurring_harvest_schedule(plan, crop_index)
    origin = by_id.get(plan.season_id)
    if schedule is None:
        if origin is not None:
            origin.plan_dates.append(_activity_dates(
                plan, original=True, crop_index=crop_index, language_code=language_code,
            ))
        return

    for row in rows:
        if not recurring_plan_visible_in_season(plan, row.season, schedule):
            continue
        harvest = seasonal_harvest_payload(plan, row.season, schedule)
        has_actual = harvest['actual_start_date'] or harvest['actual_end_date']
        if row is origin or harvest['periods'] or has_actual:
            row.plan_dates.append({
                **_activity_dates(
                    plan, original=row is origin, crop_index=crop_index,
                    language_code=language_code,
                ),
                'seasonal_harvest': harvest,
            })


def _record_harvest(
    row: SeasonYield, harvest: HarvestRecord, plans: dict[int, PlantingPlan],
    scoped_plans: dict[int, PlantingPlan], *, has_area_filter: bool,
) -> Decimal | None:
    recorded = None if has_area_filter else harvest.quantity
    remainder = harvest.quantity
    missing_area = False
    for allocation in harvest.comparison_allocations:
        plan = plans.get(allocation.planting_plan_id)
        if plan is None:
            continue
        remainder -= allocation.quantity
        if plan.pk not in scoped_plans:
            missing_area |= _assigned_bed(plan) is None
            continue
        _record_harvest_allocation(row, harvest, allocation, plan)
        if has_area_filter:
            recorded = (recorded or Decimal(0)) + allocation.quantity
    if recorded is not None:
        row.recorded.add(recorded, harvest.unit, harvest.grams_per_unit)
    if has_area_filter and (remainder > 0 or missing_area):
        row.excluded_unassigned_records += 1
    elif remainder > 0:
        row.unassigned.add(remainder, harvest.unit, harvest.grams_per_unit)
    return recorded


def _record_harvest_allocation(
    row: SeasonYield, harvest: HarvestRecord, allocation: HarvestAllocation, plan: PlantingPlan,
) -> None:
    row.assigned[plan.pk].add(allocation.quantity, harvest.unit, harvest.grams_per_unit)
    area = allocation.harvested_area_sqm
    if area is None:
        return
    measured = measured_weight_kg(allocation.quantity, harvest.unit)
    estimated = estimated_weight_kg(allocation.quantity, harvest.grams_per_unit)
    weight = measured if measured is not None else estimated
    row.harvested_areas.append({
        'id': allocation.pk, 'date': harvest.date, 'plan_id': plan.pk,
        'bed_name': plan.bed.name if plan.bed_id else '',
        'area_sqm': harvest_number(area),
        'kg_per_sqm': harvest_number(weight / area) if weight is not None else None,
        'estimated': estimated is not None,
    })


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
        and row.excluded_unassigned_records == 0
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
        'excluded_unassigned_records': row.excluded_unassigned_records,
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


def _record_window_losses(
    project: Project, crop_ids: QuerySet, date_range: tuple[date, date],
    rows: list[SeasonYield], starts: list[date], plans: dict[int, PlantingPlan],
) -> None:
    losses = CropLoss.objects.filter(
        project=project, planting_plan__project=project,
        planting_plan__crop_id__in=crop_ids, date__range=date_range,
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


def build_yield_comparison(
    project: Project, scope: YieldComparisonScope, language_code: str,
    *, crop: Crop | None = None,
) -> dict:
    seasons = Season.objects.filter(project=project).order_by('-start_date', '-pk')
    rows = [SeasonYield(season) for season in reversed(list(seasons[:scope.season_limit]))]
    starts = [row.season.start_date for row in rows]
    by_id = {row.season.pk: row for row in rows}
    crop_index = build_general_crop_index(project.pk)
    crop_timing = _crop_timing(crop, crop_index)
    summary = YieldWindowSummary()
    if not rows:
        return {'crop_timing': crop_timing, 'seasons': [], 'summary': summary.payload(rows)}

    crops = Crop.all_objects.filter(project=project)
    if scope.crop_ids:
        crops = crops.filter(pk__in=scope.crop_ids)
    if scope.variety_id is not None:
        crops = crops.filter(pk=scope.variety_id, variety_normalized__isnull=False).exclude(
            variety_normalized='',
        )
    crop_ids = crops.values('pk')
    plans = {
        plan.pk: plan for plan in PlantingPlan.objects.filter(
            project=project, crop_id__in=crop_ids,
        ).filter(
            Q(season__project=project, season__deleted_at__isnull=True) | Q(season__isnull=True),
        ).select_related('bed__field__location', 'crop__project', 'crop__crop_species')
        .prefetch_related('crop__crop_species__translations').order_by('pk')
    }
    scoped_plans = {pk: plan for pk, plan in plans.items() if scope.includes_plan(plan)}
    for plan, schedule in distinct_forecast_plans(scoped_plans.values(), crop_index):
        if _plan_in_window(plan, schedule, rows, starts, by_id):
            summary.add_plan(plan)
        _forecast_for_plan(plan, rows, starts, by_id, crop_index, schedule)
    for plan in scoped_plans.values():
        _record_activity_dates(plan, rows, by_id, crop_index, language_code)

    date_range = (starts[0], rows[-1].season.end_date)
    harvests = HarvestRecord.objects.filter(
        project=project, crop_id__in=crop_ids, date__range=date_range,
    ).select_related('crop').prefetch_related(
        Prefetch(
            'allocations', queryset=HarvestAllocation.objects.filter(project=project),
            to_attr='comparison_allocations',
        ),
    )
    for harvest in harvests:
        row = _season_on(rows, starts, harvest.date)
        if row is not None:
            quantity = _record_harvest(
                row, harvest, plans, scoped_plans, has_area_filter=scope.has_area_filter,
            )
            if quantity is not None:
                summary.add_harvest(harvest, quantity)

    _record_window_losses(project, crop_ids, date_range, rows, starts, scoped_plans)
    return {
        'crop_timing': crop_timing,
        'seasons': [_season_payload(row, plans) for row in reversed(rows)],
        'summary': summary.payload(rows),
    }
