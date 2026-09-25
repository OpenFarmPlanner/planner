from __future__ import annotations

import os
import uuid
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied
from django.db import connection
from django.db.models import Q
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from config.frontend_urls import build_public_frontend_url

from accounts.consent import record_acceptance
from accounts.models import DocumentConsent
from accounts.trust import grant_established_trust
from crops.permissions import grant_public_library_moderator_access
from farm.models import Project, ProjectInvitation, ProjectMembership, PublicCrop
from farm.services.demo_project import get_demo_project_name, populate_demo_project, resolve_demo_language

User = get_user_model()
E2E_PASSWORD = 'Pass12345!'
TEST_EMAIL_DOMAIN = 'e2e.local'
E2E_PUBLIC_CROP_VARIETY_PREFIXES = ('E2E Kollaboration ', 'Visual Empty ')


def _e2e_token() -> str:
    return os.getenv('E2E_TEST_TOKEN', '').strip()


def _ensure_e2e_request(request: Request) -> None:
    configured_token = _e2e_token()
    if not getattr(settings, 'DEBUG', False) or not configured_token:
        raise PermissionDenied('E2E helpers are disabled.')
    if request.headers.get('X-E2E-Token', '') != configured_token:
        raise PermissionDenied('Invalid E2E token.')


def _scenario_slug(raw_value: str) -> str:
    cleaned = ''.join(ch if ch.isalnum() else '-' for ch in (raw_value or '').strip().lower())
    cleaned = '-'.join(part for part in cleaned.split('-') if part)
    return cleaned or uuid.uuid4().hex[:12]


def _user_email(scenario: str, role: str) -> str:
    return f'{scenario}-{role}@{TEST_EMAIL_DOMAIN}'


def _scenario_user_emails(scenario: str) -> list[str]:
    return [
        _user_email(scenario, 'admin'),
        _user_email(scenario, 'invitee'),
        _user_email(scenario, 'outsider'),
        _user_email(scenario, 'starter'),
    ]


def _grant_fixture_user_trust(user: User) -> None:
    """Put a fixture user at the `established` trust level.

    Fixture users are created directly rather than through registration, so
    they are brand new by `accounts.trust`'s age/activity rule and would be
    treated as untrusted signups: writes throttled harder, and every
    crop-library contribution queued as a `PublicCropChangeProposal` instead
    of publishing live (see docs/account-trust-levels.md). The specs that
    publish to the library assert the direct-publish response, so they need
    the established path — the same reason `record_acceptance` is called
    explicitly here.

    E2E coverage of the moderated path would need its own fixture that leaves
    a user at the `new` level deliberately.
    """
    grant_established_trust(user)


def _delete_legacy_public_crop_versions(public_crop_ids: list[int]) -> None:
    # The table and column names stay spelled "culture": this is a dropped
    # legacy table that no model owns any more, so the Culture -> Crop rename
    # never reached it.
    if not public_crop_ids:
        return
    if 'farm_publiccultureversion' not in connection.introspection.table_names():
        return
    with connection.cursor() as cursor:
        placeholders = ', '.join(['%s'] * len(public_crop_ids))
        cursor.execute(
            f'DELETE FROM farm_publiccultureversion WHERE public_culture_id IN ({placeholders})',
            public_crop_ids,
        )


class E2EInvitationFixtureView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request: Request) -> Response:
        _ensure_e2e_request(request)
        action = str(request.data.get('action', '')).strip().lower()
        scenario = _scenario_slug(str(request.data.get('scenario_id', '')))

        if action == 'reset':
            self._reset(scenario)
            return Response({'ok': True})
        if action == 'setup':
            return Response(self._setup(request, scenario))
        if action == 'setup_demo':
            return Response(self._setup(request, scenario, demo_project=True))
        if action == 'setup_empty_user':
            return Response(self._setup_empty_user(scenario))
        if action == 'remove_member':
            return Response(self._remove_member(scenario))
        if action == 'revoke_invitation':
            return Response(self._revoke_invitation(request, scenario))
        raise PermissionDenied('Unsupported E2E action.')

    def _reset(self, scenario: str) -> None:
        scenario_emails = _scenario_user_emails(scenario)
        public_crop_ids = list(PublicCrop.objects.filter(
            Q(source_project__slug=scenario)
            | Q(source_project_crop__project__slug=scenario)
            | (
                Q(created_by__email__in=scenario_emails)
                & (
                    Q(variety__startswith=E2E_PUBLIC_CROP_VARIETY_PREFIXES[0])
                    | Q(variety__startswith=E2E_PUBLIC_CROP_VARIETY_PREFIXES[1])
                )
            )
        ).values_list('id', flat=True))
        _delete_legacy_public_crop_versions(public_crop_ids)
        PublicCrop.objects.filter(id__in=public_crop_ids).delete()
        ProjectMembership.objects.filter(project__slug=scenario).delete()
        ProjectInvitation.objects.filter(project__slug=scenario).delete()
        Project.objects.filter(slug=scenario).delete()
        User.objects.filter(email__in=scenario_emails).delete()

    def _setup_empty_user(self, scenario: str) -> dict[str, object]:
        self._reset(scenario)
        user = User.objects.create_user(
            username=f'{scenario}-starter',
            email=_user_email(scenario, 'starter'),
            password=E2E_PASSWORD,
            is_active=True,
        )
        record_acceptance(user, DocumentConsent.DOCUMENT_TERMS)
        _grant_fixture_user_trust(user)
        return {'user': {'email': user.email, 'password': E2E_PASSWORD}}

    def _setup(self, request: Request, scenario: str, *, demo_project: bool = False) -> dict[str, object]:
        self._reset(scenario)
        invitation_state = str(request.data.get('invitation_state', 'pending')).strip().lower() or 'pending'
        demo_language = resolve_demo_language(str(request.data.get('language_code', 'de'))) if demo_project else 'de'
        project_name = get_demo_project_name(demo_language) if demo_project else f'E2E Project {scenario}'
        project = Project.objects.create(name=project_name, slug=scenario)

        admin = User.objects.create_user(
            username=f'{scenario}-admin',
            email=_user_email(scenario, 'admin'),
            password=E2E_PASSWORD,
            is_active=True,
        )
        invitee = User.objects.create_user(
            username=f'{scenario}-invitee',
            email=_user_email(scenario, 'invitee'),
            password=E2E_PASSWORD,
            is_active=True,
        )
        outsider = User.objects.create_user(
            username=f'{scenario}-outsider',
            email=_user_email(scenario, 'outsider'),
            password=E2E_PASSWORD,
            is_active=True,
        )
        # These fixture users are created directly (bypassing RegisterSerializer,
        # which normally records this), so they need it recorded explicitly or
        # every E2E login would be blocked by the Terms of Service re-consent gate.
        for fixture_user in (admin, invitee, outsider):
            record_acceptance(fixture_user, DocumentConsent.DOCUMENT_TERMS)
            _grant_fixture_user_trust(fixture_user)
        if request.data.get('library_moderator') is True:
            grant_public_library_moderator_access(admin)
        ProjectMembership.objects.create(user=admin, project=project, role=ProjectMembership.ROLE_ADMIN)
        if demo_project:
            populate_demo_project(project, owner=admin, language_code=demo_language)

        invitation = ProjectInvitation.objects.create(
            project=project,
            email=invitee.email,
            role=ProjectMembership.ROLE_MEMBER,
            token=f'{scenario}-{uuid.uuid4().hex}',
            invited_by=admin,
            expires_at=timezone.now() + timedelta(days=14),
        )
        if invitation_state == ProjectInvitation.STATUS_REVOKED:
            invitation.status = ProjectInvitation.STATUS_REVOKED
            invitation.revoked_at = timezone.now()
            invitation.revoked_by = admin
            invitation.save(update_fields=['status', 'revoked_at', 'revoked_by', 'updated_at'])
        elif invitation_state == ProjectInvitation.STATUS_ACCEPTED:
            ProjectMembership.objects.create(user=invitee, project=project, role=ProjectMembership.ROLE_MEMBER)
            invitation.status = ProjectInvitation.STATUS_ACCEPTED
            invitation.accepted_at = timezone.now()
            invitation.accepted_by = invitee
            invitation.save(update_fields=['status', 'accepted_at', 'accepted_by', 'updated_at'])

        return {
            'projectName': project.name,
            'projectSlug': project.slug,
            'inviteToken': invitation.token,
            'inviteUrl': build_public_frontend_url(f'/invite/accept?token={invitation.token}'),
            'invitee': {'email': invitee.email, 'password': E2E_PASSWORD},
            'outsider': {'email': outsider.email, 'password': E2E_PASSWORD},
            'admin': {'email': admin.email, 'password': E2E_PASSWORD},
        }

    def _remove_member(self, scenario: str) -> dict[str, object]:
        project = Project.objects.get(slug=scenario)
        invitee_email = _user_email(scenario, 'invitee')
        membership_deleted, _ = ProjectMembership.objects.filter(
            project=project,
            user__email__iexact=invitee_email,
        ).delete()
        return {'ok': True, 'removedMembershipRows': membership_deleted}

    def _revoke_invitation(self, request: Request, scenario: str) -> dict[str, object]:
        invitation = ProjectInvitation.objects.get(project__slug=scenario, token=request.data['token'])
        invitation.status = ProjectInvitation.STATUS_REVOKED
        invitation.revoked_at = timezone.now()
        invitation.save(update_fields=['status', 'revoked_at', 'updated_at'])
        return {'ok': True}
