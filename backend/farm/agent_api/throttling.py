"""Rate limiting for project API token requests.

The `api_token_read`/`api_token_write`/`api_token_write_declared_agent`
scopes exist in `DEFAULT_THROTTLE_RATES` (see docs/account-trust-levels.md),
but nothing enforced them until these classes: `TrustAwareWriteRateThrottle`
only narrows throughput for session users still at the "new" trust level, so
an established account's API token had no dedicated write limit at all.
Read and write are split into separate scopes so a token's list/detail
polling cannot starve its own write budget, and vice versa. Declared-agent
writes get a separate, higher-ceiling scope as the incentive for the
self-declaration described in `client_declared_as_agent`.

Each class is a no-op (returns None from `get_cache_key`) for anything
outside its own method/declaration combination, so all three can sit in
`DEFAULT_THROTTLE_CLASSES` unconditionally without affecting session
requests or other token requests.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from rest_framework.throttling import SimpleRateThrottle

from farm.agent_api.permissions import client_declared_as_agent, get_request_api_token

if TYPE_CHECKING:
    from rest_framework.request import Request
    from rest_framework.views import APIView

SAFE_METHODS = ('GET', 'HEAD', 'OPTIONS')


class ApiTokenReadRateThrottle(SimpleRateThrottle):
    """Rate-limits read requests authenticated by a project API token."""

    scope = 'api_token_read'

    def get_cache_key(self, request: Request, view: APIView) -> str | None:
        if request.method not in SAFE_METHODS:
            return None
        token = get_request_api_token(request)
        if token is None:
            return None
        return self.cache_format % {'scope': self.scope, 'ident': token.pk}


class ApiTokenWriteRateThrottle(SimpleRateThrottle):
    """Rate-limits write requests from a token that has not declared itself an agent."""

    scope = 'api_token_write'

    def get_cache_key(self, request: Request, view: APIView) -> str | None:
        if request.method in SAFE_METHODS:
            return None
        token = get_request_api_token(request)
        if token is None or client_declared_as_agent(request):
            return None
        return self.cache_format % {'scope': self.scope, 'ident': token.pk}


class ApiTokenWriteDeclaredAgentRateThrottle(SimpleRateThrottle):
    """Rate-limits write requests from a token that declared itself an agent."""

    scope = 'api_token_write_declared_agent'

    def get_cache_key(self, request: Request, view: APIView) -> str | None:
        if request.method in SAFE_METHODS:
            return None
        token = get_request_api_token(request)
        if token is None or not client_declared_as_agent(request):
            return None
        return self.cache_format % {'scope': self.scope, 'ident': token.pk}
