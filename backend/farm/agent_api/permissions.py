"""Scope and surface enforcement for project-bound API tokens.

The rule set is deliberately deny-by-default: a view is unreachable with an API
token unless it explicitly declares ``api_token_actions``. New endpoints are
therefore invisible to agents until someone consciously opts them in, rather
than being exposed by the mere act of existing.

Three independent checks apply to every token-authenticated request:

1. **Surface** — the view/action must be on the allowlist.
2. **Delete actions** — destructive or restorative actions require a dedicated
   delete scope and an allowlist marker, so write tokens cannot destroy data.
3. **Scope** — ``read`` tokens may only use safe (non-mutating) HTTP methods.
"""

from __future__ import annotations

from rest_framework import permissions

from farm.models import ProjectApiToken

# Verbs that never change data. Anything outside this set requires a `write`
# token; DELETE and marked restorative actions additionally require the
# dedicated delete scope.
SAFE_METHODS = frozenset(permissions.SAFE_METHODS)


def get_request_api_token(request) -> ProjectApiToken | None:
    """Return the API token backing this request, or None for other auth types.

    :param request: DRF request.
    :return: The authenticating :class:`ProjectApiToken`, or None.
    """
    auth = getattr(request, 'auth', None)
    return auth if isinstance(auth, ProjectApiToken) else None


DECLARED_CLIENT_TYPE_HEADER = 'HTTP_X_CLIENT_DECLARED_TYPE'
DECLARED_AGENT_CLIENT_TYPE = 'agent'


def client_declared_as_agent(request) -> bool:
    """Whether this request opted into declaring itself an automated/agent client.

    Purely a self-declaration honored for its own incentive (see
    docs/agent-api.md and docs/account-trust-levels.md): a declared client
    gets a higher token rate-limit ceiling and its crop-library submissions
    are flagged for moderators as `origin_declared_agent`, never trusted for
    anything security-relevant.
    """
    header_value = request.META.get(DECLARED_CLIENT_TYPE_HEADER, '')
    return header_value.strip().lower() == DECLARED_AGENT_CLIENT_TYPE


def _resolve_action(request, view) -> str:
    """Return the allowlist key for this request.

    ViewSets are keyed by their action name (``list``, ``partial_update``, a
    custom ``@action`` method name, …); plain ``APIView`` subclasses have no
    action, so their lowercase HTTP method is used instead.
    """
    action = getattr(view, 'action', None)
    if action:
        return action
    return request.method.lower()


class ApiTokenAccessPermission(permissions.BasePermission):
    """Restrict token-authenticated requests to explicitly allowlisted surfaces.

    Session-authenticated requests pass through untouched — this class only
    ever narrows what an API token can reach, never what a signed-in user can.
    """

    def has_permission(self, request, view) -> bool:
        """Apply the surface, verb, and scope rules to token-authenticated requests."""
        token = get_request_api_token(request)
        if token is None:
            return True

        allowed_actions = getattr(view, 'api_token_actions', None)
        if not allowed_actions:
            self.message = 'This endpoint is not available for API tokens.'
            return False

        action = _resolve_action(request, view)
        if action not in allowed_actions:
            self.message = f"The action '{action}' is not available for API tokens."
            return False

        delete_actions = getattr(view, 'api_token_delete_actions', set())
        if (request.method == 'DELETE' or action in delete_actions) and not token.can_delete():
            self.message = "This API token cannot delete data; 'delete' scope is required."
            return False

        if request.method not in SAFE_METHODS and not token.can_write():
            self.message = "This API token has read-only scope; 'write' is required."
            return False

        return True
