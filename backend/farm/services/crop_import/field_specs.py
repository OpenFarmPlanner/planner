"""Canonical field specifications for crop imports.

Every rule an agent needs to satisfy lives here exactly once: the canonical
name, the canonical unit, which input spellings are accepted, the hard bounds
that reject a value, and the plausibility band that merely warns about it. Both
the import validator and the generated OpenAPI document read these specs, so a
schema change and a validation change are the same edit.

Hard vs. plausible bounds
-------------------------
``hard_min`` / ``hard_max`` describe values that cannot be meant seriously —
a 30 m row spacing in a market garden is a unit mistake, not a wide bed — and
are rejected. ``warn_min`` / ``warn_max`` describe the ordinary range; values
outside it are accepted but surface as warnings in the preview so nobody
stores them unnoticed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any

from crops.plant_families import PLANT_FAMILY_BOTANICAL_NAMES
from farm.models import Crop
from farm.seed_units import (
    SEED_RATE_UNIT_G_PER_LFM,
    SEED_RATE_UNIT_G_PER_M2,
    SEED_RATE_UNIT_SEEDS_PER_LFM,
    SEED_RATE_UNIT_SEEDS_PER_M2,
    SEED_RATE_UNIT_SEEDS_PER_PLANT,
)

# Value kinds understood by the analyzer and rendered into OpenAPI types.
KIND_STRING = 'string'
KIND_INTEGER = 'integer'
KIND_NUMBER = 'number'
KIND_ENUM = 'enum'
KIND_ENUM_LIST = 'enum_list'
KIND_BOOLEAN = 'boolean'
KIND_COLOR = 'color'

# Physical dimension used to decide which unit conversions are legal.
DIMENSION_LENGTH = 'length'

CULTIVATION_TYPE_VALUES = tuple(value for value, _ in Crop.CULTIVATION_TYPE_CHOICES)
NUTRIENT_DEMAND_VALUES = tuple(value for value, _ in Crop.NUTRIENT_DEMAND_CHOICES)
HARVEST_METHOD_VALUES = tuple(value for value, _ in Crop.HARVEST_METHOD_CHOICES)

# The project's own seed-rate vocabulary is the only accepted API vocabulary.
# Synonyms are normalized on the way in (see units.normalize_seed_rate_unit_input)
# but never stored, so the database keeps exactly these five values.
SEED_RATE_UNIT_VALUES = (
    SEED_RATE_UNIT_G_PER_M2,
    SEED_RATE_UNIT_G_PER_LFM,
    SEED_RATE_UNIT_SEEDS_PER_M2,
    SEED_RATE_UNIT_SEEDS_PER_LFM,
    SEED_RATE_UNIT_SEEDS_PER_PLANT,
)

# Plausible magnitudes per seed-rate unit. A rate is meaningless without its
# unit, so the band can only be chosen once the unit is known.
SEED_RATE_PLAUSIBILITY: dict[str, tuple[float, float]] = {
    SEED_RATE_UNIT_G_PER_M2: (0.01, 100.0),
    SEED_RATE_UNIT_G_PER_LFM: (0.01, 50.0),
    SEED_RATE_UNIT_SEEDS_PER_M2: (0.1, 2000.0),
    SEED_RATE_UNIT_SEEDS_PER_LFM: (0.1, 500.0),
    SEED_RATE_UNIT_SEEDS_PER_PLANT: (1.0, 10.0),
}


@dataclass(frozen=True)
class SeedRateUnitConstraint:
    """UI/API value constraints for one seed-rate unit."""

    value_type: str
    step: float
    minimum: float

    def as_dict(self) -> dict[str, str | float]:
        """Return the machine-readable representation used by API clients."""
        return {
            'value_type': self.value_type,
            'step': self.step,
            'minimum': self.minimum,
        }


SEED_RATE_VALUE_TYPE_NUMBER = 'number'
SEED_RATE_VALUE_TYPE_INTEGER = 'integer'

# Per-unit value constraints. These are stricter than the generic numeric
# parser when the UI and domain model require it; clients should read this
# instead of hardcoding input steps.
SEED_RATE_UNIT_CONSTRAINTS: dict[str, SeedRateUnitConstraint] = {
    SEED_RATE_UNIT_G_PER_M2: SeedRateUnitConstraint(
        value_type=SEED_RATE_VALUE_TYPE_NUMBER,
        step=0.001,
        minimum=0.001,
    ),
    SEED_RATE_UNIT_G_PER_LFM: SeedRateUnitConstraint(
        value_type=SEED_RATE_VALUE_TYPE_NUMBER,
        step=0.001,
        minimum=0.001,
    ),
    SEED_RATE_UNIT_SEEDS_PER_M2: SeedRateUnitConstraint(
        value_type=SEED_RATE_VALUE_TYPE_NUMBER,
        step=0.001,
        minimum=0.001,
    ),
    SEED_RATE_UNIT_SEEDS_PER_LFM: SeedRateUnitConstraint(
        value_type=SEED_RATE_VALUE_TYPE_NUMBER,
        step=0.001,
        minimum=0.001,
    ),
    SEED_RATE_UNIT_SEEDS_PER_PLANT: SeedRateUnitConstraint(
        value_type=SEED_RATE_VALUE_TYPE_INTEGER,
        step=1,
        minimum=1,
    ),
}


def seed_rate_unit_constraints_payload() -> dict[str, dict[str, str | float]]:
    """Return all seed-rate unit constraints for API clients."""
    return {
        unit: constraint.as_dict()
        for unit, constraint in SEED_RATE_UNIT_CONSTRAINTS.items()
    }


def seed_rate_value_constraint_error(value: object, unit: object) -> str | None:
    """Return a stable error code when a seed-rate value violates its unit constraint."""
    constraint = SEED_RATE_UNIT_CONSTRAINTS.get(str(unit))
    if constraint is None:
        return None
    try:
        decimal_value = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None
    if (
        constraint.value_type == SEED_RATE_VALUE_TYPE_INTEGER
        and decimal_value != decimal_value.to_integral_value()
    ):
        return 'whole_number_required'
    if decimal_value < Decimal(str(constraint.minimum)):
        return 'below_unit_minimum'
    return None


@dataclass(frozen=True)
class FieldSpec:
    """Declarative description of one importable crop field."""

    name: str
    kind: str
    description: str
    example: Any
    unit: str | None = None
    dimension: str | None = None
    hard_min: float | None = None
    hard_max: float | None = None
    warn_min: float | None = None
    warn_max: float | None = None
    exclusive_min: bool = False
    enum_values: tuple[str, ...] | None = None
    max_length: int | None = None
    # Input keys accepted for this field, mapped to the unit they imply.
    # A ``None`` unit marks a spelling that carries no unit information; such
    # input is only usable when the value itself states its unit.
    input_aliases: dict[str, str | None] = field(default_factory=dict)
    # Companion field that must be present whenever this one is, and vice
    # versa. Used for the value/unit pairs of seed rates.
    requires: str | None = None
    notes: str = ''

    @property
    def accepted_keys(self) -> tuple[str, ...]:
        """Return every input key that maps to this field, canonical name first."""
        keys = [self.name]
        keys.extend(key for key in self.input_aliases if key != self.name)
        return tuple(keys)


def _length_aliases(base: str) -> dict[str, str | None]:
    """Build the accepted input spellings for a length field.

    ``<base>_m`` / ``<base>_cm`` / ``<base>_mm`` state their unit in the key
    and are unambiguous. The bare ``<base>`` spelling does not, so it maps to
    ``None`` and is only accepted when the *value* names a unit.
    """
    return {
        f'{base}_m': 'm',
        f'{base}_cm': 'cm',
        f'{base}_mm': 'mm',
        base: None,
    }


CROP_FIELD_SPECS: tuple[FieldSpec, ...] = (
    FieldSpec(
        name='name',
        kind=KIND_STRING,
        description=(
            'Crop name without the variety, for example "Brokkoli". Required; '
            'together with variety and supplier it identifies the crop.'
        ),
        example='Brokkoli',
        max_length=200,
        # `culture_name` stays accepted: the Culture -> Crop rename must not
        # silently reject payloads existing agent integrations already send.
        input_aliases={'name': None, 'crop_name': None, 'culture_name': None},
    ),
    FieldSpec(
        name='variety',
        kind=KIND_STRING,
        description=(
            'Variety / cultivar name, for example "Calabrese". Empty when the '
            'source does not state one — never derive it from a product name.'
        ),
        example='Calabrese',
        max_length=200,
        input_aliases={'variety': None, 'cultivar': None, 'sorte': None},
    ),
    FieldSpec(
        name='notes',
        kind=KIND_STRING,
        description='Free-text notes carried over from the source.',
        example='Bevorzugt gleichmäßige Bewässerung.',
        input_aliases={'notes': None},
    ),
    FieldSpec(
        name='supplier_name',
        kind=KIND_STRING,
        description=(
            'Seed supplier name. Resolved against existing suppliers of the '
            'bound project; an unknown name creates a supplier record.'
        ),
        example='Bingenheimer Saatgut',
        max_length=200,
        input_aliases={'supplier_name': None, 'seed_supplier': None},
    ),
    FieldSpec(
        name='crop_family',
        kind=KIND_ENUM,
        description=(
            'Plant family used for rotation planning, as its botanical name '
            '(see /api/plant-families/). Common German/English names and older '
            'botanical synonyms (e.g. "Kreuzblütler", "Cruciferae") are converted.'
        ),
        example='Brassicaceae',
        enum_values=PLANT_FAMILY_BOTANICAL_NAMES,
        input_aliases={'crop_family': None},
    ),
    FieldSpec(
        name='nutrient_demand',
        kind=KIND_ENUM,
        description='Nutrient demand class used for rotation planning.',
        example='high',
        enum_values=NUTRIENT_DEMAND_VALUES,
        input_aliases={'nutrient_demand': None},
    ),
    FieldSpec(
        name='cultivation_types',
        kind=KIND_ENUM_LIST,
        description=(
            'How the crop is established. Drives which seed-rate pair is '
            'required: "direct_sowing" pairs with seed_rate_direct_*, '
            '"pre_cultivation" with seed_rate_pre_cultivation_*.'
        ),
        example=['pre_cultivation'],
        enum_values=CULTIVATION_TYPE_VALUES,
        input_aliases={'cultivation_types': None, 'cultivation_type': None},
    ),
    FieldSpec(
        name='harvest_method',
        kind=KIND_ENUM,
        description='Reference quantity for expected_yield.',
        example='per_sqm',
        enum_values=HARVEST_METHOD_VALUES,
        input_aliases={'harvest_method': None},
    ),
    FieldSpec(
        name='growth_duration_days',
        kind=KIND_INTEGER,
        description='Days from planting or direct sowing to the first harvest.',
        example=75,
        unit='days',
        hard_min=0,
        hard_max=1095,
        warn_min=5,
        warn_max=400,
        input_aliases={'growth_duration_days': None},
    ),
    FieldSpec(
        name='harvest_duration_days',
        kind=KIND_INTEGER,
        description='Days from the first to the last harvest of one planting.',
        example=21,
        unit='days',
        hard_min=0,
        hard_max=730,
        warn_max=240,
        input_aliases={'harvest_duration_days': None},
    ),
    FieldSpec(
        name='propagation_duration_days',
        kind=KIND_INTEGER,
        description='Days spent in propagation before transplanting.',
        example=28,
        unit='days',
        hard_min=0,
        hard_max=365,
        warn_max=120,
        input_aliases={'propagation_duration_days': None},
    ),
    FieldSpec(
        name='expected_yield',
        kind=KIND_NUMBER,
        description=(
            'Expected yield in kilograms, per plant or per square metre '
            'depending on harvest_method.'
        ),
        example=2.5,
        unit='kg',
        hard_min=0,
        hard_max=100000,
        warn_max=500,
        input_aliases={'expected_yield': None},
        notes='Interpretation depends on harvest_method.',
    ),
    FieldSpec(
        name='row_spacing_m',
        kind=KIND_NUMBER,
        description=(
            'Distance between rows, in metres. Accepts row_spacing_cm / '
            'row_spacing_mm, which are converted to metres.'
        ),
        example=0.5,
        unit='m',
        dimension=DIMENSION_LENGTH,
        hard_min=0,
        hard_max=3.0,
        exclusive_min=True,
        warn_min=0.05,
        warn_max=1.5,
        input_aliases=_length_aliases('row_spacing'),
    ),
    FieldSpec(
        name='distance_within_row_m',
        kind=KIND_NUMBER,
        description=(
            'Distance between plants within one row, in metres. Accepts '
            'distance_within_row_cm / _mm, which are converted to metres.'
        ),
        example=0.4,
        unit='m',
        dimension=DIMENSION_LENGTH,
        hard_min=0,
        hard_max=3.0,
        exclusive_min=True,
        warn_min=0.01,
        warn_max=1.5,
        input_aliases=_length_aliases('distance_within_row'),
    ),
    FieldSpec(
        name='sowing_depth_m',
        kind=KIND_NUMBER,
        description=(
            'Sowing depth, in metres. Accepts sowing_depth_cm / _mm, which are '
            'converted to metres.'
        ),
        example=0.02,
        unit='m',
        dimension=DIMENSION_LENGTH,
        hard_min=0,
        hard_max=0.5,
        warn_min=0.002,
        warn_max=0.15,
        input_aliases=_length_aliases('sowing_depth'),
    ),
    FieldSpec(
        name='seed_rate_direct_value',
        kind=KIND_NUMBER,
        description=(
            'Seed rate for direct sowing. Meaningless on its own — '
            'seed_rate_direct_unit must be sent with it.'
        ),
        example=1.5,
        hard_min=0,
        hard_max=100000,
        exclusive_min=True,
        input_aliases={'seed_rate_direct_value': None},
        requires='seed_rate_direct_unit',
    ),
    FieldSpec(
        name='seed_rate_direct_unit',
        kind=KIND_ENUM,
        description='Unit of seed_rate_direct_value.',
        example=SEED_RATE_UNIT_G_PER_M2,
        enum_values=SEED_RATE_UNIT_VALUES,
        input_aliases={'seed_rate_direct_unit': None},
        requires='seed_rate_direct_value',
    ),
    FieldSpec(
        name='seed_rate_pre_cultivation_value',
        kind=KIND_NUMBER,
        description=(
            'Seed rate for pre-cultivation. Meaningless on its own — '
            'seed_rate_pre_cultivation_unit must be sent with it.'
        ),
        example=2.0,
        hard_min=0,
        hard_max=100000,
        exclusive_min=True,
        input_aliases={'seed_rate_pre_cultivation_value': None},
        requires='seed_rate_pre_cultivation_unit',
    ),
    FieldSpec(
        name='seed_rate_pre_cultivation_unit',
        kind=KIND_ENUM,
        description='Unit of seed_rate_pre_cultivation_value.',
        example=SEED_RATE_UNIT_SEEDS_PER_PLANT,
        enum_values=SEED_RATE_UNIT_VALUES,
        input_aliases={'seed_rate_pre_cultivation_unit': None},
        requires='seed_rate_pre_cultivation_value',
    ),
    FieldSpec(
        name='sowing_calculation_safety_percent_direct',
        kind=KIND_NUMBER,
        description='Safety margin added to direct-sowing seed demand, in percent.',
        example=10,
        unit='percent',
        hard_min=0,
        hard_max=100,
        warn_max=50,
        input_aliases={'sowing_calculation_safety_percent_direct': None},
    ),
    FieldSpec(
        name='sowing_calculation_safety_percent_pre_cultivation',
        kind=KIND_NUMBER,
        description='Safety margin added to pre-cultivation seed demand, in percent.',
        example=15,
        unit='percent',
        hard_min=0,
        hard_max=100,
        warn_max=50,
        input_aliases={'sowing_calculation_safety_percent_pre_cultivation': None},
    ),
    FieldSpec(
        name='thousand_kernel_weight_g',
        kind=KIND_NUMBER,
        description=(
            'Weight of 1000 seeds, in grams. Used to convert between gram- and '
            'seed-based seed demand.'
        ),
        example=3.5,
        unit='g',
        hard_min=0,
        hard_max=2000,
        exclusive_min=True,
        warn_min=0.05,
        warn_max=500,
        input_aliases={'thousand_kernel_weight_g': None, 'tkg': None},
    ),
    FieldSpec(
        name='display_color',
        kind=KIND_COLOR,
        description='Calendar colour as a #RRGGBB hex string.',
        example='#4CAF50',
        input_aliases={'display_color': None},
    ),
)

CROP_FIELD_SPECS_BY_NAME: dict[str, FieldSpec] = {
    spec.name: spec for spec in CROP_FIELD_SPECS
}


def build_input_key_index() -> dict[str, tuple[FieldSpec, str | None]]:
    """Map every accepted input key to its spec and the unit that key implies.

    :return: Mapping of lowercase input key to ``(spec, implied_unit)``.
    """
    index: dict[str, tuple[FieldSpec, str | None]] = {}
    for spec in CROP_FIELD_SPECS:
        for key, implied_unit in spec.input_aliases.items():
            index[key.lower()] = (spec, implied_unit)
    return index


INPUT_KEY_INDEX = build_input_key_index()

# Identity fields: the trio that decides whether an import row refers to an
# already-existing crop. Mirrors the database's own uniqueness constraint
# (`unique_crop_normalized`), which is what makes repeated imports converge
# on the same row instead of creating duplicates.
IDENTITY_FIELDS = ('name', 'variety', 'supplier_name')
