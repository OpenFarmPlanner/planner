"""Validate individual plant coordinates for the planting-plan API."""

from decimal import Decimal
from math import isfinite
from uuid import uuid4

from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import APIException

from farm.common.serializer_fields import _resolve_active_project_from_serializer
from farm.models import Bed, Crop, Field, Location, PlantingPlan
from farm.services.crop_inheritance import get_general_crop, lock_crop_project

MAX_INDIVIDUAL_POSITIONS = 1000


class IndividualPlantParentField(serializers.PrimaryKeyRelatedField):
    def get_queryset(self):
        project = _resolve_active_project_from_serializer(self.parent)
        queryset = super().get_queryset()
        return queryset.filter(project=project) if project else queryset.none()


class IndividualPlantPositionSerializer(serializers.Serializer):
    id = serializers.UUIDField(required=False)
    x_m = serializers.DecimalField(
        max_digits=8, decimal_places=2, min_value=Decimal('0'), coerce_to_string=False,
    )
    y_m = serializers.DecimalField(
        max_digits=8, decimal_places=2, min_value=Decimal('0'), coerce_to_string=False,
    )

    def validate(self, attrs):
        # DRF's partial update flag also applies to nested serializers. Each
        # entry in this replacement list still requires both coordinates.
        if not {'x_m', 'y_m'} <= attrs.keys():
            raise serializers.ValidationError('Both stem coordinates are required.')
        return attrs


class PlacementConflict(APIException):
    status_code = 409
    default_detail = {'code': 'individual_placement_changed'}


class ParcelDimensionsConflict(APIException):
    status_code = 409
    default_detail = {
        'code': 'parcel_contains_individual_positions',
        'detail': 'The parcel dimensions must contain all existing stem positions.',
    }


class BedDimensionsConflict(APIException):
    status_code = 409
    default_detail = {
        'code': 'bed_contains_individual_positions',
        'detail': 'The bed dimensions must contain all existing stem positions.',
    }


class LocationDimensionsConflict(APIException):
    status_code = 409
    default_detail = {
        'code': 'location_contains_individual_positions',
        'detail': 'The location dimensions must contain all existing stem positions.',
    }


def suggested_canopy_diameter(crop: Crop) -> Decimal | None:
    if crop.estimated_canopy_diameter_m is not None:
        return crop.estimated_canopy_diameter_m
    parent = get_general_crop(crop)
    return parent.estimated_canopy_diameter_m if parent else None


def _positions_fit(positions, width, length):
    return not positions or (
        width is not None and length is not None
        and isfinite(width) and isfinite(length) and width > 0 and length > 0
        and all(0 <= stem['x_m'] <= width and 0 <= stem['y_m'] <= length for stem in positions)
    )


def positions_fit_parent(parent: Bed | Field | Location, positions: list[dict]) -> bool:
    return _positions_fit(positions, parent.width_m, parent.length_m)


def _check_position_bounds(parent, positions):
    if not positions_fit_parent(parent, positions):
        raise serializers.ValidationError({
            'individual_positions': 'Stem positions must be within the measured growing area.',
        })


def lock_individual_parcel(parcel: Field) -> Field:
    return get_object_or_404(
        Field.objects.select_for_update(no_key=True), pk=parcel.pk, project_id=parcel.project_id,
    )


def lock_placement_parent(parent: Bed | Field | Location) -> Bed | Field | Location:
    if isinstance(parent, Field):
        return lock_individual_parcel(parent)
    return get_object_or_404(
        type(parent).objects.select_for_update(no_key=True),
        pk=parent.pk, project_id=parent.project_id,
    )


def check_placement_on_current_parent(
    parent: Bed | Field | Location, positions: list[dict],
) -> None:
    """Recheck dimensions under the same lock as dimension edits."""
    _check_position_bounds(lock_placement_parent(parent), positions)


def validate_individual_parcel_dimensions(parcel: Field, attrs: dict) -> None:
    placements = parcel.individual_planting_plans.filter(project_id=parcel.project_id)
    _validate_parent_dimensions(parcel, attrs, placements, ParcelDimensionsConflict)


def validate_individual_bed_dimensions(bed: Bed, attrs: dict) -> None:
    placements = bed.planting_plans.filter(project_id=bed.project_id, individual_bed=True)
    _validate_parent_dimensions(bed, attrs, placements, BedDimensionsConflict)


def validate_individual_site_dimensions(site: Location, attrs: dict) -> None:
    placements = site.individual_planting_plans.filter(project_id=site.project_id)
    _validate_parent_dimensions(site, attrs, placements, LocationDimensionsConflict)


def _validate_parent_dimensions(parent, attrs, placements, conflict) -> None:
    width = attrs.get('width_m', parent.width_m)
    length = attrs.get('length_m', parent.length_m)
    if (width, length) == (parent.width_m, parent.length_m):
        return
    for positions in placements.exclude(individual_positions=[]).values_list(
        'individual_positions', flat=True,
    ).iterator():
        if not _positions_fit(positions, width, length):
            raise conflict()


def _normalize_positions(positions, existing, parent):
    previous_ids = {position['id'] for position in existing}
    seen = set()
    normalized = []
    for position in positions:
        position_id = str(position['id']) if 'id' in position else str(uuid4())
        if position_id in seen or ('id' in position and position_id not in previous_ids):
            raise serializers.ValidationError({
                'individual_positions': 'Invalid individual plant ID.',
            })
        seen.add(position_id)
        x_m, y_m = float(position['x_m']), float(position['y_m'])
        normalized.append({'id': position_id, 'x_m': x_m, 'y_m': y_m})
    _check_position_bounds(parent, normalized)
    return normalized


def lock_and_check_individual_crop(crop: Crop) -> None:
    # The project lock also covers updates to a linked variety's general crop.
    lock_crop_project(crop.project_id)
    current = Crop.objects.filter(pk=crop.pk, project_id=crop.project_id).first()
    if current is None:
        raise serializers.ValidationError({'crop': 'Choose an active crop.'})


def _validate_arrangement(attrs: dict, plan: PlantingPlan | None) -> Crop:
    crop = attrs.get('crop', getattr(plan, 'crop', None))
    if any(attrs.get(field) is not None for field in (
        'area_usage_sqm', 'area_input_value', 'quantity',
    )):
        raise serializers.ValidationError({
            'placement_mode': 'Individual plants use stem positions instead of bed area '
                              'or a manual count.',
        })
    if crop is None:
        raise serializers.ValidationError({'crop': 'Choose a crop for the individual plants.'})
    return crop


def _apply_placement_defaults(attrs, plan, crop, positions, placement_updated_at):
    count = attrs.get('individual_count', getattr(plan, 'individual_count', None))
    stems = positions if positions is not None else getattr(plan, 'individual_positions', [])
    positioned = len(stems)
    if count is not None and count < positioned:
        raise serializers.ValidationError({
            'individual_count': 'The total cannot be below the number of positioned stems.',
        })
    if plan is None:
        if not positioned and not count:
            raise serializers.ValidationError({
                'individual_positions': 'Add a stem position or record the exact number of plants.',
            })
        if 'estimated_canopy_diameter_m' not in attrs:
            attrs['estimated_canopy_diameter_m'] = suggested_canopy_diameter(crop)
        return
    placement_fields = {'individual_positions', 'estimated_canopy_diameter_m', 'individual_count'}
    updates_placement = placement_fields & attrs.keys()
    if updates_placement and placement_updated_at != plan.updated_at:
        raise PlacementConflict()


def _resolve_placement_mode(
    attrs: dict, plan: PlantingPlan | None,
    parents: tuple[Bed | None, Field | None, Location | None],
) -> str:
    mode = attrs.pop('placement_mode', None)
    if plan is None:
        _, parcel, site = parents
        if mode:
            return mode
        if site is not None:
            return PlantingPlan.PLACEMENT_SITE
        return PlantingPlan.PLACEMENT_PARCEL if parcel is not None else PlantingPlan.PLACEMENT_AREA
    mode = mode or plan.placement_mode
    parent_changed = plan.is_individual and parents != (plan.bed, plan.parcel, plan.site)
    if mode != plan.placement_mode or parent_changed:
        raise serializers.ValidationError({
            'placement_mode': 'The individual placement parent and mode are fixed.',
        })
    return mode


def validate_individual_planting(attrs: dict, plan: PlantingPlan | None) -> None:
    parcel = attrs.get('parcel', getattr(plan, 'parcel', None))
    bed = attrs.get('bed', getattr(plan, 'bed', None))
    site = attrs.get('site', getattr(plan, 'site', None))
    mode = _resolve_placement_mode(attrs, plan, (bed, parcel, site))
    positions = attrs.get('individual_positions')
    canopy = attrs.get('estimated_canopy_diameter_m')
    placement_updated_at = attrs.pop('placement_updated_at', None)
    if mode == PlantingPlan.PLACEMENT_AREA:
        if parcel is not None:
            raise serializers.ValidationError({
                'parcel': 'A direct parcel requires individual parcel placement.',
            })
        if (site is not None or positions or canopy is not None
                or attrs.get('individual_count') is not None):
            raise serializers.ValidationError({
                'placement_mode': 'Choose an individual bed, parcel or location placement.',
            })
        return

    parents = {
        PlantingPlan.PLACEMENT_BED: bed,
        PlantingPlan.PLACEMENT_PARCEL: parcel,
        PlantingPlan.PLACEMENT_SITE: site,
    }
    parent = parents.get(mode)
    if parent is None or sum(area is not None for area in parents.values()) != 1:
        raise serializers.ValidationError({
            'placement_mode': 'Choose exactly the growing area required by the placement mode.',
        })
    # Existing placements without a date stay editable unless the date is cleared explicitly.
    if (plan is None or 'planting_date' in attrs) and attrs.get('planting_date') is None:
        raise serializers.ValidationError({
            'planting_date': 'Set a planting date for the individual plants.',
        })

    crop = _validate_arrangement(attrs, plan)
    if plan is None and mode == PlantingPlan.PLACEMENT_BED:
        attrs['individual_bed'] = True
    _apply_placement_defaults(attrs, plan, crop, positions, placement_updated_at)
    if positions is not None:
        attrs['individual_positions'] = _normalize_positions(
            positions, plan.individual_positions if plan else [], parent,
        )
