"""Point-in-time restore and batch-operation revert, built on recorded
entity revisions."""

from collections.abc import Callable
from typing import Any

from django.core.files.storage import default_storage
from django.db import IntegrityError, transaction
from django.db.models import Model, Q
from django.utils import timezone
from rest_framework.exceptions import APIException

from crops.plant_families import coerce_plant_family_key
from crops.specific_properties import crop_specific_property_errors
from farm.models import (
    Crop,
    CropCompanion,
    EntityRevision,
    MediaFile,
    PlantingPlan,
    Project,
    Supplier,
    Task,
)
from farm.models.crops import (
    crop_field_attname,
    get_crop_field_value,
    is_supplier_domain,
    set_crop_field_value,
)
from farm.services.crop_inheritance import (
    CROP_SPECIES_INVARIANT_FIELDS,
    crop_identity_write,
    find_general_crop,
    inherits_from_general_crop,
    lock_crop_project,
    validate_crop_identity,
)

from .records import (
    _ENTITY_TYPE_LABELS,
    _RESTORABLE_ENTITY_TYPES,
    PROMOTED_CROP_FIELD_CHANGES,
    _entity_display_name,
    _serialize_instance,
    internal_project_versions,
    record_completed_crop_revision,
    record_entity_revision,
    start_batch_operation,
)

_MODEL_BY_ENTITY_TYPE: dict[str, type] = {label: model for model, label in _ENTITY_TYPE_LABELS.items()}
_ENTITY_TYPE_ORDER: dict[str, int] = {label: index for index, (_m, label) in enumerate(_RESTORABLE_ENTITY_TYPES)}


def _model_manager(model):
    return getattr(model, 'all_objects', None) or model._base_manager


_SKIP_ON_UPDATE = {'id', 'created_at', 'updated_at'}


class CropRestoreReferenceConflict(APIException):
    status_code = 409

    def __init__(
        self, field: str, *, code: str = 'crop_restore_reference_unavailable',
        detail: str = 'This version contains a field that is unavailable in the current project.',
    ) -> None:
        super().__init__({'code': code, 'detail': detail, 'field': field})


def is_latest_project_revision(project: Project, revision: EntityRevision) -> bool:
    """Whether `revision` is the project's newest one, i.e. the current state.

    Ordered by `(created_at, id)`, matching `ProjectHistoryListView`.
    """
    return not (
        EntityRevision.objects
        .filter(project=project)
        .filter(
            Q(created_at__gt=revision.created_at)
            | Q(created_at=revision.created_at, id__gt=revision.id)
        )
        .exists()
    )


def _crop_restore_identity(row: dict[str, Any]) -> tuple[str | None, str | None, int | None]:
    from farm.utils import normalize_text

    return (normalize_text(row['name']), normalize_text(row.get('variety')),
            row.get('crop_species_id'))


def _validate_restored_variety_identities(
    current: dict[int, dict[str, Any]], final: dict[int, dict[str, Any]],
) -> None:
    from farm.services.crop_inheritance import CropVarietyConflict

    varieties: dict[tuple[str | None, str], set[int]] = {}
    for pk, row in final.items():
        name, variety, _ = _crop_restore_identity(row)
        if variety:
            varieties.setdefault((name, variety), set()).add(pk)
    for identity, ids in varieties.items():
        if len(ids) > 1 and any(
            pk not in current or current[pk]['deleted_at'] is not None
            or _crop_restore_identity(current[pk])[:2] != identity
            for pk in ids
        ):
            raise CropVarietyConflict()


def _validate_restored_general_identities(
    current: dict[int, dict[str, Any]], final: dict[int, dict[str, Any]],
) -> None:
    from farm.services.crop_inheritance import GeneralCropIdentityConflict

    _validate_restored_variety_identities(current, final)
    names: set[str | None] = set()
    species_groups: dict[int, set[int]] = {}
    for pk, row in final.items():
        name, variety, species_id = _crop_restore_identity(row)
        if variety:
            continue
        if name in names:
            raise GeneralCropIdentityConflict()
        names.add(name)
        if species_id:
            species_groups.setdefault(species_id, set()).add(pk)
    for species_id, ids in species_groups.items():
        if len(ids) < 2:
            continue
        previous_ids = {
            pk for pk, row in current.items() if row['deleted_at'] is None
            and not _crop_restore_identity(row)[1] and row.get('crop_species_id') == species_id
        }
        changed = ids != previous_ids or any(
            _crop_restore_identity(final[pk]) != _crop_restore_identity(current[pk])
            for pk in ids
        )
        if changed:
            raise GeneralCropIdentityConflict()


def _restore_project_state_at(project: Project, target_time) -> None:
    """Compatibility entry point for callers holding a historical timestamp."""
    from .project_restore import ProjectRestoreConflict, restore_project_version

    revision = EntityRevision.objects.filter(
        project=project, created_at__lte=target_time,
    ).order_by('-created_at', '-id').first()
    if revision is None:
        raise ProjectRestoreConflict('no historical state')
    restore_project_version(project, revision)


def restore_crop_from_revision(crop: Crop, revision: EntityRevision) -> Crop:
    """Write a revision's snapshot back onto `crop` and undelete it.

    Fields the snapshot cannot own — the primary key and the timestamps — are
    skipped, so restoring an old version keeps the row's identity and its
    audit timestamps. `_history_action` tags the resulting save as a restore
    rather than a plain update (see `Crop.save`).
    """
    snapshot = _with_legacy_snapshot_fields(Crop, revision.snapshot)
    promoted = revision.snapshot.get(PROMOTED_CROP_FIELD_CHANGES)
    with crop_identity_write(crop.project_id):
        crop.refresh_from_db()
        before = _serialize_instance(crop) if promoted else None
        old_image_id = crop.image_file_id
        _apply_crop_snapshot_fields(crop, snapshot)
        if 'timing_windows' in revision.snapshot:
            crop._pending_timing_windows = revision.snapshot['timing_windows'] or []
        if 'library_pinned_fields' not in revision.snapshot:
            crop.library_pinned_fields = []
        crop.deleted_at = None
        validate_crop_identity(crop)
        if 'image_file_id' in snapshot:
            _restore_crop_image_markers(crop, old_image_id)
        if promoted:
            general_changes = _restore_promoted_crop_fields(crop, promoted)
            crop.save(record_history=False)
            record_completed_crop_revision(
                crop, action=EntityRevision.ACTION_RESTORED, before=before,
                promoted=general_changes,
            )
        else:
            crop._history_action = EntityRevision.ACTION_RESTORED
            crop.save()

    return crop


def _restore_promoted_crop_fields(crop: Crop, promoted: dict[str, Any]) -> dict[str, Any]:
    if not inherits_from_general_crop(crop):
        raise CropRestoreReferenceConflict('general_crop')
    general = find_general_crop(
        crop.project_id, crop.crop_species_id, exclude_pk=crop.pk, for_update=True,
    )
    if general is None or general.pk != promoted['general_crop_id']:
        raise CropRestoreReferenceConflict('general_crop')

    changes = {}
    update_fields = []
    for field in CROP_SPECIES_INVARIANT_FIELDS:
        attname = crop_field_attname(field)
        if attname not in promoted['fields']:
            continue
        value = promoted['fields'][attname]['new_value']
        old_value = get_crop_field_value(general, field)
        changes[attname] = {'old_value': old_value, 'new_value': value}
        if value == old_value:
            continue
        model_field = Crop._meta.get_field(field)
        if model_field.remote_field and value is not None:
            value = _crop_restore_reference(crop, attname, model_field.remote_field.model, value)
        set_crop_field_value(general, field, value)
        update_fields.append(field)

    if update_fields:
        with internal_project_versions():
            general.save(update_fields=update_fields)
    return {'general_crop_id': general.pk, 'fields': changes}


def _apply_crop_snapshot_fields(crop: Crop, snapshot: dict) -> None:
    fields = [
        field for field in Crop._meta.concrete_fields
        if field.attname in snapshot and field.attname not in {*_SKIP_ON_UPDATE, 'project_id'}
    ]
    # Two crops can use the same library entries in opposite roles. Lock all
    # references in the same order before modifying the crop or image markers.
    references = sorted(
        (field for field in fields if field.remote_field and snapshot[field.attname] is not None),
        key=lambda field: (
            field.remote_field.model._meta.label_lower, str(snapshot[field.attname]),
        ),
    )
    resolved = {
        field.attname: _crop_restore_reference(
            crop, field.attname, field.remote_field.model, snapshot[field.attname],
        )
        for field in references
    }
    for field in fields:
        setattr(crop, field.name, resolved.get(field.attname, snapshot[field.attname]))
    if crop_specific_property_errors(crop):
        raise CropRestoreReferenceConflict('specific_properties')
    product_url = crop.supplier_product_url
    if product_url and not is_supplier_domain(product_url, crop.supplier):
        raise CropRestoreReferenceConflict('supplier_product_url')


def _crop_restore_reference(
    crop: Crop, field: str, model: type[Model], value: Any,
) -> Model:
    try:
        choices = model._base_manager.filter(pk=value)
    except (TypeError, ValueError) as error:
        raise CropRestoreReferenceConflict(field) from error
    if model in (MediaFile, Supplier):
        choices = choices.filter(project_id=crop.project_id)
    reference = choices.select_for_update().first()
    if reference is None:
        raise CropRestoreReferenceConflict(field)
    if isinstance(reference, MediaFile) and (
        not reference.storage_path or not default_storage.exists(reference.storage_path)
    ):
        raise CropRestoreReferenceConflict(
            field, code='crop_restore_image_unavailable',
            detail='The historical image is no longer available in storage.',
        )
    return reference


def _restore_crop_image_markers(crop: Crop, previous_id: int | None) -> None:
    media = MediaFile.objects.filter(project_id=crop.project_id)
    if previous_id and previous_id != crop.image_file_id and not Crop.objects.filter(
        project_id=crop.project_id, image_file_id=previous_id,
    ).exclude(pk=crop.pk).exists():
        previous = media.filter(pk=previous_id, orphaned_at__isnull=True).first()
        if previous is not None:
            _record_crop_image_marker(previous, timezone.now())
    if crop.image_file_id and crop.image_file.orphaned_at is not None:
        _record_crop_image_marker(crop.image_file, None)


def _record_crop_image_marker(media: MediaFile, orphaned_at) -> None:
    media.orphaned_at = orphaned_at
    media.save(update_fields=['orphaned_at'])
    with internal_project_versions():
        record_entity_revision(
            project=media.project, entity_type='media_file', object_id=media.pk,
            action=EntityRevision.ACTION_UPDATED, snapshot=_serialize_instance(media),
            changed_fields=['orphaned_at'],
        )


def _restore_snapshot_children(model: type, object_id: int, snapshot: dict) -> None:
    """Write back the child rows a snapshot carries next to its own columns.

    A crop snapshot holds its own timing windows under ``timing_windows``;
    one taken before windows existed has no such key and leaves them alone.
    """
    if model is not Crop or not isinstance(snapshot, dict) or 'timing_windows' not in snapshot:
        return
    from farm.services.timing_windows import TimingWindow, replace_crop_timing_windows

    crop = Crop.all_objects.filter(pk=object_id).first()
    if crop is not None:
        replace_crop_timing_windows(
            crop, [TimingWindow.from_dict(window) for window in snapshot['timing_windows'] or []],
        )


def _with_legacy_snapshot_fields(model: type, snapshot: dict) -> dict:
    """Interpret historical crop and companion fields without rewriting the snapshot."""
    if model is Crop:
        from farm.crop_light import normalize_crop_light
        from farm.germination import upgrade_germination_snapshot

        snapshot = upgrade_germination_snapshot(snapshot)
        snapshot.setdefault('plant_health', None)
        snapshot.setdefault('specific_properties', {})
        for field in (
            'seed_type', 'life_cycle', 'pests_diseases', 'water_requirement', 'winter_hardiness',
        ):
            snapshot.setdefault(field, '')
        snapshot['light_requirement'] = normalize_crop_light(snapshot.get('light_requirement'))
        if 'crop_family_id' not in snapshot and 'crop_family' in snapshot:
            snapshot['crop_family_id'] = coerce_plant_family_key(snapshot['crop_family'])
    if model is CropCompanion and 'notes' not in snapshot:
        return {**snapshot, 'notes': {'de': snapshot['note']} if snapshot.get('note') else {}}
    return snapshot


def _latest_revision_per_object(project: Project, entity_type: str, since) -> list[EntityRevision]:
    """Newest revision per object of `entity_type` recorded at/after `since`."""
    revisions = (
        EntityRevision.objects
        .filter(project=project, entity_type=entity_type, created_at__gte=since)
        .order_by('object_id', '-created_at')
    )
    latest: list[EntityRevision] = []
    seen: set[int] = set()
    for revision in revisions:
        if revision.object_id in seen:
            continue
        seen.add(revision.object_id)
        latest.append(revision)
    return latest


def _recreate_rows_deleted_since(
    project: Project,
    model: type,
    entity_type: str,
    deleted_since,
    batch,
    *,
    user_name: str,
    belongs_to_restore: Callable[[dict], bool],
    build_row_data: Callable[[dict], dict],
    select_related: tuple[str, ...] = (),
) -> list[int]:
    """Recreate rows this project's history records as deleted since
    `deleted_since`, and record an `ACTION_RESTORED` revision for each.

    Only the newest revision per object is considered, so a row deleted and
    later recreated by other means is left alone; `belongs_to_restore` narrows
    the candidates to the ones that went away with the entity being restored.
    Returns the ids that were recreated.
    """
    allowed_fields = {field.attname for field in model._meta.concrete_fields}
    recreated = []
    for revision in _latest_revision_per_object(project, entity_type, deleted_since):
        snapshot = revision.snapshot
        if (
            revision.action != EntityRevision.ACTION_DELETED
            or not isinstance(snapshot, dict)
            or not belongs_to_restore(snapshot)
            or model.objects.filter(pk=revision.object_id).exists()
        ):
            continue
        snapshot = _with_legacy_snapshot_fields(model, snapshot)
        row_data = {key: value for key, value in snapshot.items() if key in allowed_fields}
        recreated.append(model(**build_row_data(row_data)))

    if not recreated:
        return []

    model.objects.bulk_create(recreated)
    recreated_ids = [instance.pk for instance in recreated]
    snapshots_by_id = {revision.object_id: revision.snapshot for revision in _latest_revision_per_object(
        project, entity_type, deleted_since,
    )} if model is Crop else {}
    for object_id in recreated_ids:
        if object_id in snapshots_by_id:
            _restore_snapshot_children(model, object_id, snapshots_by_id[object_id])
    queryset = model.objects.filter(pk__in=recreated_ids)
    if select_related:
        queryset = queryset.select_related(*select_related)
    for instance in queryset:
        record_entity_revision(
            project=project, entity_type=entity_type, object_id=instance.pk,
            action=EntityRevision.ACTION_RESTORED,
            snapshot=_serialize_instance(instance),
            display_name=_entity_display_name(instance),
            changed_fields=[], user_name=user_name, batch_operation=batch,
        )
    return recreated_ids


def _null_dangling_nullable_fks(model: type, row_data: dict, *, keep: set[str]) -> dict:
    """A FK target (bed/crop/user) may have been hard-deleted since the
    snapshot — null the nullable ones rather than 500 on insert, matching the
    other restore paths. `keep` names FKs the caller has already set itself."""
    for field in model._meta.concrete_fields:
        related_id = row_data.get(field.attname)
        if (
            field.remote_field is None
            or related_id is None
            or field.attname in keep
            or not field.null
        ):
            continue
        target_manager = (
            getattr(field.remote_field.model, 'all_objects', None)
            or field.remote_field.model._base_manager
        )
        if not target_manager.filter(pk=related_id).exists():
            row_data[field.attname] = None
    return row_data


def restore_plans_and_tasks_deleted_with_season(
    project: Project,
    season,
    deleted_since,
    batch,
    *,
    user_name: str,
) -> None:
    """Bring back the planting plans hard-deleted with `season`, and the tasks
    that DB-cascaded away with those plans.

    Planting plans have no soft delete, so undeleting a season has to recreate
    them from the revisions recorded when it was deleted.
    """
    def build_plan_row(row_data: dict) -> dict:
        row_data['project_id'] = season.project_id
        row_data['season_id'] = season.pk
        return _null_dangling_nullable_fks(
            PlantingPlan, row_data, keep={'project_id', 'season_id'},
        )

    plan_ids = _recreate_rows_deleted_since(
        project, PlantingPlan, 'planting_plan', deleted_since, batch,
        user_name=user_name,
        belongs_to_restore=lambda snapshot: snapshot.get('season_id') == season.pk,
        build_row_data=build_plan_row,
        select_related=('crop', 'bed'),
    )
    if not plan_ids:
        return

    def build_task_row(row_data: dict) -> dict:
        row_data['project_id'] = project.id
        return row_data

    _recreate_rows_deleted_since(
        project, Task, 'task', deleted_since, batch,
        user_name=user_name,
        belongs_to_restore=lambda snapshot: snapshot.get('planting_plan_id') in plan_ids,
        build_row_data=build_task_row,
    )


def restore_season_planting_plans(project: Project, season, batch, *, user_name: str) -> None:
    """Replay the plan/task deletions recorded when `season` was last deleted.

    A no-op for a season that was never deleted; otherwise it finds that
    deletion's timestamp and hands it to
    `restore_plans_and_tasks_deleted_with_season`.
    """
    deleted_revision = (
        EntityRevision.objects
        .filter(
            project=project,
            entity_type='season',
            object_id=season.pk,
            action=EntityRevision.ACTION_DELETED,
        )
        .order_by('-created_at')
        .first()
    )
    if deleted_revision is None:
        return
    restore_plans_and_tasks_deleted_with_season(
        project, season, deleted_revision.created_at, batch, user_name=user_name,
    )


class BatchRevertError(Exception):
    """A batch operation can't be reverted (already reverted, unknown entity
    type, or an insert would violate a constraint)."""


_RESTORABLE_MODEL_ENTITY_TYPE: dict[type, str] = {model: label for model, label in _RESTORABLE_ENTITY_TYPES}


def _record_cascade_deletions(project: Project, instances: list, batch, user_name: str) -> None:
    """Record an `ACTION_DELETED` revision for every *restorable* row a DB
    cascade delete of `instances` would also remove (a planting plan's tasks,
    say) — so it lands in the same batch and a later restore can bring it back.
    Does not delete anything; the caller does."""
    if not instances:
        return
    from django.db.models.deletion import Collector

    already = {(type(instance), instance.pk) for instance in instances}
    collector = Collector(using=instances[0]._state.db or 'default')
    collector.collect(list(instances))

    dependents: dict[type, set] = {}
    for model, objs in collector.data.items():
        dependents.setdefault(model, set()).update(objs)
    # Leaf models with nothing further to cascade go in `fast_deletes` as
    # querysets rather than `data` — a plan's tasks land here.
    for queryset in collector.fast_deletes:
        dependents.setdefault(queryset.model, set()).update(queryset)

    for model, objs in dependents.items():
        entity_type = _RESTORABLE_MODEL_ENTITY_TYPE.get(model)
        if entity_type is None:
            continue
        for obj in objs:
            if (model, obj.pk) in already:
                continue
            record_entity_revision(
                project=project, entity_type=entity_type, object_id=obj.pk,
                action=EntityRevision.ACTION_DELETED,
                snapshot=_serialize_instance(obj),
                display_name=_entity_display_name(obj),
                changed_fields=[], user_name=user_name, batch_operation=batch,
            )


def _row_data_from_snapshot(model, snapshot: dict, project: Project) -> dict:
    concrete = {field.attname for field in model._meta.concrete_fields}
    snapshot = _with_legacy_snapshot_fields(model, snapshot)
    row = {key: value for key, value in snapshot.items() if key in concrete}
    row['project_id'] = project.id
    if 'deleted_at' in concrete:
        row['deleted_at'] = None
    for field in model._meta.concrete_fields:
        related_id = row.get(field.attname)
        if field.remote_field is None or related_id is None:
            continue
        if not _model_manager(field.remote_field.model).filter(pk=related_id).exists():
            row[field.attname] = None
    return row


def revert_batch_operation(project: Project, batch, *, user_name: str = '') -> None:
    """Undo a whole `BatchOperation`: every entity it touched goes back to its
    state just before the batch. `created` entities are deleted, `deleted` ones
    recreated, `updated`/`restored` ones rolled back to the prior revision.

    Idempotent — applying it again when the entities are already at their
    pre-batch state is a no-op — and it composes: reverting a `batch_reverted`
    batch re-applies the original action.
    """
    from .project_restore import (
        CHECKPOINT_KEY,
        _retain_removed_uploads,
        capture_project_state,
        record_project_checkpoint,
    )

    revisions = list(batch.revisions.exclude(
        entity_type='project', snapshot__has_key=CHECKPOINT_KEY,
    ))
    if not revisions:
        raise BatchRevertError('empty batch')

    first_batch_id: dict[tuple[str, int], int] = {}
    for revision in revisions:
        key = (revision.entity_type, revision.object_id)
        first_batch_id[key] = min(first_batch_id.get(key, revision.id), revision.id)

    to_delete: list[tuple[str, int]] = []
    to_write: list[tuple[str, int, dict]] = []
    for revision in revisions:
        if revision.entity_type not in _MODEL_BY_ENTITY_TYPE:
            raise BatchRevertError(revision.entity_type)
        key = (revision.entity_type, revision.object_id)
        if revision.action == EntityRevision.ACTION_CREATED:
            to_delete.append(key)
            continue
        if revision.action == EntityRevision.ACTION_DELETED:
            to_write.append((revision.entity_type, revision.object_id, revision.snapshot))
            continue
        prior = (
            EntityRevision.objects
            .filter(
                project=project, entity_type=revision.entity_type,
                object_id=revision.object_id, id__lt=first_batch_id[key],
            )
            .order_by('-id')
            .first()
        )
        if prior is None or prior.action == EntityRevision.ACTION_DELETED:
            to_delete.append(key)
        else:
            to_write.append((revision.entity_type, revision.object_id, prior.snapshot))

    with transaction.atomic():
        lock_crop_project(project.pk)
        current = capture_project_state(project, lock=True)
        record_project_checkpoint(
            project, current,
            user_name=user_name, action=EntityRevision.ACTION_UPDATED,
        )
        revert_batch = start_batch_operation(
            project=project,
            operation_type='batch_reverted',
            context={'reverted_operation_type': batch.operation_type, **(batch.context or {})},
            user_name=user_name,
        )

        # Children first so a parent's cascade never races us.
        for entity_type, object_id in sorted(
            to_delete, key=lambda pair: -_ENTITY_TYPE_ORDER.get(pair[0], 999),
        ):
            model = _MODEL_BY_ENTITY_TYPE[entity_type]
            instance = _model_manager(model).filter(project=project, pk=object_id).first()
            if instance is None:
                continue
            snapshot = _serialize_instance(instance)
            display_name = _entity_display_name(instance)
            # Rows a DB cascade would take with it (plans added to the season
            # after it was created, their tasks) get their own revision so the
            # revert stays reversible.
            _record_cascade_deletions(project, [instance], revert_batch, user_name)
            _model_manager(model).filter(pk=object_id).delete()
            record_entity_revision(
                project=project, entity_type=entity_type, object_id=object_id,
                action=EntityRevision.ACTION_DELETED, snapshot=snapshot,
                display_name=display_name, changed_fields=[], user_name=user_name,
                batch_operation=revert_batch,
            )

        # Parents first for the recreates/updates.
        for entity_type, object_id, snapshot in sorted(
            to_write, key=lambda item: _ENTITY_TYPE_ORDER.get(item[0], 999),
        ):
            model = _MODEL_BY_ENTITY_TYPE[entity_type]
            manager = _model_manager(model)
            row = _row_data_from_snapshot(model, snapshot, project)
            if manager.filter(project=project, pk=object_id).exists():
                manager.filter(pk=object_id).update(
                    **{key: value for key, value in row.items() if key not in _SKIP_ON_UPDATE},
                )
                action = EntityRevision.ACTION_UPDATED
            else:
                try:
                    with transaction.atomic():
                        model.objects.bulk_create([model(**row)])
                except IntegrityError as exc:
                    raise BatchRevertError(entity_type) from exc
                action = EntityRevision.ACTION_RESTORED
            _restore_snapshot_children(model, object_id, snapshot)
            instance = manager.filter(pk=object_id).select_related().first()
            record_entity_revision(
                project=project, entity_type=entity_type, object_id=object_id,
                action=action, snapshot=_serialize_instance(instance) if instance else snapshot,
                display_name=_entity_display_name(instance) if instance else '',
                changed_fields=[], user_name=user_name, batch_operation=revert_batch,
            )

        batch.reverted_at = timezone.now()
        batch.save(update_fields=['reverted_at'])
        result = capture_project_state(project)
        _retain_removed_uploads(project, result, current)
        record_project_checkpoint(
            project, result,
            user_name=user_name, batch_operation=revert_batch,
        )
