"""Stable response builders shared by DRF viewsets."""

from typing import Any

from rest_framework.response import Response


def api_error_response(
    *,
    code: str,
    detail: str,
    status_code: int,
    **context: Any,
) -> Response:
    """Return the API's standard machine-code plus human-detail error shape."""
    return Response({'code': code, 'detail': detail, **context}, status=status_code)
