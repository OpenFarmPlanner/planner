"""Atomic project restoration with explicit absence and restorable checkpoints."""

import json
from contextlib import closing
from datetime import datetime
from typing import Any
from uuid import uuid4

from django.core.files.storage import default_storage
from django.core.serializers.json import DjangoJSONEncoder
from django.db import IntegrityError, connection, models, transaction
from django.db.models import Q
from django.db.models.deletion import Collector, ProtectedError
from django.db.models.functions import Cast, Length
from django.utils import timezone
from django.utils.crypto import constant_time_compare
from django.utils.dateparse import parse_datetime

from farm.models import (
    Crop,
    CropSupplierData,
    CropTaskTemplate,
    EntityRevision,
    MediaFile,
    Project,
    RetainedUpload,
    Season,
    SeasonPattern,
    SeedPackage,
    Supplier,
)
from farm.services.crop_inheritance import lock_crop_project
from farm.services.crop_media import reconcile_media_orphans
from farm.services.timing_windows import (
    TimingWindow,
    load_timing_window_index,
    sort_windows,
    validate_timing_window,
)
from farm.services.usage_capture import observe_restored_state

from .project_restore_impact import (
    restore_preview_token,
    summarize_restore,
    valid_preview_token_for_revision,
)
from .records import (
    _RESTORABLE_ENTITY_TYPES,
    _canonical_entity_type,
    record_entity_revision,
)
from .restore import (
    _model_manager,
    _restore_snapshot_children,
    _validate_restored_general_identities,
    _with_legacy_snapshot_fields,
    is_latest_project_revision,
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
ValidatedRows = dict[type, dict[int, dict[str, Any]]]
CHECKPOINT_KEY = "project_state_v1"
AUTOMATIC_BACKUP_KEY = "_automatic_restore_backup"
_TIMESTAMPS = {"created_at", "updated_at"}
MAX_PREVIEW_REVISIONS = 25_000
MAX_PREVIEW_ROWS = 15_000
MAX_PREVIEW_HISTORY_BYTES = 24 * 1024 * 1024
MAX_PREVIEW_STORAGE_CHECKS = 250


class ProjectStateEncoder(DjangoJSONEncoder):
    """Preserve creation-time evidence through backup/restore round trips."""

    def default(self, obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        return super().default(obj)


class ProjectRestoreConflict(Exception):
    """The historical state cannot be reconstructed or applied without guessing."""


class ProjectRestorePreviewChanged(ProjectRestoreConflict):
    """The current or target state differs from the confirmed preview."""


class ProjectRestorePreviewTooLarge(ProjectRestoreConflict):
    """The selected project exceeds the synchronous preview budget."""


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
    return json.loads(json.dumps(state, cls=ProjectStateEncoder))


def record_project_checkpoint(
    project: Project,
    state: ProjectState,
    *,
    user_name: str = "",
    batch_operation: Any = None,
    action: str = EntityRevision.ACTION_RESTORED,
    automatic_backup: bool = False,
    restore_from: ProjectState | None = None,
) -> None:
    """A complete checkpoint makes a restore result and its backup selectable again."""
    snapshot = {CHECKPOINT_KEY: state}
    if automatic_backup:
        snapshot[AUTOMATIC_BACKUP_KEY] = True
    revision = record_entity_revision(
        project=project,
        entity_type="project",
        object_id=project.pk,
        action=action,
        snapshot=snapshot,
        display_name=project.name,
        user_name=user_name,
        batch_operation=batch_operation,
    )
    if restore_from is not None:
        observe_restored_state(revision, restore_from, state)


def ensure_project_checkpoint(project: Project, *, user_name: str = "") -> None:
    """Establish one complete baseline before ordinary API mutations, not per row."""
    checkpoints = EntityRevision.objects.filter(
        project=project,
        entity_type="project",
        snapshot__has_key=CHECKPOINT_KEY,
    )
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
    if CHECKPOINT_KEY not in snapshot:
        return None
    if not isinstance(state, dict):
        raise ProjectRestoreConflict("incompatible checkpoint")
    # Older checkpoints predate the loss table or both dated event features.
    for added in ({"crop_loss"}, {"crop_loss", "harvest_record", "harvest_allocation"}):
        if set(state) == set(_MODELS) - added:
            return {**state, **{label: {} for label in added}}
    if set(state) != set(_MODELS):
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
    # A complete checkpoint records every managed row at one instant. Its
    # omissions are authoritative even if a later restore recreated a row
    # with an older creation timestamp. Replays to other revisions still
    # need the conservative evidence checks.
    if revision.entity_type != "project" or CHECKPOINT_KEY not in revision.snapshot:
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
            (
                entity_type in {"crop_task_template", "season"}
                or (entity_type == "task" and row.snapshot.get("source_key"))
            )
            and row.action == EntityRevision.ACTION_DELETED
            and row.snapshot.get("deleted_at") is None
        ):
            raise ProjectRestoreConflict("legacy soft deletion has no complete after-state")
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
    for model, label in PROJECT_STATE_MODELS:
        unknown = {
            pk for pk in current[label] if (label, pk) not in seen and pk not in state[label]
        }
        if not unknown:
            continue
        fields = {field.name for field in model._meta.concrete_fields}
        creation_field = next(
            (name for name in ("created_at", "uploaded_at") if name in fields), None
        )
        if creation_field is None:
            raise ProjectRestoreConflict("incomplete historical evidence")
        # JSON snapshots truncate timestamps to milliseconds. Read the locked
        # live rows to prove creation after a target within that same millisecond.
        created = dict(
            _model_manager(model)
            .filter(project=project, pk__in=unknown)
            .values_list("pk", creation_field)
        )
        if len(created) != len(unknown) or any(
            value is None or value <= revision.created_at for value in created.values()
        ):
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


def _validated_target(
    project: Project, state: ProjectState, current: ProjectState,
) -> ValidatedRows:
    target = _validated_rows(project, state)
    _validate_restored_general_identities(
        {int(pk): row for pk, row in current["crop"].items()},
        {pk: row for pk, row in target[Crop].items() if row.get("deleted_at") is None},
    )
    return target


def apply_project_state(
    project: Project, state: ProjectState, current: ProjectState,
    *, validated_target: ValidatedRows | None = None,
) -> None:
    """Apply a validated state or roll back the entire transaction on any conflict."""
    target = validated_target if validated_target is not None else _validated_target(
        project, state, current,
    )
    crop_rows = target[Crop]
    _prepare_restored_uploads(project, state, current)
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
    reconcile_media_orphans(project.pk)


def _prepare_restored_uploads(project: Project, state: ProjectState, current: ProjectState) -> None:
    retain_upload_paths(project, _uploads_to_retain(state, current, lock=True))


def _uploads_to_retain(
    state: ProjectState, current: ProjectState, *, lock: bool = False,
    max_checks: int | None = None,
) -> set[str]:
    def paths(snapshot: ProjectState) -> set[str]:
        return {
            row[field]
            for label, field in (("media_file", "storage_path"), ("note_attachment", "image"))
            for row in snapshot[label].values()
            if row.get(field)
        }

    restored_images = _live_crop_image_ids(state)
    current_images = _live_crop_image_ids(current)
    legacy_ids = (
        (set(restored_images.values()) - state['media_file'].keys())
        | (set(current_images.values()) - current['media_file'].keys())
    )
    legacy_media = MediaFile.objects.filter(pk__in=legacy_ids, project__isnull=True).order_by('pk')
    if lock:
        legacy_media = legacy_media.select_for_update()
    legacy_paths = {str(pk): path for pk, path in legacy_media.values_list('pk', 'storage_path')}
    restored = _live_upload_references(state, restored_images, legacy_paths)
    before = _live_upload_references(current, current_images, legacy_paths)
    restored_paths, current_paths = paths(state), paths(current)
    added_paths = (restored_paths - current_paths) | {
        path for reference, path in restored.items() if before.get(reference) != path
    }
    if max_checks is not None and len(added_paths) > max_checks:
        raise ProjectRestorePreviewTooLarge("too many historical files to check in a preview")
    if any(not path or not default_storage.exists(path) for path in added_paths):
        raise ProjectRestoreConflict("historical image is no longer available in storage")

    # A restore can keep the media row and its historical orphan timestamp while
    # disconnecting an image the automatic backup still needs.
    detached = set(filter(None, before.values())) - set(restored.values())
    return (current_paths - restored_paths) | detached


def _live_crop_image_ids(state: ProjectState) -> dict[str, str]:
    return {
        key: str(row['image_file_id']) for key, row in state['crop'].items()
        if row.get('image_file_id') is not None and row.get('deleted_at') is None
    }


def _live_upload_references(
    state: ProjectState, crop_images: dict[str, str], legacy_paths: dict[str, str],
) -> dict[tuple[str, str], str]:
    paths = {
        **legacy_paths, **{key: row['storage_path'] for key, row in state['media_file'].items()},
    }
    return {
        **{('crop', key): paths[media] for key, media in crop_images.items() if media in paths},
        **{
            ('note_attachment', key): row['image'] for key, row in state['note_attachment'].items()
            if row.get('image')
        },
    }


def retain_upload_paths(project: Project, paths: set[str]) -> None:
    """Keep removed bytes recoverable until the history retention window expires."""
    removed_at = timezone.now()
    RetainedUpload.objects.bulk_create(
        [
            RetainedUpload(project=project, storage_path=path, removed_at=removed_at)
            for path in paths
        ],
        update_conflicts=True,
        unique_fields=["storage_path"],
        update_fields=["project", "removed_at"],
    )


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
                # Supplier unlink undo can recreate these IDs with a different creation time.
                if model in (Supplier, CropSupplierData) and "created_at" in row:
                    values["created_at"] = row["created_at"]
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


def _effective_target(
    state: ProjectState, current: ProjectState, target: ValidatedRows,
) -> ProjectState:
    effective = {label: {} for _model, label in PROJECT_STATE_MODELS}
    for model, label in PROJECT_STATE_MODELS:
        for pk, values in target[model].items():
            key = str(pk)
            # An older snapshot may lack fields added later. The write preserves
            # those fields on surviving records and uses defaults on new rows.
            row = {**current[label].get(key, {}), **values}
            if model is Crop and "timing_windows" in state[label][key]:
                windows = [
                    TimingWindow.from_dict(window)
                    for window in state[label][key]["timing_windows"] or []
                ]
                if any(validate_timing_window(window) for window in windows):
                    raise ProjectRestoreConflict("invalid historical crop timing window")
                row["timing_windows"] = [window.as_dict() for window in sort_windows(windows)]
            effective[label][key] = row
    return effective


def _validate_preview_removals_and_identities(
    project: Project, current: ProjectState, target: ValidatedRows,
) -> None:
    for model, label in PROJECT_STATE_MODELS:
        manager = _model_manager(model)
        live_ids = set(map(int, current[label]))
        removed = live_ids - target[model].keys()
        if removed and model is not Crop:
            _validate_delete(project, list(manager.filter(project=project, pk__in=removed)))
        recreated = target[model].keys() - live_ids
        if recreated and manager.filter(pk__in=recreated).exists():
            raise ProjectRestoreConflict("historical identity belongs to another project")


def _locked_preview_revision(project: Project, revision_id: int) -> EntityRevision:
    selected = EntityRevision.objects.select_for_update().filter(
        project=project, pk=revision_id,
    ).first()
    if (
        selected is None or selected.snapshot.get("_project_version_internal")
        or is_latest_project_revision(project, selected)
    ):
        raise ProjectRestorePreviewChanged("historical revision is no longer available")
    return selected


def _bounded_row_count(queryset, limit: int) -> int:
    observed = queryset.order_by().values("pk")[:limit + 1].count()
    if observed > limit:
        raise ProjectRestorePreviewTooLarge("too many records to preview")
    return observed


def _check_preview_size(project: Project) -> None:
    revisions = EntityRevision.objects.filter(project=project)
    _bounded_row_count(revisions, MAX_PREVIEW_REVISIONS)
    # Stop at the payload budget without importing snapshots into Python. Count
    # decoded bytes so large compressed snapshots still consume their full budget.
    size = (
        models.Func(
            Cast("snapshot", models.TextField()),
            function="octet_length",
            output_field=models.IntegerField(),
        )
        if connection.vendor == "postgresql" else Length(Cast("snapshot", models.BinaryField()))
    )
    remaining_bytes = MAX_PREVIEW_HISTORY_BYTES
    encoded_sizes = revisions.order_by().values_list(size, flat=True).iterator(chunk_size=50)
    with closing(encoded_sizes) as sizes:
        for snapshot_bytes in sizes:
            remaining_bytes -= snapshot_bytes
            if remaining_bytes < 0:
                raise ProjectRestorePreviewTooLarge("historical snapshots are too large to preview")
    remaining = MAX_PREVIEW_ROWS
    for model, _label in PROJECT_STATE_MODELS:
        remaining -= _bounded_row_count(_model_manager(model).filter(project=project), remaining)


def _check_preview_target_size(state: ProjectState) -> None:
    if sum(len(rows) for rows in state.values()) > MAX_PREVIEW_ROWS:
        raise ProjectRestorePreviewTooLarge("historical target has too many records")


def preview_project_restore(project: Project, revision_id: int) -> dict:
    """Read and validate the same historical state the restore would apply."""
    try:
        with transaction.atomic():
            lock_crop_project(project.pk)
            _check_preview_size(project)
            revision = _locked_preview_revision(project, revision_id)
            current = capture_project_state(project)
            state = reconstruct_project_state(project, revision, current)
            _check_preview_target_size(state)
            target = _validated_target(project, state, current)
            _validate_preview_removals_and_identities(project, current, target)
            _uploads_to_retain(state, current, max_checks=MAX_PREVIEW_STORAGE_CHECKS)
            effective = _effective_target(state, current, target)
            return {
                "token": restore_preview_token(project.pk, revision.pk, current, effective),
                "impact": summarize_restore(current, effective),
            }
    except (ValueError, TypeError, KeyError, AttributeError) as exc:
        raise ProjectRestoreConflict("incompatible historical state") from exc


def restore_project_version(
    project: Project, revision: EntityRevision, *, user_name: str = "",
    preview_token: str | None = None,
) -> None:
    """Save an exact backup and result, and never publish a partial restore."""
    if revision.project_id != project.pk:
        raise ProjectRestoreConflict("wrong project")
    if preview_token is not None and not valid_preview_token_for_revision(
        preview_token, project.pk, revision.pk,
    ):
        raise ProjectRestorePreviewChanged("preview does not match the selected version")
    try:
        with transaction.atomic():
            lock_crop_project(project.pk)
            if preview_token is not None:
                _check_preview_size(project)
                revision = _locked_preview_revision(project, revision.pk)
            current = capture_project_state(project, lock=True)
            state = reconstruct_project_state(project, revision, current)
            if preview_token is not None:
                _check_preview_target_size(state)
            target = _validated_target(project, state, current)
            if preview_token is not None:
                effective = _effective_target(state, current, target)
                expected = restore_preview_token(project.pk, revision.pk, current, effective)
                if not constant_time_compare(preview_token, expected):
                    raise ProjectRestorePreviewChanged("preview no longer matches the project")
            record_project_checkpoint(
                project, current, user_name=user_name,
                action=EntityRevision.ACTION_UPDATED, automatic_backup=True,
            )
            apply_project_state(project, state, current, validated_target=target)
            record_project_checkpoint(
                project, capture_project_state(project), user_name=user_name, restore_from=current,
            )
    except (IntegrityError, ValueError, TypeError, KeyError, AttributeError) as exc:
        raise ProjectRestoreConflict("incompatible historical state") from exc
