from datetime import timedelta

from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from farm.models import MediaFile, NoteAttachment, Project, RetainedUpload


class Command(BaseCommand):
    help = 'Delete orphaned media files older than 30 days from storage and database.'

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(days=30)
        queryset = MediaFile.objects.filter(orphaned_at__isnull=False, orphaned_at__lt=cutoff)
        deleted = 0
        for media in queryset:
            if media.storage_path and default_storage.exists(media.storage_path):
                default_storage.delete(media.storage_path)
            media.delete()
            deleted += 1
        self.stdout.write(self.style.SUCCESS(f'Deleted {deleted} orphaned media files.'))
        retained = RetainedUpload.objects.filter(removed_at__lt=cutoff)
        removed = 0
        for pk, project_id in retained.values_list('pk', 'project_id').iterator():
            with transaction.atomic():
                # Restore writers acquire the project lock before row locks too.
                if project_id is not None:
                    list(Project.objects.select_for_update().filter(pk=project_id))
                upload = retained.select_for_update().filter(pk=pk).first()
                if upload is None:
                    continue
                path = upload.storage_path
                live = (
                    MediaFile.objects.filter(storage_path=path).exists()
                    or NoteAttachment.objects.filter(image=path).exists()
                )
                if not live and default_storage.exists(path):
                    default_storage.delete(path)
                upload.delete()
                removed += 1
        self.stdout.write(self.style.SUCCESS(f'Cleared {removed} retained upload records.'))
