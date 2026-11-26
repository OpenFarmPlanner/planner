from datetime import UTC, timedelta

from django.core.management.base import BaseCommand
from django.db.models import F, Window
from django.db.models.functions import RowNumber
from django.utils import timezone

from farm.history.project_restore import CHECKPOINT_KEY
from farm.history.records import HISTORY_RETENTION_DAYS
from farm.models import (
    BatchOperation,
    CountedActionOperation,
    CropLibraryUsageDay,
    CropRevision,
    EntityRevision,
    ProjectActionDay,
    ProjectActiveUserDay,
    ProjectChangeDay,
    ProjectRevision,
)
from farm.services.crop_library_usage import WINDOW_DAYS
from farm.services.usage_capture import ACTIVITY_RETENTION_DAYS


class Command(BaseCommand):
    help = (
        "Delete history entries older than 30 days, retaining the latest pre-cutoff "
        "revision per entity and latest complete project checkpoint as restore anchors. "
        "CropRevision/ProjectRevision are legacy "
        "tables with a flat cutoff, draining until empty."
    )

    def handle(self, *args, **options):
        now = timezone.now()
        cutoff = now - timedelta(days=HISTORY_RETENTION_DAYS)

        older = EntityRevision.objects.filter(created_at__lt=cutoff)
        latest_ids = (
            older.annotate(
                position=Window(
                    expression=RowNumber(),
                    partition_by=["project_id", "entity_type", "object_id"],
                    order_by=[F("created_at").desc(), F("id").desc()],
                )
            )
            .filter(position=1)
            .values_list("id", flat=True)
        )
        checkpoint_ids = (
            older.filter(
                entity_type="project",
                snapshot__has_key=CHECKPOINT_KEY,
            )
            .annotate(
                position=Window(
                    expression=RowNumber(),
                    partition_by=["project_id"],
                    order_by=[F("created_at").desc(), F("id").desc()],
                )
            )
            .filter(position=1)
            .values_list("id", flat=True)
        )
        deleted_entity, _ = (
            EntityRevision.objects.filter(created_at__lt=cutoff)
            .exclude(id__in=set(latest_ids) | set(checkpoint_ids))
            .delete()
        )

        deleted_crop, _ = CropRevision.objects.filter(created_at__lt=cutoff).delete()
        deleted_project, _ = ProjectRevision.objects.filter(created_at__lt=cutoff).delete()

        # Drop batch operations whose revisions have all been pruned (or NULLed
        # via SET_NULL) — an empty group carries no history value.
        deleted_batches, _ = BatchOperation.objects.filter(
            created_at__lt=cutoff, revisions__isnull=True
        ).delete()

        first_usage_day = now.astimezone(UTC).date() - timedelta(days=WINDOW_DAYS - 1)
        CropLibraryUsageDay.objects.filter(day__lt=first_usage_day).delete()
        first_activity_day = now.astimezone(UTC).date() - timedelta(
            days=ACTIVITY_RETENTION_DAYS - 1,
        )
        ProjectActiveUserDay.objects.filter(day__lt=first_activity_day).delete()
        ProjectChangeDay.objects.filter(day__lt=first_activity_day).delete()
        ProjectActionDay.objects.filter(day__lt=first_activity_day).delete()
        CountedActionOperation.objects.filter(day__lt=first_activity_day).delete()

        self.stdout.write(
            self.style.SUCCESS(
                f"Deleted {deleted_entity} entity, {deleted_crop} legacy crop, "
                f"{deleted_project} legacy project historical records and "
                f"{deleted_batches} empty batch operations."
            )
        )
