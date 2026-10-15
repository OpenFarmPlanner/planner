from __future__ import annotations

from django.http import HttpRequest, HttpResponse
from django.test import RequestFactory, SimpleTestCase, override_settings

from config.middleware import CanonicalHostRedirectMiddleware
from config.settings import _default_canonical_host_redirects


def _get_response(request: HttpRequest) -> HttpResponse:
    return HttpResponse('served')


@override_settings(
    CANONICAL_HOST='openfarmplanner.org',
    CANONICAL_HOST_SCHEME='https',
    CANONICAL_HOST_REDIRECTS=['www.openfarmplanner.org'],
    USE_X_FORWARDED_HOST=False,
)
class CanonicalHostRedirectMiddlewareTests(SimpleTestCase):
    def setUp(self) -> None:
        self.factory = RequestFactory()
        self.middleware = CanonicalHostRedirectMiddleware(_get_response)

    def test_redirects_www_api_docs_to_apex_with_301(self) -> None:
        request = self.factory.get('/api/docs/', HTTP_HOST='www.openfarmplanner.org')

        response = self.middleware(request)

        self.assertEqual(response.status_code, 301)
        self.assertEqual(response['Location'], 'https://openfarmplanner.org/api/docs/')

    def test_preserves_query_string_and_ignores_port_and_case(self) -> None:
        request = self.factory.get(
            '/api/schema/?format=json', HTTP_HOST='WWW.openfarmplanner.org:443',
        )

        response = self.middleware(request)

        self.assertEqual(
            response['Location'], 'https://openfarmplanner.org/api/schema/?format=json',
        )

    def test_uses_308_for_unsafe_methods_so_the_body_survives(self) -> None:
        request = self.factory.post(
            '/api/auth/login/', data={}, HTTP_HOST='www.openfarmplanner.org',
        )

        response = self.middleware(request)

        self.assertEqual(response.status_code, 308)
        self.assertEqual(response['Location'], 'https://openfarmplanner.org/api/auth/login/')

    def test_passes_canonical_host_through(self) -> None:
        request = self.factory.get('/api/docs/', HTTP_HOST='openfarmplanner.org')

        response = self.middleware(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b'served')

    @override_settings(CANONICAL_HOST_REDIRECTS=[])
    def test_disabled_without_redirect_hosts(self) -> None:
        request = self.factory.get('/api/docs/', HTTP_HOST='www.openfarmplanner.org')

        self.assertEqual(self.middleware(request).status_code, 200)

    @override_settings(USE_X_FORWARDED_HOST=True)
    def test_honours_forwarded_host_when_trusted(self) -> None:
        request = self.factory.get(
            '/api/docs/',
            HTTP_HOST='localhost:8000',
            HTTP_X_FORWARDED_HOST='www.openfarmplanner.org',
        )

        self.assertEqual(self.middleware(request).status_code, 301)


class DefaultCanonicalHostRedirectsTests(SimpleTestCase):
    def test_redirects_www_of_a_bare_domain(self) -> None:
        self.assertEqual(
            _default_canonical_host_redirects('openfarmplanner.org'), ['www.openfarmplanner.org'],
        )

    def test_nothing_for_www_localhost_or_ip_hosts(self) -> None:
        self.assertEqual(_default_canonical_host_redirects('www.example.org'), [])
        self.assertEqual(_default_canonical_host_redirects('localhost'), [])
        self.assertEqual(_default_canonical_host_redirects('127.0.0.1'), [])
        self.assertEqual(_default_canonical_host_redirects(''), [])
