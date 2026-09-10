"""Persistence of graphical bed/field layout positions for a location.

Business logic behind the `locations/<id>/layouts/` PUT endpoint; the view
only parses the request and maps the outcome to a response.

Note on failure semantics (kept from the original inline implementation): a
validation error mid-list returns normally from inside `transaction.atomic()`,
so entries upserted before the invalid one stay committed.
"""

from dataclasses import dataclass, field

from django.db import transaction

from farm.models import Bed, BedLayout, Field, FieldLayout, Location


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


@dataclass
class LayoutSaveOutcome:
    """Saved layouts, or `error_detail` when a payload entry was invalid."""

    bed_layouts: list[BedLayout] = field(default_factory=list)
    field_layouts: list[FieldLayout] = field(default_factory=list)
    error_detail: str | None = None


def save_location_layouts(location: Location, bed_payload: list, field_payload: list) -> LayoutSaveOutcome:
    """Upsert the graphical layout entries for all beds/fields of a location."""
    bed_ids = [item.get('bed') for item in bed_payload if isinstance(item, dict) and item.get('bed') is not None]
    beds = {bed.id: bed for bed in Bed.objects.select_related('field__location').filter(id__in=bed_ids)}

    field_ids = [item.get('field') for item in field_payload if isinstance(item, dict) and item.get('field') is not None]
    fields = {f.id: f for f in Field.objects.select_related('location').filter(id__in=field_ids)}

    saved_bed_layouts: list[BedLayout] = []
    saved_field_layouts: list[FieldLayout] = []

    with transaction.atomic():
        for item in bed_payload:
            error_detail = _bed_entry_error(location, beds, item)
            if error_detail:
                return LayoutSaveOutcome(error_detail=error_detail)
            bed = beds[item['bed']]
            layout, _ = BedLayout.objects.update_or_create(
                bed=bed,
                defaults=_layout_defaults(location, item),
            )
            saved_bed_layouts.append(layout)

        for item in field_payload:
            error_detail = _field_entry_error(location, fields, item)
            if error_detail:
                return LayoutSaveOutcome(error_detail=error_detail)
            field_obj = fields[item['field']]
            layout, _ = FieldLayout.objects.update_or_create(
                field=field_obj,
                defaults=_layout_defaults(location, item),
            )
            saved_field_layouts.append(layout)

    return LayoutSaveOutcome(bed_layouts=saved_bed_layouts, field_layouts=saved_field_layouts)


def _layout_defaults(location: Location, item: dict) -> dict:
    return {
        'location': location,
        'project': location.project,
        'x': float(item.get('x', 0.0)),
        'y': float(item.get('y', 0.0)),
        'scale': item.get('scale'),
        'version': int(item.get('version', 1)),
    }


def _bed_entry_error(location: Location, beds: dict[int, Bed], item: object) -> str | None:
    if not isinstance(item, dict):
        return 'Each bed layout entry must be an object.'
    bed_id = item.get('bed')
    bed = beds.get(bed_id)
    if bed is None:
        return f'Bed {bed_id} does not exist.'
    if bed.field.location_id != location.id:
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
