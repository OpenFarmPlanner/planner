"""Rate limiting for crop-library API token requests.

Mirrors `farm.agent_api.throttling`: read and write are split into separate
scopes so polling cannot starve a token's own write budget. No
"declared agent" distinction here — unlike `ProjectApiToken`, this token
has no self-declared-agent bonus ceiling, since it is already restricted to
a handful of platform admins rather than general project automation.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from rest_framework.throttling import SimpleRateThrottle

from .permissions import get_request_crop_library_token

if TYPE_CHECKING:
    from rest_framework.request import Request
    from rest_framework.views import APIView

SAFE_METHODS = ('GET', 'HEAD', 'OPTIONS')


class CropLibraryTokenReadRateThrottle(SimpleRateThrottle):
    """Rate-limits read requests authenticated by a crop-library API token."""

    scope = 'crop_library_token_read'

    def get_cache_key(self, request: Request, view: APIView) -> str | None:
        if request.method not in SAFE_METHODS:
            return None
        token = get_request_crop_library_token(request)
        if token is None:
            return None
        return self.cache_format % {'scope': self.scope, 'ident': token.pk}


class CropLibraryTokenWriteRateThrottle(SimpleRateThrottle):
    """Rate-limits write requests authenticated by a crop-library API token."""

    scope = 'crop_library_token_write'

    def get_cache_key(self, request: Request, view: APIView) -> str | None:
        if request.method in SAFE_METHODS:
            return None
        token = get_request_crop_library_token(request)
        if token is None:
            return None
        return self.cache_format % {'scope': self.scope, 'ident': token.pk}
