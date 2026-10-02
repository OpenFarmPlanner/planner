"""Self-service endpoint for crop-library API tokens.

Session-only by design, same reasoning as
`farm.agent_api.views.ProjectApiTokenViewSet`: none of these actions declare
`crop_library_token_actions`, so a crop-library token cannot mint, list, or
revoke tokens — managing the credential stays a human, session-authenticated
action. Creation is further restricted to superusers only — deliberately
stricter than `crops.permissions.is_public_library_admin` (which also admits
plain `is_staff`), because this token authenticates as whichever user it is
bound to against the crop-taxonomy moderation endpoints: a platform-wide
credential, not a per-library-moderation one.
"""

from __future__ import annotations

from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.response import Response

from config.responses import api_error_response
from crops.models import CropLibraryApiToken

from .serializers import CropLibraryApiTokenCreateSerializer, CropLibraryApiTokenSerializer


class CropLibraryApiTokenViewSet(viewsets.ViewSet):
    """List, create, and revoke the calling user's own crop-library API tokens.

    Every query is filtered by ``user=request.user``; there is no code path
    that returns or mutates another user's token.
    """

    def get_queryset(self):
        """Return only the requesting user's tokens."""
        return CropLibraryApiToken.objects.filter(user=self.request.user)

    def list(self, request):
        """Return the caller's tokens, newest first."""
        return Response(CropLibraryApiTokenSerializer(self.get_queryset(), many=True).data)

    def create(self, request):
        """Create a token bound to the caller and return its plaintext value once.

        Restricted to superusers: the token authenticates as whichever user
        it is bound to, so only a superuser may mint one, and only for
        themselves — there is no "bind to another user" option.
        """
        if not request.user.is_superuser:
            return api_error_response(
                code='superuser_required',
                detail='Superuser privileges are required to create a crop library API token.',
                status_code=status.HTTP_403_FORBIDDEN,
            )
        serializer = CropLibraryApiTokenCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        token, raw_token = CropLibraryApiToken.create_token(
            user=request.user,
            name=data['name'],
            scope=data['scope'],
            expires_at=data.get('expires_at'),
        )
        payload = CropLibraryApiTokenSerializer(token).data
        # The only moment the plaintext exists outside the client.
        payload['token'] = raw_token
        return Response(payload, status=status.HTTP_201_CREATED)

    def destroy(self, request, pk=None):
        """Revoke a token. Revocation is permanent and takes effect immediately."""
        token = get_object_or_404(self.get_queryset(), pk=pk)
        token.revoke()
        return Response(CropLibraryApiTokenSerializer(token).data, status=status.HTTP_200_OK)
