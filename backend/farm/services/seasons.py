"""Season pattern computation and season-to-season data copy.

A season always spans exactly 12 months from its configured start day/month
(see `SeasonPattern` — duration is deliberately not configurable). All period
math here is hemisphere-agnostic: it only cares about the configured
start day/month, never about calendar-year boundaries.
"""

import calendar
from datetime import date, timedelta
from typing import Any
from uuid import uuid4

from django.db import transaction
from django.db.models import Q

from farm.models import EntityRevision, PlantingPlan, Project, Season, SeasonPattern, Task
from farm.services.crop_inheritance import (
    GeneralCropIndex,
    build_general_crop_index,
    plan_cultivation_type,
    resolve_crop_field,
)
from farm.services.parcel_rotation_copy import (
    apply_confirmed_parcel_rotation,
    preview_parcel_rotation,
)
from farm.services.tasks import (
    generate_tasks_for_plans,
    plan_event_dates,
    synchronize_recurring_harvest_tasks,
)

# Fields copied from a source PlantingPlan onto a new one in the target
# season. Excludes the primary key, timestamps, audit fields, and the
# project/season FKs themselves (set explicitly by the caller).
PLANTING_PLAN_COPY_FIELDS = (
    'crop_id',
    'bed_id',
    'parcel_id',
    'site_id',
    'individual_bed',
    'individual_count',
    'estimated_canopy_diameter_m',
    'cultivation_type',
    'planting_date',
    'planned_propagation_start_date',
    'planned_sowing_date',
    'harvest_date',
    'harvest_date_is_explicit',
    'harvest_end_date',
    'harvest_end_date_is_explicit',
    'clearing_date',
    'quantity',
    'area_usage_sqm',
    'parcel_rotation_basis',
    'notes',
)

# Date fields on a copied PlantingPlan that are shifted forward so the copy
# lands in the target season's own period instead of the source season's.
PLANTING_PLAN_SHIFTED_DATE_FIELDS = (
    'planting_date', 'planned_propagation_start_date', 'planned_sowing_date',
    'harvest_date', 'harvest_end_date', 'clearing_date',
)

COMPUTED_COPY_DATE_FIELDS = (
    ('planned_propagation_start_date', 'actual_propagation_start_date', 'propagation_start', None),
    ('harvest_date', 'actual_harvest_start_date', 'harvest_start', 'harvest_date_is_explicit'),
    (
        'harvest_end_date', 'recorded_harvest_end_date',
        'harvest_end', 'harvest_end_date_is_explicit',
    ),
)


def get_or_create_season_pattern(project: Project) -> SeasonPattern:
    """Return the project's season pattern, creating a Jan 1 default if missing."""
    pattern, _ = SeasonPattern.objects.get_or_create(project=project)
    return pattern


def season_pattern_for_planning(project: Project) -> SeasonPattern:
    """Read the saved pattern or use its defaults without persisting anything."""
    return SeasonPattern.objects.filter(project=project).first() or SeasonPattern(project=project)


def first_season_available(project: Project) -> bool:
    """The first-season flow must never replace historical seasons or migrate plans."""
    return not (
        Season.all_objects.filter(project=project).exists()
        or PlantingPlan.objects.filter(project=project).exists()
    )


def add_months(reference_date: date, months: int) -> date:
    """Add a number of months to a date, clamping the day to the target month's length."""
    month_index = reference_date.month - 1 + months
    year = reference_date.year + month_index // 12
    month = month_index % 12 + 1
    day = min(reference_date.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)


def compute_season_period(pattern: SeasonPattern, anchor_year: int) -> tuple[date, date]:
    """Return the (start_date, end_date) of the season pattern period starting in `anchor_year`."""
    day = min(pattern.start_day, calendar.monthrange(anchor_year, pattern.start_month)[1])
    start_date = date(anchor_year, pattern.start_month, day)
    end_date = add_months(start_date, 12) - timedelta(days=1)
    return start_date, end_date


def compute_period_containing(pattern: SeasonPattern, reference_date: date) -> tuple[date, date]:
    """Return the season pattern period that contains `reference_date`."""
    start_date, end_date = compute_season_period(pattern, reference_date.year)
    if reference_date < start_date:
        return compute_season_period(pattern, reference_date.year - 1)
    return start_date, end_date


def compute_preview_periods(pattern: SeasonPattern, today: date) -> list[dict]:
    """Return the previous, current, and next season pattern periods for the settings preview."""
    current_start, current_end = compute_period_containing(pattern, today)
    previous_start, previous_end = compute_season_period(pattern, current_start.year - 1)
    next_start, next_end = compute_season_period(pattern, current_start.year + 1)
    return [
        {'start_date': previous_start, 'end_date': previous_end, 'is_current': False},
        {'start_date': current_start, 'end_date': current_end, 'is_current': True},
        {'start_date': next_start, 'end_date': next_end, 'is_current': False},
    ]


def _pattern_start_for_year(pattern: SeasonPattern, year: int) -> date:
    """Return the pattern's start day/month in `year`, clamped to the month length."""
    day = min(pattern.start_day, calendar.monthrange(year, pattern.start_month)[1])
    return date(year, pattern.start_month, day)


def compute_next_pattern_start_after(pattern: SeasonPattern, reference_date: date) -> date:
    """Return the earliest pattern start date strictly after `reference_date`."""
    candidate = _pattern_start_for_year(pattern, reference_date.year)
    if candidate <= reference_date:
        candidate = _pattern_start_for_year(pattern, reference_date.year + 1)
    return candidate


def compute_custom_season_period(pattern: SeasonPattern, start_date: date) -> tuple[date, date]:
    """Return an individual season period for a hand-picked `start_date`.

    The end date is the day before the next pattern start on/after `start_date`,
    so a transitional season snaps back onto the regular pattern grid rather
    than running a fixed 12 months from an off-grid start.
    """
    return start_date, compute_next_pattern_start_after(pattern, start_date) - timedelta(days=1)


def compute_manual_season_period(pattern: SeasonPattern, start_date: date) -> tuple[date, date]:
    """Return the period for a hand-picked manual start in the gap-decision flow.

    Unlike `compute_custom_season_period` (a short transition season that snaps
    to the next pattern start), the manual season runs from `start_date` through
    the *end of the following full pattern period*: it closes the gap as far as
    the user drags the start date and then absorbs the next regular season, so
    the plans copied into it (shifted by the whole-year gap) land back in range.
    Example: pattern Jan 1, start 2026-09-01 -> 2026-09-01 .. 2027-12-31.
    """
    next_start = compute_next_pattern_start_after(pattern, start_date)
    return start_date, add_months(next_start, 12) - timedelta(days=1)


def analyze_period_transition(previous_end: date, next_start: date) -> dict | None:
    """Classify the join between one period's end and the next period's start.

    Returns ``None`` when they are seamless (the next period starts the day
    after the previous one ends), otherwise a dict with ``kind`` (``'gap'`` or
    ``'overlap'``) and the ``start_date``/``end_date`` of the affected range.
    """
    seam = previous_end + timedelta(days=1)
    if next_start == seam:
        return None
    if next_start > seam:
        return {'kind': 'gap', 'start_date': seam, 'end_date': next_start - timedelta(days=1)}
    return {'kind': 'overlap', 'start_date': next_start, 'end_date': previous_end}


def latest_existing_season(project: Project) -> Season | None:
    """Return the project's chronologically latest (not soft-deleted) season."""
    return Season.objects.filter(project=project).order_by('-start_date').first()


def is_historical_copy_period(source: Season, target_start: date) -> bool:
    return source.end_date < target_start


def is_preceding_copy_period(source: Season, target_start: date) -> bool:
    """Allow a pattern transition while ruling out a gap of a full annual period."""
    previous_year_start = add_months(target_start, -12) if target_start.year > 1 else date.min
    return previous_year_start <= source.end_date < target_start


def preceding_season_copy_source(project: Project, target_start: date) -> Season | None:
    candidate = Season.objects.filter(
        project=project, start_date__lt=target_start,
    ).order_by('-start_date').first()
    if candidate is not None and is_preceding_copy_period(candidate, target_start):
        return candidate
    return None


def compute_first_future_pattern_period(
    pattern: SeasonPattern, latest_season: Season,
) -> tuple[date, date] | None:
    """Return the first full pattern period that starts after `latest_season` ends."""
    anchor_year = latest_season.start_date.year + 1
    while anchor_year < date.max.year:
        next_start, next_end = compute_season_period(pattern, anchor_year)
        if next_start > latest_season.end_date:
            return next_start, next_end
        anchor_year += 1
    return None


def compute_due_season_period(project: Project, today: date | None = None) -> tuple[date, date]:
    """Return the season pattern period that should be active today for `project`."""
    pattern = get_or_create_season_pattern(project)
    return compute_period_containing(pattern, today or date.today())


def find_due_but_missing_season(
    project: Project, today: date | None = None, *, pattern: SeasonPattern | None = None,
) -> tuple[date, date] | None:
    """Return the next season period that can be created for ``project``.

    Once a project has seasons, the suggestion follows its chronologically
    latest season rather than the period containing today's date. Projects
    without a season retain the initial suggestion for the current period.
    """
    pattern = pattern if pattern is not None else season_pattern_for_planning(project)
    latest_season = latest_existing_season(project)
    if latest_season is None:
        if pattern.start_day != 1 and first_season_available(project):
            pattern = SeasonPattern(start_month=pattern.start_month)
        return compute_period_containing(pattern, today or date.today())

    next_period = compute_first_future_pattern_period(pattern, latest_season)
    if next_period is None:
        return None
    next_start, next_end = next_period
    overlaps_existing = Season.objects.filter(
        project=project,
        start_date__lte=next_end,
        end_date__gte=next_start,
    ).exists()
    return None if overlaps_existing else (next_start, next_end)


def planting_date_fits_period(planting_date: date | None, start_date: date, end_date: date) -> bool:
    """Whether a (already shifted) `planting_date` falls inside `[start_date, end_date]`.

    A missing `planting_date` always fits — there is nothing to place out of
    range. Harvest dates are deliberately not checked here: they legitimately
    fall after a season's end (see docs/seasons-architecture.md).
    """
    return planting_date is None or start_date <= planting_date <= end_date


def plan_continues_into_period(
    area_assigned: bool, planting_date: date | None, occupancy_end: date | None, period_start: date,
) -> bool:
    """An older planting remains on its growing area on the first day of the period."""
    return (
        area_assigned and planting_date is not None and occupancy_end is not None
        and planting_date < period_start <= occupancy_end
    )


def whole_year_offset_into_period(reference: date, start_date: date, end_date: date) -> int:
    """Whole number of years to add to `reference` so it lands in `[start, end]`.

    The month and day are preserved; only the year moves. This is what "copy
    this plan into the target season" means — a plan planted in April is planted
    the following April, regardless of how the two seasons' start *years* line
    up. That distinction matters when the source season is longer than 12 months
    (e.g. a manual transition season spanning two calendar years): its plans do
    not all share one year offset relative to the target, so the shift must be
    derived per plan, not from the source season's start year.

    When the target period is shorter than a year and `reference`'s month is not
    covered by it, the returned offset lands just outside — the caller's
    `planting_date_fits_period` check then drops that plan, as before.
    """
    offset_years = start_date.year - reference.year
    shifted = add_months(reference, offset_years * 12)
    if shifted < start_date:
        offset_years += 1
    elif shifted > end_date:
        offset_years -= 1
    return offset_years


def _season_copy_fields(plan: PlantingPlan, crop_index: GeneralCropIndex | None) -> dict[str, Any]:
    fields = {field: getattr(plan, field) for field in PLANTING_PLAN_COPY_FIELDS}
    if plan.is_individual:
        fields['individual_positions'] = [
            {**position, 'id': str(uuid4())} for position in plan.individual_positions
        ]
    if crop_index is None:
        return fields

    planned = plan_event_dates(plan, crop_index)
    cultivation = plan_cultivation_type(plan, crop_index)
    if cultivation in ('pre_cultivation', PlantingPlan.CULTIVATION_TYPE_PURCHASED_TRANSPLANT):
        fields['planting_date'] = plan.actual_transplanting_date or plan.planting_date
    else:
        fields['planting_date'] = plan.actual_sowing_date or plan.planting_date
    fields['planned_propagation_start_date'] = None
    fields['planned_sowing_date'] = None
    if cultivation == 'pre_cultivation':
        fields['planned_propagation_start_date'] = (
            plan.actual_propagation_start_date or planned.get('propagation_start')
        )
        fields['planned_sowing_date'] = plan.actual_sowing_date or planned.get('sowing')
    planned_start, planned_end = plan.planned_harvest_dates(crop_index)
    fields['harvest_date'] = plan.actual_harvest_start_date or planned_start
    fields['harvest_end_date'] = plan.recorded_harvest_end_date or planned_end
    return fields


def _keep_equivalent_dates_computed(
    source: PlantingPlan, copy: PlantingPlan, crop_index: GeneralCropIndex,
) -> None:
    """Keep crop-derived dates when they still match the shifted fallback exactly."""
    derived = plan_event_dates(PlantingPlan(
        crop=copy.crop, cultivation_type=copy.cultivation_type, planting_date=copy.planting_date,
    ), crop_index)
    for field, actual_field, event, flag_field in COMPUTED_COPY_DATE_FIELDS:
        actual = getattr(source, actual_field)
        value = getattr(copy, field)
        if getattr(source, field) is None and actual is None and value == derived.get(event):
            setattr(copy, field, None)
        if flag_field is not None:
            explicit = (
                getattr(source, flag_field) or actual is not None or value != derived.get(event)
            )
            setattr(copy, flag_field, value is not None and explicit)


def build_planting_plan_copies(
    *,
    source_season: Season,
    target_season: Season,
    restrict_to_target_period: bool = True,
    use_actual_dates: bool = False,
) -> tuple[list[tuple[PlantingPlan, PlantingPlan]], int, int, int]:
    """Unsaved copies of `source_season`'s plans, shifted into `target_season`.

    Returns `(source, copy)` pairs and counts for out-of-period, continuing,
    and unconfigured perennial plans. The copy
    shares the source's crop and bed instances, so checking the copies (e.g.
    for crop rotation) needs no further queries. See `copy_planting_plans`
    for the date-shift and range rules.
    """
    fallback_offset = (target_season.start_date.year - source_season.start_date.year) * 12

    def month_offset_for(planting_date: date | None) -> int:
        if planting_date is None:
            return fallback_offset
        return 12 * whole_year_offset_into_period(
            planting_date, target_season.start_date, target_season.end_date,
        )

    source_plans = (
        PlantingPlan.objects
        .filter(season=source_season, project_id=target_season.project_id)
        .select_related('crop', 'crop__crop_species', 'bed')
        .prefetch_related('crop__crop_species__translations')
        .order_by('pk')
    )
    pairs: list[tuple[PlantingPlan, PlantingPlan]] = []
    skipped_count = 0
    continuing_count = 0
    unconfigured_count = 0
    crop_index = build_general_crop_index(source_season.project_id)
    for plan in source_plans:
        if plan_continues_into_period(
            plan.growing_area_assigned, plan.planting_date, plan.occupancy_end_date,
            target_season.start_date,
        ):
            continuing_count += 1
            continue
        fields = _season_copy_fields(plan, crop_index if use_actual_dates else None)
        month_offset = month_offset_for(fields['planting_date'])
        for date_field in PLANTING_PLAN_SHIFTED_DATE_FIELDS:
            value = fields[date_field]
            fields[date_field] = None if value is None else add_months(value, month_offset)
        if restrict_to_target_period and not planting_date_fits_period(
            fields['planting_date'], target_season.start_date, target_season.end_date,
        ):
            skipped_count += 1
            continue
        copy = PlantingPlan(project=target_season.project, season=target_season, **fields)
        copy.crop = plan.crop
        copy.bed = plan.bed
        if not _prepare_perennial_copy(copy, crop_index):
            unconfigured_count += 1
            continue
        if use_actual_dates:
            _keep_equivalent_dates_computed(plan, copy, crop_index)
        pairs.append((plan, copy))
    return pairs, skipped_count, continuing_count, unconfigured_count


def _has_perennial_copy_defaults(plan: PlantingPlan, crop_index: GeneralCropIndex) -> bool:
    if resolve_crop_field(plan.crop, 'life_cycle', crop_index) != 'perennial':
        return True
    return bool(
        plan.planting_date and resolve_crop_field(plan.crop, 'standing_time_years', crop_index)
    )


def _prepare_perennial_copy(plan: PlantingPlan, crop_index: GeneralCropIndex) -> bool:
    if resolve_crop_field(plan.crop, 'life_cycle', crop_index) != 'perennial':
        plan.clearing_date = None
        return True
    if not _has_perennial_copy_defaults(plan, crop_index):
        return False
    plan.clearing_date = plan.clearing_date or plan.suggested_clearing_date(crop_index)
    return plan.clearing_date is not None and plan.clearing_date >= plan.planting_date


def copy_planting_plans(
    *,
    source_season: Season,
    target_season: Season,
    restrict_to_target_period: bool = True,
    rotation_conflicts: str = 'keep',
    language_code: str = 'de',
    use_actual_dates: bool = False,
    parcel_rotation_fingerprint: str | None = None,
) -> tuple[list[PlantingPlan], int, int, int]:
    """Copy planting plans from `source_season` into `target_season`, additively.

    Planting, harvest and harvest-end dates are shifted forward (or back) by a
    whole number of years, chosen per plan so the `planting_date` keeps its
    month and day but lands in the target season's period (see
    `whole_year_offset_into_period`). All three dates of one plan move by the
    same offset, so its growth duration is preserved. Feb 29 is clamped to
    Feb 28 when the shifted year is not a leap year. Plans without a
    `planting_date` fall back to the whole-year gap between the two seasons'
    start dates.

    When `restrict_to_target_period` is True (the default), a source plan is
    only copied if its *shifted* `planting_date` falls within the target
    season's period — relevant for short transition seasons, where a source
    month may not be covered at all. Harvest dates are never range-checked.

    `rotation_conflicts` decides what happens to copies that would break the
    crop rotation on their bed (see `farm.services.crop_rotation`): `keep`
    copies them onto the same bed (the conflict stays visible), `without_bed`
    copies area plans as open assignments and skips individual bed plans,
    and `skip` leaves all conflicting plans out.
    Plans left out this way are not counted in the returned skipped count.

    Existing planting plans already in `target_season` are left untouched —
    this only ever appends copies of the source season's plans. Returns
    created plans and separate out-of-period, continuing, and unconfigured counts.
    """
    pairs, skipped_count, continuing_count, unconfigured_count = build_planting_plan_copies(
        source_season=source_season,
        target_season=target_season,
        restrict_to_target_period=restrict_to_target_period,
        use_actual_dates=use_actual_dates,
    )
    predecessor = preceding_season_copy_source(target_season.project, target_season.start_date)
    if parcel_rotation_fingerprint is not None:
        pairs = apply_confirmed_parcel_rotation(
            source_season, target_season, pairs, preceding=source_season == predecessor,
            continuing_count=continuing_count, fingerprint=parcel_rotation_fingerprint,
            language_code=language_code, rotation_conflicts=rotation_conflicts,
        )
    if source_season == predecessor:
        for source, copy in pairs:
            copy.copied_from_plan_id = source.pk
    new_plans = [copy for _, copy in pairs]
    if rotation_conflicts != 'keep' and pairs:
        from farm.services.crop_rotation import (
            COPY_CONFLICTS_WITHOUT_BED,
            RotationService,
            check_season_copies,
        )

        service = RotationService(
            target_season.project_id, language_code=language_code,
            region=target_season.project.region or '',
        )
        new_plans = []
        for (_, copy), result in zip(pairs, check_season_copies(service, pairs), strict=True):
            if not result.is_conflict:
                new_plans.append(copy)
            elif rotation_conflicts == COPY_CONFLICTS_WITHOUT_BED and not copy.individual_bed:
                copy.bed = None
                new_plans.append(copy)
    created = PlantingPlan.objects.bulk_create(new_plans)
    generate_tasks_for_plans(created)
    return created, skipped_count, continuing_count, unconfigured_count


def _season_copy_count_summary(
    total: int, copied: int, skipped: int, continuing: int, unconfigured: int,
) -> dict[str, int]:
    result = {'total': total, 'copied': copied, 'skipped': skipped}
    if continuing:
        result['continuing_count'] = continuing
    if unconfigured:
        result['unconfigured_perennial_count'] = unconfigured
    return result


def preview_copy_counts(
    *,
    source_periods: list[tuple[bool, date | None, date | None, bool]],
    target_start: date,
    target_end: date,
) -> dict:
    """Count eligible, out-of-period, and continuing plans for a suggested season."""
    copied = 0
    continuing = 0
    unconfigured = 0
    for area_assigned, planting_date, occupancy_end, ready in source_periods:
        if plan_continues_into_period(area_assigned, planting_date, occupancy_end, target_start):
            continuing += 1
            continue
        if not ready:
            unconfigured += 1
            continue
        if planting_date is None:
            copied += 1
            continue
        offset_years = whole_year_offset_into_period(planting_date, target_start, target_end)
        if planting_date_fits_period(
            add_months(planting_date, offset_years * 12), target_start, target_end,
        ):
            copied += 1
    total = len(source_periods)
    return _season_copy_count_summary(
        total, copied, total - copied - continuing - unconfigured, continuing, unconfigured,
    )


def _transition_copy_placement(
    reference: date | None,
    source_start_year: int,
    periods: dict[str, tuple[date, date]],
) -> tuple[str, int] | None:
    """Choose the earliest destination period with room for the plan's month and day."""
    for key, (start, end) in periods.items():
        if reference is None:
            return key, (start.year - source_start_year) * 12
        months = whole_year_offset_into_period(reference, start, end) * 12
        if planting_date_fits_period(add_months(reference, months), start, end):
            return key, months
    return None


def preview_bridged_copy_counts(
    *,
    source_periods: list[tuple[bool, date | None, date | None, bool]],
    source_start_year: int,
    transition_start: date, transition_end: date,
    followup_start: date, followup_end: date,
) -> dict:
    """Count each plan in the first period it fits, separating continuing plans from other skips."""
    counts = {
        'transition': 0, 'followup': 0, 'skipped': 0,
        'continuing_count': 0, 'unconfigured_perennial_count': 0,
    }
    periods = {
        'transition': (transition_start, transition_end),
        'followup': (followup_start, followup_end),
    }
    for area_assigned, planting_date, occupancy_end, ready in source_periods:
        placement = _transition_copy_placement(planting_date, source_start_year, periods)
        if placement is None:
            counts['skipped'] += 1
            continue
        key, _ = placement
        start, _ = periods[key]
        if plan_continues_into_period(area_assigned, planting_date, occupancy_end, start):
            counts['continuing_count'] += 1
        elif not ready:
            counts['unconfigured_perennial_count'] += 1
        else:
            counts[key] += 1
    return {'total': len(source_periods), **counts}


def _build_distributed_plan_copies(
    *,
    source_season: Season,
    transition_season: Season,
    followup_season: Season,
    use_actual_dates: bool,
) -> tuple[dict[str, list[tuple[PlantingPlan, PlantingPlan]]], int, int, int]:
    """Shift each plan once, then route it by its resulting planned planting date."""
    per_target: dict[str, list[tuple[PlantingPlan, PlantingPlan]]] = {'first': [], 'second': []}
    target_season = {'first': transition_season, 'second': followup_season}
    periods = {key: (season.start_date, season.end_date) for key, season in target_season.items()}
    skipped_count = 0
    continuing_count = 0
    unconfigured_count = 0
    crop_index = build_general_crop_index(source_season.project_id)
    source_plans = (
        PlantingPlan.objects
        .filter(season=source_season, project_id=transition_season.project_id)
        .select_related('crop', 'crop__crop_species', 'bed')
        .prefetch_related('crop__crop_species__translations')
        .order_by('pk')
    )
    for plan in source_plans:
        fields = _season_copy_fields(plan, crop_index if use_actual_dates else None)
        placement = _transition_copy_placement(
            fields['planting_date'], source_season.start_date.year, periods,
        )
        if placement is None:
            skipped_count += 1
            continue
        route, month_offset = placement
        season = target_season[route]
        if plan_continues_into_period(
            plan.growing_area_assigned, plan.planting_date, plan.occupancy_end_date,
            season.start_date,
        ):
            continuing_count += 1
            continue
        for date_field in PLANTING_PLAN_SHIFTED_DATE_FIELDS:
            value = fields[date_field]
            fields[date_field] = add_months(value, month_offset) if value else None
        copy = PlantingPlan(project=season.project, season=season, **fields)
        copy.crop = plan.crop
        copy.bed = plan.bed
        if not _prepare_perennial_copy(copy, crop_index):
            unconfigured_count += 1
            continue
        if use_actual_dates:
            _keep_equivalent_dates_computed(plan, copy, crop_index)
        per_target[route].append((plan, copy))

    return per_target, skipped_count, continuing_count, unconfigured_count


def distribute_planting_plans(
    *,
    source_season: Season,
    transition_season: Season,
    followup_season: Season,
    use_actual_dates: bool = False,
    parcel_rotation_fingerprint: str | None = None,
    language_code: str = 'de',
) -> dict:
    """Copy the selected source across the transition and follow-up periods."""
    per_target, skipped_count, continuing_count, unconfigured_count = (
        _build_distributed_plan_copies(
            source_season=source_season, transition_season=transition_season,
            followup_season=followup_season, use_actual_dates=use_actual_dates,
        )
    )
    predecessor = preceding_season_copy_source(
        transition_season.project, transition_season.start_date,
    )
    if parcel_rotation_fingerprint is not None:
        first_count = len(per_target['first'])
        copy_period = Season(
            project=transition_season.project, start_date=transition_season.start_date,
            end_date=followup_season.end_date,
        )
        rotated = apply_confirmed_parcel_rotation(
            source_season, copy_period, [*per_target['first'], *per_target['second']],
            preceding=source_season == predecessor, continuing_count=continuing_count,
            fingerprint=parcel_rotation_fingerprint, language_code=language_code,
        )
        per_target = {'first': rotated[:first_count], 'second': rotated[first_count:]}
    if source_season == predecessor:
        for pairs in per_target.values():
            for source, copy in pairs:
                copy.copied_from_plan_id = source.pk

    created = {
        'transition': PlantingPlan.objects.bulk_create([copy for _, copy in per_target['first']]),
        'followup': PlantingPlan.objects.bulk_create([copy for _, copy in per_target['second']]),
        'skipped': skipped_count,
        'continuing_count': continuing_count,
        'unconfigured_perennial_count': unconfigured_count,
    }
    generate_tasks_for_plans([*created['transition'], *created['followup']])
    return created


def synchronize_season_harvest_tasks(
    season: Season, *, previous_period: tuple[date, date] | None = None,
    restoring: bool = False,
) -> None:
    start, end = season.start_date, season.end_date
    if previous_period is not None:
        start = min(start, previous_period[0])
        end = max(end, previous_period[1])
    candidates = Q(occupied_until__gte=start) & (
        Q(planting_date__lte=end) | Q(actual_sowing_date__lte=end)
        | Q(actual_transplanting_date__lte=end)
    )
    if restoring:
        # Plans may have been cleared and other seasons added while this one was absent.
        prior_tasks = Task.objects.filter(
            project_id=season.project_id, season=season, origin='automatic', occurrence_index__gt=0,
        )
        candidates |= Q(season_id=season.pk) | Q(pk__in=prior_tasks.values('planting_plan_id'))
    plans = (
        PlantingPlan.objects.filter(project_id=season.project_id)
        .alias(occupied_until=PlantingPlan.occupancy_end_expression())
        .filter(candidates)
    )
    synchronize_recurring_harvest_tasks(
        plans, new_season_id=season.pk if previous_period is None and not restoring else None,
        fill_past_occurrences=restoring,
        fill_past_season_id=season.pk if previous_period is not None else None,
    )


@transaction.atomic
def get_or_create_season_for_period(
    project: Project,
    start_date: date,
    end_date: date,
    *,
    created_by=None,
    user_name: str = '',
) -> Season:
    """Return the project's season starting on `start_date`, creating it if missing."""
    season, created = Season.objects.get_or_create(
        project=project,
        start_date=start_date,
        defaults={'end_date': end_date, 'created_by': created_by},
    )
    if created:
        from farm.history import _serialize_instance, record_entity_revision

        synchronize_season_harvest_tasks(season)
        record_entity_revision(
            project=project, entity_type='season', object_id=season.pk,
            action=EntityRevision.ACTION_CREATED,
            snapshot={**_serialize_instance(season), '_project_version_internal': True},
            display_name=season.label, user_name=user_name,
        )
    return season


def get_or_create_season_for_date(
    project: Project,
    reference_date: date | None = None,
    *,
    created_by=None,
) -> Season:
    """Return the project's season containing `reference_date` (today if None).

    The single entry point for "this plan needs *some* season": it resolves the
    period from the project's own pattern, so a project never ends up with a
    season it did not configure.
    """
    pattern = get_or_create_season_pattern(project)
    start_date, end_date = compute_period_containing(pattern, reference_date or date.today())
    return get_or_create_season_for_period(project, start_date, end_date, created_by=created_by)


def earliest_unassigned_planting_date(project: Project) -> date | None:
    """Return the earliest `planting_date` among `project`'s season-less plans, if any."""
    return (
        PlantingPlan.objects
        .filter(project=project, season__isnull=True)
        .exclude(planting_date__isnull=True)
        .order_by('planting_date')
        .values_list('planting_date', flat=True)
        .first()
    )


def compute_setup_target_period(project: Project, pattern: SeasonPattern | None = None) -> tuple[date, date]:
    """Return the period the first-run setup (and the seeders) would assign unassigned plans to.

    Anchored on the earliest unassigned plan's `planting_date` rather than on
    today, so legacy data lands in the season matching its own history
    instead of whatever period happens to contain "today" when setup runs.
    Falls back to today only when every unassigned plan is missing a
    `planting_date` (or there are none).

    Accepts an optional in-memory `pattern` override (unsaved `start_day`/
    `start_month`) so callers can preview the effect of a not-yet-saved
    pattern choice, mirroring `SeasonPatternPreviewView`.
    """
    pattern = pattern or get_or_create_season_pattern(project)
    reference_date = earliest_unassigned_planting_date(project) or date.today()
    return compute_period_containing(pattern, reference_date)


def assign_unassigned_planting_plans(
    project: Project, *, owner: Any | None = None,
) -> Season | None:
    """Put every season-less planting plan of `project` into a matching season.

    Used by the project seeders (demo and hint-test fixtures), which create
    planting plans directly instead of going through the API. Without this
    their plans would look like pre-season legacy data and trigger the
    first-run migration modal on a project that was just created.

    Returns None when there is nothing to assign.
    """
    unassigned = PlantingPlan.objects.filter(project=project, season__isnull=True)
    if not unassigned.exists():
        return None

    start_date, end_date = compute_setup_target_period(project)
    season = get_or_create_season_for_period(
        project,
        start_date,
        end_date,
        created_by=owner if owner and getattr(owner, 'pk', None) else None,
    )
    unassigned.update(season=season)
    generate_tasks_for_plans(
        PlantingPlan.objects.filter(project=project, season=season)
        .select_related('crop', 'season'),
    )
    return season


def serialize_period_transition(raw_transition: dict) -> dict:
    """Convert an `analyze_period_transition` result to JSON-safe ISO strings."""
    return {
        'kind': raw_transition['kind'],
        'start_date': raw_transition['start_date'].isoformat(),
        'end_date': raw_transition['end_date'].isoformat(),
    }


def _preview_creation_copy(
    source: Season,
    target: Season,
    source_periods: list[tuple[bool, date | None, date | None, bool]],
    use_actual_dates: bool,
) -> dict[str, int]:
    if not use_actual_dates:
        return preview_copy_counts(
            source_periods=source_periods,
            target_start=target.start_date, target_end=target.end_date,
        )
    pairs, skipped, continuing, unconfigured = build_planting_plan_copies(
        source_season=source, target_season=target, use_actual_dates=True,
    )
    copied = len(pairs)
    return _season_copy_count_summary(
        copied + skipped + continuing + unconfigured, copied, skipped, continuing, unconfigured,
    )


def _preview_creation_transition(
    source: Season,
    transition: Season,
    followup: Season,
    source_periods: list[tuple[bool, date | None, date | None, bool]],
    use_actual_dates: bool,
) -> dict[str, dict[str, int]]:
    if use_actual_dates:
        pairs, skipped, continuing, unconfigured = _build_distributed_plan_copies(
            source_season=source, transition_season=transition, followup_season=followup,
            use_actual_dates=True,
        )
        counts = (len(pairs['first']), len(pairs['second']))
        total = sum(counts) + skipped + continuing + unconfigured
    else:
        bridged = preview_bridged_copy_counts(
            source_periods=source_periods,
            source_start_year=source.start_date.year,
            transition_start=transition.start_date, transition_end=transition.end_date,
            followup_start=followup.start_date, followup_end=followup.end_date,
        )
        counts = (bridged['transition'], bridged['followup'])
        total, skipped = bridged['total'], bridged['skipped']
        continuing = bridged['continuing_count']
        unconfigured = bridged['unconfigured_perennial_count']
    return {
        key: _season_copy_count_summary(total, copied, skipped, continuing, unconfigured)
        for key, copied in zip(('transition', 'transition_followup'), counts, strict=True)
    }


def _planned_copy_periods(
    source: Season | None, use_actual_dates: bool,
) -> list[tuple[bool, date | None, date | None, bool]]:
    if source is None or use_actual_dates:
        return []
    crop_index = build_general_crop_index(source.project_id)
    return [
        (plan.growing_area_assigned, plan.planting_date, plan.occupancy_end_date,
         _has_perennial_copy_defaults(plan, crop_index))
        for plan in PlantingPlan.objects.filter(season=source).select_related('crop')
    ]


def _preview_creation_parcel_rotation(
    source: Season, target: Season, followup: Season | None, *,
    use_actual_dates: bool, preceding: bool, requested: bool, language_code: str,
) -> dict:
    if not requested or not preceding:
        return preview_parcel_rotation(
            source, target, [], preceding=preceding, requested=False, continuing_count=0,
        ).summary
    if followup is None:
        pairs, _, continuing, _ = build_planting_plan_copies(
            source_season=source, target_season=target, use_actual_dates=use_actual_dates,
        )
    else:
        by_target, _, continuing, _ = _build_distributed_plan_copies(
            source_season=source, transition_season=target, followup_season=followup,
            use_actual_dates=use_actual_dates,
        )
        pairs = [*by_target['first'], *by_target['second']]
        target = Season(project=target.project, start_date=target.start_date,
                        end_date=followup.end_date)
    return preview_parcel_rotation(
        source, target, pairs, preceding=preceding, requested=True, continuing_count=continuing,
        language_code=language_code,
    ).summary


def _creation_copy_options(
    project: Project,
    targets: dict[str, Season],
    seasons: list[Season],
    *,
    use_actual_dates: bool,
    copy_source: Season | None,
    copy_target: str,
    rotate_parcels: bool,
    language_code: str,
) -> dict[str, Any] | None:
    eligible_by_target = {
        choice: [season for season in seasons
                 if is_historical_copy_period(season, target.start_date)]
        for choice, target in targets.items()
    }
    if copy_source is not None and copy_source not in eligible_by_target.get(copy_target, []):
        return None

    options: dict[str, Any] = {
        'copy_source_season_id': None,
        'copy_source_label': None,
        'copy_sources': {'adopt': [], 'transition': [], 'manual': []},
        'copy_is_preceding_source': {'adopt': False, 'transition': False, 'manual': False},
        'parcel_rotation': {'adopt': None, 'transition': None, 'manual': None},
        'copy_preview': {'adopt': None, 'transition': None, 'transition_followup': None, 'manual': None},
    }
    plan_periods = {}
    for choice, candidates in eligible_by_target.items():
        options['copy_sources'][choice] = [
            {'id': season.pk, 'label': season.label} for season in candidates
        ]
        if not candidates or (copy_source is not None and choice != copy_target):
            continue
        source = copy_source or candidates[0]
        target = targets[choice]
        if choice == copy_target:
            options['copy_source_season_id'] = source.pk
            options['copy_source_label'] = source.label
        preceding = source == preceding_season_copy_source(project, target.start_date)
        options['copy_is_preceding_source'][choice] = preceding
        followup = targets['adopt'] if choice == 'transition' else None
        options['parcel_rotation'][choice] = _preview_creation_parcel_rotation(
            source, target, followup, use_actual_dates=use_actual_dates, preceding=preceding,
            requested=rotate_parcels and choice == copy_target, language_code=language_code,
        )
        if source.pk not in plan_periods:
            plan_periods[source.pk] = _planned_copy_periods(source, use_actual_dates)
        periods = plan_periods[source.pk]
        if choice == 'transition':
            options['copy_preview'].update(_preview_creation_transition(
                source, target, targets['adopt'], periods, use_actual_dates,
            ))
        else:
            options['copy_preview'][choice] = _preview_creation_copy(
                source, target, periods, use_actual_dates,
            )
    return options


def build_season_creation_options(
    project: Project,
    *,
    manual_start: date | None = None,
    use_actual_dates: bool = False,
    copy_source: Season | None = None,
    copy_target: str | None = None,
    rotate_parcels: bool = False,
    language_code: str = 'en',
) -> dict[str, Any] | None:
    """Describe the gap/overlap decision for the next season the user would create.

    The season switcher calls this before creating a season from the current
    pattern. When the pattern period following the latest existing season
    leaves a gap (or overlaps it), the flow shows an intermediate step so the
    user decides explicitly instead of silently adopting whatever the pattern
    computes. `manual_start` is the date the user is considering for a
    hand-picked start; without one the manual branch stays empty. An explicit
    source must be eligible for the requested branch. Otherwise return None.
    """
    pattern = season_pattern_for_planning(project)
    seasons = list(Season.objects.filter(project=project).order_by('-start_date', '-pk'))
    latest_season = seasons[0] if seasons else None
    due_period = find_due_but_missing_season(project, pattern=pattern)
    targets: dict[str, Season] = {}

    payload: dict[str, Any] = {
        'start_day': pattern.start_day,
        'start_month': pattern.start_month,
        'first_season': latest_season is None and first_season_available(project),
        'last_season': None,
        'due_period': None,
        'transition': None,
        'seamless_period': None,
        'manual_period': None,
        'manual_residual': None,
    }

    if due_period is not None:
        due_start, due_end = due_period
        payload['due_period'] = {
            'start_date': due_start.isoformat(),
            'end_date': due_end.isoformat(),
        }
        targets['adopt'] = Season(project=project, start_date=due_start, end_date=due_end)

    if latest_season is not None:
        payload['last_season'] = {
            'start_date': latest_season.start_date.isoformat(),
            'end_date': latest_season.end_date.isoformat(),
            'label': latest_season.label,
        }
        if due_period is not None:
            due_start, _ = due_period
            raw_transition = analyze_period_transition(latest_season.end_date, due_start)
            if raw_transition is not None:
                payload['transition'] = serialize_period_transition(raw_transition)
                seamless_start = latest_season.end_date + timedelta(days=1)
                seamless_start, seamless_end = compute_custom_season_period(pattern, seamless_start)
                payload['seamless_period'] = {
                    'start_date': seamless_start.isoformat(),
                    'end_date': seamless_end.isoformat(),
                }
                targets['transition'] = Season(
                    project=project, start_date=seamless_start, end_date=seamless_end,
                )

    if manual_start is not None:
        manual_start, manual_end = compute_manual_season_period(pattern, manual_start)
        payload['manual_period'] = {
            'start_date': manual_start.isoformat(),
            'end_date': manual_end.isoformat(),
        }
        targets['manual'] = Season(project=project, start_date=manual_start, end_date=manual_end)
        if latest_season is not None:
            raw_residual = analyze_period_transition(latest_season.end_date, manual_start)
            payload['manual_residual'] = (
                serialize_period_transition(raw_residual) if raw_residual is not None else None
            )

    copy_options = _creation_copy_options(
        project, targets, seasons, use_actual_dates=use_actual_dates, copy_source=copy_source,
        copy_target=copy_target or ('manual' if manual_start else 'adopt'),
        rotate_parcels=rotate_parcels, language_code=language_code,
    )
    return {**payload, **copy_options} if copy_options is not None else None


def find_soft_deleted_season(project: Project, start_date: date) -> Season | None:
    """The soft-deleted season occupying this project's `start_date` slot.

    Creating a season for a period a deleted one already holds has to undelete
    that row rather than insert a second one, which the unique constraint on
    (project, start_date) would reject anyway.
    """
    return (
        Season.all_objects
        .filter(project=project, start_date=start_date, deleted_at__isnull=False)
        .first()
    )


def restore_season_contents(season: Season, batch, *, user_name: str) -> None:
    from farm.history.records import internal_project_versions, revision_batch
    from farm.history.restore import restore_season_planting_plans

    with internal_project_versions(), revision_batch(batch):
        restore_season_planting_plans(season.project, season, batch, user_name=user_name)
        synchronize_season_harvest_tasks(season, restoring=True)


@transaction.atomic
def resurrect_season(
    season: Season,
    end_date: date,
    user,
    batch,
    *,
    user_name: str,
) -> Season:
    """Undelete `season` into `[season.start_date, end_date]` and bring back the
    planting plans (and their tasks) hard-deleted with it.

    Re-creating a season's period is an undelete, so this is what the create,
    create-transition and `undelete` paths all do once they find a deleted row.
    """
    from farm.history import _entity_display_name, _serialize_instance, record_entity_revision

    season.deleted_at = None
    season.end_date = end_date
    season.created_by = user
    season.save(update_fields=['deleted_at', 'end_date', 'created_by', 'updated_at'])
    restore_season_contents(season, batch, user_name=user_name)
    record_entity_revision(
        project=season.project, entity_type='season', object_id=season.pk,
        action=EntityRevision.ACTION_UPDATED,
        snapshot=_serialize_instance(season),
        display_name=_entity_display_name(season),
        changed_fields=['deleted_at', 'end_date'],
        user_name=user_name, batch_operation=batch,
    )
    return season


@transaction.atomic
def create_or_resurrect_season(
    project: Project,
    start_date: date,
    end_date: date,
    user,
    batch,
    *,
    user_name: str,
) -> Season:
    """Create a season for `[start_date, end_date]`, or resurrect the
    soft-deleted one occupying the same (project, start_date) slot."""
    from farm.history import _entity_display_name, _serialize_instance, record_entity_revision

    resurrected = find_soft_deleted_season(project, start_date)
    if resurrected is not None:
        return resurrect_season(resurrected, end_date, user, batch, user_name=user_name)

    season = Season.objects.create(
        project=project, start_date=start_date, end_date=end_date, created_by=user,
    )
    synchronize_season_harvest_tasks(season)
    record_entity_revision(
        project=project, entity_type='season', object_id=season.pk,
        action=EntityRevision.ACTION_CREATED,
        snapshot=_serialize_instance(season),
        display_name=_entity_display_name(season),
        user_name=user_name, batch_operation=batch,
    )
    return season
