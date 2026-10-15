"""Server-side verification of Cloudflare Turnstile tokens for registration.

See docs/account-trust-levels.md ("Registration hardening") for how this layer
fits next to the honeypot, the disposable-domain list, and the throttles.
"""

from __future__ import annotations

import enum
import logging

import requests
from django.conf import settings
from django.http import HttpRequest
from rest_framework.request import Request

from .registration_alerts import (
    RegistrationFailure,
    record_missing_turnstile_token,
    report_registration_failure,
)

logger = logging.getLogger(__name__)

TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
# Cloudflare rejects longer tokens outright; checking locally saves a round trip.
TURNSTILE_MAX_TOKEN_LENGTH = 2048
# siteverify error codes per Cloudflare's "Server-side validation" docs. The
# configuration codes mean our own secret or request is wrong; `internal-error`
# is a failure on Cloudflare's side. Neither is the visitor's fault, so both
# are reported to the operators. The remaining documented codes
# (`missing-input-response`, `invalid-input-response`, `timeout-or-duplicate`)
# are about the visitor's token and stay a plain rejection.
SITEVERIFY_CONFIG_ERROR_CODES = frozenset(
    {'missing-input-secret', 'invalid-input-secret', 'bad-request'}
)
SITEVERIFY_UNAVAILABLE_ERROR_CODES = frozenset({'internal-error'})
# Widget error-callback codes that mean the widget itself is misconfigured,
# per Cloudflare's "Client-side errors / Error codes" docs: invalid or unknown
# site key (110100, 110110, 400020), hostname not authorized for the widget
# (110200), site key region/domain mismatch (400021), disabled site key
# (400070). Everything else (timeouts, iframe load, clock, 300*/600* challenge
# failures) is transient or about the visitor and is never reported.
TURNSTILE_CLIENT_CONFIG_ERROR_CODES = frozenset(
    {'110100', '110110', '110200', '400020', '400021', '400070'}
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


def verify_turnstile_token(
    token: str,
    remote_ip: str | None = None,
    request: HttpRequest | Request | None = None,
) -> TurnstileOutcome:
    """Check a Turnstile token against Cloudflare's siteverify API.

    Returns UNAVAILABLE instead of raising when Cloudflare cannot be reached,
    so the caller can answer with a clean error instead of a 500. Failures that
    are not the visitor's fault are reported via ``registration_alerts``;
    ``request`` only adds the path and method to that report.
    """
    token = token.strip()
    if not token:
        _log_rejection('missing_token')
        record_missing_turnstile_token(request)
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
    except (requests.RequestException, ValueError) as exc:
        logger.exception('Turnstile verification API unavailable; registration not processed')
        report_registration_failure(
            RegistrationFailure.TURNSTILE_UNREACHABLE, request=request, exc=exc
        )
        return TurnstileOutcome.UNAVAILABLE

    if not isinstance(result, dict):
        logger.error(
            'Turnstile verification API returned an unexpected payload; registration not processed'
        )
        report_registration_failure(
            RegistrationFailure.TURNSTILE_UNREACHABLE,
            request=request,
            details={'siteverify response': 'unexpected payload (not a JSON object)'},
        )
        return TurnstileOutcome.UNAVAILABLE

    if result.get('success') is True:
        return TurnstileOutcome.PASSED

    error_codes = result.get('error-codes')
    codes = [str(code) for code in error_codes] if isinstance(error_codes, list) else []
    server_side_failure = _server_side_failure(codes)
    if server_side_failure is not None:
        # Our secret is missing/wrong or Cloudflare failed internally: not the
        # visitor's fault, so don't tell them their check failed.
        logger.error(
            'Turnstile verification failed on the server side (error_codes=%s); '
            'registration not processed',
            ','.join(codes),
        )
        report_registration_failure(
            server_side_failure,
            request=request,
            details={'siteverify error codes': ','.join(codes)},
        )
        return TurnstileOutcome.UNAVAILABLE
    _log_rejection('siteverify_failed', codes)
    return TurnstileOutcome.REJECTED


def _server_side_failure(codes: list[str]) -> RegistrationFailure | None:
    if SITEVERIFY_CONFIG_ERROR_CODES.intersection(codes):
        return RegistrationFailure.TURNSTILE_SERVER_CONFIG
    if SITEVERIFY_UNAVAILABLE_ERROR_CODES.intersection(codes):
        return RegistrationFailure.TURNSTILE_UNREACHABLE
    return None
