"""Published OpenAPI reference for external API-token clients.

The drf-spectacular schema served at ``/api/schema/`` describes exactly the
surface an API token can reach: an operation is published only when its view
declares the action in ``api_token_actions`` (the same allowlist that
``ApiTokenAccessPermission`` enforces). Everything else — admin, moderation,
account and frontend-only helpers — stays out of the document by construction,
so publishing an endpoint and opening it to tokens remain one decision.

This is additive to ``/api/agent/openapi.json`` (``farm.agent_api.openapi``),
which stays the agent-specific crop contract generated from the import field
specs. See docs/api.md.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from django.conf import settings
from drf_spectacular.extensions import OpenApiAuthenticationExtension
from drf_spectacular.openapi import AutoSchema
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter

# Deprecated pre-"Crop" route spellings (see `legacy_router` in farm/urls.py).
# They serve the same views as the current names and must not be advertised.
LEGACY_ALIAS_SEGMENTS = frozenset({
    'cultures',
    'culture-supplier-data',
    'public-cultures',
    'culture-imports',
})

PROJECT_HEADER_PARAMETER = OpenApiParameter(
    name='X-Project-Id',
    type=OpenApiTypes.INT,
    location=OpenApiParameter.HEADER,
    required=False,
    description=(
        'Active project. Optional with an API token: the project is always taken '
        'from the token, and a header naming a different project is rejected with '
        '403. Required for session-authenticated requests (400 when missing).'
    ),
)

SEASON_HEADER_PARAMETER = OpenApiParameter(
    name='X-Season-Id',
    type=OpenApiTypes.INT,
    location=OpenApiParameter.HEADER,
    required=False,
    description=(
        'Active season. Optional; a missing or non-integer value means "no season '
        'context" (lists are not filtered by season) and never causes an error.'
    ),
)


def _public_api_prefix() -> str:
    """Return the path prefix of the canonical (non-legacy) API mount."""
    url_prefix = getattr(settings, 'URL_PREFIX', '').strip('/')
    return f'/{url_prefix}/api/' if url_prefix else '/api/'


def _is_legacy_alias(path: str, api_prefix: str) -> bool:
    first_segment = path[len(api_prefix):].split('/', 1)[0]
    return first_segment in LEGACY_ALIAS_SEGMENTS


def is_token_reachable(callback: Callable[..., Any], method: str) -> bool:
    """Whether an API token may call this view for this HTTP method.

    Mirrors ``farm.agent_api.permissions._resolve_action``: ViewSets are keyed
    by action name, plain ``APIView`` subclasses by the lowercase HTTP method.
    """
    view_class = getattr(callback, 'cls', None)
    allowed_actions = getattr(view_class, 'api_token_actions', None)
    if not allowed_actions:
        return False
    method_to_action = getattr(callback, 'actions', None)
    action = method_to_action.get(method.lower()) if method_to_action else method.lower()
    return action in allowed_actions


def preprocess_public_endpoints(endpoints: list[tuple], **kwargs: Any) -> list[tuple]:
    """Keep only canonical, token-reachable operations in the published schema."""
    api_prefix = _public_api_prefix()
    return [
        (path, path_regex, method, callback)
        for path, path_regex, method, callback in endpoints
        if path.startswith(api_prefix)
        and not _is_legacy_alias(path, api_prefix)
        and is_token_reachable(callback, method)
    ]


_RAW_VALUE_NOTE = (
    'Raw value stored on this row. On a Sorte (non-empty `variety`) linked to a '
    '`crop_species`, an unset value (null, blank or empty) is inherited from the '
    'general Kultur of that species; read the value in effect from '
    '`effective_values` and check `inherited_fields`. Sending a value sets an '
    'override; clearing it restores inheritance.'
)

_SPECIES_INVARIANT_NOTE = (
    'Raw value stored on this row. Species-level: on a Sorte linked to a '
    '`crop_species` this field is not overridable. A value sent for such a Sorte '
    'is stored on the general Kultur when it fills a gap there and rejected when '
    'it contradicts it; `effective_values` always carries the Kultur value.'
)


def _inheritance_note_by_api_field() -> dict[str, str]:
    # Imported lazily: this module is DRF's DEFAULT_SCHEMA_CLASS, which DRF
    # resolves while view and serializer modules are still being imported.
    from farm.crops.serializers.crops import INHERITABLE_API_FIELD_NAMES
    from farm.services.crop_inheritance import (
        CROP_INHERITABLE_FIELDS,
        CROP_SPECIES_INVARIANT_FIELDS,
    )

    return {
        INHERITABLE_API_FIELD_NAMES.get(field, field): (
            _SPECIES_INVARIANT_NOTE if field in CROP_SPECIES_INVARIANT_FIELDS else _RAW_VALUE_NOTE
        )
        for field in CROP_INHERITABLE_FIELDS
    }


def _crop_schema_components(result: dict[str, Any]) -> list[dict[str, Any]]:
    schemas = result.get('components', {}).get('schemas', {})
    return [
        component
        for name, component in schemas.items()
        if name in {'Crop', 'CropRequest', 'PatchedCropRequest'}
    ]


def annotate_inherited_crop_fields(result: dict[str, Any], **kwargs: Any) -> dict[str, Any]:
    """Mark inheritable Sorte fields as raw values in the crop components."""
    notes = _inheritance_note_by_api_field()
    for component in _crop_schema_components(result):
        for field_name, field_schema in component.get('properties', {}).items():
            note = notes.get(field_name)
            if note is None:
                continue
            existing = field_schema.get('description', '').strip()
            field_schema['description'] = f'{existing}\n\n{note}'.strip()
    return result


class PublicApiAutoSchema(AutoSchema):
    """Adds the project context header to every project-scoped operation."""

    def get_override_parameters(self) -> list[OpenApiParameter]:
        from farm.common.mixins import ProjectScopedMixin

        parameters = list(super().get_override_parameters())
        if isinstance(self.view, ProjectScopedMixin):
            parameters.append(PROJECT_HEADER_PARAMETER)
        return parameters


class ProjectApiTokenScheme(OpenApiAuthenticationExtension):
    """Describe ``Authorization: Bearer ofp_pat_…`` as the only security scheme."""

    target_class = 'farm.agent_api.authentication.ProjectApiTokenAuthentication'
    name = 'ApiToken'

    def get_security_definition(self, auto_schema: AutoSchema) -> dict[str, str]:
        return {
            'type': 'http',
            'scheme': 'bearer',
            'bearerFormat': 'ofp_pat_…',
            'description': (
                'Project-bound API token created under Account settings → API tokens. '
                'Scopes: read, write, delete. See the guide above.'
            ),
        }
