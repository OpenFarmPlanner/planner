from __future__ import annotations

from typing import Any

from rest_framework import status
from rest_framework.response import Response
from config.responses import api_error_response

from .models import GuestDemoSession

GUEST_DEMO_FORBIDDEN_CODE = 'guest_demo_restricted'
GUEST_DEMO_FORBIDDEN_DETAIL = 'This action is not available in the public demo.'


def is_active_guest_demo_user(user: Any) -> bool:
    """Return whether the user belongs to a temporary guest demo account."""
    if not getattr(user, 'is_authenticated', False):
        return False
    return GuestDemoSession.objects.filter(user=user).exists()


def guest_demo_forbidden_response() -> Response:
    """Build the standard response for demo-restricted side effects."""
    return api_error_response(
        code=GUEST_DEMO_FORBIDDEN_CODE,
        detail=GUEST_DEMO_FORBIDDEN_DETAIL,
        status_code=status.HTTP_403_FORBIDDEN,
    )
