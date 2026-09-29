"""Public views serving the OpenAPI reference (see farm/agent_api/schema.py).

Kept apart from the schema module: drf-spectacular's views resolve
``DEFAULT_SCHEMA_CLASS`` at import time, which is defined there.
"""

from __future__ import annotations

from drf_spectacular.views import (
    SpectacularAPIView,
    SpectacularRedocView,
    SpectacularSwaggerView,
)

from .schema import ProjectApiTokenScheme


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
    pass


class PublicSwaggerView(_PublicDocsViewMixin, SpectacularSwaggerView):
    """Swagger UI whose "Try it out" authenticates with the Bearer scheme only.

    The bundled script attaches a CSRF token and sends the browser's session
    cookie; ours omits credentials, so a signed-in visitor's session is never
    used and every request carries only the token entered under "Authorize".
    """

    template_name_js = 'farm/api_docs/swagger_ui.js'

    def _get_schema_auth_names(self) -> list[str]:
        return [ProjectApiTokenScheme.name]
