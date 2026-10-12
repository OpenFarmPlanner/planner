"""Planning: planting plans and tasks."""

from datetime import date, timedelta
from typing import Any

from django.conf import settings
from django.db import models

from .base import TimestampedModel
from .crops import Crop
from .projects import Project
from .seasons import Season
from .structure import Bed


class PlantingPlan(TimestampedModel):
    """A planting schedule linking a crop to a bed with dates."""
    CULTIVATION_TYPE_CHOICES = Crop.CULTIVATION_TYPE_CHOICES

    crop = models.ForeignKey(
        Crop,
        on_delete=models.CASCADE,
        related_name='planting_plans',
        null=True,
        blank=True,
        help_text="Optional until the plan is fully filled in — a plan can be saved as a draft before a crop is chosen, as long as a bed is chosen instead.",
    )
    bed = models.ForeignKey(
        Bed,
        on_delete=models.CASCADE,
        related_name='planting_plans',
        null=True,
        blank=True,
        help_text="Optional until the plan is fully filled in — a plan can be saved as a draft before a bed is chosen.",
    )
    cultivation_type = models.CharField(
        max_length=30,
        choices=CULTIVATION_TYPE_CHOICES,
        blank=True,
        help_text="Cultivation type used for this plan",
    )
    planting_date = models.DateField(
        null=True,
        blank=True,
        help_text="Optional until the plan is fully filled in — a plan can be saved as a draft before a date is chosen.",
    )
    harvest_date = models.DateField(
        blank=True,
        null=True,
        help_text="Harvest start date (Erntebeginn)",
    )
    harvest_end_date = models.DateField(
        blank=True,
        null=True,
        help_text="Harvest end date (Ernteende)",
    )
    quantity = models.IntegerField(null=True, blank=True, help_text="Number of plants or seeds")
    area_usage_sqm = models.DecimalField(
        max_digits=10, 
        decimal_places=2, 
        null=True, 
        blank=True,
        help_text="Area in square meters used by this planting plan"
    )
    notes = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='created_planting_plans',
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='updated_planting_plans',
    )
    rotation_conflict_accepted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='accepted_rotation_conflict_planting_plans',
        help_text='User who consciously accepted a crop rotation conflict for this plan.',
    )
    rotation_conflict_accepted_at = models.DateTimeField(
        null=True,
        blank=True,
        help_text=(
            'When a crop rotation conflict was consciously accepted. Cleared automatically '
            'when the crop, bed or dates change, so the plan is checked again.'
        ),
    )
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='planting_plans')
    season = models.ForeignKey(
        Season,
        on_delete=models.CASCADE,
        related_name='planting_plans',
        null=True,
        blank=True,
        help_text="Season this planting plan is scheduled in. Nullable only until a project's first season setup runs.",
    )

    # Changing any of these moves the plan in the crop rotation, so a
    # previously accepted rotation conflict no longer describes it.
    ROTATION_RELEVANT_FIELDS = ('crop_id', 'bed_id', 'planting_date', 'harvest_date', 'harvest_end_date')

    @property
    def rotation_conflict_accepted(self) -> bool:
        """Whether a crop rotation conflict was consciously accepted for this plan."""
        return self.rotation_conflict_accepted_at is not None

    def _effective_crop_days(
        self,
        field: str,
        general_crop_index: dict[int, Crop] | None = None,
    ) -> int | None:
        """A crop timing value, resolved through the Sorte -> Kultur fallback.

        Imported here rather than at module level: the resolver lives in the
        services layer and imports `farm.models`, so a top-level import would
        close the cycle.
        """
        from farm.services.crop_inheritance import resolve_crop_field

        return resolve_crop_field(self.crop, field, general_crop_index)

    def calculate_effective_harvest_dates(
        self,
        general_crop_index: dict[int, Crop] | None = None,
    ) -> tuple[date | None, date | None]:
        """Return harvest dates from planting date and effective crop timing."""
        if not self.planting_date or not self.crop:
            return None, None

        growth_duration_days = self._effective_crop_days(
            'growth_duration_days',
            general_crop_index,
        )
        if growth_duration_days is None:
            return None, None

        harvest_date = self.planting_date + timedelta(days=growth_duration_days)
        harvest_duration_days = self._effective_crop_days(
            'harvest_duration_days',
            general_crop_index,
        )
        if harvest_duration_days is None:
            return harvest_date, None

        return harvest_date, harvest_date + timedelta(days=harvest_duration_days)

    def _get_active_period(self) -> tuple[date, date] | None:
        """Return inclusive active period used for overlap validations."""
        if self.planting_date is None:
            return None

        active_start = self.planting_date
        active_end = self.harvest_end_date

        if active_end is None and self.crop_id:
            _, active_end = self.calculate_effective_harvest_dates()

        if active_end is None:
            return None

        return active_start, active_end

    def clean(self) -> None:
        """Run default model validation."""
        super().clean()


    def save(self, *args: Any, **kwargs: Any) -> None:
        """Save the plan and auto-calculate harvest dates if needed."""
        # Detect if planting_date or crop has changed.
        should_recalculate = False
        prev: PlantingPlan | None = None

        if self.pk:
            # Existing instance - check if planting_date or crop changed.
            try:
                prev = PlantingPlan.objects.get(pk=self.pk)
                if prev.planting_date != self.planting_date or prev.crop_id != self.crop_id:
                    should_recalculate = True
            except PlantingPlan.DoesNotExist:
                # Should not happen, but treat as new instance.
                should_recalculate = True
        else:
            # New instance - always calculate.
            should_recalculate = True

        if should_recalculate and self.planting_date and self.crop:
            self.recalculate_harvest_dates()

        if prev is not None:
            self._reset_rotation_acceptance_if_moved(prev, kwargs)

        super().save(*args, **kwargs)

    def _reset_rotation_acceptance_if_moved(self, prev: 'PlantingPlan', save_kwargs: dict[str, Any]) -> None:
        """Drop a stored rotation-conflict acceptance once the plan moved.

        An acceptance granted in this very save (a new timestamp) is kept, so
        a user can change the bed and accept the resulting conflict at once.
        """
        if prev.rotation_conflict_accepted_at is None:
            return
        if self.rotation_conflict_accepted_at != prev.rotation_conflict_accepted_at:
            return
        moved = any(
            getattr(prev, field) != getattr(self, field)
            for field in self.ROTATION_RELEVANT_FIELDS
        )
        if not moved:
            return
        self.rotation_conflict_accepted_at = None
        self.rotation_conflict_accepted_by = None
        update_fields = save_kwargs.get('update_fields')
        if update_fields is not None:
            save_kwargs['update_fields'] = set(update_fields) | {
                'rotation_conflict_accepted_at',
                'rotation_conflict_accepted_by',
            }

    def recalculate_harvest_dates(self) -> None:
        """Calculate stored harvest dates from the crop's effective timing.

        "Effective" means a Sorte without its own duration uses the one from its
        general Kultur (see farm/services/crop_inheritance.py). The dates
        stay a snapshot taken at save time: already-stored plans are not
        recalculated just because a value became resolvable.
        """
        self.harvest_date, self.harvest_end_date = self.calculate_effective_harvest_dates()

    def __str__(self) -> str:
        """Return a string combining crop, bed, and planting date."""
        crop_label = self.crop.name if self.crop else '–'
        bed_label = self.bed.name if self.bed else '–'
        date_label = self.planting_date or '–'
        return f"{crop_label} in {bed_label} - {date_label}"

    class Meta:
        ordering = ['-planting_date']
        indexes = [
            models.Index(fields=['project', '-planting_date']),
            models.Index(fields=['project', 'bed', 'planting_date', 'harvest_end_date']),
            models.Index(fields=['project', 'crop']),
            models.Index(fields=['project', 'season']),
        ]


class Task(TimestampedModel):
    """A farm management task optionally linked to a planting plan."""
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('in_progress', 'In Progress'),
        ('completed', 'Completed'),
        ('cancelled', 'Cancelled'),
    ]

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    planting_plan = models.ForeignKey(
        PlantingPlan,
        on_delete=models.CASCADE,
        related_name='tasks',
        null=True,
        blank=True,
    )
    due_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='tasks')

    def __str__(self) -> str:
        """Return a string combining task title and status."""
        return f"{self.title} ({self.status})"

    class Meta:
        ordering = ['due_date', '-created_at']
