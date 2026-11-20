"""Dated harvest quantities and their optional allocations to planting plans."""

from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models

from .base import TimestampedModel


class HarvestUnit(models.TextChoices):
    KILOGRAM = "kg", "Kilograms"
    GRAM = "g", "Grams"
    PIECE = "piece", "Pieces"
    BUNCH = "bunch", "Bunches"


class HarvestConversionSource(models.TextChoices):
    CROP = "crop", "Crop reference"
    LIBRARY = "library", "Library reference"
    MANUAL = "manual", "Manual entry"


MIN_HARVEST_QUANTITY = Decimal("0.001")


class HarvestRecord(TimestampedModel):
    """One dated quantity, independent of its planting-plan assignments."""

    project = models.ForeignKey("Project", on_delete=models.CASCADE, related_name="harvest_records")
    crop = models.ForeignKey("Crop", on_delete=models.CASCADE, related_name="harvest_records")
    date = models.DateField()
    quantity = models.DecimalField(
        max_digits=12,
        decimal_places=3,
        validators=[MinValueValidator(MIN_HARVEST_QUANTITY)],
    )
    unit = models.CharField(max_length=5, choices=HarvestUnit.choices)
    note = models.TextField(blank=True)
    grams_per_unit = models.DecimalField(
        max_digits=10,
        decimal_places=3,
        null=True,
        blank=True,
        validators=[MinValueValidator(MIN_HARVEST_QUANTITY)],
        help_text="Estimated grams per piece or bunch, saved when the harvest was recorded.",
    )
    conversion_source = models.CharField(
        max_length=7,
        choices=HarvestConversionSource.choices,
        blank=True,
    )

    class Meta:
        ordering = ["-date", "-pk"]
        indexes = [
            models.Index(fields=["project", "-date", "-id"], name="harvest_project_date_idx")
        ]
        constraints = [
            models.CheckConstraint(condition=models.Q(quantity__gt=0), name="harvest_positive_qty"),
            models.CheckConstraint(
                condition=(
                    models.Q(grams_per_unit__isnull=True, conversion_source="")
                    | models.Q(
                        grams_per_unit__isnull=False,
                        grams_per_unit__gt=0,
                        conversion_source__in=HarvestConversionSource.values,
                        unit__in=[HarvestUnit.PIECE, HarvestUnit.BUNCH],
                    )
                ),
                name="harvest_valid_conversion",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.date}: {self.crop} ({self.quantity} {self.unit})"


class HarvestAllocation(TimestampedModel):
    """A share of the recorded quantity, expressed in the record's unit."""

    project = models.ForeignKey(
        "Project", on_delete=models.CASCADE, related_name="harvest_allocations"
    )
    harvest = models.ForeignKey(HarvestRecord, on_delete=models.CASCADE, related_name="allocations")
    planting_plan = models.ForeignKey(
        "PlantingPlan",
        on_delete=models.CASCADE,
        related_name="harvest_allocations",
    )
    quantity = models.DecimalField(
        max_digits=12,
        decimal_places=3,
        validators=[MinValueValidator(MIN_HARVEST_QUANTITY)],
    )
    harvested_area_sqm = models.DecimalField(
        max_digits=10,
        decimal_places=3,
        null=True,
        blank=True,
        validators=[MinValueValidator(MIN_HARVEST_QUANTITY)],
        help_text="Square metres harvested for this allocation, when recorded.",
    )

    class Meta:
        ordering = ["pk"]
        constraints = [
            models.UniqueConstraint(fields=["harvest", "planting_plan"], name="harvest_plan_once"),
            models.CheckConstraint(
                condition=models.Q(quantity__gt=0), name="allocation_positive_qty"
            ),
            models.CheckConstraint(
                condition=models.Q(harvested_area_sqm__isnull=True)
                | models.Q(harvested_area_sqm__gt=0),
                name="allocation_positive_area",
            ),
        ]
