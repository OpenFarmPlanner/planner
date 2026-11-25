"""Preview and apply one parcel-group step to unsaved planting plan copies."""

import json
from collections import defaultdict
from copy import copy
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from fractions import Fraction
from hashlib import sha256

from farm.models import Bed, PlantingPlan, Season
from farm.services.bed_capacity import (
    BedOccupancy,
    HarvestOverlapIndex,
    build_occupancy,
)
from farm.services.crop_inheritance import GeneralCropIndex, build_general_crop_index
from farm.services.crop_rotation import RotationService, preview_season_copy
from farm.services.parcel_rotation import ordered_group, rotation_group_queryset
from farm.services.plant_count import compute_plan_plant_count
from farm.services.seed_demand import preview_plan_seed_demand
from farm.services.tasks import plan_event_dates

PlanPair = tuple[PlantingPlan, PlantingPlan]
AREA_UNITS = 100


@dataclass
class AreaAllocation:
    source: PlantingPlan
    plan: PlantingPlan
    original_area: Decimal
    original_bed_area: Decimal
    raw_units: Fraction
    start: date
    end: date
    units: int


@dataclass
class ParcelRotationPreview:
    pairs: list[PlanPair]
    summary: dict


class ParcelRotationConflict(Exception):
    def __init__(self, summary: dict):
        super().__init__('Parcel rotation preview is invalid or has changed.')
        self.summary = summary


def _reference_area(source: PlantingPlan, source_bed: Bed) -> tuple[Decimal, Decimal]:
    """Keep the exact fraction across copies until the current assignment or area changes."""
    basis = source.parcel_rotation_basis
    if basis.get('bed_id') == source_bed.pk:
        try:
            matches = (
                Decimal(basis['last_area_sqm']) == source.area_usage_sqm
                and Decimal(basis['last_bed_area_sqm']) == source_bed.area_sqm
            )
            original_area = Decimal(basis['area_sqm'])
            original_bed_area = Decimal(basis['bed_area_sqm'])
            if (
                matches
                and original_area.is_finite()
                and original_area >= 0
                and original_bed_area.is_finite()
                and original_bed_area > 0
            ):
                return original_area, original_bed_area
        except (InvalidOperation, KeyError, TypeError, ValueError):
            pass
    return source.area_usage_sqm, source_bed.area_sqm


def _occupancy(
    plan: PlantingPlan, index: HarvestOverlapIndex, crops: GeneralCropIndex
) -> BedOccupancy:
    events = plan_event_dates(plan, crops)
    return build_occupancy(
        rule=index.rule,
        start=plan.planting_date,
        harvest_start=None if plan.clearing_date else events.get('harvest_start'),
        end=plan.clearing_date or events.get('harvest_end'),
        area_sqm=plan.area_usage_sqm,
    )


def _allocate_area(
    allocations: list[AreaAllocation],
    existing: tuple[BedOccupancy, ...],
    capacity: Decimal,
) -> bool:
    """Distribute hundredths deterministically without rounding a covered bed over capacity."""
    starts = {item.start for item in allocations}
    first, last = min(starts), max(item.end for item in allocations)
    days = sorted(starts | {item.start for item in existing if first <= item.start <= last})
    active = [[item for item in allocations if item.start <= day <= item.end] for day in days]
    limits = [
        int(
            (
                capacity
                - sum((item.area_sqm for item in existing if item.firmly_covers(day)), Decimal(0))
            )
            * AREA_UNITS
        )
        for day in days
    ]
    if any(
        sum((item.raw_units for item in items), Fraction()) > cap
        for items, cap in zip(active, limits, strict=True)
        if items
    ):
        return False
    totals = [sum(item.units for item in items) for items in active]
    desired = [round(sum((item.raw_units for item in items), Fraction())) for items in active]
    for item in sorted(allocations, key=lambda row: (row.units - row.raw_units, row.source.pk)):
        if item.units == item.raw_units:
            continue
        affected = [i for i, day in enumerate(days) if item.start <= day <= item.end]
        if all(totals[i] < limits[i] for i in affected) and any(
            totals[i] < desired[i] for i in affected
        ):
            item.units += 1
            for i in affected:
                totals[i] += 1
    return all(item.raw_units == 0 or item.units > 0 for item in allocations)


def _move_area(
    plan: PlantingPlan,
    bed: Bed,
    units: int,
    original_area: Decimal,
    original_bed_area: Decimal,
) -> None:
    plan.area_usage_sqm = Decimal(units) / AREA_UNITS
    plan.parcel_rotation_basis = {
        'bed_id': bed.pk,
        'area_sqm': str(original_area),
        'bed_area_sqm': str(original_bed_area),
        'last_area_sqm': str(plan.area_usage_sqm),
        'last_bed_area_sqm': str(bed.area_sqm),
    }


def _describe_move(
    source: PlantingPlan,
    plan: PlantingPlan,
    crop_index: GeneralCropIndex,
    requirement: tuple[Decimal | None, str | None],
) -> dict:
    events = plan_event_dates(plan, crop_index)
    return {
        'source_plan_id': source.pk,
        'crop': str(plan.crop) if plan.crop else '',
        'source_bed_id': source.bed_id,
        'source_bed': source.bed.name,
        'target_bed_id': plan.bed_id,
        'target_bed': plan.bed.name,
        'old_area_sqm': source.area_usage_sqm,
        'new_area_sqm': plan.area_usage_sqm,
        'old_plant_count': compute_plan_plant_count(source, crop_index).count,
        'new_plant_count': compute_plan_plant_count(plan, crop_index).count,
        'quantity_override': plan.quantity,
        'seed_requirement': requirement[0],
        'seed_unit': requirement[1],
        'planting_date': plan.planting_date,
        'harvest_date': events.get('harvest_start'),
        'harvest_end_date': events.get('harvest_end'),
        'planned_sowing_date': events.get('sowing'),
        'planned_propagation_start_date': events.get('propagation_start'),
        'clearing_date': plan.clearing_date,
    }


def _map_groups(project) -> tuple[dict[int, tuple[Bed, Bed]], list[dict], list[dict]]:
    beds: dict[int, tuple[Bed, Bed]] = {}
    mappings: list[dict] = []
    issues: list[dict] = []
    for model in rotation_group_queryset(project):
        group = ordered_group(model)
        if not group.has_equal_bed_counts:
            issues.append(
                {
                    'code': 'unequal_bed_counts',
                    'group': model.name,
                    'parcels': [
                        {'name': parcel.member.field.name, 'count': len(parcel.beds)}
                        for parcel in group.parcels
                    ],
                }
            )
            continue
        if len(group.parcels) < 2:
            continue
        for source, target in zip(
            group.parcels, (*group.parcels[1:], group.parcels[0]), strict=True
        ):
            mappings.append(
                {
                    'group': model.name,
                    'source_parcel_id': source.member.field_id,
                    'source_parcel': source.member.field.name,
                    'target_parcel_id': target.member.field_id,
                    'target_parcel': target.member.field.name,
                }
            )
            beds.update({a.pk: (a, b) for a, b in zip(source.beds, target.beds, strict=True)})
    return beds, mappings, issues


def _build_rotated_pairs(pairs, mapping, index, issues, crops):
    rotated = []
    allocations: dict[int, list[AreaAllocation]] = defaultdict(list)
    for source, proposed in pairs:
        match = mapping.get(source.bed_id)
        if match is None:
            rotated.append((source, proposed))
            continue
        source_bed, target_bed = match
        rotated_plan = copy(proposed)
        rotated_plan.bed = target_bed
        if not source_bed.area_sqm or not target_bed.area_sqm:
            issues.append(
                {'code': 'missing_bed_area', 'bed': target_bed.name, 'source_bed': source_bed.name}
            )
        elif source.area_usage_sqm is not None:
            original_area, original_bed = _reference_area(source, source_bed)
            ideal = Fraction(original_area) * Fraction(target_bed.area_sqm)
            units = ideal * AREA_UNITS / Fraction(original_bed)
            if rotated_plan.planting_date is None:
                # Undated drafts do not reserve time on a bed.
                if units > target_bed.area_sqm * AREA_UNITS:
                    issues.append(_bed_capacity_issue(target_bed))
                else:
                    rounded = max(int(units > 0), round(units))
                    _move_area(rotated_plan, target_bed, rounded, original_area, original_bed)
            else:
                occupancy = _occupancy(rotated_plan, index, crops)
                allocations[target_bed.pk].append(
                    AreaAllocation(
                        source,
                        rotated_plan,
                        original_area,
                        original_bed,
                        units,
                        occupancy.start,
                        occupancy.firm_end,
                        int(units),
                    )
                )
        rotated.append((source, rotated_plan))
    _apply_allocations(allocations, index, issues)
    return rotated


def _bed_capacity_issue(bed: Bed) -> dict:
    return {'code': 'bed_capacity', 'bed': bed.name, 'parcel': bed.field.name}


def _apply_allocations(allocations, index, issues):
    for bed_id, rows in allocations.items():
        bed = rows[0].plan.bed
        if not _allocate_area(rows, index.occupancies_for_bed(bed_id), bed.area_sqm):
            issues.append(_bed_capacity_issue(bed))
            continue
        for row in rows:
            _move_area(row.plan, bed, row.units, row.original_area, row.original_bed_area)


def preview_parcel_rotation(
    source: Season,
    target: Season,
    pairs: list[PlanPair],
    *,
    preceding: bool,
    requested: bool | None,
    continuing_count: int,
    language_code: str = 'de',
) -> ParcelRotationPreview:
    mapping, mappings, issues = _map_groups(source.project)
    available = preceding and bool(mappings) and not issues
    summary = {
        'eligible': preceding,
        'available': available,
        'enabled': False,
        'mappings': mappings,
        'issues': issues,
        'moves': [],
        'fingerprint': None,
        'continuing_count': continuing_count,
    }
    if requested is False or not available:
        return ParcelRotationPreview(pairs, summary)

    target_beds = {mapping[plan.bed_id][1].pk for plan, _ in pairs if plan.bed_id in mapping}
    index = HarvestOverlapIndex(source.project_id, bed_ids=target_beds, crop_label=str)
    crop_index = build_general_crop_index(source.project_id)
    rotated = _build_rotated_pairs(pairs, mapping, index, issues, crop_index)
    if issues:
        summary['available'] = False
        return ParcelRotationPreview(pairs, summary)

    moved = [(a, b) for a, b in rotated if a.bed_id != b.bed_id]
    demand = preview_plan_seed_demand(source.project, [plan for _, plan in moved], crop_index)
    moves = [
        _describe_move(a, b, crop_index, seeds) for (a, b), seeds in zip(moved, demand, strict=True)
    ]
    service = RotationService(
        source.project_id,
        language_code=language_code,
        region=source.project.region or '',
    )
    crop_rotation = preview_season_copy(service, rotated)
    summary.update(enabled=True, moves=moves, crop_rotation=crop_rotation)
    fingerprint = {
        'source': source.pk,
        'start': target.start_date,
        'end': target.end_date,
        'mappings': mappings,
        'moves': moves,
        'continuing': continuing_count,
        'copies': [
            (a.pk, b.bed_id, b.area_usage_sqm, plan_event_dates(b, crop_index)) for a, b in rotated
        ],
        'individual_copies': [
            (a.pk, a.parcel_id, a.individual_positions, a.estimated_canopy_diameter_m)
            for a, _ in rotated if a.parcel_id is not None
        ],
        'crop_rotation': crop_rotation,
    }
    summary['fingerprint'] = sha256(
        json.dumps(fingerprint, sort_keys=True, default=str).encode()
    ).hexdigest()
    return ParcelRotationPreview(rotated, summary)


def apply_confirmed_parcel_rotation(
    source: Season,
    target: Season,
    pairs: list[PlanPair],
    *,
    preceding: bool,
    continuing_count: int,
    fingerprint: str,
    language_code: str,
) -> list[PlanPair]:
    preview = preview_parcel_rotation(
        source,
        target,
        pairs,
        preceding=preceding,
        requested=True,
        continuing_count=continuing_count,
        language_code=language_code,
    )
    if not preview.summary['enabled'] or preview.summary['fingerprint'] != fingerprint:
        raise ParcelRotationConflict(preview.summary)
    return preview.pairs
