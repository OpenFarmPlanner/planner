"""Single source of truth for the languages OpenFarmPlanner supports.

Three separate concerns use these helpers and must not be confused:

1. **UI language** — which language the interface is rendered in. Owned by the
   *user* (``accounts.UserProjectSettings.ui_language``), never by a project,
   so two people can view the same project in different languages.
2. **Public crop-library content** — language-dependent editorial text on
   language-independent records (``crops.CropSpeciesTranslation``,
   ``farm.PublicCropTranslation``).
3. **User project content** — project/location/bed names, private notes,
   supplier names, variety names. Never translated, never duplicated per
   language; stored and shown exactly as typed.

Supported languages are English, German, French and Spanish. Adding a
language means: add the code here, add the frontend locale bundle under
``frontend/src/i18n/locales/<code>/``, add the code to
``frontend/src/i18n/languages.ts``, and add the email templates under
``accounts/templates/accounts/emails/<code>/`` (a parity test fails until
they exist). Content that only exists in some languages (e.g. the demo
project templates) must fall back explicitly; see docs/i18n.md.
"""

from __future__ import annotations

# Ordered by preference for the "any other translation" fallback step.
SUPPORTED_LANGUAGE_CODES: tuple[str, ...] = ('en', 'de', 'fr', 'es')

# Public crop species become shared lookup data once approved. Keep this list
# explicit so adding a UI language does not silently make every old proposal
# unapprovable until its translations are backfilled.
REQUIRED_PUBLIC_CROP_SPECIES_LANGUAGE_CODES: tuple[str, ...] = ('de', 'en')

# Last-resort UI language, and the second step of the content fallback chain.
DEFAULT_LANGUAGE_CODE = 'en'

# Stored UI preference: an explicit code, or 'auto' = follow the browser.
UI_LANGUAGE_AUTO = 'auto'
UI_LANGUAGE_CHOICES = [
    (UI_LANGUAGE_AUTO, 'Automatic (browser language)'),
    ('de', 'Deutsch'),
    ('en', 'English'),
    ('fr', 'Français'),
    ('es', 'Español'),
]
UI_LANGUAGE_VALUES = frozenset({UI_LANGUAGE_AUTO, *SUPPORTED_LANGUAGE_CODES})


def normalize_language_tag(value: str | None) -> str:
    """Reduce a BCP-47 tag to a supported code, or '' when unsupported.

    ``de-AT``/``de_DE``/``DE`` all become ``de``; ``en-GB`` becomes ``en``;
    ``fr-CA`` becomes ``fr``; ``es-419``/``es-MX`` become ``es``. Unsupported
    tags (``it``) and nonsense become ``''`` so callers can decide the
    fallback.
    """
    normalized = (value or '').strip().lower().replace('_', '-')
    if not normalized:
        return ''
    base = normalized.split('-', 1)[0]
    return base if base in SUPPORTED_LANGUAGE_CODES else ''


def resolve_language_tag(value: str | None, *, default: str = DEFAULT_LANGUAGE_CODE) -> str:
    """Like :func:`normalize_language_tag`, but never returns an empty string."""
    return normalize_language_tag(value) or default


def parse_accept_language(header: str | None) -> str:
    """First supported language in an ``Accept-Language`` header, or ''.

    Quality values are honoured, so ``it;q=0.9, de;q=0.8`` resolves to ``de``
    rather than to the header's first (unsupported) entry.
    """
    if not header:
        return ''
    candidates: list[tuple[float, int, str]] = []
    for index, part in enumerate(header.split(',')):
        piece, _, params = part.strip().partition(';')
        code = normalize_language_tag(piece)
        if not code:
            continue
        quality = 1.0
        for param in params.split(';'):
            key, _, raw_value = param.strip().partition('=')
            if key.strip() == 'q':
                try:
                    quality = float(raw_value)
                except ValueError:
                    quality = 0.0
        candidates.append((-quality, index, code))
    if not candidates:
        return ''
    candidates.sort()
    return candidates[0][2]


def normalize_ui_language_preference(value: str | None) -> str:
    """Validate a stored UI preference value ('auto' or a supported code)."""
    normalized = (value or '').strip().lower()
    if normalized in UI_LANGUAGE_VALUES:
        return normalized
    raise ValueError(f'Unsupported UI language preference: {value!r}')


def explicit_ui_language(user) -> str:
    """The user's stored UI language, or '' when it is ``auto`` or missing."""
    settings_row = getattr(user, 'project_settings', None)
    stored = getattr(settings_row, 'ui_language', '') or ''
    if stored == UI_LANGUAGE_AUTO:
        return ''
    return normalize_language_tag(stored)


def resolve_email_language(*, recipient=None, request=None) -> str:
    """The language an email to ``recipient`` must be written in.

    Resolution order (see "E-Mails" in docs/i18n.md):

    1. the recipient account's explicit UI language (never ``auto``),
    2. the language of the triggering request via
       :func:`resolve_request_language`: the frontend's resolved UI language
       sent as ``?language=``, then the signed-in requester's preference
       (the inviter, for project invitations), then ``Accept-Language``,
    3. English.
    """
    if recipient is not None:
        preference = explicit_ui_language(recipient)
        if preference:
            return preference
    if request is not None:
        return resolve_request_language(request)
    return DEFAULT_LANGUAGE_CODE


def resolve_request_language(request, *, default: str = DEFAULT_LANGUAGE_CODE) -> str:
    """The content language an API response should prefer for this request.

    Resolution order, matching the frontend's UI-language order so the two
    cannot disagree:

    1. an explicit ``?language=`` query parameter (unsupported values are
       ignored rather than rejected, so a stale client link never 400s),
    2. the signed-in user's stored preference (unless it is ``auto``),
    3. the ``Accept-Language`` header,
    4. ``default``, English unless a caller has its own last resort (the demo
       project templates default to German).
    """
    query_params = getattr(request, 'query_params', None)
    if query_params is None:
        query_params = getattr(request, 'GET', {})
    explicit = normalize_language_tag(query_params.get('language'))
    if explicit:
        return explicit

    user = getattr(request, 'user', None)
    if user is not None and getattr(user, 'is_authenticated', False):
        preference = explicit_ui_language(user)
        if preference:
            return preference

    header = ''
    headers = getattr(request, 'headers', None)
    if headers is not None:
        header = headers.get('Accept-Language', '')
    return parse_accept_language(header) or default


def build_fallback_chain(language_code: str | None) -> tuple[str, ...]:
    """Content fallback order: requested → English → every other language.

    The literal fallback order from the spec, in one place, so the API,
    serializers and admin views cannot drift apart.
    """
    requested = normalize_language_tag(language_code)
    chain: list[str] = []
    for code in (requested, DEFAULT_LANGUAGE_CODE, *SUPPORTED_LANGUAGE_CODES):
        if code and code not in chain:
            chain.append(code)
    return tuple(chain)


def resolve_translation(
    translations: dict[str, str],
    language_code: str | None,
    *,
    fallback: str = '',
) -> tuple[str, str]:
    """Pick the best available text and report which language it came from.

    :param translations: language code → text (blank values count as missing).
    :param language_code: the requested UI language.
    :param fallback: technical replacement text when nothing is available.
    :return: ``(text, language_code_used)``; the used code is ``''`` when the
        ``fallback`` had to be used, which is how callers know to render the
        "only available in another language" hint.
    """
    for code in build_fallback_chain(language_code):
        text = (translations.get(code) or '').strip()
        if text:
            return text, code
    for code, text in translations.items():
        if (text or '').strip():
            return text.strip(), code
    return fallback, ''
