"""Plan-level yield forecasts and their allocation across ISO harvest weeks."""

from collections import defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import BooleanField, Case, F, Q, QuerySet, Value, When
from django.db.models.functions import Coalesce

from farm.models import Crop, PlantingPlan, Project, Season
from farm.services.crop_display import resolve_crop_display_name
from farm.services.crop_inheritance import (
    GeneralCropIndex,
    build_general_crop_index,
    get_general_crop,
    is_variety_crop,
    resolve_crop_display_color,
    resolve_crop_field,
)
from farm.services.plant_count import PLANT_COUNT_BLOCKER_MISSING_AREA, compute_plan_plant_count
from farm.services.seasonal_harvest import (
    HarvestProjection,
    RecurringHarvestSchedule,
    early_recorded_planting_candidates,
    recurring_harvest_schedule,
    recurring_plan_visible_in_season,
)

_YIELD_PRECISION = Decimal('0.01')
_COPIED_FORECAST_FIELDS = (
    'copied_from_plan_id', 'season_id', 'crop_id', 'bed_id', 'parcel_id', 'cultivation_type',
    'planting_date', 'planned_propagation_start_date', 'planned_sowing_date',
    'harvest_date', 'harvest_end_date', 'clearing_date', 'area_usage_sqm', 'quantity',
    'individual_bed', 'site_id', 'individual_count',
)


@dataclass(frozen=True)
class PlanExpectedYield:
    kilograms: Decimal | None
    blockers: tuple[str, ...] = ()


def compute_plan_expected_yield(
    plan: PlantingPlan,
    general_crop_index: GeneralCropIndex | None = None,
) -> PlanExpectedYield:
    """Return the plan's expected weight in kg using its crop's effective rate and unit."""
    if plan.crop is None:
        return PlanExpectedYield(None, ('missing_crop',))
    crop_rate = resolve_crop_field(plan.crop, 'expected_yield', general_crop_index)
    rate = Decimal(str(crop_rate)) if crop_rate is not None else None
    method = resolve_crop_field(plan.crop, 'harvest_method', general_crop_index)
    blockers: list[str] = []
    if rate is None or not rate.is_finite() or rate <= 0:
        blockers.append('missing_yield_rate')
    if method == 'per_sqm':
        area = plan.area_usage_sqm
        quantity = Decimal(str(area)) if area is not None else None
        if quantity is None or not quantity.is_finite() or quantity <= 0:
            blockers.append(PLANT_COUNT_BLOCKER_MISSING_AREA)
    elif method == 'per_plant':
        count = compute_plan_plant_count(plan, general_crop_index)
        quantity = count.count
        blockers.extend(count.blockers)
        if quantity == 0:
            blockers.append('zero_plant_count')
    else:
        quantity = None
        blockers.append('missing_yield_unit')
    if blockers:
        return PlanExpectedYield(None, tuple(blockers))
    return PlanExpectedYield(rate * quantity)


def distinct_forecast_plans(
    plans: Iterable[PlantingPlan], crop_index: GeneralCropIndex,
) -> Iterator[tuple[PlantingPlan, RecurringHarvestSchedule | None]]:
    """Count repeated copies of an unchanged forecast in one target season once."""
    seen = set()
    for plan in plans:
        schedule = recurring_harvest_schedule(plan, crop_index)
        if plan.copied_from_plan_id is not None:
            count = plan.individual_total if plan.is_individual else None
            key = (tuple(getattr(plan, name) for name in _COPIED_FORECAST_FIELDS), schedule, count)
            if key in seen:
                continue
            seen.add(key)
        yield plan, schedule


def week_start_for_iso_year(iso_year: int) -> date:
    """Return Monday of ISO week 1 for an ISO year."""
    return date.fromisocalendar(iso_year, 1, 1)


def iso_week_key(day: date) -> str:
    """Return ISO week key in the format YYYY-Www using ISO year and week."""
    iso_year, iso_week, _ = day.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def _iso_year_end(iso_year: int) -> date:
    if iso_year == date.max.year:
        return date.max
    return week_start_for_iso_year(iso_year + 1) - timedelta(days=1)


def _forecast_bounds(iso_year: int | None, season: Season | None) -> tuple[date, date]:
    if season is None:
        year = iso_year if iso_year is not None else date.today().year
        return week_start_for_iso_year(year), _iso_year_end(year)
    start = season.start_date
    end = season.end_date
    if iso_year is not None:
        return max(start, week_start_for_iso_year(iso_year)), min(end, _iso_year_end(iso_year))
    return start, end


def build_yield_calendar(
    project: Project,
    iso_year: int,
    language_code: str,
    season_id: int | None = None,
) -> list[dict]:
    """Return one ISO year's weekly yield rows, optionally scoped to a season."""
    return build_yield_forecast(
        project, language_code, iso_year=iso_year, season_id=season_id, include_incomplete=False,
    )['weeks']


def build_yield_calendar_for_season(
    project: Project, season: Season, language_code: str,
) -> list[dict]:
    """Return the weekly yield rows across the active season's ISO years."""
    return build_yield_forecast(
        project, language_code, iso_year=None, season=season, include_incomplete=False,
    )['weeks']


def _forecast_plans(
    project: Project, start: date, end: date, season: Season | None, season_id: int | None,
    *, include_incomplete: bool, whole_season: bool,
) -> QuerySet[PlantingPlan]:
    overlaps = Q(harvest_date__lte=end, harvest_end_date__gt=start)
    invalid_period = (
        Q(harvest_date__isnull=True)
        | Q(harvest_end_date__isnull=True)
        | Q(harvest_end_date__lte=F('harvest_date'))
    )
    plans = (
        PlantingPlan.objects.filter(project=project)
        .select_related('crop', 'crop__crop_species', 'bed', 'parcel')
        .prefetch_related('crop__crop_species__translations')
        .alias(occupied_until=PlantingPlan.occupancy_end_expression())
        .order_by('pk')
    )
    legacy_visibility = Q()
    if season is not None:
        legacy_visibility = Q(season_id=season.pk) | Q(
            planting_date__lt=season.start_date, occupied_until__gte=season.start_date,
        )
        early_occupancy = early_recorded_planting_candidates(season.start_date, season.end_date)
        plans = plans.filter(season__deleted_at__isnull=True).filter(
            legacy_visibility | early_occupancy,
        )
    elif season_id is not None:
        plans = plans.filter(season_id=season_id)
    if include_incomplete:
        plans = plans.alias(
            diagnostic_date=Coalesce('harvest_date', 'harvest_end_date', 'planting_date'),
        )
        diagnosis_scope = Q(diagnostic_date__gte=start, diagnostic_date__lte=end)
        if season is not None and whole_season:
            diagnosis_scope |= Q(season_id=season.pk)
        legacy_selection = overlaps | (invalid_period & diagnosis_scope)
    else:
        legacy_selection = overlaps & ~invalid_period
    legacy_selection &= legacy_visibility
    # Active perennials can contribute without any stored legacy harvest dates.
    could_be_planted = (
        Q(planting_date__lte=end)
        | Q(actual_sowing_date__lte=end)
        | Q(actual_transplanting_date__lte=end)
    )
    occupied = Q(occupied_until__gte=start, crop__isnull=False) & could_be_planted
    return plans.filter(legacy_selection | occupied).annotate(
        legacy_forecast_candidate=Case(
            When(legacy_selection, then=Value(True)), default=Value(False),
            output_field=BooleanField(),
        ),
    )


def build_yield_forecast(
    project: Project,
    language_code: str,
    *,
    iso_year: int | None,
    season: Season | None = None,
    season_id: int | None = None,
    include_incomplete: bool = True,
) -> dict[str, list[dict]]:
    """Build weekly yield rows and, if requested, explain omitted planting plans."""
    start, end = _forecast_bounds(iso_year, season)
    if start > end:
        return {'weeks': [], 'incomplete_plans': [], 'crop_groups': []}

    plans = _forecast_plans(
        project, start, end, season, season_id,
        include_incomplete=include_incomplete, whole_season=iso_year is None,
    )
    general_crops = build_general_crop_index(project.pk)
    weekly_data: dict[date, dict[int, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    crop_groups: dict[int, dict] = {}
    incomplete_plans = []
    for plan, schedule in distinct_forecast_plans(plans, general_crops):
        projections = _forecast_projections(plan, schedule, season, start, end)
        if projections is None:
            continue
        expected = compute_plan_expected_yield(plan, general_crops)
        if plan.crop_id is not None and plan.crop_id not in crop_groups:
            crop_groups[plan.crop_id] = _forecast_crop_group(
                plan.crop, general_crops, language_code, project.region,
            )
        if expected.kilograms is not None and projections:
            for projection in projections:
                _accumulate_plan_yield(weekly_data, plan.crop_id, expected.kilograms, projection)
        elif include_incomplete:
            blockers = expected.blockers + (() if projections else ('missing_harvest_period',))
            incomplete_plans.append(_incomplete_plan(plan, blockers, language_code, project.region))

    return {
        'weeks': _build_response_rows(weekly_data, crop_groups),
        'incomplete_plans': incomplete_plans,
        'crop_groups': list(crop_groups.values()),
    }


def _forecast_projections(
    plan: PlantingPlan, schedule: RecurringHarvestSchedule | None, season: Season | None,
    start: date, end: date,
) -> list[HarvestProjection] | None:
    """Return None for out-of-scope plans, or an empty list for unscheduled plans."""
    if schedule is None:
        return (
            legacy_harvest_projection(plan, start, end) if plan.legacy_forecast_candidate else None
        )
    if season is not None and not recurring_plan_visible_in_season(plan, season, schedule):
        return None
    projections = schedule.project(start, end)
    unscheduled = plan.planting_date is None and plan.legacy_forecast_candidate
    return projections if projections or unscheduled else None


def _forecast_crop_group(
    crop: Crop, general_crops: GeneralCropIndex, language_code: str, region: str,
) -> dict:
    general = get_general_crop(crop, general_crops) or crop
    display_name, display_language = resolve_crop_display_name(crop, language_code, region)
    general_name = display_name
    if general is not crop:
        # The plan queryset already loaded this shared species and its translations.
        general.crop_species = crop.crop_species
        general_name = resolve_crop_display_name(general, language_code, region)[0]
    return {
        'crop_id': crop.pk,
        'crop_name': crop.name,
        'crop_display_name': display_name,
        'crop_display_language_code': display_language,
        'crop_variety': crop.variety,
        'general_crop_id': general.pk,
        'general_crop_name': general_name or general.name,
        'color': resolve_crop_display_color(general, general_crops),
        'effective_color': resolve_crop_display_color(crop, general_crops),
        'has_color_override': bool(is_variety_crop(crop) and crop.display_color),
    }


def _incomplete_plan(
    plan: PlantingPlan, blockers: tuple[str, ...], language_code: str, region: str,
) -> dict:
    crop = plan.crop
    display_name, display_language = (
        resolve_crop_display_name(crop, language_code, region) if crop else (None, '')
    )
    return {
        'plan_id': plan.pk,
        'crop_id': plan.crop_id,
        'crop_name': crop.name if crop else '',
        'crop_display_name': display_name,
        'crop_display_language_code': display_language,
        'crop_variety': crop.variety if crop else '',
        'bed_name': plan.bed.name if plan.bed else '',
        'parcel_name': plan.parcel.name if plan.parcel_id else '',
        'planting_date': plan.planting_date,
        'calculation_blockers': list(blockers),
    }


def _next_week(week_start: date) -> date:
    return week_start + timedelta(days=min(7, (date.max - week_start).days))


def _plan_yield_through(kilograms: Decimal, elapsed_days: int, total_days: int) -> Decimal:
    return (kilograms * elapsed_days / total_days).quantize(
        _YIELD_PRECISION, rounding=ROUND_HALF_UP,
    )


def legacy_harvest_projection(
    plan: PlantingPlan, start: date, end: date,
) -> list[HarvestProjection]:
    """Project the stored, half-open interval used by one-off forecasts."""
    first, limit = plan.harvest_date, plan.harvest_end_date
    if first is None or limit is None or first >= limit:
        return []
    last = limit - timedelta(days=1)
    overlap_start, overlap_end = max(first, start), min(last, end)
    if overlap_start > overlap_end:
        return []
    return [HarvestProjection(overlap_start, overlap_end, first, last)]


def forecast_yield_for_projection(kilograms: Decimal, projection: HarvestProjection) -> Decimal:
    """Round cumulative totals so contiguous slices attribute a window exactly once."""
    first = projection.window_start
    days = (projection.window_end - first).days + 1
    return (
        _plan_yield_through(kilograms, (projection.end_date - first).days + 1, days)
        - _plan_yield_through(kilograms, (projection.start_date - first).days, days)
    )


def _accumulate_plan_yield(
    weekly_data: dict[date, dict[int, Decimal]],
    crop_id: int,
    kilograms: Decimal,
    projection: HarvestProjection,
) -> None:
    """Allocate the rounded cumulative yield between each pair of week boundaries."""
    first_day = projection.window_start.toordinal()
    days = projection.window_end.toordinal() - first_day + 1
    start = projection.start_date.toordinal()
    limit = projection.end_date.toordinal() + 1
    first_week = start - projection.start_date.weekday()
    allocated = _plan_yield_through(kilograms, start - first_day, days)
    for week in range(first_week, limit, 7):
        overlap_limit = min(week + 7, limit)
        next_allocated = _plan_yield_through(kilograms, overlap_limit - first_day, days)
        if next_allocated > allocated:
            weekly_data[date.fromordinal(week)][crop_id] += next_allocated - allocated
        allocated = next_allocated


def _build_response_rows(
    weekly_data: dict[date, dict[int, Decimal]], crop_groups: dict[int, dict],
) -> list[dict]:
    response_data = []
    for week_start, crops in sorted(weekly_data.items()):
        crops_payload = []
        ordered = sorted(
            crops,
            key=lambda key: crop_groups[key]['crop_display_name'] or crop_groups[key]['crop_name'],
        )
        for crop_id in ordered:
            metadata = crop_groups[crop_id]
            crops_payload.append({
                'crop_id': crop_id,
                'crop_name': metadata['crop_name'],
                'crop_display_name': metadata['crop_display_name'],
                'crop_display_language_code': metadata['crop_display_language_code'],
                'color': metadata['color'],
                'yield': float(crops[crop_id]),
            })
        response_data.append({
            'iso_week': iso_week_key(week_start),
            'week_start': week_start.isoformat(),
            'week_end': _next_week(week_start).isoformat(),
            'crops': crops_payload,
        })
    return response_data
