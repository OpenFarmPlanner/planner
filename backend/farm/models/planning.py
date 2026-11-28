"""Planning: planting plans and tasks."""

from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.db.models import Q
from django.db.models.functions import Coalesce

from .base import TimestampedModel
from .crops import Crop
from .projects import Project
from .seasons import Season
from .structure import Bed, Field, Location


class PlantingPlan(TimestampedModel):
    """A planting schedule for a bed area or individual plants in one growing area."""
    PLACEMENT_AREA = 'area'
    PLACEMENT_BED = 'individual_bed'
    PLACEMENT_PARCEL = 'individual_parcel'
    PLACEMENT_SITE = 'individual_site'
    PLACEMENT_MODES = (PLACEMENT_AREA, PLACEMENT_BED, PLACEMENT_PARCEL, PLACEMENT_SITE)
    ACTUAL_DATE_FIELDS = frozenset({
        'actual_propagation_start_date', 'actual_sowing_date', 'actual_transplanting_date',
        'actual_harvest_start_date', 'recorded_harvest_end_date',
    })
    # Plan-only cultivation type: planted out from bought-in young plants, so
    # there is no own propagation (Anzucht) and no seed demand. A crop never
    # lists it in its own `cultivation_types`; it is selectable whenever the
    # crop allows 'pre_cultivation' (transplanting).
    CULTIVATION_TYPE_PURCHASED_TRANSPLANT = 'purchased_transplant'
    CULTIVATION_TYPE_CHOICES = [
        *Crop.CULTIVATION_TYPE_CHOICES,
        # Pflanzung mit gekauften Pflanzen
        (CULTIVATION_TYPE_PURCHASED_TRANSPLANT, 'Transplant with bought-in plants'),
    ]

    crop = models.ForeignKey(
        Crop,
        on_delete=models.CASCADE,
        related_name='planting_plans',
        null=True,
        blank=True,
        help_text="Optional until the plan is fully filled in — a plan can be saved as a draft before a crop is chosen, as long as a bed is chosen instead.",
    )
    # RESTRICT: a used growing area is retired, never deleted together with
    # its plans; a whole-project deletion still cascades through (#1634).
    bed = models.ForeignKey(
        Bed,
        on_delete=models.RESTRICT,
        related_name='planting_plans',
        null=True,
        blank=True,
        help_text="Optional until the plan is fully filled in — a plan can be saved as a draft before a bed is chosen.",
    )
    parcel = models.ForeignKey(
        Field, on_delete=models.RESTRICT, related_name='individual_planting_plans',
        null=True, blank=True,
        help_text='Direct parcel assignment for individual plants.',
    )
    site = models.ForeignKey(
        Location, on_delete=models.RESTRICT, related_name='individual_planting_plans',
        null=True, blank=True,
        help_text='Direct location assignment for individual plants.',
    )
    individual_bed = models.BooleanField(default=False)
    individual_count = models.PositiveIntegerField(
        null=True, blank=True,
        help_text='Exact total including unpositioned plants. Null counts the stems.',
    )
    individual_positions = models.JSONField(
        default=list, blank=True,
        help_text='Stem IDs and coordinates in metres relative to the assigned growing area.',
    )
    estimated_canopy_diameter_m = models.DecimalField(
        max_digits=7, decimal_places=2, null=True, blank=True,
        validators=[MinValueValidator(Decimal('0.01'))],
        help_text='Optional estimated canopy diameter in metres for each plant in this plan.',
    )
    cultivation_type = models.CharField(
        max_length=30,
        choices=CULTIVATION_TYPE_CHOICES,
        blank=True,
        help_text=(
            "Cultivation type used for this plan: direct sowing, transplanting "
            "from own propagation, or transplanting bought-in young plants"
        ),
    )
    planting_date = models.DateField(
        null=True,
        blank=True,
        help_text="Optional until the plan is fully filled in — a plan can be saved as a draft before a date is chosen.",
    )
    # Extra planned activities can be independent of the bed-start date.
    planned_propagation_start_date = models.DateField(null=True, blank=True)
    planned_sowing_date = models.DateField(null=True, blank=True)
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
    clearing_date = models.DateField(
        null=True, blank=True,
        help_text='Last day the perennial planting occupies the bed.',
    )
    harvest_window_overrides = models.JSONField(
        default=dict, blank=True, editable=False,
        help_text='Absolute planned harvest ranges keyed by the recurring window start year.',
    )
    harvest_occurrence_actuals = models.JSONField(
        default=dict, blank=True, editable=False,
        help_text='Recorded harvest dates by occurrence year and any legacy date binding.',
    )
    harvest_date_is_explicit = models.BooleanField(default=False, editable=False)
    harvest_end_date_is_explicit = models.BooleanField(default=False, editable=False)
    actual_propagation_start_date = models.DateField(null=True, blank=True)
    actual_sowing_date = models.DateField(null=True, blank=True)
    actual_transplanting_date = models.DateField(null=True, blank=True)
    actual_harvest_start_date = models.DateField(null=True, blank=True)
    # The API already uses actual_harvest_end_date for a calculated succession boundary.
    recorded_harvest_end_date = models.DateField(null=True, blank=True)
    quantity = models.IntegerField(null=True, blank=True, help_text="Number of plants or seeds")
    area_usage_sqm = models.DecimalField(
        max_digits=10, 
        decimal_places=2, 
        null=True, 
        blank=True,
        help_text="Area in square meters used by this planting plan"
    )
    parcel_rotation_basis = models.JSONField(
        default=dict, blank=True, editable=False,
        help_text='Reference areas and last applied areas in square metres for parcel rotation.',
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
    copied_from_plan_id = models.PositiveBigIntegerField(
        null=True, blank=True, editable=False,
        help_text='Source plan identity, retained while the original is deleted or unavailable.',
    )

    # Changing any of these moves the plan in the crop rotation, so a
    # previously accepted rotation conflict no longer describes it.
    ROTATION_RELEVANT_FIELDS = (
        'crop_id', 'bed_id', 'planting_date', 'harvest_date', 'harvest_end_date', 'clearing_date',
    )

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

    def planned_harvest_dates(
        self, general_crop_index: dict[int, Crop] | None = None,
    ) -> tuple[date | None, date | None]:
        """Return planned harvest dates, including independent dates set by a copy."""
        start, end = self.calculate_effective_harvest_dates(general_crop_index)
        if start is not None or self.harvest_date_is_explicit:
            start = self.harvest_date or start
        if end is not None or self.harvest_end_date_is_explicit:
            end = self.harvest_end_date or end
        return start, end

    def suggested_clearing_date(
        self, general_crop_index: dict[int, Crop] | None = None,
    ) -> date | None:
        """A planting anniversary, clamped to the last day of February if needed."""
        from farm.services.seasons import add_months

        if self.planting_date is None:
            return None
        years = self._effective_crop_days('standing_time_years', general_crop_index)
        if not years or self.planting_date.year + years > date.max.year:
            return None
        return add_months(self.planting_date, years * 12)

    @staticmethod
    def occupancy_end_expression() -> Coalesce:
        """The inclusive last day of a plan's occupancy for queryset filtering."""
        return Coalesce('clearing_date', 'harvest_end_date', 'harvest_date', 'planting_date')

    @staticmethod
    def assigned_growing_area() -> Q:
        return Q(bed__isnull=False) | Q(parcel__isnull=False) | Q(site__isnull=False)

    @property
    def growing_area_assigned(self) -> bool:
        return self.bed_id is not None or self.parcel_id is not None or self.site_id is not None

    @staticmethod
    def individual_placements() -> Q:
        return Q(individual_bed=True) | Q(parcel__isnull=False) | Q(site__isnull=False)

    @property
    def is_individual(self) -> bool:
        return self.individual_bed or self.parcel_id is not None or self.site_id is not None

    @property
    def placement_mode(self) -> str:
        if self.individual_bed:
            return self.PLACEMENT_BED
        if self.site_id is not None:
            return self.PLACEMENT_SITE
        return self.PLACEMENT_PARCEL if self.parcel_id is not None else self.PLACEMENT_AREA

    @property
    def placement_parent(self) -> Bed | Field | Location | None:
        return self.bed if self.individual_bed else self.parcel or self.site

    @property
    def individual_total(self) -> int:
        if self.individual_count is not None:
            return self.individual_count
        return len(self.individual_positions)

    @property
    def growing_area_parcel(self) -> Field | None:
        if self.parcel_id is not None:
            return self.parcel
        return self.bed.field if self.bed_id is not None else None

    @property
    def growing_area_location(self) -> Location | None:
        if self.site_id is not None:
            return self.site
        parcel = self.growing_area_parcel
        return parcel.location if parcel else None

    @property
    def occupancy_end_date(self) -> date | None:
        return (
            self.clearing_date or self.harvest_end_date or self.harvest_date or self.planting_date
        )

    def _get_active_period(self) -> tuple[date, date] | None:
        """Return inclusive active period used for overlap validations."""
        if self.planting_date is None:
            return None

        active_start = self.planting_date
        active_end = self.clearing_date or self.harvest_end_date

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
        update_fields = set(kwargs.get('update_fields') or ())
        execution_fields = self.ACTUAL_DATE_FIELDS | {'harvest_occurrence_actuals'}
        if update_fields & execution_fields and (
            update_fields <= execution_fields | {'updated_by', 'updated_at'}
        ):
            super().save(*args, **kwargs)
            return

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
        start, end = self.calculate_effective_harvest_dates()
        if not self.harvest_date_is_explicit:
            self.harvest_date = start
        if not self.harvest_end_date_is_explicit:
            self.harvest_end_date = end

    def __str__(self) -> str:
        """Return a string combining crop, bed, and planting date."""
        crop_label = self.crop.name if self.crop else '–'
        area = self.bed or self.parcel or self.site
        area_label = area.name if area else '–'
        date_label = self.planting_date or '–'
        return f"{crop_label} in {area_label} - {date_label}"

    class Meta:
        ordering = ['-planting_date']
        constraints = [
            models.CheckConstraint(
                condition=Q(parcel__isnull=True) | Q(
                    bed__isnull=True, crop__isnull=False, area_usage_sqm__isnull=True,
                    quantity__isnull=True,
                ),
                name='individual_plant_plan_has_crop_without_bed_area_or_quantity',
            ),
            models.CheckConstraint(
                condition=Q(individual_bed=False) | Q(
                    bed__isnull=False, parcel__isnull=True, crop__isnull=False,
                    area_usage_sqm__isnull=True, quantity__isnull=True,
                ),
                name='individual_bed_plan_has_parent_crop_without_area_or_quantity',
            ),
            models.CheckConstraint(
                condition=Q(site__isnull=True) | Q(
                    bed__isnull=True, parcel__isnull=True, individual_bed=False, crop__isnull=False,
                    area_usage_sqm__isnull=True, quantity__isnull=True,
                ),
                name='individual_site_plan_has_one_parent_and_crop',
            ),
            models.CheckConstraint(
                condition=Q(individual_count__isnull=True) | Q(individual_count__gte=0) & (
                    Q(individual_bed=True) | Q(parcel__isnull=False) | Q(site__isnull=False)
                ),
                name='exact_plant_count_requires_individual_plan',
            ),
        ]
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
        on_delete=models.SET_NULL,
        related_name='tasks',
        null=True,
        blank=True,
    )
    due_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='tasks')

    season = models.ForeignKey(
        Season, on_delete=models.CASCADE, related_name='tasks', null=True, blank=True,
    )
    crop = models.ForeignKey(
        Crop, on_delete=models.SET_NULL, related_name='tasks', null=True, blank=True,
    )
    field = models.ForeignKey(
        Field, on_delete=models.SET_NULL, related_name='tasks', null=True, blank=True,
    )
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        related_name='assigned_tasks', null=True, blank=True,
    )
    origin = models.CharField(
        max_length=20, default='manual',
        choices=[('manual', 'Manual'), ('automatic', 'Automatic'), ('template', 'Template')],
    )
    template = models.ForeignKey(
        'CropTaskTemplate', on_delete=models.SET_NULL, related_name='tasks', null=True, blank=True,
    )
    deleted_at = models.DateTimeField(null=True, blank=True)
    calculated_due_date = models.DateField(null=True, blank=True)
    due_date_overridden = models.BooleanField(default=False)
    # Stable generator identity: the source identifies an event/template and the
    # occurrence index identifies a repetition, independently of its date.
    source_key = models.CharField(max_length=200, blank=True, default='')
    occurrence_index = models.PositiveIntegerField(default=0)
    suppressed_by_harvest_configuration = models.BooleanField(default=False, editable=False)

    def __str__(self) -> str:
        """Return a string combining task title and status."""
        return f"{self.title} ({self.status})"

    class Meta:
        ordering = ['due_date', '-created_at', 'id']
        indexes = [models.Index(fields=['project', 'season', 'status', 'due_date'])]
        constraints = [
            models.UniqueConstraint(
                fields=['project', 'source_key', 'occurrence_index'],
                condition=~models.Q(source_key=''), name='unique_task_source_occurrence',
            ),
        ]


class CropTaskTemplate(TimestampedModel):
    """A project crop's independently saved task rule."""

    EVENT_CHOICES = [
        ('propagation_start', 'Propagation start'), ('sowing', 'Direct sowing'),
        ('planting', 'Transplanting'), ('harvest_start', 'Harvest start'),
        ('harvest_end', 'Harvest end'),
    ]
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='task_templates')
    crop = models.ForeignKey(Crop, on_delete=models.CASCADE, related_name='task_templates')
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    reference_event = models.CharField(max_length=30, choices=EVENT_CHOICES)
    day_offset = models.IntegerField(default=0, help_text='Calendar days relative to the event.')
    repeat_interval_days = models.PositiveIntegerField(null=True, blank=True)
    repeat_until = models.CharField(max_length=20, blank=True, default='', choices=[
        ('count', 'Occurrence count'), ('harvest_start', 'Harvest start'),
        ('harvest_end', 'Harvest end'),
    ])
    repeat_count = models.PositiveIntegerField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['title', 'id']
        constraints = [
            models.CheckConstraint(
                condition=models.Q(repeat_interval_days__isnull=True)
                | models.Q(repeat_interval_days__gte=1, repeat_interval_days__lte=3650),
                name='task_template_repeat_interval_range',
            ),
            models.CheckConstraint(
                condition=models.Q(repeat_count__isnull=True)
                | models.Q(repeat_count__gte=1, repeat_count__lte=1000),
                name='task_template_repeat_count_range',
            ),
        ]

    def __str__(self) -> str:
        return self.title
