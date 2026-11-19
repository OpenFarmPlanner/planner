"""Commit a culture and its explicitly selected varieties as one import."""

from typing import Any

from django.db import transaction
from rest_framework.exceptions import ValidationError

from farm.models import Crop, Project, PublicCrop
from farm.services.public_crops import (
    CropLinkConflictError,
    PublicCropEditConflictError,
    import_public_crop_into_project,
    link_project_crop_to_public_reference,
    public_crop_import_candidates,
)


def _apply_decision(
    *,
    entry: PublicCrop,
    decision: dict[str, Any],
    project: Project,
    user,
    language: str,
) -> dict[str, Any]:
    linked = Crop.objects.filter(project=project, source_public_crop=entry).first()
    if linked is not None:
        # Completion never updates a parent or variety already linked locally.
        return {"public_crop_id": entry.pk, "crop_id": linked.pk, "operation": "unchanged"}
    if entry.version != decision["base_version"]:
        raise PublicCropEditConflictError(
            "Preview this library entry again.", current_version=entry.version
        )
    target_id = decision.get("target_id")
    if target_id is not None:
        target = Crop.objects.filter(project=project, pk=target_id).first()
        candidates = public_crop_import_candidates(public_crop=entry, project=project)
        if target is None or target.pk not in {candidate.pk for candidate in candidates}:
            raise CropLinkConflictError()
        crop = link_project_crop_to_public_reference(
            crop=target,
            public_crop=entry,
            base_version=decision["base_version"],
            expected_updated_at=target.updated_at.isoformat(),
            pull_fields=decision["pull_fields"],
            pin_fields=decision["pin_fields"],
            push_fields=decision["push_fields"],
            establish_link=decision["link_to_library"],
            user=user,
            companion_note_language=language,
        )
        operation = "linked" if decision["link_to_library"] else "copied"
    else:
        crop, operation = import_public_crop_into_project(
            public_crop=entry,
            project=project,
            base_version=decision["base_version"],
            mode=decision["mode"],
            establish_link=decision["link_to_library"],
            user=user,
        )
    return {"public_crop_id": entry.pk, "crop_id": crop.pk, "operation": operation}


def _validate_target_snapshots(*, project: Project, decisions: list[dict[str, Any]]) -> None:
    targets = [decision["target_id"] for decision in decisions if decision.get("target_id")]
    if len(set(targets)) != len(targets):
        raise ValidationError("Each local crop can be selected only once.")
    already_linked = set(
        Crop.objects.filter(
            project=project,
            source_public_crop_id__in=[item["public_crop_id"] for item in decisions],
        ).values_list("source_public_crop_id", flat=True)
    )
    # Validate every local snapshot before our own species adoption updates siblings.
    for decision in decisions:
        if decision["public_crop_id"] in already_linked:
            continue
        if decision.get("target_id"):
            target = (
                Crop.objects.select_for_update()
                .filter(project=project, pk=decision["target_id"])
                .first()
            )
            if target is None or target.updated_at.isoformat() != decision["expected_updated_at"]:
                raise CropLinkConflictError()


@transaction.atomic
def import_public_crop_selection(
    *,
    parent: PublicCrop,
    project: Project,
    decisions: list[dict[str, Any]],
    user,
    language: str,
) -> list[dict[str, Any]]:
    Project.objects.select_for_update().get(pk=project.pk)
    ids = {decision["public_crop_id"] for decision in decisions}
    entries = dict(
        (entry.pk, entry)
        for entry in PublicCrop.objects.select_for_update()
        .filter(pk__in=ids | {parent.pk})
        .order_by("pk")
    )
    parent = entries.get(parent.pk)
    if parent is None:
        raise CropLinkConflictError()
    if parent.variety_normalized or not parent.crop_species_id:
        raise ValidationError("A general culture with a crop species is required.")
    if parent.status != PublicCrop.STATUS_PUBLISHED or parent.crop_species.is_pending:
        raise CropLinkConflictError()
    if len(ids) != len(decisions) or parent.pk not in ids or len(entries) != len(ids):
        raise ValidationError("Select the parent once and each variety at most once.")
    for entry in entries.values():
        if (
            entry.status != PublicCrop.STATUS_PUBLISHED
            or entry.crop_species_id != parent.crop_species_id
            or (entry.pk != parent.pk and not entry.variety_normalized)
        ):
            raise CropLinkConflictError()
    _validate_target_snapshots(project=project, decisions=decisions)
    by_id = {decision["public_crop_id"]: decision for decision in decisions}
    # Resolve existing varieties against their original inherited values before changing the parent.
    varieties = [entry for entry in entries.values() if entry.pk != parent.pk]
    ordered = [
        *(entry for entry in varieties if by_id[entry.pk].get("target_id")),
        parent,
        *(entry for entry in varieties if not by_id[entry.pk].get("target_id")),
    ]
    results = {
        entry.pk: _apply_decision(
            entry=entry,
            decision=by_id[entry.pk],
            project=project,
            user=user,
            language=language,
        )
        for entry in ordered
    }
    return [results[parent.pk], *(results[entry.pk] for entry in varieties)]
