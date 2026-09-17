from __future__ import annotations

from django.conf import settings
from django.core.cache import cache

_PERIOD_SECONDS = {'s': 1, 'm': 60, 'h': 3600, 'd': 86400}
_CACHE_KEY_PREFIX = 'registration_success_ip'


def _parse_rate(rate: str) -> tuple[int, int]:
    """Parse a "N/period" throttle rate string into (count, seconds)."""
    count_part, period_part = rate.split('/', 1)
    return int(count_part), _PERIOD_SECONDS[period_part[0]]


def registration_ip_limit_exceeded(ip: str) -> bool:
    """Whether this IP already reached its successful-registration cap.

    Unlike the request-level `auth_register` DRF throttle (which counts every
    attempt, successful or not), this counts only registrations that actually
    created an account, using a simple rolling cache counter. Call
    `record_registration_success` only after the account was created.
    """
    limit, _window_seconds = _parse_rate(settings.THROTTLE_AUTH_REGISTER_SUCCESS_PER_IP)
    current_count = cache.get(f'{_CACHE_KEY_PREFIX}:{ip}', 0)
    return current_count >= limit


def record_registration_success(ip: str) -> None:
    """Record a successful registration against the per-IP rolling counter."""
    _limit, window_seconds = _parse_rate(settings.THROTTLE_AUTH_REGISTER_SUCCESS_PER_IP)
    cache_key = f'{_CACHE_KEY_PREFIX}:{ip}'
    try:
        cache.incr(cache_key)
    except ValueError:
        cache.set(cache_key, 1, timeout=window_seconds)
