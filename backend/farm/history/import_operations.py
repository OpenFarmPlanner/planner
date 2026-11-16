"""Server-owned import groups and a guarded, atomic inverse of their own writes."""

from collections.abc import Callable
from copy import deepcopy
from datetime import timedelta
from typing import Any
from uuid import UUID

from django.db import IntegrityError, transaction
from django.db.models.deletion import Collector, ProtectedError
from django.utils import timezone

from farm.models import BatchOperation, EntityRevision, Project
from farm.services.crop_inheritance import GeneralCropIdentityConflict, lock_crop_project

from .project_restore import (
    PROJECT_STATE_MODELS,
    ProjectRestoreConflict,
    ProjectState,
    _validated_rows,
    apply_project_state,
    capture_project_state,
    record_project_checkpoint,
)
from .records import (
    _canonical_entity_type,
    _entity_display_name,
    record_entity_revision,
    revision_batch,
    start_batch_operation,
)
from .restore import _validate_restored_general_identities

_MODELS = dict((label, model) for model, label in PROJECT_STATE_MODELS)
_INTERNAL = "_import_changes"


class ImportOperationConflict(Exception):
    """An import group does not belong to this actor/project or is already closed."""

    def __init__(self, message: str, *, code: str = "crop_import_operation_unavailable") -> None:
        super().__init__(message)
        self.code = code


def _content(snapshot: dict[str, Any] | None) -> dict[str, Any] | None:
    return (
        None
        if snapshot is None
        else {
            key: value for key, value in snapshot.items() if key not in {"updated_at", "created_at"}
        }
    )


def _record_changes(
    project: Project,
    before: ProjectState,
    after: ProjectState,
    batch: BatchOperation,
) -> None:
    changes = batch.context.setdefault(_INTERNAL, {})
    existing = {
        (_canonical_entity_type(label), pk)
        for label, pk in batch.revisions.values_list("entity_type", "object_id")
    }
    for model, label in PROJECT_STATE_MODELS:
        for pk in before[label].keys() | after[label].keys():
            old, new = before[label].get(pk), after[label].get(pk)
            previous = changes.get(label, {}).get(pk)
            if previous is not None and old != new:
                if previous["after"] != old:
                    previous["interleaved_edit"] = True
                previous["after"] = new
            if _content(old) == _content(new):
                continue
            if previous is None:
                changes.setdefault(label, {})[pk] = {"before": old, "after": new}
            if (label, int(pk)) in existing:
                continue
            snapshot = new or old
            instance = model(
                **{
                    key: value
                    for key, value in snapshot.items()
                    if key in {field.attname for field in model._meta.concrete_fields}
                }
            )
            record_entity_revision(
                project=project,
                entity_type=label,
                object_id=int(pk),
                action=EntityRevision.ACTION_CREATED
                if old is None
                else EntityRevision.ACTION_DELETED
                if new is None
                else EntityRevision.ACTION_UPDATED,
                snapshot=snapshot,
                display_name=_entity_display_name(instance),
                changed_fields=[
                    key
                    for key in snapshot
                    if old is None or new is None or old.get(key) != new.get(key)
                ],
                batch_operation=batch,
                user_name=batch.user_name,
            )


def _create_import_batch(
    project: Project, identifier: UUID, actor_id: int, actor_label: str
) -> BatchOperation:
    try:
        with transaction.atomic():
            return start_batch_operation(
                project=project,
                operation_type=BatchOperation.TYPE_CROP_IMPORT,
                user_name=actor_label,
                request_id=identifier,
                initiated_by_id=actor_id,
            )
    except IntegrityError as exc:
        raise ImportOperationConflict("import identifier is already in use") from exc


def execute_import_request(
    project: Project,
    *,
    request_id: Any,
    actor_id: int,
    actor_label: str,
    phase: str | None,
    run: Callable[[], dict[str, Any]],
) -> dict[str, Any]:
    """One logical client UUID groups all HTTP batches without timestamp heuristics."""
    if request_id is None:
        return run()
    try:
        identifier = UUID(str(request_id))
    except (ValueError, TypeError, AttributeError) as exc:
        raise ImportOperationConflict("invalid import identifier") from exc
    with transaction.atomic():
        lock_crop_project(project.pk)
        batch = BatchOperation.objects.select_for_update().filter(request_id=identifier).first()
        if batch is None:
            if phase not in (None, "crops", "finalize"):
                raise ImportOperationConflict("unknown import operation")
            batch = _create_import_batch(project, identifier, actor_id, actor_label)
        elif (
            batch.project_id != project.pk
            or batch.initiated_by_id != actor_id
            or batch.operation_type != BatchOperation.TYPE_CROP_IMPORT
            or batch.completed_at is not None
            or batch.reverted_at is not None
            or batch.created_at < timezone.now() - timedelta(days=1)
        ):
            raise ImportOperationConflict("import operation is unavailable")
        before = capture_project_state(project, lock=True)
        with revision_batch(batch):
            record_project_checkpoint(
                project, before, batch_operation=batch, action=EntityRevision.ACTION_UPDATED
            )
            summary = run()
            after = capture_project_state(project)
            _record_changes(project, before, after, batch)
            record_project_checkpoint(project, after, batch_operation=batch)
        statuses = batch.context.setdefault("_crop_statuses", {})
        for receipt in summary.get("results", []):
            if receipt["status"] in ("created", "updated"):
                key = str(receipt["crop_id"])
                if statuses.get(key) != "created":
                    statuses[key] = receipt["status"]
        batch.context["created_count"] = sum(status == "created" for status in statuses.values())
        batch.context["updated_count"] = sum(status == "updated" for status in statuses.values())
        batch.context["skipped_count"] = batch.context.get("skipped_count", 0) + summary.get(
            "skipped_count", 0
        )
        if phase in (None, "finalize"):
            batch.completed_at = timezone.now()
        batch.save()
        return summary


def import_undo_preview(project: Project, batch: BatchOperation) -> dict[str, Any]:
    """Return user-facing counts and conflicts; execution recomputes this under locks."""
    changes = batch.context.get(_INTERNAL)
    if batch.operation_type != BatchOperation.TYPE_CROP_IMPORT or not isinstance(changes, dict):
        raise ImportOperationConflict("not an import group")
    if batch.reverted_at is not None:
        raise ImportOperationConflict("already undone", code="crop_import_already_undone")
    current = capture_project_state(project)
    conflicts = []
    deleting: set[tuple[type, int]] = set()
    created = updated = 0
    for label, rows in changes.items():
        if label not in _MODELS:
            raise ImportOperationConflict("incompatible import history")
        for pk, change in rows.items():
            is_created = change["before"] is None
            if label == "crop":
                created += int(is_created)
                updated += int(not is_created)
            if change.get("interleaved_edit") or current[label].get(pk) != change["after"]:
                conflicts.append({"code": "later_edit", "object_type": label, "object_id": int(pk)})
            if is_created:
                deleting.add((_MODELS[label], int(pk)))
    reverting = {(_MODELS[label], int(pk)) for label, rows in changes.items() for pk in rows}
    conflicts.extend(_dependency_conflicts(project, deleting, reverting))
    if not conflicts and not _inverse_is_compatible(project, current, changes):
        conflicts.append(
            {"code": "unavailable_state", "object_type": "crop_import", "object_id": batch.pk}
        )
    conflicts = _named_conflicts(conflicts, current, changes)
    return {"created_count": created, "updated_count": updated, "conflicts": conflicts}


def _inverse_is_compatible(
    project: Project, current: ProjectState, changes: dict[str, Any]
) -> bool:
    from farm.models import Crop

    try:
        target = _validated_rows(project, _inverse_state(current, changes))
        _validate_restored_general_identities(
            {int(pk): row for pk, row in current["crop"].items()},
            {pk: row for pk, row in target[Crop].items() if row.get("deleted_at") is None},
        )
        return True
    except (ProjectRestoreConflict, GeneralCropIdentityConflict, KeyError, ValueError, TypeError):
        return False


def _inverse_state(current: ProjectState, changes: dict[str, Any]) -> ProjectState:
    target = deepcopy(current)
    for label, rows in changes.items():
        for pk, change in rows.items():
            if change["before"] is None:
                target[label].pop(pk, None)
            else:
                target[label][pk] = change["before"]
    return target


def _named_conflicts(
    conflicts: list[dict[str, Any]], current: ProjectState, changes: dict[str, Any]
) -> list[dict[str, Any]]:
    unique = {}
    for conflict in conflicts:
        label, pk = conflict["object_type"], str(conflict["object_id"])
        snapshot = (
            current.get(label, {}).get(pk) or changes.get(label, {}).get(pk, {}).get("after") or {}
        )
        name = snapshot.get("name") or snapshot.get("title") or ""
        if name and snapshot.get("variety"):
            name = f"{name} ({snapshot['variety']})"
        unique[(conflict["code"], label, pk)] = {**conflict, "object_display_name": name}
    return list(unique.values())


def _dependency_conflicts(
    project: Project,
    deleting: set[tuple[type, int]],
    reverting: set[tuple[type, int]],
) -> list[dict[str, Any]]:
    conflicts = []
    for model, pk in deleting:
        label = next(label for label, candidate in _MODELS.items() if candidate is model)
        instance = (
            (getattr(model, "all_objects", None) or model._base_manager)
            .filter(project=project, pk=pk)
            .first()
        )
        if instance is None:
            continue
        collector = Collector(using="default")
        try:
            collector.collect([instance])
        except ProtectedError:
            conflicts.append({"code": "dependent_data", "object_type": label, "object_id": pk})
            continue
        collected = list(collector.data.items()) + [
            (queryset.model, queryset) for queryset in collector.fast_deletes
        ]
        for dependent, objects in collected:
            if dependent._meta.model_name == "croptimingwindow":
                continue
            if any((dependent, obj.pk) not in reverting for obj in objects):
                conflicts.append(
                    {
                        "code": "dependent_data",
                        "object_type": label,
                        "object_id": pk,
                    }
                )
        for (_field, _value), groups in collector.field_updates.items():
            if any((type(obj), obj.pk) not in reverting for objects in groups for obj in objects):
                conflicts.append(
                    {
                        "code": "dependent_data",
                        "object_type": label,
                        "object_id": pk,
                    }
                )
    return conflicts


def undo_crop_import(project: Project, batch: BatchOperation, *, user_name: str) -> dict[str, Any]:
    """Undo only captured writes, refusing dependencies and any later same-row edit."""
    with transaction.atomic():
        lock_crop_project(project.pk)
        batch = BatchOperation.objects.select_for_update().get(pk=batch.pk, project=project)
        current = capture_project_state(project, lock=True)
        preview = import_undo_preview(project, batch)
        if preview["conflicts"]:
            return preview
        target = _inverse_state(current, batch.context[_INTERNAL])
        revert = start_batch_operation(
            project=project,
            operation_type=BatchOperation.TYPE_REVERTED,
            context={
                "reverted_operation_type": BatchOperation.TYPE_CROP_IMPORT,
                "created_count": preview["created_count"],
                "updated_count": preview["updated_count"],
            },
            user_name=user_name,
        )
        with revision_batch(revert):
            record_project_checkpoint(project, current, action=EntityRevision.ACTION_UPDATED)
            apply_project_state(project, target, current)
            record_project_checkpoint(project, capture_project_state(project))
        batch.reverted_at = timezone.now()
        batch.completed_at = batch.completed_at or batch.reverted_at
        batch.save(update_fields=["reverted_at", "completed_at"])
        return preview
