"""Operator alerts for registration failures that are not the visitor's fault.

Every reported failure is logged at ERROR on this module's logger and, when
``REGISTRATION_ALERT_EMAILS`` is set, emailed at most once per failure type per
cooldown window. See docs/account-trust-levels.md ("Registration failure
alerts") for which failures count and which deliberately do not.
"""

from __future__ import annotations

import enum
import logging
import re
import threading
import time
import traceback
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from django.conf import settings
from django.core.cache import cache
from django.core.mail import get_connection, send_mail
from django.http import HttpRequest
from django.utils import timezone
from rest_framework.request import Request
from rest_framework.response import Response

from config.logging_filters import is_request_alerted, mark_request_alerted

logger = logging.getLogger(__name__)

SUBJECT_PREFIX = '[OpenFarmPlanner] Registrierung fehlgeschlagen'
ALERT_COOLDOWN_SECONDS = 15 * 60
MISSING_TOKEN_WINDOW_SECONDS = 15 * 60
MISSING_TOKEN_THRESHOLD = 5
ALERT_SEND_TIMEOUT_SECONDS = 10
_CACHE_PREFIX = 'registration_alert'

_EMAIL_PATTERN = re.compile(r'([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})')
_IPV4_PATTERN = re.compile(r'(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])')
# Full and "::"-compressed IPv6 forms; requiring "::" or seven colons keeps
# clock times like 12:30:45 from being mistaken for addresses.
_IPV6_PATTERN = re.compile(
    r'(?<![\w:])(?:(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}'
    r'|(?:[0-9A-Fa-f]{1,4}:){0,6}[0-9A-Fa-f]{0,4}::(?:[0-9A-Fa-f]{1,4}:){0,6}[0-9A-Fa-f]{0,4})(?![\w:])'
)


class RegistrationFailure(enum.StrEnum):
    SERVER_ERROR = 'server_error'
    VERIFICATION_EMAIL = 'verification_email'
    TURNSTILE_CLIENT_CONFIG = 'turnstile_client_config'
    TURNSTILE_SERVER_CONFIG = 'turnstile_server_config'
    TURNSTILE_UNREACHABLE = 'turnstile_unreachable'
    TURNSTILE_MISSING_TOKEN = 'turnstile_missing_token'


_TURNSTILE_FAILURES = frozenset({
    RegistrationFailure.TURNSTILE_CLIENT_CONFIG,
    RegistrationFailure.TURNSTILE_SERVER_CONFIG,
    RegistrationFailure.TURNSTILE_UNREACHABLE,
    RegistrationFailure.TURNSTILE_MISSING_TOKEN,
})


@dataclass(frozen=True)
class AlertReport:
    failure: RegistrationFailure
    lines: list[tuple[str, str]] = field(default_factory=list)
    traceback_text: str = ''


def mask_email(email: str) -> str:
    """Keep the first two characters of the local part: "martin@gmx.at" -> "ma***@gmx.at"."""
    local, separator, domain = email.strip().partition('@')
    if not separator:
        return '***'
    return f'{local[:2]}***@{domain}'


def scrub_sensitive_text(text: str) -> str:
    """Mask email addresses and remove IP addresses from free text such as exception messages."""
    text = _EMAIL_PATTERN.sub(lambda match: mask_email(match.group(0)), text)
    text = _IPV4_PATTERN.sub('[IP removed]', text)
    return _IPV6_PATTERN.sub('[IP removed]', text)


def _build_report(
    failure: RegistrationFailure,
    request: HttpRequest | None,
    exc: BaseException | None,
    details: Mapping[str, object] | None,
    email: str | None,
) -> AlertReport:
    lines: list[tuple[str, str]] = [
        ('Timestamp (UTC)', timezone.now().isoformat()),
        ('Environment', settings.DEPLOYMENT_ENVIRONMENT),
        ('Failure type', failure.value),
    ]
    if request is not None:
        lines.append(('Request', f'{request.method} {request.path}'))
    if exc is not None:
        lines.append(('Exception', type(exc).__name__))
        lines.append(('Message', scrub_sensitive_text(str(exc)) or '-'))
    if email:
        lines.append(('Email (masked)', mask_email(email)))
    if failure in _TURNSTILE_FAILURES:
        lines.append(('Expected site key (backend)', settings.TURNSTILE_SITE_KEY or '(not set)'))
    for label, value in (details or {}).items():
        lines.append((label, scrub_sensitive_text(str(value))))
    traceback_text = ''
    if exc is not None and exc.__traceback__ is not None:
        traceback_text = scrub_sensitive_text(''.join(traceback.format_exception(exc)))
    return AlertReport(failure=failure, lines=lines, traceback_text=traceback_text)


def _format_body(report: AlertReport, suppressed_count: int) -> str:
    body_lines = [f'{label}: {value}' for label, value in report.lines]
    if suppressed_count:
        body_lines.append(
            'Further occurrences suppressed since the previous alert of this type: '
            f'{suppressed_count}'
        )
    if report.traceback_text:
        body_lines.extend(['', 'Traceback:', report.traceback_text])
    return '\n'.join(body_lines) + '\n'


def _claim_send_slot(failure: RegistrationFailure) -> tuple[bool, int]:
    """Return whether an email may go out now and how many were suppressed before it."""
    lock_key = f'{_CACHE_PREFIX}:cooldown:{failure.value}'
    suppressed_key = f'{_CACHE_PREFIX}:suppressed:{failure.value}'
    if cache.add(lock_key, True, timeout=ALERT_COOLDOWN_SECONDS):
        suppressed = int(cache.get(suppressed_key, 0) or 0)
        cache.delete(suppressed_key)
        return True, suppressed
    cache.add(suppressed_key, 0, timeout=None)
    try:
        cache.incr(suppressed_key)
    except ValueError:
        cache.set(suppressed_key, 1, timeout=None)
    return False, 0


def _deliver(subject: str, body: str, recipients: list[str]) -> None:
    send_mail(
        subject=subject,
        message=body,
        from_email=settings.SERVER_EMAIL,
        recipient_list=recipients,
        fail_silently=False,
        connection=get_connection(timeout=ALERT_SEND_TIMEOUT_SECONDS),
    )


def _send_alert_email(subject: str, body: str, recipients: list[str]) -> None:
    try:
        _deliver(subject, body, recipients)
    except Exception:  # noqa: BLE001 - the alert must never surface to the user
        logger.exception('Failed to send registration failure alert email (subject=%s)', subject)


def _subject(failure: RegistrationFailure) -> str:
    return f'{SUBJECT_PREFIX}: {failure.value}'


def _dispatch(send: Callable[[], None]) -> None:
    """Run the SMTP round trip off the request thread so it never delays the response."""
    if settings.REGISTRATION_ALERT_SEND_ASYNC:
        threading.Thread(target=send, name='registration-alert', daemon=True).start()
    else:
        send()


def report_registration_failure(
    failure: RegistrationFailure,
    *,
    request: HttpRequest | Any | None = None,
    exc: BaseException | None = None,
    details: Mapping[str, object] | None = None,
    email: str | None = None,
) -> None:
    """Log a registration failure at ERROR and email the operators, throttled per type.

    Never raises: a broken alert path must not turn into a broken registration.
    ``request`` may be a DRF ``Request``; the underlying ``HttpRequest`` is
    marked so Django's generic ``AdminEmailHandler`` skips the same exception.
    """
    try:
        http_request = getattr(request, '_request', request)
        if http_request is not None:
            mark_request_alerted(http_request)
        report = _build_report(failure, http_request, exc, details, email)
        logger.error(
            'Registration failure alert (%s): %s',
            failure.value,
            '; '.join(f'{label}={value}' for label, value in report.lines),
            extra={'registration_failure': failure.value},
        )
        recipients = list(settings.REGISTRATION_ALERT_EMAILS)
        if not recipients:
            return
        may_send, suppressed = _claim_send_slot(failure)
        if not may_send:
            return
        subject = _subject(failure)
        body = _format_body(report, suppressed)
        _dispatch(lambda: _send_alert_email(subject, body, recipients))
    except Exception:  # noqa: BLE001
        logger.exception('Registration failure alert could not be processed')


def send_test_alert(failure: RegistrationFailure) -> list[str]:
    """Send one clearly marked alert synchronously, bypassing the cooldown.

    Used by the ``send_test_registration_alert`` command to verify mail
    delivery on a server. Raises when sending fails; returns the recipients.
    """
    recipients = list(settings.REGISTRATION_ALERT_EMAILS)
    if not recipients:
        raise ValueError('REGISTRATION_ALERT_EMAILS is empty.')
    report = _build_report(
        failure,
        None,
        None,
        {'Test': 'Sent by send_test_registration_alert; no registration failed.'},
        None,
    )
    _deliver(f'{_subject(failure)} (TEST)', _format_body(report, 0), recipients)
    return recipients


def record_missing_turnstile_token(
    request: HttpRequest | Any | None = None, now: float | None = None
) -> None:
    """Count registrations without a Turnstile token; a burst of them means a broken widget."""
    try:
        current = time.time() if now is None else now
        key = f'{_CACHE_PREFIX}:missing_token'
        recent = [
            stamp for stamp in cache.get(key, [])
            if current - stamp < MISSING_TOKEN_WINDOW_SECONDS
        ]
        recent.append(current)
        cache.set(key, recent, timeout=MISSING_TOKEN_WINDOW_SECONDS)
    except Exception:  # noqa: BLE001
        logger.exception('Could not record a registration attempt without Turnstile token')
        return
    if len(recent) > MISSING_TOKEN_THRESHOLD:
        report_registration_failure(
            RegistrationFailure.TURNSTILE_MISSING_TOKEN,
            request=request,
            details={
                'Registrations without Turnstile token in the last 15 minutes': len(recent),
            },
        )


class RegistrationAlertMixin:
    """Report unhandled exceptions and 5xx responses of a registration-flow view.

    Failures that already raised a more specific alert (a Turnstile outage, a
    failed verification email) are not reported a second time as server errors.
    """

    def raise_uncaught_exception(self, exc: Exception) -> None:
        report_registration_failure(
            RegistrationFailure.SERVER_ERROR, request=self.request, exc=exc  # type: ignore[attr-defined]
        )
        super().raise_uncaught_exception(exc)  # type: ignore[misc]

    def finalize_response(
        self, request: Request, response: Response, *args: Any, **kwargs: Any
    ) -> Response:
        response = super().finalize_response(request, response, *args, **kwargs)  # type: ignore[misc]
        http_request = getattr(request, '_request', request)
        if response.status_code >= 500 and not is_request_alerted(http_request):
            report_registration_failure(
                RegistrationFailure.SERVER_ERROR,
                request=request,
                details={'HTTP status': response.status_code},
            )
        return response
