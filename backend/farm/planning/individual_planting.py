"""Validate individual plant coordinates for the planting-plan API."""

from decimal import Decimal
from uuid import uuid4

from rest_framework import serializers
from rest_framework.exceptions import APIException

from farm.common.serializer_fields import _resolve_active_project_from_serializer
from farm.models import Crop, Field, PlantingPlan
from farm.services.crop_inheritance import get_general_crop, resolve_crop_field

MAX_INDIVIDUAL_POSITIONS = 1000


class IndividualPlantParcelField(serializers.PrimaryKeyRelatedField):
    queryset = Field.objects.all()

    def get_queryset(self):
        project = _resolve_active_project_from_serializer(self.parent)
        return self.queryset.filter(project=project) if project else self.queryset.none()


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


def suggested_canopy_diameter(crop: Crop) -> Decimal | None:
    if crop.estimated_canopy_diameter_m is not None:
        return crop.estimated_canopy_diameter_m
    parent = get_general_crop(crop)
    return parent.estimated_canopy_diameter_m if parent else None


def _normalize_positions(positions, existing, parcel):
    previous = {position['id']: position for position in existing}
    seen = set()
    normalized = []
    for position in positions:
        position_id = str(position['id']) if 'id' in position else str(uuid4())
        if position_id in seen or ('id' in position and position_id not in previous):
            raise serializers.ValidationError({
                'individual_positions': 'Invalid individual plant ID.',
            })
        seen.add(position_id)
        x_m, y_m = float(position['x_m']), float(position['y_m'])
        record = {'id': position_id, 'x_m': x_m, 'y_m': y_m}
        if record != previous.get(position_id) and not (
            parcel.width_m and parcel.length_m and x_m <= parcel.width_m and y_m <= parcel.length_m
        ):
            raise serializers.ValidationError({
                'individual_positions': 'Stem positions must be within the measured parcel.',
            })
        normalized.append(record)
    return normalized


def _require_perennial(crop: Crop) -> None:
    if resolve_crop_field(crop, 'life_cycle') != 'perennial':
        raise serializers.ValidationError({'crop': 'Choose a perennial crop.'})


def _validate_arrangement(attrs: dict, plan: PlantingPlan | None) -> Crop:
    bed = attrs.get('bed', getattr(plan, 'bed', None))
    crop = attrs.get('crop', getattr(plan, 'crop', None))
    if bed is not None or any(attrs.get(field) is not None for field in (
        'area_usage_sqm', 'area_input_value', 'quantity',
    )):
        raise serializers.ValidationError({
            'parcel': 'Individual plants use stem positions instead of bed area or a manual count.',
        })
    if crop is None:
        raise serializers.ValidationError({'crop': 'Choose a crop for the individual plants.'})
    return crop


def _apply_placement_defaults(attrs, plan, crop, positions, placement_updated_at):
    if plan is None:
        _require_perennial(crop)
        if not positions:
            raise serializers.ValidationError({
                'individual_positions': 'Add at least one stem position.',
            })
        if 'estimated_canopy_diameter_m' not in attrs:
            attrs['estimated_canopy_diameter_m'] = suggested_canopy_diameter(crop)
        return
    if crop.pk != plan.crop_id:
        _require_perennial(crop)
    updates_placement = {'individual_positions', 'estimated_canopy_diameter_m'} & attrs.keys()
    if updates_placement and placement_updated_at != plan.updated_at:
        raise PlacementConflict()


def validate_individual_planting(attrs: dict, plan: PlantingPlan | None) -> None:
    parcel = attrs.get('parcel', getattr(plan, 'parcel', None))
    positions = attrs.get('individual_positions')
    canopy = attrs.get('estimated_canopy_diameter_m')
    placement_updated_at = attrs.pop('placement_updated_at', None)
    if plan is not None and parcel != plan.parcel:
        raise serializers.ValidationError({'parcel': 'The direct parcel assignment is fixed.'})
    if parcel is None:
        if positions or canopy is not None:
            raise serializers.ValidationError({
                'parcel': 'Choose a parcel for the individual plants.',
            })
        return

    crop = _validate_arrangement(attrs, plan)
    _apply_placement_defaults(attrs, plan, crop, positions, placement_updated_at)
    if positions is not None:
        attrs['individual_positions'] = _normalize_positions(
            positions, plan.individual_positions if plan else [], parcel,
        )
