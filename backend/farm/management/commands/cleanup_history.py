from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import F, Window
from django.db.models.functions import RowNumber
from django.utils import timezone

from farm.models import BatchOperation, CropRevision, EntityRevision, ProjectRevision


class Command(BaseCommand):
    help = (
        "Delete history entries older than 30 days, retaining the latest pre-cutoff "
        "revision per entity and latest complete project checkpoint as restore anchors. "
        "CropRevision/ProjectRevision are legacy "
        "tables with a flat cutoff, draining until empty."
    )

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(days=30)

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
                snapshot__has_key="project_state_v1",
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

        self.stdout.write(
            self.style.SUCCESS(
                f"Deleted {deleted_entity} entity, {deleted_crop} legacy crop, "
                f"{deleted_project} legacy project historical records and "
                f"{deleted_batches} empty batch operations."
            )
        )
