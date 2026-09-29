from __future__ import annotations

from django.contrib.auth import get_user_model

from .models import DocumentConsent

User = get_user_model()

# Single, central place to bump a document's version. Bumping a version here
# means every user (new or existing) will be asked to re-accept that
# document. Keep in sync with the corresponding "Stand"/version string shown
# on the document's page (e.g. frontend/src/i18n/locales/de/home.json,
# legal.terms.version for DOCUMENT_TERMS).
CURRENT_VERSIONS: dict[str, str] = {
    DocumentConsent.DOCUMENT_TERMS: '2026-07-15',
    DocumentConsent.DOCUMENT_PRIVACY: '2026-09-29',
    DocumentConsent.DOCUMENT_PUBLIC_LIBRARY: '2026-07-15',
}

# Documents a user currently must have accepted the current version of to
# use the application. Add a document here once its consent flow (version
# entry above, UI copy, etc.) is actually implemented.
# Privacy policy consent is intentionally supported but not currently required.
# The July 2026 public-library update changes the contractual publication
# model and is therefore handled through the Terms consent plus the explicit
# public-library contribution consent at publish time. Add
# DocumentConsent.DOCUMENT_PRIVACY here when a future privacy-policy change
# genuinely requires active consent.
REQUIRED_DOCUMENTS: list[str] = [
    DocumentConsent.DOCUMENT_TERMS,
]


def get_current_version(document: str) -> str:
    """Return the current required version string for a document."""
    return CURRENT_VERSIONS[document]


def get_accepted_version(user: User, document: str) -> str | None:
    """Return the version of `document` the user most recently accepted, if any."""
    record = DocumentConsent.objects.filter(user=user, document=document).order_by('-accepted_at').first()
    return record.version if record else None


def has_accepted_current(user: User, document: str) -> bool:
    """Return whether the user has accepted the current version of `document`."""
    return get_accepted_version(user, document) == get_current_version(document)


def get_pending_consent_documents(user: User) -> list[str]:
    """Return the required documents whose current version the user has not yet accepted."""
    if not user.is_authenticated:
        return []
    return [document for document in REQUIRED_DOCUMENTS if not has_accepted_current(user, document)]


def record_acceptance(user: User, document: str) -> DocumentConsent:
    """Record that the user accepted the current version of `document`."""
    return DocumentConsent.objects.create(user=user, document=document, version=get_current_version(document))
