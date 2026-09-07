from __future__ import annotations

# The public crop library (PublicCrop + this module) is a candidate for
# extraction into a separate service consumed by OFP over an API (under
# discussion as of 2026-07). Keep this module's dependency on `farm.models`
# limited to Crop/Project/PublicCrop, and avoid pulling in
# project-history/EntityRevision or other farm-app-internal concerns here.

from dataclasses import dataclass
import json
import re
from typing import Any

from django.contrib.auth import get_user_model
from django.core.serializers.json import DjangoJSONEncoder
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from config.languages import SUPPORTED_LANGUAGE_CODES, normalize_language_tag
from crops.models import CropSpecies
from crops.permissions import is_public_library_admin, is_public_library_moderator
from crops.services import find_species_by_common_name
from farm.models import (
    Crop,
    Project,
    PublicCrop,
    PublicCropRevision,
    PublicCropStatusEvent,
    PublicCropTranslation,
)
# The local Kultur/Sorte grouping is a farm-app concern this module deliberately
# does not re-implement: it only calls the service that owns it whenever
# publishing links a project crop to a crop species.
from farm.services.crop_inheritance import (
    CROP_INHERITABLE_FIELDS,
    CROP_SPECIES_INVARIANT_FIELDS,
    GeneralCropIndex,
    clear_species_invariant_overrides,
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
) -> PublicCrop | None:
    """Another published entry that a variety rename would collide with, if any.

    Mirrors the identity rule in :func:`detect_public_crop_duplicates`
    (species, or legacy name, plus normalized variety) but starts from an
    existing ``PublicCrop`` being renamed rather than a project ``Crop``
    being published, and excludes the entry itself.
    """
    normalized_variety = normalize_identity_value(variety)
    queryset = PublicCrop.objects.filter(
        status=PublicCrop.STATUS_PUBLISHED,
        variety_normalized=normalized_variety,
    ).exclude(pk=public_crop.pk)
    if public_crop.crop_species_id:
        queryset = queryset.filter(
            Q(crop_species_id=public_crop.crop_species_id)
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
) -> PublicCrop:
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
    payload['source_public_version'] = public_crop.version
    payload['origin_type'] = Crop.ORIGIN_IMPORTED
    payload['is_modified_from_source'] = False
    # Taking a version over ends any earlier rejection: the copy is aligned again.
    payload['rejected_public_version'] = None
    return payload


def link_project_crop_to_public_reference(*, crop: Crop, public_crop: PublicCrop) -> Crop:
    """Link a private crop to a published public crop without publishing a duplicate.

    This is a one-time baseline comparison (crop-as-linked vs. public
    source), not the same check as ``Crop._flag_source_divergence``, which
    compares a crop's *own* previous vs. current row on every save to
    detect edits made after an import. There is no "previous row" yet here.
    """
    source_payload = build_project_crop_payload(public_crop)
    tracked_fields = Crop._SOURCE_DIVERGENCE_TRACKED_FIELDS
    if not (public_crop.variety or '').strip():
        # A general (species-level) public entry has no variety of its own, so
        # the private crop naming a specific cultivar is an inherent
        # granularity difference between the two, not a sign the user edited
        # anything relative to the source it's being linked to.
        tracked_fields = tracked_fields - {'variety'}
    is_modified = any(getattr(crop, field) != source_payload.get(field) for field in tracked_fields)

    crop.crop_species = public_crop.crop_species
    crop.source_public_crop = public_crop
    crop.source_public_version = public_crop.version
    crop.origin_type = Crop.ORIGIN_IMPORTED
    crop.is_modified_from_source = is_modified
    crop.save(update_fields=[
        'crop_species',
        'source_public_crop',
        'source_public_version',
        'origin_type',
        'is_modified_from_source',
        'updated_at',
    ])
    sync_crop_species_across_crop_group(crop)
    return crop


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


def _link_crop_to_crop_species(*, crop: Crop, crop_species: CropSpecies) -> None:
    """Record the species the crop was published under, group and all.

    Publishing must leave the project's own Kulturen exactly as they were apart
    from this link, so the rest of the crop's Kultur group adopts the species
    with it — otherwise publishing one Sorte would leave a second Kultur of the
    same name behind for the Sorten that stayed unpublished.
    """
    crop.crop_species = crop_species
    crop.save(update_fields=['crop_species', 'updated_at'])
    sync_crop_species_across_crop_group(crop)


def publish_crop_to_public_library(
    *,
    crop: Crop,
    user: User | None,
    crop_species_id: int | None = None,
    original_language_code: str | None = None,
    publish_as_general: bool = False,
) -> tuple[PublicCrop, list[DuplicateCandidate], str]:
    # Checked before the quality gate: a copy that has not taken over the current
    # public version must not overwrite it, however complete its own fields are.
    update_target_for_guard = find_owned_public_crop_for_update(crop=crop, user=user)
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
    if not publish_as_general:
        # Publishing a variety always needs a species-level entry for the crop
        # to hang off; create it from this crop's own values if the
        # species doesn't have one yet. An existing general entry is never
        # touched here (see ensure_general_public_crop's docstring).
        ensure_general_public_crop(
            crop_species=check_result.crop_species,
            crop=crop,
            original_language_code=check_result.original_language_code,
            user=user,
        )
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
    # as imported — `origin_type` stays whatever it was.
    payload.pop('origin_type', None)
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
    # A linked Sorte owns no species-invariant values; anything the public
    # payload just wrote onto its columns is a dead override.
    clear_species_invariant_overrides(crop)
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


def public_crop_update_changes(
    crop: Crop,
    index: GeneralCropIndex | None = None,
) -> list[tuple[str, Any, Any]]:
    """``(field, local_value, public_value)`` for every compared field that differs
    between ``crop`` and its linked public entry (empty when not linked).

    The local side is resolved through inheritance, so a Sorte field that only
    takes its value from the general Kultur is not reported as a local change.
    """
    public_crop = crop.source_public_crop
    if public_crop is None:
        return []
    local = _resolved_copy_fields(crop, index)
    remote = _copy_fields(public_crop)
    return [
        (field, local[field], remote[field])
        for field in _compared_public_update_fields(crop)
        if local[field] != remote[field]
    ]


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
    """
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

    if existing.source_public_version == public_crop.version:
        return existing, 'unchanged'

    # A version bump that changed none of the compared fields (a
    # translation-only edit, or values this copy already matches) is not a real
    # update: applying it would clear species-invariant overrides and record a
    # spurious revision. It would also contradict has_pending_public_crop_update
    # -- which the detail badge reads -- so gate the auto-sync on the same
    # comparison to keep the badge and the re-import decision in lockstep.
    if not public_crop_update_changes(existing):
        return existing, 'unchanged'

    crop = _apply_public_crop_update(crop=existing, public_crop=public_crop)
    return crop, 'updated'
