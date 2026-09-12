"""API endpoints around social login: available providers and linked identities."""
from __future__ import annotations

from allauth.socialaccount.adapter import get_adapter as get_socialaccount_adapter
from allauth.socialaccount.models import SocialAccount
from django.urls import reverse
from django.utils import translation
from django.utils.translation import gettext as _
from rest_framework import permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from config.responses import api_error_response

from .social_linking import has_other_login_method
from .social_urls import PROVIDER_ADAPTERS

PROVIDER_NAMES = {
    'google': 'Google',
    'microsoft': 'Microsoft',
}


def _de(message: str) -> str:
    with translation.override('de'):
        return _(message)


def _is_provider_configured(request: Request, provider_id: str) -> bool:
    """Return whether the deployment has OAuth credentials for a provider."""
    return bool(get_socialaccount_adapter().list_apps(request, provider=provider_id))


def _provider_email(account: SocialAccount) -> str | None:
    """Return the provider account email if the OAuth payload included one."""
    email = account.extra_data.get('email')
    return email if isinstance(email, str) and email else None


def _serialize_connection(account: SocialAccount, *, can_disconnect: bool) -> dict[str, object]:
    """Serialize a linked provider identity for the account settings page."""
    return {
        'id': account.pk,
        'provider': account.provider,
        'provider_name': PROVIDER_NAMES.get(account.provider, account.provider),
        'email': _provider_email(account),
        'connected_at': account.date_joined.isoformat(),
        'can_disconnect': can_disconnect,
    }


class SocialProvidersView(APIView):
    """List the social login providers this deployment offers."""

    permission_classes = [permissions.AllowAny]

    def get(self, request: Request) -> Response:
        return Response(
            [
                {
                    'id': provider_id,
                    'name': PROVIDER_NAMES.get(provider_id, provider_id),
                    'login_url': reverse(f'{provider_id}_login'),
                }
                for provider_id in PROVIDER_ADAPTERS
                if _is_provider_configured(request, provider_id)
            ]
        )


class SocialConnectionsView(APIView):
    """List the provider identities linked to the authenticated account."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
        accounts = list(SocialAccount.objects.filter(user=request.user).order_by('provider', 'pk'))
        return Response(
            [
                _serialize_connection(
                    account,
                    can_disconnect=has_other_login_method(
                        user=request.user,
                        excluded_social_account_id=account.pk,
                    ),
                )
                for account in accounts
            ]
        )


class SocialDisconnectView(APIView):
    """Remove a linked provider identity from the authenticated account."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request) -> Response:
        account = SocialAccount.objects.filter(
            user=request.user,
            pk=request.data.get('id'),
        ).first()
        if account is None:
            return api_error_response(
                code='social_account_not_found',
                detail=_de(_('This login method is not connected to your account.')),
                status_code=status.HTTP_404_NOT_FOUND,
            )

        if not has_other_login_method(user=request.user, excluded_social_account_id=account.pk):
            return Response(
                {
                    'code': 'last_login_method',
                    'detail': _de(
                        _('You cannot remove your last login method. Set a password first.')
                    ),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        account.delete()
        return Response(
            {'detail': _de(_('The login method was disconnected.'))},
            status=status.HTTP_200_OK,
        )
