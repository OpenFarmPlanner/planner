"""Redis cache that degrades instead of failing when Redis is unavailable."""
from __future__ import annotations

import logging
from typing import Any

from django.core.cache.backends.base import DEFAULT_TIMEOUT
from django.core.cache.backends.redis import RedisCache
from redis.exceptions import RedisError

logger = logging.getLogger(__name__)


class FailOpenRedisCache(RedisCache):
    """Treats a Redis failure as an empty cache.

    The cache only holds rate-limit and alert counters. Without Redis those
    limits lapse for a moment, which beats answering every rate-limited request
    with a 500.
    """

    def _log_failure(self, operation: str, error: RedisError) -> None:
        logger.warning('Redis cache %s failed: %s', operation, error)

    def get(self, key: Any, default: Any = None, version: int | None = None) -> Any:
        try:
            return super().get(key, default, version)
        except RedisError as error:
            self._log_failure('get', error)
            return default

    def set(
        self,
        key: Any,
        value: Any,
        timeout: float | None = DEFAULT_TIMEOUT,
        version: int | None = None,
    ) -> None:
        try:
            super().set(key, value, timeout, version)
        except RedisError as error:
            self._log_failure('set', error)

    def add(
        self,
        key: Any,
        value: Any,
        timeout: float | None = DEFAULT_TIMEOUT,
        version: int | None = None,
    ) -> bool:
        try:
            return super().add(key, value, timeout, version)
        except RedisError as error:
            self._log_failure('add', error)
            return False

    def delete(self, key: Any, version: int | None = None) -> bool:
        try:
            return super().delete(key, version)
        except RedisError as error:
            self._log_failure('delete', error)
            return False

    def incr(self, key: Any, delta: int = 1, version: int | None = None) -> int:
        """Reports a failure as a missing key, which callers already handle."""
        try:
            return super().incr(key, delta, version)
        except RedisError as error:
            self._log_failure('incr', error)
            raise ValueError(f"Key '{key}' not found.") from error
