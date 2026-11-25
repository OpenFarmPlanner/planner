"""Persistence of graphical bed/field layout positions for a location.

Business logic behind the `locations/<id>/layouts/` PUT endpoint; the view
only parses the request and maps the outcome to a response.

Note on failure semantics (kept from the original inline implementation): a
validation error mid-list returns normally from inside `transaction.atomic()`,
so entries upserted before the invalid one stay committed.
"""

import math
from collections import defaultdict
from dataclasses import dataclass, field

from django.db import transaction
from django.db.models import QuerySet

from farm.history import (
    _diff_changed_fields,
    _entity_type_for,
    _serialize_instance,
    record_entity_revision,
)
from farm.models import Bed, BedLayout, EntityRevision, Field, FieldLayout, Location


def extract_layout_payloads(data: object) -> tuple[object, object]:
    """Pull bed/field layout lists from the request body.

    Falls back to the Phase-1 payload format (a bare list or `layouts` key)
    when neither modern key is present. A body that is not an object at all
    is handed back unchanged, so the view rejects it with its structured
    `invalid_layout_collections` error instead of raising.
    """
    if not isinstance(data, dict):
        return data, []

    bed_payload = data.get('bed_layouts')
    field_payload = data.get('field_layouts')
    if bed_payload is None and field_payload is None:
        bed_payload = data.get('layouts', data)
        field_payload = []
    return bed_payload, field_payload


def serialize_location_boundary(location: Location) -> dict[str, float] | None:
    """The stored boundary origin of the graphical view, or None while unset."""
    if location.boundary_x is None or location.boundary_y is None:
        return None
    return {'x': location.boundary_x, 'y': location.boundary_y}


def create_bed_layout(bed: Bed, placement: dict, *, user_name: str) -> BedLayout:
    layout = BedLayout.objects.create(
        bed=bed, project=bed.project, location=bed.field.location, **placement,
    )
    _record_layout_revision(layout, None, user_name=user_name)
    return layout


def lock_layout_parcels(project_id: int, parcel_ids: set[int]) -> QuerySet[Field]:
    """Lock parcels in a consistent order before validating or moving layouts."""
    return Field.objects.select_for_update(no_key=True).filter(
        project_id=project_id, pk__in=parcel_ids,
    ).order_by('pk')


def move_bed_layouts(layouts: QuerySet[BedLayout], location_id: int, *, user_name: str) -> None:
    """Keep bed offsets and orientation when their current location changes."""
    for layout in layouts.exclude(location_id=location_id).select_related('project'):
        previous = _serialize_instance(layout)
        layout.location_id = location_id
        layout.save(update_fields=['location', 'updated_at'])
        _record_layout_revision(layout, previous, user_name=user_name)


def preserve_relocated_bed_layouts(location: Location, *, user_name: str) -> None:
    """Before deleting a location, repoint legacy layouts for beds that moved away."""
    project_id = location.project_id
    beds = list(Bed.objects.select_for_update(of=('self',), no_key=True).filter(
        project_id=project_id, layout__project_id=project_id, layout__location=location,
        field__project_id=project_id, field__location__project_id=project_id,
    ).exclude(field__location=location).order_by('pk'))
    fields = {
        field.pk: field for field in lock_layout_parcels(project_id, {bed.field_id for bed in beds})
    }
    beds_by_location: dict[int, list[int]] = defaultdict(list)
    for bed in beds:
        field = fields[bed.field_id]
        if field.location_id != location.pk:
            beds_by_location[field.location_id].append(bed.pk)
    for destination, bed_ids in beds_by_location.items():
        layouts = BedLayout.objects.filter(
            project_id=project_id, location=location, bed_id__in=bed_ids,
        )
        move_bed_layouts(layouts, destination, user_name=user_name)


def parse_location_boundary(data: object) -> tuple[bool, dict[str, float] | None, str | None]:
    """Read the optional `location_boundary` entry of a layouts PUT body.

    Returns (present, origin, error): `present` is False when the key is
    missing, so the stored origin stays untouched; an explicit null clears it.
    """
    if not isinstance(data, dict) or 'location_boundary' not in data:
        return False, None, None
    payload = data['location_boundary']
    if payload is None:
        return True, None, None
    if not isinstance(payload, dict):
        return True, None, 'The location boundary must be an object with x and y.'
    origin: dict[str, float] = {}
    for axis in ('x', 'y'):
        value = payload.get(axis)
        is_number = isinstance(value, int | float) and not isinstance(value, bool)
        if not is_number or not math.isfinite(value):
            return True, None, f'The location boundary {axis} must be a finite number.'
        origin[axis] = float(value)
    return True, origin, None


def save_location_boundary(
    location: Location, origin: dict[str, float] | None, *, user_name: str = '',
) -> bool:
    """Store the boundary origin; returns whether anything changed."""
    new_x = origin['x'] if origin else None
    new_y = origin['y'] if origin else None
    if location.boundary_x == new_x and location.boundary_y == new_y:
        return False
    previous = _serialize_instance(location)
    location.boundary_x = new_x
    location.boundary_y = new_y
    location.save(update_fields=['boundary_x', 'boundary_y', 'updated_at'])
    _record_layout_revision(location, previous, user_name=user_name)
    return True


@dataclass
class LayoutSaveOutcome:
    """Saved layouts, or `error_detail` when a payload entry was invalid."""

    bed_layouts: list[BedLayout] = field(default_factory=list)
    field_layouts: list[FieldLayout] = field(default_factory=list)
    error_detail: str | None = None
    changed_count: int = 0


def save_location_layouts(
    location: Location, bed_payload: list, field_payload: list, *, user_name: str = ''
) -> LayoutSaveOutcome:
    """Upsert the graphical layout entries for all beds/fields of a location."""
    bed_ids = [
        item['bed'] for item in bed_payload
        if isinstance(item, dict) and item.get('bed') is not None
    ]
    field_ids = [
        item['field'] for item in field_payload
        if isinstance(item, dict) and item.get('field') is not None
    ]
    saved_bed_layouts: list[BedLayout] = []
    saved_field_layouts: list[FieldLayout] = []
    changed_count = 0

    with transaction.atomic():
        # Parent changes take the same locks before repointing bed layouts.
        beds = {
            bed.pk: bed for bed in Bed.objects.select_for_update(no_key=True).filter(
                project_id=location.project_id, pk__in=bed_ids,
            ).order_by('pk')
        }
        fields = {
            field.pk: field for field in lock_layout_parcels(
                location.project_id, set(field_ids) | {bed.field_id for bed in beds.values()},
            )
        }
        previous_beds = {
            row['bed_id']: row for row in BedLayout.objects.filter(
                project_id=location.project_id, bed_id__in=bed_ids,
            ).values()
        }
        previous_fields = {
            row['field_id']: row for row in FieldLayout.objects.filter(
                project_id=location.project_id, field_id__in=field_ids,
            ).values()
        }
        for item in bed_payload:
            error_detail = _bed_entry_error(location, beds, fields, item)
            if error_detail:
                return LayoutSaveOutcome(error_detail=error_detail, changed_count=changed_count)
            bed = beds[item['bed']]
            bed.field = fields[bed.field_id]
            layout, _ = BedLayout.objects.update_or_create(
                bed=bed,
                defaults=_layout_defaults(location, item),
            )
            layout.bed = bed
            previous_beds[bed.pk], changed = _record_layout_revision(
                layout, previous_beds.get(bed.pk), user_name=user_name
            )
            changed_count += changed
            saved_bed_layouts.append(layout)

        for item in field_payload:
            error_detail = _field_entry_error(location, fields, item)
            if error_detail:
                return LayoutSaveOutcome(error_detail=error_detail, changed_count=changed_count)
            field_obj = fields[item['field']]
            layout, _ = FieldLayout.objects.update_or_create(
                field=field_obj,
                defaults=_layout_defaults(location, item),
            )
            previous_fields[field_obj.pk], changed = _record_layout_revision(
                layout, previous_fields.get(field_obj.pk), user_name=user_name
            )
            changed_count += changed
            saved_field_layouts.append(layout)

    return LayoutSaveOutcome(
        bed_layouts=saved_bed_layouts, field_layouts=saved_field_layouts,
        changed_count=changed_count,
    )


def _record_layout_revision(
    layout: BedLayout | FieldLayout | Location, previous: dict | None, *, user_name: str,
) -> tuple[dict, bool]:
    snapshot = _serialize_instance(layout)
    changed = _diff_changed_fields(previous or {}, snapshot)
    if not changed:
        return snapshot, False
    snapshot['_project_version_internal'] = True
    record_entity_revision(
        project=layout.project, entity_type=_entity_type_for(layout),
        object_id=layout.pk,
        action=EntityRevision.ACTION_UPDATED if previous else EntityRevision.ACTION_CREATED,
        snapshot=snapshot, changed_fields=changed, user_name=user_name,
    )
    return snapshot, True


def _layout_defaults(location: Location, item: dict) -> dict:
    return {
        'location': location,
        'project': location.project,
        'x': float(item.get('x', 0.0)),
        'y': float(item.get('y', 0.0)),
        'scale': item.get('scale'),
        'version': int(item.get('version', 1)),
    }


def _bed_entry_error(
    location: Location, beds: dict[int, Bed], fields: dict[int, Field], item: object,
) -> str | None:
    if not isinstance(item, dict):
        return 'Each bed layout entry must be an object.'
    bed_id = item.get('bed')
    bed = beds.get(bed_id)
    if bed is None:
        return f'Bed {bed_id} does not exist.'
    field = fields.get(bed.field_id)
    if field is None or field.location_id != location.id:
        return f'Bed {bed_id} does not belong to location {location.id}.'
    return None


def _field_entry_error(location: Location, fields: dict[int, Field], item: object) -> str | None:
    if not isinstance(item, dict):
        return 'Each field layout entry must be an object.'
    field_id = item.get('field')
    field_obj = fields.get(field_id)
    if field_obj is None:
        return f'Field {field_id} does not exist.'
    if field_obj.location_id != location.id:
        return f'Field {field_id} does not belong to location {location.id}.'
    return None
