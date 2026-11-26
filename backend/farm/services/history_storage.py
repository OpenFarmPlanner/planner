"""Aggregate project history storage for the superuser usage dashboard."""

from dataclasses import dataclass
from datetime import datetime, timedelta

from django.db import connection
from django.db.models import BigIntegerField, Count, Func, Min, Q, Sum

from farm.history.project_restore import CHECKPOINT_KEY
from farm.history.records import HISTORY_RETENTION_DAYS
from farm.models import EntityRevision


@dataclass(frozen=True)
class ProjectHistoryStorage:
    project_id: int
    entry_count: int
    checkpoint_count: int
    stored_bytes: int | None = None


@dataclass(frozen=True)
class HistoryStorage:
    database_bytes: int | None
    table_bytes: int | None
    entry_count: int
    checkpoint_count: int
    anchor_count: int
    oldest: datetime | None
    stored_bytes: int | None
    checkpoint_bytes: int | None
    projects: list[ProjectHistoryStorage]


def build_history_storage(now: datetime) -> HistoryStorage:
    """Read totals and the ten largest histories without fetching snapshot values."""
    revisions = EntityRevision.objects.order_by()
    checkpoint = Q(entity_type='project', snapshot__has_key=CHECKPOINT_KEY)
    cutoff = now - timedelta(days=HISTORY_RETENTION_DAYS)
    counts = {
        'entry_count': Count('pk'),
        'checkpoint_count': Count('pk', filter=checkpoint),
    }
    totals = {**counts, 'anchor_count': Count('pk', filter=Q(created_at__lt=cutoff)),
              'oldest': Min('created_at')}
    projects = revisions.values('project_id').annotate(**counts)
    database_bytes = table_bytes = None
    if connection.vendor == 'postgresql':
        snapshot_bytes = Func('snapshot', function='pg_column_size', output_field=BigIntegerField())
        totals.update(
            stored_bytes=Sum(snapshot_bytes, default=0),
            checkpoint_bytes=Sum(snapshot_bytes, filter=checkpoint, default=0),
        )
        projects = projects.annotate(stored_bytes=Sum(snapshot_bytes)).order_by(
            '-stored_bytes', 'project_id',
        )
        with connection.cursor() as cursor:
            cursor.execute(
                'SELECT pg_database_size(current_database()), pg_total_relation_size(%s::regclass)',
                [EntityRevision._meta.db_table],
            )
            database_bytes, table_bytes = cursor.fetchone()
    else:
        projects = projects.order_by('-entry_count', 'project_id')

    summary = {'stored_bytes': None, 'checkpoint_bytes': None}
    summary.update(revisions.aggregate(**totals))
    return HistoryStorage(
        database_bytes=database_bytes,
        table_bytes=table_bytes,
        projects=[ProjectHistoryStorage(**row) for row in projects[:10]],
        **summary,
    )
