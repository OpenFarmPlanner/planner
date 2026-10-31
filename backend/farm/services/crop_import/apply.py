"""Execution of a previously previewed crop import.

Apply never re-analyzes a payload sent by the client. It reads the stored
draft, so the rows written are byte-for-byte the rows the preview showed and
the user confirmed. Everything runs inside one transaction: a serializer
rejection on row 7 leaves rows 1-6 unwritten rather than producing a
half-imported project.
"""

from __future__ import annotations

from typing import Any

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from farm.crops.serializers import CropSerializer
from farm.models import CropImportDraft
from farm.services.crop_companions import link_free_text_companions

from .analysis import ACTION_CREATE, ACTION_SKIP, ACTION_UPDATE

# Canonical (metre-based) field names mapped to the centimetre-based fields the
# existing CropSerializer exposes. The agent-facing contract stays in SI
# metres; the conversion happens here rather than widening the browser API.
LENGTH_FIELD_TO_CENTIMETER_FIELD = {
    'row_spacing_m': 'row_spacing_cm',
    'distance_within_row_m': 'distance_within_row_cm',
    'sowing_depth_m': 'sowing_depth_cm',
}


class ImportExecutionError(Exception):
    """Raised when a draft cannot be executed; carries a machine-readable code."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def build_serializer_payload(item: dict[str, Any]) -> dict[str, Any]:
    """Translate one analyzed row into a CropSerializer payload.

    Only fields whose analysis produced no error are carried over, so a row
    that was previewed as clean cannot smuggle an unvalidated value into the
    write. Fields absent from the source stay absent — an import never invents
    a value it was not given.

    :param item: One analyzed row from a draft's preview.
    :return: Payload dictionary for :class:`CropSerializer`.
    """
    payload: dict[str, Any] = {}
    for field_entry in item['fields']:
        if field_entry['errors']:
            continue
        name = field_entry['field']
        value = field_entry['api_value']
        if value is None:
            continue
        centimeter_field = LENGTH_FIELD_TO_CENTIMETER_FIELD.get(name)
        if centimeter_field is not None:
            payload[centimeter_field] = float(value) * 100.0
            continue
        payload[name] = value
    return payload


def _apply_row(item: dict[str, Any], *, project, context: dict[str, Any]) -> dict[str, Any]:
    """Create or update the crop for one analyzed row."""
    from farm.models import Crop

    payload = build_serializer_payload(item)
    action = item['action']

    if action == ACTION_CREATE:
        serializer = CropSerializer(data=payload, context=context)
        serializer.is_valid(raise_exception=True)
        # `project` is read-only on the serializer and assigned here from the
        # token's bound project, so a payload can never place a crop in a
        # different project.
        crop = serializer.save(project=project)
        return {'index': item['index'], 'action': ACTION_CREATE, 'crop_id': crop.id}

    existing = Crop.objects.filter(project=project, pk=item['matched_crop_id']).first()
    if existing is None:
        raise ImportExecutionError(
            'match_disappeared',
            f"The crop matched for row {item['index']} no longer exists. Re-run the preview.",
        )
    serializer = CropSerializer(existing, data=payload, partial=True, context=context)
    serializer.is_valid(raise_exception=True)
    crop = serializer.save()
    return {'index': item['index'], 'action': ACTION_UPDATE, 'crop_id': crop.id}


def _check_draft_is_executable(
    draft: CropImportDraft,
    *,
    checksum: str,
    confirmed: bool,
    acknowledge_warnings: bool,
) -> None:
    """Raise :class:`ImportExecutionError` unless the draft may be executed now."""
    if not confirmed:
        raise ImportExecutionError(
            'confirmation_required',
            'Set "confirm": true to execute the reviewed import.',
        )
    if draft.is_expired:
        raise ImportExecutionError(
            'draft_expired', 'This import draft has expired. Re-run the preview.'
        )
    if checksum != draft.checksum:
        # The checksum is what ties "what was reviewed" to "what gets written".
        # A mismatch means the client confirmed a different preview.
        raise ImportExecutionError(
            'checksum_mismatch',
            'The confirmed checksum does not match this draft. Re-run the preview.',
        )
    if draft.has_errors:
        raise ImportExecutionError(
            'draft_has_errors',
            'This import contains rows with errors and cannot be executed. '
            'Fix them and re-run the preview.',
        )
    if draft.has_warnings and not acknowledge_warnings:
        raise ImportExecutionError(
            'warnings_not_acknowledged',
            'This import has warnings. Set "acknowledge_warnings": true to execute it anyway.',
        )


def apply_import_draft(
    draft: CropImportDraft,
    *,
    project,
    request,
    checksum: str,
    confirmed: bool,
    acknowledge_warnings: bool = False,
) -> dict[str, Any]:
    """Execute a confirmed import draft transactionally.

    Re-applying an already-applied draft is a no-op that returns the original
    result, so a client that retries after a dropped response never doubles an
    import.

    :param draft: The stored draft to execute.
    :param project: Project the draft belongs to.
    :param request: Request used as serializer context.
    :param checksum: Checksum the client confirmed.
    :param confirmed: Explicit user confirmation flag.
    :param acknowledge_warnings: Whether the client accepted the warnings.
    :return: Result document with per-row outcomes.
    :raises ImportExecutionError: When the draft may not be executed.
    """
    if draft.status == CropImportDraft.STATUS_APPLIED:
        return {**draft.result, 'already_applied': True}

    _check_draft_is_executable(
        draft,
        checksum=checksum,
        confirmed=confirmed,
        acknowledge_warnings=acknowledge_warnings,
    )

    context = {'request': request, 'defer_companion_linking': True}
    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    with transaction.atomic():
        for item in draft.preview['items']:
            if item['action'] == ACTION_SKIP:
                rows.append({
                    'index': item['index'],
                    'action': ACTION_SKIP,
                    'crop_id': item['matched_crop_id'],
                })
                continue
            try:
                rows.append(_apply_row(item, project=project, context=context))
            except serializers.ValidationError as exc:
                errors.append({'index': item['index'], 'detail': exc.detail})

        if not errors:
            # Once for the whole draft instead of once per row.
            link_free_text_companions(project.id)
        if errors:
            # Partial imports are worse than none: the user reviewed the batch
            # as a whole, so the whole batch is rolled back.
            transaction.set_rollback(True)

    if errors:
        raise ImportExecutionError(
            'execution_failed',
            'The import was rolled back because some rows could not be saved.',
        )

    result = {
        'draft_id': str(draft.id),
        'created_count': sum(1 for row in rows if row['action'] == ACTION_CREATE),
        'updated_count': sum(1 for row in rows if row['action'] == ACTION_UPDATE),
        'skipped_count': sum(1 for row in rows if row['action'] == ACTION_SKIP),
        'rows': rows,
    }
    draft.status = CropImportDraft.STATUS_APPLIED
    draft.applied_at = timezone.now()
    draft.result = result
    draft.save(update_fields=['status', 'applied_at', 'result'])
    return {**result, 'already_applied': False}
