"""Season pattern computation and season-to-season data copy.

A season always spans exactly 12 months from its configured start day/month
(see `SeasonPattern` — duration is deliberately not configurable). All period
math here is hemisphere-agnostic: it only cares about the configured
start day/month, never about calendar-year boundaries.
"""

import calendar
from datetime import date, timedelta
from typing import Any

from farm.models import EntityRevision, PlantingPlan, Project, Season, SeasonPattern

# Fields copied from a source PlantingPlan onto a new one in the target
# season. Excludes the primary key, timestamps, audit fields, and the
# project/season FKs themselves (set explicitly by the caller).
PLANTING_PLAN_COPY_FIELDS = (
    'crop_id',
    'bed_id',
    'cultivation_type',
    'planting_date',
    'harvest_date',
    'harvest_end_date',
    'quantity',
    'area_usage_sqm',
    'notes',
)

# Date fields on a copied PlantingPlan that are shifted forward so the copy
# lands in the target season's own period instead of the source season's.
PLANTING_PLAN_SHIFTED_DATE_FIELDS = ('planting_date', 'harvest_date', 'harvest_end_date')


def get_or_create_season_pattern(project: Project) -> SeasonPattern:
    """Return the project's season pattern, creating a Jan 1 default if missing."""
    pattern, _ = SeasonPattern.objects.get_or_create(project=project)
    return pattern


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


def compute_first_future_pattern_period(
    pattern: SeasonPattern, latest_season: Season,
) -> tuple[date, date]:
    """Return the first full pattern period that starts after `latest_season` ends."""
    anchor_year = latest_season.start_date.year + 1
    next_start, next_end = compute_season_period(pattern, anchor_year)
    while next_start <= latest_season.end_date:
        anchor_year += 1
        next_start, next_end = compute_season_period(pattern, anchor_year)
    return next_start, next_end


def compute_due_season_period(project: Project, today: date | None = None) -> tuple[date, date]:
    """Return the season pattern period that should be active today for `project`."""
    pattern = get_or_create_season_pattern(project)
    return compute_period_containing(pattern, today or date.today())


def find_due_but_missing_season(project: Project, today: date | None = None) -> tuple[date, date] | None:
    """Return the next season period that can be created for ``project``.

    Once a project has seasons, the suggestion follows its chronologically
    latest season rather than the period containing today's date. Projects
    without a season retain the initial suggestion for the current period.
    """
    latest_season = latest_existing_season(project)
    if latest_season is None:
        due_start, due_end = compute_due_season_period(project, today)
        return due_start, due_end

    pattern = get_or_create_season_pattern(project)
    next_start, next_end = compute_first_future_pattern_period(pattern, latest_season)

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


def build_planting_plan_copies(
    *,
    source_season: Season,
    target_season: Season,
    restrict_to_target_period: bool = True,
) -> tuple[list[tuple[PlantingPlan, PlantingPlan]], int]:
    """Unsaved copies of `source_season`'s plans, shifted into `target_season`.

    Returns `(source, copy)` pairs plus the number of skipped plans. The copy
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
        .filter(season=source_season)
        .select_related('crop', 'crop__crop_species', 'bed')
        .prefetch_related('crop__crop_species__translations')
        .order_by('pk')
    )
    pairs: list[tuple[PlantingPlan, PlantingPlan]] = []
    skipped_count = 0
    for plan in source_plans:
        fields = {field: getattr(plan, field) for field in PLANTING_PLAN_COPY_FIELDS}
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
        if plan.crop_id is not None:
            copy.crop = plan.crop
        if plan.bed_id is not None:
            copy.bed = plan.bed
        pairs.append((plan, copy))
    return pairs, skipped_count


def copy_planting_plans(
    *,
    source_season: Season,
    target_season: Season,
    restrict_to_target_period: bool = True,
    rotation_conflicts: str = 'keep',
    language_code: str = 'de',
) -> tuple[list[PlantingPlan], int]:
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
    copies them as open assignments without a bed, and `skip` leaves them out.
    Plans left out this way are not counted in the returned skipped count.

    Existing planting plans already in `target_season` are left untouched —
    this only ever appends copies of the source season's plans. Returns
    `(created_plans, skipped_count)` so the caller can record revisions and
    report how many plans were left out.
    """
    pairs, skipped_count = build_planting_plan_copies(
        source_season=source_season,
        target_season=target_season,
        restrict_to_target_period=restrict_to_target_period,
    )
    new_plans = [copy for _, copy in pairs]
    if rotation_conflicts != 'keep' and pairs:
        from farm.services.crop_rotation import (
            COPY_CONFLICTS_WITHOUT_BED,
            RotationService,
            check_season_copies,
        )

        service = RotationService(target_season.project_id, language_code=language_code)
        new_plans = []
        for (_, copy), result in zip(pairs, check_season_copies(service, pairs), strict=True):
            if not result.is_conflict:
                new_plans.append(copy)
            elif rotation_conflicts == COPY_CONFLICTS_WITHOUT_BED:
                copy.bed = None
                new_plans.append(copy)
    return PlantingPlan.objects.bulk_create(new_plans), skipped_count


def preview_copy_counts(
    *,
    source_planting_dates: list[date | None],
    target_start: date,
    target_end: date,
) -> dict:
    """Count how many of `source_planting_dates` would be copied into a target
    period once shifted per plan into range, and how many fall outside it.
    Returns `{total, copied, skipped}`."""
    copied = 0
    for planting_date in source_planting_dates:
        if planting_date is None:
            copied += 1
            continue
        offset_years = whole_year_offset_into_period(planting_date, target_start, target_end)
        if planting_date_fits_period(
            add_months(planting_date, offset_years * 12), target_start, target_end,
        ):
            copied += 1
    total = len(source_planting_dates)
    return {'total': total, 'copied': copied, 'skipped': total - copied}


def _route_shifted_planting_date(
    shifted: date | None,
    first_start: date, first_end: date,
    second_start: date, second_end: date,
) -> str:
    """Return ``'first'``/``'second'``/``'skipped'`` for a shifted planting_date.

    A missing planting_date always goes to the first (transition) season.
    """
    if shifted is None or first_start <= shifted <= first_end:
        return 'first'
    if second_start <= shifted <= second_end:
        return 'second'
    return 'skipped'


def preview_bridged_copy_counts(
    *,
    source_planting_dates: list[date | None],
    source_start_year: int,
    transition_start: date, transition_end: date,
    followup_start: date, followup_end: date,
) -> dict:
    """Route each source plan, shifted by the single whole-year gap to the
    transition season, to whichever of the transition / follow-up season its
    shifted planting_date lands in. Returns `{total, transition, followup, skipped}`."""
    month_offset = (transition_start.year - source_start_year) * 12
    counts = {'transition': 0, 'followup': 0, 'skipped': 0}
    bucket = {'first': 'transition', 'second': 'followup', 'skipped': 'skipped'}
    for planting_date in source_planting_dates:
        shifted = None if planting_date is None else add_months(planting_date, month_offset)
        target = _route_shifted_planting_date(
            shifted, transition_start, transition_end, followup_start, followup_end,
        )
        counts[bucket[target]] += 1
    return {'total': len(source_planting_dates), **counts}


def distribute_planting_plans(
    *,
    source_season: Season,
    transition_season: Season,
    followup_season: Season,
) -> dict:
    """Copy `source_season`'s plans across the transition + follow-up season pair.

    Every plan is shifted once, by the whole-year gap between the source and the
    transition season, then routed to whichever of the two target seasons its
    shifted `planting_date` falls in (the transition season also takes plans with
    no `planting_date`). Plans landing in neither are skipped. Returns
    `{transition: [plans], followup: [plans], skipped: int}`.
    """
    month_offset = (transition_season.start_date.year - source_season.start_date.year) * 12

    def shifted(value: date | None) -> date | None:
        return None if value is None else add_months(value, month_offset)

    per_target: dict[str, list[PlantingPlan]] = {'first': [], 'second': []}
    target_season = {'first': transition_season, 'second': followup_season}
    skipped_count = 0
    for plan in PlantingPlan.objects.filter(season=source_season):
        fields = {field: getattr(plan, field) for field in PLANTING_PLAN_COPY_FIELDS}
        for date_field in PLANTING_PLAN_SHIFTED_DATE_FIELDS:
            fields[date_field] = shifted(fields[date_field])
        route = _route_shifted_planting_date(
            fields['planting_date'],
            transition_season.start_date, transition_season.end_date,
            followup_season.start_date, followup_season.end_date,
        )
        if route == 'skipped':
            skipped_count += 1
            continue
        season = target_season[route]
        per_target[route].append(
            PlantingPlan(project=season.project, season=season, **fields)
        )

    created = {
        'transition': PlantingPlan.objects.bulk_create(per_target['first']),
        'followup': PlantingPlan.objects.bulk_create(per_target['second']),
        'skipped': skipped_count,
    }
    return created


def get_or_create_season_for_period(
    project: Project,
    start_date: date,
    end_date: date,
    *,
    created_by=None,
) -> Season:
    """Return the project's season starting on `start_date`, creating it if missing."""
    season, _ = Season.objects.get_or_create(
        project=project,
        start_date=start_date,
        defaults={'end_date': end_date, 'created_by': created_by},
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


def assign_unassigned_planting_plans(project: Project, *, owner=None) -> Season | None:
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
    return season


def serialize_period_transition(raw_transition: dict) -> dict:
    """Convert an `analyze_period_transition` result to JSON-safe ISO strings."""
    return {
        'kind': raw_transition['kind'],
        'start_date': raw_transition['start_date'].isoformat(),
        'end_date': raw_transition['end_date'].isoformat(),
    }


def build_season_creation_options(
    project: Project,
    *,
    manual_start: date | None = None,
) -> dict[str, Any]:
    """Describe the gap/overlap decision for the next season the user would create.

    The season switcher calls this before creating a season from the current
    pattern. When the pattern period following the latest existing season
    leaves a gap (or overlaps it), the flow shows an intermediate step so the
    user decides explicitly instead of silently adopting whatever the pattern
    computes. `manual_start` is the date the user is considering for a
    hand-picked start; without one the manual branch stays empty.
    """
    pattern = get_or_create_season_pattern(project)
    latest_season = latest_existing_season(project)
    due_period = find_due_but_missing_season(project)

    payload: dict[str, Any] = {
        'start_day': pattern.start_day,
        'start_month': pattern.start_month,
        'last_season': None,
        'due_period': None,
        'transition': None,
        'seamless_period': None,
        'manual_period': None,
        'manual_residual': None,
        'copy_source_label': latest_season.label if latest_season is not None else None,
        'copy_preview': {'adopt': None, 'transition': None, 'transition_followup': None, 'manual': None},
    }

    if due_period is not None:
        due_start, due_end = due_period
        payload['due_period'] = {
            'start_date': due_start.isoformat(),
            'end_date': due_end.isoformat(),
        }

    last_planting_dates: list = []
    if latest_season is not None:
        last_planting_dates = list(
            PlantingPlan.objects
            .filter(season=latest_season)
            .values_list('planting_date', flat=True)
        )
        payload['last_season'] = {
            'start_date': latest_season.start_date.isoformat(),
            'end_date': latest_season.end_date.isoformat(),
            'label': latest_season.label,
        }
        if due_period is not None:
            due_start, due_end = due_period
            payload['copy_preview']['adopt'] = preview_copy_counts(
                source_planting_dates=last_planting_dates,
                target_start=due_start, target_end=due_end,
            )
            raw_transition = analyze_period_transition(latest_season.end_date, due_start)
            if raw_transition is not None:
                payload['transition'] = serialize_period_transition(raw_transition)
                seamless_start = latest_season.end_date + timedelta(days=1)
                seamless_start, seamless_end = compute_custom_season_period(pattern, seamless_start)
                payload['seamless_period'] = {
                    'start_date': seamless_start.isoformat(),
                    'end_date': seamless_end.isoformat(),
                }
                # Choosing "transition season" creates the transition season
                # AND the regular follow-up season; every source plan is
                # shifted once and routed to whichever of the two it lands in.
                bridged = preview_bridged_copy_counts(
                    source_planting_dates=last_planting_dates,
                    source_start_year=latest_season.start_date.year,
                    transition_start=seamless_start, transition_end=seamless_end,
                    followup_start=due_start, followup_end=due_end,
                )
                payload['copy_preview']['transition'] = {
                    'total': bridged['total'],
                    'copied': bridged['transition'],
                    'skipped': bridged['skipped'],
                }
                payload['copy_preview']['transition_followup'] = {
                    'total': bridged['total'],
                    'copied': bridged['followup'],
                    'skipped': bridged['skipped'],
                }

    if manual_start is not None:
        manual_start, manual_end = compute_manual_season_period(pattern, manual_start)
        payload['manual_period'] = {
            'start_date': manual_start.isoformat(),
            'end_date': manual_end.isoformat(),
        }
        if latest_season is not None:
            raw_residual = analyze_period_transition(latest_season.end_date, manual_start)
            payload['manual_residual'] = (
                serialize_period_transition(raw_residual) if raw_residual is not None else None
            )
            payload['copy_preview']['manual'] = preview_copy_counts(
                source_planting_dates=last_planting_dates,
                target_start=manual_start, target_end=manual_end,
            )

    return payload


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
    from farm.history.restore import restore_season_planting_plans

    season.deleted_at = None
    season.end_date = end_date
    season.created_by = user
    season.save(update_fields=['deleted_at', 'end_date', 'created_by', 'updated_at'])
    record_entity_revision(
        project=season.project, entity_type='season', object_id=season.pk,
        action=EntityRevision.ACTION_UPDATED,
        snapshot=_serialize_instance(season),
        display_name=_entity_display_name(season),
        changed_fields=['deleted_at', 'end_date'],
        user_name=user_name, batch_operation=batch,
    )
    restore_season_planting_plans(season.project, season, batch, user_name=user_name)
    return season


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
    record_entity_revision(
        project=project, entity_type='season', object_id=season.pk,
        action=EntityRevision.ACTION_CREATED,
        snapshot=_serialize_instance(season),
        display_name=_entity_display_name(season),
        user_name=user_name, batch_operation=batch,
    )
    return season
