"""Crops, suppliers, supplier data, public library, and seed packages."""

import json
import re
from decimal import Decimal
from typing import Any
from urllib.parse import urlparse

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.serializers.json import DjangoJSONEncoder
from django.db import models
from django.db.models import Q
from django.utils import timezone

from farm.seed_units import (
    SEED_PACKAGE_UNIT_GRAMS,
    SEED_PACKAGE_UNIT_SEEDS,
    SEED_RATE_UNIT_G_PER_LFM,
    SEED_RATE_UNIT_G_PER_M2,
    SEED_RATE_UNIT_SEEDS_PER_LFM,
    SEED_RATE_UNIT_SEEDS_PER_M2,
    SEED_RATE_UNIT_SEEDS_PER_PLANT,
    SEED_RATE_UNITS,
)

from .base import TimestampedModel
from .history import EntityRevision
from .projects import Project


class Supplier(TimestampedModel):
    """A seed supplier or manufacturer."""

    name = models.CharField(max_length=200, help_text="Supplier name")
    homepage_url = models.URLField(blank=True, help_text="Supplier homepage URL")
    slug = models.SlugField(max_length=200, unique=True, blank=True)
    allowed_domains = models.JSONField(default=list, blank=True)
    name_normalized = models.CharField(
        max_length=200,
        editable=False,
        help_text="Normalized name for deduplication"
    )
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='suppliers')

    @staticmethod
    def _normalize_domain(hostname: str) -> str:
        """Normalize one domain value and strip common URL parts."""
        raw = (hostname or '').strip().lower()
        if not raw:
            return ''
        if '://' in raw:
            raw = urlparse(raw).hostname or ''
        raw = raw.split('/')[0].split(':')[0].strip().lower().rstrip('.')
        if raw.startswith('www.'):
            raw = raw[4:]
        return raw

    @classmethod
    def normalize_allowed_domains(cls, domains: list[str] | tuple[str, ...] | None) -> list[str]:
        """Normalize user-provided allowed domains and deduplicate while preserving order."""
        normalized: list[str] = []
        for domain in (domains or []):
            item = cls._normalize_domain(str(domain))
            if item and item not in normalized:
                normalized.append(item)
            if item and f'www.{item}' not in normalized:
                normalized.append(f'www.{item}')
        return normalized

    @staticmethod
    def _is_valid_domain(domain: str) -> bool:
        """Return True if the string looks like a bare hostname."""
        if not domain or len(domain) > 253:
            return False
        if '/' in domain or ':' in domain or ' ' in domain:
            return False
        return bool(re.fullmatch(r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', domain))

    def _derive_slug_base(self) -> str:
        try:
            host = self._normalize_domain(urlparse(self.homepage_url).hostname or '')
        except Exception:  # noqa: BLE001
            host = ''
        if host:
            return host.split('.')[0]

        from django.utils.text import slugify
        return slugify(self.name) or 'supplier'

    def _assign_unique_slug(self) -> None:
        from django.utils.text import slugify

        if self.slug:
            base_slug = slugify(self.slug)
        else:
            base_slug = slugify(self._derive_slug_base())
        base_slug = base_slug or 'supplier'

        candidate = base_slug
        suffix = 2
        qs = Supplier.objects.exclude(pk=self.pk)
        while qs.filter(slug=candidate).exists():
            candidate = f"{base_slug}-{suffix}"
            suffix += 1
        self.slug = candidate

    def _derive_default_allowed_domains(self) -> list[str]:
        """Build default allowed domains from homepage host and explicit www variant."""
        try:
            hostname = urlparse(self.homepage_url).hostname or ''
        except Exception:  # noqa: BLE001
            hostname = ''
        normalized = self._normalize_domain(hostname)
        if not normalized:
            return []
        return [normalized, f'www.{normalized}']

    def clean(self) -> None:
        """Validate and normalize mutable supplier fields."""
        super().clean()
        domains = self.normalize_allowed_domains(self.allowed_domains if isinstance(self.allowed_domains, list) else [])
        if not domains:
            domains = self._derive_default_allowed_domains()
        invalid = [domain for domain in domains if not self._is_valid_domain(self._normalize_domain(domain))]
        if invalid:
            raise ValidationError({'allowed_domains': 'Domains müssen gültige Hostnamen ohne Schema oder Pfad sein.'})
        self.allowed_domains = domains

    def save(self, *args: Any, **kwargs: Any) -> None:
        """Save supplier and auto-generate normalized helper fields."""
        from farm.utils import normalize_supplier_name

        if self.name:
            self.name = ' '.join(self.name.split())
        self.name_normalized = normalize_supplier_name(self.name) or ''
        self.allowed_domains = self.normalize_allowed_domains(self.allowed_domains if isinstance(self.allowed_domains, list) else [])
        if not self.allowed_domains:
            self.allowed_domains = self._derive_default_allowed_domains()
        if not self.slug:
            self._assign_unique_slug()

        super().save(*args, **kwargs)

    def __str__(self) -> str:
        """Return the supplier name."""
        return self.name

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(fields=['project', 'name_normalized'], name='unique_supplier_name_per_project'),
        ]


def format_crop_display_name(name: str | None, variety: str | None) -> str | None:
    """Build a "name (variety)" label, falling back to whichever part is set."""
    normalized_name = (name or '').strip()
    normalized_variety = (variety or '').strip()
    if normalized_name and normalized_variety:
        return f'{normalized_name} ({normalized_variety})'
    if normalized_name:
        return normalized_name
    if normalized_variety:
        return normalized_variety
    return None


def compute_plants_per_m2(
    row_spacing_m: float | None,
    distance_within_row_m: float | None,
) -> Decimal | None:
    """Plants per square meter for a spacing pair given in meters.

    Formula: 10000 cm² per m² / (row_spacing_cm * plant_spacing_cm). Returns
    None when either spacing is missing or not positive. Shared by
    `Crop.plants_per_m2` and the inheritance resolver, which feeds it the
    effective spacing of a Sorte rather than its own.
    """
    row_spacing_cm = row_spacing_m * 100 if row_spacing_m else None
    plant_spacing_cm = distance_within_row_m * 100 if distance_within_row_m else None

    if not row_spacing_cm or not plant_spacing_cm:
        return None
    if row_spacing_cm <= 0 or plant_spacing_cm <= 0:
        return None

    return Decimal("10000") / (Decimal(str(row_spacing_cm)) * Decimal(str(plant_spacing_cm)))


def is_supplier_domain(url: str, supplier: Supplier | None) -> bool:
    """Return True when URL host matches supplier allowed domains."""
    if not supplier or not url:
        return False
    try:
        host = Supplier._normalize_domain(urlparse(url).hostname or '')
    except Exception:  # noqa: BLE001
        return False
    if not host:
        return False
    domains = [Supplier._normalize_domain(domain) for domain in (supplier.allowed_domains or []) if domain]
    return any(host == domain or host.endswith(f'.{domain}') for domain in domains)


class ActiveCropManager(models.Manager):
    """Default manager that hides soft-deleted crops."""

    def get_queryset(self):
        return super().get_queryset().filter(deleted_at__isnull=True)


class Crop(TimestampedModel):
    """A crop or plant type with growth, harvest, and planning metadata."""
    ORIGIN_MANUAL = 'manual'
    ORIGIN_IMPORTED = 'imported'
    ORIGIN_TYPE_CHOICES = [
        (ORIGIN_MANUAL, 'Manual'),
        (ORIGIN_IMPORTED, 'Imported'),
    ]
    NUTRIENT_DEMAND_CHOICES = [
        ('low', 'Low'),
        ('medium', 'Medium'),
        ('high', 'High'),
    ]
    
    CULTIVATION_TYPE_CHOICES = [
        ('pre_cultivation', 'Pre-cultivation'),  # Anzucht
        ('direct_sowing', 'Direct Sowing'),  # Direktsaat
    ]
    CULTIVATION_TYPE_VALUES = {item[0] for item in CULTIVATION_TYPE_CHOICES}
    DIRECT_SOWING_SEED_RATE_UNITS = SEED_RATE_UNITS
    PRE_CULTIVATION_AUTO_SEED_RATE_UNITS = {
        SEED_RATE_UNIT_G_PER_M2,
        SEED_RATE_UNIT_G_PER_LFM,
        SEED_RATE_UNIT_SEEDS_PER_M2,
        SEED_RATE_UNIT_SEEDS_PER_LFM,
        SEED_RATE_UNIT_SEEDS_PER_PLANT,
    }
    
    HARVEST_METHOD_CHOICES = [
        ('per_plant', 'Per Plant'),
        ('per_sqm', 'Per m²'),
    ]

    # Basic information.
    name = models.CharField(max_length=200)
    variety = models.CharField(max_length=200)
    # Use growth_duration_days instead of days_to_harvest.
    notes = models.TextField(blank=True)
    seed_supplier = models.CharField(
        max_length=200,
        blank=True,
        help_text="Seed supplier/manufacturer (legacy field)",
    )
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    image_file = models.ForeignKey(
        'MediaFile',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='crops',
        help_text='Referenced media file for this crop image'
    )
    supplier = models.ForeignKey(
        'Supplier',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='crops',
        help_text="Seed supplier (preferred over seed_supplier text field)"
    )
    selected_seed_demand_supplier = models.ForeignKey(
        'Supplier',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='seed_demand_crops',
        help_text='Persisted supplier selection for seed-demand package calculations',
    )
    supplier_product_url = models.URLField(null=True, blank=True, help_text='Supplier product page URL')
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='crops')
    crop_species = models.ForeignKey(
        'crops.CropSpecies',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='project_crops',
        help_text='Optional official crop species link used when publishing to the public library.',
    )
    source_public_crop = models.ForeignKey(
        'PublicCrop',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='imported_crops',
        help_text=(
            'Library sync link: the public entry this crop pulls updates from and pushes '
            'changes to. Cleared by an unlink; provenance lives in derived_from_public_crop.'
        ),
    )
    derived_from_public_crop = models.ForeignKey(
        'PublicCrop',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='derived_crops',
        help_text=(
            'Provenance: the public entry this crop was imported from or linked to. '
            'Kept when the library link is removed, since values taken from the '
            'library remain CC BY-SA data.'
        ),
    )
    source_public_version = models.IntegerField(null=True, blank=True)
    rejected_public_version = models.IntegerField(
        null=True,
        blank=True,
        help_text=(
            'Public-library version the user explicitly declined to take over. '
            'Only silences the update notice for exactly that version; a newer '
            'public version surfaces the notice again.'
        ),
    )
    origin_type = models.CharField(max_length=50, choices=ORIGIN_TYPE_CHOICES, default=ORIGIN_MANUAL)
    is_modified_from_source = models.BooleanField(default=False)
    
    # Normalized fields for matching and deduplication.
    name_normalized = models.CharField(
        max_length=200,
        db_index=True,
        editable=False,
        help_text="Normalized name for deduplication"
    )
    variety_normalized = models.CharField(
        max_length=200,
        null=True,
        blank=True,
        db_index=True,
        editable=False,
        help_text="Normalized variety for deduplication"
    )
    
    # Manual planning fields.
    crop_family = models.CharField(
        max_length=200,
        blank=True,
        help_text="Crop family for rotation planning",
    )
    nutrient_demand = models.CharField(
        max_length=20,
        choices=NUTRIENT_DEMAND_CHOICES,
        blank=True,
        help_text="Nutrient demand level"
    )
    rotation_break_years = models.IntegerField(
        null=True,
        blank=True,
        help_text="Recommended crop rotation break in years before growing this crop family again",
    )
    cultivation_types = models.JSONField(default=list, blank=True)
    cultivation_type = models.CharField(
        max_length=30,
        choices=CULTIVATION_TYPE_CHOICES,
        blank=True,
        help_text="Deprecated single cultivation type (kept for compatibility)"
    )
    
    # Timing fields (in days).
    growth_duration_days = models.IntegerField(
        null=True,
        blank=True,
        help_text="Growth duration in days (from planting to first harvest)"
    )
    harvest_duration_days = models.IntegerField(
        null=True,
        blank=True,
        help_text="Harvest duration in days (from first to last harvest)"
    )
    propagation_duration_days = models.IntegerField(
        null=True,
        blank=True,
        help_text="Propagation duration in days"
    )
    
    # Harvest information.
    harvest_method = models.CharField(
        max_length=20,
        choices=HARVEST_METHOD_CHOICES,
        blank=True,
        help_text="Yield unit for expected harvest"
    )
    expected_yield = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Expected yield amount"
    )
    allow_deviation_delivery_weeks = models.BooleanField(
        default=False,
        help_text="Allow deviating delivery weeks"
    )
    
    # Planting distances (stored in meters - SI units).
    distance_within_row_m = models.FloatField(
        null=True,
        blank=True,
        help_text="Distance within row in meters (stored in SI units)"
    )
    row_spacing_m = models.FloatField(
        null=True,
        blank=True,
        help_text="Row spacing in meters (stored in SI units)"
    )
    sowing_depth_m = models.FloatField(
        null=True,
        blank=True,
        help_text="Sowing depth in meters (stored in SI units)"
    )

    # Seeding attributes.
    seed_rate_value = models.FloatField(
        null=True,
        blank=True,
        help_text="Seed rate value (per m², per meter, or per plant, depending on unit)"
    )
    seed_rate_unit = models.CharField(
        max_length=30,
        null=True,
        blank=True,
        help_text="Unit for seed rate (e.g. 'g/m²', 'seeds/m', 'seeds_per_plant')"
    )
    seed_rate_by_cultivation = models.JSONField(null=True, blank=True)
    sowing_calculation_safety_percent = models.FloatField(
        null=True,
        blank=True,
        help_text="Safety margin for seeding calculation in percent (0-100)"
    )
    seed_rate_direct_value = models.FloatField(
        null=True,
        blank=True,
        help_text="Seed rate for direct sowing"
    )
    seed_rate_direct_unit = models.CharField(
        max_length=30,
        null=True,
        blank=True,
        help_text="Unit for direct sowing seed rate"
    )
    sowing_calculation_safety_percent_direct = models.FloatField(
        null=True,
        blank=True,
        help_text="Safety margin for direct sowing in percent (0-100)"
    )
    seed_rate_pre_cultivation_value = models.FloatField(
        null=True,
        blank=True,
        help_text="Seed rate for pre-cultivation/transplanting"
    )
    seed_rate_pre_cultivation_unit = models.CharField(
        max_length=30,
        null=True,
        blank=True,
        help_text="Unit for pre-cultivation/transplanting seed rate"
    )
    sowing_calculation_safety_percent_pre_cultivation = models.FloatField(
        null=True,
        blank=True,
        help_text="Safety margin for pre-cultivation/transplanting in percent (0-100)"
    )
    thousand_kernel_weight_g = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Weight of 1000 kernels in grams"
    )
    seeding_requirement = models.FloatField(
        null=True,
        blank=True,
        help_text="Total seeding requirement (g or seeds, depending on type)"
    )
    seeding_requirement_type = models.CharField(
        max_length=30,
        blank=True,
        help_text="Type of seeding requirement (e.g. 'g', 'seeds')"
    )
    
    # Display settings.

    objects = ActiveCropManager()
    all_objects = models.Manager()
    display_color = models.CharField(
        max_length=7,
        blank=True,
        help_text="Display color for cultivation calendar (hex format: #RRGGBB)"
    )
    
    def clean(self) -> None:
        """Validate the crop; each helper below covers one field group."""
        super().clean()
        errors: dict[str, str] = {}
        self._normalize_legacy_dash_units()
        self._clean_cultivation_types(errors)
        self._clean_non_negative_numbers(errors)
        self._clean_seeding_requirement(errors)
        self._clean_seed_rate_by_cultivation(errors)
        self._clean_seed_rates(errors)
        self._clean_selected_seed_demand_supplier(errors)
        self._clean_display_color(errors)
        if errors:
            raise ValidationError(errors)

    def _normalize_legacy_dash_units(self) -> None:
        """Map the legacy '-' placeholder on unit fields to None."""
        for field_name in ('seed_rate_unit', 'seed_rate_direct_unit', 'seed_rate_pre_cultivation_unit'):
            if getattr(self, field_name) == '-':
                setattr(self, field_name, None)

    def _clean_cultivation_types(self, errors: dict[str, str]) -> None:
        """Normalize cultivation_types and keep cultivation_type consistent with it."""
        if not isinstance(self.cultivation_types, list):
            errors['cultivation_types'] = 'Cultivation types must be a list.'
            return
        normalized_types = [str(item).strip() for item in self.cultivation_types if str(item).strip()]
        if not normalized_types and self.cultivation_type:
            normalized_types = [self.cultivation_type]
        if not normalized_types:
            normalized_types = ['pre_cultivation']
        if len(set(normalized_types)) != len(normalized_types):
            errors['cultivation_types'] = 'Cultivation types must be unique.'
        invalid_types = [item for item in normalized_types if item not in self.CULTIVATION_TYPE_VALUES]
        if invalid_types:
            errors['cultivation_types'] = 'Cultivation types contain unsupported values.'
        self.cultivation_types = normalized_types
        if normalized_types and self.cultivation_type not in normalized_types:
            self.cultivation_type = normalized_types[0]

    def _clean_non_negative_numbers(self, errors: dict[str, str]) -> None:
        non_negative_fields = (
            ('growth_duration_days', 'Growth duration must be non-negative.'),
            ('harvest_duration_days', 'Harvest duration must be non-negative.'),
            ('propagation_duration_days', 'Propagation duration must be non-negative.'),
            ('expected_yield', 'Expected yield must be non-negative.'),
            ('rotation_break_years', 'Rotation break must be non-negative.'),
        )
        for field_name, message in non_negative_fields:
            value = getattr(self, field_name)
            if value is not None and value < 0:
                errors[field_name] = message

    def _clean_seeding_requirement(self, errors: dict[str, str]) -> None:
        if self.seeding_requirement is None and self.seeding_requirement_type:
            errors['seeding_requirement'] = 'Seeding requirement value is required when seeding requirement type is set.'
        if self.seeding_requirement is not None and not self.seeding_requirement_type:
            errors['seeding_requirement_type'] = 'Seeding requirement type is required when seeding requirement is set.'

    def _clean_seed_rate_by_cultivation(self, errors: dict[str, str]) -> None:
        if self.seed_rate_by_cultivation is None:
            return
        if not isinstance(self.seed_rate_by_cultivation, dict):
            errors['seed_rate_by_cultivation'] = 'Seed rate by cultivation must be an object.'
            return
        key_set = set(self.seed_rate_by_cultivation.keys())
        if not key_set.issubset(set(self.cultivation_types or [])):
            errors['seed_rate_by_cultivation'] = 'Seed rate by cultivation keys must be a subset of cultivation_types.'
        for method, payload in self.seed_rate_by_cultivation.items():
            if not isinstance(payload, dict):
                errors['seed_rate_by_cultivation'] = 'Each cultivation seed rate entry must be an object.'
                continue
            value = payload.get('value')
            unit = payload.get('unit')
            if not isinstance(value, (int, float)) or float(value) <= 0:
                errors['seed_rate_by_cultivation'] = 'Seed rate by cultivation values must be positive numbers.'
            if method == 'pre_cultivation' and unit not in self.PRE_CULTIVATION_AUTO_SEED_RATE_UNITS:
                errors['seed_rate_by_cultivation'] = 'Pre-cultivation unit is unsupported.'
            if method == 'direct_sowing' and unit not in self.DIRECT_SOWING_SEED_RATE_UNITS:
                errors['seed_rate_by_cultivation'] = 'Direct-sowing unit is unsupported.'

    def _clean_seed_rates(self, errors: dict[str, str]) -> None:
        """Validate spacing plus the legacy, direct-sowing and pre-cultivation seed rates."""
        non_negative_fields = (
            ('distance_within_row_m', 'Distance within row must be non-negative.'),
            ('row_spacing_m', 'Row spacing must be non-negative.'),
            ('sowing_depth_m', 'Sowing depth must be non-negative.'),
        )
        for field_name, message in non_negative_fields:
            value = getattr(self, field_name)
            if value is not None and value < 0:
                errors[field_name] = message

        if self.seed_rate_value is not None and self.seed_rate_value <= 0:
            errors['seed_rate_value'] = 'Seed rate value must be greater than zero.'
        if self.seed_rate_unit and self.seed_rate_unit not in self.PRE_CULTIVATION_AUTO_SEED_RATE_UNITS:
            errors['seed_rate_unit'] = 'Seed rate unit is unsupported.'

        self._clean_direct_sowing_seed_rate(errors)
        self._clean_pre_cultivation_seed_rate(errors)

        if self.thousand_kernel_weight_g is not None and self.thousand_kernel_weight_g <= 0:
            errors['thousand_kernel_weight_g'] = 'Thousand kernel weight must be greater than zero.'

    def _clean_direct_sowing_seed_rate(self, errors: dict[str, str]) -> None:
        if self.seed_rate_direct_value is not None and self.seed_rate_direct_value <= 0:
            errors['seed_rate_direct_value'] = 'Direct sowing seed rate value must be greater than zero.'
        if (
            self.seed_rate_direct_value is not None
            and self.seed_rate_direct_unit
            and self.seed_rate_direct_unit not in self.DIRECT_SOWING_SEED_RATE_UNITS
        ):
            errors['seed_rate_direct_unit'] = 'Direct sowing seed rate unit is unsupported.'
        has_direct = 'direct_sowing' in (self.cultivation_types or [])
        if has_direct and self.seed_rate_direct_value is not None and not self.seed_rate_direct_unit:
            errors['seed_rate_direct_unit'] = 'Direct sowing seed rate unit is required when direct sowing value is set.'

    def _clean_pre_cultivation_seed_rate(self, errors: dict[str, str]) -> None:
        if self.seed_rate_pre_cultivation_value is not None and self.seed_rate_pre_cultivation_value <= 0:
            errors['seed_rate_pre_cultivation_value'] = 'Pre-cultivation seed rate value must be greater than zero.'
        if (
            self.seed_rate_pre_cultivation_value is not None
            and self.seed_rate_pre_cultivation_unit
            and self.seed_rate_pre_cultivation_unit not in self.PRE_CULTIVATION_AUTO_SEED_RATE_UNITS
        ):
            errors['seed_rate_pre_cultivation_unit'] = 'Pre-cultivation seed rate unit is unsupported.'
        has_pre = 'pre_cultivation' in (self.cultivation_types or [])
        if has_pre and self.seed_rate_pre_cultivation_value is not None and not self.seed_rate_pre_cultivation_unit:
            errors['seed_rate_pre_cultivation_unit'] = 'Pre-cultivation seed rate unit is required when pre-cultivation value is set.'

    def _clean_selected_seed_demand_supplier(self, errors: dict[str, str]) -> None:
        if self.selected_seed_demand_supplier_id and self.project_id and self.selected_seed_demand_supplier.project_id != self.project_id:
            errors['selected_seed_demand_supplier'] = 'Selected seed demand supplier must belong to the same project.'

    def _clean_display_color(self, errors: dict[str, str]) -> None:
        if self.display_color and not re.match(r'^#[0-9A-Fa-f]{6}$', self.display_color):
            errors['display_color'] = 'Display color must be in hex format (#RRGGBB).'

    # Fields whose change marks an imported crop as diverged from its source.
    _SOURCE_DIVERGENCE_TRACKED_FIELDS = {
        'name', 'variety', 'notes', 'crop_family', 'nutrient_demand', 'cultivation_types',
        'cultivation_type', 'growth_duration_days', 'harvest_duration_days', 'propagation_duration_days',
        'harvest_method', 'expected_yield', 'distance_within_row_m',
        'row_spacing_m', 'sowing_depth_m', 'seed_rate_value', 'seed_rate_unit', 'seed_rate_by_cultivation',
        'sowing_calculation_safety_percent', 'seed_rate_direct_value', 'seed_rate_direct_unit',
        'sowing_calculation_safety_percent_direct', 'seed_rate_pre_cultivation_value',
        'seed_rate_pre_cultivation_unit', 'sowing_calculation_safety_percent_pre_cultivation',
        'thousand_kernel_weight_g', 'seeding_requirement',
        'seeding_requirement_type', 'display_color', 'supplier_id', 'supplier_product_url', 'image_file_id',
        'selected_seed_demand_supplier_id',
    }

    def save(self, *args: Any, **kwargs: Any) -> None:
        """Save the crop and auto-generate display color and normalized fields."""
        from farm.utils import normalize_text

        previous = None
        if self.pk:
            previous = Crop.all_objects.filter(pk=self.pk).values().first()

        self._flag_source_divergence(previous)
        # Provenance follows the first library link and outlives an unlink.
        if self.source_public_crop_id and not self.derived_from_public_crop_id:
            self.derived_from_public_crop_id = self.source_public_crop_id

        # Generate display color on creation if not set.
        if not self.pk and not self.display_color:
            self.display_color = self._generate_display_color()

        # Always update normalized fields based on current values
        self.name_normalized = normalize_text(self.name) or ''
        self.variety_normalized = normalize_text(self.variety)

        super().save(*args, **kwargs)

        current = Crop.all_objects.filter(pk=self.pk).values().first() or {}
        changed_fields = self._compute_changed_fields(previous, current)
        self._record_save_revision(current, previous, changed_fields)

        timing_changed_fields = [
            field for field in ('growth_duration_days', 'harvest_duration_days')
            if field in changed_fields
        ]
        if timing_changed_fields:
            self._recalculate_related_planting_plan_dates(timing_changed_fields)

    def _flag_source_divergence(self, previous: dict[str, Any] | None) -> None:
        """Mark a library-derived, still-pristine crop as modified if a tracked field changed.

        Provenance counts as well as the sync link: after an unlink the flag
        still tells provenance readers whether the values are the library's.
        """
        if not previous or previous.get('is_modified_from_source'):
            return
        if not (
            previous.get('source_public_crop_id')
            or previous.get('derived_from_public_crop_id')
        ):
            return
        if any(previous.get(field) != getattr(self, field) for field in self._SOURCE_DIVERGENCE_TRACKED_FIELDS):
            self.is_modified_from_source = True

    @staticmethod
    def _compute_changed_fields(previous: dict[str, Any] | None, current: dict[str, Any]) -> list[str]:
        if not previous:
            return ['created']
        return [
            key for key, value in current.items()
            if key not in {'created_at', 'updated_at'} and previous.get(key) != value
        ]

    def _record_save_revision(
        self,
        current: dict[str, Any],
        previous: dict[str, Any] | None,
        changed_fields: list[str],
    ) -> None:
        serializable_snapshot: dict[str, Any] = json.loads(
            json.dumps(current, cls=DjangoJSONEncoder)
        )
        history_action = getattr(self, '_history_action', None)
        if hasattr(self, '_history_action'):
            del self._history_action
        if history_action is None:
            history_action = EntityRevision.ACTION_CREATED if not previous else EntityRevision.ACTION_UPDATED

        EntityRevision.objects.create(
            project=self.project,
            entity_type='crop',
            object_id=self.pk,
            action=history_action,
            display_name=format_crop_display_name(self.name, self.variety) or '',
            snapshot=serializable_snapshot,
            changed_fields=changed_fields,
        )

    def _recalculate_related_planting_plan_dates(self, changed_timing_fields: list[str]) -> None:
        """Update stored planting-plan harvest dates after crop timing changes."""
        from .planning import PlantingPlan

        plans_to_update = []
        now = timezone.now()
        plans = self._planting_plans_affected_by_timing_change(changed_timing_fields)
        for plan in plans:
            # These plans are this crop's by definition. Handing them the
            # already-loaded instance saves a crop fetch per plan and lets
            # them share this instance's cached general-Kultur lookup.
            if plan.crop_id == self.pk:
                plan.crop = self
            elif plan.crop is not None:
                plan.crop._resolved_general_crop = self
            previous_harvest_date = plan.harvest_date
            previous_harvest_end_date = plan.harvest_end_date
            plan.recalculate_harvest_dates()
            if (
                plan.harvest_date != previous_harvest_date
                or plan.harvest_end_date != previous_harvest_end_date
            ):
                plan.updated_at = now
                plans_to_update.append(plan)

        if plans_to_update:
            PlantingPlan.objects.bulk_update(
                plans_to_update,
                ['harvest_date', 'harvest_end_date', 'updated_at'],
            )

    def _planting_plans_affected_by_timing_change(self, changed_timing_fields: list[str]) -> models.QuerySet:
        """Return direct plans plus Sorte plans inheriting the changed timing."""
        from .planning import PlantingPlan

        direct_plans = Q(crop_id=self.pk)
        inherited_plans = Q()
        is_general_crop = self.crop_species_id is not None and self.variety_normalized is None
        if is_general_crop:
            inherited_timing = Q()
            if 'growth_duration_days' in changed_timing_fields:
                inherited_timing |= Q(crop__growth_duration_days__isnull=True)
            if 'harvest_duration_days' in changed_timing_fields:
                inherited_timing |= Q(crop__harvest_duration_days__isnull=True)
            if inherited_timing:
                inherited_plans = (
                    Q(
                        crop__project_id=self.project_id,
                        crop__crop_species_id=self.crop_species_id,
                        crop__variety_normalized__isnull=False,
                    )
                    & inherited_timing
                )

        return (
            PlantingPlan.objects
            .filter(direct_plans | inherited_plans)
            .select_related('crop')
        )

    def _generate_display_color(self) -> str:
        """Generate a display color using a Golden Angle HSL strategy."""
        # Use the max ID as index to avoid race conditions (None -> 0).
        max_id = Crop.objects.aggregate(models.Max('id'))['id__max']
        index = max_id if max_id is not None else 0
        
        # Golden Angle HSL strategy: hue=(index×137.508)%360, saturation=65%, lightness=55%.
        golden_angle = 137.508
        hue = (index * golden_angle) % 360
        saturation = 0.65
        lightness = 0.55
        
        # Convert HSL to RGB.
        rgb = self._hsl_to_rgb(hue, saturation, lightness)
        
        # Convert RGB to hex.
        return f"#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}"

    def _hsl_to_rgb(
        self,
        h: float,
        s: float,
        lightness: float,
    ) -> tuple[int, int, int]:
        """Convert HSL color to RGB."""
        h = h / 360.0
        
        def hue_to_rgb(p: float, q: float, t: float) -> float:
            if t < 0:
                t += 1
            if t > 1:
                t -= 1
            if t < 1/6:
                return p + (q - p) * 6 * t
            if t < 1/2:
                return q
            if t < 2/3:
                return p + (q - p) * (2/3 - t) * 6
            return p
        
        if s == 0:
            r = g = b = lightness
        else:
            q = (
                lightness * (1 + s)
                if lightness < 0.5
                else lightness + s - lightness * s
            )
            p = 2 * lightness - q
            r = hue_to_rgb(p, q, h + 1/3)
            g = hue_to_rgb(p, q, h)
            b = hue_to_rgb(p, q, h - 1/3)
        
        return (int(r * 255), int(g * 255), int(b * 255))

    @property
    def plants_per_m2(self) -> Decimal | None:
        """Plants per square meter from this row's own spacing values."""
        return compute_plants_per_m2(self.row_spacing_m, self.distance_within_row_m)

    def __str__(self) -> str:
        """Return the crop name, with variety in parentheses if set."""
        if self.variety:
            return f"{self.name} ({self.variety})"
        return self.name

    class Meta:
        ordering = ['name', 'variety']
        constraints = [
            models.UniqueConstraint(
                fields=['name_normalized', 'variety_normalized', 'supplier'],
                condition=models.Q(deleted_at__isnull=True),
                name='unique_crop_normalized',
                violation_error_message=(
                    'A crop with this name, variety, and supplier already exists.'
                )
            ),
            models.UniqueConstraint(
                fields=['project', 'name_normalized'],
                condition=(
                    models.Q(deleted_at__isnull=True)
                    & (models.Q(variety_normalized__isnull=True) | models.Q(variety_normalized=''))
                ),
                name='unique_general_crop_name_per_project',
                violation_error_message=(
                    'A general crop with this name already exists in this project.'
                )
            )
        ]


class CropSupplierData(TimestampedModel):
    """Supplier-specific seed metadata attached to one crop."""

    crop = models.ForeignKey(Crop, on_delete=models.CASCADE, related_name='supplier_data')
    supplier = models.ForeignKey(Supplier, on_delete=models.CASCADE, related_name='crop_supplier_data')
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='crop_supplier_data')
    supplier_name = models.CharField(max_length=200, blank=True)
    supplier_url = models.URLField(blank=True)
    supplier_product_name = models.CharField(max_length=255, blank=True)
    supplier_product_url = models.URLField(blank=True)
    packaging_sizes = models.JSONField(default=list, blank=True)
    thousand_kernel_weight_g = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    germination_rate = models.FloatField(null=True, blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    notes = models.TextField(blank=True)
    source_url = models.URLField(blank=True)

    class Meta:
        ordering = ['crop', 'supplier']
        constraints = [
            models.UniqueConstraint(fields=['crop', 'supplier'], name='unique_crop_supplier_data_per_supplier'),
        ]

    def clean(self) -> None:
        super().clean()
        errors = {}
        if self.thousand_kernel_weight_g is not None and self.thousand_kernel_weight_g <= 0:
            errors['thousand_kernel_weight_g'] = 'Thousand kernel weight must be greater than zero.'
        if self.germination_rate is not None and (self.germination_rate < 0 or self.germination_rate > 100):
            errors['germination_rate'] = 'Germination rate must be between 0 and 100.'
        if self.price is not None and self.price < 0:
            errors['price'] = 'Price must be non-negative.'
        if errors:
            raise ValidationError(errors)


class PublicCrop(TimestampedModel):
    """Published crop data in the shared public knowledge base.

    Candidate for extraction into a separate service consumed by OFP over an
    API (under discussion as of 2026-07). Keep this model, its serializer, and
    PublicCropViewSet loosely coupled from farm-project-scoped models/logic
    (Crop, EntityRevision, etc.) so such an extraction stays feasible.

    Public library entries use non-destructive statuses. Project crops
    imported from this table are copied into private project data and keep
    working even when the public entry is later withdrawn or removed.
    """

    STATUS_DRAFT = 'draft'
    STATUS_PUBLISHED = 'published'
    STATUS_WITHDRAWN = 'withdrawn'
    STATUS_REMOVED = 'removed'
    STATUS_CHOICES = [
        (STATUS_DRAFT, 'Draft'),
        (STATUS_PUBLISHED, 'Published'),
        (STATUS_WITHDRAWN, 'Withdrawn'),
        (STATUS_REMOVED, 'Removed'),
    ]
    REMOVAL_REASON_ACCIDENTAL = 'accidental_publication'
    REMOVAL_REASON_TEST_DATA = 'test_data'
    REMOVAL_REASON_DUPLICATE = 'duplicate'
    REMOVAL_REASON_WRONG_MAPPING = 'wrong_mapping'
    REMOVAL_REASON_UNLAWFUL_CONTENT = 'unlawful_content'
    REMOVAL_REASON_SPECIES_REJECTED = 'species_rejected'
    REMOVAL_REASON_PROPOSAL_REJECTED = 'proposal_rejected'
    REMOVAL_REASON_OTHER = 'other'
    REMOVAL_REASON_CHOICES = [
        (REMOVAL_REASON_ACCIDENTAL, 'Accidental publication'),
        (REMOVAL_REASON_TEST_DATA, 'Test data'),
        (REMOVAL_REASON_DUPLICATE, 'Duplicate'),
        (REMOVAL_REASON_WRONG_MAPPING, 'Wrong mapping'),
        (REMOVAL_REASON_UNLAWFUL_CONTENT, 'Unlawful content'),
        # System-applied only (never offered in the manual removal dialog): set
        # when a moderator rejects the crop species a crop is published
        # under, see crops.services.remove_public_crops_for_rejected_species.
        (REMOVAL_REASON_SPECIES_REJECTED, 'Crop species rejected'),
        # System-applied only: set when a moderator rejects a still-draft
        # new-publish PublicCropChangeProposal (never any other entry's
        # status), see farm.services.public_crops.reject_new_publish_proposal.
        (REMOVAL_REASON_PROPOSAL_REJECTED, 'New-publish proposal rejected'),
        (REMOVAL_REASON_OTHER, 'Other'),
    ]

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='public_crops')
    status = models.CharField(max_length=50, choices=STATUS_CHOICES, default=STATUS_PUBLISHED)
    status_changed_at = models.DateTimeField(null=True, blank=True)
    status_changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='moderated_public_crops',
    )
    removal_reason = models.CharField(max_length=50, choices=REMOVAL_REASON_CHOICES, blank=True)
    status_note = models.TextField(blank=True)
    name = models.CharField(max_length=200)
    variety = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)
    crop_species = models.ForeignKey(
        'crops.CropSpecies',
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name='public_crops',
        help_text='Official crop species required for new public-library publications.',
    )
    original_language_code = models.CharField(max_length=20, blank=True)
    source_project_crop = models.ForeignKey('Crop', null=True, blank=True, on_delete=models.SET_NULL, related_name='published_public_crops')
    source_project = models.ForeignKey(Project, null=True, blank=True, on_delete=models.SET_NULL, related_name='published_crops')
    version = models.IntegerField(default=1)
    published_at = models.DateTimeField(null=True, blank=True)
    name_normalized = models.CharField(max_length=200, db_index=True, editable=False)
    variety_normalized = models.CharField(max_length=200, blank=True, db_index=True, editable=False)
    crop_family = models.CharField(max_length=200, blank=True)
    nutrient_demand = models.CharField(max_length=20, choices=Crop.NUTRIENT_DEMAND_CHOICES, blank=True)
    cultivation_types = models.JSONField(default=list, blank=True)
    cultivation_type = models.CharField(max_length=30, choices=Crop.CULTIVATION_TYPE_CHOICES, blank=True)
    growth_duration_days = models.IntegerField(null=True, blank=True)
    harvest_duration_days = models.IntegerField(null=True, blank=True)
    propagation_duration_days = models.IntegerField(null=True, blank=True)
    harvest_method = models.CharField(max_length=20, choices=Crop.HARVEST_METHOD_CHOICES, blank=True)
    expected_yield = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    allow_deviation_delivery_weeks = models.BooleanField(default=False)
    distance_within_row_m = models.FloatField(null=True, blank=True)
    row_spacing_m = models.FloatField(null=True, blank=True)
    sowing_depth_m = models.FloatField(null=True, blank=True)
    seed_rate_value = models.FloatField(null=True, blank=True)
    seed_rate_unit = models.CharField(max_length=30, null=True, blank=True)
    seed_rate_by_cultivation = models.JSONField(null=True, blank=True)
    thousand_kernel_weight_g = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    seeding_requirement = models.FloatField(null=True, blank=True)
    seeding_requirement_type = models.CharField(max_length=30, blank=True)
    display_color = models.CharField(max_length=7, blank=True)
    seed_packages = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ['name', 'variety']

    def save(self, *args: Any, **kwargs: Any) -> None:
        from farm.utils import normalize_text

        self.name_normalized = normalize_text(self.name) or ''
        self.variety_normalized = normalize_text(self.variety) or ''
        if self.status == self.STATUS_PUBLISHED and self.published_at is None:
            self.published_at = timezone.now()
        super().save(*args, **kwargs)

    @property
    def created_by_label(self) -> str:
        """Public attribution shown to every user for this entry.

        Must never surface the account email address, the username, or the
        (private, project-scoped) registration name. Attribution is opt-in:
        it shows the user's explicitly configured public display name
        (``accounts.models.PublicProfile.public_display_name``), or is
        empty (rendered as anonymous by callers) if none was set.
        """
        if not self.created_by:
            return ''
        public_profile = getattr(self.created_by, 'public_profile', None)
        return public_profile.public_display_name if public_profile else ''

    def descriptions_by_language(self) -> dict[str, str]:
        """language code → public description, for every stored translation."""
        return {
            translation.language_code: translation.description
            for translation in self.translations.all()
            if translation.description
        }

    def localized_description(self, language_code: str | None) -> tuple[str, str | None]:
        """Public description in the best available language, plus that language.

        Falls back to :attr:`notes` (the original-language text, kept in sync
        with the original translation row) so entries published before
        translations existed keep rendering.
        """
        from config.languages import resolve_translation

        text, used = resolve_translation(self.descriptions_by_language(), language_code)
        if text:
            return text, used
        notes = (self.notes or '').strip()
        if notes:
            return notes, (self.original_language_code or None)
        return '', None

    def display_name(self, language_code: str | None, region: str | None = None) -> tuple[str, str]:
        """Species common name in the requested language, plus that language.

        ``variety`` is deliberately not part of this: variety names are proper
        names and are never translated. Callers combine the two themselves.
        """
        if self.crop_species_id and self.crop_species is not None:
            return self.crop_species.localized_name(language_code, region)
        # Pre-species legacy entries only ever had their own single-language
        # name; surfacing it unchanged beats showing an empty cell.
        return self.name, (self.original_language_code or '')

    def __str__(self) -> str:
        return f"{self.name} ({self.variety})" if self.variety else self.name


class PublicCropTranslation(models.Model):
    """Translatable editorial text of one public crop entry, per language.

    Only the free-text public description is language-dependent. The variety
    name, supplier, spacings, durations, temperatures and every other
    numeric/technical field stay on :class:`PublicCrop` because they are
    language-independent facts, not translatable prose.
    """

    public_crop = models.ForeignKey(
        PublicCrop,
        on_delete=models.CASCADE,
        related_name='translations',
    )
    language_code = models.CharField(max_length=10, db_index=True)
    description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['language_code']
        constraints = [
            models.UniqueConstraint(
                fields=['public_crop', 'language_code'],
                name='unique_public_crop_translation_per_language',
            ),
        ]

    def save(self, *args: Any, **kwargs: Any) -> None:
        self.language_code = (self.language_code or '').strip().lower()
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f'{self.public_crop_id} [{self.language_code}]'


class PublicCropStatusEvent(models.Model):
    """Audit trail for public crop publication and moderation status changes."""

    public_crop = models.ForeignKey(PublicCrop, on_delete=models.CASCADE, related_name='status_events')
    from_status = models.CharField(max_length=50, blank=True)
    to_status = models.CharField(max_length=50)
    reason = models.CharField(max_length=50, blank=True)
    note = models.TextField(blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='public_crop_status_events',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']


class PublicCropDiscussionTopic(models.Model):
    """A focused discussion about one shared crop-library entry."""

    public_crop = models.ForeignKey(PublicCrop, on_delete=models.CASCADE, related_name='discussion_topics')
    title = models.CharField(max_length=240)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='public_crop_discussion_topics',
    )
    revision = models.ForeignKey(
        'PublicCropRevision',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='discussion_topics',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at', '-id']


class PublicCropDiscussionComment(models.Model):
    """A comment or reply in a public-crop discussion topic."""

    topic = models.ForeignKey(PublicCropDiscussionTopic, on_delete=models.CASCADE, related_name='comments')
    parent = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='replies')
    body = models.TextField()
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='public_crop_discussion_comments',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='deleted_public_crop_discussion_comments',
    )

    class Meta:
        ordering = ['created_at', 'id']


class PublicCropChangeProposal(models.Model):
    """Reviewed edit proposal for a shared crop-library entry.

    Originally an edit-only queue (`KIND_EDIT`); extended to also cover a
    brand-new publish (`KIND_NEW_PUBLISH`), where `public_crop` points at a
    `PublicCrop` row created with `status=STATUS_DRAFT` — invisible everywhere
    else until a moderator approves the proposal and the entry is published.
    See docs/account-trust-levels.md and the "Legacy reviewed change
    proposals" section of docs/crop-library-architecture.md.
    """

    STATUS_PENDING = 'pending'
    STATUS_APPROVED = 'approved'
    STATUS_REJECTED = 'rejected'
    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_APPROVED, 'Approved'),
        (STATUS_REJECTED, 'Rejected'),
    ]

    KIND_EDIT = 'edit'
    KIND_NEW_PUBLISH = 'new_publish'
    KIND_CHOICES = [
        (KIND_EDIT, 'Edit'),
        (KIND_NEW_PUBLISH, 'New publish'),
    ]

    public_crop = models.ForeignKey(PublicCrop, on_delete=models.CASCADE, related_name='change_proposals')
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, default=KIND_EDIT)
    origin_api = models.BooleanField(
        default=False,
        help_text='Whether this proposal was created through a ProjectApiToken-authenticated request.',
    )
    origin_declared_agent = models.BooleanField(
        default=False,
        help_text='Whether the request self-declared as an automated/agent client (X-Client-Declared-Type).',
    )
    summary = models.CharField(max_length=240)
    proposed_data = models.JSONField(default=dict, blank=True, encoder=DjangoJSONEncoder)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    proposed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='public_crop_change_proposals',
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='reviewed_public_crop_change_proposals',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at', '-id']


class PublicCropRevision(models.Model):
    """Immutable version snapshot for a shared public-library crop."""

    ACTION_CREATED = 'created'
    ACTION_UPDATED = 'updated'
    ACTION_RESTORED = 'restored'
    ACTION_SPECIES_RELINKED = 'species_relinked'
    ACTION_CHOICES = [
        (ACTION_CREATED, 'Created'),
        (ACTION_UPDATED, 'Updated'),
        (ACTION_RESTORED, 'Restored'),
        (ACTION_SPECIES_RELINKED, 'Crop species relinked'),
    ]

    public_crop = models.ForeignKey(PublicCrop, on_delete=models.CASCADE, related_name='revisions')
    version = models.PositiveIntegerField()
    action = models.CharField(max_length=20, choices=ACTION_CHOICES, default=ACTION_UPDATED)
    snapshot = models.JSONField(default=dict, encoder=DjangoJSONEncoder)
    changed_fields = models.JSONField(default=list, blank=True, encoder=DjangoJSONEncoder)
    restored_from_version = models.PositiveIntegerField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='public_crop_revisions',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-version', '-id']
        constraints = [
            models.UniqueConstraint(fields=['public_crop', 'version'], name='unique_public_crop_revision_version'),
        ]

    def __str__(self) -> str:
        return f"{self.public_crop} v{self.version}"


class PublicCropSpeciesRelinkRequest(models.Model):
    """A "Kulturart korrigieren" relink still waiting on a species proposal.

    A moderator correcting a wrong ``crop_species`` mapping can apply the
    relink straight away only when the target species is already published.
    When they propose the target species instead, the entry has to stay on its
    current (wrong, but reviewed) species until the proposal is decided:
    pointing it at a ``proposed`` species would block import, update and
    discussion for everyone, and a later rejection would drag the entry into
    ``crops.services.remove_public_crops_for_rejected_species`` even though
    nothing was wrong with the entry itself.

    This row remembers the correction so approving the species completes it
    without the moderator having to repeat the action.
    """

    STATUS_PENDING = 'pending'
    STATUS_COMPLETED = 'completed'
    STATUS_CANCELLED = 'cancelled'
    STATUS_CHOICES = [
        (STATUS_PENDING, 'Pending'),
        (STATUS_COMPLETED, 'Completed'),
        (STATUS_CANCELLED, 'Cancelled'),
    ]

    public_crop = models.ForeignKey(
        PublicCrop,
        on_delete=models.CASCADE,
        related_name='species_relink_requests',
    )
    from_crop_species = models.ForeignKey(
        'crops.CropSpecies',
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='public_crop_relinks_away',
    )
    to_crop_species = models.ForeignKey(
        'crops.CropSpecies',
        on_delete=models.CASCADE,
        related_name='public_crop_relinks_to',
    )
    # None means "leave the variety as it is when this completes"; an empty
    # string is a deliberate request to clear it. Distinct from
    # ``PublicCrop.variety`` (blank=True, never null) for that reason.
    to_variety = models.CharField(max_length=200, null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    note = models.TextField(blank=True)
    resolution_note = models.TextField(blank=True)
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='public_crop_species_relink_requests',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at', '-id']
        constraints = [
            models.UniqueConstraint(
                fields=['public_crop'],
                condition=Q(status='pending'),
                name='unique_pending_public_crop_species_relink',
            ),
        ]

    def __str__(self) -> str:
        return f'{self.public_crop_id} -> species {self.to_crop_species_id} ({self.status})'


class SeedPackage(TimestampedModel):
    """Sold package option for a crop."""

    UNIT_GRAMS = SEED_PACKAGE_UNIT_GRAMS
    UNIT_SEEDS = SEED_PACKAGE_UNIT_SEEDS
    UNIT_CHOICES = [
        (UNIT_GRAMS, 'Grams'),
        (UNIT_SEEDS, 'Seeds'),
    ]

    crop = models.ForeignKey('Crop', on_delete=models.CASCADE, related_name='seed_packages')
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='seed_packages')
    size_value = models.DecimalField(max_digits=10, decimal_places=1)
    size_unit = models.CharField(max_length=10, choices=UNIT_CHOICES, default=UNIT_GRAMS)
    evidence_text = models.CharField(max_length=200, blank=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['size_unit', 'size_value']
        constraints = [
            models.UniqueConstraint(
                fields=['crop', 'size_value', 'size_unit'],
                name='unique_seed_package_per_crop_size_unit',
            )
        ]

    def clean(self) -> None:
        super().clean()
        if self.size_value is not None and self.size_value <= 0:
            raise ValidationError({'size_value': 'Package size must be greater than zero.'})
        if self.size_unit not in {self.UNIT_GRAMS, self.UNIT_SEEDS}:
            raise ValidationError({'size_unit': 'Unsupported package size unit.'})

    def __str__(self) -> str:
        return f"{self.crop.name} {self.size_value} {self.size_unit}"
