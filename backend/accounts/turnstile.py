"""Server-side verification of Cloudflare Turnstile tokens for registration.

See docs/account-trust-levels.md ("Registration hardening") for how this layer
fits next to the honeypot, the disposable-domain list, and the throttles.
"""

from __future__ import annotations

import enum
import logging

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
# Cloudflare rejects longer tokens outright; checking locally saves a round trip.
TURNSTILE_MAX_TOKEN_LENGTH = 2048
_SERVER_SIDE_ERROR_CODES = frozenset(
    {'missing-input-secret', 'invalid-input-secret', 'internal-error'}
)


class TurnstileOutcome(enum.Enum):
    PASSED = 'passed'
    REJECTED = 'rejected'
    UNAVAILABLE = 'unavailable'


def turnstile_enabled() -> bool:
    """Turnstile is enforced only on deployments that configure a secret key."""
    return bool(settings.TURNSTILE_SECRET_KEY)


def _log_rejection(reason: str, error_codes: list[str] | None = None) -> None:
    # Deliberately no token, IP, or email: only enough to count rejections.
    logger.warning(
        'Rejected registration: Turnstile verification failed (reason=%s, error_codes=%s)',
        reason,
        ','.join(error_codes or []) or '-',
        extra={'turnstile_reason': reason, 'turnstile_error_codes': error_codes or []},
    )


def verify_turnstile_token(token: str, remote_ip: str | None = None) -> TurnstileOutcome:
    """Check a Turnstile token against Cloudflare's siteverify API.

    Returns UNAVAILABLE instead of raising when Cloudflare cannot be reached,
    so the caller can answer with a clean error instead of a 500.
    """
    token = token.strip()
    if not token:
        _log_rejection('missing_token')
        return TurnstileOutcome.REJECTED
    if len(token) > TURNSTILE_MAX_TOKEN_LENGTH:
        _log_rejection('token_too_long')
        return TurnstileOutcome.REJECTED

    payload = {'secret': settings.TURNSTILE_SECRET_KEY, 'response': token}
    if remote_ip:
        payload['remoteip'] = remote_ip

    try:
        response = requests.post(
            TURNSTILE_VERIFY_URL,
            data=payload,
            timeout=settings.TURNSTILE_VERIFY_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        result = response.json()
    except (requests.RequestException, ValueError):
        logger.exception('Turnstile verification API unavailable; registration not processed')
        return TurnstileOutcome.UNAVAILABLE

    if not isinstance(result, dict):
        logger.error(
            'Turnstile verification API returned an unexpected payload; registration not processed'
        )
        return TurnstileOutcome.UNAVAILABLE

    if result.get('success') is True:
        return TurnstileOutcome.PASSED

    error_codes = result.get('error-codes')
    codes = [str(code) for code in error_codes] if isinstance(error_codes, list) else []
    if _SERVER_SIDE_ERROR_CODES.intersection(codes):
        # Our secret is missing/wrong or Cloudflare failed internally: not the
        # visitor's fault, so don't tell them their check failed.
        logger.error(
            'Turnstile verification failed on the server side (error_codes=%s); '
            'registration not processed',
            ','.join(codes),
        )
        return TurnstileOutcome.UNAVAILABLE
    _log_rejection('siteverify_failed', codes)
    return TurnstileOutcome.REJECTED
