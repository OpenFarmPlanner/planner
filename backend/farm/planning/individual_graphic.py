"""Resolve Graphic stem clicks against the current schematic growing areas."""

from dataclasses import dataclass
from math import floor, isclose, isfinite

from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import APIException

from farm.models import Bed, BedLayout, Field, FieldLayout, Location

WORLD_UNITS_PER_METER = 18
METRIC_TOLERANCE = 0.0001


class IndividualGraphicConflict(APIException):
    status_code = 409

    def __init__(self, code):
        super().__init__({'code': code})


def geometry_changed():
    return IndividualGraphicConflict('individual_geometry_changed')


class FiniteCoordinate(serializers.FloatField):
    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        if not isfinite(value):
            raise serializers.ValidationError('Enter a finite coordinate.')
        return value


class GraphicParentSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=('location', 'field', 'bed'))
    id = serializers.IntegerField(min_value=1)


class GraphicPointSerializer(serializers.Serializer):
    x_m = FiniteCoordinate()
    y_m = FiniteCoordinate()
    parent = GraphicParentSerializer()


class GraphicFootprintSerializer(GraphicParentSerializer):
    x = FiniteCoordinate()
    y = FiniteCoordinate()
    width = FiniteCoordinate(min_value=0)
    height = FiniteCoordinate(min_value=0)


class GraphicSceneSerializer(serializers.Serializer):
    location = serializers.IntegerField(min_value=1)
    origin_x = FiniteCoordinate()
    origin_y = FiniteCoordinate()
    footprints = GraphicFootprintSerializer(many=True)


@dataclass(frozen=True)
class Footprint:
    x: float
    y: float
    width: float
    height: float

    def contains(self, x, y):
        return self.x <= x <= self.x + self.width and self.y <= y <= self.y + self.height


@dataclass(frozen=True)
class Area:
    entity: Location | Field | Bed
    footprint: Footprint
    measured: bool
    across: bool = False

    @property
    def parent(self):
        kind = (
            'location'
            if isinstance(self.entity, Location)
            else 'field'
            if isinstance(self.entity, Field)
            else 'bed'
        )
        return {'kind': kind, 'id': self.entity.pk}

    def local_stem(self, x, y):
        dx, dy = x - self.footprint.x, y - self.footprint.y
        x_m, y_m = (dy, self.footprint.width - dx) if self.across else (dx, dy)
        return {
            'x_m': _round_inside(x_m, self.entity.width_m),
            'y_m': _round_inside(y_m, self.entity.length_m),
        }


@dataclass(frozen=True)
class GraphicScene:
    site: Area
    parcels: dict[int, Area]
    beds_by_field: dict[int, list[Area]]

    def resolve(self, point):
        if not self.site.measured:
            raise IndividualGraphicConflict('individual_geometry_unknown')
        x, y = point['x_m'], point['y_m']
        if not self.site.footprint.contains(x, y):
            raise IndividualGraphicConflict('individual_outside_location')
        parcels = [area for area in self.parcels.values() if area.footprint.contains(x, y)]
        parent = _one_containing_area(parcels) or self.site
        if parent is not self.site:
            beds = [
                area
                for area in self.beds_by_field.get(parent.entity.pk, [])
                if area.footprint.contains(x, y)
            ]
            parent = _one_containing_area(beds) or parent
        if point['parent'] != parent.parent:
            raise geometry_changed()
        return parent, parent.local_stem(x, y)


def _one_containing_area(areas):
    if any(not area.measured for area in areas):
        raise IndividualGraphicConflict('individual_geometry_unknown')
    if len(areas) > 1:
        raise IndividualGraphicConflict('individual_parent_ambiguous')
    return areas[0] if areas else None


def _verified(value, expected):
    if not isclose(value, expected, rel_tol=0, abs_tol=METRIC_TOLERANCE):
        raise geometry_changed()


def _round_inside(value, bound):
    return min(max(0.0, round(value, 2)), floor(float(bound) * 100 + 1e-8) / 100)


def _measured_size(area):
    width, length = area.width_m, area.length_m
    if width is None or length is None or width <= 0 or length <= 0:
        return None
    return float(width), float(length)


def _legacy_bed_meters(layout, parcel_size):
    """Invert the historical storage frame exactly as Graphic does."""
    width, height = (max(1, metres * WORLD_UNITS_PER_METER) for metres in parcel_size)
    short_side = min(width, height)
    if short_side < 72:
        factor = 72 / short_side
        width, height = floor(width * factor + 0.5), floor(height * factor + 0.5)
    return layout.x * parcel_size[0] / (width - 20), layout.y * parcel_size[1] / (height - 44)


def _check_parcel(parcel, rect, layout, origin):
    size = _measured_size(parcel)
    if size is not None:
        _verified(rect.width, size[0])
        _verified(rect.height, size[1])
    if layout is not None:
        _verified(rect.x, (layout.x - origin[0]) / WORLD_UNITS_PER_METER)
        _verified(rect.y, (layout.y - origin[1]) / WORLD_UNITS_PER_METER)
    return Area(parcel, rect, size is not None)


def _check_bed(bed, rect, layout, parcel):
    size = _measured_size(bed)
    across = layout is not None and layout.runs_across_parcel
    if size is not None:
        displayed = size[::-1] if across else size
        _verified(rect.width, displayed[0])
        _verified(rect.height, displayed[1])
    if layout is not None:
        parcel_size = _measured_size(parcel.entity)
        if parcel_size is None:
            dx, dy = layout.x / WORLD_UNITS_PER_METER, layout.y / WORLD_UNITS_PER_METER
        else:
            dx, dy = _legacy_bed_meters(layout, parcel_size)
        _verified(rect.x, parcel.footprint.x + dx)
        _verified(rect.y, parcel.footprint.y + dy)
    return Area(bed, rect, size is not None, across)


def lock_graphic_scene(project, submitted):
    """Recheck site/parent membership, dimensions, and stored offsets under the layout locks.

    A footprint without a saved offset uses the current automatic layout seen
    by the user. Its size and ancestry still come from the database.
    """
    site = get_object_or_404(
        Location.objects.select_for_update(no_key=True), project=project, pk=submitted['location']
    )
    origin = submitted['origin_x'], submitted['origin_y']
    saved_origin = site.boundary_x is not None and site.boundary_y is not None
    if saved_origin:
        _verified(origin[0], site.boundary_x)
        _verified(origin[1], site.boundary_y)
    fields = (
        Field.objects.select_for_update(no_key=True)
        .filter(project=project, location=site)
        .order_by('pk')
    )
    beds = list(
        Bed.objects.select_for_update(no_key=True, of=('self',))
        .filter(project=project, field__project=project, field__location=site)
        .order_by('pk')
    )
    fields = list(fields)
    frame_rows = submitted['footprints']
    frames = {
        (row['kind'], row['id']): Footprint(row['x'], row['y'], row['width'], row['height'])
        for row in frame_rows
    }
    required = {('field', field.pk) for field in fields} | {('bed', bed.pk) for bed in beds}
    if len(frames) != len(frame_rows) or frames.keys() != required:
        raise geometry_changed()
    field_layouts = {
        layout.field_id: layout
        for layout in FieldLayout.objects.filter(project=project, location=site)
    }
    bed_layouts = {
        layout.bed_id: layout
        for layout in BedLayout.objects.filter(project=project, bed_id__in=[bed.pk for bed in beds])
    }
    parcels = {
        field.pk: _check_parcel(
            field, frames['field', field.pk], field_layouts.get(field.pk), origin
        )
        for field in fields
    }
    if parcels and not saved_origin:
        _verified(min(item.footprint.x for item in parcels.values()), 0)
        _verified(min(item.footprint.y for item in parcels.values()), 0)
    beds_by_field = {}
    for bed in beds:
        if bed.field_id not in parcels:
            raise geometry_changed()
        area = _check_bed(
            bed, frames['bed', bed.pk], bed_layouts.get(bed.pk), parcels[bed.field_id]
        )
        beds_by_field.setdefault(bed.field_id, []).append(area)
    size = _measured_size(site)
    return GraphicScene(
        Area(site, Footprint(0, 0, *(size or (0, 0))), size is not None), parcels, beds_by_field
    )
