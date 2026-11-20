"""Plan-level yield forecasts and their allocation across ISO harvest weeks."""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.db.models import F, Q
from django.db.models.functions import Coalesce

from farm.models import PlantingPlan, Project, Season
from farm.services.crop_display import resolve_crop_display_name
from farm.services.crop_inheritance import (
    GeneralCropIndex,
    build_general_crop_index,
    resolve_crop_field,
)
from farm.services.plant_count import PLANT_COUNT_BLOCKER_MISSING_AREA, compute_plan_plant_count

_YIELD_PRECISION = Decimal('0.01')


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


def week_start_for_iso_year(iso_year: int) -> date:
    """Return Monday of ISO week 1 for an ISO year."""
    return date.fromisocalendar(iso_year, 1, 1)


def iso_week_key(day: date) -> str:
    """Return ISO week key in the format YYYY-Www using ISO year and week."""
    iso_year, iso_week, _ = day.isocalendar()
    return f"{iso_year}-W{iso_week:02d}"


def _iso_year_end(iso_year: int) -> date:
    return week_start_for_iso_year(iso_year + 1) if iso_year < date.max.year else date.max


def _forecast_bounds(iso_year: int | None, season: Season | None) -> tuple[date, date]:
    if season is None:
        year = iso_year if iso_year is not None else date.today().year
        return week_start_for_iso_year(year), _iso_year_end(year)
    start = season.start_date
    end = season.end_date + timedelta(days=1) if season.end_date < date.max else date.max
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
    if start >= end:
        return {'weeks': [], 'incomplete_plans': []}

    overlaps = Q(harvest_date__lt=end, harvest_end_date__gt=start)
    invalid_period = (
        Q(harvest_date__isnull=True)
        | Q(harvest_end_date__isnull=True)
        | Q(harvest_end_date__lte=F('harvest_date'))
    )
    plans = (
        PlantingPlan.objects.filter(project=project)
        .select_related('crop', 'crop__crop_species', 'bed')
        .prefetch_related('crop__crop_species__translations')
        .order_by('pk')
    )
    if season is not None:
        plans = plans.filter(season__deleted_at__isnull=True).alias(
            occupied_until=PlantingPlan.occupancy_end_expression(),
        ).filter(
            Q(season_id=season.pk) | Q(
                planting_date__lt=season.start_date, occupied_until__gte=season.start_date,
            ),
        )
    elif season_id is not None:
        plans = plans.filter(season_id=season_id)
    if include_incomplete:
        plans = plans.alias(
            diagnostic_date=Coalesce('harvest_date', 'harvest_end_date', 'planting_date'),
        )
        diagnosis_scope = Q(diagnostic_date__gte=start, diagnostic_date__lt=end)
        if season is not None and iso_year is None:
            diagnosis_scope |= Q(season_id=season.pk)
        plans = plans.filter(overlaps | (invalid_period & diagnosis_scope))
    else:
        plans = plans.filter(overlaps & ~invalid_period)

    general_crops = build_general_crop_index(project.pk)
    weekly_data: dict[date, dict[tuple, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
    incomplete_plans = []
    for plan in plans:
        expected = compute_plan_expected_yield(plan, general_crops)
        harvest_start, harvest_end = plan.harvest_date, plan.harvest_end_date
        has_window = (
            harvest_start is not None and harvest_end is not None and harvest_end > harvest_start
        )
        if expected.kilograms is not None and has_window:
            _accumulate_plan_yield(
                weekly_data, plan, expected.kilograms, start, end, language_code, project.region,
            )
        elif include_incomplete:
            blockers = expected.blockers + (() if has_window else ('missing_harvest_period',))
            incomplete_plans.append(_incomplete_plan(plan, blockers, language_code, project.region))

    return {'weeks': _build_response_rows(weekly_data), 'incomplete_plans': incomplete_plans}


def _incomplete_plan(
    plan: PlantingPlan, blockers: tuple[str, ...], language_code: str, region: str,
) -> dict:
    crop = plan.crop
    display_name, display_language = (
        resolve_crop_display_name(crop, language_code, region) if crop else (None, '')
    )
    return {
        'plan_id': plan.pk,
        'crop_name': crop.name if crop else '',
        'crop_display_name': display_name,
        'crop_display_language_code': display_language,
        'crop_variety': crop.variety if crop else '',
        'bed_name': plan.bed.name if plan.bed else '',
        'planting_date': plan.planting_date,
        'calculation_blockers': list(blockers),
    }


def _next_week(week_start: date) -> date:
    return week_start + timedelta(days=min(7, (date.max - week_start).days))


def _accumulate_plan_yield(
    weekly_data: dict[date, dict[tuple, Decimal]],
    plan: PlantingPlan,
    kilograms: Decimal,
    start: date,
    end: date,
    language_code: str,
    region: str,
) -> None:
    """Allocate the rounded cumulative yield between each pair of week boundaries."""
    harvest_start = plan.harvest_date
    harvest_end = plan.harvest_end_date
    total_days = (harvest_end - harvest_start).days
    overlap_start = max(harvest_start, start)
    overlap_limit = min(harvest_end, end)
    week_start = overlap_start - timedelta(days=overlap_start.weekday())
    display_name, display_language = resolve_crop_display_name(plan.crop, language_code, region)
    crop_key = (
        plan.crop_id, plan.crop.name, display_name, display_language,
        plan.crop.display_color or '#3b82f6',
    )

    def allocated_through(day: date) -> Decimal:
        return (kilograms * (day - harvest_start).days / total_days).quantize(
            _YIELD_PRECISION, rounding=ROUND_HALF_UP,
        )

    allocated = allocated_through(overlap_start)
    while overlap_start < overlap_limit:
        week_end = _next_week(week_start)
        overlap_end = min(week_end, overlap_limit)
        next_allocated = allocated_through(overlap_end)
        if next_allocated > allocated:
            weekly_data[week_start][crop_key] += next_allocated - allocated
        allocated = next_allocated
        week_start = week_end
        overlap_start = overlap_end


def _build_response_rows(weekly_data: dict[date, dict[tuple, Decimal]]) -> list[dict]:
    response_data = []
    for week_start, crops in sorted(weekly_data.items()):
        crops_payload = []
        for key, kilograms in sorted(crops.items(), key=lambda item: item[0][2] or item[0][1]):
            crop_id, crop_name, display_name, display_language, color = key
            crops_payload.append({
                'crop_id': crop_id,
                'crop_name': crop_name,
                'crop_display_name': display_name,
                'crop_display_language_code': display_language,
                'color': color,
                'yield': float(kilograms),
            })
        response_data.append({
            'iso_week': iso_week_key(week_start),
            'week_start': week_start.isoformat(),
            'week_end': _next_week(week_start).isoformat(),
            'crops': crops_payload,
        })
    return response_data
