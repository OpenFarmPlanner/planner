"""Outermost gate for crop-library-token requests: refuse views that never opted in.

Mirrors `farm.agent_api.middleware.ApiTokenSurfaceMiddleware`. Keeping this
as an independent, separately-keyed middleware (rather than reusing the farm
one) means a view opting into the `ProjectApiToken` surface never
accidentally opts into the crop-library surface, and vice versa — the two
token types stay honestly separate end to end.
"""

from __future__ import annotations

import json

from django.http import HttpResponse

from .authentication import header_carries_crop_library_token

_DENIED_BODY = json.dumps(
    {'detail': 'This endpoint is not available for crop library API tokens.'}
).encode('utf-8')


def _carries_crop_library_token(request) -> bool:
    """Return True when the request presents an OpenFarmPlanner crop-library token."""
    return header_carries_crop_library_token(request.META.get('HTTP_AUTHORIZATION', ''))


def _view_opted_in(view_func) -> bool:
    """Return True when the resolved view declares a crop-library-token allowlist."""
    view_class = getattr(view_func, 'cls', None) or getattr(view_func, 'view_class', None)
    return bool(getattr(view_class, 'crop_library_token_actions', None))


class CropLibraryTokenSurfaceMiddleware:
    """Refuse crop-library-token requests to views that have not opted in."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        """Pass the request through; the decision happens in ``process_view``."""
        return self.get_response(request)

    def process_view(self, request, view_func, view_args, view_kwargs):
        """Return 403 for token requests aimed at a non-allowlisted view."""
        if not _carries_crop_library_token(request):
            return None
        if _view_opted_in(view_func):
            return None
        return HttpResponse(_DENIED_BODY, content_type='application/json', status=403)
