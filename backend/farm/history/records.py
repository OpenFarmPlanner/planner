"""Recording of entity revisions: registry, snapshots, and revision writes."""

import json
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any
from uuid import UUID

from django.core.serializers.json import DjangoJSONEncoder

from farm.models import (
    BatchOperation,
    Bed,
    BedLayout,
    Crop,
    CropCompanion,
    CropLoss,
    CropSupplierData,
    CropTaskTemplate,
    EntityRevision,
    Field,
    FieldLayout,
    HarvestAllocation,
    HarvestRecord,
    Location,
    MediaFile,
    NoteAttachment,
    PlantingPlan,
    Project,
    Season,
    SeasonPattern,
    SeedPackage,
    Supplier,
    Task,
    format_crop_display_name,
)

_internal_versions: ContextVar[bool] = ContextVar('internal_project_versions', default=False)
PROMOTED_CROP_FIELD_CHANGES = '_promoted_crop_field_changes'


@contextmanager
def internal_project_versions() -> Iterator[None]:
    """Hide intermediate revisions until their enclosing action has completed."""
    token = _internal_versions.set(True)
    try:
        yield
    finally:
        _internal_versions.reset(token)


_active_batch: ContextVar[BatchOperation | None] = ContextVar('history_batch', default=None)
_revision_actor: ContextVar[str] = ContextVar('history_actor', default='')


@contextmanager
def revision_batch(batch: BatchOperation) -> Iterator[None]:
    """Bind nested model/service revision writes to the server-selected operation."""
    token = _active_batch.set(batch)
    try:
        yield
    finally:
        _active_batch.reset(token)


@contextmanager
def revision_actor(user: Any, *, public_label: str = '') -> Iterator[None]:
    """Attribute nested history writes to the action's authenticated user."""
    label = public_label or _user_actor_label(user) or _revision_actor.get()
    token = _revision_actor.set(label[:EntityRevision._meta.get_field('user_name').max_length])
    try:
        yield
    finally:
        _revision_actor.reset(token)


# Entity types that participate in per-entity revision history and whole-project
# point-in-time restore, in FK-dependency order (parents before children).
_RESTORABLE_ENTITY_TYPES: list[tuple[type, str]] = [
    (Location, 'location'),
    (Field, 'field'),
    (Bed, 'bed'),
    (BedLayout, 'bed_layout'),
    (FieldLayout, 'field_layout'),
    (Supplier, 'supplier'),
    (Crop, 'crop'),
    (CropCompanion, 'crop_companion'),
    (Season, 'season'),
    (PlantingPlan, 'planting_plan'),
    (CropLoss, 'crop_loss'),
    (HarvestRecord, 'harvest_record'),
    (HarvestAllocation, 'harvest_allocation'),
    (Task, 'task'),
    (NoteAttachment, 'note_attachment'),
]

# Additional audit labels retain their persisted spellings. The complete-domain
# registry in project_restore includes these types in dependency order.
_ENTITY_TYPE_LABELS: dict[type, str] = {model: label for model, label in _RESTORABLE_ENTITY_TYPES} | {
    MediaFile: 'media_file',
    SeedPackage: 'seed_package',
    CropSupplierData: 'crop_supplier_data',
    CropTaskTemplate: 'croptasktemplate',
    SeasonPattern: 'seasonpattern',
}


def _canonical_entity_type(entity_type: str) -> str:
    return {'croptasktemplate': 'crop_task_template', 'seasonpattern': 'season_pattern'}.get(
        entity_type, entity_type,
    )


def _entity_type_for(instance) -> str:
    return _ENTITY_TYPE_LABELS.get(type(instance), type(instance).__name__.lower())


def _current_actor_label(request) -> str:
    return _user_actor_label(getattr(request, 'user', None))


def _user_actor_label(user: Any) -> str:
    if not user or not getattr(user, 'is_authenticated', False):
        return ''
    display_name = (getattr(user, 'display_name', '') or '').strip()
    label = (
        display_name or (user.get_full_name() or '').strip()
        or user.email or user.username or ''
    )
    return label[:EntityRevision._meta.get_field('user_name').max_length]


def _serialize_instance(instance) -> dict[str, Any]:
    """Serialize a single model instance's current DB row to a JSON-safe dict."""
    manager = getattr(type(instance), 'all_objects', None) or type(instance)._base_manager
    row = manager.filter(pk=instance.pk).values().first()
    if row is None:
        # Instance has already been deleted from the DB (hard delete) — fall back
        # to its still-populated in-memory field values.
        row = {field.attname: getattr(instance, field.attname) for field in instance._meta.concrete_fields}
    if isinstance(instance, Crop):
        # The crop's own timing windows are part of its revision (see Crop.save).
        row['timing_windows'] = instance.timing_window_snapshot()
    return json.loads(json.dumps(row, cls=DjangoJSONEncoder))


def _diff_changed_fields(previous: dict[str, Any], current: dict[str, Any]) -> list[str]:
    return [
        key for key, value in current.items()
        if key not in {'created_at', 'updated_at'} and previous.get(key) != value
    ]


def _entity_display_name(instance) -> str:
    if isinstance(instance, Crop):
        return format_crop_display_name(instance.name, instance.variety) or ''
    if isinstance(instance, PlantingPlan):
        crop_label = format_crop_display_name(instance.crop.name, instance.crop.variety) if instance.crop_id else None
        bed_label = instance.bed.name if instance.bed_id else None
        return ' / '.join(part for part in (crop_label, bed_label) if part)
    if isinstance(instance, (CropSupplierData, SeedPackage)):
        return format_crop_display_name(instance.crop.name, instance.crop.variety) if instance.crop_id else ''
    if isinstance(instance, CropCompanion):
        partner = instance.companion_crop.name if instance.companion_crop_id else (
            instance.companion_family_id or instance.companion_text
        )
        return ' / '.join(part for part in (instance.crop.name if instance.crop_id else '', partner) if part)
    if isinstance(instance, CropLoss):
        return _entity_display_name(instance.planting_plan)
    if isinstance(instance, Task | CropTaskTemplate):
        return instance.title or ''
    if isinstance(instance, Season):
        return instance.label or ''
    return getattr(instance, 'name', None) or ''


def start_batch_operation(
    *,
    project: Project,
    operation_type: str,
    context: dict[str, Any] | None = None,
    user_name: str = '',
    request_id: UUID | None = None,
    initiated_by_id: int | None = None,
) -> BatchOperation:
    """Create a BatchOperation to group the revisions of one cascading action.

    Pass the returned instance as `batch_operation` to every
    `record_entity_revision` / `record_revision` call the action triggers.
    """
    return BatchOperation.objects.create(
        project=project,
        operation_type=operation_type,
        context=context or {},
        user_name=user_name or '',
        request_id=request_id,
        initiated_by_id=initiated_by_id,
    )


def record_entity_revision(
    *,
    project: Project,
    entity_type: str,
    object_id: int,
    action: str,
    snapshot: dict[str, Any],
    display_name: str = '',
    changed_fields: list[str] | None = None,
    user_name: str = '',
    batch_operation: BatchOperation | None = None,
) -> None:
    if batch_operation is None:
        candidate = _active_batch.get()
        if candidate is not None and candidate.project_id == project.pk:
            batch_operation = candidate
            user_name = user_name or candidate.user_name
    if _internal_versions.get():
        snapshot = {**snapshot, "_project_version_internal": True}
    EntityRevision.objects.create(
        project=project,
        entity_type=entity_type,
        object_id=object_id,
        action=action,
        display_name=display_name or '',
        snapshot=snapshot,
        changed_fields=changed_fields if changed_fields is not None else ([EntityRevision.ACTION_CREATED] if action == EntityRevision.ACTION_CREATED else []),
        user_name=user_name or _revision_actor.get(),
        batch_operation=batch_operation,
    )


def record_completed_crop_revision(
    crop: Crop, *, action: str, before: dict[str, Any] | None = None,
    promoted: dict[str, Any] | None = None,
) -> None:
    snapshot = _serialize_instance(crop)
    changed_fields = None if before is None else _diff_changed_fields(before, snapshot)
    if promoted:
        snapshot[PROMOTED_CROP_FIELD_CHANGES] = promoted
        promoted_fields = [
            field for field, values in promoted['fields'].items()
            if values['old_value'] != values['new_value']
        ]
        changed_fields = list(dict.fromkeys([*(changed_fields or []), *promoted_fields]))
    record_entity_revision(
        project=crop.project, entity_type='crop', object_id=crop.pk, action=action,
        snapshot=snapshot, display_name=_entity_display_name(crop), changed_fields=changed_fields,
    )


_ENTITY_HISTORY_IGNORED_FIELDS = {
    'id',
    'created_at',
    'updated_at',
    'deleted_at',
    'project_id',
    'created_by_id',
    'updated_by_id',
    'name_normalized',
    'variety_normalized',
}


def _build_entity_revision_changes(
    snapshot: dict[str, Any],
    previous_snapshot: dict[str, Any] | None,
    changed_fields: list[str] | None,
) -> list[dict[str, Any]]:
    """Build displayable field changes from entity revision snapshots."""
    if not isinstance(snapshot, dict):
        return []

    if not isinstance(changed_fields, list):
        changed_fields = []

    promoted = snapshot.get(PROMOTED_CROP_FIELD_CHANGES, {}).get('fields', {})
    changes: list[dict[str, Any]] = []
    for field in changed_fields:
        if field in _ENTITY_HISTORY_IGNORED_FIELDS:
            continue
        if field == EntityRevision.ACTION_CREATED:
            changes.append({
                'field': field,
                'old_value': None,
                'new_value': True,
            })
            continue
        if field not in snapshot:
            continue

        if field in promoted:
            changes.append({'field': field, **promoted[field]})
            continue

        old_value = previous_snapshot.get(field) if isinstance(previous_snapshot, dict) else None
        changes.append({
            'field': field,
            'old_value': old_value,
            'new_value': snapshot.get(field),
        })

    return changes
