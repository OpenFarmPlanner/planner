"""Outbound email for project invitations."""

import logging

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from rest_framework.request import Request

from accounts.email_templates import (
    PROJECT_INVITATION_EMAIL,
    render_email,
    render_project_role_label,
)
from config.frontend_urls import build_public_frontend_url
from config.languages import resolve_email_language
from farm.models import ProjectInvitation

logger = logging.getLogger(__name__)


def resolve_invitation_email_language(*, invitation: ProjectInvitation, request: Request) -> str:
    """Invitee's explicit account language, otherwise the inviter's UI language."""
    invitee = (
        get_user_model().objects
        .filter(email__iexact=invitation.email)
        .select_related('project_settings')
        .first()
    )
    return resolve_email_language(recipient=invitee, request=request)


def _send_project_invitation_email(
    *,
    invitation: ProjectInvitation,
    project_name: str,
    invited_by: object,
    language: str,
) -> tuple[bool, str]:
    """Send invitation email and return delivery result plus diagnostic message."""
    support_mail = settings.SUPPORT_CONTACT_EMAIL
    email = render_email(PROJECT_INVITATION_EMAIL, language, {
        'project_name': project_name,
        'role_label': render_project_role_label(invitation.role, language),
        'invite_link': build_public_frontend_url(f'/invite/accept?token={invitation.token}'),
        'invited_by': invited_by,
    })

    non_delivery_backends = {
        'django.core.mail.backends.console.EmailBackend',
        'django.core.mail.backends.locmem.EmailBackend',
        'django.core.mail.backends.filebased.EmailBackend',
        'django.core.mail.backends.dummy.EmailBackend',
    }
    backend_is_delivery_capable = settings.EMAIL_BACKEND not in non_delivery_backends

    if not backend_is_delivery_capable:
        logger.info('Project invitation created without outbound email delivery because backend=%s', settings.EMAIL_BACKEND)
        return False, (
            'Die E-Mail konnte nicht gesendet werden. '
            f'Bitte kontaktiere [{support_mail}](mailto:{support_mail}).'
        )

    try:
        sent_count = send_mail(email.subject, email.text, settings.DEFAULT_FROM_EMAIL, [invitation.email], fail_silently=False)
        if sent_count > 0:
            return True, ''
        logger.error(
            'Project invitation email backend accepted request but returned zero deliveries',
            extra={'project_id': invitation.project_id, 'invitation_id': invitation.id},
        )
        return False, (
            'Die E-Mail konnte nicht gesendet werden. '
            f'Bitte kontaktiere [{support_mail}](mailto:{support_mail}).'
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            'Project invitation email could not be sent',
            extra={'project_id': invitation.project_id, 'invitation_id': invitation.id},
        )
        return False, (
            'Die E-Mail konnte nicht gesendet werden. '
            f'Bitte kontaktiere [{support_mail}](mailto:{support_mail}).'
        )
