"""Fixture builder for the crop-library state matrix (docs/crop-library-state-matrix.md).

One cell of the matrix exists exactly once, here. The backend matrix tests, the
``seed_library_state_matrix`` dev command and the Playwright exploration all
read this module, so a state is never modelled twice. The builder is idempotent:
running it again resets every cell to its defined state.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from django.contrib.auth import get_user_model

from accounts.consent import record_acceptance
from accounts.models import DocumentConsent
from accounts.trust import grant_established_trust
from crops.models import CropSpecies
from farm.models import (
    Crop,
    Project,
    ProjectApiToken,
    ProjectMembership,
    PublicCrop,
    PublicCropChangeProposal,
)

User = get_user_model()

MATRIX_PASSWORD = 'matrix-pass'
ESTABLISHED_USERNAME = 'matrix_established'
NEW_USERNAME = 'matrix_new'
PUBLISHER_USERNAME = 'matrix_publisher'
PROJECT_SLUGS = {ESTABLISHED_USERNAME: 'matrix-project-a', NEW_USERNAME: 'matrix-project-b'}

BASE_DURATION_DAYS = 100
LIBRARY_DURATION_DAYS = 120
BASE_HARVEST_DAYS = 14
# The pinned cells keep their own harvest duration against the entry's.
PINNED_FIELD = 'harvest_duration_days'
PINNED_HARVEST_DAYS = 21
LIBRARY_HARVEST_DAYS = 28
PINNED_SORTE_VARIETY = 'Fixiert'
# Helper rows of a cell (the general Kultur of the pinned-Sorte cell) are named
# apart from the "Matrix " cells, so counting cells by name stays exact.
HELPER_PREFIX = 'Matrix-helper'


@dataclass(frozen=True)
class MatrixCell:
    """A seeded private crop and what the crop serializer must report for it."""

    key: str
    username: str
    crop_id: int
    public_crop_id: int | None
    expected: dict[str, Any]


@dataclass
class MatrixFixture:
    users: dict[str, User] = field(default_factory=dict)
    projects: dict[str, Project] = field(default_factory=dict)
    cells: dict[str, MatrixCell] = field(default_factory=dict)
    api_token: str = ''


def _expected(
    *,
    status: str | None,
    blocked: str | None,
    can_unlink: bool,
    update_available: bool = False,
    update_rejected: bool = False,
    proposal_pending: bool = False,
    can_republish: bool = False,
    pinned: tuple[str, ...] = (),
) -> dict[str, Any]:
    return {
        'library_pinned_fields': list(pinned),
        'source_public_crop_status': status,
        'public_publish_blocked_reason': blocked,
        'can_unlink_public_crop': can_unlink,
        'public_update_available': update_available,
        'public_update_rejected': update_rejected,
        'public_change_proposal_pending': proposal_pending,
        'can_republish_public_crop': can_republish,
    }


# Cell key -> (owner of the entry, entry status, entry version, crop state, expectation).
# owner: 'self' (the crop's user), 'other' (the publisher account) or None (no link).
# state: 'aligned', 'local_changes', 'baseline_withheld', 'library_ahead',
# 'library_ahead_rejected', 'proposal', and the pinned states 'pinned_aligned',
# 'pinned_library_ahead', 'pinned_library_pinned_only', 'pinned_local_changes',
# 'pinned_sorte'.
CELL_SPECS: dict[str, tuple[str | None, str, str, dict[str, Any]]] = {
    'unlinked': (None, '', '', _expected(status=None, blocked=None, can_unlink=False)),
    'own_published_aligned': (
        'self', 'published', 'aligned',
        _expected(status='published', blocked='no_local_changes', can_unlink=False),
    ),
    'own_published_local_changes': (
        'self', 'published', 'local_changes',
        _expected(status='published', blocked=None, can_unlink=False),
    ),
    # A general Kultur linked to the species-level entry its Sorte's publish
    # created: the values differ and were never in common, so no baseline.
    'own_published_baseline_withheld': (
        'self', 'published', 'baseline_withheld',
        _expected(
            status='published', blocked='update_pending', can_unlink=False, update_available=True,
        ),
    ),
    'own_withdrawn': (
        'self', 'withdrawn', 'aligned',
        _expected(status='withdrawn', blocked='entry_withdrawn', can_unlink=True, can_republish=True),
    ),
    'own_removed': (
        'self', 'removed', 'aligned',
        _expected(status='removed', blocked='entry_removed', can_unlink=True),
    ),
    'foreign_published_aligned': (
        'other', 'published', 'aligned',
        _expected(status='published', blocked='no_local_changes', can_unlink=True),
    ),
    'foreign_published_local_changes': (
        'other', 'published', 'local_changes',
        _expected(status='published', blocked=None, can_unlink=True),
    ),
    'foreign_library_ahead': (
        'other', 'published', 'library_ahead',
        _expected(status='published', blocked=None, can_unlink=True, update_available=True),
    ),
    'foreign_library_ahead_rejected': (
        'other', 'published', 'library_ahead_rejected',
        _expected(status='published', blocked=None, can_unlink=True, update_rejected=True),
    ),
    'foreign_withdrawn': (
        'other', 'withdrawn', 'aligned',
        _expected(status='withdrawn', blocked='entry_withdrawn', can_unlink=True),
    ),
    'foreign_removed': (
        'other', 'removed', 'aligned',
        _expected(status='removed', blocked='entry_removed', can_unlink=True),
    ),
    # A removal that a moderator reverted is the same row in the same state as
    # foreign_published_aligned; the cell keeps the restore path visible.
    'foreign_restored': (
        'other', 'published', 'aligned',
        _expected(status='published', blocked='no_local_changes', can_unlink=True),
    ),
    'new_account_proposal_pending': (
        'other', 'published', 'proposal',
        _expected(
            status='published', blocked=None, can_unlink=True, proposal_pending=True,
        ),
    ),
    # Pinned harvest duration that differs from the entry: still "Aktuell".
    'pinned_aligned': (
        'other', 'published', 'pinned_aligned',
        _expected(
            status='published', blocked='no_local_changes', can_unlink=True,
            pinned=(PINNED_FIELD,),
        ),
    ),
    # The library moved on in an unpinned field: the pull is offered.
    'pinned_library_ahead_other_field': (
        'other', 'published', 'pinned_library_ahead',
        _expected(
            status='published', blocked=None, can_unlink=True, update_available=True,
            pinned=(PINNED_FIELD,),
        ),
    ),
    # The library changed only the pinned field: no pull, no notice.
    'pinned_library_changed_pinned_only': (
        'other', 'published', 'pinned_library_pinned_only',
        _expected(
            status='published', blocked='no_local_changes', can_unlink=True,
            pinned=(PINNED_FIELD,),
        ),
    ),
    # A local edit of an unpinned field next to the pin: the push is offered.
    'pinned_local_changes': (
        'other', 'published', 'pinned_local_changes',
        _expected(status='published', blocked=None, can_unlink=True, pinned=(PINNED_FIELD,)),
    ),
    # A Sorte linked to its own variety entry inherits the pinned value of its
    # general Kultur; its own link compares that value, so it pins it too.
    'pinned_sorte_vs_pinned_kultur': (
        'other', 'published', 'pinned_sorte',
        _expected(
            status='published', blocked='no_local_changes', can_unlink=True,
            pinned=(PINNED_FIELD,),
        ),
    ),
}


def _ensure_user(username: str, *, established: bool) -> User:
    user, created = User.objects.get_or_create(
        username=username, defaults={'email': f'{username}@example.invalid', 'is_active': True},
    )
    if created:
        user.set_password(MATRIX_PASSWORD)
        user.save()
    # Created directly, so the Terms re-consent gate would otherwise block every login.
    record_acceptance(user, DocumentConsent.DOCUMENT_TERMS)
    if established:
        grant_established_trust(user)
    return user


def _ensure_project(user: User, slug: str, name: str) -> Project:
    project, _ = Project.objects.get_or_create(slug=slug, defaults={'name': name})
    ProjectMembership.objects.get_or_create(user=user, project=project, defaults={'role': 'admin'})
    return project


def _entry_for(key: str, species: CropSpecies, owner: User, entry_status: str) -> PublicCrop:
    entry, _ = PublicCrop.objects.get_or_create(
        name=f'Matrix {key}', variety='', crop_species=species, created_by=owner,
        defaults={'status': PublicCrop.STATUS_PUBLISHED},
    )
    PublicCrop.objects.filter(pk=entry.pk).update(
        status=entry_status, version=1, growth_duration_days=BASE_DURATION_DAYS,
        harvest_duration_days=BASE_HARVEST_DAYS,
        # Deliberately not the fixture users' UI language (German is the
        # default), so a republish that read the UI language instead of this
        # stored value would be caught mistagging the entry.
        original_language_code='en',
        removal_reason=(
            PublicCrop.REMOVAL_REASON_TEST_DATA if entry_status == PublicCrop.STATUS_REMOVED else ''
        ),
    )
    entry.refresh_from_db()
    return entry


def _apply_state(crop: Crop, entry: PublicCrop, state: str, owner: User, user: User) -> None:
    updates: dict[str, Any] = {
        'source_public_crop': entry, 'source_public_version': 1, 'rejected_public_version': None,
        'growth_duration_days': BASE_DURATION_DAYS, 'harvest_duration_days': BASE_HARVEST_DAYS,
        'is_modified_from_source': False, 'library_pinned_fields': [],
    }
    if state.startswith('pinned_'):
        updates.update(
            library_pinned_fields=[PINNED_FIELD], harvest_duration_days=PINNED_HARVEST_DAYS,
        )
    if state == 'pinned_library_ahead':
        PublicCrop.objects.filter(pk=entry.pk).update(
            version=2, growth_duration_days=LIBRARY_DURATION_DAYS,
        )
    if state == 'pinned_library_pinned_only':
        PublicCrop.objects.filter(pk=entry.pk).update(
            version=2, harvest_duration_days=LIBRARY_HARVEST_DAYS,
        )
    if state in {'local_changes', 'proposal', 'baseline_withheld', 'pinned_local_changes'}:
        updates.update(growth_duration_days=BASE_DURATION_DAYS + 7, is_modified_from_source=True)
    if state == 'baseline_withheld':
        updates['source_public_version'] = None
    if state in {'library_ahead', 'library_ahead_rejected'}:
        PublicCrop.objects.filter(pk=entry.pk).update(
            version=2, growth_duration_days=LIBRARY_DURATION_DAYS,
        )
    if state == 'library_ahead_rejected':
        updates['rejected_public_version'] = 2
    Crop.objects.filter(pk=crop.pk).update(**updates)
    PublicCropChangeProposal.objects.filter(public_crop=entry, proposed_by=user).delete()
    if state == 'proposal':
        PublicCropChangeProposal.objects.create(
            public_crop=entry, kind=PublicCropChangeProposal.KIND_EDIT, proposed_by=user,
            origin_api=True, summary='Matrix proposal', proposed_data={},
        )


def build_library_state_matrix() -> MatrixFixture:
    """Create (or reset) every matrix cell and return how to find them."""
    fixture = MatrixFixture()
    users = {
        ESTABLISHED_USERNAME: _ensure_user(ESTABLISHED_USERNAME, established=True),
        NEW_USERNAME: _ensure_user(NEW_USERNAME, established=False),
        PUBLISHER_USERNAME: _ensure_user(PUBLISHER_USERNAME, established=True),
    }
    fixture.users = users
    for username, slug in PROJECT_SLUGS.items():
        fixture.projects[username] = _ensure_project(users[username], slug, f'Matrix {slug[-1].upper()}')
    _, fixture.api_token = _ensure_api_token(users[NEW_USERNAME], fixture.projects[NEW_USERNAME])

    for key, (owner_kind, entry_status, state, expected) in CELL_SPECS.items():
        username = NEW_USERNAME if key.startswith('new_account') else ESTABLISHED_USERNAME
        user, project = users[username], fixture.projects[username]
        species, _ = CropSpecies.objects.get_or_create(name=f'Matrix {key}')
        crop, _ = Crop.objects.get_or_create(
            project=project, name=f'Matrix {key}',
            variety=PINNED_SORTE_VARIETY if state == 'pinned_sorte' else '',
            defaults={
                'crop_species': species,
                'growth_duration_days': BASE_DURATION_DAYS,
                'harvest_duration_days': 14,
            },
        )
        entry = None
        if owner_kind is None:
            Crop.objects.filter(pk=crop.pk).update(
                source_public_crop=None, source_public_version=None, rejected_public_version=None,
                library_pinned_fields=[],
            )
        elif state == 'pinned_sorte':
            owner = users[PUBLISHER_USERNAME]
            crop, entry = _pinned_sorte_cell(key, species, project, owner, user, crop)
        else:
            owner = user if owner_kind == 'self' else users[PUBLISHER_USERNAME]
            entry = _entry_for(key, species, owner, entry_status)
            _apply_state(crop, entry, state, owner, user)
        fixture.cells[key] = MatrixCell(
            key=key, username=username, crop_id=crop.id,
            public_crop_id=entry.id if entry else None, expected=expected,
        )
    return fixture


def _pinned_sorte_cell(
    key: str, species: CropSpecies, project: Project, owner: User, user: User, cell_crop: Crop,
) -> tuple[Crop, PublicCrop]:
    """The pinned-Sorte cell: its general Kultur pins a value the Sorte inherits.

    ``cell_crop`` is the Sorte; the general Kultur and its entry are helper rows.
    """
    general_entry, _ = PublicCrop.objects.get_or_create(
        name=f'{HELPER_PREFIX} {key}', variety='', crop_species=species, created_by=owner,
        defaults={'status': PublicCrop.STATUS_PUBLISHED},
    )
    PublicCrop.objects.filter(pk=general_entry.pk).update(
        status=PublicCrop.STATUS_PUBLISHED, version=1, growth_duration_days=BASE_DURATION_DAYS,
        harvest_duration_days=BASE_HARVEST_DAYS,
    )
    kultur, _ = Crop.objects.get_or_create(
        project=project, name=f'{HELPER_PREFIX} {key}', variety='',
        defaults={'crop_species': species},
    )
    _apply_state(kultur, general_entry, 'pinned_aligned', owner, user)

    entry, _ = PublicCrop.objects.get_or_create(
        name=f'Matrix {key}', variety=PINNED_SORTE_VARIETY, crop_species=species, created_by=owner,
        defaults={'status': PublicCrop.STATUS_PUBLISHED},
    )
    PublicCrop.objects.filter(pk=entry.pk).update(
        status=PublicCrop.STATUS_PUBLISHED, version=1, growth_duration_days=BASE_DURATION_DAYS,
        harvest_duration_days=BASE_HARVEST_DAYS,
    )
    Crop.objects.filter(pk=cell_crop.pk).update(
        source_public_crop=entry, source_public_version=1, rejected_public_version=None,
        growth_duration_days=BASE_DURATION_DAYS, harvest_duration_days=None,
        is_modified_from_source=False, library_pinned_fields=[PINNED_FIELD],
    )
    cell_crop.refresh_from_db()
    return cell_crop, entry


def _ensure_api_token(user: User, project: Project) -> tuple[ProjectApiToken, str]:
    ProjectApiToken.objects.filter(user=user, project=project, name='Matrix token').delete()
    return ProjectApiToken.create_token(
        user=user, project=project, name='Matrix token', scope=ProjectApiToken.SCOPE_WRITE,
    )
