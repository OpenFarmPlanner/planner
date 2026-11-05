"""Resolve client IPs through explicitly trusted forwarding chains.

The immediate peer must be trusted before X-Forwarded-For is consulted.
Walk the chain right-to-left, stopping at the first untrusted address.
Single-value client-IP headers cannot authenticate upstream hops and are ignored.
DRF uses the resulting REMOTE_ADDR exclusively (NUM_PROXIES=0).
"""

from __future__ import annotations

import ipaddress
import zoneinfo
from collections.abc import Callable
from typing import TYPE_CHECKING

from django.conf import settings
from django.http import HttpResponsePermanentRedirect
from django.urls import Resolver404, resolve
from django.utils import timezone

if TYPE_CHECKING:
    from django.http import HttpRequest, HttpResponse


class CanonicalHostRedirectMiddleware:
    """Permanently redirects `CANONICAL_HOST_REDIRECTS` hosts (www.) to `CANONICAL_HOST`.

    The SPA's www redirect lives in the ops-rendered `.htaccess`, but backend
    prefixes proxied by `uberspace web backend` (/api, /admin, ...) bypass
    Apache entirely, so without this a www URL such as `/api/docs/` is served
    with 200 and can be indexed under the wrong host. Path and query string are
    preserved; GET/HEAD get a 301, other methods a 308 so the method and body
    survive. The raw Host header is read so a www host missing from
    ALLOWED_HOSTS is redirected rather than rejected with 400.
    """

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        redirect_hosts = settings.CANONICAL_HOST_REDIRECTS
        canonical_host = settings.CANONICAL_HOST
        if redirect_hosts and canonical_host and self._request_host(request) in redirect_hosts:
            scheme = settings.CANONICAL_HOST_SCHEME
            target = f'{scheme}://{canonical_host}{request.get_full_path()}'
            response = HttpResponsePermanentRedirect(target)
            if request.method not in ('GET', 'HEAD'):
                response.status_code = 308
            return response
        return self.get_response(request)

    @staticmethod
    def _request_host(request: HttpRequest) -> str:
        if settings.USE_X_FORWARDED_HOST and request.META.get('HTTP_X_FORWARDED_HOST'):
            raw_host = request.META['HTTP_X_FORWARDED_HOST'].split(',')[-1]
        else:
            raw_host = request.META.get('HTTP_HOST', '')
        host = raw_host.strip().lower()
        # Drop a port; bracketed IPv6 literals never match a configured host anyway.
        return host.rsplit(':', 1)[0] if host.count(':') == 1 else host


class AdminTimezoneMiddleware:
    """Displays Django admin times in `ADMIN_TIME_ZONE` instead of the UTC storage timezone.

    `TIME_ZONE` stays UTC so stored timestamps and API responses are
    unambiguous; Django's admin otherwise renders datetimes in that same
    storage timezone, which reads two hours off for anyone in Central
    European time.
    """

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response
        self._zone = zoneinfo.ZoneInfo(settings.ADMIN_TIME_ZONE)

    def __call__(self, request: HttpRequest) -> HttpResponse:
        if not self._is_admin_request(request):
            return self.get_response(request)

        timezone.activate(self._zone)
        try:
            return self.get_response(request)
        finally:
            timezone.deactivate()

    @staticmethod
    def _is_admin_request(request: HttpRequest) -> bool:
        try:
            match = resolve(request.path_info)
        except Resolver404:
            return False
        return match.app_name == 'admin'


class TrustedProxyRemoteAddrMiddleware:
    """Resolve one canonical client address for all downstream abuse controls."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        self._rewrite_remote_addr(request)
        return self.get_response(request)

    @staticmethod
    def _rewrite_remote_addr(request: HttpRequest) -> None:
        peer = _parse_ip(request.META.get('REMOTE_ADDR', ''))
        if peer is None:
            return
        request.META['REMOTE_ADDR'] = str(peer)
        immediate = settings.TRUSTED_PROXY_NETWORKS
        if not _is_trusted(peer, immediate):
            return

        trusted = [*immediate, *settings.TRUSTED_PROXY_UPSTREAM_NETWORKS]
        remaining = request.META.get('HTTP_X_FORWARDED_FOR', '')
        # Bound work without truncating a long prefix into an accepted identity.
        for _ in range(32):
            prefix, separator, value = remaining.rpartition(',')
            hop = _parse_ip(value)
            if hop is None:
                return
            if not _is_trusted(hop, trusted):
                request.META['REMOTE_ADDR'] = str(hop)
                return
            if not separator:
                return
            remaining = prefix
        # Missing, malformed, all-trusted or overlong suffixes keep the peer.


def _is_trusted(
    address: ipaddress.IPv4Address | ipaddress.IPv6Address,
    networks: list[ipaddress.IPv4Network | ipaddress.IPv6Network],
) -> bool:
    if any(address in network for network in networks):
        return True
    if isinstance(address, ipaddress.IPv4Address):
        mapped = ipaddress.IPv6Address(f'::ffff:{address}')
        return any(mapped in network for network in networks)
    return False


def _parse_ip(value: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    value = (value or '').strip()
    if not value or '%' in value:
        return None
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return None
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        return address.ipv4_mapped
    return address
