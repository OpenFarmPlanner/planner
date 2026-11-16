"""Atomic project restoration with explicit absence and restorable checkpoints."""

import json
from typing import Any
from uuid import uuid4

from django.core.serializers.json import DjangoJSONEncoder
from django.db import IntegrityError, models, transaction
from django.db.models import Q
from django.db.models.deletion import Collector, ProtectedError
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from farm.models import (
    Crop,
    CropSupplierData,
    CropTaskTemplate,
    EntityRevision,
    MediaFile,
    Project,
    Season,
    SeasonPattern,
    SeedPackage,
)
from farm.services.crop_inheritance import lock_crop_project
from farm.services.timing_windows import load_timing_window_index

from .records import _RESTORABLE_ENTITY_TYPES, _canonical_entity_type, record_entity_revision
from .restore import (
    _model_manager,
    _restore_snapshot_children,
    _validate_restored_general_identities,
    _with_legacy_snapshot_fields,
)

PROJECT_STATE_MODELS = [(MediaFile, "media_file")]
for _model, _label in _RESTORABLE_ENTITY_TYPES:
    if _model is Season:
        PROJECT_STATE_MODELS.append((SeasonPattern, "season_pattern"))
    PROJECT_STATE_MODELS.append((_model, _label))
    if _model is Crop:
        PROJECT_STATE_MODELS.extend(
            [
                (CropSupplierData, "crop_supplier_data"),
                (SeedPackage, "seed_package"),
                (CropTaskTemplate, "crop_task_template"),
            ]
        )
_MODELS = dict((label, model) for model, label in PROJECT_STATE_MODELS)
ProjectState = dict[str, dict[str, dict[str, Any]]]
CHECKPOINT_KEY = "project_state_v1"
_TIMESTAMPS = {"created_at", "updated_at"}


class ProjectRestoreConflict(Exception):
    """The historical state cannot be reconstructed or applied without guessing."""


def capture_project_state(project: Project, *, lock: bool = False) -> ProjectState:
    """Capture domain rows, including soft-deleted rows and crop-owned windows."""
    state: ProjectState = {}
    for model, label in PROJECT_STATE_MODELS:
        queryset = _model_manager(model).filter(project=project).order_by("pk")
        if lock:
            queryset = queryset.select_for_update()
        rows = list(queryset.values())
        if model is Crop:
            windows = load_timing_window_index([row["id"] for row in rows])
            for row in rows:
                row["timing_windows"] = [window.as_dict() for window in windows.get(row["id"], [])]
        state[label] = {str(row["id"]): row for row in rows}
    return json.loads(json.dumps(state, cls=DjangoJSONEncoder))


def record_project_checkpoint(
    project: Project,
    state: ProjectState,
    *,
    user_name: str = "",
    batch_operation: Any = None,
    action: str = EntityRevision.ACTION_RESTORED,
) -> None:
    """A complete checkpoint makes a restore result and its backup selectable again."""
    record_entity_revision(
        project=project,
        entity_type="project",
        object_id=project.pk,
        action=action,
        snapshot={CHECKPOINT_KEY: state},
        display_name=project.name,
        user_name=user_name,
        batch_operation=batch_operation,
    )


def ensure_project_checkpoint(project: Project, *, user_name: str = "") -> None:
    """Establish one complete baseline before ordinary API mutations, not per row."""
    checkpoints = EntityRevision.objects.filter(
        project=project,
        entity_type="project",
        snapshot__has_key=CHECKPOINT_KEY,
    )
    if checkpoints.exists():
        return
    with transaction.atomic():
        lock_crop_project(project.pk)
        if not checkpoints.exists():
            record_project_checkpoint(
                project,
                capture_project_state(project, lock=True),
                user_name=user_name,
                action=EntityRevision.ACTION_UPDATED,
            )


def _through_revision(revision: EntityRevision) -> Q:
    return Q(created_at__lt=revision.created_at) | Q(
        created_at=revision.created_at, id__lte=revision.pk
    )


def _checkpoint_state(snapshot: dict[str, Any]) -> ProjectState | None:
    state = snapshot.get(CHECKPOINT_KEY)
    if state is None:
        return None
    if not isinstance(state, dict) or set(state) != set(_MODELS):
        raise ProjectRestoreConflict("incompatible checkpoint")
    return state


def reconstruct_project_state(
    project: Project,
    revision: EntityRevision,
    current: ProjectState,
) -> ProjectState:
    """Reconstruct at an exact (timestamp, id); unknown is never inferred as absent."""
    state, seen, checkpoint = _revision_overlay(project, revision)
    if checkpoint is not None:
        for label, objects in checkpoint.items():
            state[label].update(
                {pk: snapshot for pk, snapshot in objects.items() if (label, pk) not in seen}
            )
    _apply_recorded_parent_deletions(state, seen)
    _require_legacy_evidence(project, revision, current, seen, state)
    return state


def _revision_overlay(
    project: Project, revision: EntityRevision
) -> tuple[ProjectState, set[tuple[str, str]], ProjectState | None]:
    state: ProjectState = {label: {} for label in _MODELS}
    seen: set[tuple[str, str]] = set()
    baseline = (
        EntityRevision.objects.filter(
            project=project,
            entity_type="project",
            snapshot__has_key=CHECKPOINT_KEY,
        )
        .filter(_through_revision(revision))
        .order_by("-created_at", "-id")
        .first()
    )
    checkpoint = _checkpoint_state(baseline.snapshot) if baseline else None
    rows = (
        EntityRevision.objects.filter(project=project)
        .filter(_through_revision(revision))
        .order_by("-created_at", "-id")
    )
    if baseline:
        rows = rows.exclude(_through_revision(baseline))
    for row in rows.iterator(chunk_size=50):
        if row.entity_type == "project" and row.action == EntityRevision.ACTION_RESTORED:
            raise ProjectRestoreConflict("legacy restore has no resulting-state checkpoint")
        entity_type = _canonical_entity_type(row.entity_type)
        key = (entity_type, str(row.object_id))
        if entity_type not in _MODELS or key in seen:
            continue
        seen.add(key)
        if (
            row.entity_type == "croptasktemplate"
            and row.action == EntityRevision.ACTION_DELETED
            and row.snapshot.get("deleted_at") is None
        ):
            raise ProjectRestoreConflict("legacy template deletion has no complete after-state")
        soft_deleted = row.snapshot.get("deleted_at") is not None and any(
            field.name == "deleted_at" for field in _MODELS[entity_type]._meta.concrete_fields
        )
        if row.action != EntityRevision.ACTION_DELETED or soft_deleted:
            state[entity_type][key[1]] = row.snapshot
    return state, seen, checkpoint


def _references_recorded_absence(
    field: models.Field, snapshot: dict[str, Any], absent: set[tuple[str, str]]
) -> bool:
    if field.remote_field is None:
        return False
    label = next(
        (label for model, label in PROJECT_STATE_MODELS if model is field.remote_field.model), None
    )
    return (label, str(snapshot.get(field.attname))) in absent


def _apply_recorded_parent_deletions(state: ProjectState, seen: set[tuple[str, str]]) -> None:
    """Replay FK effects only when a parent's deletion is positively recorded."""
    absent = {(label, pk) for label, pk in seen if pk not in state[label]}
    for model, label in PROJECT_STATE_MODELS:
        for pk, snapshot in list(state[label].items()):
            for field in model._meta.concrete_fields:
                if not _references_recorded_absence(field, snapshot, absent):
                    continue
                if field.remote_field.on_delete is models.SET_NULL and field.null:
                    snapshot[field.attname] = None
                elif field.remote_field.on_delete is models.CASCADE:
                    state[label].pop(pk)
                    absent.add((label, pk))
                    seen.add((label, pk))
                    break
                else:
                    raise ProjectRestoreConflict("inconsistent protected historical relation")


def _require_legacy_evidence(
    project: Project,
    revision: EntityRevision,
    current: ProjectState,
    seen: set[tuple[str, str]],
    state: ProjectState,
) -> None:
    for label, objects in current.items():
        for pk, snapshot in objects.items():
            if (label, pk) in seen or pk in state[label]:
                continue
            created_at = snapshot.get("created_at") or snapshot.get("uploaded_at")
            if not created_at or parse_datetime(created_at) <= revision.created_at:
                raise ProjectRestoreConflict("incomplete historical evidence")
    future_keys: set[tuple[str, str]] = set()
    for row in (
        EntityRevision.objects.filter(project=project)
        .exclude(_through_revision(revision))
        .order_by("created_at", "id")
    ):
        entity_type = _canonical_entity_type(row.entity_type)
        key = (entity_type, str(row.object_id))
        if entity_type not in _MODELS or key in seen or key in future_keys:
            continue
        future_keys.add(key)
        if key[1] in state[entity_type]:
            continue
        created_at = row.snapshot.get("created_at") or row.snapshot.get("uploaded_at")
        if created_at and parse_datetime(created_at) > revision.created_at:
            continue
        if row.action != EntityRevision.ACTION_CREATED:
            raise ProjectRestoreConflict("missing pre-change history")


def _validated_rows(project: Project, state: ProjectState) -> dict[type, dict[int, dict[str, Any]]]:
    result: dict[type, dict[int, dict[str, Any]]] = {}
    for model, label in PROJECT_STATE_MODELS:
        result[model] = {}
        for key, snapshot in state[label].items():
            if (
                not isinstance(snapshot, dict)
                or str(snapshot.get("id")) != key
                or snapshot.get("project_id") != project.pk
            ):
                raise ProjectRestoreConflict("invalid historical ownership")
            fields = {field.attname for field in model._meta.concrete_fields}
            row = {
                key: value
                for key, value in _with_legacy_snapshot_fields(model, snapshot).items()
                if key in fields
            }
            if model is Crop:
                from farm.utils import normalize_text

                row["name_normalized"] = normalize_text(row["name"]) or ""
                row["variety_normalized"] = normalize_text(row.get("variety"))
            result[model][int(key)] = row
    _validate_relations(result)
    return result


def _validate_relations(result: dict[type, dict[int, dict[str, Any]]]) -> None:
    external, media = _external_reference_indexes(result)
    for model, rows in result.items():
        for row in rows.values():
            for field in model._meta.concrete_fields:
                if field.remote_field is None or row.get(field.attname) is None:
                    continue
                _validate_reference(field, row, result, external, media)


def _external_reference_indexes(
    result: dict[type, dict[int, dict[str, Any]]],
) -> tuple[dict[type, set[Any]], dict[int, int | None]]:
    wanted: dict[type, set[Any]] = {}
    for model, rows in result.items():
        for field in model._meta.concrete_fields:
            if field.remote_field is None:
                continue
            related = field.remote_field.model
            if related not in result or related is MediaFile:
                wanted.setdefault(related, set()).update(
                    {row.get(field.attname) for row in rows.values()} - {None}
                )
    external = {
        model: set(model._base_manager.filter(pk__in=ids).values_list("pk", flat=True))
        for model, ids in wanted.items()
        if model is not MediaFile
    }
    media = dict(
        MediaFile.objects.filter(pk__in=wanted.get(MediaFile, set())).values_list(
            "pk", "project_id"
        )
    )
    return external, media


def _validate_reference(
    field: models.Field,
    row: dict[str, Any],
    result: dict[type, dict[int, dict[str, Any]]],
    external: dict[type, set[Any]],
    media: dict[int, int | None],
) -> None:
    related, value = field.remote_field.model, row[field.attname]
    if related not in result:
        if value not in external[related]:
            if not field.null:
                raise ProjectRestoreConflict("missing required external reference")
            row[field.attname] = None
        return
    if value in result[related]:
        return
    if related is MediaFile:
        if value in media and media[value] is None:
            return
        if value not in media and field.null:
            row[field.attname] = None
            return
    raise ProjectRestoreConflict("missing historical dependency")


def _validate_delete(project: Project, instances: list[models.Model]) -> None:
    if not instances:
        return
    collector = Collector(using="default")
    try:
        collector.collect(instances)
    except ProtectedError as exc:
        raise ProjectRestoreConflict("protected dependent data") from exc
    collected = list(collector.data.items()) + [
        (queryset.model, queryset) for queryset in collector.fast_deletes
    ]
    for model, objects in collected:
        if model._meta.model_name == "croptimingwindow":
            continue
        if model not in _MODELS.values() or any(obj.project_id != project.pk for obj in objects):
            raise ProjectRestoreConflict("untracked dependent data")
    for (_field, _value), groups in collector.field_updates.items():
        for objects in groups:
            if any(
                type(obj) not in _MODELS.values() or obj.project_id != project.pk for obj in objects
            ):
                raise ProjectRestoreConflict("external dependent data")


def apply_project_state(project: Project, state: ProjectState, current: ProjectState) -> None:
    """Apply a validated state or roll back the entire transaction on any conflict."""
    target = _validated_rows(project, state)
    crop_rows = target[Crop]
    _validate_restored_general_identities(
        {int(pk): row for pk, row in current["crop"].items()},
        {pk: row for pk, row in crop_rows.items() if row.get("deleted_at") is None},
    )
    for model, label in reversed(PROJECT_STATE_MODELS):
        removed = set(map(int, current[label])) - set(target[model])
        queryset = _model_manager(model).filter(project=project, pk__in=removed)
        if model is Crop:
            # Keep crop identity/provenance and drain-only legacy audit records.
            queryset.update(deleted_at=timezone.now())
        else:
            _validate_delete(project, list(queryset))
            queryset.delete()
    # Parent deletion can cascade or clear FKs on rows the inverse will restore.
    current = capture_project_state(project)
    prefix = f"restore{uuid4().hex}"
    for pk in crop_rows.keys() & set(map(int, current["crop"])):
        if state["crop"][str(pk)] != current["crop"][str(pk)]:
            Crop.all_objects.filter(project=project, pk=pk).update(name_normalized=f"{prefix}{pk}")
    _write_target_rows(project, target, state, current)


def _write_target_rows(
    project: Project,
    target: dict[type, dict[int, dict[str, Any]]],
    state: ProjectState,
    current: ProjectState,
) -> None:
    for model, _label in PROJECT_STATE_MODELS:
        manager = _model_manager(model)
        for pk, row in target[model].items():
            if str(pk) in current[_label]:
                if state[_label][str(pk)] == current[_label][str(pk)]:
                    continue
                values = {
                    key: value for key, value in row.items() if key not in {"id", *_TIMESTAMPS}
                }
                if "updated_at" in row:
                    values["updated_at"] = timezone.now()
                manager.filter(project=project, pk=pk).update(**values)
            else:
                if manager.filter(pk=pk).exists():
                    raise ProjectRestoreConflict("historical identity belongs to another project")
                manager.bulk_create([model(**row)])
                creation = {key: row[key] for key in ("created_at", "uploaded_at") if key in row}
                if creation:
                    manager.filter(project=project, pk=pk).update(**creation)
            _restore_snapshot_children(model, pk, state[_label][str(pk)])


def restore_project_version(
    project: Project, revision: EntityRevision, *, user_name: str = ""
) -> None:
    """Save an exact backup and result, and never publish a partial restore."""
    if revision.project_id != project.pk:
        raise ProjectRestoreConflict("wrong project")
    try:
        with transaction.atomic():
            lock_crop_project(project.pk)
            current = capture_project_state(project, lock=True)
            target = reconstruct_project_state(project, revision, current)
            record_project_checkpoint(
                project, current, user_name=user_name, action=EntityRevision.ACTION_UPDATED
            )
            apply_project_state(project, target, current)
            record_project_checkpoint(project, capture_project_state(project), user_name=user_name)
    except (IntegrityError, ValueError, TypeError, KeyError, AttributeError) as exc:
        raise ProjectRestoreConflict("incompatible historical state") from exc
