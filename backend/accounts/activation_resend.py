"""Per-address limits for resending the account activation email.

The limits key on a hash of the normalized address, never on whether an
account exists or is already active. Unknown and confirmed addresses therefore
hit exactly the same cooldown and hourly cap as a pending one, so the
resend endpoint's responses cannot be used to enumerate accounts.
"""

from __future__ import annotations

import hashlib
import math
import time
from dataclasses import dataclass
from email.utils import parseaddr

from django.conf import settings
from django.core.cache import cache

_CACHE_KEY_PREFIX = 'activation_resend'
_WINDOW_SECONDS = 3600


@dataclass(frozen=True)
class ResendDecision:
    """Outcome of a resend attempt; `retry_after_seconds` is 0 when allowed."""

    allowed: bool
    limit_reached: bool = False
    retry_after_seconds: int = 0


def activation_sender_address() -> str:
    """The bare address activation emails are sent from (DEFAULT_FROM_EMAIL)."""
    _name, address = parseaddr(settings.DEFAULT_FROM_EMAIL)
    return address or settings.DEFAULT_FROM_EMAIL


def _cache_key(email: str) -> str:
    digest = hashlib.sha256(email.strip().lower().encode('utf-8')).hexdigest()
    return f'{_CACHE_KEY_PREFIX}:{digest}'


def register_resend_attempt(email: str, now: float | None = None) -> ResendDecision:
    """Check the cooldown and hourly cap for `email` and record the attempt if allowed."""
    current = time.time() if now is None else now
    key = _cache_key(email)
    recent = [stamp for stamp in cache.get(key, []) if current - stamp < _WINDOW_SECONDS]

    if len(recent) >= settings.ACTIVATION_RESEND_MAX_PER_HOUR:
        return ResendDecision(
            allowed=False,
            limit_reached=True,
            retry_after_seconds=max(1, math.ceil(min(recent) + _WINDOW_SECONDS - current)),
        )

    cooldown = settings.ACTIVATION_RESEND_COOLDOWN_SECONDS
    if recent and current - max(recent) < cooldown:
        return ResendDecision(
            allowed=False,
            retry_after_seconds=max(1, math.ceil(max(recent) + cooldown - current)),
        )

    recent.append(current)
    cache.set(key, recent, timeout=_WINDOW_SECONDS)
    return ResendDecision(allowed=True)
