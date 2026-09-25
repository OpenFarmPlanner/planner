"""Fixture builder for the crop-library state matrix (docs/crop-library-state-matrix.md).

One cell of the matrix exists exactly once, here. The backend matrix tests, the
``seed_library_state_matrix`` dev command and the Playwright exploration all
read this module, so a state is never modelled twice. The builder is idempotent:
running it again resets every cell to its defined state.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

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
from django.contrib.auth import get_user_model

User = get_user_model()

MATRIX_PASSWORD = 'matrix-pass'
ESTABLISHED_USERNAME = 'matrix_established'
NEW_USERNAME = 'matrix_new'
PUBLISHER_USERNAME = 'matrix_publisher'
PROJECT_SLUGS = {ESTABLISHED_USERNAME: 'matrix-project-a', NEW_USERNAME: 'matrix-project-b'}

BASE_DURATION_DAYS = 100
LIBRARY_DURATION_DAYS = 120


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
    users: dict[str, Any] = field(default_factory=dict)
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
) -> dict[str, Any]:
    return {
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
# state: 'aligned', 'local_changes', 'library_ahead', 'library_ahead_rejected', 'proposal'.
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
}


def _ensure_user(username: str, *, established: bool) -> Any:
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


def _ensure_project(user: Any, slug: str, name: str) -> Project:
    project, _ = Project.objects.get_or_create(slug=slug, defaults={'name': name})
    ProjectMembership.objects.get_or_create(user=user, project=project, defaults={'role': 'admin'})
    return project


def _entry_for(key: str, species: CropSpecies, owner: Any, entry_status: str) -> PublicCrop:
    entry, _ = PublicCrop.objects.get_or_create(
        name=f'Matrix {key}', variety='', crop_species=species, created_by=owner,
        defaults={'status': PublicCrop.STATUS_PUBLISHED},
    )
    PublicCrop.objects.filter(pk=entry.pk).update(
        status=entry_status, version=1, growth_duration_days=BASE_DURATION_DAYS,
        harvest_duration_days=14,
        removal_reason=(
            PublicCrop.REMOVAL_REASON_TEST_DATA if entry_status == PublicCrop.STATUS_REMOVED else ''
        ),
    )
    entry.refresh_from_db()
    return entry


def _apply_state(crop: Crop, entry: PublicCrop, state: str, owner: Any, user: Any) -> None:
    updates: dict[str, Any] = {
        'source_public_crop': entry, 'source_public_version': 1, 'rejected_public_version': None,
        'growth_duration_days': BASE_DURATION_DAYS, 'harvest_duration_days': 14,
        'is_modified_from_source': False,
    }
    if state in {'local_changes', 'proposal'}:
        updates.update(growth_duration_days=BASE_DURATION_DAYS + 7, is_modified_from_source=True)
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
            project=project, name=f'Matrix {key}', variety='',
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
            )
        else:
            owner = user if owner_kind == 'self' else users[PUBLISHER_USERNAME]
            entry = _entry_for(key, species, owner, entry_status)
            _apply_state(crop, entry, state, owner, user)
        fixture.cells[key] = MatrixCell(
            key=key, username=username, crop_id=crop.id,
            public_crop_id=entry.id if entry else None, expected=expected,
        )
    return fixture


def _ensure_api_token(user: Any, project: Project) -> tuple[ProjectApiToken, str]:
    ProjectApiToken.objects.filter(user=user, project=project, name='Matrix token').delete()
    return ProjectApiToken.create_token(
        user=user, project=project, name='Matrix token', scope=ProjectApiToken.SCOPE_WRITE,
    )
