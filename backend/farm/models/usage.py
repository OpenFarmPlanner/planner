from django.conf import settings
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


class ProjectChangeDay(models.Model):
    """Totals for audited changes by UTC day, project and object category."""

    class Category(models.TextChoices):
        PLANTING = 'planting', 'Planting plans'
        CROP = 'crop', 'Crops and varieties'
        GROWING_AREA = 'growing_area', 'Growing areas'
        HARVEST = 'harvest', 'Harvest records and allocations'
        SEED = 'seed', 'Seed inventory'
        SEASON = 'season', 'Seasons'
        TASK = 'task', 'Tasks'

    day = models.DateField()
    project = models.ForeignKey('farm.Project', on_delete=models.CASCADE, related_name='+')
    category = models.CharField(max_length=16, choices=Category.choices)
    created = models.PositiveIntegerField(default=0)
    updated = models.PositiveIntegerField(default=0)
    deleted = models.PositiveIntegerField(default=0)
    restored = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['day', 'project', 'category'], name='unique_project_change_day',
            ),
        ]


class ProjectActiveUserDay(models.Model):
    """One row per active user and project per UTC day for distinct counts."""

    day = models.DateField()
    project = models.ForeignKey('farm.Project', on_delete=models.CASCADE, related_name='+')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='+')

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['day', 'project', 'user'], name='unique_active_user_day',
            ),
        ]
