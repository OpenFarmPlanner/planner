"""Persistence of graphical bed/field layout positions for a location.

Business logic behind the `locations/<id>/layouts/` PUT endpoint; the view
only parses the request and maps the outcome to a response.

Note on failure semantics (kept from the original inline implementation): a
validation error mid-list returns normally from inside `transaction.atomic()`,
so entries upserted before the invalid one stay committed.
"""

from dataclasses import dataclass, field

from django.db import transaction

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
    bed_ids = [item.get('bed') for item in bed_payload if isinstance(item, dict) and item.get('bed') is not None]
    beds = {bed.id: bed for bed in Bed.objects.select_related('field__location').filter(id__in=bed_ids)}

    field_ids = [item.get('field') for item in field_payload if isinstance(item, dict) and item.get('field') is not None]
    fields = {f.id: f for f in Field.objects.select_related('location').filter(id__in=field_ids)}
    previous_beds = {
        row['bed_id']: row for row in BedLayout.objects.filter(
            project=location.project, bed_id__in=bed_ids,
        ).values()
    }
    previous_fields = {
        row['field_id']: row for row in FieldLayout.objects.filter(
            project=location.project, field_id__in=field_ids,
        ).values()
    }

    saved_bed_layouts: list[BedLayout] = []
    saved_field_layouts: list[FieldLayout] = []
    changed_count = 0

    with transaction.atomic():
        for item in bed_payload:
            error_detail = _bed_entry_error(location, beds, item)
            if error_detail:
                return LayoutSaveOutcome(error_detail=error_detail, changed_count=changed_count)
            bed = beds[item['bed']]
            layout, _ = BedLayout.objects.update_or_create(
                bed=bed,
                defaults=_layout_defaults(location, item),
            )
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
    layout: BedLayout | FieldLayout, previous: dict | None, *, user_name: str,
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
