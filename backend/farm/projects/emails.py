"""Outbound email for project invitations."""

import logging

from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.utils import translation
from django.utils.translation import gettext as _

from config.frontend_urls import build_public_frontend_url
from farm.models import ProjectInvitation

logger = logging.getLogger(__name__)


def _send_project_invitation_email(*, invitation: ProjectInvitation, project_name: str, invited_by: object) -> tuple[bool, str]:
    """Send invitation email and return delivery result plus diagnostic message."""
    support_mail = settings.SUPPORT_CONTACT_EMAIL
    invite_link = build_public_frontend_url(f'/invite/accept?token={invitation.token}')
    with translation.override('de'):
        subject = _('Einladung zu OpenFarmPlanner: %(project)s') % {'project': project_name}
        body = render_to_string('accounts/emails/project_invitation_email.txt', {
            'project_name': project_name,
            'role': invitation.role,
            'invite_link': invite_link,
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
        sent_count = send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [invitation.email], fail_silently=False)
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
