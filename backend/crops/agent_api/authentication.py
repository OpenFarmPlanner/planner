"""Bearer-token authentication for platform-scoped crop-library API tokens.

Mirrors `farm.agent_api.authentication.ProjectApiTokenAuthentication` in
shape, but this token is bound to a user only, never to a project — see
`crops.models.CropLibraryApiToken` and docs/rfc-crop-taxonomy-admin-api.md.

Deliberately *not* a replacement for `SessionAuthentication`: both stay
registered, and only requests carrying an `Authorization: Bearer ofp_clt_…`
header take this path. CSRF: as with `ProjectApiToken`, a bearer token is not
ambiently attached by the browser, so it needs no CSRF token.
"""

from __future__ import annotations

from django.utils.translation import gettext_lazy as _
from rest_framework import authentication, exceptions

from crops.models import CROP_LIBRARY_API_TOKEN_PREFIX, CropLibraryApiToken

AUTH_HEADER_KEYWORD = 'bearer'


def header_carries_crop_library_token(raw_header: str) -> bool:
    """Return True when an Authorization header value presents one of our tokens.

    Detection counterpart to `_extract_bearer_token`, used by the surface
    middleware. Must never be narrower than what the authenticator accepts —
    see `farm.agent_api.authentication.header_carries_api_token` for why.

    :param raw_header: Raw ``Authorization`` header value.
    :return: True when the header presents an OpenFarmPlanner crop-library token.
    """
    parts = (raw_header or '').split()
    if not parts or parts[0].lower() != AUTH_HEADER_KEYWORD:
        return False
    return any(part.startswith(CROP_LIBRARY_API_TOKEN_PREFIX) for part in parts[1:])


class CropLibraryApiTokenAuthentication(authentication.BaseAuthentication):
    """Authenticate ``Authorization: Bearer <token>`` against ``CropLibraryApiToken``."""

    keyword = AUTH_HEADER_KEYWORD

    def authenticate(self, request):
        """Resolve the bearer token, or return None to fall through to session auth.

        :param request: Incoming DRF request.
        :return: ``(user, token)`` tuple, or None when no bearer token is present.
        """
        raw_token = self._extract_bearer_token(request)
        if raw_token is None:
            return None

        token = (
            CropLibraryApiToken.objects
            .select_related('user')
            .filter(token_hash=CropLibraryApiToken.hash_token(raw_token))
            .first()
        )
        # Same generic rejection message regardless of cause, as with
        # ProjectApiToken — a caller holding an invalid token learns only
        # that it does not work.
        if token is None:
            raise exceptions.AuthenticationFailed(_('Invalid API token.'))
        if token.is_revoked:
            raise exceptions.AuthenticationFailed(_('This API token has been revoked.'))
        if token.is_expired:
            raise exceptions.AuthenticationFailed(_('This API token has expired.'))
        if not token.user.is_active:
            raise exceptions.AuthenticationFailed(_('Invalid API token.'))

        token.touch_last_used()
        return token.user, token

    def authenticate_header(self, request):
        """Return the WWW-Authenticate header value for 401 responses."""
        return 'Bearer realm="api"'

    def _extract_bearer_token(self, request) -> str | None:
        """Return the raw token from the Authorization header, if this scheme applies."""
        header = authentication.get_authorization_header(request).split()
        if not header or header[0].lower() != self.keyword.encode():
            return None
        if len(header) != 2:
            raise exceptions.AuthenticationFailed(
                _('Invalid Authorization header. Expected "Bearer <token>".')
            )
        try:
            raw_token = header[1].decode('utf-8')
        except UnicodeError as exc:
            raise exceptions.AuthenticationFailed(_('Invalid API token.')) from exc

        # A bearer credential without our prefix belongs to some other
        # scheme (or `ProjectApiToken`) — return None rather than failing so
        # the remaining authenticators get a turn.
        if not raw_token.startswith(CROP_LIBRARY_API_TOKEN_PREFIX):
            return None
        return raw_token
