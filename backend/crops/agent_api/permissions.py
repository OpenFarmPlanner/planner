"""Scope and surface enforcement for crop-library API tokens.

Mirrors `farm.agent_api.permissions.ApiTokenAccessPermission`: deny-by-default
for the token, but authorization itself is never carried on the token — a
view's own `is_public_library_moderator`/`is_public_library_admin` checks
(`crops.permissions`) still run against `request.user` exactly as they do
for a session request. This class only ever narrows what a crop-library
token can reach; it never widens what a signed-in user may do.
"""

from __future__ import annotations

from rest_framework import permissions

from crops.models import CropLibraryApiToken

SAFE_METHODS = frozenset(permissions.SAFE_METHODS)


def get_request_crop_library_token(request) -> CropLibraryApiToken | None:
    """Return the crop-library token backing this request, or None otherwise.

    :param request: DRF request.
    :return: The authenticating :class:`CropLibraryApiToken`, or None.
    """
    auth = getattr(request, 'auth', None)
    return auth if isinstance(auth, CropLibraryApiToken) else None


def _resolve_action(request, view) -> str:
    """Return the allowlist key for this request — see the farm equivalent."""
    action = getattr(view, 'action', None)
    if action:
        return action
    return request.method.lower()


class CropLibraryTokenAccessPermission(permissions.BasePermission):
    """Restrict crop-library-token-authenticated requests to allowlisted actions.

    Session-authenticated requests, and requests authenticated some other
    way (e.g. `ProjectApiToken`), pass through untouched.
    """

    def has_permission(self, request, view) -> bool:
        """Apply the surface and scope rules to crop-library-token requests."""
        token = get_request_crop_library_token(request)
        if token is None:
            return True

        allowed_actions = getattr(view, 'crop_library_token_actions', None)
        if not allowed_actions:
            self.message = 'This endpoint is not available for crop library API tokens.'
            return False

        action = _resolve_action(request, view)
        if action not in allowed_actions:
            self.message = f"The action '{action}' is not available for crop library API tokens."
            return False

        if request.method not in SAFE_METHODS and not token.can_write():
            self.message = "This API token has read-only scope; 'write' is required."
            return False

        return True
