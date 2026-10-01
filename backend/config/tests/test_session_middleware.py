from __future__ import annotations

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.sessions.backends.db import SessionStore
from rest_framework import status
from rest_framework.response import Response
from rest_framework.test import APIClient, APITestCase

User = get_user_model()

LOGIN_URL = '/openfarmplanner/api/auth/login/'
LOGOUT_URL = '/openfarmplanner/api/auth/logout/'
ME_URL = '/openfarmplanner/api/auth/me/'


class ConcurrentLoginSafeSessionMiddlewareTest(APITestCase):
    def setUp(self) -> None:
        self.password = 'safe-password-123'
        self.user = User.objects.create_user(
            username='session-race',
            email='session-race@example.com',
            password=self.password,
            is_active=True,
        )

    def _log_in(self) -> Response:
        return self.client.post(
            LOGIN_URL, {'email': self.user.email, 'password': self.password}, format='json',
        )

    def _start_anonymous_session(self) -> str:
        anonymous_session = SessionStore()
        anonymous_session['pending_invitation_token'] = 'token'
        anonymous_session.create()
        self.client.cookies[settings.SESSION_COOKIE_NAME] = anonymous_session.session_key
        return anonymous_session.session_key

    def test_late_request_with_the_pre_login_cookie_keeps_the_new_session_cookie(self) -> None:
        """An anonymous request sent before the login but handled after it must
        not delete the cookie: in the browser it would overwrite the new one."""
        anonymous_key = self._start_anonymous_session()
        login = self._log_in()
        self.assertEqual(login.status_code, status.HTTP_200_OK)
        self.assertNotEqual(self.client.cookies[settings.SESSION_COOKIE_NAME].value, anonymous_key)

        late_client = APIClient()
        late_client.cookies[settings.SESSION_COOKIE_NAME] = anonymous_key
        late_response = late_client.get(ME_URL)

        self.assertEqual(late_response.data, {'authenticated': False})
        self.assertNotIn(settings.SESSION_COOKIE_NAME, late_response.cookies)
        self.assertIn('Cookie', late_response['Vary'])
        self.assertTrue(self.client.get(ME_URL).data['authenticated'])

    def test_logout_still_deletes_the_session_cookie(self) -> None:
        self._log_in()

        logout = self.client.post(LOGOUT_URL, {}, format='json')

        self.assertEqual(logout.status_code, status.HTTP_200_OK)
        deleted_cookie = logout.cookies[settings.SESSION_COOKIE_NAME]
        self.assertEqual(deleted_cookie.value, '')
        self.assertEqual(deleted_cookie['max-age'], 0)

    def test_session_writes_still_set_the_cookie(self) -> None:
        login = self._log_in()

        session_cookie = login.cookies[settings.SESSION_COOKIE_NAME]
        self.assertTrue(session_cookie.value)
        self.assertTrue(session_cookie['httponly'])
