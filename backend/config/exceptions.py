from __future__ import annotations

from typing import Any

from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import exception_handler

from crops.agent_api.authentication import header_carries_crop_library_token
from farm.agent_api.authentication import header_carries_api_token


def api_exception_handler(exc: Exception, context: dict[str, Any]) -> Response | None:
    response = exception_handler(exc, context)
    wait = getattr(exc, 'wait', None)
    if response is not None and response.status_code == 429 and wait is not None:
        retry_after = int(wait) if wait == int(wait) else int(wait) + 1
        response.data['retry_after'] = retry_after
    _upgrade_bearer_auth_failure_to_401(exc, context, response)
    return response


def _upgrade_bearer_auth_failure_to_401(
    exc: Exception,
    context: dict[str, Any],
    response: Response | None,
) -> None:
    """Answer a rejected API token with 401 instead of DRF's default 403.

    DRF derives the status from the *first* configured authenticator, which is
    ``SessionAuthentication`` — it advertises no ``WWW-Authenticate`` header, so
    every authentication failure comes back as 403. That is the right answer
    for a browser session and the wrong one for a bearer credential, where 401
    plus a challenge is what tells a client its token needs replacing. Only
    requests that actually presented an API token (either `ProjectApiToken`
    or `CropLibraryApiToken`) are changed, so session behaviour stays exactly
    as it was.
    """
    if response is None or not isinstance(exc, exceptions.AuthenticationFailed):
        return
    request = context.get('request')
    header = getattr(request, 'META', {}).get('HTTP_AUTHORIZATION', '') if request else ''
    if not header_carries_api_token(header) and not header_carries_crop_library_token(header):
        return
    response.status_code = status.HTTP_401_UNAUTHORIZED
    response['WWW-Authenticate'] = 'Bearer realm="api"'
