from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING

from rest_framework.throttling import SimpleRateThrottle

if TYPE_CHECKING:
    from rest_framework.request import Request
    from rest_framework.views import APIView


class EmailDomainRateThrottle(SimpleRateThrottle):
    """Throttles registration attempts by the submitted email's domain.

    Complements the IP-scoped `auth_register` throttle: an attacker rotating
    IPs but reusing one throwaway-domain family is still bounded.

    This runs as a global default throttle class, so it must opt in per view:
    only views setting `throttle_email_domain = True` are covered. Without
    that gate every endpoint taking an `email` in its body (login, password
    reset, resend activation) would share one domain-wide bucket, and all
    users behind a common domain would lock each other out.
    """

    scope = 'auth_register_domain'

    def get_cache_key(self, request: Request, view: APIView) -> str | None:
        from accounts.serializers import normalize_email_lower

        if not getattr(view, 'throttle_email_domain', False):
            return None

        # A non-dict body (a bare JSON list, say) must not raise here: this
        # throttle runs before the view's own validation, so an AttributeError
        # would turn a 400 into a 500.
        data = getattr(request, 'data', None)
        email = data.get('email') if isinstance(data, Mapping) else None
        if not email:
            return None
        try:
            domain = normalize_email_lower(str(email)).rsplit('@', 1)[-1]
        except (ValueError, TypeError):
            return None
        if not domain:
            return None
        return self.cache_format % {'scope': self.scope, 'ident': domain}


class TrustAwareWriteRateThrottle(SimpleRateThrottle):
    """Lowers the write-request rate for accounts still in the "new" trust level.

    Reads/safe methods, anonymous requests, and established accounts are
    never throttled by this class — it only narrows the ceiling for a freshly
    registered account's writes, per the account-trust-levels design
    (docs/account-trust-levels.md). Established accounts keep whatever other
    throttle scopes already apply to the endpoint they're calling.
    """

    scope = 'write_new_account'

    def allow_request(self, request: Request, view: APIView) -> bool:
        from accounts.models import AccountTrustProfile
        from accounts.trust import resolve_trust_level

        if request.method in ('GET', 'HEAD', 'OPTIONS'):
            return True
        user = getattr(request, 'user', None)
        if user is None or not user.is_authenticated:
            return True
        if resolve_trust_level(user) != AccountTrustProfile.TRUST_NEW:
            return True
        return super().allow_request(request, view)

    def get_cache_key(self, request: Request, view: APIView) -> str | None:
        user = getattr(request, 'user', None)
        if user is None or not user.is_authenticated:
            return None
        return self.cache_format % {'scope': self.scope, 'ident': user.pk}
