from __future__ import annotations

from typing import Any

from django.conf import settings
from django.core.checks import CheckMessage, Tags, Warning, register


@register(Tags.security)
def check_turnstile_keys(app_configs: Any = None, **kwargs: Any) -> list[CheckMessage]:
    """Warn when only one half of the Turnstile key pair is configured."""
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
    return []
