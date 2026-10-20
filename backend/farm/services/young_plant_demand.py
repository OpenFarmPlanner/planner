"""Young-plant demand (Jungpflanzenbedarf) for bought-in transplants.

Lists every planting plan of a season whose cultivation type is
``purchased_transplant``, grouped by crop (Kultur + Sorte) and ISO planting
week, with the summed plant count from ``farm.services.plant_count`` and an
optional reserve for losses rounded up to whole plants. Germination rate and
seed safety margins do not apply: the plants are bought, not sown.

Documented in docs/young-plant-demand.md; the HTTP layer lives in
farm.crops.views.YoungPlantDemandListView.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_CEILING, Decimal

from farm.models import PlantingPlan, Project
from farm.services.crop_display import resolve_crop_display_name
from farm.services.crop_inheritance import build_general_crop_index
from farm.services.plant_count import compute_plan_plant_count

MAX_RESERVE_PERCENT = Decimal('100')


@dataclass
class _Group:
    crop_id: int
    crop_name: str
    crop_display_name: str | None
    crop_display_language_code: str
    variety: str
    week_start: date | None
    plans: list[dict] = field(default_factory=list)
    blockers: list[str] = field(default_factory=list)


def parse_reserve_percent(raw_value: str | None) -> Decimal:
    """Parse the ``reserve_percent`` query param; invalid or missing means 0, clamped to 0-100."""
    if raw_value in (None, ''):
        return Decimal('0')
    try:
        value = Decimal(str(raw_value).replace(',', '.'))
    except ArithmeticError:
        return Decimal('0')
    if not value.is_finite() or value < 0:
        return Decimal('0')
    return min(value, MAX_RESERVE_PERCENT)


def apply_reserve(count: int, reserve_percent: Decimal) -> int:
    """``count`` plus ``reserve_percent`` %, rounded up to whole plants."""
    with_reserve = Decimal(count) * (Decimal('1') + reserve_percent / Decimal('100'))
    return int(with_reserve.to_integral_value(rounding=ROUND_CEILING))


def _week_start(planting_date: date | None) -> date | None:
    if planting_date is None:
        return None
    return planting_date - timedelta(days=planting_date.weekday())


def _plan_entry(plan: PlantingPlan, count: int | None, blockers: tuple[str, ...]) -> dict:
    bed = plan.bed
    field_obj = bed.field if bed else None
    location = field_obj.location if field_obj else None
    return {
        'plan_id': plan.id,
        'planting_date': plan.planting_date,
        'bed_id': bed.id if bed else None,
        'bed_name': bed.name if bed else '',
        'field_name': field_obj.name if field_obj else '',
        'location_name': location.name if location else '',
        'area_usage_sqm': float(plan.area_usage_sqm) if plan.area_usage_sqm is not None else None,
        'plant_count': count,
        'calculation_blockers': list(blockers),
    }


def _group_plans(project: Project, language_code: str, season_id: int | None) -> list[_Group]:
    plans = (
        PlantingPlan.objects
        .filter(
            project=project,
            crop__isnull=False,
            cultivation_type=PlantingPlan.CULTIVATION_TYPE_PURCHASED_TRANSPLANT,
        )
        .select_related('crop', 'crop__crop_species', 'bed', 'bed__field', 'bed__field__location')
        .prefetch_related('crop__crop_species__translations')
        .order_by('planting_date', 'id')
    )
    if season_id is not None:
        plans = plans.filter(season_id=season_id)
    general_crop_index = build_general_crop_index(project.id)
    groups: dict[tuple[int, date | None], _Group] = {}
    for plan in plans:
        crop = plan.crop
        week_start = _week_start(plan.planting_date)
        group = groups.get((crop.id, week_start))
        if group is None:
            display_name, display_language_code = resolve_crop_display_name(
                crop, language_code, project.region,
            )
            group = _Group(
                crop_id=crop.id,
                crop_name=crop.name,
                crop_display_name=display_name,
                crop_display_language_code=display_language_code,
                variety=crop.variety or '',
                week_start=week_start,
            )
            groups[(crop.id, week_start)] = group
        result = compute_plan_plant_count(plan, general_crop_index)
        group.plans.append(_plan_entry(plan, result.count, result.blockers))
        for blocker in result.blockers:
            if blocker not in group.blockers:
                group.blockers.append(blocker)
    return list(groups.values())


def _sort_key(group: _Group) -> tuple:
    # Plans without a planting date sort after every dated week.
    return (
        group.week_start is None,
        group.week_start or date.min,
        (group.crop_display_name or group.crop_name).casefold(),
        group.variety.casefold(),
    )


def _row(group: _Group, reserve_percent: Decimal) -> dict:
    # Any plan without a computable count makes the group total unknown
    # rather than a misleading partial sum.
    base_count = None if group.blockers else sum(plan['plant_count'] for plan in group.plans)
    planting_week = None
    if group.week_start is not None:
        iso_year, iso_week, _ = group.week_start.isocalendar()
        planting_week = {
            'iso_year': iso_year,
            'iso_week': iso_week,
            'start_date': group.week_start,
            'end_date': group.week_start + timedelta(days=6),
        }
    return {
        'key': f'{group.crop_id}:{group.week_start.isoformat() if group.week_start else "none"}',
        'crop_id': group.crop_id,
        'crop_name': group.crop_name,
        'crop_display_name': group.crop_display_name,
        'crop_display_language_code': group.crop_display_language_code,
        'variety': group.variety,
        'planting_week': planting_week,
        'plant_count': base_count,
        'plant_count_with_reserve': (
            apply_reserve(base_count, reserve_percent) if base_count is not None else None
        ),
        'reserve_percent': float(reserve_percent),
        'calculation_blockers': list(group.blockers),
        'plan_count': len(group.plans),
        'bed_count': len({plan['bed_id'] for plan in group.plans if plan['bed_id'] is not None}),
        'plans': group.plans,
    }


def build_young_plant_demand_rows(
    *,
    project: Project,
    language_code: str,
    season_id: int | None = None,
    reserve_percent: Decimal = Decimal('0'),
) -> list[dict]:
    """One row per crop and planting week of the season's bought-in transplants."""
    groups = sorted(_group_plans(project, language_code, season_id), key=_sort_key)
    return [_row(group, reserve_percent) for group in groups]
