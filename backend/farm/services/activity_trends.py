from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from django.db.models import Count, F, QuerySet, Sum
from django.db.models.functions import TruncDate, TruncMonth, TruncWeek
from django.utils.translation import gettext_lazy as _

from farm.models import Project, ProjectActiveUserDay, ProjectChangeDay
from farm.services.crop_library_usage import migration_applied_at
from farm.services.engagement_dashboard import usage_users

MEASUREMENT_MIGRATION = '0165_platform_usage_activity'
PERIODS = (7, 30, 90)
DEFAULT_PERIOD = 30
SERIES = {
    'active_users': _('Aktive Nutzer'),
    'active_projects': _('Aktive Projekte'),
    'object_changes': _('Objektänderungen'),
    'registrations': _('Neue Registrierungen'),
    'new_projects': _('Neue Projekte'),
}
_CATEGORY_LABELS = {
    ProjectChangeDay.Category.PLANTING: _('Anbauplanungen'),
    ProjectChangeDay.Category.CROP: _('Kulturen und Sorten'),
    ProjectChangeDay.Category.GROWING_AREA: _('Anbauflächen'),
    ProjectChangeDay.Category.HARVEST: _('Ernteeinträge und Zuordnungen'),
    ProjectChangeDay.Category.SEED: _('Saatgutbestand'),
    ProjectChangeDay.Category.SEASON: _('Saisonen'),
    ProjectChangeDay.Category.TASK: _('Aufgaben'),
}
_ACTIONS = ('created', 'updated', 'deleted', 'restored')
_CHANGES = F('created') + F('updated') + F('deleted') + F('restored')


@dataclass(frozen=True)
class ActivityCategory:
    label: str
    projects: int
    created: int
    updated: int
    deleted: int
    restored: int


@dataclass(frozen=True)
class TrendPoint:
    start: date
    end: date
    count: int | None
    percent: int
    partial_coverage: bool


@dataclass(frozen=True)
class ActivityTrends:
    active_users: int | None
    active_projects: int | None
    object_changes: int | None
    registrations: int
    new_projects: int
    coverage_started_at: datetime | None
    partial_coverage: bool
    categories: list[ActivityCategory]
    trend: list[TrendPoint]


def _bucket_start(day: date, days: int) -> date:
    if days == 30:
        return day - timedelta(days=day.weekday())
    if days == 90:
        return day.replace(day=1)
    return day


def _next_bucket(day: date, days: int) -> date:
    if days == 90:
        return (day + timedelta(days=32)).replace(day=1)
    return day + timedelta(days=7 if days == 30 else 1)


def _bucket_counts(query: QuerySet, day: F | TruncDate, days: int, counter: Count | Sum) -> dict:
    if days == 30:
        day = TruncWeek(day)
    elif days == 90:
        day = TruncMonth(day)
    return dict(
        query.annotate(bucket=day).order_by().values('bucket')
        .annotate(total=counter).values_list('bucket', 'total')
    )


def _points(
    start: date,
    end: date,
    days: int,
    observed_from: date,
    counts: dict[date, int],
    *,
    partial_first_day: bool,
) -> list[TrendPoint]:
    points = []
    maximum = max(counts.values(), default=0) or 1
    bucket = _bucket_start(start, days)
    while bucket <= end:
        following = _next_bucket(bucket, days)
        first = max(start, bucket)
        last = min(end, following - timedelta(days=1))
        count = counts.get(bucket, 0) if last >= observed_from else None
        points.append(TrendPoint(
            start=first,
            end=last,
            count=count,
            percent=round(100 * (count or 0) / maximum),
            partial_coverage=(
                first <= observed_from <= last and (first < observed_from or partial_first_day)
            ),
        ))
        bucket = following
    return points


def _categories(changes: QuerySet) -> list[ActivityCategory]:
    rows = {
        row['category']: row
        for row in changes.order_by().values('category').annotate(
            projects=Count('project_id', distinct=True),
            **{f'{action}_total': Sum(action) for action in _ACTIONS},
        )
    }
    return [
        ActivityCategory(
            label=_CATEGORY_LABELS[category], projects=rows.get(category, {}).get('projects', 0),
            **{action: rows.get(category, {}).get(f'{action}_total', 0) for action in _ACTIONS},
        )
        for category in ProjectChangeDay.Category
    ]


def build_activity_trends(
    now: datetime,
    *,
    days: int,
    series: str,
    include_hidden: bool,
    excluded_project_ids: set[int],
) -> ActivityTrends:
    """Summarize the retained UTC window, treating pre-collection days as unknown."""
    end = now.astimezone(UTC).date()
    start = end - timedelta(days=days - 1)
    start_at = datetime.combine(start, time.min, tzinfo=UTC)
    coverage = migration_applied_at(MEASUREMENT_MIGRATION)
    measured = bool(coverage and coverage <= now)
    first_measured = coverage.astimezone(UTC).date() if measured else end + timedelta(days=1)
    changes = ProjectChangeDay.objects.filter(day__range=(max(first_measured, start), end))
    activity = ProjectActiveUserDay.objects.filter(day__range=(max(first_measured, start), end))
    changes = changes.exclude(project_id__in=excluded_project_ids)
    activity = activity.exclude(project_id__in=excluded_project_ids)
    registrations = usage_users(include_hidden=include_hidden).filter(
        date_joined__range=(start_at, now),
    )
    projects = Project.objects.filter(created_at__range=(start_at, now)).exclude(
        pk__in=excluded_project_ids,
    )
    sources = {
        'active_users': (activity, F('day'), Count('user_id', distinct=True)),
        'active_projects': (changes, F('day'), Count('project_id', distinct=True)),
        'object_changes': (changes, F('day'), Sum(_CHANGES)),
        'registrations': (registrations, TruncDate('date_joined', tzinfo=UTC), Count('pk')),
        'new_projects': (projects, TruncDate('created_at', tzinfo=UTC), Count('pk')),
    }
    query, day, counter = sources[series]
    existing_timestamp = series in {'registrations', 'new_projects'}
    counts = _bucket_counts(query, day, days, counter) if measured or existing_timestamp else {}
    totals = changes.aggregate(
        projects=Count('project_id', distinct=True), changes=Sum(_CHANGES, default=0),
    ) if measured else {}
    return ActivityTrends(
        active_users=activity.aggregate(users=Count('user_id', distinct=True))['users']
        if measured else None,
        active_projects=totals.get('projects'),
        object_changes=totals.get('changes'),
        registrations=registrations.count(),
        new_projects=projects.count(),
        coverage_started_at=coverage if measured else None,
        partial_coverage=bool(measured and coverage > start_at),
        categories=_categories(changes) if measured else [],
        trend=_points(
            start, end, days, start if existing_timestamp else first_measured, counts,
            partial_first_day=bool(
                not existing_timestamp and measured and coverage.astimezone(UTC).time() != time.min
            ),
        ),
    )
