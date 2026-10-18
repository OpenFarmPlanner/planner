"""Per-language email templates for every email sent to a user.

Each language keeps complete subject and body files under
``accounts/templates/accounts/emails/<language>/`` instead of gettext
fragments, so a whole email can be read, translated and reviewed in one
place. Adding a language only needs that directory; the parity test in
``accounts/tests/test_localized_emails.py`` fails until every template exists.
"""
from __future__ import annotations

from dataclasses import dataclass

from django.template.loader import select_template

from config.languages import DEFAULT_LANGUAGE_CODE, normalize_language_tag

EMAIL_TEMPLATE_ROOT = 'accounts/emails'
PUBLIC_WEBSITE_URL = 'https://openfarmplanner.org'
# The public website serves this language at its root and every other
# language under /<code> (docs/seo-and-indexing.md).
PUBLIC_WEBSITE_ROOT_LANGUAGE = 'de'


@dataclass(frozen=True)
class EmailKind:
    """One email type: its template base name and the context it requires."""

    name: str
    required_context: tuple[str, ...]
    has_html: bool = False


ACTIVATION_EMAIL = EmailKind(
    name='activation',
    required_context=('activation_link', 'project_website', 'contact_email'),
    has_html=True,
)
PASSWORD_RESET_EMAIL = EmailKind(name='password_reset', required_context=('reset_link',))
EMAIL_CHANGE_CONFIRMATION_EMAIL = EmailKind(
    name='email_change_confirmation',
    required_context=('confirmation_link', 'new_email'),
)
PROJECT_INVITATION_EMAIL = EmailKind(
    name='project_invitation',
    required_context=('project_name', 'invited_by', 'role_label', 'invite_link'),
)

EMAIL_KINDS: tuple[EmailKind, ...] = (
    ACTIVATION_EMAIL,
    PASSWORD_RESET_EMAIL,
    EMAIL_CHANGE_CONFIRMATION_EMAIL,
    PROJECT_INVITATION_EMAIL,
)


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    text: str
    html: str | None = None


def email_template_files(kind: EmailKind) -> tuple[str, ...]:
    """File names (relative to a language directory) the email kind needs."""
    files = [f'{kind.name}_subject.txt', f'{kind.name}.txt']
    if kind.has_html:
        files.append(f'{kind.name}.html')
    return tuple(files)


def project_role_label_file(role: str) -> str:
    """File name of the readable label for a project role."""
    return f'project_role_{role}.txt'


def _template_candidates(language: str, file_name: str) -> list[str]:
    codes = [normalize_language_tag(language) or DEFAULT_LANGUAGE_CODE, DEFAULT_LANGUAGE_CODE]
    return [f'{EMAIL_TEMPLATE_ROOT}/{code}/{file_name}' for code in dict.fromkeys(codes)]


def _render(language: str, file_name: str, context: dict[str, object]) -> str:
    template = select_template(_template_candidates(language, file_name))
    return template.render(context)


def _single_line(value: str) -> str:
    return ' '.join(value.split())


def render_email(kind: EmailKind, language: str, context: dict[str, object]) -> RenderedEmail:
    """Render subject, text and (if any) HTML body, falling back to English."""
    subject, text, *html = (
        _render(language, file_name, context) for file_name in email_template_files(kind)
    )
    return RenderedEmail(
        subject=_single_line(subject),
        text=text,
        html=html[0] if html else None,
    )


def render_project_role_label(role: str, language: str) -> str:
    """Readable, localized label for a project role, e.g. ``member`` → "Mitglied"."""
    return _single_line(_render(language, project_role_label_file(role), {}))


def public_website_url(language: str) -> str:
    """Public website home page in ``language`` (e.g. ``/en`` for English)."""
    code = normalize_language_tag(language) or DEFAULT_LANGUAGE_CODE
    if code == PUBLIC_WEBSITE_ROOT_LANGUAGE:
        return PUBLIC_WEBSITE_URL
    return f'{PUBLIC_WEBSITE_URL}/{code}'

