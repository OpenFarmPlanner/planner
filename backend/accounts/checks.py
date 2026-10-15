from __future__ import annotations

from typing import Any

from django.conf import settings
from django.core.checks import CheckMessage, Info, Tags, Warning, register

# Cloudflare's documented dummy keys ("Testing" docs): they pass or fail every
# check unconditionally, so they must never protect a deployed registration.
TURNSTILE_TEST_SITE_KEYS = frozenset({
    '1x00000000000000000000AA',
    '2x00000000000000000000AB',
    '1x00000000000000000000BB',
    '2x00000000000000000000BB',
    '3x00000000000000000000FF',
})
TURNSTILE_TEST_SECRET_KEYS = frozenset({
    '1x0000000000000000000000000000000AA',
    '2x0000000000000000000000000000000AA',
    '3x0000000000000000000000000000000AA',
})
_LOCAL_ENVIRONMENTS = frozenset({'development', 'test'})


@register(Tags.security)
def check_turnstile_keys(app_configs: Any = None, **kwargs: Any) -> list[CheckMessage]:
    """Warn about a missing, half-configured, or test-only Turnstile key pair."""
    has_site_key = bool(settings.TURNSTILE_SITE_KEY)
    has_secret_key = bool(settings.TURNSTILE_SECRET_KEY)
    if has_secret_key and not has_site_key:
        return [
            Warning(
                'TURNSTILE_SECRET_KEY is set but TURNSTILE_SITE_KEY is not.',
                hint=(
                    'Registration now requires a Turnstile token. Set TURNSTILE_SITE_KEY to the '
                    "widget key this deployment's frontend is built with (VITE_TURNSTILE_SITE_KEY)."
                ),
                id='accounts.W001',
            )
        ]
    if has_site_key and not has_secret_key:
        return [
            Warning(
                'TURNSTILE_SITE_KEY is set but TURNSTILE_SECRET_KEY is not.',
                hint=(
                    'Turnstile tokens are not verified on registration until '
                    'TURNSTILE_SECRET_KEY is set.'
                ),
                id='accounts.W002',
            )
        ]
    if settings.DJANGO_ENV in _LOCAL_ENVIRONMENTS:
        return []
    if not has_site_key and not has_secret_key:
        # Info, not Warning: deploy checks run with --fail-level WARNING, and a
        # deployment may deliberately run without Turnstile.
        return [
            Info(
                'Neither TURNSTILE_SITE_KEY nor TURNSTILE_SECRET_KEY is set.',
                hint='Registration runs without the Cloudflare Turnstile bot check here.',
                id='accounts.I001',
            )
        ]
    if (
        settings.TURNSTILE_SITE_KEY in TURNSTILE_TEST_SITE_KEYS
        or settings.TURNSTILE_SECRET_KEY in TURNSTILE_TEST_SECRET_KEYS
    ):
        return [
            Warning(
                'A Cloudflare Turnstile test key is configured outside local development.',
                hint=(
                    "Test keys pass or fail every check regardless of the visitor. Use this "
                    "deployment's own widget keys from the Cloudflare dashboard."
                ),
                id='accounts.W004',
            )
        ]
    return []


@register()
def check_registration_alert_recipients(
    app_configs: Any = None, **kwargs: Any
) -> list[CheckMessage]:
    """Point out that a deployed instance would only log registration failures."""
    if settings.DJANGO_ENV in _LOCAL_ENVIRONMENTS or settings.REGISTRATION_ALERT_EMAILS:
        return []
    # Info, so a deploy check with --fail-level WARNING still passes before the
    # variable is set.
    return [
        Info(
            'REGISTRATION_ALERT_EMAILS is empty.',
            hint='Registration failures are only logged; set it to receive alert emails.',
            id='accounts.I002',
        )
    ]
