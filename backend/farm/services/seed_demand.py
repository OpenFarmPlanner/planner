"""Seed demand calculation.

For every crop with at least one planting plan in a project, computes the
total seed requirement across all its plans (rate x area / lfm / plant count,
plus a per-cultivation-type safety margin and an optional germination-rate
adjustment), normalizes it to grams via thousand-kernel-weight (TKG), and
suggests a package combination from the selected supplier's packaging sizes.

The step-by-step calculation, worked examples, and edge cases are documented
in docs/seed-demand-calculation.md - keep that file in sync when changing
behavior here. The HTTP layer (request parsing, serialization, the supplier
selection POST) lives in farm.crops.views.SeedDemandListView.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from farm.models import Crop, CropSupplierData, PlantingPlan, Project
from farm.seed_units import (
    SEED_PACKAGE_UNIT_GRAMS,
    SEED_PACKAGE_UNIT_SEEDS,
    SEED_RATE_UNIT_G_PER_LFM,
    SEED_RATE_UNIT_G_PER_M2,
    SEED_RATE_UNIT_SEEDS_PER_LFM,
    SEED_RATE_UNIT_SEEDS_PER_M2,
    SEED_RATE_UNIT_SEEDS_PER_PLANT,
    are_units_convertible,
    grams_to_seeds,
    seeds_to_grams,
)
from farm.services.crop_display import resolve_crop_display_name
from farm.services.seed_packages import PackageOption, compute_seed_package_suggestion

REQUIRED_AMOUNT_WARNING_MISSING_TKG = 'missing_tkg'

CALCULATION_BLOCKER_MISSING_SEED_RATE = 'missing_seed_rate'
CALCULATION_BLOCKER_MISSING_AREA = 'missing_area'
CALCULATION_BLOCKER_MISSING_ROW_SPACING = 'missing_row_spacing'
CALCULATION_BLOCKER_MISSING_PLANT_QUANTITY = 'missing_plant_quantity'
CALCULATION_BLOCKER_MISSING_TKG = 'missing_tkg'
CALCULATION_BLOCKER_UNSUPPORTED_SEED_RATE_UNIT = 'unsupported_seed_rate_unit'

PACKAGE_BLOCKER_REQUIRED_AMOUNT_UNAVAILABLE = 'required_amount_unavailable'
PACKAGE_BLOCKER_SUPPLIER_DATA_MISSING = 'supplier_data_missing'
PACKAGE_BLOCKER_SUPPLIER_NOT_SELECTED = 'supplier_not_selected'
PACKAGE_BLOCKER_PACKAGE_SIZES_MISSING = 'package_sizes_missing'
PACKAGE_BLOCKER_UNIT_CONVERSION_UNAVAILABLE = 'unit_conversion_unavailable'
PACKAGE_BLOCKER_NO_MATCHING_PACKAGE_SIZES = 'no_matching_package_sizes'


@dataclass(frozen=True)
class PlanRequirementResult:
    value: Decimal | None
    unit: str | None
    blockers: tuple[str, ...] = ()
    warning: str | None = None


def parse_selected_suppliers(raw_value: str | None) -> dict[int, int]:
    """Parse the ``supplier_selection`` query param (``cropId:supplierId,...``)."""
    selected: dict[int, int] = {}
    if not raw_value:
        return selected
    for item in raw_value.split(','):
        if ':' not in item:
            continue
        crop_raw, supplier_raw = item.split(':', 1)
        try:
            crop_id = int(crop_raw.strip())
            supplier_id = int(supplier_raw.strip())
        except (TypeError, ValueError):
            continue
        if crop_id > 0 and supplier_id > 0:
            selected[crop_id] = supplier_id
    return selected


def _cultivation_type_specific_rate(
    crop: Crop,
    cultivation_type: str | None,
) -> tuple[Decimal | None, str | None]:
    """Rate from the explicit per-cultivation-type fields, if fully set."""
    if (
        cultivation_type == 'direct_sowing'
        and crop.seed_rate_direct_value is not None
        and crop.seed_rate_direct_unit
    ):
        return Decimal(str(crop.seed_rate_direct_value)), crop.seed_rate_direct_unit
    if (
        cultivation_type == 'pre_cultivation'
        and crop.seed_rate_pre_cultivation_value is not None
        and crop.seed_rate_pre_cultivation_unit
    ):
        return (
            Decimal(str(crop.seed_rate_pre_cultivation_value)),
            crop.seed_rate_pre_cultivation_unit,
        )
    return None, None


def _rate_from_cultivation_map(
    crop: Crop,
    cultivation_type: str | None,
) -> tuple[Decimal | None, str | None]:
    """Rate from the ``seed_rate_by_cultivation`` JSON map, if valid."""
    if cultivation_type and isinstance(crop.seed_rate_by_cultivation, dict):
        payload = crop.seed_rate_by_cultivation.get(cultivation_type)
        if isinstance(payload, dict):
            value = payload.get('value')
            unit = payload.get('unit')
            if isinstance(value, int | float | str) and unit:
                return Decimal(str(value)), str(unit)
    return None, None


def select_seed_rate(
    crop: Crop,
    cultivation_type: str | None,
) -> tuple[Decimal | None, str | None]:
    """Pick the seed rate for a plan's cultivation type.

    Precedence: the cultivation-type-specific fields (direct sowing /
    pre-cultivation), then the ``seed_rate_by_cultivation`` JSON map, then the
    legacy single rate field. A plan whose cultivation type is set but not
    among the crop's enabled ``cultivation_types`` gets no rate at all.
    """
    active_types = set(crop.cultivation_types or [])
    if cultivation_type and active_types and cultivation_type not in active_types:
        return None, None
    value, unit = _cultivation_type_specific_rate(crop, cultivation_type)
    if value is not None:
        return value, unit
    value, unit = _rate_from_cultivation_map(crop, cultivation_type)
    if value is not None:
        return value, unit
    if crop.seed_rate_value is None or not crop.seed_rate_unit:
        return None, None
    return Decimal(str(crop.seed_rate_value)), crop.seed_rate_unit


def select_safety_margin_percent(crop: Crop, cultivation_type: str | None) -> Decimal:
    """Pick the safety-margin percentage with the same per-cultivation-type
    precedence as :func:`select_seed_rate`."""
    active_types = set(crop.cultivation_types or [])
    if cultivation_type and active_types and cultivation_type not in active_types:
        return Decimal('0')
    if (
        cultivation_type == 'direct_sowing'
        and crop.sowing_calculation_safety_percent_direct is not None
    ):
        return Decimal(str(crop.sowing_calculation_safety_percent_direct))
    if (
        cultivation_type == 'pre_cultivation'
        and crop.sowing_calculation_safety_percent_pre_cultivation is not None
    ):
        return Decimal(str(crop.sowing_calculation_safety_percent_pre_cultivation))
    return Decimal(str(crop.sowing_calculation_safety_percent or 0))


def convert_requirement_to_unit(
    *,
    requirement_value: Decimal,
    requirement_unit: str,
    target_unit: str,
    tkg: Decimal | None,
) -> tuple[Decimal | None, str | None]:
    """Convert between grams and seed count via TKG; returns (value, warning)."""
    if requirement_unit == target_unit:
        return requirement_value, None
    if not tkg or tkg <= 0:
        return None, 'Missing thousand-kernel weight for unit conversion.'
    if not are_units_convertible(requirement_unit, target_unit):
        return None, 'Cannot convert between required amount and package unit.'
    if requirement_unit == SEED_PACKAGE_UNIT_SEEDS and target_unit == SEED_PACKAGE_UNIT_GRAMS:
        return seeds_to_grams(requirement_value, tkg), None
    if requirement_unit == SEED_PACKAGE_UNIT_GRAMS and target_unit == SEED_PACKAGE_UNIT_SEEDS:
        return grams_to_seeds(requirement_value, tkg), None
    return None, 'Cannot convert between required amount and package unit.'


def get_required_amount_in_unit(
    *,
    amounts_by_unit: dict[str, Decimal],
    target_unit: str,
    tkg: Decimal | None,
) -> tuple[Decimal | None, str | None]:
    """Sum per-unit amounts into ``target_unit``, converting via TKG where needed."""
    total = amounts_by_unit.get(target_unit, Decimal('0'))
    for source_unit, source_amount in amounts_by_unit.items():
        if source_unit == target_unit or source_amount <= 0:
            continue
        converted, conversion_warning = convert_requirement_to_unit(
            requirement_value=source_amount,
            requirement_unit=source_unit,
            target_unit=target_unit,
            tkg=tkg,
        )
        if converted is None:
            if {source_unit, target_unit} == {SEED_PACKAGE_UNIT_SEEDS, SEED_PACKAGE_UNIT_GRAMS}:
                return None, REQUIRED_AMOUNT_WARNING_MISSING_TKG
            return None, conversion_warning
        total += converted
    return total, None


def select_tkg(
    crop_tkg: Decimal | None,
    selected_supplier: CropSupplierData | None,
) -> Decimal | None:
    """The selected supplier's TKG overrides the crop's own TKG."""
    if selected_supplier and selected_supplier.thousand_kernel_weight_g:
        return Decimal(str(selected_supplier.thousand_kernel_weight_g))
    return crop_tkg


def apply_germination_rate(
    amounts_by_unit: dict[str, Decimal],
    germination_rate: float | None,
) -> dict[str, Decimal]:
    """Inflate raw seed-amount requirements to account for expected
    germination loss: a germination_rate of e.g. 80 means only 80% of
    sown seed is expected to produce a viable plant, so the raw
    requirement is scaled up by 100/germination_rate to still end up with
    enough plants. An unknown, zero, or out-of-range rate (the model only
    validates 0-100) leaves amounts unadjusted rather than raising, since
    germination_rate is optional per-supplier data. See
    docs/seed-demand-calculation.md.
    """
    if germination_rate is None or germination_rate <= 0 or germination_rate > 100:
        return amounts_by_unit
    factor = Decimal('100') / Decimal(str(germination_rate))
    return {unit: amount * factor for unit, amount in amounts_by_unit.items()}


def _m2_based_requirement(
    unit: str,
    value: Decimal,
    area: Decimal,
) -> PlanRequirementResult:
    if area <= 0:
        return PlanRequirementResult(
            value=None,
            unit=None,
            blockers=(CALCULATION_BLOCKER_MISSING_AREA,),
            warning='Missing area usage for m²-based seed requirement.',
        )
    amount_unit = (
        SEED_PACKAGE_UNIT_GRAMS if unit == SEED_RATE_UNIT_G_PER_M2 else SEED_PACKAGE_UNIT_SEEDS
    )
    return PlanRequirementResult(value=area * value, unit=amount_unit)


def _lfm_based_requirement(
    unit: str,
    value: Decimal,
    area: Decimal,
    row_spacing: Decimal,
) -> PlanRequirementResult:
    blockers: list[str] = []
    if area <= 0:
        blockers.append(CALCULATION_BLOCKER_MISSING_AREA)
    if row_spacing <= 0:
        blockers.append(CALCULATION_BLOCKER_MISSING_ROW_SPACING)
    if blockers:
        warning = (
            'Missing area usage for lfm-based seed requirement.'
            if blockers[0] == CALCULATION_BLOCKER_MISSING_AREA
            else 'Missing row spacing for lfm-based seed requirement.'
        )
        return PlanRequirementResult(
            value=None,
            unit=None,
            blockers=tuple(blockers),
            warning=warning,
        )
    lfm = area / row_spacing
    amount_unit = (
        SEED_PACKAGE_UNIT_GRAMS if unit == SEED_RATE_UNIT_G_PER_LFM else SEED_PACKAGE_UNIT_SEEDS
    )
    return PlanRequirementResult(value=lfm * value, unit=amount_unit)


def compute_plan_requirement(plan: PlantingPlan) -> PlanRequirementResult:
    """Compute one plan's raw seed requirement and stable blocker diagnostics."""
    value, unit = select_seed_rate(plan.crop, plan.cultivation_type)
    if value is None or not unit or value <= 0:
        return PlanRequirementResult(
            value=None,
            unit=None,
            blockers=(CALCULATION_BLOCKER_MISSING_SEED_RATE,),
            warning='Missing seed rate value or unit.',
        )

    area = Decimal(str(plan.area_usage_sqm or 0))
    quantity = Decimal(str(plan.quantity or 0))
    row_spacing = Decimal(str(plan.crop.row_spacing_m or 0))

    if unit in {SEED_RATE_UNIT_G_PER_M2, SEED_RATE_UNIT_SEEDS_PER_M2}:
        return _m2_based_requirement(unit, value, area)

    if unit in {SEED_RATE_UNIT_G_PER_LFM, SEED_RATE_UNIT_SEEDS_PER_LFM}:
        return _lfm_based_requirement(unit, value, area, row_spacing)

    if unit == SEED_RATE_UNIT_SEEDS_PER_PLANT:
        if quantity <= 0:
            return PlanRequirementResult(
                value=None,
                unit=None,
                blockers=(CALCULATION_BLOCKER_MISSING_PLANT_QUANTITY,),
                warning='Missing plant quantity for seeds-per-plant requirement.',
            )
        return PlanRequirementResult(value=quantity * value, unit=SEED_PACKAGE_UNIT_SEEDS)

    return PlanRequirementResult(
        value=None,
        unit=None,
        blockers=(CALCULATION_BLOCKER_UNSUPPORTED_SEED_RATE_UNIT,),
        warning='Unsupported seed rate unit.',
    )


def _aggregate_requirements_by_crop(
    project: Project, language_code: str, season_id: int | None = None,
) -> dict[int, dict]:
    """Group all of a project's plans by crop and sum margin-adjusted
    requirements into per-unit buckets (grams and seeds separately)."""
    plans = (
        PlantingPlan.objects
        # Draft plans without a crop chosen yet can't contribute to a
        # per-crop seed requirement — exclude them rather than crashing.
        .filter(project=project, crop__isnull=False)
        # Bought-in young plants need no seed of our own; they are listed in
        # the young-plant demand instead (farm.services.young_plant_demand).
        .exclude(cultivation_type=PlantingPlan.CULTIVATION_TYPE_PURCHASED_TRANSPLANT)
        .select_related(
            'crop',
            'crop__crop_species',
            'crop__supplier',
            'crop__selected_seed_demand_supplier',
        )
        .prefetch_related('crop__crop_species__translations')
        .order_by('crop__name', 'crop__variety')
    )
    if season_id is not None:
        plans = plans.filter(season_id=season_id)
    grouped: dict[int, dict] = {}
    for plan in plans:
        crop = plan.crop
        crop_display_name, crop_display_language_code = resolve_crop_display_name(
            crop,
            language_code,
            project.region,
        )
        entry = grouped.setdefault(
            crop.id,
            {
                'crop_id': crop.id,
                'crop_name': crop.name,
                'crop_display_name': crop_display_name,
                'crop_display_language_code': crop_display_language_code,
                'variety': crop.variety,
                'supplier': (
                    crop.supplier.name if crop.supplier else (crop.seed_supplier or '')
                ),
                'required_amount_by_unit': {
                    SEED_PACKAGE_UNIT_GRAMS: Decimal('0'),
                    SEED_PACKAGE_UNIT_SEEDS: Decimal('0'),
                },
                'warning': None,
                'calculation_blockers': [],
                'tkg': (
                    Decimal(str(crop.thousand_kernel_weight_g))
                    if crop.thousand_kernel_weight_g
                    else None
                ),
                'crop': crop,
            },
        )
        # A failed plan invalidates the crop total. Later plans are still
        # inspected for additional blockers, but successful values are not
        # accumulated into a misleading partial total.
        result = compute_plan_requirement(plan)
        if result.blockers:
            for blocker in result.blockers:
                if blocker not in entry['calculation_blockers']:
                    entry['calculation_blockers'].append(blocker)
            entry['warning'] = (
                entry['warning'] or result.warning or 'Seed requirement could not be calculated.'
            )
            continue
        if entry['warning'] or result.value is None or not result.unit:
            continue
        margin_factor = Decimal('1') + (
            select_safety_margin_percent(crop, plan.cultivation_type) / Decimal('100')
        )
        entry['required_amount_by_unit'][result.unit] += result.value * margin_factor
    return grouped


def _resolve_selected_supplier(
    *,
    crop: Crop,
    supplier_options: list[CropSupplierData],
    requested_supplier_id: int | None,
) -> CropSupplierData | None:
    """Resolve the supplier whose data drives the calculation.

    Precedence: explicit request (query param) > persisted
    ``selected_seed_demand_supplier`` > auto-pick when there is exactly one
    option (display-only, never persisted).
    """
    selected_supplier_id = requested_supplier_id
    if selected_supplier_id is None:
        selected_supplier_id = crop.selected_seed_demand_supplier_id
    if selected_supplier_id:
        selected = next(
            (item for item in supplier_options if item.supplier_id == selected_supplier_id),
            None,
        )
        if selected is not None:
            return selected
    if len(supplier_options) == 1:
        return supplier_options[0]
    return None


def _valid_packages(selected_supplier: CropSupplierData | None) -> list[dict]:
    packages: list[dict] = []
    for item in (selected_supplier.packaging_sizes if selected_supplier else None) or []:
        if not isinstance(item, dict):
            continue
        size_value = item.get('size_value')
        size_unit = item.get('size_unit')
        if not isinstance(size_value, int | float) or size_unit not in {
            SEED_PACKAGE_UNIT_GRAMS,
            SEED_PACKAGE_UNIT_SEEDS,
        }:
            continue
        packages.append({'size_value': float(size_value), 'size_unit': size_unit})
    return packages


def _supplier_options_by_crop(
    project: Project,
    crop_ids: list[int],
) -> dict[int, list[CropSupplierData]]:
    """Load each crop's supplier-data rows, ordered by supplier name."""
    supplier_rows = (
        CropSupplierData.objects
        .filter(project=project, crop_id__in=crop_ids)
        .select_related('supplier')
        .order_by('crop_id', 'supplier__name')
    )
    suppliers_map: dict[int, list[CropSupplierData]] = defaultdict(list)
    for supplier_row in supplier_rows:
        suppliers_map[supplier_row.crop_id].append(supplier_row)
    return suppliers_map


def _base_row(
    *,
    entry: dict,
    supplier_options: list[CropSupplierData],
    selected_supplier: CropSupplierData | None,
    display_required_amount: Decimal | None,
    required_amount_warning: str | None,
    has_required_amount: bool,
    packages: list[dict],
) -> dict:
    """Build one crop's display row without any package suggestion yet."""
    row = {
        'crop_id': entry['crop_id'],
        'crop_name': entry['crop_name'],
        'crop_display_name': entry['crop_display_name'],
        'crop_display_language_code': entry['crop_display_language_code'],
        'variety': entry['variety'],
        'supplier': (
            selected_supplier.supplier.name
            if selected_supplier and selected_supplier.supplier
            else (selected_supplier.supplier_name if selected_supplier else '')
        ),
        'selected_supplier_id': selected_supplier.supplier_id if selected_supplier else None,
        'supplier_options': [
            {
                'supplier_id': item.supplier_id,
                'supplier_name': item.supplier.name if item.supplier else item.supplier_name,
            }
            for item in supplier_options
        ],
        'required_amount_value': (
            float(display_required_amount.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))
            if display_required_amount is not None
            else None
        ),
        'required_amount_unit': SEED_PACKAGE_UNIT_GRAMS if has_required_amount else None,
        'required_amount_warning': required_amount_warning,
        'calculation_blockers': list(entry['calculation_blockers']),
        'total_grams': (
            float(display_required_amount.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))
            if display_required_amount is not None
            else None
        ),
        'seed_packages': packages,
        'package_suggestion': None,
        'package_blocker': None,
        'packages_needed': None,
        'warning': entry['warning'],
    }
    if not supplier_options:
        row['warning'] = row['warning'] or 'Keine Lieferantendaten vorhanden.'
    return row


def _attach_package_suggestion(
    row: dict,
    *,
    germination_adjusted_amounts: dict[str, Decimal],
    selected_tkg: Decimal | None,
    packages: list[dict],
) -> None:
    """Compute the package suggestion for a row and attach it in place.

    Prefers gram-sized packages when both units are offered; sets the row's
    warning instead when the required amount cannot be converted to the
    package unit.
    """
    target_unit = (
        SEED_PACKAGE_UNIT_GRAMS
        if any(pkg['size_unit'] == SEED_PACKAGE_UNIT_GRAMS for pkg in packages)
        else packages[0]['size_unit']
    )
    same_unit_packages = [pkg for pkg in packages if pkg['size_unit'] == target_unit]
    target_amount, conversion_warning = get_required_amount_in_unit(
        amounts_by_unit=germination_adjusted_amounts,
        target_unit=target_unit,
        tkg=selected_tkg,
    )
    if target_amount is None:
        row['warning'] = (
            conversion_warning or 'Cannot convert required amount to package units.'
        )
        row['package_blocker'] = PACKAGE_BLOCKER_UNIT_CONVERSION_UNAVAILABLE
        return

    suggestion = compute_seed_package_suggestion(
        required_amount=target_amount,
        packages=[
            PackageOption(
                size_value=Decimal(str(pkg['size_value'])),
                size_unit=pkg['size_unit'],
            )
            for pkg in same_unit_packages
        ],
        unit=target_unit,
    )
    if suggestion.pack_count > 0:
        row['package_suggestion'] = {
            'selection': [
                {
                    'size_value': float(item.size_value),
                    'size_unit': item.size_unit,
                    'count': item.count,
                }
                for item in suggestion.selection
            ],
            'total_amount': float(suggestion.total_amount),
            'overage': float(suggestion.overage),
            'pack_count': suggestion.pack_count,
            'unit': target_unit,
        }
        row['packages_needed'] = suggestion.pack_count


def build_seed_demand_rows(
    *,
    project: Project,
    selected_supplier_by_crop: dict[int, int],
    language_code: str,
    season_id: int | None = None,
) -> list[dict]:
    """Build the display-ready seed-demand rows for a project, one per crop.

    Scoped to `season_id` when given, matching the active-season header the
    planting-plans list endpoint scopes by — see
    docs/seasons-architecture.md.
    """
    grouped = _aggregate_requirements_by_crop(project, language_code, season_id)
    suppliers_map = _supplier_options_by_crop(project, list(grouped.keys()))

    rows: list[dict] = []
    for crop_id, entry in grouped.items():
        required_amounts_by_unit = entry['required_amount_by_unit']
        has_required_amount = any(amount > 0 for amount in required_amounts_by_unit.values())
        supplier_options = suppliers_map.get(crop_id, [])
        selected_supplier = _resolve_selected_supplier(
            crop=entry['crop'],
            supplier_options=supplier_options,
            requested_supplier_id=selected_supplier_by_crop.get(crop_id),
        )

        selected_tkg = select_tkg(entry['tkg'], selected_supplier)
        germination_rate = selected_supplier.germination_rate if selected_supplier else None
        germination_adjusted_amounts = apply_germination_rate(
            required_amounts_by_unit, germination_rate,
        )
        display_required_amount, required_amount_warning = get_required_amount_in_unit(
            amounts_by_unit=germination_adjusted_amounts,
            target_unit=SEED_PACKAGE_UNIT_GRAMS,
            tkg=selected_tkg,
        )
        if entry['calculation_blockers']:
            display_required_amount = None
            required_amount_warning = None
        elif required_amount_warning == REQUIRED_AMOUNT_WARNING_MISSING_TKG:
            entry['calculation_blockers'].append(CALCULATION_BLOCKER_MISSING_TKG)
        packages = _valid_packages(selected_supplier)
        row = _base_row(
            entry=entry,
            supplier_options=supplier_options,
            selected_supplier=selected_supplier,
            display_required_amount=display_required_amount,
            required_amount_warning=required_amount_warning,
            has_required_amount=has_required_amount,
            packages=packages,
        )
        if not entry['warning'] and has_required_amount and packages:
            _attach_package_suggestion(
                row,
                germination_adjusted_amounts=germination_adjusted_amounts,
                selected_tkg=selected_tkg,
                packages=packages,
            )
        if row['package_suggestion'] is None and row['package_blocker'] is None:
            if row['calculation_blockers']:
                row['package_blocker'] = PACKAGE_BLOCKER_REQUIRED_AMOUNT_UNAVAILABLE
            elif not supplier_options:
                row['package_blocker'] = PACKAGE_BLOCKER_SUPPLIER_DATA_MISSING
            elif selected_supplier is None:
                row['package_blocker'] = PACKAGE_BLOCKER_SUPPLIER_NOT_SELECTED
            elif not packages:
                row['package_blocker'] = PACKAGE_BLOCKER_PACKAGE_SIZES_MISSING
            else:
                row['package_blocker'] = PACKAGE_BLOCKER_NO_MATCHING_PACKAGE_SIZES
        rows.append(row)

    rows.sort(key=lambda item: (item['crop_display_name'] or item['crop_name'] or '', item['variety'] or ''))
    return rows
