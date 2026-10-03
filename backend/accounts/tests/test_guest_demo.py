from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import timedelta
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

from accounts.guest_demo import create_guest_demo_session
from accounts.models import GuestDemoSession, GuestDemoUsageDay
from accounts.views import GuestDemoStartView, LoginView
from farm.models import Crop, Project, ProjectInvitation
from farm.services.demo_project import DEMO_PROJECT_NAME_EN

User = get_user_model()


def throttled_rest_framework_settings(
    *,
    auth_login: str,
    guest_demo_start: str,
) -> dict[str, object]:
    """Build DRF settings for scoped-throttle tests without dropping pagination."""
    return {
        **settings.REST_FRAMEWORK,
        'DEFAULT_PERMISSION_CLASSES': [
            'rest_framework.permissions.AllowAny',
        ],
        'DEFAULT_THROTTLE_CLASSES': [
            'rest_framework.throttling.ScopedRateThrottle',
        ],
        'DEFAULT_THROTTLE_RATES': {
            **settings.REST_FRAMEWORK['DEFAULT_THROTTLE_RATES'],
            'auth_login': auth_login,
            'guest_demo_start': guest_demo_start,
        },
        'EXCEPTION_HANDLER': 'config.exceptions.api_exception_handler',
    }


@contextmanager
def enabled_scoped_throttling() -> Iterator[None]:
    """Temporarily restore DRF scoped throttling disabled by test settings."""
    rates = settings.REST_FRAMEWORK['DEFAULT_THROTTLE_RATES']
    with (
        patch.object(ScopedRateThrottle, 'THROTTLE_RATES', rates),
        patch.object(GuestDemoStartView, 'throttle_classes', [ScopedRateThrottle]),
        patch.object(LoginView, 'throttle_classes', [ScopedRateThrottle]),
    ):
        yield


class GuestDemoApiTests(TestCase):
    def setUp(self) -> None:
        cache.clear()
        self.client = APIClient()

    def test_start_creates_an_isolated_authenticated_demo(self) -> None:
        response = self.client.post(
            '/openfarmplanner/api/auth/guest-demo/start/',
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data['is_guest_demo'])
        self.assertIsNotNone(response.data['guest_demo_session_id'])
        self.assertTrue(response.data['memberships'][0]['is_demo_project'])
        project = Project.objects.get(id=response.data['resolved_project_id'])
        self.assertEqual(project.name, 'Solawi Sonnenacker')
        self.assertGreater(Crop.objects.filter(project=project).count(), 0)
        self.assertEqual(response.data['pending_consents'], [])

    def test_start_uses_request_language_for_demo_content(self) -> None:
        response = self.client.post(
            '/openfarmplanner/api/auth/guest-demo/start/',
            {},
            format='json',
            HTTP_ACCEPT_LANGUAGE='en-US,en;q=0.9',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        project = Project.objects.get(id=response.data['resolved_project_id'])
        self.assertEqual(project.name, DEMO_PROJECT_NAME_EN)
        self.assertTrue(Crop.objects.filter(project=project, name='Carrot').exists())
        self.assertFalse(Crop.objects.filter(project=project, name='Karotte').exists())
        self.assertEqual(response.data['memberships'][0]['project_name'], DEMO_PROJECT_NAME_EN)
        self.assertTrue(response.data['memberships'][0]['is_demo_project'])
        self.assertEqual(response.data['ui_language'], 'en')

    def test_each_start_receives_its_own_workspace(self) -> None:
        first = self.client.post(
            '/openfarmplanner/api/auth/guest-demo/start/',
            {},
            format='json',
        )
        second_client = APIClient()
        second = second_client.post(
            '/openfarmplanner/api/auth/guest-demo/start/',
            {},
            format='json',
        )

        self.assertNotEqual(first.data['resolved_project_id'], second.data['resolved_project_id'])

    def test_restarting_guest_demo_deletes_previous_workspace(self) -> None:
        first = self.client.post(
            '/openfarmplanner/api/auth/guest-demo/start/',
            {},
            format='json',
        )
        first_project_id = first.data['resolved_project_id']

        second = self.client.post(
            '/openfarmplanner/api/auth/guest-demo/start/',
            {},
            format='json',
        )

        self.assertEqual(second.status_code, status.HTTP_201_CREATED)
        self.assertNotEqual(first_project_id, second.data['resolved_project_id'])
        self.assertFalse(Project.objects.filter(id=first_project_id).exists())

    def test_end_deletes_current_guest_workspace(self) -> None:
        started = self.client.post(
            '/openfarmplanner/api/auth/guest-demo/start/',
            {},
            format='json',
        )
        project_id = started.data['resolved_project_id']

        response = self.client.post('/openfarmplanner/api/auth/guest-demo/end/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Project.objects.filter(id=project_id).exists())

    def test_end_deletes_guest_workspace_when_session_marker_is_missing(self) -> None:
        started = self.client.post(
            '/openfarmplanner/api/auth/guest-demo/start/',
            {},
            format='json',
        )
        project_id = started.data['resolved_project_id']
        session = self.client.session
        del session['guest_demo_session_id']
        session.save()

        response = self.client.post('/openfarmplanner/api/auth/guest-demo/end/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Project.objects.filter(id=project_id).exists())

    def test_expired_guest_demo_still_cannot_create_additional_projects_before_cleanup(self) -> None:
        started = self.client.post(
            '/openfarmplanner/api/auth/guest-demo/start/',
            {},
            format='json',
        )
        demo_session = GuestDemoSession.objects.get(id=started.data['guest_demo_session_id'])
        demo_session.expires_at = timezone.now() - timedelta(minutes=1)
        demo_session.save(update_fields=['expires_at'])

        response = self.client.post(
            '/openfarmplanner/api/projects/',
            {'name': 'Expired guest project'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['code'], 'guest_demo_restricted')
        self.assertFalse(Project.objects.filter(name='Expired guest project').exists())

    def test_guest_demo_cannot_create_additional_projects(self) -> None:
        self.client.post(
            '/openfarmplanner/api/auth/guest-demo/start/',
            {},
            format='json',
        )

        response = self.client.post(
            '/openfarmplanner/api/projects/',
            {'name': 'Extra demo project'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['code'], 'guest_demo_restricted')
        self.assertFalse(Project.objects.filter(name='Extra demo project').exists())

    def test_guest_demo_cannot_send_project_invitations(self) -> None:
        started = self.client.post(
            '/openfarmplanner/api/auth/guest-demo/start/',
            {},
            format='json',
        )

        response = self.client.post(
            f"/openfarmplanner/api/projects/{started.data['resolved_project_id']}/invitations/",
            {'email': 'invitee@example.com', 'role': 'member'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['code'], 'guest_demo_restricted')
        self.assertFalse(ProjectInvitation.objects.filter(email_normalized='invitee@example.com').exists())

    def test_guest_demo_cannot_request_account_email_change(self) -> None:
        self.client.post(
            '/openfarmplanner/api/auth/guest-demo/start/',
            {},
            format='json',
        )

        response = self.client.post(
            '/openfarmplanner/api/auth/account/change-email/',
            {'new_email': 'guest@example.com', 'current_password': ''},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['code'], 'guest_demo_restricted')

    def test_expired_session_is_removed_by_cleanup_command(self) -> None:
        demo_session = create_guest_demo_session()
        demo_session.expires_at = timezone.now() - timedelta(seconds=1)
        demo_session.save(update_fields=['expires_at'])

        from django.core.management import call_command

        call_command('cleanup_guest_demo_sessions')
        self.assertFalse(GuestDemoSession.objects.filter(id=demo_session.id).exists())

    def test_start_books_an_anonymous_daily_usage_counter(self) -> None:
        self.client.post('/openfarmplanner/api/auth/guest-demo/start/', {}, format='json')
        self.client.post('/openfarmplanner/api/auth/guest-demo/start/', {}, format='json')

        usage_day = GuestDemoUsageDay.objects.get(date=timezone.localdate())
        self.assertEqual(usage_day.started, 2)
        self.assertEqual(usage_day.used, 0)

    def test_a_guest_change_is_booked_as_used_when_the_session_ends(self) -> None:
        """The counter must survive the guest's deletion: the revisions that
        show the guest edited something are deleted with the project."""
        start_response = self.client.post(
            '/openfarmplanner/api/auth/guest-demo/start/', {}, format='json',
        )
        self.client.defaults['HTTP_X_PROJECT_ID'] = str(start_response.data['resolved_project_id'])
        create_response = self.client.post(
            '/openfarmplanner/api/locations/', {'name': 'Gast-Standort'}, format='json',
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)

        self.client.post('/openfarmplanner/api/auth/guest-demo/end/', {}, format='json')

        self.assertFalse(GuestDemoSession.objects.exists())
        usage_day = GuestDemoUsageDay.objects.get(date=timezone.localdate())
        self.assertEqual(usage_day.started, 1)
        self.assertEqual(usage_day.used, 1)

    def test_an_untouched_guest_demo_is_not_booked_as_used_on_cleanup(self) -> None:
        """Seeding records crop revisions of its own; those must not count."""
        demo_session = create_guest_demo_session()
        GuestDemoSession.objects.filter(pk=demo_session.pk).update(
            expires_at=timezone.now() - timedelta(seconds=1),
        )

        from django.core.management import call_command

        call_command('cleanup_guest_demo_sessions')
        usage_day = GuestDemoUsageDay.objects.get(date=timezone.localdate())
        self.assertEqual(usage_day.started, 1)
        self.assertEqual(usage_day.used, 0)

    @override_settings(
        REST_FRAMEWORK=throttled_rest_framework_settings(
            auth_login='10/minute',
            guest_demo_start='1/minute',
        ),
    )
    def test_restrictive_guest_demo_throttle_limits_repeated_starts(self) -> None:
        with enabled_scoped_throttling():
            first_client = APIClient(REMOTE_ADDR='203.0.113.10')
            second_client = APIClient(REMOTE_ADDR='203.0.113.10')
            first = first_client.post(
                '/openfarmplanner/api/auth/guest-demo/start/',
                {},
                format='json',
            )
            second = second_client.post(
                '/openfarmplanner/api/auth/guest-demo/start/',
                {},
                format='json',
            )

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertIn('Retry-After', second.headers)
        self.assertGreaterEqual(int(second.headers['Retry-After']), 1)
        self.assertGreaterEqual(second.data['retry_after'], 1)

    @override_settings(
        REST_FRAMEWORK=throttled_rest_framework_settings(
            auth_login='10/minute',
            guest_demo_start='1/minute',
        ),
    )
    def test_guest_demo_throttle_is_scoped_by_client_ip(self) -> None:
        with enabled_scoped_throttling():
            first = APIClient(REMOTE_ADDR='203.0.113.20').post(
                '/openfarmplanner/api/auth/guest-demo/start/',
                {},
                format='json',
            )
            second = APIClient(REMOTE_ADDR='203.0.113.21').post(
                '/openfarmplanner/api/auth/guest-demo/start/',
                {},
                format='json',
            )

        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second.status_code, status.HTTP_201_CREATED)

    @override_settings(
        REST_FRAMEWORK=throttled_rest_framework_settings(
            auth_login='1/minute',
            guest_demo_start='1000/minute',
        ),
    )
    def test_development_guest_demo_throttle_allows_repeated_starts(self) -> None:
        with enabled_scoped_throttling():
            responses = [
                APIClient(REMOTE_ADDR='203.0.113.11').post(
                    '/openfarmplanner/api/auth/guest-demo/start/',
                    {},
                    format='json',
                )
                for _ in range(3)
            ]

        self.assertTrue(
            all(response.status_code == status.HTTP_201_CREATED for response in responses)
        )

    @override_settings(
        REST_FRAMEWORK=throttled_rest_framework_settings(
            auth_login='1/minute',
            guest_demo_start='1000/minute',
        ),
    )
    def test_guest_demo_throttle_does_not_change_other_scopes(self) -> None:
        with enabled_scoped_throttling():
            first = APIClient(REMOTE_ADDR='203.0.113.12').post(
                '/openfarmplanner/api/auth/login/',
                {},
                format='json',
            )
            second = APIClient(REMOTE_ADDR='203.0.113.12').post(
                '/openfarmplanner/api/auth/login/',
                {},
                format='json',
            )

        self.assertNotEqual(first.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(second.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
