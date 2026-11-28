"""Season-effective physical geometry of locations, parcels and beds (#916, #1634).

A version describes what is known about one growing-area identity from its
``effective_from`` date until the next version of the same identity. The
Location/Field/Bed rows keep their present measurements as a compatibility
mirror; this table is the dated timeline. Schematic layout coordinates are
presentation data and never live here. See docs/growing-area-geometry-history.md.
"""

from django.db import models
from django.db.models import Q

from .base import TimestampedModel
from .projects import Project
from .seasons import Season
from .structure import Bed, Field, Location


class GrowingAreaGeometryVersion(TimestampedModel):
    """One dated, sparse physical-geometry record of a growing-area identity."""

    STATE_ACTIVE = 'active'
    STATE_RETIRED = 'retired'
    STATE_CHOICES = [
        (STATE_ACTIVE, 'Active'),
        (STATE_RETIRED, 'Retired'),
    ]

    BASIS_DIMENSIONS = 'dimensions'
    BASIS_DECLARED_AREA = 'declared_area'
    BASIS_UNKNOWN = 'unknown'
    BASIS_CHOICES = [
        (BASIS_DIMENSIONS, 'Measured length and width'),
        (BASIS_DECLARED_AREA, 'Declared area'),
        (BASIS_UNKNOWN, 'Unknown'),
    ]

    ORIGIN_LEGACY_OBSERVATION = 'legacy_observation'
    ORIGIN_NEW_AREA = 'new_area'
    ORIGIN_PHYSICAL_CHANGE = 'physical_change'
    ORIGIN_RETIREMENT = 'retirement'
    ORIGIN_CHOICES = [
        (ORIGIN_LEGACY_OBSERVATION, 'Legacy observation'),
        (ORIGIN_NEW_AREA, 'New area'),
        (ORIGIN_PHYSICAL_CHANGE, 'Physical change'),
        (ORIGIN_RETIREMENT, 'Retirement'),
    ]

    project = models.ForeignKey(
        Project, on_delete=models.CASCADE, related_name='growing_area_geometry_versions',
    )
    # Exactly one owning identity. A hard deletion is only permitted for an
    # unused identity, which then takes its setup record with it.
    location = models.ForeignKey(
        Location, null=True, blank=True, on_delete=models.CASCADE,
        related_name='geometry_versions',
    )
    field = models.ForeignKey(
        Field, null=True, blank=True, on_delete=models.CASCADE,
        related_name='geometry_versions',
    )
    bed = models.ForeignKey(
        Bed, null=True, blank=True, on_delete=models.CASCADE,
        related_name='geometry_versions',
    )
    # The parent at this interval: a location for parcel versions and a parcel
    # for bed versions. RESTRICT keeps an older parent from being deleted
    # while a moved child's history still refers to it, but lets a cascade
    # remove a parent together with its own children.
    parent_location = models.ForeignKey(
        Location, null=True, blank=True, on_delete=models.RESTRICT,
        related_name='geometry_child_versions',
    )
    parent_field = models.ForeignKey(
        Field, null=True, blank=True, on_delete=models.RESTRICT,
        related_name='geometry_child_versions',
    )
    effective_from = models.DateField(
        help_text='First day this version applies; it ends the day before the next version.',
    )
    state = models.CharField(max_length=10, choices=STATE_CHOICES, default=STATE_ACTIVE)
    length_m = models.FloatField(null=True, blank=True, help_text='Recorded length in metres.')
    width_m = models.FloatField(null=True, blank=True, help_text='Recorded width in metres.')
    confirmed_area_sqm = models.DecimalField(
        max_digits=14, decimal_places=2, null=True, blank=True,
        help_text='Recorded area in square metres; null when unknown.',
    )
    measurement_basis = models.CharField(
        max_length=20, choices=BASIS_CHOICES, default=BASIS_UNKNOWN,
    )
    origin = models.CharField(max_length=24, choices=ORIGIN_CHOICES)
    original_season = models.ForeignKey(
        Season, null=True, blank=True, on_delete=models.SET_NULL, related_name='+',
        help_text='Season the user chose; explains the decision, never the chronology key.',
    )
    revision = models.PositiveIntegerField(
        default=1, help_text='Incremented by every correction; a stale preview names an older one.',
    )

    class Meta:
        ordering = ['effective_from', 'pk']
        constraints = [
            models.CheckConstraint(
                condition=(
                    Q(location__isnull=False, field__isnull=True, bed__isnull=True)
                    | Q(location__isnull=True, field__isnull=False, bed__isnull=True)
                    | Q(location__isnull=True, field__isnull=True, bed__isnull=False)
                ),
                name='geometry_version_one_owner',
            ),
            models.CheckConstraint(
                condition=(
                    Q(
                        location__isnull=False,
                        parent_location__isnull=True, parent_field__isnull=True,
                    )
                    | Q(field__isnull=False, parent_field__isnull=True)
                    | Q(bed__isnull=False, parent_location__isnull=True)
                ),
                name='geometry_version_parent_kind',
            ),
            models.CheckConstraint(
                condition=(
                    (Q(length_m__isnull=True) | Q(length_m__gt=0))
                    & (Q(width_m__isnull=True) | Q(width_m__gt=0))
                    & (Q(confirmed_area_sqm__isnull=True) | Q(confirmed_area_sqm__gt=0))
                ),
                name='geometry_version_positive_measurements',
            ),
            models.UniqueConstraint(
                fields=['location', 'effective_from'], condition=Q(location__isnull=False),
                name='unique_location_geometry_effective_from',
            ),
            models.UniqueConstraint(
                fields=['field', 'effective_from'], condition=Q(field__isnull=False),
                name='unique_field_geometry_effective_from',
            ),
            models.UniqueConstraint(
                fields=['bed', 'effective_from'], condition=Q(bed__isnull=False),
                name='unique_bed_geometry_effective_from',
            ),
        ]
        indexes = [
            models.Index(
                fields=['project', 'effective_from'], name='farm_geometry_project_date_idx',
            ),
        ]

    @property
    def kind(self) -> str:
        """Return ``location``, ``field`` or ``bed`` for the owning identity."""
        if self.bed_id is not None:
            return 'bed'
        if self.field_id is not None:
            return 'field'
        return 'location'

    @property
    def owner_id(self) -> int:
        """Return the owning identity's primary key."""
        return self.bed_id or self.field_id or self.location_id

    @property
    def parent_id(self) -> int | None:
        """Return the parent identity recorded for this interval."""
        return self.parent_field_id or self.parent_location_id

    def __str__(self) -> str:
        """Return a compact description for admin and debug output."""
        return f'{self.kind} {self.owner_id} from {self.effective_from} ({self.origin})'
