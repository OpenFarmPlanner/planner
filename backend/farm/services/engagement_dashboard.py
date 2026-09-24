"""Aggregated, privacy-minimal project engagement metrics for the admin.

Every value here is derived from existing `created_at`/`updated_at` timestamps
and existing relations on farm data. The dashboard never reads or stores
per-user behavioral data (clicks, views, sessions, navigation); adding such
tracking needs a separate privacy review first, see the README section
"Aggregated Usage Insight and Privacy".
"""

from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

from django.contrib.auth import get_user_model
from django.db.models import Count, F, Max, Min, Model, Q
from django.utils import timezone

from farm.models import (
    Bed,
    BedLayout,
    Crop,
    CropSupplierData,
    Feedback,
    Field,
    FieldLayout,
    Location,
    NoteAttachment,
    PlantingPlan,
    Project,
    ProjectMembership,
    PublicCrop,
    PublicCropDiscussionComment,
    PublicCropRevision,
    Season,
    SeasonPattern,
    SeedPackage,
    Supplier,
    Task,
)
from farm.services.demo_project import DEMO_PROJECT_DESCRIPTIONS

ENGAGEMENT_MODELS = (
    Supplier,
    Crop,
    CropSupplierData,
    SeedPackage,
    Location,
    Field,
    Bed,
    BedLayout,
    FieldLayout,
    PlantingPlan,
    Task,
    NoteAttachment,
)

STATUS_ACTIVE = 'Aktiv'
STATUS_QUIET = 'Ruhig'
STATUS_INACTIVE = 'Inaktiv'
STATUS_REGISTERED_ONLY = 'Nur registriert'

# A project counts as activated once it owns its first real planning object.
ACTIVATION_MODELS = (Location, PlantingPlan)


def _model_key(model: type[Model]) -> str:
    """Return the stable lowercase key a model's aggregates are stored under."""
    return model._meta.model_name or model.__name__.lower()


@dataclass(frozen=True)
class Share:
    """A count together with the population it is a share of."""

    count: int
    total: int

    @property
    def percent(self) -> float:
        """Return the share in percent, rounded to one decimal."""
        if self.total == 0:
            return 0.0
        return round(100 * self.count / self.total, 1)


@dataclass
class ProjectEngagement:
    """Aggregated engagement values for one project."""

    project: Project
    last_active: datetime | None = None
    created_last_7_days: int = 0
    created_last_30_days: int = 0
    active_users_last_30_days: int = 0
    member_count: int = 0
    feedback_count: int = 0
    object_counts: dict[str, int] = field(default_factory=dict)
    first_created: dict[str, datetime] = field(default_factory=dict)

    def count_of(self, model: type[Model]) -> int:
        """Return how many rows of `model` this project owns."""
        return self.object_counts.get(_model_key(model), 0)

    @property
    def location_count(self) -> int:
        return self.count_of(Location)

    @property
    def field_count(self) -> int:
        return self.count_of(Field)

    @property
    def bed_count(self) -> int:
        return self.count_of(Bed)

    @property
    def crop_count(self) -> int:
        return self.count_of(Crop)

    @property
    def planting_plan_count(self) -> int:
        return self.count_of(PlantingPlan)

    @property
    def image_count(self) -> int:
        return self.count_of(NoteAttachment)

    @property
    def data_total(self) -> int:
        """Return the combined object count the data-richness ranking sorts by."""
        return (
            self.location_count
            + self.field_count
            + self.bed_count
            + self.crop_count
            + self.planting_plan_count
            + self.image_count
        )

    @property
    def activated_at(self) -> datetime | None:
        """Return when this project first created a location or planting plan."""
        timestamps = [
            self.first_created[_model_key(model)]
            for model in ACTIVATION_MODELS
            if _model_key(model) in self.first_created
        ]
        return min(timestamps) if timestamps else None

    @property
    def days_to_activation(self) -> int | None:
        """Return the days between project creation and its first planning object."""
        activated_at = self.activated_at
        if activated_at is None:
            return None
        return max((activated_at - self.project.created_at).days, 0)

    @property
    def status(self) -> str:
        """Return the German activity label for this project."""
        if self.last_active is None:
            return STATUS_REGISTERED_ONLY
        now = timezone.now()
        if self.last_active >= now - timedelta(days=7):
            return STATUS_ACTIVE
        if self.last_active >= now - timedelta(days=30):
            return STATUS_QUIET
        return STATUS_INACTIVE


# Sort keys the "Projekte" usage table can be ordered by, keyed by the same
# name the admin view accepts in its `?o=` query parameter. Each key returns a
# `(is_missing, value)` tuple so rows without a value (e.g. `last_active` of
# `None`) sort consistently without comparing `None` to a real value.
PROJECT_SORT_FIELDS: dict[str, Callable[['ProjectEngagement'], Any]] = {
    'name': lambda row: (False, row.project.name.casefold()),
    'last_active': lambda row: (row.last_active is None, row.last_active or datetime.min),
    'created_last_7_days': lambda row: (False, row.created_last_7_days),
    'created_last_30_days': lambda row: (False, row.created_last_30_days),
    'member_count': lambda row: (False, row.member_count),
    'active_users_last_30_days': lambda row: (False, row.active_users_last_30_days),
    'status': lambda row: (False, row.status),
}


def sort_project_rows(
    rows: list[ProjectEngagement],
    sort_key: str,
    *,
    descending: bool,
) -> list[ProjectEngagement]:
    """Sort project rows by one of `PROJECT_SORT_FIELDS`; unknown keys leave `rows` unchanged."""
    key_func = PROJECT_SORT_FIELDS.get(sort_key)
    if key_func is None:
        return rows
    return sorted(rows, key=key_func, reverse=descending)


@dataclass(frozen=True)
class AverageProjectCounts:
    """Mean per-project object counts across a set of projects."""

    locations: float = 0.0
    fields: float = 0.0
    beds: float = 0.0
    crops: float = 0.0
    planting_plans: float = 0.0
    images: float = 0.0
    members: float = 0.0
    data_total: float = 0.0


@dataclass(frozen=True)
class FeatureAdoption:
    """Share of projects that use a given feature at least once."""

    multiple_locations: Share
    planting_plan_photos: Share
    seed_packages: Share
    suppliers: Share
    tasks: Share
    feedback: Share


@dataclass(frozen=True)
class MonthlyGrowth:
    """New projects in one calendar month and how many of them got started."""

    month: date
    new_projects: int
    activated_projects: int
    average_days_to_activation: float | None

    @property
    def activation(self) -> Share:
        """Return the share of that month's projects that reached activation."""
        return Share(count=self.activated_projects, total=self.new_projects)


@dataclass(frozen=True)
class SeasonUsage:
    """How projects use the season feature."""

    average_seasons_per_project: float
    projects_with_pattern: Share


@dataclass(frozen=True)
class LayoutUsage:
    """How projects use the graphical bed and field layouts."""

    projects_with_bed_layout: Share
    projects_with_field_layout: Share
    projects_with_any_layout: Share


@dataclass(frozen=True)
class TaskUsage:
    """Aggregate task counts across all projects."""

    created: int
    completed: int

    @property
    def completion(self) -> Share:
        """Return the completed share of all created tasks."""
        return Share(count=self.completed, total=self.created)


@dataclass(frozen=True)
class PublicCropContribution:
    """Published public-library entries contributed by one project."""

    project_name: str | None
    published_count: int


@dataclass(frozen=True)
class CropLibraryEngagement:
    """Engagement with the shared public crop library."""

    contributions: list[PublicCropContribution]
    published_entries: int
    imported_crops: int
    self_entered_crops: int
    crops_with_pending_update: int
    discussion_comments: int
    revisions: int


@dataclass(frozen=True)
class EngagementDashboard:
    """Complete dashboard result and its overall totals."""

    projects: list[ProjectEngagement]
    projects_by_data: list[ProjectEngagement]
    active_projects: list[ProjectEngagement]
    active_project_averages: AverageProjectCounts
    total_projects: int
    active_projects_7_days: int
    active_projects_30_days: int
    total_users: int
    users_logged_in_30_days: int
    adoption: FeatureAdoption
    monthly_growth: list[MonthlyGrowth]
    season_usage: SeasonUsage
    layout_usage: LayoutUsage
    average_distinct_crops_per_project: float
    task_usage: TaskUsage
    projects_from_template: Share
    crop_library: CropLibraryEngagement


def _collect_project_rows(
    cutoff_7_days: datetime,
    cutoff_30_days: datetime,
) -> dict[int, ProjectEngagement]:
    """Aggregate every engagement model into one row per project."""
    rows = {
        project.pk: ProjectEngagement(project=project)
        for project in Project.objects.all()
    }

    for model in ENGAGEMENT_MODELS:
        key = _model_key(model)
        aggregates = model.objects.values('project_id').annotate(
            total=Count('pk'),
            earliest_created=Min('created_at'),
            latest_created=Max('created_at'),
            latest_updated=Max('updated_at'),
            created_7_days=Count('pk', filter=Q(created_at__gte=cutoff_7_days)),
            created_30_days=Count('pk', filter=Q(created_at__gte=cutoff_30_days)),
        )
        for aggregate in aggregates:
            row = rows.get(aggregate['project_id'])
            if row is None:
                continue
            timestamps = [
                value
                for value in (aggregate['latest_created'], aggregate['latest_updated'])
                if value is not None
            ]
            if timestamps:
                latest = max(timestamps)
                if row.last_active is None or latest > row.last_active:
                    row.last_active = latest
            if aggregate['earliest_created'] is not None:
                row.first_created[key] = aggregate['earliest_created']
            row.object_counts[key] = aggregate['total']
            row.created_last_7_days += aggregate['created_7_days']
            row.created_last_30_days += aggregate['created_30_days']

    return rows


def _add_membership_and_feedback(
    rows: dict[int, ProjectEngagement],
    cutoff_30_days: datetime,
) -> None:
    """Fill in member counts, recently active members, and feedback counts."""
    memberships = ProjectMembership.objects.values('project_id').annotate(
        member_count=Count('user_id', distinct=True),
        active_count=Count(
            'user_id',
            distinct=True,
            filter=Q(user__last_login__gte=cutoff_30_days),
        ),
    )
    for membership in memberships:
        row = rows.get(membership['project_id'])
        if row is not None:
            row.member_count = membership['member_count']
            row.active_users_last_30_days = membership['active_count']

    feedback_counts = Feedback.objects.filter(project__isnull=False).values(
        'project_id',
    ).annotate(total=Count('pk'))
    for entry in feedback_counts:
        row = rows.get(entry['project_id'])
        if row is not None:
            row.feedback_count = entry['total']


def _average_counts(projects: list[ProjectEngagement]) -> AverageProjectCounts:
    """Return the mean per-project object counts over `projects`."""
    if not projects:
        return AverageProjectCounts()
    size = len(projects)

    def mean(values: list[int]) -> float:
        return round(sum(values) / size, 1)

    return AverageProjectCounts(
        locations=mean([row.location_count for row in projects]),
        fields=mean([row.field_count for row in projects]),
        beds=mean([row.bed_count for row in projects]),
        crops=mean([row.crop_count for row in projects]),
        planting_plans=mean([row.planting_plan_count for row in projects]),
        images=mean([row.image_count for row in projects]),
        members=mean([row.member_count for row in projects]),
        data_total=mean([row.data_total for row in projects]),
    )


def _build_adoption(projects: list[ProjectEngagement]) -> FeatureAdoption:
    """Derive feature adoption shares from the already aggregated counts."""
    total = len(projects)

    def share(predicate) -> Share:
        return Share(count=sum(1 for row in projects if predicate(row)), total=total)

    return FeatureAdoption(
        multiple_locations=share(lambda row: row.location_count > 1),
        planting_plan_photos=share(lambda row: row.image_count > 0),
        seed_packages=share(lambda row: row.count_of(SeedPackage) > 0),
        suppliers=share(lambda row: row.count_of(Supplier) > 0),
        tasks=share(lambda row: row.count_of(Task) > 0),
        feedback=share(lambda row: row.feedback_count > 0),
    )


def _build_monthly_growth(projects: list[ProjectEngagement]) -> list[MonthlyGrowth]:
    """Group projects by creation month and measure how many got activated."""
    per_month: dict[date, list[ProjectEngagement]] = defaultdict(list)
    for row in projects:
        created = timezone.localtime(row.project.created_at)
        per_month[date(created.year, created.month, 1)].append(row)

    growth: list[MonthlyGrowth] = []
    for month in sorted(per_month, reverse=True):
        month_rows = per_month[month]
        durations = [
            row.days_to_activation
            for row in month_rows
            if row.days_to_activation is not None
        ]
        growth.append(
            MonthlyGrowth(
                month=month,
                new_projects=len(month_rows),
                activated_projects=len(durations),
                average_days_to_activation=(
                    round(sum(durations) / len(durations), 1) if durations else None
                ),
            ),
        )
    return growth


def _build_layout_usage(projects: list[ProjectEngagement]) -> LayoutUsage:
    """Derive bed/field layout adoption from the already aggregated counts."""
    total = len(projects)
    with_bed = [row for row in projects if row.count_of(BedLayout) > 0]
    with_field = [row for row in projects if row.count_of(FieldLayout) > 0]
    with_any = [
        row
        for row in projects
        if row.count_of(BedLayout) > 0 or row.count_of(FieldLayout) > 0
    ]
    return LayoutUsage(
        projects_with_bed_layout=Share(count=len(with_bed), total=total),
        projects_with_field_layout=Share(count=len(with_field), total=total),
        projects_with_any_layout=Share(count=len(with_any), total=total),
    )


def _build_season_usage(total_projects: int) -> SeasonUsage:
    """Measure how many seasons projects keep and how many define a pattern."""
    season_count = Season.objects.count()
    pattern_count = SeasonPattern.objects.count()
    return SeasonUsage(
        average_seasons_per_project=(
            round(season_count / total_projects, 1) if total_projects else 0.0
        ),
        projects_with_pattern=Share(count=pattern_count, total=total_projects),
    )


def _average_distinct_crops(total_projects: int) -> float:
    """Return the mean number of distinct crop names per project."""
    if total_projects == 0:
        return 0.0
    per_project = Crop.objects.values('project_id').annotate(
        distinct_names=Count('name', distinct=True),
    )
    distinct_total = sum(entry['distinct_names'] for entry in per_project)
    return round(distinct_total / total_projects, 1)


def _build_task_usage() -> TaskUsage:
    """Return created and completed task totals across all projects."""
    totals = Task.objects.aggregate(
        created=Count('pk'),
        completed=Count('pk', filter=Q(status='completed')),
    )
    return TaskUsage(created=totals['created'], completed=totals['completed'])


def _build_crop_library(rows: dict[int, ProjectEngagement]) -> CropLibraryEngagement:
    """Measure contribution to and consumption of the public crop library."""
    published = PublicCrop.objects.filter(
        status=PublicCrop.STATUS_PUBLISHED,
    ).values('source_project_id').annotate(total=Count('pk')).order_by('-total')
    contributions: list[PublicCropContribution] = []
    for entry in published:
        contributor = rows.get(entry['source_project_id'])
        contributions.append(
            PublicCropContribution(
                project_name=contributor.project.name if contributor else None,
                published_count=entry['total'],
            ),
        )

    crop_origins = Crop.objects.aggregate(
        imported=Count('pk', filter=Q(derived_from_public_crop__isnull=False)),
        self_entered=Count('pk', filter=Q(derived_from_public_crop__isnull=True)),
    )
    # Version-level approximation of `has_pending_public_crop_update`: the
    # per-field comparison that helper runs cannot be expressed in SQL, so this
    # can include a bump that changed nothing the copy cares about.
    pending_updates = Crop.objects.filter(
        source_public_crop__status=PublicCrop.STATUS_PUBLISHED,
    ).filter(
        Q(source_public_version__isnull=True)
        | ~Q(source_public_version=F('source_public_crop__version')),
    ).count()

    return CropLibraryEngagement(
        contributions=contributions,
        published_entries=sum(entry.published_count for entry in contributions),
        imported_crops=crop_origins['imported'],
        self_entered_crops=crop_origins['self_entered'],
        crops_with_pending_update=pending_updates,
        discussion_comments=PublicCropDiscussionComment.objects.filter(
            deleted_at__isnull=True,
        ).count(),
        revisions=PublicCropRevision.objects.count(),
    )


def build_engagement_dashboard(now: datetime | None = None) -> EngagementDashboard:
    """Build the dashboard with a fixed number of aggregate queries, never per project."""
    current_time = now or timezone.now()
    cutoff_7_days = current_time - timedelta(days=7)
    cutoff_30_days = current_time - timedelta(days=30)

    rows = _collect_project_rows(cutoff_7_days, cutoff_30_days)
    _add_membership_and_feedback(rows, cutoff_30_days)

    projects = sorted(
        rows.values(),
        key=lambda row: row.last_active or datetime.min.replace(tzinfo=current_time.tzinfo),
        reverse=True,
    )
    total_projects = len(projects)
    active_projects = [row for row in projects if row.status == STATUS_ACTIVE]
    user_model = get_user_model()
    template_projects = Project.objects.filter(
        description__in=DEMO_PROJECT_DESCRIPTIONS,
    ).count()

    return EngagementDashboard(
        projects=projects,
        projects_by_data=sorted(projects, key=lambda row: row.data_total, reverse=True),
        active_projects=active_projects,
        active_project_averages=_average_counts(active_projects),
        total_projects=total_projects,
        active_projects_7_days=sum(
            row.last_active is not None and row.last_active >= cutoff_7_days for row in projects
        ),
        active_projects_30_days=sum(
            row.last_active is not None and row.last_active >= cutoff_30_days for row in projects
        ),
        total_users=user_model.objects.count(),
        users_logged_in_30_days=user_model.objects.filter(last_login__gte=cutoff_30_days).count(),
        adoption=_build_adoption(projects),
        monthly_growth=_build_monthly_growth(projects),
        season_usage=_build_season_usage(total_projects),
        layout_usage=_build_layout_usage(projects),
        average_distinct_crops_per_project=_average_distinct_crops(total_projects),
        task_usage=_build_task_usage(),
        projects_from_template=Share(count=template_projects, total=total_projects),
        crop_library=_build_crop_library(rows),
    )
