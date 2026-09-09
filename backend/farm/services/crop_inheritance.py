"""Effective crop values for Sorten that inherit from their general Kultur.

A project holds one general Kultur per crop species (a ``Crop`` row with
``crop_species`` set and an empty ``variety``) plus any number of Sorten (rows
with the same ``crop_species`` and a variety). A Sorte only stores the values it
actually overrides; every field it leaves unset falls back to the general
Kultur's value. This module owns that fallback so the API, the planning
calculations and the crop-library UI all resolve it the same way.

Free-text Sorten (no ``crop_species``) have no general Kultur to fall back to
and therefore always resolve to their own values.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from django.db.models import Q
from django.utils import timezone

from farm.models import Crop
from farm.models.crops import compute_plants_per_m2

# Crop fields a Sorte inherits from its general Kultur. Kept in sync with the
# frontend's `VARIETY_INHERITABLE_FIELDS` (frontend/src/crops/varietyValueSource.ts),
# which prefills a new Sorte from the same set, with one deliberate difference:
#
# - The legacy `seed_rate_value`/`seed_rate_unit` pair and the derived
#   `seed_rate_by_cultivation` map are left out: the latter is validated as a
#   subset of the row's own `cultivation_types`, so inheriting it independently
#   could produce a combination the model itself rejects.
#
# Names are model field names; distances are the SI (meter) fields.
CROP_INHERITABLE_FIELDS: tuple[str, ...] = (
    'crop_family',
    'nutrient_demand',
    'rotation_break_years',
    'cultivation_type',
    'cultivation_types',
    'growth_duration_days',
    'harvest_duration_days',
    'propagation_duration_days',
    'harvest_method',
    'expected_yield',
    'distance_within_row_m',
    'row_spacing_m',
    'sowing_depth_m',
    'sowing_calculation_safety_percent',
    'sowing_calculation_safety_percent_direct',
    'sowing_calculation_safety_percent_pre_cultivation',
    'thousand_kernel_weight_g',
    'seeding_requirement',
    'seeding_requirement_type',
    'seed_rate_direct_value',
    'seed_rate_direct_unit',
    'seed_rate_pre_cultivation_value',
    'seed_rate_pre_cultivation_unit',
)

CROP_SPECIES_INVARIANT_FIELDS: tuple[str, ...] = (
    'crop_family',
    'nutrient_demand',
    'rotation_break_years',
)

# The stored "no value" for each field in CROP_SPECIES_INVARIANT_FIELDS.
# ``crop_family`` and ``nutrient_demand`` are non-nullable ``CharField``s, so
# their empty state is the blank string, not ``NULL``.
SPECIES_INVARIANT_UNSET_VALUES: dict[str, Any] = {
    'crop_family': '',
    'nutrient_demand': '',
    'rotation_break_years': None,
}

CROP_OPTIONAL_GENERAL_COPY_FIELDS: tuple[str, ...] = (
    'growth_duration_days',
    'harvest_duration_days',
    'propagation_duration_days',
    'harvest_method',
    'expected_yield',
    'distance_within_row_m',
    'row_spacing_m',
    'sowing_depth_m',
    'sowing_calculation_safety_percent',
    'sowing_calculation_safety_percent_direct',
    'sowing_calculation_safety_percent_pre_cultivation',
    'thousand_kernel_weight_g',
    'seeding_requirement',
    'seeding_requirement_type',
    'seed_rate_direct_value',
    'seed_rate_direct_unit',
    'seed_rate_pre_cultivation_value',
    'seed_rate_pre_cultivation_unit',
)

# Legacy placeholder some seed-rate unit columns still carry; treated as unset.
_EMPTY_UNIT_PLACEHOLDER = '-'

_UNRESOLVED = object()

GeneralCropIndex = dict[int, Crop]


def ensure_general_crop_for_variety(
    variety: Crop,
    *,
    copy_values: bool = False,
) -> Crop | None:
    """Ensure a linked Sorte has a general Kultur and seed explicitly requested gaps.

    Values are promoted only through the explicit create-time copy choice.
    Routine Sorte writes must not silently move raw values to another row.
    """
    if not inherits_from_general_crop(variety):
        return None

    fields_to_copy = CROP_OPTIONAL_GENERAL_COPY_FIELDS if copy_values else ()
    general_row_q = Q(variety_normalized__isnull=True) | Q(variety_normalized='')
    general = (
        Crop.objects
        .filter(
            general_row_q,
            project_id=variety.project_id,
            crop_species_id=variety.crop_species_id,
        )
        .order_by('pk')
        .first()
    )
    if general is None:
        # unique_general_crop_name_per_project scopes by name alone, not by
        # crop_species, so a general Kultur for an unrelated species can already
        # own this name. Creating one here would collide with that constraint;
        # skip auto-creation instead of failing the variety save over a name
        # that isn't this variety's to claim.
        name_taken_by_other_species = (
            Crop.objects
            .filter(
                general_row_q,
                project_id=variety.project_id,
                name_normalized=variety.name_normalized,
            )
            .exclude(crop_species_id=variety.crop_species_id)
            .exists()
        )
        if name_taken_by_other_species:
            return None
        defaults: dict[str, Any] = {
            field: getattr(variety, field)
            for field in fields_to_copy
            if not is_unset_crop_value(getattr(variety, field))
        }
        return Crop.objects.create(
            project_id=variety.project_id,
            crop_species_id=variety.crop_species_id,
            name=variety.name,
            variety='',
            **defaults,
        )

    changed_fields: list[str] = []
    for field in fields_to_copy:
        general_value = getattr(general, field)
        variety_value = getattr(variety, field)
        if is_unset_crop_value(general_value) and not is_unset_crop_value(variety_value):
            setattr(general, field, variety_value)
            changed_fields.append(field)
    if changed_fields:
        general.save(update_fields=changed_fields)
    return general


def clear_species_invariant_overrides(crop: Crop) -> list[str]:
    """Explicitly drop raw species-invariant values stored on a linked Sorte.

    These fields belong to the general Kultur; a value on the Sorte is never
    read (see :func:`forces_species_invariant_inheritance`) and would only be
    dead weight. Free-text Sorten and general Kulturen are left untouched
    (nothing to inherit from).

    This helper is reserved for explicit maintenance operations. Normal API
    writes reject these values rather than calling it as silent data hygiene.
    Returns the field names that were reset, empty when there was nothing to do.
    """
    if not inherits_from_general_crop(crop):
        return []
    reset: dict[str, Any] = {
        field: unset_value
        for field, unset_value in SPECIES_INVARIANT_UNSET_VALUES.items()
        if not is_unset_crop_value(getattr(crop, field))
    }
    if not reset:
        return []
    if get_general_crop(crop) is None:
        return []
    Crop.objects.filter(pk=crop.pk).update(updated_at=timezone.now(), **reset)
    for field, unset_value in reset.items():
        setattr(crop, field, unset_value)
    return list(reset)


def sync_crop_species_across_crop_group(crop: Crop) -> int:
    """Hand a crop's crop species to the species-less rows of its Kultur group.

    A Kultur group has no table of its own: its rows belong together through
    their ``crop_species`` as soon as one of them is linked to a species, and
    through their name while none is — the same grouping the frontend's
    ``getCropSpeciesKey`` and ``CropViewSet._rename_sibling_crops`` use.
    Linking a single Sorte to a species therefore splits its group in two: the
    linked Sorte on one side, the general Kultur and the remaining Sorten on
    the other, which shows up as two Kulturen of the same name in the crop
    tree and stops the Sorte from inheriting its general Kultur's values. Rows
    that already carry a *different* species are a deliberately separate group
    and stay untouched.

    Returns the number of rows that adopted the species. They are written
    through the queryset instead of ``save()`` on purpose: adopting the species
    keeps the group's existing identity intact rather than editing those rows,
    so it should neither record a history revision nor flag them as diverged
    from their public source.
    """
    if not crop.crop_species_id or not crop.name_normalized:
        return 0
    return (
        Crop.objects
        .filter(
            project_id=crop.project_id,
            name_normalized=crop.name_normalized,
            crop_species__isnull=True,
        )
        .exclude(pk=crop.pk)
        .update(crop_species_id=crop.crop_species_id, updated_at=timezone.now())
    )


def is_unset_crop_value(value: Any) -> bool:
    """Whether a crop field holds no value and may fall back to the Kultur.

    ``False`` and ``0`` are real values, not gaps — only ``None``, blank text and
    empty collections count as unset.
    """
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip() or value.strip() == _EMPTY_UNIT_PLACEHOLDER
    if isinstance(value, (list, tuple, dict, set)):
        return not value
    return False


def is_variety_crop(crop: Crop | None) -> bool:
    """Whether the row is a Sorte, i.e. carries a non-empty variety."""
    return bool(crop is not None and (crop.variety or '').strip())


def inherits_from_general_crop(crop: Crop | None) -> bool:
    """Whether the row is a Sorte that is linked to a crop species at all."""
    return is_variety_crop(crop) and bool(crop.crop_species_id)


def build_general_crop_index(project_id: int | None) -> GeneralCropIndex:
    """Map ``crop_species_id`` to the project's general Kultur for that species.

    One query for a whole page of crops, so serializers can resolve the
    fallback per row without an N+1. Ties (more than one varietyless row for the
    same species, which the UI does not create but the data model allows) are
    broken by the lowest primary key so the result stays stable.
    """
    if project_id is None:
        return {}
    general_crops = (
        Crop.objects
        .filter(project_id=project_id, crop_species__isnull=False, variety_normalized__isnull=True)
        # Descending, so the lowest primary key is the one left standing below.
        .order_by('-pk')
    )
    return {general.crop_species_id: general for general in general_crops}


def get_general_crop(
    crop: Crop | None,
    index: GeneralCropIndex | None = None,
) -> Crop | None:
    """The general Kultur a Sorte inherits from, or ``None``.

    Pass ``index`` (see :func:`build_general_crop_index`) when resolving many
    crops at once. Without it the lookup is a single query per crop, cached
    on the instance so repeated field resolution stays cheap.
    """
    if not inherits_from_general_crop(crop):
        return None
    if index is not None:
        # The index only holds varietyless rows, so a Sorte can never find itself.
        return index.get(crop.crop_species_id)

    cached = getattr(crop, '_resolved_general_crop', _UNRESOLVED)
    if cached is not _UNRESOLVED:
        return cached
    resolved = (
        Crop.objects
        .filter(
            project_id=crop.project_id,
            crop_species_id=crop.crop_species_id,
            variety_normalized__isnull=True,
        )
        .exclude(pk=crop.pk)
        .order_by('pk')
        .first()
    )
    crop._resolved_general_crop = resolved
    return resolved


def forces_species_invariant_inheritance(crop: Crop | None, field: str) -> bool:
    """Whether ``field`` on ``crop`` must come from the general Kultur, always.

    ``crop_family``, ``nutrient_demand`` and ``rotation_break_years`` describe
    the crop species, not a single variety. On a species-linked Sorte their
    effective value is therefore always the general Kultur's, and a raw value
    still stored on the Sorte (from before this rule, or written straight to the
    database) is ignored rather than treated as an override.
    """
    return field in CROP_SPECIES_INVARIANT_FIELDS and inherits_from_general_crop(crop)


def resolve_crop_field(
    crop: Crop | None,
    field: str,
    index: GeneralCropIndex | None = None,
) -> Any:
    """The effective value of ``field``: the Sorte's own value, else the Kultur's.

    The species-invariant fields are the exception: on a linked Sorte they
    always resolve to the general Kultur's value (or ``None`` when it has none),
    never to a leftover raw value on the Sorte itself.
    """
    if crop is None:
        return None
    own_value = getattr(crop, field)
    if field not in CROP_INHERITABLE_FIELDS:
        return own_value
    force_inherit = forces_species_invariant_inheritance(crop, field)
    if not force_inherit and not is_unset_crop_value(own_value):
        return own_value
    general_crop = get_general_crop(crop, index)
    if general_crop is None:
        return own_value
    general_value = getattr(general_crop, field)
    if force_inherit:
        return None if is_unset_crop_value(general_value) else general_value
    return own_value if is_unset_crop_value(general_value) else general_value


def build_inherited_crop_values(
    crop: Crop | None,
    index: GeneralCropIndex | None = None,
) -> dict[str, Any]:
    """Only the fields whose effective value comes from the general Kultur.

    Fields the Sorte sets itself are absent, so the caller can tell an inherited
    value from an own one per field. The species-invariant fields are always
    listed here for a linked Sorte (when the general Kultur has a value),
    regardless of any raw value still stored on the Sorte.
    """
    general_crop = get_general_crop(crop, index)
    if general_crop is None:
        return {}
    inherited: dict[str, Any] = {}
    for field in CROP_INHERITABLE_FIELDS:
        force_inherit = forces_species_invariant_inheritance(crop, field)
        if not force_inherit and not is_unset_crop_value(getattr(crop, field)):
            continue
        general_value = getattr(general_crop, field)
        if is_unset_crop_value(general_value):
            continue
        inherited[field] = general_value
    return inherited


def build_effective_crop_values(
    crop: Crop | None,
    index: GeneralCropIndex | None = None,
) -> dict[str, Any]:
    """The effective value of every inheritable field, own values included.

    A species-invariant field on a linked Sorte never falls back to the Sorte's
    raw value: it is the general Kultur's value or nothing.
    """
    if crop is None:
        return {}
    inherited = build_inherited_crop_values(crop, index)

    def effective(field: str) -> Any:
        if field in inherited:
            return inherited[field]
        if forces_species_invariant_inheritance(crop, field):
            return None
        return getattr(crop, field)

    return {field: effective(field) for field in CROP_INHERITABLE_FIELDS}


def resolve_plants_per_m2(
    crop: Crop | None,
    index: GeneralCropIndex | None = None,
) -> Decimal | None:
    """Plants per m² from the crop's effective spacing, not only its own."""
    if crop is None:
        return None
    return compute_plants_per_m2(
        resolve_crop_field(crop, 'row_spacing_m', index),
        resolve_crop_field(crop, 'distance_within_row_m', index),
    )
