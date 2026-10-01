"""Session middleware that never lets a stale request log out a newer login.

Django's `SessionMiddleware` deletes the session cookie on any response whose
request carried a session cookie but ended with an empty session. That is
right for a logout, which flushes the session in the same request. It is
wrong for a request that merely arrived with an old cookie whose session no
longer exists: logging in rotates the session key and deletes the old
session, so an anonymous request sent just before the login but handled
after it finds nothing, and its response deletes the cookie. When that
response reaches the browser after the login response, it deletes the *new*
session cookie and silently signs the user out (observed in e2e as every
request after an invitation acceptance failing with 403).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from django.conf import settings
from django.contrib.sessions.middleware import SessionMiddleware
from django.utils.cache import patch_vary_headers

if TYPE_CHECKING:
    from django.http import HttpRequest, HttpResponse


class ConcurrentLoginSafeSessionMiddleware(SessionMiddleware):
    """`SessionMiddleware` that keeps the cookie when its session simply vanished."""

    def process_response(self, request: HttpRequest, response: HttpResponse) -> HttpResponse:
        if self._carries_vanished_session(request):
            # Leave the browser's cookie alone: it may already belong to a
            # newer session. A stale key is harmless; it is ignored on the
            # next request and replaced as soon as a session is written.
            patch_vary_headers(response, ('Cookie',))
            return response
        return super().process_response(request, response)

    @staticmethod
    def _carries_vanished_session(request: HttpRequest) -> bool:
        session = getattr(request, 'session', None)
        if session is None or settings.SESSION_COOKIE_NAME not in request.COOKIES:
            return False
        # A logout (`flush()`) marks the session modified; only an untouched
        # session that came back empty means its key no longer exists.
        return session.accessed and not session.modified and session.is_empty()
