"""Plan, archive and recover a batch of project crops."""

import json
from collections import defaultdict
from dataclasses import dataclass
from hashlib import sha256
from typing import Any
from uuid import UUID

from django.core.signing import BadSignature, Signer
from django.db import IntegrityError, transaction
from django.db.models import Count, Q
from django.utils import timezone
from django.utils.crypto import constant_time_compare
from django.utils.dateparse import parse_datetime

from farm.history.project_restore import ensure_project_checkpoint
from farm.history.records import revision_actor, revision_batch, start_batch_operation
from farm.models import (
    BatchOperation,
    Crop,
    CropSupplierData,
    EntityRevision,
    PlantingPlan,
    Project,
    SeedPackage,
    format_crop_display_name,
)
from farm.services.crop_inheritance import lock_crop_project, validate_crop_identity

MAX_BULK_CROPS = 5_000
_SAMPLE_SIZE = 8
_TOKEN_SALT = "farm.bulk-crop-deletion.v1"


class BulkCropDeletionConflict(Exception):
    def __init__(
        self, code: str, detail: str, preview: dict[str, Any] | None = None,
        *, failed_count: int = 0,
    ) -> None:
        super().__init__(detail)
        self.code = code
        self.preview = preview
        self.failed_count = failed_count


@dataclass(frozen=True)
class CropDeletionSelection:
    scope: str
    crop_ids: tuple[int, ...]
    delete_varieties: bool


@dataclass
class CropDeletionPlan:
    crops: list[Crop]
    preview: dict[str, Any]


def crop_group_query(crop: Crop) -> Q:
    if crop.crop_species_id is not None:
        return Q(project_id=crop.project_id, crop_species_id=crop.crop_species_id)
    return Q(
        project_id=crop.project_id, crop_species_id__isnull=True,
        name_normalized=crop.name_normalized,
    )


def crops_affected_by_delete(crop: Crop, group: list[Crop]) -> list[Crop]:
    has_general = any(candidate.variety_normalized is None for candidate in group)
    return group if crop.variety_normalized is None or not has_general else [crop]


def _group_key(crop: Crop) -> tuple[str, int | str]:
    if crop.crop_species_id is not None:
        return "species", crop.crop_species_id
    return "name", crop.name_normalized


def _bounded_crops(queryset) -> list[Crop]:
    crops = list(queryset.order_by("pk")[:MAX_BULK_CROPS + 1])
    if len(crops) > MAX_BULK_CROPS:
        raise BulkCropDeletionConflict(
            "crop_bulk_delete_limit", "Select fewer crops for this deletion.",
        )
    return crops


def _crop_groups(
    project: Project, selection: CropDeletionSelection,
) -> tuple[list[Crop], dict[tuple[str, int | str], list[Crop]]]:
    active = Crop.objects.filter(project=project).only(
        "name", "variety", "name_normalized", "variety_normalized", "crop_species", "updated_at",
    )
    selected = _bounded_crops(
        active if selection.scope == "all" else active.filter(pk__in=selection.crop_ids)
    )
    if selection.scope == "all":
        related = selected
    else:
        species = {crop.crop_species_id for crop in selected if crop.crop_species_id is not None}
        names = {crop.name_normalized for crop in selected if crop.crop_species_id is None}
        related = _bounded_crops(active.filter(
            Q(crop_species_id__in=species)
            | Q(crop_species_id__isnull=True, name_normalized__in=names)
        ))
    groups = defaultdict(list)
    for crop in related:
        groups[_group_key(crop)].append(crop)
    return selected, groups


def _affected_crops(
    selected: list[Crop],
    groups: dict[tuple[str, int | str], list[Crop]],
    delete_varieties: bool,
) -> tuple[list[Crop], dict[str, set[int]], list[Crop]]:
    selected_ids = {crop.pk for crop in selected}
    affected = {crop.pk: crop for crop in selected}
    blocked: dict[str, set[int]] = defaultdict(set)
    required_varieties = []
    requested_groups = defaultdict(list)
    for crop in selected:
        requested_groups[_group_key(crop)].append(crop)
    for key, requested in requested_groups.items():
        group = groups[key]
        general_count = sum(entry.variety_normalized is None for entry in group)
        ends_group = general_count == 0 or any(
            crop.variety_normalized is None for crop in requested
        )
        descendants = group if ends_group else requested
        if delete_varieties:
            affected.update((entry.pk, entry) for entry in descendants)
        else:
            excluded = [entry for entry in descendants if entry.pk not in selected_ids]
            if excluded:
                blocked["varieties_required"].update(crop.pk for crop in requested)
                if general_count <= 1:
                    required_varieties.extend(excluded)
        if general_count > 1:
            blocked["ambiguous_group"].update(
                crop.pk for crop in (descendants if delete_varieties else requested)
            )
    return sorted(affected.values(), key=lambda crop: crop.pk), blocked, required_varieties


def _crop_samples(crops: list[Crop]) -> list[dict[str, Any]]:
    return [
        {"id": crop.pk, "name": format_crop_display_name(crop.name, crop.variety) or crop.name}
        for crop in crops[:_SAMPLE_SIZE]
    ]


def _preview_records(
    crops: list[Crop], parents: dict[tuple[str, int | str], Crop],
) -> list[dict[str, Any]]:
    records = []
    for crop in crops:
        parent = parents.get(_group_key(crop)) if crop.variety_normalized is not None else None
        records.append({
            "id": crop.pk,
            "name": crop.name,
            "variety": crop.variety.strip() if crop.variety_normalized is not None else None,
            "parent_id": parent.pk if parent is not None else None,
            "parent_name": parent.name if parent is not None else crop.name,
        })
    return records


def _selection_fingerprint(selection: CropDeletionSelection) -> list:
    return [selection.scope, list(selection.crop_ids), selection.delete_varieties]


def _preview_token(
    project_id: int, actor_id: int, selection: CropDeletionSelection,
    crops: list[Crop], dependencies: dict[str, int],
) -> str:
    payload = [
        project_id, actor_id, _selection_fingerprint(selection),
        [
            (
                crop.pk, crop.updated_at.isoformat(), crop.name, crop.variety,
                crop.crop_species_id, crop.name_normalized, crop.variety_normalized,
            )
            for crop in crops
        ],
        dependencies,
    ]
    fingerprint = sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode())
    return Signer(salt=_TOKEN_SALT).sign(fingerprint.hexdigest())


def _build_plan(
    project: Project, actor_id: int, selection: CropDeletionSelection,
    *, include_records: bool = False,
) -> CropDeletionPlan:
    selected, groups = _crop_groups(project, selection)
    affected, blocked, required_varieties = _affected_crops(
        selected, groups, selection.delete_varieties,
    )
    affected_ids = [crop.pk for crop in affected]
    plans = dict(
        PlantingPlan.objects.filter(project=project, crop_id__in=affected_ids)
        .order_by().values_list("crop_id").annotate(total=Count("pk"))
    )
    if plans:
        blocked["planting_plans"].update(plans)
    dependencies = {
        "planting_plan_count": sum(plans.values()),
        "seed_package_count": SeedPackage.objects.filter(
            project=project, crop_id__in=affected_ids,
        ).count(),
        "supplier_offer_count": CropSupplierData.objects.filter(
            project=project, crop_id__in=affected_ids,
        ).count(),
    }
    missing_count = len(selection.crop_ids) - len(selected) if selection.scope == "selected" else 0
    blocked_ids = set().union(*blocked.values())
    variety_count = sum(crop.variety_normalized is not None for crop in affected)
    preview = {
        "scope": selection.scope,
        "selected_count": len(selected) + missing_count,
        "affected_count": len(affected),
        "variety_count": variety_count,
        "general_count": len(affected) - variety_count,
        "additional_count": len(affected) - len(selected),
        "missing_count": missing_count,
        "blocked_count": len(blocked_ids),
        "samples": _crop_samples(affected),
        "blockers": [
            {
                "code": code, "count": len(ids),
                "samples": _crop_samples([crop for crop in affected if crop.pk in ids]),
            }
            for code, ids in blocked.items()
        ],
        **dependencies,
        "token": None,
    }
    if affected and not blocked_ids and not missing_count:
        preview["token"] = _preview_token(project.pk, actor_id, selection, affected, dependencies)
    if include_records:
        parents = {}
        for key, group in groups.items():
            general = [entry for entry in group if entry.variety_normalized is None]
            if len(general) == 1:
                parents[key] = general[0]
        preview["affected_records"] = _preview_records(affected, parents)
        preview["required_varieties"] = _preview_records(
            sorted(required_varieties, key=lambda crop: crop.pk), parents,
        )
    return CropDeletionPlan(affected, preview)


@transaction.atomic
def preview_crop_deletion(
    project: Project, *, actor_id: int, selection: CropDeletionSelection,
) -> dict[str, Any]:
    lock_crop_project(project.pk)
    return _build_plan(project, actor_id, selection, include_records=True).preview


def _request_conflict() -> BulkCropDeletionConflict:
    return BulkCropDeletionConflict(
        "crop_bulk_delete_request_conflict", "This deletion request is unavailable.",
    )


@transaction.atomic
def delete_project_crops(
    project: Project, *, user, actor_label: str, selection: CropDeletionSelection,
    request_id: UUID, preview_token: str,
) -> dict[str, int]:
    try:
        Signer(salt=_TOKEN_SALT).unsign(preview_token)
    except BadSignature as exc:
        raise BulkCropDeletionConflict(
            "crop_bulk_delete_preview_changed", "Check a new preview before deleting crops.",
        ) from exc
    lock_crop_project(project.pk)
    request_hash = sha256(preview_token.encode()).hexdigest()
    existing = BatchOperation.objects.filter(request_id=request_id).first()
    if existing is not None:
        if (
            existing.project_id == project.pk and existing.initiated_by_id == user.pk
            and existing.operation_type == BatchOperation.TYPE_CROP_BULK_DELETE
            and existing.completed_at is not None
            and existing.context.get("_request_hash") == request_hash
            and existing.context.get("_selection") == _selection_fingerprint(selection)
        ):
            return {"batch_id": existing.pk, "deleted_count": existing.context["deleted_count"]}
        raise _request_conflict()

    plan = _build_plan(project, user.pk, selection)
    expected = plan.preview["token"]
    if expected is None or not constant_time_compare(expected, preview_token):
        raise BulkCropDeletionConflict(
            "crop_bulk_delete_preview_changed",
            "The crop selection or its dependencies changed. Check a new preview.",
            plan.preview,
        )
    ensure_project_checkpoint(project, user_name=actor_label)
    deleted_at = timezone.now()
    try:
        with transaction.atomic():
            batch = start_batch_operation(
                project=project, operation_type=BatchOperation.TYPE_CROP_BULK_DELETE,
                user_name=actor_label, request_id=request_id, initiated_by_id=user.pk,
                context={
                    "deleted_count": len(plan.crops), "_deleted_at": deleted_at.isoformat(),
                    "_crop_ids": [crop.pk for crop in plan.crops], "_request_hash": request_hash,
                    "_selection": _selection_fingerprint(selection),
                },
            )
    except IntegrityError as exc:
        raise _request_conflict() from exc
    applied_crops = Crop.objects.filter(project=project, pk__in=batch.context["_crop_ids"])
    try:
        with revision_actor(user), revision_batch(batch):
            for crop in applied_crops.order_by("pk"):
                crop.deleted_at = deleted_at
                crop._history_action = EntityRevision.ACTION_DELETED
                crop.save(update_fields=["deleted_at", "updated_at"])
    except IntegrityError as exc:
        raise BulkCropDeletionConflict(
            "crop_bulk_delete_write_failed", "The crop batch could not be archived.",
            plan.preview, failed_count=len(plan.crops),
        ) from exc
    batch.completed_at = timezone.now()
    batch.save(update_fields=["completed_at"])
    return {"batch_id": batch.pk, "deleted_count": len(plan.crops)}


@transaction.atomic
def recover_crop_deletion(project: Project, batch_id: int, *, user, actor_label: str) -> int:
    lock_crop_project(project.pk)
    batch = BatchOperation.objects.select_for_update().filter(
        project=project, pk=batch_id, operation_type=BatchOperation.TYPE_CROP_BULK_DELETE,
        completed_at__isnull=False,
    ).first()
    if batch is None:
        raise _request_conflict()
    if batch.reverted_at is not None:
        return batch.context["_recovered_count"]
    crop_ids = batch.context["_crop_ids"]
    deleted_at = parse_datetime(batch.context["_deleted_at"])
    crops = list(Crop.all_objects.filter(project=project, pk__in=crop_ids).order_by("pk"))
    if len(crops) != len(crop_ids) or any(crop.deleted_at != deleted_at for crop in crops):
        raise BulkCropDeletionConflict(
            "crop_bulk_delete_recovery_changed", "The archived crops changed after this deletion.",
        )
    ensure_project_checkpoint(project, user_name=actor_label)
    recovery = start_batch_operation(
        project=project, operation_type=BatchOperation.TYPE_CROP_BULK_UNDELETE,
        user_name=actor_label, context={"restored_count": len(crops)},
    )
    with revision_actor(user), revision_batch(recovery):
        for crop in crops:
            crop.deleted_at = None
            validate_crop_identity(crop)
            crop._history_action = EntityRevision.ACTION_RESTORED
            crop.save(update_fields=["deleted_at", "updated_at"])
    batch.reverted_at = timezone.now()
    batch.context["_recovered_count"] = len(crops)
    batch.save(update_fields=["reverted_at", "context"])
    return len(crops)
