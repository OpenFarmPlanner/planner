from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from django.db import connection
from django.db.migrations.recorder import MigrationRecorder
from django.db.models import Count, F, Q, Sum
from django.utils import timezone

from farm.models import BatchOperation, CropLibraryUsageDay

MEASUREMENT_MIGRATION = '0164_crop_library_usage'
WINDOW_DAYS = 30


@dataclass(frozen=True)
class OperationTotal:
    operations: int
    projects: int


@dataclass(frozen=True)
class CropLibraryOperations:
    bulk_imports: OperationTotal
    linked_updates: OperationTotal
    import_undos: OperationTotal
    start_day: date
    coverage_started_at: datetime | None


def migration_applied_at(name: str) -> datetime | None:
    return (
        MigrationRecorder(connection).migration_qs.filter(app='farm', name=name)
        .values_list('applied', flat=True).first()
    )


def record_crop_library_outcome(
    project_id: int, kind: CropLibraryUsageDay.Kind, *, applied: bool = True,
) -> None:
    """Increment a daily counter inside the caller's operation transaction."""
    if not applied:
        return
    day = timezone.now().astimezone(UTC).date()
    row, created = CropLibraryUsageDay.objects.get_or_create(
        project_id=project_id, day=day, kind=kind,
    )
    if not created:
        CropLibraryUsageDay.objects.filter(pk=row.pk).update(count=F('count') + 1)


def build_crop_library_operations(
    now: datetime, *, excluded_project_ids: set[int],
) -> CropLibraryOperations:
    """Combine public batch receipts with counters for previously unrecorded outcomes."""
    end_day = now.astimezone(UTC).date()
    start_day = end_day - timedelta(days=WINDOW_DAYS - 1)
    since = datetime.combine(start_day, time.min, tzinfo=UTC)
    receipts = BatchOperation.objects.exclude(project_id__in=excluded_project_ids)
    batch_totals = dict(
        receipts.filter(
            operation_type=BatchOperation.TYPE_CROP_IMPORT,
            completed_at__range=(since, now),
            context__has_keys=['_request_fingerprint', '_import_changes'],
        )
        .exclude(context___import_changes={})
        .values('project_id').annotate(total=Count('pk')).order_by()
        .values_list('project_id', 'total'),
    )
    counters = CropLibraryUsageDay.objects.filter(day__range=(start_day, end_day)).exclude(
        project_id__in=excluded_project_ids,
    )
    selections = counters.filter(kind=CropLibraryUsageDay.Kind.SELECTION_IMPORT).values(
        'project_id',
    ).annotate(total=Sum('count')).values_list('project_id', 'total')
    for project_id, total in selections:
        batch_totals[project_id] = batch_totals.get(project_id, 0) + total
    updates = counters.filter(kind=CropLibraryUsageDay.Kind.LINKED_UPDATE).aggregate(
        operations=Sum('count', default=0), projects=Count('project_id', distinct=True),
    )
    undos = receipts.filter(
        Q(completed_at__range=(since, now))
        | Q(completed_at__isnull=True, created_at__range=(since, now)),
        operation_type=BatchOperation.TYPE_REVERTED,
        context___library_import=True,
    ).aggregate(operations=Count('pk'), projects=Count('project_id', distinct=True))
    return CropLibraryOperations(
        bulk_imports=OperationTotal(sum(batch_totals.values()), len(batch_totals)),
        linked_updates=OperationTotal(**updates),
        import_undos=OperationTotal(**undos),
        start_day=start_day,
        coverage_started_at=migration_applied_at(MEASUREMENT_MIGRATION),
    )
