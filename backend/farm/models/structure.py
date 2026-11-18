"""Farm structure: locations, fields, beds, and their graphical layouts."""

from decimal import Decimal
from typing import Any

from django.core.exceptions import ValidationError
from django.db import models

from .base import TimestampedModel
from .projects import Project

SOIL_TYPE_CHOICES = [
    ('sand', 'Sand'),
    ('loam', 'Loam'),
    ('clay', 'Clay'),
]
LIGHT_CONDITION_CHOICES = [
    ('sunny', 'Sunny'),
    ('partial_shade', 'Partial shade'),
    ('shade', 'Shade'),
]
SOIL_MOISTURE_CHOICES = [
    ('dry', 'Dry'),
    ('normal', 'Normal'),
    ('moist', 'Moist'),
]
IRRIGATION_CHOICES = [
    ('available', 'Available'),
    ('unavailable', 'Unavailable'),
]
CULTIVATION_ENVIRONMENT_CHOICES = [
    ('open_field', 'Open field'),
    ('polytunnel', 'Polytunnel'),
    ('greenhouse', 'Greenhouse'),
]


class SiteConditionsMixin(models.Model):
    """Optional site conditions shared by locations, fields and beds (#1075).

    The structured values (light, soil moisture, irrigation and, on fields
    and beds, soil type) are inherited location -> field -> bed: an empty
    value means "not specified here", and the effective value is the nearest
    explicitly set one (see ``farm/services/site_conditions.py``). The
    descriptive texts belong to the entity they were entered on and are never
    inherited.
    """

    light_condition = models.CharField(
        max_length=20, choices=LIGHT_CONDITION_CHOICES, null=True, blank=True,
        help_text='Typical light; empty means not specified here (inherited).',
    )
    soil_moisture = models.CharField(
        max_length=20, choices=SOIL_MOISTURE_CHOICES, null=True, blank=True,
        help_text='Typical soil moisture, not irrigation; empty means inherited.',
    )
    irrigation = models.CharField(
        max_length=20, choices=IRRIGATION_CHOICES, null=True, blank=True,
        help_text=(
            'Whether irrigation is available (not whether it is used); empty means inherited.'
        ),
    )
    soil_description = models.TextField(
        blank=True, help_text='Observed soil peculiarities, e.g. stony or compacted ground.',
    )
    wind_exposure = models.TextField(blank=True, help_text='Wind protection or exposure.')
    water_supply = models.TextField(blank=True, help_text='Water supply details.')

    class Meta:
        abstract = True


class Location(SiteConditionsMixin, TimestampedModel):
    """A physical farm location that can contain multiple fields."""
    SOIL_TYPE_SAND = 'sand'
    SOIL_TYPE_LOAM = 'loam'
    SOIL_TYPE_CLAY = 'clay'
    SOIL_TYPE_CHOICES = SOIL_TYPE_CHOICES

    EXPOSURE_NORTH = 'north'
    EXPOSURE_SOUTH = 'south'
    EXPOSURE_EAST = 'east'
    EXPOSURE_WEST = 'west'
    EXPOSURE_FLAT = 'flat'
    EXPOSURE_CHOICES = [
        (EXPOSURE_NORTH, 'North'),
        (EXPOSURE_SOUTH, 'South'),
        (EXPOSURE_EAST, 'East'),
        (EXPOSURE_WEST, 'West'),
        (EXPOSURE_FLAT, 'Flat'),
    ]

    name = models.CharField(max_length=200)
    address = models.TextField(blank=True)
    description = models.TextField(blank=True)
    soil_type = models.CharField(max_length=20, choices=SOIL_TYPE_CHOICES, null=True, blank=True)
    exposure = models.CharField(max_length=20, choices=EXPOSURE_CHOICES, null=True, blank=True)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)
    # Optional outer dimensions in metres (#1190): a schematic rectangle for
    # the graphical view, including paths and free space, not a survey.
    length_m = models.FloatField(
        null=True, blank=True, help_text='Outer length of the location in metres (gross).',
    )
    width_m = models.FloatField(
        null=True, blank=True, help_text='Outer width of the location in metres (gross).',
    )
    notes = models.TextField(blank=True)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='locations')

    def clean(self) -> None:
        """Validate optional geographic coordinates."""
        super().clean()
        if self.latitude is not None and not (-90 <= self.latitude <= 90):
            raise ValidationError({'latitude': 'Latitude must be between -90 and 90.'})
        if self.longitude is not None and not (-180 <= self.longitude <= 180):
            raise ValidationError({'longitude': 'Longitude must be between -180 and 180.'})

    def __str__(self) -> str:
        """Return the location name."""
        return self.name

    @property
    def area_sqm(self) -> float | None:
        """Gross area in m² (length × width), or None while either is unknown."""
        if self.length_m is None or self.width_m is None:
            return None
        return round(self.length_m * self.width_m, 2)

    class Meta:
        ordering = ['name']


class Field(SiteConditionsMixin, TimestampedModel):
    """A field within a location that can contain multiple beds."""
    # Validation constants.
    MIN_AREA_SQM = Decimal('0.01')  # Minimum 0.01 sqm (10cm x 10cm)
    MAX_AREA_SQM = Decimal('1000000.00')  # Maximum 100 hectares (safe value within
    # DecimalField constraints)
    
    name = models.CharField(max_length=200)
    location = models.ForeignKey(Location, on_delete=models.CASCADE, related_name='fields')
    area_sqm = models.DecimalField(max_digits=10, decimal_places=1, null=True, blank=True)
    length_m = models.FloatField(null=True, blank=True)
    width_m = models.FloatField(null=True, blank=True)
    notes = models.TextField(blank=True)
    soil_type = models.CharField(
        max_length=20, choices=SOIL_TYPE_CHOICES, null=True, blank=True,
        help_text='Overrides the location soil type; empty means inherited.',
    )
    cultivation_environment = models.CharField(
        max_length=20, choices=CULTIVATION_ENVIRONMENT_CHOICES, null=True, blank=True,
        help_text='Recorded only; no climate adjustment is derived from it.',
    )
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='fields')

    def clean(self) -> None:
        """Validate area and optional field dimensions."""
        super().clean()
        if self.area_sqm is not None:
            if self.area_sqm < self.MIN_AREA_SQM:
                raise ValidationError({
                    'area_sqm': f'Area must be at least {self.MIN_AREA_SQM} sqm.'
                })
            if self.area_sqm > self.MAX_AREA_SQM:
                raise ValidationError({
                    'area_sqm': f'Area must not exceed {self.MAX_AREA_SQM} sqm (100 hectares).'
                })

        if self.length_m is not None and self.length_m < 0:
            raise ValidationError({'length_m': 'Length must be greater than or equal to 0.'})
        if self.width_m is not None and self.width_m < 0:
            raise ValidationError({'width_m': 'Width must be greater than or equal to 0.'})

    def save(self, *args: Any, **kwargs: Any) -> None:
        """Persist field and derive area from dimensions when both values are set."""
        if self.length_m is not None and self.width_m is not None:
            computed_area = Decimal(str(self.length_m * self.width_m)).quantize(Decimal('0.1'))
            self.area_sqm = computed_area
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        """Return a string combining location and field name."""
        return f"{self.location.name} - {self.name}"

    class Meta:
        ordering = ['location', 'name']
        verbose_name = 'Parzelle'
        verbose_name_plural = 'Parzellen'
        constraints = [
            models.UniqueConstraint(
                fields=['location', 'name'],
                name='unique_field_name_per_location',
            ),
        ]


class Bed(SiteConditionsMixin, TimestampedModel):
    """A bed within a field that stores optional area in square meters."""
    # Validation constants.
    MIN_AREA_SQM = Decimal('0.01')  # Minimum 0.01 sqm (10cm x 10cm)
    MAX_AREA_SQM = Decimal('10000.00')  # Maximum 10,000 sqm (~1 hectare, reasonable for a bed)
    
    name = models.CharField(max_length=200)
    field = models.ForeignKey(Field, on_delete=models.CASCADE, related_name='beds', verbose_name='Parzelle')
    area_sqm = models.DecimalField(max_digits=10, decimal_places=1, null=True, blank=True)
    length_m = models.FloatField(null=True, blank=True)
    width_m = models.FloatField(null=True, blank=True)
    notes = models.TextField(blank=True)
    soil_type = models.CharField(
        max_length=20, choices=SOIL_TYPE_CHOICES, null=True, blank=True,
        help_text='Overrides the field/location soil type; empty means inherited.',
    )
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='beds')

    def clean(self) -> None:
        """Validate area and optional bed dimensions."""
        super().clean()
        if self.area_sqm is not None:
            if self.area_sqm < self.MIN_AREA_SQM:
                raise ValidationError({'area_sqm': f'Area must be at least {self.MIN_AREA_SQM} sqm.'})
            if self.area_sqm > self.MAX_AREA_SQM:
                raise ValidationError({'area_sqm': f'Area must not exceed {self.MAX_AREA_SQM} sqm (1 hectare).'})

        if self.length_m is not None and self.length_m < 0:
            raise ValidationError({'length_m': 'Length must be greater than or equal to 0.'})
        if self.width_m is not None and self.width_m < 0:
            raise ValidationError({'width_m': 'Width must be greater than or equal to 0.'})

    def save(self, *args: Any, **kwargs: Any) -> None:
        """Persist bed and derive area from dimensions when both values are set."""
        if self.length_m is not None and self.width_m is not None:
            computed_area = Decimal(str(self.length_m * self.width_m)).quantize(Decimal('0.1'))
            self.area_sqm = computed_area
        super().save(*args, **kwargs)

    def get_total_area(self) -> float | None:
        """Return the bed area in square meters, or None if not set."""
        if self.area_sqm:
            return float(self.area_sqm)
        return None

    def __str__(self) -> str:
        """Return a string combining field and bed name."""
        return f"{self.field.name} - {self.name}"

    class Meta:
        ordering = ['field', 'name']
        constraints = [
            models.UniqueConstraint(
                fields=['field', 'name'],
                name='unique_bed_name_per_field',
            ),
        ]


class BedLayout(TimestampedModel):
    """Persisted bed layout coordinates for the graphical field view."""

    bed = models.OneToOneField(Bed, on_delete=models.CASCADE, related_name='layout')
    location = models.ForeignKey(Location, on_delete=models.CASCADE, related_name='bed_layouts')
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='bed_layouts')
    x = models.FloatField(default=0.0)
    y = models.FloatField(default=0.0)
    version = models.PositiveIntegerField(default=1)
    scale = models.FloatField(null=True, blank=True)

    def clean(self) -> None:
        """Validate that location matches the bed's location."""
        super().clean()
        if self.bed_id and self.location_id and self.bed.field.location_id != self.location_id:
            raise ValidationError({'location': 'Layout location must match the bed location.'})

    def __str__(self) -> str:
        """Return a compact textual representation."""
        return f"BedLayout bed={self.bed_id} location={self.location_id}"

    class Meta:
        ordering = ['location', 'bed']


class FieldLayout(TimestampedModel):
    """Persisted field layout coordinates for the graphical field view."""

    field = models.OneToOneField(Field, on_delete=models.CASCADE, related_name='layout')
    location = models.ForeignKey(Location, on_delete=models.CASCADE, related_name='field_layouts')
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='field_layouts')
    x = models.FloatField(default=0.0)
    y = models.FloatField(default=0.0)
    version = models.PositiveIntegerField(default=1)
    scale = models.FloatField(null=True, blank=True)

    def clean(self) -> None:
        """Validate that location matches the field's location."""
        super().clean()
        if self.field_id and self.location_id and self.field.location_id != self.location_id:
            raise ValidationError({'location': 'Layout location must match the field location.'})

    def __str__(self) -> str:
        """Return a compact textual representation."""
        return f"FieldLayout field={self.field_id} location={self.location_id}"

    class Meta:
        ordering = ['location', 'field']
