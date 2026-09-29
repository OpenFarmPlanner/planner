"""Public views serving the OpenAPI reference (see farm/agent_api/schema.py).

Kept apart from the schema module: drf-spectacular's views resolve
``DEFAULT_SCHEMA_CLASS`` at import time, which is defined there.
"""

from __future__ import annotations

from typing import Any

from drf_spectacular.utils import extend_schema
from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)
from rest_framework.request import Request
from rest_framework.response import Response

from .schema import ProjectApiTokenScheme

# The UI bundles are served from the CDN pinned in SPECTACULAR_SETTINGS
# (SWAGGER_UI_DIST / REDOC_DIST) and loaded with Subresource Integrity, so a
# tampered CDN file is refused by the browser instead of running on our origin.
# The hashes belong to exactly these versions: bump both together, computing
# `sha384-$(openssl dgst -sha384 -binary <file> | openssl base64 -A)` over the
# files of the npm package.
SWAGGER_UI_DIST_VERSION = '5.33.0'
REDOC_DIST_VERSION = '2.5.4'
SWAGGER_UI_INTEGRITY = {
    'swagger_ui_css': 'sha384-Ov4/wv3j2bmct8cDc5X4ngJZohVPzEmc6uDPH8WeljUxO5vtoykvMEfbu9Vh6RaW',
    'swagger_ui_bundle': 'sha384-YDALVcy8kj8yltLBVi1vBiBAUqdxvus673gM8XKwiy6aDUJFXivF/KCufekjYbVf',
    'swagger_ui_standalone': (
        'sha384-My2aDM4r2Mbm3ybHcubKm9O9U8FEjvF/O5nGvE9YK5dzqOTbWEKa79RPJ1krdMaF'
    ),
}
REDOC_INTEGRITY = {
    'redoc_standalone': 'sha384-w447zOpYfw/1Tv/5AK9NfHTlQIqE3RVR6KY62jCyy9zNDgO64cMwGGP1Fj0zJVf5',
}


def _with_integrity(response: Response, hashes: dict[str, str]) -> Response:
    response.data['integrity'] = hashes
    return response


class _PublicDocsViewMixin:
    """Serve the reference to anyone, without session or token authentication.

    ``api_token_actions`` lets a client that sends its token out of habit still
    fetch the document (``ApiTokenSurfaceMiddleware`` would otherwise refuse
    it); with no authentication classes the token is simply ignored here.
    """

    authentication_classes: list[type] = []
    api_token_actions = {'get'}


class PublicSchemaView(_PublicDocsViewMixin, SpectacularAPIView):
    pass


class PublicRedocView(_PublicDocsViewMixin, SpectacularRedocView):
    """Redoc with an SRI-pinned bundle and no third-party web fonts."""

    template_name = 'farm/api_docs/redoc.html'

    @extend_schema(exclude=True)
    def get(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        return _with_integrity(super().get(request, *args, **kwargs), REDOC_INTEGRITY)


class PublicSwaggerView(_PublicDocsViewMixin, SpectacularSwaggerView):
    """Swagger UI whose "Try it out" authenticates with the Bearer scheme only.

    The bundled script attaches a CSRF token and sends the browser's session
    cookie; ours omits credentials, so a signed-in visitor's session is never
    used and every request carries only the token entered under "Authorize".
    """

    template_name = 'farm/api_docs/swagger_ui.html'
    template_name_js = 'farm/api_docs/swagger_ui.js'

    @extend_schema(exclude=True)
    def get(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        return _with_integrity(super().get(request, *args, **kwargs), SWAGGER_UI_INTEGRITY)

    def _get_schema_auth_names(self) -> list[str]:
        return [ProjectApiTokenScheme.name]
