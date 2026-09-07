"""Project invitation domain services.

This module centralizes invitation lifecycle operations and validation.
"""

from __future__ import annotations

from dataclasses import dataclass
import logging
from datetime import timedelta
import secrets
from typing import Any

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.utils import timezone

from farm.models import Project, ProjectInvitation, ProjectMembership

User = get_user_model()
PENDING_INVITATION_SESSION_KEY = 'pending_project_invitation_token'

logger = logging.getLogger(__name__)


@dataclass
class InvitationResult:
    """Structured invitation service result.

    :param code: Stable machine-readable result code.
    :param invitation: Invitation instance if available.
    :param message: Human-readable message.
    :return: InvitationResult object.
    """

    code: str
    invitation: ProjectInvitation | None = None
    message: str = ''


class InvitationFlowError(Exception):
    """Domain error for invitation operations."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def clear_pending_invitation_token(*, session: Any) -> None:
    """Remove the stored pending invitation token from a session-like object.

    :param session: Django session or compatible mapping.
    :return: None.
    """
    if PENDING_INVITATION_SESSION_KEY in session:
        session.pop(PENDING_INVITATION_SESSION_KEY, None)
        if hasattr(session, 'modified'):
            session.modified = True


def store_pending_invitation_token(*, session: Any, token: str) -> None:
    """Store a pending invitation token in the current session.

    :param session: Django session or compatible mapping.
    :param token: Invitation token.
    :return: None.
    """
    session[PENDING_INVITATION_SESSION_KEY] = token
    if hasattr(session, 'modified'):
        session.modified = True


def get_pending_invitation_token(*, session: Any) -> str | None:
    """Read the pending invitation token from the current session.

    :param session: Django session or compatible mapping.
    :return: Stored token or None.
    """
    value = session.get(PENDING_INVITATION_SESSION_KEY)
    return value if isinstance(value, str) and value else None


def _expiry_days() -> int:
    """Return invitation expiry duration in days.

    :return: Positive expiry duration.
    """
    value = int(getattr(settings, 'PROJECT_INVITATION_EXPIRY_DAYS', 14))
    return max(1, value)


def _generate_token() -> str:
    """Create a long cryptographically secure invitation token.

    :return: URL-safe token.
    """
    return secrets.token_urlsafe(48)


def normalize_email(email: str) -> str:
    """Normalize email addresses consistently for invitation checks.

    :param email: Raw email input.
    :return: Canonical email.
    """
    return ProjectInvitation.normalize_email(email)


def _mask_token(token: str | None) -> str:
    """Mask an invitation token for logging.

    Invitation tokens are bearer-style credentials; writing them verbatim to
    application logs (CWE-532) would let anyone with log access reuse them.
    Keep only a short, non-reversible prefix for correlation.
    """
    if not token:
        return '***'
    return f'{token[:6]}…' if len(token) > 6 else '***'


def mask_email(email: str) -> str:
    """Mask an email for public display.

    :param email: Email address.
    :return: Masked email.
    """
    normalized = normalize_email(email)
    if '@' not in normalized:
        return '***'
    local, domain = normalized.split('@', 1)
    local_mask = f"{local[:1]}***" if local else '***'
    return f"{local_mask}@{domain}"


def create_or_resend_invitation(*, project: Project, invited_by: User, email: str, role: str) -> InvitationResult:
    """Create a new invitation or reuse an existing open one.

    :param project: Target project.
    :param invited_by: Actor user.
    :param email: Invitee email.
    :param role: Membership role.
    :return: Result with code invitation_sent or invitation_resent.
    """
    email_normalized = normalize_email(email)
    if not email_normalized:
        raise InvitationFlowError('invalid_email', 'Invalid email address.')

    existing_user = User.objects.filter(email__iexact=email_normalized).first()
    if existing_user and ProjectMembership.objects.filter(project=project, user=existing_user).exists():
        raise InvitationFlowError('already_member', 'User is already a project member.')

    with transaction.atomic():
        open_invitation = (
            ProjectInvitation.objects
            .select_for_update()
            .filter(project=project, email_normalized=email_normalized, status=ProjectInvitation.STATUS_PENDING)
            .first()
        )

        if open_invitation:
            open_invitation.role = role
            open_invitation.invited_by = invited_by
            open_invitation.expires_at = timezone.now() + timedelta(days=_expiry_days())
            open_invitation.message = ''
            open_invitation.save(update_fields=['role', 'invited_by', 'expires_at', 'message', 'updated_at'])
            return InvitationResult(code='invitation_resent', invitation=open_invitation, message='Invitation resent.')

        try:
            invitation = ProjectInvitation.objects.create(
                project=project,
                email=email_normalized,
                role=role,
                token=_generate_token(),
                invited_by=invited_by,
                status=ProjectInvitation.STATUS_PENDING,
                expires_at=timezone.now() + timedelta(days=_expiry_days()),
            )
        except IntegrityError:
            invitation = (
                ProjectInvitation.objects
                .filter(project=project, email_normalized=email_normalized, status=ProjectInvitation.STATUS_PENDING)
                .first()
            )
            if invitation is None:
                raise
            return InvitationResult(code='invitation_resent', invitation=invitation, message='Invitation resent.')

    return InvitationResult(code='invitation_sent', invitation=invitation, message='Invitation sent.')


def get_invitation_by_token(token: str) -> ProjectInvitation:
    """Lookup invitation by token.

    :param token: Invitation token.
    :return: Invitation object.
    """
    invitation = (
        ProjectInvitation.objects
        .select_related('project', 'invited_by', 'accepted_by', 'revoked_by')
        .filter(token=token, project__deleted_at__isnull=True)
        .first()
    )
    if not invitation:
        logger.warning('Invitation token lookup failed', extra={'token': _mask_token(token)})
        raise InvitationFlowError('invalid_token', 'Invalid invitation token.')
    return invitation


def build_public_status(invitation: ProjectInvitation, user: User | None) -> dict[str, object]:
    """Build token status payload for frontend.

    :param invitation: Invitation instance.
    :param user: Optional authenticated user.
    :return: Public status payload.
    """
    code = invitation.resolved_status
    if invitation.resolved_status == ProjectInvitation.STATUS_PENDING and user and user.is_authenticated:
        if normalize_email(user.email) != invitation.email_normalized:
            code = 'email_mismatch'
        elif ProjectMembership.objects.filter(project=invitation.project, user=user).exists():
            code = 'already_member'

    return {
        'code': code,
        'token': invitation.token,
        'project_name': invitation.project.name,
        'email_masked': mask_email(invitation.email_normalized),
        'requires_auth': not (user and user.is_authenticated),
        'expires_at': invitation.expires_at,
    }


def accept_invitation(*, invitation: ProjectInvitation, user: User) -> InvitationResult:
    """Accept invitation atomically for a matching authenticated user.

    :param invitation: Invitation instance.
    :param user: Authenticated user.
    :return: Accept result.
    """
    if normalize_email(user.email) != invitation.email_normalized:
        logger.warning(
            'Invitation accept rejected due to email mismatch',
            extra={
                'user_id': user.id,
                'invitation_id': invitation.pk,
                'token': _mask_token(invitation.token),
            },
        )
        raise InvitationFlowError('email_mismatch', 'Invitation belongs to another email address.')

    with transaction.atomic():
        locked = ProjectInvitation.objects.select_for_update().get(pk=invitation.pk)

        if locked.resolved_status == 'expired':
            logger.warning('Invitation accept rejected because invitation expired', extra={'user_id': user.id, 'invitation_id': locked.pk, 'token': _mask_token(locked.token)})
            raise InvitationFlowError('expired', 'Invitation has expired.')
        if locked.status == ProjectInvitation.STATUS_REVOKED:
            logger.warning('Invitation accept rejected because invitation was revoked', extra={'user_id': user.id, 'invitation_id': locked.pk, 'token': _mask_token(locked.token)})
            raise InvitationFlowError('revoked', 'Invitation was revoked.')
        if locked.status == ProjectInvitation.STATUS_ACCEPTED:
            logger.warning('Invitation accept rejected because invitation was already used', extra={'user_id': user.id, 'invitation_id': locked.pk, 'token': _mask_token(locked.token), 'project_id': locked.project_id})
            raise InvitationFlowError('accepted', 'Invitation has already been used.')

        existing_membership = ProjectMembership.objects.filter(
            project=locked.project,
            user=user,
        ).first()
        if existing_membership is not None:
            logger.info('Invitation accept found existing project membership', extra={'user_id': user.id, 'invitation_id': locked.pk, 'token': _mask_token(locked.token), 'project_id': locked.project_id})
            locked.status = ProjectInvitation.STATUS_ACCEPTED
            locked.accepted_by = user
            locked.accepted_at = locked.accepted_at or timezone.now()
            locked.save(update_fields=['status', 'accepted_by', 'accepted_at', 'updated_at'])
            return InvitationResult(code='already_member', invitation=locked, message='User is already a member.')

        membership = ProjectMembership.objects.create(
            project=locked.project,
            user=user,
            role=locked.role,
        )

        logger.info('Invitation accepted and membership created', extra={'user_id': user.id, 'invitation_id': locked.pk, 'token': _mask_token(locked.token), 'project_id': locked.project_id, 'membership_id': membership.id})
        locked.status = ProjectInvitation.STATUS_ACCEPTED
        locked.accepted_by = user
        locked.accepted_at = timezone.now()
        locked.save(update_fields=['status', 'accepted_by', 'accepted_at', 'updated_at'])

        return InvitationResult(code='accepted', invitation=locked, message='Invitation accepted.')


def accept_pending_invitation_from_session(*, session: Any, user: User) -> InvitationResult:
    """Accept a pending invitation token currently stored in the session.

    :param session: Django session or compatible mapping.
    :param user: Authenticated user.
    :return: InvitationResult for the stored invitation.
    """
    token = get_pending_invitation_token(session=session)
    if token is None:
        raise InvitationFlowError('no_pending_invitation', 'No pending invitation token was found.')

    try:
        invitation = get_invitation_by_token(token)
        result = accept_invitation(invitation=invitation, user=user)
    except InvitationFlowError as exc:
        if exc.code in {'invalid_token', 'accepted', 'revoked', 'expired'}:
            clear_pending_invitation_token(session=session)
        raise

    clear_pending_invitation_token(session=session)
    return result


def revoke_invitation(*, invitation: ProjectInvitation, actor: User) -> InvitationResult:
    """Revoke an invitation if still pending.

    :param invitation: Invitation object.
    :param actor: Revoking admin.
    :return: Revoke result.
    """
    with transaction.atomic():
        locked = ProjectInvitation.objects.select_for_update().get(pk=invitation.pk)
        if locked.status == ProjectInvitation.STATUS_REVOKED:
            return InvitationResult(code='revoked', invitation=locked, message='Invitation already revoked.')
        if locked.status == ProjectInvitation.STATUS_ACCEPTED:
            return InvitationResult(code='already_accepted', invitation=locked, message='Invitation already accepted.')
        if locked.resolved_status == 'expired':
            return InvitationResult(code='expired', invitation=locked, message='Invitation has expired.')

        locked.status = ProjectInvitation.STATUS_REVOKED
        locked.revoked_at = timezone.now()
        locked.revoked_by = actor
        locked.save(update_fields=['status', 'revoked_at', 'revoked_by', 'updated_at'])
        return InvitationResult(code='revoked', invitation=locked, message='Invitation revoked.')
