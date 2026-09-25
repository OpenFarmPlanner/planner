from __future__ import annotations

import copy
import json
import re

# The public crop library (PublicCrop + this module) is a candidate for
# extraction into a separate service consumed by OFP over an API (under
# discussion as of 2026-07). Keep this module's dependency on `farm.models`
# limited to Crop/Project/PublicCrop, and avoid pulling in
# project-history/EntityRevision or other farm-app-internal concerns here.
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from django.contrib.auth import get_user_model
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from config.languages import SUPPORTED_LANGUAGE_CODES, normalize_language_tag
from crops.models import CropSpecies
from crops.permissions import is_public_library_admin, is_public_library_moderator, public_library_moderator_users
from crops.services import find_species_by_common_name
from farm.models import (
    Crop,
    Project,
    PublicCrop,
    PublicCropChangeProposal,
    PublicCropRevision,
    PublicCropSpeciesRelinkRequest,
    PublicCropStatusEvent,
    PublicCropTranslation,
    format_crop_display_name,
)

# The local Kultur/Sorte grouping is a farm-app concern this module deliberately
# does not re-implement: it only calls the service that owns it whenever
# publishing links a project crop to a crop species.
from farm.services.crop_inheritance import (
    CROP_INHERITABLE_FIELDS,
    CROP_SPECIES_INVARIANT_FIELDS,
    GeneralCropIndex,
    build_effective_crop_values,
    build_general_crop_index,
    crop_group_rows_to_sync,
    get_general_crop,
    resolve_crop_field,
    sync_crop_species_across_crop_group,
)

User = get_user_model()

CROP_COPY_FIELDS = [
    'name',
    'variety',
    'notes',
    'crop_family',
    'nutrient_demand',
    'cultivation_types',
    'cultivation_type',
    'growth_duration_days',
    'harvest_duration_days',
    'propagation_duration_days',
    'harvest_method',
    'expected_yield',
    'distance_within_row_m',
    'row_spacing_m',
    'sowing_depth_m',
    'seed_rate_value',
    'seed_rate_unit',
    'seed_rate_by_cultivation',
    'thousand_kernel_weight_g',
    'seeding_requirement',
    'seeding_requirement_type',
    'display_color',
]

PUBLIC_CROP_EDITABLE_FIELDS = [
    'variety',
    'notes',
    'crop_family',
    'nutrient_demand',
    'cultivation_types',
    'cultivation_type',
    'growth_duration_days',
    'harvest_duration_days',
    'propagation_duration_days',
    'harvest_method',
    'expected_yield',
    'distance_within_row_m',
    'row_spacing_m',
    'sowing_depth_m',
    'seed_rate_value',
    'seed_rate_unit',
    'seed_rate_by_cultivation',
    'thousand_kernel_weight_g',
    'seeding_requirement',
    'seeding_requirement_type',
    'display_color',
    'seed_packages',
]

# Kept as a module-level name for existing importers; the supported set
# itself now lives in config.languages so UI and content stay in sync.
PUBLIC_ORIGINAL_LANGUAGE_CODES = set(SUPPORTED_LANGUAGE_CODES)

PUBLIC_REQUIRED_FIELDS = [
    'variety',
    'growth_duration_days',
    'harvest_duration_days',
]


@dataclass(frozen=True)
class MissingRequiredField:
    field: str
    label_key: str


@dataclass(frozen=True)
class PublishingCheckResult:
    crop_species: CropSpecies | None
    original_language_code: str
    available_language_codes: list[str]
    missing_required_fields: list[MissingRequiredField]
    duplicates: list[DuplicateCandidate]
    can_publish: bool
    general_crop_notice: GeneralCropNotice | None = None


@dataclass(frozen=True)
class DuplicateCandidate:
    id: int
    name: str
    variety: str
    version: int
    published_at: Any
    created_by_label: str
    is_mine: bool


@dataclass(frozen=True)
class GeneralCropNotice:
    public_crop_id: int
    updated_at: Any
    is_stale: bool
    is_incomplete: bool


class DuplicatePublicCropError(Exception):
    """Raised when attempting to publish a crop that already exists publicly."""

    def __init__(self, *, duplicates: list[DuplicateCandidate], normalized_identity: dict[str, str]) -> None:
        super().__init__('A similar public crop already exists.')
        self.duplicates = duplicates
        self.normalized_identity = normalized_identity


class PublicCropPublishingValidationError(Exception):
    """Raised when the public-library quality gate rejects publication."""

    def __init__(self, *, check_result: PublishingCheckResult) -> None:
        super().__init__('Public crop publishing checks failed.')
        self.check_result = check_result


class PublicCropUpdateBlockedError(Exception):
    """Raised when a copy may not overwrite its public entry yet.

    Guards the case the diff dialog's "Ablehnen" makes reachable: a user who
    declined a public version must not be able to push their older local values
    over exactly that change from the publish/update flow.
    """

    def __init__(self, *, reason: str) -> None:
        super().__init__('Publishing this crop would overwrite an unreviewed public version.')
        self.reason = reason


class PublicCropLinkUnavailableError(Exception):
    """Raised when a crop's linked library entry is no longer published.

    The link is kept (withdrawal and removal are restorable), but neither a
    push into nor a pull from an unpublished entry is possible. ``reason`` is
    ``entry_withdrawn`` or ``entry_removed``.
    """

    code = 'public_crop_link_unavailable'

    def __init__(self, *, reason: str) -> None:
        super().__init__('The linked public entry is no longer published.')
        self.reason = reason


class PublicCropStatusTransitionError(Exception):
    """Raised when a public crop status transition is not allowed."""

    def __init__(self, message: str, *, code: str = 'invalid_status_transition') -> None:
        super().__init__(message)
        self.message = message
        self.code = code


class PublicCropPermissionError(Exception):
    """Raised when the user may not change a public crop status."""

    def __init__(self, message: str, *, code: str = 'permission_denied') -> None:
        super().__init__(message)
        self.message = message
        self.code = code


class PublicCropEditConflictError(Exception):
    """Raised when a public crop edit is based on a stale version."""

    def __init__(self, message: str, *, current_version: int) -> None:
        super().__init__(message)
        self.message = message
        self.current_version = current_version
        self.code = 'stale_public_crop_version'


class PublicCropIdentityConflictError(Exception):
    """Raised when renaming a public crop's variety would collide with another published entry.

    ``name`` (the crop) stays fixed after publication, but ``variety`` can be
    corrected to fix typos. Doing so must still respect the same
    crop+variety uniqueness invariant enforced at publish time, or two
    published entries could end up sharing one identity.
    """

    def __init__(self, *, conflicting_public_crop: PublicCrop) -> None:
        super().__init__('A published entry with this crop and variety already exists.')
        self.conflicting_public_crop = conflicting_public_crop
        self.code = 'public_crop_variety_conflict'


class PublicCropSpeciesRelinkError(Exception):
    """Raised when a "Kulturart korrigieren" relink is not applicable at all.

    Distinct from :class:`PublicCropIdentityConflictError`, which means the
    relink itself is well-formed but would collide with another entry: this
    one means the requested move makes no sense (same species, a rejected
    target, or an entry that is not published).
    """

    def __init__(self, message: str, *, code: str) -> None:
        super().__init__(message)
        self.message = message
        self.code = code


class UnsupportedPublicCropFieldsError(Exception):
    """Raised when an edit payload carries fields that are not publicly editable.

    A dedicated type rather than a bare ``ValueError`` so the view can answer
    with exactly the rejected field names instead of echoing the message of
    whatever ``ValueError`` happened to surface — including one raised deep
    inside a library, whose text is not ours to expose.
    """

    def __init__(self, fields: list[str]) -> None:
        super().__init__(f"Unsupported public crop fields: {', '.join(fields)}")
        self.fields = fields
        self.code = 'unsupported_public_crop_fields'

    @property
    def detail(self) -> str:
        """User-facing message, built only from the rejected field names."""
        return f"Unsupported public crop fields: {', '.join(self.fields)}"


class PublicCropRevisionNotFoundError(Exception):
    """Raised when a requested public crop version snapshot is missing."""

    def __init__(self, message: str = 'The requested public crop version was not found.') -> None:
        super().__init__(message)
        self.message = message
        self.code = 'public_crop_revision_not_found'


def _copy_fields(instance: Any) -> dict[str, Any]:
    payload = {field: getattr(instance, field) for field in CROP_COPY_FIELDS}
    payload['cultivation_types'] = list(payload.get('cultivation_types') or [])
    payload['seed_rate_by_cultivation'] = payload.get('seed_rate_by_cultivation') or None
    return payload


def _resolved_copy_fields(
    crop: Crop,
    index: GeneralCropIndex | None = None,
) -> dict[str, Any]:
    """``_copy_fields`` with every inheritable field resolved to its effective value.

    A Sorte that leaves an inheritable field unset takes its general Kultur's
    value; comparisons and the published payload must use that resolved value,
    not the blank stored on the Sorte, so an inherited value never reads as a
    local change to contribute (or as a field the publish would clear).
    Species-invariant fields are excluded — callers that need them resolve
    those explicitly. ``distance``/``row_spacing``/``sowing_depth`` and the
    per-method seed rates use different field names here than
    ``CROP_INHERITABLE_FIELDS`` and are intentionally left untouched.
    """
    payload = _copy_fields(crop)
    for field in CROP_INHERITABLE_FIELDS:
        if field in payload and field not in CROP_SPECIES_INVARIANT_FIELDS:
            payload[field] = resolve_crop_field(crop, field, index)
    return payload


def _json_safe(value: Any) -> Any:
    return json.loads(json.dumps(value, cls=DjangoJSONEncoder))


def build_public_crop_snapshot(public_crop: PublicCrop) -> dict[str, Any]:
    snapshot = {
        field: _json_safe(getattr(public_crop, field))
        for field in PUBLIC_CROP_EDITABLE_FIELDS
    }
    snapshot['crop_species'] = public_crop.crop_species_id
    snapshot['original_language_code'] = public_crop.original_language_code
    return snapshot


def build_public_crop_changed_fields(
    *,
    previous_snapshot: dict[str, Any],
    current_snapshot: dict[str, Any],
) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    for field in sorted(current_snapshot):
        old_value = previous_snapshot.get(field)
        new_value = current_snapshot.get(field)
        if old_value == new_value:
            continue
        changes.append({
            'field': field,
            'old_value': old_value,
            'new_value': new_value,
        })
    return changes


def create_public_crop_revision(
    *,
    public_crop: PublicCrop,
    user: User | None,
    action: str,
    previous_snapshot: dict[str, Any] | None = None,
    restored_from_version: int | None = None,
) -> PublicCropRevision:
    current_snapshot = build_public_crop_snapshot(public_crop)
    changed_fields = build_public_crop_changed_fields(
        previous_snapshot=previous_snapshot or {},
        current_snapshot=current_snapshot,
    ) if previous_snapshot is not None else []
    return PublicCropRevision.objects.create(
        public_crop=public_crop,
        version=public_crop.version,
        action=action,
        snapshot=current_snapshot,
        changed_fields=changed_fields,
        restored_from_version=restored_from_version,
        created_by=user,
    )


def ensure_public_crop_revision(public_crop: PublicCrop) -> PublicCropRevision:
    revision = public_crop.revisions.filter(version=public_crop.version).first()
    if revision is not None:
        return revision
    return create_public_crop_revision(
        public_crop=public_crop,
        user=public_crop.created_by,
        action=PublicCropRevision.ACTION_CREATED,
    )


def _validate_public_crop_edit_user(user: User | None) -> None:
    if not user or not user.is_authenticated:
        raise PublicCropPermissionError('Authentication is required to edit public crops.')


def _validate_base_version(public_crop: PublicCrop, base_version: int | None) -> None:
    if base_version is None:
        return
    if public_crop.version != base_version:
        raise PublicCropEditConflictError(
            'The public crop has changed since it was loaded.',
            current_version=public_crop.version,
        )


def find_public_crop_identity_conflict(
    public_crop: PublicCrop,
    *,
    variety: str,
    crop_species_id: int | None = None,
) -> PublicCrop | None:
    """Another published entry that a variety rename would collide with, if any.

    Mirrors the identity rule in :func:`detect_public_crop_duplicates`
    (species, or legacy name, plus normalized variety) but starts from an
    existing ``PublicCrop`` being renamed rather than a project ``Crop``
    being published, and excludes the entry itself.

    ``crop_species_id`` asks the same question about a species the entry does
    not carry yet, which is what the "Kulturart korrigieren" relink needs:
    the identity a relink lands on is the *target* species plus this entry's
    variety. It defaults to the entry's own species.
    """
    target_species_id = (
        crop_species_id if crop_species_id is not None else public_crop.crop_species_id
    )
    normalized_variety = normalize_identity_value(variety)
    queryset = PublicCrop.objects.filter(
        status=PublicCrop.STATUS_PUBLISHED,
        variety_normalized=normalized_variety,
    ).exclude(pk=public_crop.pk)
    if target_species_id:
        queryset = queryset.filter(
            Q(crop_species_id=target_species_id)
            | Q(crop_species__isnull=True, name_normalized=public_crop.name_normalized),
        )
    else:
        queryset = queryset.filter(name_normalized=public_crop.name_normalized)
    return queryset.first()


def update_public_crop_directly(
    *,
    public_crop: PublicCrop,
    user: User | None,
    data: dict[str, Any],
    base_version: int | None = None,
    allow_variety_rename: bool = False,
) -> PublicCrop:
    """Apply a wiki-style edit to a public entry as a new version.

    Renaming ``variety`` needs a library admin; ``allow_variety_rename`` lets
    the entry's own publisher do it too, which the full publish path has
    always allowed them.
    """
    _validate_public_crop_edit_user(user)
    unknown_fields = sorted(set(data) - set(PUBLIC_CROP_EDITABLE_FIELDS))
    if unknown_fields:
        raise UnsupportedPublicCropFieldsError(unknown_fields)

    with transaction.atomic():
        locked = PublicCrop.objects.select_for_update().get(pk=public_crop.pk)
        _validate_base_version(locked, base_version)
        ensure_public_crop_revision(locked)
        previous_snapshot = build_public_crop_snapshot(locked)
        if (
            'variety' in data
            and previous_snapshot.get('variety') != _json_safe(data['variety'])
            and not allow_variety_rename
            and not is_public_library_admin(user)
        ):
            raise PublicCropPermissionError(
                'Administrator privileges are required to rename a public crop variety.',
                code='public_crop_identity_admin_required',
            )
        changed_field_names = []
        for field, value in data.items():
            if previous_snapshot.get(field) == _json_safe(value):
                continue
            setattr(locked, field, value)
            changed_field_names.append(field)
        if not changed_field_names:
            return locked

        if 'variety' in changed_field_names:
            conflict = find_public_crop_identity_conflict(locked, variety=locked.variety)
            if conflict is not None:
                raise PublicCropIdentityConflictError(conflicting_public_crop=conflict)

        update_fields = [*changed_field_names, 'version', 'updated_at']
        if 'variety' in changed_field_names:
            update_fields.append('variety_normalized')
        locked.version = max(locked.version, 1) + 1
        locked.save(update_fields=update_fields)
        if 'notes' in changed_field_names:
            sync_original_language_translation(locked)
        create_public_crop_revision(
            public_crop=locked,
            user=user,
            action=PublicCropRevision.ACTION_UPDATED,
            previous_snapshot=previous_snapshot,
        )
        return locked


def restore_public_crop_version(
    *,
    public_crop: PublicCrop,
    user: User | None,
    version: int,
    base_version: int | None = None,
) -> PublicCrop:
    _validate_public_crop_edit_user(user)

    with transaction.atomic():
        locked = PublicCrop.objects.select_for_update().get(pk=public_crop.pk)
        _validate_base_version(locked, base_version)
        ensure_public_crop_revision(locked)
        revision = locked.revisions.filter(version=version).first()
        if revision is None:
            raise PublicCropRevisionNotFoundError()
        previous_snapshot = build_public_crop_snapshot(locked)
        if (
            revision.snapshot.get('variety') != previous_snapshot.get('variety')
            and not is_public_library_admin(user)
        ):
            raise PublicCropPermissionError(
                'Administrator privileges are required to restore a public crop variety.',
                code='public_crop_identity_admin_required',
            )
        update_fields = []
        for field in PUBLIC_CROP_EDITABLE_FIELDS:
            value = revision.snapshot.get(field)
            if previous_snapshot.get(field) == value:
                continue
            setattr(locked, field, value)
            update_fields.append(field)
        if not update_fields:
            return locked

        locked.version = max(locked.version, 1) + 1
        locked.save(update_fields=[*update_fields, 'version', 'updated_at'])
        if 'notes' in update_fields:
            # Restoring an old version rewrites `notes`; the original-language
            # translation has to follow, or the entry would keep rendering the
            # description of the version that was just rolled back.
            sync_original_language_translation(locked)
        create_public_crop_revision(
            public_crop=locked,
            user=user,
            action=PublicCropRevision.ACTION_RESTORED,
            previous_snapshot=previous_snapshot,
            restored_from_version=version,
        )
        return locked


def _seed_packages_payload_from_crop(crop: Crop) -> list[dict[str, Any]]:
    return [
        {
            'size_value': float(package.size_value),
            'size_unit': package.size_unit,
            'evidence_text': package.evidence_text,
            'last_seen_at': package.last_seen_at.isoformat() if package.last_seen_at else None,
        }
        for package in crop.seed_packages.order_by('size_unit', 'size_value')
    ]


def normalize_identity_value(value: str | None) -> str:
    """Normalize values used for duplicate identity comparisons."""
    compacted = re.sub(r'\s+', ' ', (value or '').strip())
    return compacted.lower()


# Species-invariant public fields (see CROP_SPECIES_INVARIANT_FIELDS): they
# describe the crop species, so only the species-level (general) public entry
# carries them. rotation_break_years is not a PublicCrop field.
PUBLIC_SPECIES_INVARIANT_FIELDS = ('crop_family', 'nutrient_demand')


def build_public_crop_payload(
    crop: Crop,
    *,
    public_variety: str | None = None,
    source_crop: Crop | None = None,
) -> dict[str, Any]:
    """The public-entry fields taken from ``crop``.

    ``source_crop`` overrides which project crop the entry records as its
    origin. It differs from ``crop`` only when a Sorte's publish creates the
    species-level entry alongside it: most values come from the Sorte, but the
    entry belongs to the project's general Kultur, which is the row that later
    updates it (see :func:`ensure_general_public_crop`). In that case the
    public entry's species-level name must also come from the general Kultur,
    so temporary variety/copy names never become the displayed Kultur name.

    ``crop_family`` and ``nutrient_demand`` follow the same rule as the whole
    Sorte -> Kultur value model: a species-linked variety entry never carries
    them (the library UI resolves them from the species entry), and the
    species-level entry takes them from the project's general Kultur rather
    than from the Sorte being published.
    """
    # Inheritable fields are resolved to the Sorte's effective value; the public
    # entry must carry that, not the blank stored on the Sorte. Species-invariant
    # fields are resolved explicitly further down.
    payload = _resolved_copy_fields(crop)
    if public_variety is not None:
        payload['variety'] = public_variety
    payload['seed_packages'] = _seed_packages_payload_from_crop(crop)
    origin_crop = source_crop or crop
    if source_crop is not None:
        payload['name'] = source_crop.name
    payload['source_project_crop'] = origin_crop
    payload['source_project'] = origin_crop.project
    payload['published_at'] = timezone.now()

    is_general_entry = not (payload['variety'] or '').strip()
    if is_general_entry:
        general_source = source_crop or get_general_crop(crop) or crop
        for field in PUBLIC_SPECIES_INVARIANT_FIELDS:
            payload[field] = getattr(general_source, field)
    elif crop.crop_species_id:
        # A species-linked variety entry does not own these fields: leave them
        # out of the payload so a create falls back to the blank default and an
        # update keeps whatever the entry already has (a moderator may have
        # curated it; migration 0102 handles the bulk of the historical data).
        for field in PUBLIC_SPECIES_INVARIANT_FIELDS:
            payload.pop(field, None)
    # A free-text variety (no crop_species) has no species entry to hold these
    # values, so it keeps its own — untouched from _copy_fields above.
    return payload


def normalize_language_code(value: str | None) -> str:
    """A supported content language code, or '' when unsupported/missing."""
    return normalize_language_tag(value)


def sync_original_language_translation(public_crop: PublicCrop) -> None:
    """Mirror ``notes`` into the entry's original-language translation row.

    ``notes`` stays the original-language copy (imports into projects and
    older consumers read it directly); the translation rows are the
    multi-language source of truth. Writing both keeps the two consistent
    without a second free-text field in the publishing UI.

    Translations in *other* languages are never touched here — they are
    editorial content that belongs to the library entry, not to the
    publisher's project crop.
    """
    language_code = normalize_language_code(public_crop.original_language_code)
    if not language_code:
        return
    description = (public_crop.notes or '').strip()
    if description:
        PublicCropTranslation.objects.update_or_create(
            public_crop=public_crop,
            language_code=language_code,
            defaults={'description': description},
        )
    else:
        PublicCropTranslation.objects.filter(
            public_crop=public_crop,
            language_code=language_code,
        ).delete()


def replace_public_crop_translations(
    *,
    public_crop: PublicCrop,
    user: User | None,
    descriptions: dict[str, str],
) -> PublicCrop:
    """Upsert the public description for the supplied languages.

    Languages present with blank text are removed; languages not mentioned at
    all are left untouched, because "I did not fill in English yet" must not
    mean "delete the English version". At least one non-empty language has to
    remain — an entry with no description in any language would render as an
    empty card.

    ``notes`` is kept in step with the original language so the import-into-a-
    project path keeps copying real text.
    """
    _validate_public_crop_edit_user(user)

    cleaned: dict[str, str] = {}
    for language_code, description in descriptions.items():
        normalized_code = normalize_language_code(language_code)
        if not normalized_code:
            continue
        cleaned[normalized_code] = (description or '').strip()

    with transaction.atomic():
        locked = PublicCrop.objects.select_for_update().get(pk=public_crop.pk)
        existing = {
            row.language_code: row.description
            for row in PublicCropTranslation.objects.filter(public_crop=locked)
        }
        merged = {**existing, **cleaned}
        if not any(text.strip() for text in merged.values()):
            raise PublicCropStatusTransitionError(
                'At least one language version must have a description.',
                code='translation_required',
            )

        for language_code, description in cleaned.items():
            if description:
                PublicCropTranslation.objects.update_or_create(
                    public_crop=locked,
                    language_code=language_code,
                    defaults={'description': description},
                )
            else:
                PublicCropTranslation.objects.filter(
                    public_crop=locked,
                    language_code=language_code,
                ).delete()

        original_code = normalize_language_code(locked.original_language_code)
        if original_code and original_code in cleaned:
            locked.notes = cleaned[original_code]
            locked.save(update_fields=['notes', 'updated_at'])
        return locked


def detect_available_language_codes(crop: Crop) -> list[str]:
    """Languages a *project* crop already has public content for.

    Project crops are single-language by design (their text is the user's
    own input, never duplicated per UI language), so this reports the
    languages of the public entry that was already published from it, if any.
    """
    public_crop = (
        PublicCrop.objects
        .filter(source_project_crop=crop)
        .prefetch_related('translations')
        .order_by('-published_at', '-id')
        .first()
    )
    if public_crop is None:
        return []
    return sorted(public_crop.descriptions_by_language())


def get_public_required_field_gaps(crop: Crop, *, require_variety: bool = True) -> list[MissingRequiredField]:
    gaps: list[MissingRequiredField] = []
    for field in PUBLIC_REQUIRED_FIELDS:
        if field == 'variety' and not require_variety:
            continue
        # Resolve the effective value so a Sorte that inherits a required field
        # (e.g. harvest duration) from its general Kultur is not flagged as
        # incomplete — the published entry carries the inherited value.
        value = resolve_crop_field(crop, field)
        if value is None or (isinstance(value, str) and not value.strip()):
            gaps.append(MissingRequiredField(field=field, label_key=f'library.publishWizard.fields.{field}'))
    return gaps


PUBLISHABLE_CROP_SPECIES_STATUSES = (CropSpecies.STATUS_PUBLISHED, CropSpecies.STATUS_PROPOSED)


def resolve_publishing_crop_species(*, crop: Crop, crop_species_id: int | None) -> CropSpecies | None:
    """A species usable as the publish target: published, or still pending moderation.

    A `proposed` species is intentionally allowed here so a user who just
    suggested a missing species inline doesn't have to wait for moderator
    approval before publishing their variety under it — the variety publishes
    right away and becomes fully official once the species is approved (the
    `CropSpecies` row is updated in place, so nothing needs to be relinked).
    `rejected` species are excluded.
    """
    if crop_species_id:
        return CropSpecies.objects.filter(
            id=crop_species_id, status__in=PUBLISHABLE_CROP_SPECIES_STATUSES,
        ).first()
    return (
        crop.crop_species
        if crop.crop_species and crop.crop_species.status in PUBLISHABLE_CROP_SPECIES_STATUSES
        else None
    )


def build_project_crop_payload(public_crop: PublicCrop) -> dict[str, Any]:
    payload = _copy_fields(public_crop)
    payload['crop_species'] = public_crop.crop_species
    payload['source_public_crop'] = public_crop
    payload['derived_from_public_crop'] = public_crop
    payload['source_public_version'] = public_crop.version
    payload['origin_type'] = Crop.ORIGIN_IMPORTED
    payload['is_modified_from_source'] = False
    # Taking a version over ends any earlier rejection: the copy is aligned again.
    payload['rejected_public_version'] = None
    return payload


def link_project_crop_to_public_reference(
    *,
    crop: Crop,
    public_crop: PublicCrop,
    pull_fields: Sequence[str] | None = None,
) -> Crop:
    """Link a private crop to a published public crop without publishing a duplicate.

    This is a one-time baseline comparison (crop-as-linked vs. public
    source), not the same check as ``Crop._flag_source_divergence``, which
    compares a crop's *own* previous vs. current row on every save to
    detect edits made after an import. There is no "previous row" yet here.

    ``pull_fields`` is the user's per-field decision from the link
    confirmation: those fields take the entry's values (see
    :func:`_pull_public_crop_fields`), every other difference is the user's own
    value, which the caller pushes afterwards. With a decision the baseline is
    always the entry's current version, so a remaining difference reads as a
    local change to contribute. Linking and pulling happen in one transaction.

    Without a decision (``None``, the per-Sorte "existing variety" link and
    older clients) no public value is copied — linking must never silently
    change local data. If the crop's own values then diverge from the entry,
    ``source_public_version`` is left unset so
    :func:`has_pending_public_crop_update` still offers the pull ("Kultur
    aktualisieren") flow.
    """
    if pull_fields is not None:
        _validate_sync_fields(crop, public_crop, pull_fields)
    with transaction.atomic():
        source_payload = build_project_crop_payload(public_crop)
        tracked_fields = Crop._SOURCE_DIVERGENCE_TRACKED_FIELDS
        if not (public_crop.variety or '').strip():
            # A general (species-level) public entry has no variety of its own, so
            # the private crop naming a specific cultivar is an inherent
            # granularity difference between the two, not a sign the user edited
            # anything relative to the source it's being linked to.
            tracked_fields = tracked_fields - {'variety'}

        crop.crop_species = public_crop.crop_species
        if pull_fields is not None:
            _pull_public_crop_fields(crop=crop, public_crop=public_crop, fields=pull_fields)
        is_modified = any(
            getattr(crop, field) != source_payload.get(field) for field in tracked_fields
        )
        crop.source_public_crop = public_crop
        # Computed after crop_species is reassigned above, so this sees the same
        # species-invariant-field exclusions has_pending_public_crop_update() will
        # see later (public_crop_field_changes reads crop.crop_species_id).
        remaining_changes = public_crop_field_changes(crop, public_crop)
        if pull_fields is not None:
            crop.source_public_version = public_crop.version
            is_modified = bool(_public_crop_sync_changes(crop, public_crop))
        else:
            crop.source_public_version = None if remaining_changes else public_crop.version
        crop.origin_type = Crop.ORIGIN_IMPORTED
        crop.save()
        # Crop.save() flags divergence against the pre-link row; the link sets
        # its own baseline flag instead (queryset update: no second revision).
        Crop.objects.filter(pk=crop.pk).update(is_modified_from_source=is_modified)
        crop.is_modified_from_source = is_modified
        sync_crop_species_across_crop_group(crop)
    return crop


class PublicCropUnlinkError(Exception):
    """Raised when a crop's library link may not be removed."""

    def __init__(self, message: str, *, code: str) -> None:
        super().__init__(message)
        self.message = message
        self.code = code


_UNPUBLISHED_LINK_REASONS = {
    PublicCrop.STATUS_WITHDRAWN: 'entry_withdrawn',
    PublicCrop.STATUS_REMOVED: 'entry_removed',
}


def unpublished_link_reason(crop: Crop) -> str | None:
    """``entry_withdrawn`` / ``entry_removed`` while the linked entry is not published, else None."""
    public_crop = crop.source_public_crop
    if public_crop is None:
        return None
    return _UNPUBLISHED_LINK_REASONS.get(public_crop.status)


def can_republish_withdrawn_entry(crop: Crop, user: User | None) -> bool:
    """Whether ``user`` may bring the crop's own withdrawn entry back by publishing again.

    A contributor's withdrawal is reversible (docs/crop-library-architecture.md
    §8); a removed entry is not (moderation decision), and a foreign withdrawn
    entry is not the user's to republish. The publish guard and the serializer's
    ``can_republish_public_crop`` both read this, so the offer matches the endpoint.
    """
    public_crop = crop.source_public_crop
    return bool(
        public_crop is not None
        and public_crop.status == PublicCrop.STATUS_WITHDRAWN
        and user is not None
        and public_crop.created_by_id == user.id
    )


def resolve_public_crop_unlink_block(crop: Crop, user: User | None) -> str | None:
    """Why the crop's library link may not be removed right now, or None if it may.

    The single predicate behind both the ``unlink-public-crop`` endpoint and the
    serializer's ``can_unlink_public_crop``, so the UI offers the action exactly
    when the endpoint accepts it. A link to the user's own entry is refused only
    while that entry is published: withdrawing it is the way out then, and an
    unlinked copy would collide with it on its next publish. Once the entry is
    withdrawn or removed the duplicate risk is gone.
    """
    public_crop = crop.source_public_crop
    if public_crop is None:
        return 'crop_not_linked'
    if (
        user is not None
        and public_crop.status == PublicCrop.STATUS_PUBLISHED
        and public_crop.created_by_id == user.id
    ):
        return 'crop_link_owned'
    return None


_UNLINK_BLOCK_MESSAGES = {
    'crop_not_linked': 'The crop is not linked to a public entry.',
    'crop_link_owned': 'The crop is linked to your own public entry.',
}


def unlink_crop_from_public_entry(*, crop: Crop, user: User | None) -> Crop:
    """Remove a crop's sync link to a public entry.

    Clears only the link the update model reads (`source_public_crop`,
    `source_public_version`, `rejected_public_version`); no crop value, no
    provenance (`derived_from_public_crop`), no `origin_type` and nothing in
    the public library changes. `is_modified_from_source` stays: provenance
    readers (`description_language_code`) still need to know whether the
    copy's values are the library's, and a relink recomputes it anyway.
    Linked Sorten keep their own links. See
    :func:`resolve_public_crop_unlink_block` for when it is refused.

    Saved through `Crop.save()` so the change is a normal crop revision in the
    project history and can be restored from there.
    """
    block = resolve_public_crop_unlink_block(crop, user)
    if block is not None:
        raise PublicCropUnlinkError(_UNLINK_BLOCK_MESSAGES[block], code=block)
    public_crop = crop.source_public_crop
    # Keep (or, for a link written by a queryset update, record) provenance.
    crop.derived_from_public_crop_id = crop.derived_from_public_crop_id or public_crop.id
    crop.source_public_crop = None
    crop.source_public_version = None
    crop.rejected_public_version = None
    crop.save()
    return crop


class PublicCropSyncFieldsError(Exception):
    """Raised when a sync names fields outside the compared set or not pushable."""

    def __init__(self, fields: list[str], *, code: str = 'invalid_public_crop_sync_fields') -> None:
        super().__init__(f"Invalid public crop sync fields: {', '.join(fields)}")
        self.fields = fields
        self.code = code


@dataclass(frozen=True)
class PublicCropSyncField:
    """One differing field of a linked crop and its public entry."""

    field: str
    local_value: Any
    public_value: Any
    pushable: bool


@dataclass(frozen=True)
class PublicCropSyncResult:
    crop: Crop
    public_crop: PublicCrop
    # 'synced' (pushed live or nothing to push) or 'pending_moderation'.
    operation: str
    proposal: PublicCropChangeProposal | None = None


def _sync_comparison_crop(crop: Crop, public_crop: PublicCrop) -> Crop:
    """``crop`` as the sync compares it: with the species the link sets.

    The species decides which fields a species-linked Sorte compares, so the
    preview, the validation and the resulting baseline must all read it from
    the entry. Only the id is read by the comparison; assigning it on a shallow
    copy leaves the caller's instance (and its relation cache) untouched.
    """
    if crop.crop_species_id == public_crop.crop_species_id:
        return crop
    comparison_crop = copy.copy(crop)
    comparison_crop.crop_species_id = public_crop.crop_species_id
    return comparison_crop


def _sync_compared_fields(crop: Crop, public_crop: PublicCrop) -> list[str]:
    """The fields a sync compares, pulls and pushes between ``crop`` and ``public_crop``.

    ``variety`` is left out against a general (species-level) entry, the same
    rule as :func:`_owned_entry_is_locally_modified`: a Sorte linked to it (a
    ``publish_as_general`` publish) differs by granularity, not by an edit, and
    neither pulling the blank nor pushing the Sorte's name would be a sync.
    """
    fields = _compared_public_update_fields(_sync_comparison_crop(crop, public_crop))
    if not (public_crop.variety or '').strip():
        fields = [field for field in fields if field != 'variety']
    return fields


def _public_crop_sync_changes(
    crop: Crop, public_crop: PublicCrop,
) -> list[tuple[str, Any, Any]]:
    """:func:`public_crop_field_changes` restricted to :func:`_sync_compared_fields`."""
    compared = set(_sync_compared_fields(crop, public_crop))
    comparison_crop = _sync_comparison_crop(crop, public_crop)
    return [
        change
        for change in public_crop_field_changes(comparison_crop, public_crop)
        if change[0] in compared
    ]


def _validate_sync_fields(crop: Crop, public_crop: PublicCrop, fields: Sequence[str]) -> None:
    unknown = sorted(set(fields) - set(_sync_compared_fields(crop, public_crop)))
    if unknown:
        raise PublicCropSyncFieldsError(unknown)


def public_crop_pushable_sync_fields(
    *,
    crop: Crop,
    public_crop: PublicCrop,
    user: User | None,
    require_moderation: bool,
) -> set[str]:
    """The compared fields a sync may write into ``public_crop``.

    ``name`` is fixed once published. ``variety`` is the entry's identity:
    only its publisher or a library admin may rename it, and never through the
    moderation queue (proposals carry no identity changes).
    """
    fields = set(_sync_compared_fields(crop, public_crop)) & set(PUBLIC_CROP_EDITABLE_FIELDS)
    can_rename_variety = bool(
        user is not None
        and not require_moderation
        and (public_crop.created_by_id == user.id or is_public_library_admin(user))
    )
    if not can_rename_variety:
        fields.discard('variety')
    return fields


def build_public_crop_sync_preview(
    *,
    crop: Crop,
    public_crop: PublicCrop,
    user: User | None,
    require_moderation: bool,
) -> list[PublicCropSyncField]:
    """Every compared field where ``crop`` and ``public_crop`` differ.

    Also answers for an entry the crop is not linked to yet (the link
    confirmation): the comparison then assumes the species the link would set
    (see :func:`_sync_comparison_crop`).
    """
    pushable = public_crop_pushable_sync_fields(
        crop=crop, public_crop=public_crop, user=user, require_moderation=require_moderation,
    )
    return [
        PublicCropSyncField(
            field=field,
            local_value=_json_safe(local_value),
            public_value=_json_safe(public_value),
            pushable=field in pushable,
        )
        for field, local_value, public_value in _public_crop_sync_changes(crop, public_crop)
    ]


def _pull_public_crop_fields(
    *, crop: Crop, public_crop: PublicCrop, fields: Sequence[str],
) -> list[str]:
    """Copy ``fields`` from ``public_crop`` onto ``crop`` (unsaved); returns the ones written.

    A field whose *effective* value already equals the entry's is left alone:
    on a Sorte that inherits it from its general Kultur, writing the same value
    as a raw one would turn live inheritance into a frozen local override.
    """
    remote = _copy_fields(public_crop)
    effective = _resolved_copy_fields(crop)
    written = [field for field in fields if effective[field] != remote[field]]
    for field in written:
        setattr(crop, field, remote[field])
    return written


def _queue_public_crop_sync_proposal(
    *,
    public_crop: PublicCrop,
    user: User | None,
    data: dict[str, Any],
    origin_api: bool,
    origin_declared_agent: bool,
) -> PublicCropChangeProposal:
    # Local import: the moderation helpers live with the views' request logic.
    from farm.crops.moderation import truncate_proposal_summary

    label = format_crop_display_name(public_crop.name, public_crop.variety)
    proposal = PublicCropChangeProposal.objects.create(
        public_crop=public_crop,
        kind=PublicCropChangeProposal.KIND_EDIT,
        summary=truncate_proposal_summary(f'Update awaiting moderation: {label}'),
        proposed_data=_json_safe(data),
        proposed_by=user,
        origin_api=origin_api,
        origin_declared_agent=origin_declared_agent,
    )
    notify_moderators_of_change_proposal(proposal)
    return proposal


def sync_crop_with_public_entry(
    *,
    crop: Crop,
    public_crop: PublicCrop,
    user: User | None,
    pull_fields: Sequence[str],
    push_fields: Sequence[str],
    base_version: int | None,
    require_moderation: bool = False,
    origin_api: bool = False,
    origin_declared_agent: bool = False,
) -> PublicCropSyncResult:
    """Resolve every difference between a linked crop and its entry in one step.

    ``pull_fields`` take the entry's values locally (the same rules as the
    link's pull, :func:`_pull_public_crop_fields`); ``push_fields`` write the
    crop's effective values into the entry through the direct-edit path
    (:func:`update_public_crop_directly`), restricted to exactly those fields —
    or, for a contributor whose edits are moderated, into one edit proposal.
    Nothing to push creates no public version. Afterwards the crop's baseline
    is the entry's resulting version.
    """
    _validate_sync_fields(crop, public_crop, [*pull_fields, *push_fields])
    overlap = sorted(set(pull_fields) & set(push_fields))
    if overlap:
        raise PublicCropSyncFieldsError(overlap)
    pushable = public_crop_pushable_sync_fields(
        crop=crop, public_crop=public_crop, user=user, require_moderation=require_moderation,
    )
    not_pushable = sorted(set(push_fields) - pushable)
    if not_pushable:
        raise PublicCropSyncFieldsError(not_pushable, code='public_crop_sync_field_not_pushable')

    proposal: PublicCropChangeProposal | None = None
    with transaction.atomic():
        locked = PublicCrop.objects.select_for_update().get(pk=public_crop.pk)
        _validate_base_version(locked, base_version)
        if pull_fields:
            _pull_public_crop_fields(crop=crop, public_crop=locked, fields=pull_fields)
            crop.save()
        if push_fields:
            payload = build_public_crop_payload(crop)
            data = {field: payload[field] for field in push_fields if field in payload}
            if require_moderation:
                proposal = _queue_public_crop_sync_proposal(
                    public_crop=locked,
                    user=user,
                    data=data,
                    origin_api=origin_api,
                    origin_declared_agent=origin_declared_agent,
                )
            else:
                locked = update_public_crop_directly(
                    public_crop=locked,
                    user=user,
                    data=data,
                    allow_variety_rename='variety' in pushable,
                )
        is_modified = bool(_public_crop_sync_changes(crop, locked))
        Crop.objects.filter(pk=crop.pk).update(
            source_public_crop=locked,
            source_public_version=locked.version,
            is_modified_from_source=is_modified,
            rejected_public_version=None,
        )
        crop.source_public_crop = locked
        crop.source_public_version = locked.version
        crop.is_modified_from_source = is_modified
        crop.rejected_public_version = None
    return PublicCropSyncResult(
        crop=crop,
        public_crop=locked,
        operation='pending_moderation' if proposal is not None else 'synced',
        proposal=proposal,
    )


def _owned_entry_is_locally_modified(local_crop: Crop, entry: PublicCrop) -> bool:
    """Whether ``local_crop`` carries library-relevant content the entry lacks.

    Uses the same compared-field set and inheritance resolution as
    :func:`public_crop_update_changes`, so "nothing to contribute" stays
    consistent between the push gate and this baseline flag. ``variety`` is
    dropped when the entry is species-level: a specific Sorte linked to the
    general entry is an inherent granularity difference, not a local edit.
    """
    local = _resolved_copy_fields(local_crop)
    remote = _copy_fields(entry)
    fields = _compared_public_update_fields(local_crop)
    if not (entry.variety or '').strip():
        fields = [field for field in fields if field != 'variety']
    return any(local[field] != remote[field] for field in fields)


def link_local_crop_to_owned_public_entry(local_crop: Crop, entry: PublicCrop) -> None:
    """Record ``entry`` as ``local_crop``'s library baseline after a publish/push.

    Mirrors an import link (``source_public_crop`` / ``source_public_version``)
    so the pull flow — update notice, diff dialog, reject — works for a crop the
    user *published*, not only for one they imported. Unlike an import it never
    sets ``origin_type='imported'``: the row stays the user's own and the
    "Importiert" chip must not appear. A queryset ``update`` keeps
    ``Crop.save``'s divergence pass and revision recording out of it.
    """
    is_modified = _owned_entry_is_locally_modified(local_crop, entry)
    Crop.objects.filter(pk=local_crop.pk).update(
        source_public_crop=entry,
        source_public_version=entry.version,
        is_modified_from_source=is_modified,
        rejected_public_version=None,
    )
    local_crop.source_public_crop = entry
    local_crop.source_public_version = entry.version
    local_crop.is_modified_from_source = is_modified
    local_crop.rejected_public_version = None


def _link_owned_entry_to_project_rows(
    *,
    crop: Crop,
    entry: PublicCrop,
    crop_species: CropSpecies,
    publish_as_general: bool,
) -> None:
    """Link the local rows that own ``entry`` to it: the published crop, and —
    for a variety publish — its general Kultur against the species-level entry,
    so a later library change to either surfaces as a pull on the right row."""
    link_local_crop_to_owned_public_entry(crop, entry)
    if publish_as_general or not (crop.variety or '').strip():
        return
    general_crop = get_general_crop(crop)
    general_entry = find_general_public_crop(crop_species)
    if general_crop is not None and general_entry is not None and general_crop.pk != crop.pk:
        link_local_crop_to_owned_public_entry(general_crop, general_entry)


def detect_public_crop_duplicates(
    crop: Crop,
    *,
    crop_species: CropSpecies | None = None,
    public_variety: str | None = None,
    user: User | None = None,
) -> list[DuplicateCandidate]:
    """Published entries that would be duplicates of this crop.

    Identity is the *language-independent* species plus a normalized variety
    name — never a localized name plus variety. Otherwise "Tomate +
    Moneymaker" and "Tomato + Moneymaker" would look like two different crops
    when they are one.

    When the caller did not pass a species, the crop's own name is resolved
    against every species translation first, so publishing an English-named
    crop still finds the German-named entry (and vice versa). Only if no
    species can be determined at all does this fall back to name matching, for
    legacy entries that predate species links.

    Normalization is intentionally shallow — trim, collapse whitespace,
    case-fold — and never touches the stored or displayed original name.
    """
    normalized_variety = (
        normalize_identity_value(public_variety)
        if public_variety is not None
        else crop.variety_normalized
    )
    queryset = PublicCrop.objects.filter(
        variety_normalized=normalized_variety,
        status=PublicCrop.STATUS_PUBLISHED,
    )
    species = crop_species or crop.crop_species or find_species_by_common_name(crop.name)
    if species is not None:
        # Match the species either directly or through a legacy entry that
        # carries the same localized name but no species link yet.
        queryset = queryset.filter(
            Q(crop_species=species) | Q(crop_species__isnull=True, name_normalized=crop.name_normalized),
        )
    else:
        queryset = queryset.filter(name_normalized=crop.name_normalized)
    queryset = queryset.select_related('created_by').order_by('-published_at', '-id')

    candidates: list[DuplicateCandidate] = []
    for item in queryset:
        candidates.append(DuplicateCandidate(
            id=item.id,
            name=item.name,
            variety=item.variety,
            version=item.version,
            published_at=item.published_at,
            created_by_label=item.created_by_label,
            is_mine=bool(user and user.is_authenticated and item.created_by_id == user.id),
        ))
        if len(candidates) >= 5:
            break
    return candidates


def _resolve_public_variety(publish_as_general: bool) -> str | None:
    """The ``public_variety`` sentinel for :func:`build_public_crop_payload`.

    ``''`` forces a species-level (variety-less) entry; ``None`` means "keep
    the crop's own variety verbatim". Every publish/update call site needs
    this same mapping, so it lives in one place instead of being re-derived
    (and risking one call site falling out of sync with the others).
    """
    return '' if publish_as_general else None


def build_publishing_check_result(
    *,
    crop: Crop,
    crop_species_id: int | None,
    original_language_code: str | None,
    user: User | None = None,
    publish_as_general: bool = False,
) -> PublishingCheckResult:
    crop_species = resolve_publishing_crop_species(crop=crop, crop_species_id=crop_species_id)
    language_code = normalize_language_code(original_language_code)
    available_language_codes = detect_available_language_codes(crop)
    if language_code and language_code not in available_language_codes:
        available_language_codes = [language_code, *available_language_codes]
    public_variety = _resolve_public_variety(publish_as_general)
    duplicates = detect_public_crop_duplicates(
        crop,
        crop_species=crop_species,
        public_variety=public_variety,
        user=user,
    ) if crop_species else []
    update_target = find_owned_public_crop_for_update(crop=crop, user=user)
    if update_target:
        duplicates = [item for item in duplicates if item.id != update_target.id]
    missing_required_fields = get_public_required_field_gaps(crop, require_variety=not publish_as_general)
    can_publish = bool(crop_species and language_code and not missing_required_fields and not duplicates)
    general_crop_notice = (
        build_general_crop_notice(crop_species) if crop_species and not publish_as_general else None
    )
    return PublishingCheckResult(
        crop_species=crop_species,
        original_language_code=language_code,
        available_language_codes=available_language_codes,
        missing_required_fields=missing_required_fields,
        duplicates=duplicates,
        can_publish=can_publish,
        general_crop_notice=general_crop_notice,
    )


GENERAL_CROP_STALE_THRESHOLD_DAYS = 730  # ~24 months


def find_general_public_crop(crop_species: CropSpecies) -> PublicCrop | None:
    """The species-level (variety-less) published entry for `crop_species`, if any."""
    return PublicCrop.objects.filter(
        crop_species=crop_species,
        variety_normalized='',
        status=PublicCrop.STATUS_PUBLISHED,
    ).order_by('-updated_at', '-id').first()


def build_general_crop_notice(crop_species: CropSpecies) -> GeneralCropNotice | None:
    """Surface a dismissible hint when the species-level public data looks neglected.

    Only reports on an *existing* general entry — a missing one is handled by
    `ensure_general_public_crop` creating it automatically on publish, not
    by warning about it here.
    """
    general = find_general_public_crop(crop_species)
    if general is None:
        return None
    is_stale = (timezone.now() - general.updated_at).days > GENERAL_CROP_STALE_THRESHOLD_DAYS
    is_incomplete = bool(get_public_required_field_gaps(general, require_variety=False))
    if not is_stale and not is_incomplete:
        return None
    return GeneralCropNotice(
        public_crop_id=general.id,
        updated_at=general.updated_at,
        is_stale=is_stale,
        is_incomplete=is_incomplete,
    )


def ensure_general_public_crop(
    *,
    crop_species: CropSpecies,
    crop: Crop,
    original_language_code: str,
    user: User | None,
) -> PublicCrop | None:
    """Create the species-level public entry from `crop`'s values if it doesn't exist yet.

    Publishing a variety must never touch an *existing* general entry — other
    contributors may already have curated it — so this is a no-op whenever one
    is found, regardless of how different `crop`'s own values are.

    The entry's values come from the Sorte, but it is recorded as originating
    from the project's general Kultur when there is one: that row is what the
    user sees as the published Kultur afterwards, so it must be the row that
    owns and updates the entry.
    """
    if find_general_public_crop(crop_species) is not None:
        return None

    public_crop = PublicCrop.objects.create(
        created_by=user,
        status=PublicCrop.STATUS_PUBLISHED,
        version=1,
        crop_species=crop_species,
        original_language_code=original_language_code,
        **build_public_crop_payload(
            crop,
            public_variety='',
            source_crop=get_general_crop(crop),
        ),
    )
    sync_original_language_translation(public_crop)
    _record_public_crop_status_event(
        public_crop=public_crop,
        from_status='',
        to_status=PublicCrop.STATUS_PUBLISHED,
        user=user,
    )
    create_public_crop_revision(
        public_crop=public_crop,
        user=user,
        action=PublicCropRevision.ACTION_CREATED,
    )
    return public_crop


def find_owned_public_crop_for_update(*, crop: Crop, user: User | None) -> PublicCrop | None:
    """Return the public crop that this user is allowed to update for the given crop."""
    if user is None:
        return None

    if crop.source_public_crop_id:
        source_public = PublicCrop.objects.filter(
            id=crop.source_public_crop_id,
            status__in=[PublicCrop.STATUS_PUBLISHED, PublicCrop.STATUS_WITHDRAWN],
        ).first()
        if source_public and source_public.created_by_id == user.id:
            return source_public
        # source_public_crop points at an entry owned by someone else (e.g. a
        # collaborator imported/linked it): that doesn't rule out the user having
        # already published their own copy of this same project crop, so fall
        # through to the source_project_crop lookup below instead of bailing.

    linked_public_crop = PublicCrop.objects.filter(
        source_project_crop=crop,
        created_by=user,
        status__in=[PublicCrop.STATUS_PUBLISHED, PublicCrop.STATUS_WITHDRAWN],
    ).order_by('-updated_at', '-id').first()
    if linked_public_crop is not None:
        return linked_public_crop

    return find_owned_general_public_crop_for_update(crop=crop, user=user)


def find_owned_general_public_crop_for_update(
    *,
    crop: Crop,
    user: User | None,
) -> PublicCrop | None:
    """Return this user's species-level public entry for a local general Kultur."""
    if user is None or not getattr(user, 'is_authenticated', False):
        return None
    if not crop.crop_species_id or (crop.variety or '').strip():
        return None
    return (
        PublicCrop.objects
        .filter(
            Q(variety_normalized__isnull=True) | Q(variety_normalized=''),
            crop_species_id=crop.crop_species_id,
            created_by=user,
            status__in=[PublicCrop.STATUS_PUBLISHED, PublicCrop.STATUS_WITHDRAWN],
        )
        .order_by('-updated_at', '-id')
        .first()
    )


def _record_public_crop_status_event(
    *,
    public_crop: PublicCrop,
    from_status: str,
    to_status: str,
    user: User | None,
    reason: str = '',
    note: str = '',
) -> None:
    PublicCropStatusEvent.objects.create(
        public_crop=public_crop,
        from_status=from_status,
        to_status=to_status,
        reason=reason,
        note=note,
        created_by=user,
    )


def _set_public_crop_status(
    *,
    public_crop: PublicCrop,
    status: str,
    user: User | None,
    reason: str = '',
    note: str = '',
) -> PublicCrop:
    previous_status = public_crop.status
    public_crop.status = status
    public_crop.status_changed_at = timezone.now()
    public_crop.status_changed_by = user
    public_crop.removal_reason = reason if status == PublicCrop.STATUS_REMOVED else ''
    public_crop.status_note = note
    if status == PublicCrop.STATUS_PUBLISHED:
        public_crop.published_at = timezone.now()
    public_crop.save(update_fields=[
        'status',
        'status_changed_at',
        'status_changed_by',
        'removal_reason',
        'status_note',
        'published_at',
        'updated_at',
    ])
    _record_public_crop_status_event(
        public_crop=public_crop,
        from_status=previous_status,
        to_status=status,
        user=user,
        reason=reason,
        note=note,
    )
    return public_crop


def _is_public_library_moderator(user: User | None) -> bool:
    return is_public_library_moderator(user)


def _update_public_crop_from_project_crop(
    *,
    public_crop: PublicCrop,
    crop: Crop,
    public_variety: str | None = None,
) -> PublicCrop:
    ensure_public_crop_revision(public_crop)
    previous_snapshot = build_public_crop_snapshot(public_crop)
    payload = build_public_crop_payload(crop, public_variety=public_variety)
    payload.pop('published_at', None)
    for field, value in payload.items():
        setattr(public_crop, field, value)
    public_crop.version = max(public_crop.version, 1) + 1
    if public_crop.status == PublicCrop.STATUS_WITHDRAWN:
        public_crop.status = PublicCrop.STATUS_PUBLISHED
        public_crop.published_at = timezone.now()
        public_crop.status_changed_at = timezone.now()
    public_crop.save()
    create_public_crop_revision(
        public_crop=public_crop,
        user=public_crop.created_by,
        action=PublicCropRevision.ACTION_UPDATED,
        previous_snapshot=previous_snapshot,
    )
    return public_crop


def _link_crop_to_crop_species(
    *,
    crop: Crop,
    crop_species: CropSpecies,
    previous_species_id: int | None = None,
) -> None:
    """Record the species the crop was published under, group and all.

    Publishing must leave the project's own Kulturen exactly as they were apart
    from this link, so the rest of the crop's Kultur group adopts the species
    with it — otherwise publishing one Sorte would leave a second Kultur of the
    same name behind for the Sorten that stayed unpublished.

    ``previous_species_id`` carries the same guarantee through a public
    "Kulturart korrigieren" correction, where the group's rows already hold the
    species being corrected away from instead of none.
    """
    crop.crop_species = crop_species
    crop.save(update_fields=['crop_species', 'updated_at'])
    sync_crop_species_across_crop_group(crop, previous_species_id=previous_species_id)


@dataclass(frozen=True)
class PublicCropSpeciesRelinkResult:
    """Outcome of a "Kulturart korrigieren" request.

    ``status`` is ``RELINKED`` when the correction was applied, or
    ``PENDING_SPECIES_PROPOSAL`` when the target species is still awaiting
    moderation and the relink was recorded to run on approval instead.
    """

    STATUS_RELINKED = 'relinked'
    STATUS_PENDING_SPECIES_PROPOSAL = 'pending_species_proposal'

    public_crop: PublicCrop
    status: str
    relink_request: PublicCropSpeciesRelinkRequest | None = None


def _validate_public_crop_species_relink(
    *,
    public_crop: PublicCrop,
    user: User | None,
    crop_species: CropSpecies,
    variety: str | None = None,
) -> None:
    """Everything that makes a relink inapplicable, before anything is written.

    Moderator-gated rather than admin-gated on purpose: correcting a wrong
    species mapping does not mutate the entry's locked ``name`` identity. The
    ``variety`` may move alongside it (splitting a too-general species, e.g.
    "Gurke", into more specific ones means each Sorte's variety often needs
    correcting in the same step, not just its species) — but an actual variety
    *change* still mutates that part of the identity, so it stays behind the
    same admin gate :func:`update_public_crop_directly` uses for a direct
    variety rename (``public_crop_identity_admin_required``). A moderator who
    is not an admin may still relink the species alone.

    ``variety`` is ``None`` when the caller is not touching it, which keeps
    the "nothing actually changed" check — and the permission check above —
    about the species alone in that case.
    """
    if not _is_public_library_moderator(user):
        raise PublicCropPermissionError(
            'Moderator privileges are required to correct a crop species mapping.',
            code='moderator_required',
        )
    if public_crop.status != PublicCrop.STATUS_PUBLISHED:
        raise PublicCropStatusTransitionError(
            'Only published entries can have their crop species corrected.',
        )
    if crop_species.status == CropSpecies.STATUS_REJECTED:
        raise PublicCropSpeciesRelinkError(
            'A rejected crop species cannot be used as a mapping target.',
            code='crop_species_rejected',
        )
    if (
        variety is not None
        and variety != public_crop.variety
        and not is_public_library_admin(user)
    ):
        raise PublicCropPermissionError(
            'Administrator privileges are required to rename a public crop variety.',
            code='public_crop_identity_admin_required',
        )
    target_variety = variety if variety is not None else public_crop.variety
    if crop_species.pk == public_crop.crop_species_id and target_variety == public_crop.variety:
        raise PublicCropSpeciesRelinkError(
            'This entry is already mapped to that crop species and variety.',
            code='crop_species_unchanged',
        )
    conflict = find_public_crop_identity_conflict(
        public_crop,
        variety=target_variety,
        crop_species_id=crop_species.pk,
    )
    if conflict is not None:
        raise PublicCropIdentityConflictError(conflicting_public_crop=conflict)


def _apply_public_crop_species_relink(
    *,
    public_crop: PublicCrop,
    user: User | None,
    crop_species: CropSpecies,
    variety: str | None = None,
) -> PublicCrop:
    """Move a published entry onto another species (and variety) and audit the move.

    The audit is a :class:`PublicCropRevision`, not a
    :class:`PublicCropStatusEvent`: the entry's status does not change, and the
    revision's ``changed_fields`` already carry exactly what has to be on
    record — who, when, and the old and new ``crop_species``/``variety``.

    The species being corrected away from is deliberately left untouched: other
    entries may still map to it correctly, and taking it out of circulation is
    the separate species reject/lifecycle decision.

    ``variety`` is ``None`` when the caller is not touching it.
    """
    with transaction.atomic():
        locked = PublicCrop.objects.select_for_update().get(pk=public_crop.pk)
        previous_species_id = locked.crop_species_id
        target_variety = variety if variety is not None else locked.variety
        if previous_species_id == crop_species.pk and target_variety == locked.variety:
            return locked
        # Re-asked under the row lock: the caller's check ran before it, so a
        # concurrent publish or relink could have claimed this identity since.
        conflict = find_public_crop_identity_conflict(
            locked,
            variety=target_variety,
            crop_species_id=crop_species.pk,
        )
        if conflict is not None:
            raise PublicCropIdentityConflictError(conflicting_public_crop=conflict)
        ensure_public_crop_revision(locked)
        previous_snapshot = build_public_crop_snapshot(locked)
        locked.crop_species = crop_species
        locked.variety = target_variety
        locked.version = max(locked.version, 1) + 1
        locked.save(update_fields=['crop_species', 'variety', 'variety_normalized', 'version', 'updated_at'])
        create_public_crop_revision(
            public_crop=locked,
            user=user,
            action=PublicCropRevision.ACTION_SPECIES_RELINKED,
            previous_snapshot=previous_snapshot,
        )
        _sync_owned_crop_group_species(
            public_crop=locked,
            crop_species=crop_species,
            previous_species_id=previous_species_id,
            user=user,
        )
        return locked


def _sync_owned_crop_group_species(
    *,
    public_crop: PublicCrop,
    crop_species: CropSpecies,
    previous_species_id: int | None,
    user: User | None,
) -> None:
    """Keep the private crop group behind an entry on the corrected species.

    Publishing links the source crop and its Kultur group to the species it was
    published under; a correction has to follow, or the owner is left with a
    group split between the wrong species and the corrected one.

    The move can change what those rows inherit, so their effective values are
    snapshotted first and the project is told about any real change — see
    :func:`notify_project_of_crop_species_reassignment`.
    """
    crop = public_crop.source_project_crop
    if crop is None or crop.deleted_at is not None:
        return
    moved_crop_ids = _crop_group_member_ids(
        crop,
        target_species_id=crop_species.pk,
        previous_species_id=previous_species_id,
    )
    values_before = _effective_values_by_crop(moved_crop_ids, project_id=crop.project_id)
    _link_crop_to_crop_species(
        crop=crop,
        crop_species=crop_species,
        previous_species_id=previous_species_id,
    )
    notify_project_of_crop_species_reassignment(
        project_id=crop.project_id,
        values_before=values_before,
        previous_species_id=previous_species_id,
        crop_species=crop_species,
        user=user,
    )


def _crop_group_member_ids(
    crop: Crop,
    *,
    target_species_id: int,
    previous_species_id: int | None,
) -> list[int]:
    """``crop`` plus every row the group sync will move with it."""
    sibling_ids = crop_group_rows_to_sync(
        crop,
        target_species_id=target_species_id,
        previous_species_id=previous_species_id,
    ).values_list('pk', flat=True)
    return [crop.pk, *sibling_ids]


def _effective_values_by_crop(
    crop_ids: Sequence[int],
    *,
    project_id: int | None,
) -> dict[int, dict[str, Any]]:
    """Every listed crop's effective inheritable values, freshly resolved.

    Read from the database rather than from instances the caller holds:
    :func:`get_general_crop` caches its lookup on the instance, so a snapshot
    taken after the move would otherwise still answer with the general Kultur
    resolved before it.
    """
    index = build_general_crop_index(project_id)
    return {
        crop.pk: build_effective_crop_values(crop, index)
        for crop in Crop.objects.filter(pk__in=list(crop_ids))
    }


def _inherited_value_changes(
    previous_values: dict[str, Any],
    current_values: dict[str, Any],
) -> list[dict[str, Any]]:
    """``{field, old_value, new_value}`` for every effective value that moved.

    The same diff shape the public-update preview renders, so the notification
    reuses the frontend's existing field labels and value formatting instead of
    growing a second one.
    """
    return [
        {
            'field': field,
            'old_value': _json_safe(previous_values.get(field)),
            'new_value': _json_safe(current_values.get(field)),
        }
        for field in CROP_INHERITABLE_FIELDS
        if previous_values.get(field) != current_values.get(field)
    ]


def notify_project_of_crop_species_reassignment(
    *,
    project_id: int | None,
    values_before: dict[int, dict[str, Any]],
    previous_species_id: int | None,
    crop_species: CropSpecies,
    user: User | None,
) -> int:
    """Tell a project that a moderator's species correction moved its own values.

    The public library's inheritance is live, not a snapshot: a Sorte resolves
    its unset fields through the general Kultur of its ``(project, species)``
    group. Moving the group onto another species can therefore land it on a
    *different* general Kultur — one the project already had for that species —
    and the Sorte's effective values change without anybody in the project
    touching anything. "Explizit statt still" means that has to be announced.

    Only rows whose effective values actually moved are reported, so a pure
    mapping correction stays silent. Every member of the project is notified,
    not only its admins: the values are what everyone plans with. Returns the
    number of notifications created.

    Imported locally for the same reason this module's other cross-app call is
    (see :func:`_notify_relink_request_cancelled`).
    """
    from notifications.models import Notification
    from notifications.services import create_notification

    if project_id is None or not values_before:
        return 0
    values_after = _effective_values_by_crop(values_before, project_id=project_id)
    changes_by_crop = {
        crop_id: changes
        for crop_id, previous_values in values_before.items()
        if (changes := _inherited_value_changes(previous_values, values_after.get(crop_id, {})))
    }
    if not changes_by_crop:
        return 0

    previous_species_name = _crop_species_name(previous_species_id)
    recipients = list(
        User.objects
        .filter(project_memberships__project_id=project_id, is_active=True)
        .distinct()
    )
    created = 0
    for crop in Crop.objects.filter(pk__in=list(changes_by_crop)):
        crop_label = format_crop_display_name(crop.name, crop.variety)
        for recipient in recipients:
            notification = create_notification(
                recipient=recipient,
                notification_type=Notification.TYPE_CROP_SPECIES_REASSIGNED,
                message=(
                    f'The crop species of "{crop_label}" changed from '
                    f'"{previous_species_name}" to "{crop_species.name}", '
                    f'which changed values it inherits.'
                ),
                context={
                    'crop_name': crop_label,
                    'old_name': previous_species_name,
                    'new_name': crop_species.name,
                    'changed_fields': changes_by_crop[crop.pk],
                },
                target_type=Notification.TARGET_CROP,
                target_id=crop.pk,
            )
            created += notification is not None
    return created


def _crop_species_name(crop_species_id: int | None) -> str:
    if crop_species_id is None:
        return ''
    species = CropSpecies.objects.filter(pk=crop_species_id).first()
    return species.name if species is not None else ''



def relink_public_crop_species(
    *,
    public_crop: PublicCrop,
    user: User | None,
    crop_species: CropSpecies,
    note: str = '',
    variety: str | None = None,
) -> PublicCropSpeciesRelinkResult:
    """Correct a published entry's crop species mapping ("Kulturart korrigieren").

    A species that is still ``proposed`` is not applied right away — see
    :class:`~farm.models.PublicCropSpeciesRelinkRequest` for why the entry has
    to stay on its current species until the proposal is decided; ``variety``
    is parked on the same request and applied together with it.

    ``variety`` is ``None`` when the caller is not touching it (only the
    species is being corrected).
    """
    normalized_variety = variety.strip() if variety is not None else None
    _validate_public_crop_species_relink(
        public_crop=public_crop,
        user=user,
        crop_species=crop_species,
        variety=normalized_variety,
    )
    with transaction.atomic():
        relink_request = _record_species_relink_request(
            public_crop=public_crop,
            user=user,
            crop_species=crop_species,
            note=note,
            variety=normalized_variety,
        )
        if crop_species.is_pending:
            return PublicCropSpeciesRelinkResult(
                public_crop=public_crop,
                status=PublicCropSpeciesRelinkResult.STATUS_PENDING_SPECIES_PROPOSAL,
                relink_request=relink_request,
            )
        updated = _apply_public_crop_species_relink(
            public_crop=public_crop,
            user=user,
            crop_species=crop_species,
            variety=normalized_variety,
        )
        _resolve_relink_request(
            relink_request,
            status=PublicCropSpeciesRelinkRequest.STATUS_COMPLETED,
        )
        return PublicCropSpeciesRelinkResult(
            public_crop=updated,
            status=PublicCropSpeciesRelinkResult.STATUS_RELINKED,
            relink_request=relink_request,
        )


def _record_species_relink_request(
    *,
    public_crop: PublicCrop,
    user: User | None,
    crop_species: CropSpecies,
    note: str,
    variety: str | None = None,
) -> PublicCropSpeciesRelinkRequest:
    """Record the correction itself, before it is applied or parked.

    Every relink gets a row, not just the ones waiting on a species proposal:
    it is where the moderator's ``note`` (the *why* of the correction) lives —
    :class:`PublicCropRevision` has no free-text field — and it keeps "which
    entries were remapped, by whom, from what, and why" answerable with one
    query instead of a scan through revision diffs.

    An entry has at most one *pending* correction: a moderator who changes
    their mind about the target replaces the earlier request rather than
    queueing a second one that would fight it on approval.
    """
    with transaction.atomic():
        PublicCropSpeciesRelinkRequest.objects.filter(
            public_crop=public_crop,
            status=PublicCropSpeciesRelinkRequest.STATUS_PENDING,
        ).update(
            status=PublicCropSpeciesRelinkRequest.STATUS_CANCELLED,
            resolution_note='Superseded by a newer crop species correction.',
            resolved_at=timezone.now(),
        )
        return PublicCropSpeciesRelinkRequest.objects.create(
            public_crop=public_crop,
            from_crop_species_id=public_crop.crop_species_id,
            to_crop_species=crop_species,
            to_variety=variety,
            requested_by=user,
            note=note,
        )


def _resolve_relink_request(
    request: PublicCropSpeciesRelinkRequest,
    *,
    status: str,
    resolution_note: str = '',
) -> None:
    request.status = status
    request.resolution_note = resolution_note
    request.resolved_at = timezone.now()
    request.save(update_fields=['status', 'resolution_note', 'resolved_at'])


def _notify_relink_request_cancelled(
    request: PublicCropSpeciesRelinkRequest,
    *,
    reason_context: str,
) -> None:
    """Tell the moderator their parked correction will not happen after all.

    The dialog promises the entry is relinked automatically once the species is
    approved. When that promise cannot be kept — the proposal was rejected, the
    entry is gone, or somebody else claimed the identity meanwhile — the
    moderator has to hear it, or they are left believing a correction was made
    that silently was not. Nothing else surfaces a resolved request.

    Imported locally for the same reason the rest of this module's cross-app
    calls are: `notifications` is a separate app and this keeps the public crop
    library's import surface unchanged.
    """
    from notifications.models import Notification
    from notifications.services import create_notification

    public_crop = request.public_crop
    species_name = request.to_crop_species.name
    create_notification(
        recipient=request.requested_by,
        notification_type=Notification.TYPE_PUBLIC_CROP_SPECIES_RELINK_CANCELLED,
        message=(
            f'The crop species correction of "{public_crop.name}" to '
            f'"{species_name}" was not applied: {reason_context}'
        ),
        context={'name': public_crop.name, 'species_name': species_name},
        target_type=Notification.TARGET_PUBLIC_CROP,
        target_id=public_crop.id,
    )


def _cancel_relink_request(
    request: PublicCropSpeciesRelinkRequest,
    *,
    resolution_note: str,
) -> None:
    _resolve_relink_request(
        request,
        status=PublicCropSpeciesRelinkRequest.STATUS_CANCELLED,
        resolution_note=resolution_note,
    )
    _notify_relink_request_cancelled(request, reason_context=resolution_note)


def complete_public_crop_species_relinks(
    *,
    crop_species: CropSpecies,
    user: User | None,
) -> list[PublicCrop]:
    """Apply every correction that was waiting for this species to be approved.

    Called from the species approval so the moderator who filed the correction
    never has to repeat it. Each request is re-validated: the entry may have
    been removed, or another entry may have claimed the same species+variety
    identity in the meantime, and neither may be forced through just because
    the request is older — nor may either fail the approval itself.
    """
    pending = (
        PublicCropSpeciesRelinkRequest.objects
        .filter(
            to_crop_species=crop_species,
            status=PublicCropSpeciesRelinkRequest.STATUS_PENDING,
        )
        .select_related('public_crop', 'to_crop_species', 'requested_by')
    )
    relinked: list[PublicCrop] = []
    for request in pending:
        public_crop = request.public_crop
        if public_crop.status != PublicCrop.STATUS_PUBLISHED:
            _cancel_relink_request(request, resolution_note='The entry is no longer published.')
            continue
        target_variety = request.to_variety if request.to_variety is not None else public_crop.variety
        if public_crop.crop_species_id == crop_species.pk and target_variety == public_crop.variety:
            _resolve_relink_request(request, status=PublicCropSpeciesRelinkRequest.STATUS_COMPLETED)
            continue
        try:
            relinked.append(_apply_public_crop_species_relink(
                public_crop=public_crop,
                user=request.requested_by or user,
                crop_species=crop_species,
                variety=request.to_variety,
            ))
        except PublicCropIdentityConflictError:
            # Someone published that identity while the proposal was in review.
            # The approval itself is sound, so drop the correction rather than
            # failing the moderator's decision.
            _cancel_relink_request(
                request,
                resolution_note=(
                    'Another published entry already uses this crop species and variety.'
                ),
            )
            continue
        _resolve_relink_request(request, status=PublicCropSpeciesRelinkRequest.STATUS_COMPLETED)
    return relinked


def cancel_public_crop_species_relinks(*, crop_species: CropSpecies) -> int:
    """Drop the corrections waiting on a species proposal a moderator rejected.

    Resolved one by one rather than with a bulk ``update()``: each requesting
    moderator is owed the news that their correction will not happen.
    """
    pending = list(
        PublicCropSpeciesRelinkRequest.objects
        .filter(
            to_crop_species=crop_species,
            status=PublicCropSpeciesRelinkRequest.STATUS_PENDING,
        )
        .select_related('public_crop', 'to_crop_species', 'requested_by')
    )
    for request in pending:
        _cancel_relink_request(request, resolution_note='The proposed crop species was rejected.')
    return len(pending)


def publish_crop_to_public_library(
    *,
    crop: Crop,
    user: User | None,
    crop_species_id: int | None = None,
    original_language_code: str | None = None,
    publish_as_general: bool = False,
    require_moderation: bool = False,
) -> tuple[PublicCrop, list[DuplicateCandidate], str]:
    # Checked before the quality gate: a copy that has not taken over the current
    # public version must not overwrite it, however complete its own fields are.
    update_target_for_guard = find_owned_public_crop_for_update(crop=crop, user=user)
    unpublished_reason = unpublished_link_reason(crop)
    if unpublished_reason is not None and not (
        can_republish_withdrawn_entry(crop, user)
        and update_target_for_guard is not None
        and update_target_for_guard.id == crop.source_public_crop_id
    ):
        raise PublicCropLinkUnavailableError(reason=unpublished_reason)
    if update_target_for_guard and has_pending_public_crop_update(crop):
        rejected = is_public_crop_update_rejected(crop)
        raise PublicCropUpdateBlockedError(
            reason='update_rejected' if rejected else 'update_pending',
        )

    check_result = build_publishing_check_result(
        crop=crop,
        crop_species_id=crop_species_id,
        original_language_code=original_language_code,
        user=user,
        publish_as_general=publish_as_general,
    )
    if not check_result.crop_species or not check_result.original_language_code or check_result.missing_required_fields:
        raise PublicCropPublishingValidationError(check_result=check_result)

    public_variety = _resolve_public_variety(publish_as_general)
    update_target = find_owned_public_crop_for_update(crop=crop, user=user)
    duplicates = check_result.duplicates
    if update_target and require_moderation:
        # Must come before any mutation below: an untrusted contributor who
        # already owns a published entry would otherwise overwrite the live
        # library row, which is exactly what the moderation queue exists to
        # prevent (and what CropViewSet.api_token_actions assumes cannot
        # happen). The caller queues this as a KIND_EDIT proposal instead.
        return (
            update_target,
            [item for item in duplicates if item.id != update_target.id],
            'pending_moderation_edit',
        )
    if update_target:
        previous_status = update_target.status
        _link_crop_to_crop_species(crop=crop, crop_species=check_result.crop_species)
        updated_public_crop = _update_public_crop_from_project_crop(
            public_crop=update_target,
            crop=crop,
            public_variety=public_variety,
        )
        updated_public_crop.crop_species = check_result.crop_species
        updated_public_crop.original_language_code = check_result.original_language_code
        updated_public_crop.status_changed_by = user if previous_status != PublicCrop.STATUS_PUBLISHED else updated_public_crop.status_changed_by
        updated_public_crop.save(update_fields=['crop_species', 'original_language_code', 'status_changed_by', 'updated_at'])
        if previous_status != PublicCrop.STATUS_PUBLISHED and updated_public_crop.status == PublicCrop.STATUS_PUBLISHED:
            _record_public_crop_status_event(
                public_crop=updated_public_crop,
                from_status=previous_status,
                to_status=PublicCrop.STATUS_PUBLISHED,
                user=user,
            )
        sync_original_language_translation(updated_public_crop)
        _link_owned_entry_to_project_rows(
            crop=crop,
            entry=updated_public_crop,
            crop_species=check_result.crop_species,
            publish_as_general=publish_as_general,
        )
        non_target_duplicates = [item for item in duplicates if item.id != update_target.id]
        return updated_public_crop, non_target_duplicates, 'updated'

    if duplicates:
        raise DuplicatePublicCropError(
            duplicates=duplicates,
            normalized_identity={
                'name': crop.name_normalized,
                'variety': '' if publish_as_general else crop.variety_normalized,
                'crop_species': str(check_result.crop_species.id),
            },
        )
    _link_crop_to_crop_species(crop=crop, crop_species=check_result.crop_species)
    if not publish_as_general and not require_moderation:
        # Publishing a variety always needs a species-level entry for the crop
        # to hang off; create it from this crop's own values if the
        # species doesn't have one yet. An existing general entry is never
        # touched here (see ensure_general_public_crop's docstring).
        #
        # Skipped while the contribution is only queued: this entry is created
        # *published*, so running it here would put an untrusted contributor's
        # values live under the species name while the variety they came with
        # is still waiting for review. `approve_new_publish_proposal` creates
        # it on approval instead.
        ensure_general_public_crop(
            crop_species=check_result.crop_species,
            crop=crop,
            original_language_code=check_result.original_language_code,
            user=user,
        )
    if require_moderation:
        # A new-account/API-token/declared-agent contributor: create the entry
        # as an invisible draft (PublicCropViewSet.queryset already filters to
        # status=STATUS_PUBLISHED) and let the caller wrap it in a
        # PublicCropChangeProposal instead of publishing it live. No status
        # event, revision, or project-crop link yet — those happen on
        # approval, via approve_new_publish_proposal, mirroring what this
        # function does for a normal publish.
        draft_public_crop = PublicCrop.objects.create(
            created_by=user,
            status=PublicCrop.STATUS_DRAFT,
            version=1,
            crop_species=check_result.crop_species,
            original_language_code=check_result.original_language_code,
            **build_public_crop_payload(crop, public_variety=public_variety),
        )
        return draft_public_crop, duplicates, 'pending_moderation'

    public_crop = PublicCrop.objects.create(
        created_by=user,
        status=PublicCrop.STATUS_PUBLISHED,
        version=1,
        crop_species=check_result.crop_species,
        original_language_code=check_result.original_language_code,
        **build_public_crop_payload(crop, public_variety=public_variety),
    )
    sync_original_language_translation(public_crop)
    _record_public_crop_status_event(
        public_crop=public_crop,
        from_status='',
        to_status=PublicCrop.STATUS_PUBLISHED,
        user=user,
    )
    create_public_crop_revision(
        public_crop=public_crop,
        user=user,
        action=PublicCropRevision.ACTION_CREATED,
    )
    _link_owned_entry_to_project_rows(
        crop=crop,
        entry=public_crop,
        crop_species=check_result.crop_species,
        publish_as_general=publish_as_general,
    )
    return public_crop, duplicates, 'created'


def approve_new_publish_proposal(
    *,
    public_crop: PublicCrop,
    source_crop: Crop | None,
    publish_as_general: bool,
    user: User | None,
) -> PublicCrop:
    """Publish a draft PublicCrop created for a `KIND_NEW_PUBLISH` proposal.

    Mirrors the tail of `publish_crop_to_public_library`'s create branch
    (status transition, revision, project-crop link) for the
    moderation-approval path, since the draft was created without any of
    that — including the species-level entry a variety hangs off, which the
    publish path deliberately skips while the contribution is only queued.
    """
    if not publish_as_general and source_crop is not None and public_crop.crop_species is not None:
        ensure_general_public_crop(
            crop_species=public_crop.crop_species,
            crop=source_crop,
            original_language_code=public_crop.original_language_code,
            user=user,
        )
    _set_public_crop_status(public_crop=public_crop, status=PublicCrop.STATUS_PUBLISHED, user=user)
    sync_original_language_translation(public_crop)
    create_public_crop_revision(
        public_crop=public_crop,
        user=user,
        action=PublicCropRevision.ACTION_CREATED,
    )
    if source_crop is not None and public_crop.crop_species is not None:
        _link_owned_entry_to_project_rows(
            crop=source_crop,
            entry=public_crop,
            crop_species=public_crop.crop_species,
            publish_as_general=publish_as_general,
        )
    return public_crop


def reject_new_publish_proposal(*, public_crop: PublicCrop, user: User | None) -> PublicCrop:
    """Non-destructively discard a rejected draft `KIND_NEW_PUBLISH` entry.

    The draft was never visible (STATUS_DRAFT is filtered out of every
    listing), so this only needs to leave it in a terminal, non-published
    state — matching the library's existing non-destructive-removal
    convention instead of hard-deleting the row, which would cascade-delete
    the PublicCropChangeProposal audit record pointing at it.
    """
    return _set_public_crop_status(
        public_crop=public_crop,
        status=PublicCrop.STATUS_REMOVED,
        user=user,
        reason=PublicCrop.REMOVAL_REASON_PROPOSAL_REJECTED,
    )


def notify_moderators_of_change_proposal(proposal: PublicCropChangeProposal) -> None:
    """Tell every public library moderator that a change proposal is waiting for review.

    Mirrors crops.services.notify_moderators_of_species_proposal; lives here
    instead, since a PublicCropChangeProposal is a farm-owned model.
    """
    from notifications.models import Notification
    from notifications.services import create_notification

    for recipient in public_library_moderator_users().exclude(pk=proposal.proposed_by_id):
        create_notification(
            recipient=recipient,
            notification_type=Notification.TYPE_PUBLIC_CROP_CHANGE_PROPOSAL_SUBMITTED,
            message=f'A change proposal for "{proposal.public_crop.name}" is waiting for review.',
            context={'name': proposal.public_crop.name, 'kind': proposal.kind},
            target_type=Notification.TARGET_PUBLIC_LIBRARY_MODERATION,
            target_id=proposal.id,
        )


def notify_change_proposal_reviewed(proposal: PublicCropChangeProposal) -> None:
    """Tell the proposer their change proposal was approved or rejected."""
    from notifications.models import Notification
    from notifications.services import create_notification

    if proposal.proposed_by_id is None:
        return
    create_notification(
        recipient=proposal.proposed_by,
        notification_type=Notification.TYPE_PUBLIC_CROP_CHANGE_PROPOSAL_REVIEWED,
        message=f'Your change proposal for "{proposal.public_crop.name}" was {proposal.status}.',
        context={'name': proposal.public_crop.name, 'status': proposal.status, 'kind': proposal.kind},
        target_type=Notification.TARGET_PUBLIC_CROP,
        target_id=proposal.public_crop_id,
    )


def is_public_crop_contributor(*, public_crop: PublicCrop, user: User | None) -> bool:
    """Whether `user` is the contributor who published this public crop."""
    return bool(user and user.is_authenticated and public_crop.created_by_id == user.id)


def remove_public_crop(
    *,
    public_crop: PublicCrop,
    user: User | None,
    reason: str = '',
    force_moderator_reason: bool = False,
) -> PublicCrop:
    """Remove a public crop from the public library.

    This is the single entry point for both removal paths, so the UI only has
    to offer one "remove from library" action:

    - the contributor withdraws their own entry (`withdrawn`), which stays
      reversible: publishing the project crop again republishes it;
    - a moderator removes somebody else's entry (`removed`) and must supply a
      structured moderation reason.

    ``force_moderator_reason`` skips the contributor auto-detection and always
    takes the moderator/``removed`` path. Needed for system-driven cascades
    (e.g. withdrawing every entry under a just-rejected species) that must
    record the real reason even when the acting moderator happens to also be
    the entry's own contributor — otherwise the contributor branch would
    silently downgrade it to a self-reversible `withdrawn` with no reason.
    """
    if not force_moderator_reason and is_public_crop_contributor(public_crop=public_crop, user=user):
        if public_crop.status != PublicCrop.STATUS_PUBLISHED:
            raise PublicCropStatusTransitionError(
                'Only published public crops can be removed from the library.',
            )
        return _set_public_crop_status(
            public_crop=public_crop,
            status=PublicCrop.STATUS_WITHDRAWN,
            user=user,
        )

    if not _is_public_library_moderator(user):
        raise PublicCropPermissionError(
            'Only the contributor or a moderator may remove this public crop.',
        )
    if reason not in {item[0] for item in PublicCrop.REMOVAL_REASON_CHOICES}:
        raise PublicCropStatusTransitionError('A valid removal reason is required.', code='removal_reason_required')
    if public_crop.status == PublicCrop.STATUS_REMOVED:
        return public_crop
    return _set_public_crop_status(
        public_crop=public_crop,
        status=PublicCrop.STATUS_REMOVED,
        user=user,
        reason=reason,
    )


def reinstate_removed_public_crop(*, public_crop: PublicCrop, user: User | None) -> PublicCrop:
    """Moderator-only undo for `remove_public_crop`'s moderator path.

    Unlike a contributor's own withdrawal (self-service, reversible by simply
    publishing again), a moderator-removed entry has no self-service way
    back — `find_owned_public_crop_for_update` deliberately excludes
    `removed` so a moderation decision can't be bypassed by republishing.
    This is the moderator-side counterpart: no time limit, moderator-only.
    """
    if not _is_public_library_moderator(user):
        raise PublicCropPermissionError('Only a moderator may restore a removed public crop.')
    if public_crop.status not in {PublicCrop.STATUS_REMOVED, PublicCrop.STATUS_WITHDRAWN}:
        raise PublicCropStatusTransitionError(
            'Only a removed or withdrawn public crop can be restored.',
        )
    return _set_public_crop_status(
        public_crop=public_crop,
        status=PublicCrop.STATUS_PUBLISHED,
        user=user,
    )


def hard_delete_public_crop(*, public_crop: PublicCrop, user: User | None) -> None:
    if not _is_public_library_moderator(user):
        raise PublicCropPermissionError('Only administrators may permanently delete public crops.')
    if public_crop.imported_crops.exists():
        raise PublicCropStatusTransitionError(
            'This public crop has already been imported into projects and must remain auditable.',
            code='public_crop_has_imports',
        )
    if public_crop.source_project_crop_id or public_crop.source_project_id:
        raise PublicCropStatusTransitionError(
            'This public crop still has project provenance and should be removed instead of deleted.',
            code='public_crop_has_provenance',
        )
    public_crop.delete()


class PublicCropImportConfirmationRequiredError(Exception):
    """Raised when re-importing would silently overwrite local changes.

    The caller already has a crop in this project imported from this same
    public crop, and that crop has been edited since import
    (``is_modified_from_source``) — resolving this automatically either way
    would be a guess, so the API surfaces it as a 409 for the frontend to ask
    the user instead.
    """

    def __init__(self, *, existing_crop: Crop) -> None:
        super().__init__('This public crop was already imported and has local changes.')
        self.existing_crop = existing_crop
        self.code = 'import_requires_confirmation'


def _unique_project_crop_name(*, name: str, variety: str, project: Project) -> str:
    """Append " (2)", " (3)", ... to `name` until name+variety no longer collides
    with an existing crop in this project."""
    from farm.utils import normalize_text

    variety_normalized = normalize_text(variety)
    candidate_name = name
    suffix = 2
    while Crop.objects.filter(
        project=project,
        name_normalized=normalize_text(candidate_name) or '',
        variety_normalized=variety_normalized,
    ).exists():
        candidate_name = f'{name} ({suffix})'
        suffix += 1
    return candidate_name


def _create_crop_from_public(*, public_crop: PublicCrop, project: Project, unique_name: bool = False) -> Crop:
    payload = build_project_crop_payload(public_crop)
    if unique_name:
        payload['name'] = _unique_project_crop_name(
            name=payload['name'],
            variety=payload.get('variety') or '',
            project=project,
        )
    crop = Crop.objects.create(project=project, **payload)
    for package in public_crop.seed_packages or []:
        crop.seed_packages.create(
            project=project,
            size_value=package.get('size_value'),
            size_unit=package.get('size_unit') or 'g',
            evidence_text=package.get('evidence_text') or '',
            last_seen_at=package.get('last_seen_at') or None,
        )
    return crop


def _ensure_local_general_crop(*, public_crop: PublicCrop, project: Project) -> None:
    """Companion to importing a variety: also import the species' general entry if missing.

    Importing a variety-specific public crop directly (rather than via the
    Add Crop dialog's Sorte field, which already does this) used to leave the
    species with no variety-less local Crop at all — clicking the species
    group in the crop tree would then silently fall back to its first
    variety instead of showing real species-level data. Only acts when this
    import is genuinely introducing the species locally for the first time;
    an existing general crop (however it got there) is left untouched.
    """
    if not public_crop.variety_normalized or public_crop.crop_species_id is None:
        return
    # Crop.variety_normalized is left NULL (not '') for an empty variety
    # (see Crop.save()), unlike PublicCrop's - filter on the raw field.
    already_local = Crop.objects.filter(
        project=project,
        crop_species_id=public_crop.crop_species_id,
        variety='',
    ).exists()
    if already_local:
        return
    general_public = find_general_public_crop(public_crop.crop_species)
    if general_public is None:
        return
    _create_crop_from_public(public_crop=general_public, project=project)


def _apply_public_crop_update(*, crop: Crop, public_crop: PublicCrop) -> Crop:
    """Overwrite `crop`'s library-sourced fields with the current public crop."""
    payload = build_project_crop_payload(public_crop)
    # `display_color` is a project-local choice — kept out of the update diff
    # (see `_compared_public_update_fields`), so a pull must not silently
    # overwrite it either.
    payload.pop('display_color', None)
    # A crop the user *published* is linked to its own entry the same way an
    # import is, but pulling a later library change into it must not relabel it
    # as imported — `origin_type` stays whatever it was. Provenance is where the
    # crop came from, not the entry it syncs with, so an update leaves it alone.
    payload.pop('origin_type', None)
    payload.pop('derived_from_public_crop', None)
    for field, value in payload.items():
        setattr(crop, field, value)
    crop.save()
    # Crop._flag_source_divergence() runs inside save() and, seeing the tracked
    # fields differ from the pre-update row, may have just flipped this back to True —
    # wrong here, since syncing to a newer library version isn't a local edit. A
    # queryset .update() (not .save()) bypasses Crop.save() entirely, so this
    # doesn't trigger another divergence pass or a second EntityRevision.
    Crop.objects.filter(pk=crop.pk).update(is_modified_from_source=False)
    crop.is_modified_from_source = False
    return crop


@dataclass(frozen=True)
class PublicCropFieldChange:
    field: str
    local_value: Any
    public_value: Any


@dataclass(frozen=True)
class PublicCropUpdateStatus:
    """A pending library update for one imported project crop.

    ``changes`` comes from :func:`public_crop_update_changes` — the fields an
    apply overwrites, minus the ones an apply deliberately leaves alone
    (``display_color``, and ``crop_family`` / ``nutrient_demand`` on a
    species-linked Sorte). So the preview can never show a field the update
    would not touch, nor hide one it rewrites (which is what let a public
    variety rename reach a project copy unannounced), and it is never empty:
    a bump with no compared-field change is not a pending update at all.
    """

    public_crop: PublicCrop
    public_version: int
    local_version: int | None
    has_local_changes: bool
    is_rejected: bool
    changes: list[PublicCropFieldChange]


def _compared_public_update_fields(crop: Crop) -> list[str]:
    """The fields whose difference counts as a real library update for ``crop``.

    - ``display_color`` is a project-local presentation choice: an imported crop
      always gets an auto colour while a public entry often has none, so a
      colour mismatch is never on its own a "library update".
    - ``crop_family`` / ``nutrient_demand`` on a species-linked Sorte belong to
      the species-level public entry, not the variety one (see
      :func:`build_public_crop_payload`).
    """
    excluded = {'display_color'}
    if (crop.variety or '').strip() and crop.crop_species_id:
        excluded |= set(PUBLIC_SPECIES_INVARIANT_FIELDS)
    return [field for field in CROP_COPY_FIELDS if field not in excluded]


def public_crop_field_changes(
    crop: Crop,
    public_crop: PublicCrop,
    index: GeneralCropIndex | None = None,
) -> list[tuple[str, Any, Any]]:
    """``(field, local_value, public_value)`` for every compared field that differs
    between ``crop`` and ``public_crop``.

    The local side is resolved through inheritance, so a Sorte field that only
    takes its value from the general Kultur is not reported as a local change.
    Takes the public entry explicitly so a caller that already holds it (a
    serializer rendering that entry's rows) compares without dereferencing
    ``crop.source_public_crop`` once per row.
    """
    local = _resolved_copy_fields(crop, index)
    remote = _copy_fields(public_crop)
    return [
        (field, local[field], remote[field])
        for field in _compared_public_update_fields(crop)
        if local[field] != remote[field]
    ]


def public_crop_update_changes(
    crop: Crop,
    index: GeneralCropIndex | None = None,
) -> list[tuple[str, Any, Any]]:
    """:func:`public_crop_field_changes` against ``crop``'s linked public entry.

    Empty when the crop is not linked to one.
    """
    public_crop = crop.source_public_crop
    if public_crop is None:
        return []
    return public_crop_field_changes(crop, public_crop, index)


def is_project_crop_up_to_date(
    crop: Crop,
    public_crop: PublicCrop,
    index: GeneralCropIndex | None = None,
) -> bool:
    """Whether importing ``public_crop`` into ``crop`` again would change nothing.

    Mirrors the ``unchanged`` outcome of
    :func:`import_public_crop_into_project` in ``auto`` mode, so the UI can
    disable the "update in project" action up front instead of letting the user
    discover the no-op by clicking. A locally modified copy is *not* up to date:
    that import path raises the conflict the dialog resolves.
    """
    if crop.is_modified_from_source:
        return False
    if crop.source_public_version == public_crop.version:
        return True
    return not public_crop_field_changes(crop, public_crop, index)


def has_pending_public_crop_update(
    crop: Crop,
    index: GeneralCropIndex | None = None,
) -> bool:
    """Whether the linked library entry carries content this copy has not taken.

    Version-based first — the entry moved past the version this copy imported —
    but a bump that changed none of the compared fields (a translation-only
    edit, or a value the copy already matches) is not a pending update: there is
    nothing to review, to block a push over, or to announce. Both checks run
    in memory over the already-``select_related``-ed ``source_public_crop``.
    """
    public_crop = crop.source_public_crop
    if public_crop is None or public_crop.status != PublicCrop.STATUS_PUBLISHED:
        return False
    if crop.source_public_version == public_crop.version:
        return False
    return bool(public_crop_update_changes(crop, index))


def is_public_crop_update_rejected(
    crop: Crop,
    index: GeneralCropIndex | None = None,
) -> bool:
    """Whether the user explicitly declined exactly the version that is pending.

    The rejection is stored as a version number rather than a flag, so a later
    public edit produces a new version the user never decided on and the notice
    comes back on its own.
    """
    if not has_pending_public_crop_update(crop, index):
        return False
    return crop.rejected_public_version == crop.source_public_crop.version


def has_open_public_crop_update(
    crop: Crop,
    index: GeneralCropIndex | None = None,
) -> bool:
    """A pending library update the user has not decided on yet (drives the notice)."""
    if not has_pending_public_crop_update(crop, index):
        return False
    return not is_public_crop_update_rejected(crop, index)


def resolve_public_publish_block(
    crop: Crop,
    owned_public_crop: PublicCrop | None,
    index: GeneralCropIndex | None = None,
) -> str | None:
    """Why pushing this crop into the public library is currently blocked, if it is.

    ``owned_public_crop`` is the entry an actual publish would target —
    callers resolve it themselves (respecting per-request ownership/moderator
    rules, and any prefetching they already did for it), so this stays a pure
    comparison and never issues its own query when ``index`` is supplied (and a
    single general-Kultur lookup per crop otherwise). The reasons are ordered by how
    the versions relate, so the UI can explain the exact situation instead of a
    generic hint:

    - ``update_pending``: this copy also tracks the entry as its import source
      and the library moved on without a decision yet; pushing now would
      overwrite an unreviewed public change.
    - ``update_rejected``: the user deliberately declined that public version;
      pushing would silently undo the very change they declined.
    - ``no_local_changes``: the copy's published fields already match the
      public entry, so there is nothing to contribute.

    ``entry_withdrawn`` / ``entry_removed`` rank before all of them: the link
    is kept but the entry is not published, so neither pushing nor pulling is
    possible until it is restored (or the link is removed).
    """
    unpublished_reason = unpublished_link_reason(crop)
    if unpublished_reason is not None:
        return unpublished_reason

    if owned_public_crop is None:
        # No entry of the user's own to update. A push would fork a new entry,
        # so it is only worth offering when the copy actually diverges from the
        # public source it was imported from.
        if crop.source_public_crop_id and not public_crop_update_changes(crop, index):
            return 'no_local_changes'
        return None

    if crop.source_public_crop_id == owned_public_crop.id:
        if has_pending_public_crop_update(crop):
            return 'update_rejected' if is_public_crop_update_rejected(crop) else 'update_pending'
        # `is_modified_from_source` is a sticky flag (an edit sets it, only an
        # apply clears it) — a copy edited then edited back, or overtaken by a
        # matching public edit, still carries it. Compare the actual fields so
        # a copy that matches the entry reports nothing to contribute.
        if not crop.is_modified_from_source or not public_crop_update_changes(crop, index):
            return 'no_local_changes'
        return None

    if _resolved_copy_fields(crop, index) == _copy_fields(owned_public_crop):
        return 'no_local_changes'
    return None


def reject_public_crop_update(crop: Crop) -> Crop:
    """Record that the user declined the pending public version for this copy.

    Deliberately does not touch a single library-sourced field: rejecting is a
    decision about the *notice*, not an edit of the local copy. The write uses a
    queryset update so it never runs :meth:`Crop.save`'s divergence pass or
    records a revision for what is not a content change.
    """
    public_crop = crop.source_public_crop
    if public_crop is None:
        return crop
    Crop.objects.filter(pk=crop.pk).update(rejected_public_version=public_crop.version)
    crop.rejected_public_version = public_crop.version
    return crop


def build_public_crop_update_status(crop: Crop) -> PublicCropUpdateStatus | None:
    """The field-level preview of the pending library update, or None if there is none.

    Still built after a rejection so the user can reopen the diff and change
    their mind without waiting for another public edit. Returns None when the
    linked entry only bumped its version without changing a compared field.
    """
    if not has_pending_public_crop_update(crop):
        return None
    public_crop = crop.source_public_crop
    changes = [
        PublicCropFieldChange(
            field=field,
            local_value=_json_safe(local_value),
            public_value=_json_safe(public_value),
        )
        for field, local_value, public_value in public_crop_update_changes(crop)
    ]
    return PublicCropUpdateStatus(
        public_crop=public_crop,
        public_version=public_crop.version,
        local_version=crop.source_public_version,
        has_local_changes=bool(crop.is_modified_from_source),
        is_rejected=is_public_crop_update_rejected(crop),
        changes=changes,
    )


def import_public_crop_into_project(
    *,
    public_crop: PublicCrop,
    project: Project,
    mode: str = 'auto',
) -> tuple[Crop, str]:
    """Import a public crop into a project, or resolve a re-import.

    `mode`:
    - 'auto' (default): look for an existing crop in this project imported
      from this same public crop. None found -> create. Found and
      unmodified -> sync if the library version changed, or no-op if already
      identical. Found and locally modified -> raise
      PublicCropImportConfirmationRequiredError instead of guessing.
    - 'update': overwrite the existing linked crop with the current
      library version regardless of local changes (the confirmed "yes,
      overwrite" choice from the conflict dialog).
    - 'new': always create a fresh crop, uniquifying the name if it
      collides with an existing one in the project.

    Returns (crop, operation) where operation is one of
    'created' | 'unchanged' | 'updated'.
    """
    if mode == 'new':
        crop = _create_crop_from_public(public_crop=public_crop, project=project, unique_name=True)
        _ensure_local_general_crop(public_crop=public_crop, project=project)
        return crop, 'created'

    # Duplicates can already exist from before this check existed; picking the
    # most recent is a defensive choice, not a guarantee only one exists.
    existing = Crop.objects.filter(
        project=project,
        source_public_crop=public_crop,
    ).order_by('-id').first()

    if existing is None:
        crop = _create_crop_from_public(public_crop=public_crop, project=project)
        _ensure_local_general_crop(public_crop=public_crop, project=project)
        return crop, 'created'

    if mode == 'update':
        crop = _apply_public_crop_update(crop=existing, public_crop=public_crop)
        return crop, 'updated'

    if existing.is_modified_from_source:
        raise PublicCropImportConfirmationRequiredError(existing_crop=existing)

    # A version bump that changed none of the compared fields (a
    # translation-only edit, or values this copy already matches) is not a real
    # update: applying it would clear species-invariant overrides and record a
    # spurious revision. It would also contradict has_pending_public_crop_update
    # -- which the detail badge reads -- so `is_project_crop_up_to_date` gates
    # the auto-sync on the same comparison, and the serializer's
    # `project_import_status.is_up_to_date` reads it to disable the action.
    if is_project_crop_up_to_date(existing, public_crop):
        return existing, 'unchanged'

    crop = _apply_public_crop_update(crop=existing, public_crop=public_crop)
    return crop, 'updated'
