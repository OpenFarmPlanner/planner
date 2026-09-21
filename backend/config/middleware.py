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
from typing import TYPE_CHECKING, Callable

from django.conf import settings

if TYPE_CHECKING:
    from django.http import HttpRequest, HttpResponse


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
