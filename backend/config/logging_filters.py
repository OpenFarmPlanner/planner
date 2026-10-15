"""Logging filters referenced from ``settings.LOGGING``.

Loaded while Django configures logging, before the app registry is ready, so
this module must not import models or app code.
"""

from __future__ import annotations

import logging
from typing import Any

_ALERTED_ATTRIBUTE = '_registration_failure_alerted'


def mark_request_alerted(request: Any) -> None:
    """Record that a dedicated registration alert already covers this request."""
    setattr(request, _ALERTED_ATTRIBUTE, True)


def is_request_alerted(request: Any) -> bool:
    return bool(getattr(request, _ALERTED_ATTRIBUTE, False))


class SkipRegistrationAlertedRequests(logging.Filter):
    """Keep ``AdminEmailHandler`` from emailing an error the registration alert already reported."""

    def filter(self, record: logging.LogRecord) -> bool:
        return not is_request_alerted(getattr(record, 'request', None))
