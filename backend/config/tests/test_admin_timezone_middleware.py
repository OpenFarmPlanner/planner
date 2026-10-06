from __future__ import annotations

import zoneinfo

from django.http import HttpResponse
from django.test import RequestFactory, TestCase, override_settings
from django.utils import timezone

from config.middleware import AdminTimezoneMiddleware


def _get_response(request):
    return HttpResponse(str(timezone.get_current_timezone()))


class AdminTimezoneMiddlewareTests(TestCase):
    def setUp(self) -> None:
        self.factory = RequestFactory()
        self.addCleanup(timezone.deactivate)

    @override_settings(ADMIN_TIME_ZONE='Europe/Vienna')
    def test_activates_configured_timezone_for_admin_requests(self) -> None:
        middleware = AdminTimezoneMiddleware(_get_response)
        request = self.factory.get('/admin/')

        response = middleware(request)

        self.assertEqual(response.content.decode(), 'Europe/Vienna')

    @override_settings(ADMIN_TIME_ZONE='Europe/Vienna')
    def test_leaves_default_timezone_for_non_admin_requests(self) -> None:
        middleware = AdminTimezoneMiddleware(_get_response)
        request = self.factory.get('/api/schema/')

        response = middleware(request)

        self.assertEqual(response.content.decode(), 'UTC')

    @override_settings(ADMIN_TIME_ZONE='Europe/Vienna')
    def test_deactivates_timezone_after_the_response(self) -> None:
        middleware = AdminTimezoneMiddleware(_get_response)
        request = self.factory.get('/admin/')

        middleware(request)

        self.assertEqual(timezone.get_current_timezone(), zoneinfo.ZoneInfo('UTC'))
