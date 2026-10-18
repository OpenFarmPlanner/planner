"""Account lifecycle email delivery (activation, password reset, email change).

Each sender takes the recipient's language explicitly; callers resolve it with
``config.languages.resolve_email_language`` (order in docs/i18n.md, "E-Mails").

Extracted from accounts/views.py so the views only parse requests and map
responses; tests patch ``accounts.emails.send_mail`` to simulate delivery
failures.
"""
from __future__ import annotations

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.utils.http import urlsafe_base64_encode

from config.frontend_urls import build_public_frontend_url

from .email_templates import (
    ACTIVATION_EMAIL,
    EMAIL_CHANGE_CONFIRMATION_EMAIL,
    PASSWORD_RESET_EMAIL,
    public_website_url,
    render_email,
)
from .models import AccountEmailChangeRequest

User = get_user_model()


def _uses_local_non_delivery_email_backend() -> bool:
    return settings.EMAIL_BACKEND in {
        'django.core.mail.backends.console.EmailBackend',
        'django.core.mail.backends.filebased.EmailBackend',
        'django.core.mail.backends.dummy.EmailBackend',
    }


def _build_frontend_link(path_with_query: str) -> str:
    return build_public_frontend_url(path_with_query)


def _build_frontend_token_link(path: str, user: User) -> str:
    uid = urlsafe_base64_encode(str(user.pk).encode('utf-8'))
    token = default_token_generator.make_token(user)
    return _build_frontend_link(f'{path}?uid={uid}&token={token}')


def _send_activation_email(user: User, *, language: str) -> None:
    """
    Send multipart activation email with explicit sender metadata.

    Deliverability note: multipart (text + HTML) improves compatibility across clients
    and avoids HTML-only spam signals. We intentionally avoid no-reply senders so
    recipients can contact support via a monitored sender mailbox and mailbox providers
    see a trustworthy identity.
    """
    email = render_email(ACTIVATION_EMAIL, language, {
        'activation_link': _build_frontend_token_link('/activate', user),
        'contact_email': settings.SUPPORT_CONTACT_EMAIL,
        'project_website': public_website_url(language),
        'project_name': 'OpenFarmPlanner',
        'user': user,
    })
    send_mail(
        subject=email.subject,
        message=email.text,
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        html_message=email.html,
        fail_silently=False,
    )


def _send_password_reset_email(user: User, *, language: str) -> None:
    email = render_email(PASSWORD_RESET_EMAIL, language, {
        'reset_link': _build_frontend_token_link('/reset-password', user),
        'user': user,
    })
    send_mail(email.subject, email.text, settings.DEFAULT_FROM_EMAIL, [user.email])


def _send_email_change_confirmation_email(
    user: User,
    request_obj: AccountEmailChangeRequest,
    *,
    language: str,
) -> None:
    confirmation_link = _build_frontend_link(
        f'/confirm-email-change?uid={urlsafe_base64_encode(str(user.pk).encode("utf-8"))}'
        f'&token={default_token_generator.make_token(user)}'
        f'&request_id={request_obj.id}'
    )
    email = render_email(EMAIL_CHANGE_CONFIRMATION_EMAIL, language, {
        'confirmation_link': confirmation_link,
        'new_email': request_obj.new_email,
        'user': user,
    })
    send_mail(email.subject, email.text, settings.DEFAULT_FROM_EMAIL, [request_obj.new_email])
