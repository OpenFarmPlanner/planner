"""Name of the location every new project gets automatically.

Location names are user content and are stored exactly as created, so the
default is written once in the language of the request that creates it and
never re-translated afterwards.
"""

from rest_framework.request import Request

from config.languages import resolve_language_tag, resolve_request_language

DEFAULT_LOCATION_NAMES: dict[str, str] = {
    'de': 'Hauptstandort',
    'en': 'Main location',
    'fr': 'Site principal',
    'es': 'Ubicación principal',
}


def default_location_name(language_code: str | None) -> str:
    """Return the default location name for a language (English fallback)."""
    return DEFAULT_LOCATION_NAMES[resolve_language_tag(language_code)]


def default_location_name_for_request(request: Request) -> str:
    """Return the default location name in the requesting user's language."""
    return default_location_name(resolve_request_language(request))
