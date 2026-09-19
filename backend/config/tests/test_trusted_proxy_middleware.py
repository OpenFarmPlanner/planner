from __future__ import annotations

import ipaddress

from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase, override_settings

from config.middleware import TrustedProxyRemoteAddrMiddleware

CLOUDFLARE_TEST_NETWORK = ipaddress.ip_network('173.245.48.0/20')
PROXY_PEER_IP = '173.245.48.1'
REAL_CLIENT_IP = '203.0.113.7'


def _get_response(request):
    return HttpResponse()


class TrustedProxyRemoteAddrMiddlewareTests(SimpleTestCase):
    def setUp(self) -> None:
        self.factory = RequestFactory()
        self.middleware = TrustedProxyRemoteAddrMiddleware(_get_response)

    @override_settings(
        TRUSTED_PROXY_NETWORKS=[CLOUDFLARE_TEST_NETWORK],
        TRUSTED_PROXY_IP_HEADER='HTTP_CF_CONNECTING_IP',
    )
    def test_rewrites_remote_addr_when_peer_is_trusted(self) -> None:
        request = self.factory.get(
            '/', REMOTE_ADDR=PROXY_PEER_IP, HTTP_CF_CONNECTING_IP=REAL_CLIENT_IP,
        )

        self.middleware(request)

        self.assertEqual(request.META['REMOTE_ADDR'], REAL_CLIENT_IP)

    @override_settings(TRUSTED_PROXY_NETWORKS=[], TRUSTED_PROXY_IP_HEADER='HTTP_CF_CONNECTING_IP')
    def test_no_op_when_no_trusted_networks_configured(self) -> None:
        request = self.factory.get(
            '/', REMOTE_ADDR=PROXY_PEER_IP, HTTP_CF_CONNECTING_IP=REAL_CLIENT_IP,
        )

        self.middleware(request)

        self.assertEqual(request.META['REMOTE_ADDR'], PROXY_PEER_IP)

    @override_settings(
        TRUSTED_PROXY_NETWORKS=[CLOUDFLARE_TEST_NETWORK],
        TRUSTED_PROXY_IP_HEADER='HTTP_CF_CONNECTING_IP',
    )
    def test_header_is_ignored_when_peer_is_not_a_trusted_proxy(self) -> None:
        """A direct client cannot spoof the header to claim an arbitrary IP."""
        untrusted_peer_ip = '198.51.100.9'
        request = self.factory.get(
            '/', REMOTE_ADDR=untrusted_peer_ip, HTTP_CF_CONNECTING_IP=REAL_CLIENT_IP,
        )

        self.middleware(request)

        self.assertEqual(request.META['REMOTE_ADDR'], untrusted_peer_ip)

    @override_settings(
        TRUSTED_PROXY_NETWORKS=[CLOUDFLARE_TEST_NETWORK],
        TRUSTED_PROXY_IP_HEADER='HTTP_CF_CONNECTING_IP',
    )
    def test_no_op_when_trusted_peer_sends_no_header(self) -> None:
        request = self.factory.get('/', REMOTE_ADDR=PROXY_PEER_IP)

        self.middleware(request)

        self.assertEqual(request.META['REMOTE_ADDR'], PROXY_PEER_IP)

    @override_settings(
        TRUSTED_PROXY_NETWORKS=[CLOUDFLARE_TEST_NETWORK],
        TRUSTED_PROXY_IP_HEADER='HTTP_CF_CONNECTING_IP',
    )
    def test_no_op_when_header_value_is_not_a_valid_ip(self) -> None:
        request = self.factory.get(
            '/', REMOTE_ADDR=PROXY_PEER_IP, HTTP_CF_CONNECTING_IP='not-an-ip',
        )

        self.middleware(request)

        self.assertEqual(request.META['REMOTE_ADDR'], PROXY_PEER_IP)
