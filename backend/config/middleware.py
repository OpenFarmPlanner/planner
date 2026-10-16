"""Rewrites REMOTE_ADDR from a trusted reverse proxy's client-IP header.

A CDN/reverse proxy in front of the app (Cloudflare being the motivating
case) terminates the client's TCP connection itself, so the origin only ever
sees the proxy's own edge IP as REMOTE_ADDR. Several IP-keyed abuse checks
read REMOTE_ADDR directly rather than a forwarded-for header — the
per-IP registration cap in `accounts.views.RegisterView`, and DRF's default
`SimpleRateThrottle.get_ident` for every IP-scoped throttle (auth_login,
auth_register, ...). Without this rewrite, fronting the app with such a
proxy would make every one of those checks key on the proxy's IP instead of
the real client, either merging all visitors into one throttle bucket or
disabling the check outright.

Trust is anchored on the network layer, not the header: the header is only
honoured when the *immediate* TCP peer (the untouched REMOTE_ADDR) is itself
inside `TRUSTED_PROXY_NETWORKS`. Otherwise any client could set the header
directly on a request straight to the origin and claim an arbitrary IP,
which would let it evade every IP-based check downstream rather than merely
identify itself correctly through a real proxy.

`TRUSTED_PROXY_NETWORKS` is empty by default (not yet behind such a proxy),
which makes this a no-op. See docs/agent-api.md's rate-limiting section and
the deploy runbook in the `ops` repo for how to populate it.
"""

from __future__ import annotations

import ipaddress
import zoneinfo
from typing import TYPE_CHECKING, Callable

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
    """Replaces REMOTE_ADDR with the real client IP reported by a trusted proxy."""

    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        self._rewrite_remote_addr(request)
        return self.get_response(request)

    @staticmethod
    def _rewrite_remote_addr(request: HttpRequest) -> None:
        networks = settings.TRUSTED_PROXY_NETWORKS
        if not networks:
            return

        peer_ip = _parse_ip(request.META.get('REMOTE_ADDR', ''))
        if peer_ip is None or not any(peer_ip in network for network in networks):
            return

        client_ip = _parse_ip(request.META.get(settings.TRUSTED_PROXY_IP_HEADER, ''))
        if client_ip is None:
            return

        request.META['REMOTE_ADDR'] = str(client_ip)


def _parse_ip(value: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    value = (value or '').strip()
    if not value:
        return None
    try:
        return ipaddress.ip_address(value)
    except ValueError:
        return None
