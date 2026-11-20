"""Dated crop-loss incidents belonging to an existing planting plan."""

from django.db import models
from django.db.models.functions import Floor

from .base import TimestampedModel


class CropLossType(models.TextChoices):
    TOTAL = "total", "Total loss"
    PARTIAL = "partial", "Partial loss"


class CropLossCause(models.TextChoices):
    FROST = "frost", "Frost"
    DROUGHT = "drought", "Drought"
    WATERLOGGING = "waterlogging", "Waterlogging"
    PESTS = "pests", "Pests"
    DISEASE = "disease", "Disease"
    OTHER = "other", "Other"


class CropLossUnit(models.TextChoices):
    PERCENT = "percent", "Percentage"
    PLANTS = "plants", "Plants"
    SQUARE_METRES = "sqm", "Square metres"


class CropLoss(TimestampedModel):
    """One incident, with optional extent in the original unit."""

    project = models.ForeignKey("Project", on_delete=models.CASCADE, related_name="crop_losses")
    planting_plan = models.ForeignKey(
        "PlantingPlan",
        on_delete=models.CASCADE,
        related_name="crop_losses",
    )
    date = models.DateField()
    loss_type = models.CharField(max_length=7, choices=CropLossType.choices)
    cause = models.CharField(max_length=12, choices=CropLossCause.choices)
    extent_value = models.DecimalField(
        max_digits=12,
        decimal_places=3,
        null=True,
        blank=True,
        help_text="Percentage, number of plants, or square metres, as selected for this incident.",
    )
    extent_unit = models.CharField(max_length=7, choices=CropLossUnit.choices, blank=True)
    note = models.TextField(max_length=4000, blank=True)

    class Meta:
        ordering = ["-date", "-pk"]
        indexes = [
            models.Index(fields=["planting_plan", "-date", "-id"], name="loss_plan_date_idx"),
            models.Index(fields=["project", "-date", "-id"], name="loss_project_date_idx"),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(cause__in=CropLossCause.values),
                name="loss_valid_cause",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(
                        loss_type__in=CropLossType.values, extent_value__isnull=True, extent_unit=""
                    )
                    | (
                        models.Q(
                            loss_type=CropLossType.PARTIAL,
                            extent_value__isnull=False,
                            extent_value__gte=0,
                        )
                        & (
                            models.Q(extent_unit=CropLossUnit.PERCENT, extent_value__lte=100)
                            | models.Q(
                                extent_unit=CropLossUnit.PLANTS, extent_value=Floor("extent_value")
                            )
                            | models.Q(extent_unit=CropLossUnit.SQUARE_METRES)
                        )
                    )
                ),
                name="loss_valid_extent",
            ),
        ]
