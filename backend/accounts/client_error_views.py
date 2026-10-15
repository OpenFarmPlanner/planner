from __future__ import annotations

from rest_framework import permissions, status
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .registration_alerts import RegistrationFailure, report_registration_failure
from .serializers import TurnstileClientErrorSerializer
from .services import _validate_serializer_in_german
from .throttling import ClientErrorReportGlobalRateThrottle, ClientErrorReportIpRateThrottle


class TurnstileClientErrorView(APIView):
    """Receives Turnstile widget configuration errors detected in the browser."""

    permission_classes = [permissions.AllowAny]
    throttle_classes = [ClientErrorReportIpRateThrottle, ClientErrorReportGlobalRateThrottle]

    def post(self, request: Request) -> Response:
        serializer = TurnstileClientErrorSerializer(data=request.data)
        _validate_serializer_in_german(serializer)
        data = serializer.validated_data
        report_registration_failure(
            RegistrationFailure.TURNSTILE_CLIENT_CONFIG,
            request=request,
            details={
                'Widget error code': data['error_code'],
                'Page path': data['page_path'] or '-',
                'Hostname': data['hostname'] or '-',
                'Site key reported by the client': data['site_key'] or '(empty)',
            },
        )
        return Response(status=status.HTTP_204_NO_CONTENT)
