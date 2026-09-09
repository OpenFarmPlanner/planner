"""Endpoints for API-token self-service and the two-step crop import.

Token management is intentionally *not* on the agent allowlist: none of these
token views declare ``api_token_actions``, so an API token cannot mint, list,
or revoke tokens. Managing credentials stays a session-authenticated action a
human performs in the browser.
"""

from __future__ import annotations

from datetime import timedelta

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from farm.common.mixins import ProjectScopedMixin
from farm.common.responses import api_error_response
from farm.models import CropImportDraft, Project, ProjectApiToken
from farm.services.crop_import import analyze_import_payload
from farm.services.crop_import.apply import ImportExecutionError, apply_import_draft

from .permissions import get_request_api_token
from .serializers import (
    CropImportApplyRequestSerializer,
    CropImportPreviewRequestSerializer,
    ProjectApiTokenCreateSerializer,
    ProjectApiTokenSerializer,
)


class ProjectApiTokenViewSet(viewsets.ViewSet):
    """List, create, and revoke the calling user's own API tokens.

    Every query is filtered by ``user=request.user``; there is no code path
    that returns or mutates another user's token, so a guessed id yields 404
    rather than someone else's credential.
    """

    def get_queryset(self):
        """Return only the requesting user's tokens."""
        return (
            ProjectApiToken.objects
            .select_related('project')
            .filter(user=self.request.user)
        )

    def list(self, request):
        """Return the caller's tokens, newest first."""
        tokens = self.get_queryset()
        project_id = request.query_params.get('project')
        if project_id:
            tokens = tokens.filter(project_id=project_id)
        return Response(ProjectApiTokenSerializer(tokens, many=True).data)

    def create(self, request):
        """Create a token and return its plaintext value exactly once."""
        serializer = ProjectApiTokenCreateSerializer(
            data=request.data, context={'request': request}
        )
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        project = get_object_or_404(
            Project, pk=data['project'], is_active=True, deleted_at__isnull=True
        )
        token, raw_token = ProjectApiToken.create_token(
            user=request.user,
            project=project,
            name=data['name'],
            scope=data['scope'],
            expires_at=data.get('expires_at'),
        )
        payload = ProjectApiTokenSerializer(token).data
        # The only moment the plaintext exists outside the client. It is not
        # stored, not logged, and not retrievable afterwards.
        payload['token'] = raw_token
        return Response(payload, status=status.HTTP_201_CREATED)

    def destroy(self, request, pk=None):
        """Revoke a token. Revocation is permanent and takes effect immediately."""
        token = get_object_or_404(self.get_queryset(), pk=pk)
        token.revoke()
        return Response(ProjectApiTokenSerializer(token).data, status=status.HTTP_200_OK)


class CropImportPreviewView(ProjectScopedMixin, APIView):
    """Validate a crop import and store the reviewable draft. Writes no crop data."""

    api_token_actions = {'post'}

    def post(self, request):
        """Analyze the payload and return the preview plus a draft id."""
        serializer = CropImportPreviewRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        items = serializer.validated_data['items']

        preview = analyze_import_payload(items, project=request.active_project)
        checksum = CropImportDraft.compute_checksum(preview)
        draft = CropImportDraft.objects.create(
            project=request.active_project,
            created_by=request.user,
            source_label=serializer.validated_data.get('source_label', ''),
            checksum=checksum,
            preview=preview,
            has_errors=preview['has_errors'],
            has_warnings=preview['has_warnings'],
            expires_at=timezone.now() + timedelta(seconds=CropImportDraft.DEFAULT_TTL_SECONDS),
        )
        return Response(_draft_payload(draft), status=status.HTTP_200_OK)


class CropImportDraftView(ProjectScopedMixin, APIView):
    """Retrieve a stored import draft so a preview can be reviewed again."""

    api_token_actions = {'get'}

    def get(self, request, draft_id):
        """Return the stored draft for the active project."""
        draft = get_object_or_404(
            CropImportDraft,
            pk=draft_id,
            project=request.active_project,
        )
        return Response(_draft_payload(draft))


class CropImportApplyView(ProjectScopedMixin, APIView):
    """Execute a previously previewed and explicitly confirmed import."""

    api_token_actions = {'post'}

    def post(self, request, draft_id):
        """Apply the draft transactionally after verifying the confirmation."""
        serializer = CropImportApplyRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        draft = get_object_or_404(
            CropImportDraft,
            pk=draft_id,
            project=request.active_project,
        )
        try:
            result = apply_import_draft(
                draft,
                project=request.active_project,
                request=request,
                checksum=data['checksum'],
                confirmed=data['confirm'],
                acknowledge_warnings=data['acknowledge_warnings'],
            )
        except ImportExecutionError as exc:
            return api_error_response(
                code=exc.code,
                detail=exc.message,
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        return Response(result, status=status.HTTP_200_OK)


class AgentContextView(APIView):
    """Return the project context of the authenticating API token."""

    api_token_actions = {'get'}

    def get(self, request):
        """Return non-secret context for the project-bound token."""
        token = get_request_api_token(request)
        if token is None:
            return api_error_response(
                code='api_token_required',
                detail='API token authentication is required.',
                status_code=status.HTTP_403_FORBIDDEN,
            )
        return Response(
            {
                'project_id': token.project_id,
                'project_name': token.project.name,
                'token_scope': token.scope,
            }
        )


def _draft_payload(draft: CropImportDraft) -> dict:
    """Build the API representation of an import draft."""
    return {
        'draft_id': str(draft.id),
        'checksum': draft.checksum,
        'status': draft.status,
        'source_label': draft.source_label,
        'created_at': draft.created_at,
        'expires_at': draft.expires_at,
        'applied_at': draft.applied_at,
        'has_errors': draft.has_errors,
        'has_warnings': draft.has_warnings,
        'requires_confirmation': draft.status == CropImportDraft.STATUS_PENDING,
        'summary': draft.preview.get('summary', {}),
        'items': draft.preview.get('items', []),
        'result': draft.result or None,
    }


class AgentOpenApiSchemaView(APIView):
    """Serve the OpenAPI document describing the token-reachable API surface."""

    api_token_actions = {'get'}

    def get(self, request):
        """Return the generated OpenAPI document."""
        from .openapi import build_openapi_document

        return Response(build_openapi_document(server_url=_api_server_url(request)))


def _api_server_url(request) -> str:
    """Return the absolute base URL the documented paths are relative to."""
    return request.build_absolute_uri('/').rstrip('/') + _api_path_prefix()


def _api_path_prefix() -> str:
    """Return the deployment's API path prefix, honouring URL_PREFIX."""
    from django.conf import settings

    prefix = getattr(settings, 'URL_PREFIX', '').strip('/')
    return f'/{prefix}/api' if prefix else '/api'
