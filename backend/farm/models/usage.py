from django.db import models


class CropLibraryUsageDay(models.Model):
    """Daily project totals for library outcomes that have no operation receipt."""

    class Kind(models.TextChoices):
        SELECTION_IMPORT = 'selection_import'
        LINKED_UPDATE = 'linked_update'

    project = models.ForeignKey('farm.Project', on_delete=models.CASCADE, related_name='+')
    day = models.DateField(db_index=True)
    kind = models.CharField(max_length=16, choices=Kind.choices)
    count = models.PositiveIntegerField(default=1)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['project', 'day', 'kind'], name='crop_library_usage_day',
            ),
        ]
