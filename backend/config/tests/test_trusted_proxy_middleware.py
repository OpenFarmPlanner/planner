from __future__ import annotations

import ipaddress
from types import SimpleNamespace

from django.core.cache import cache
from django.http import HttpRequest, HttpResponse
from django.test import AsyncRequestFactory, RequestFactory, SimpleTestCase, override_settings
from rest_framework.settings import api_settings
from rest_framework.throttling import ScopedRateThrottle

from accounts.registration_abuse import record_registration_success, registration_ip_limit_exceeded
from accounts.throttling import ClientErrorReportIpRateThrottle
from config.middleware import TrustedProxyRemoteAddrMiddleware

PEER = '100.65.136.1'
EDGE = '173.245.48.1'
CLIENT = '203.0.113.7'
ATTACKER = '198.51.100.9'
PEERS = [ipaddress.ip_network(PEER + '/32')]
UPSTREAMS = [ipaddress.ip_network('173.245.48.0/20'), ipaddress.ip_network('2400:cb00::/32')]


def _get_response(request: HttpRequest) -> HttpResponse:
    return HttpResponse()


@override_settings(TRUSTED_PROXY_NETWORKS=PEERS, TRUSTED_PROXY_UPSTREAM_NETWORKS=UPSTREAMS)
class TrustedProxyRemoteAddrMiddlewareTests(SimpleTestCase):
    def setUp(self) -> None:
        self.middleware = TrustedProxyRemoteAddrMiddleware(_get_response)
        cache.clear()
        self.addCleanup(cache.clear)

    def request(
        self, xff: str | None, peer: str = PEER, cf: str = CLIENT, **extra: str,
    ) -> HttpRequest:
        headers = {'REMOTE_ADDR': peer, 'HTTP_CF_CONNECTING_IP': cf}
        if xff is not None:
            headers['HTTP_X_FORWARDED_FOR'] = xff
        headers.update(extra)
        request = RequestFactory().get('/', **headers)
        self.middleware(request)
        return request

    def test_real_cloudflare_chain_reaches_client_in_wsgi_and_asgi(self) -> None:
        for factory in (RequestFactory(), AsyncRequestFactory()):
            with self.subTest(factory=type(factory).__name__):
                request = factory.get('/')
                request.META.update(REMOTE_ADDR=PEER, HTTP_X_FORWARDED_FOR=f'{CLIENT}, {EDGE}')
                self.middleware(request)
                self.assertEqual(request.META['REMOTE_ADDR'], CLIENT)
                self.assertEqual(ScopedRateThrottle().get_ident(request), CLIENT)

    def test_different_edges_preserve_one_client_identity(self) -> None:
        for edge in (EDGE, '173.245.48.2', '2400:cb00::1'):
            with self.subTest(edge=edge):
                self.assertEqual(self.request(f'{CLIENT}, {edge}').META['REMOTE_ADDR'], CLIENT)

    def test_untrusted_client_stops_walk_before_long_or_malformed_prefix(self) -> None:
        self.assertEqual(self.request(('unknown,' * 100) + ATTACKER).META['REMOTE_ADDR'], ATTACKER)

    def test_chain_limit_keeps_the_peer_instead_of_accepting_a_truncated_chain(self) -> None:
        self.assertEqual(self.request(CLIENT + (',' + EDGE) * 31).META['REMOTE_ADDR'], CLIENT)
        self.assertEqual(self.request(CLIENT + (',' + EDGE) * 32).META['REMOTE_ADDR'], PEER)

    def test_overlong_trusted_suffix_does_not_promote_leftmost_value(self) -> None:
        self.assertEqual(self.request(CLIENT + (',' + EDGE) * 40).META['REMOTE_ADDR'], PEER)

    def test_direct_origin_ignores_forged_cf_header_and_prefixes(self) -> None:
        for prefix in (CLIENT, f'{CLIENT}, {EDGE}', 'unknown', '', '"203.0.113.8"'):
            with self.subTest(prefix=prefix):
                request = self.request(f'{prefix}, {ATTACKER}')
                self.assertEqual(request.META['REMOTE_ADDR'], ATTACKER)
                self.assertEqual(ScopedRateThrottle().get_ident(request), ATTACKER)

    def test_untrusted_peer_ignores_all_forwarding_headers(self) -> None:
        request = self.request(f'{CLIENT}, {EDGE}', peer=ATTACKER)
        self.assertEqual(request.META['REMOTE_ADDR'], ATTACKER)
        self.assertEqual(ScopedRateThrottle().get_ident(request), ATTACKER)

    @override_settings(TRUSTED_PROXY_NETWORKS=[])
    def test_disabled_trust_still_ignores_xff_for_throttles(self) -> None:
        request = self.request(CLIENT)
        self.assertEqual(request.META['REMOTE_ADDR'], PEER)
        self.assertEqual(ScopedRateThrottle().get_ident(request), PEER)

    def test_missing_or_malformed_authoritative_suffix_falls_back_to_peer(self) -> None:
        for xff in (None, '', 'unknown', f'{CLIENT}, unknown', f'unknown, {EDGE}', f'{CLIENT},',
                    f'{CLIENT}, [2400:cb00::1]', f'{CLIENT}, 173.245.48.1:443',
                    f'{CLIENT}, fe80::1%eth0', f'{EDGE}, {PEER}'):
            with self.subTest(xff=xff):
                request = self.request(xff)
                self.assertEqual(request.META['REMOTE_ADDR'], PEER)
                self.assertEqual(ScopedRateThrottle().get_ident(request), PEER)

    def test_cf_and_legacy_custom_headers_never_override_chain(self) -> None:
        with override_settings(TRUSTED_PROXY_IP_HEADER='HTTP_X_CLIENT_IP'):
            request = self.request(
                f'{CLIENT}, {EDGE}', cf=ATTACKER, HTTP_X_CLIENT_IP=ATTACKER,
            )
            self.assertEqual(request.META['REMOTE_ADDR'], CLIENT)

    def test_ipv6_and_mapped_addresses_are_canonical(self) -> None:
        for xff, peer, expected in (
            ('2001:db8:0:0::7, 2400:cb00::1', PEER, '2001:db8::7'),
            (f'::ffff:{CLIENT}, ::ffff:{EDGE}', '::ffff:' + PEER, CLIENT),
        ):
            with self.subTest(xff=xff):
                request = self.request(xff, peer=peer)
                self.assertEqual(request.META['REMOTE_ADDR'], expected)
                self.assertEqual(ScopedRateThrottle().get_ident(request), expected)

    def test_mapped_trust_networks_match_canonical_addresses(self) -> None:
        configurations = (
            ([ipaddress.ip_network('::ffff:' + PEER + '/128')], UPSTREAMS),
            (PEERS, [ipaddress.ip_network('::ffff:173.245.48.0/116')]),
        )
        for peers, upstreams in configurations:
            with self.subTest(peers=peers, upstreams=upstreams):
                with override_settings(
                    TRUSTED_PROXY_NETWORKS=peers, TRUSTED_PROXY_UPSTREAM_NETWORKS=upstreams,
                ):
                    request = self.request(f'{CLIENT}, {EDGE}', peer='::ffff:' + PEER)
                    self.assertEqual(request.META['REMOTE_ADDR'], CLIENT)

    @override_settings(TRUSTED_PROXY_UPSTREAM_NETWORKS=[])
    def test_immediate_trust_does_not_imply_cloudflare_trust(self) -> None:
        self.assertEqual(self.request(f'{CLIENT}, {EDGE}').META['REMOTE_ADDR'], EDGE)
        self.assertEqual(self.request(ATTACKER).META['REMOTE_ADDR'], ATTACKER)

    @override_settings(TRUSTED_PROXY_NETWORKS=UPSTREAMS, TRUSTED_PROXY_UPSTREAM_NETWORKS=[])
    def test_direct_cloudflare_topology_uses_xff(self) -> None:
        self.assertEqual(self.request(CLIENT, peer=EDGE).META['REMOTE_ADDR'], CLIENT)

    def test_invalid_peer_never_promotes_forwarded_headers(self) -> None:
        for peer in ('unknown', '', 'fe80::1%eth0'):
            with self.subTest(peer=peer):
                self.assertEqual(self.request(CLIENT, peer=peer).META['REMOTE_ADDR'], peer)

    def test_duplicate_asgi_headers_cannot_hide_actual_caller(self) -> None:
        from django.core.handlers.asgi import ASGIRequest
        request = AsyncRequestFactory().get('/')
        scope = dict(request.scope)
        scope['client'] = (PEER, 12345)
        scope['headers'] = [(b'x-forwarded-for', CLIENT.encode()),
                            (b'x-forwarded-for', f'{EDGE}, {ATTACKER}'.encode())]
        request = ASGIRequest(scope, request._stream)
        self.middleware(request)
        self.assertEqual(request.META['REMOTE_ADDR'], ATTACKER)
        self.assertEqual(ScopedRateThrottle().get_ident(request), ATTACKER)

    def test_auth_and_report_throttles_use_remote_addr_only(self) -> None:
        self.assertEqual(api_settings.NUM_PROXIES, 0)
        for prefix in (CLIENT, EDGE, 'unknown'):
            request = self.request(f'{prefix}, {ATTACKER}')
            request.user = SimpleNamespace(is_authenticated=False)
            throttle = ScopedRateThrottle()
            throttle.scope = 'auth_login'
            key = throttle.get_cache_key(request, SimpleNamespace())
            self.assertEqual(key, f'throttle_auth_login_{ATTACKER}')
            self.assertEqual(ClientErrorReportIpRateThrottle().get_ident(request), ATTACKER)

    def test_authenticated_scoped_throttles_keep_the_user_bucket(self) -> None:
        request = self.request(f'{CLIENT}, {EDGE}')
        request.user = SimpleNamespace(is_authenticated=True, pk=42)
        throttle = ScopedRateThrottle()
        throttle.scope = 'auth_login'
        key = throttle.get_cache_key(request, SimpleNamespace())
        self.assertEqual(key, 'throttle_auth_login_42')

    @override_settings(THROTTLE_AUTH_REGISTER_SUCCESS_PER_IP='3/hour')
    def test_registration_buckets_separate_visitors_and_resist_prefix_rotation(self) -> None:
        for prefix in (CLIENT, EDGE, 'unknown'):
            record_registration_success(self.request(f'{prefix}, {ATTACKER}').META['REMOTE_ADDR'])
        self.assertTrue(registration_ip_limit_exceeded(ATTACKER))
        legitimate = self.request(f'{CLIENT}, {EDGE}')
        self.assertFalse(registration_ip_limit_exceeded(legitimate.META['REMOTE_ADDR']))
