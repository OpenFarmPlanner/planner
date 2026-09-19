"""Focused tests for farm.agent_api.throttling's per-token read/write throttles.

DRF scoped throttling is disabled in test settings (config/settings_test.py)
by default, so each test re-enables exactly the throttle class it exercises,
following the pattern in accounts/tests/test_guest_demo.py and
farm/tests/test_trust_aware_write_throttle.py.
"""

from __future__ import annotations

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APIClient, APITestCase

from farm.agent_api.permissions import DECLARED_AGENT_CLIENT_TYPE, DECLARED_CLIENT_TYPE_HEADER
from farm.agent_api.throttling import (
    ApiTokenReadRateThrottle,
    ApiTokenWriteDeclaredAgentRateThrottle,
    ApiTokenWriteRateThrottle,
)
from farm.crops.views.crops import CropViewSet
from farm.models import Crop, Project, ProjectApiToken, ProjectMembership

User = get_user_model()

ALL_TOKEN_THROTTLES = [
    ApiTokenReadRateThrottle,
    ApiTokenWriteRateThrottle,
    ApiTokenWriteDeclaredAgentRateThrottle,
]


def _rates(
    *, read: str = '1000/hour', write: str = '1000/hour', declared_agent: str = '1000/hour',
) -> dict:
    return {
        'api_token_read': read,
        'api_token_write': write,
        'api_token_write_declared_agent': declared_agent,
    }


class ApiTokenRateThrottleTests(APITestCase):
    def setUp(self) -> None:
        cache.clear()
        self.user = User.objects.create_user(
            username='agent-owner', email='owner@example.com', password='pw', is_active=True,
        )
        self.project = Project.objects.create(name='Home Farm', slug='home-farm')
        ProjectMembership.objects.create(user=self.user, project=self.project, role='admin')
        self.crop = Crop.objects.create(name='Brokkoli', project=self.project)

    def _issue_token(self, scope: str = ProjectApiToken.SCOPE_WRITE) -> str:
        _token, raw_token = ProjectApiToken.create_token(
            user=self.user, project=self.project, name='Test token', scope=scope,
        )
        return raw_token

    def _bearer_client(self, raw_token: str) -> APIClient:
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Bearer {raw_token}')
        return client

    def _enable_throttles(self, rates: dict):
        return (
            patch.object(ApiTokenReadRateThrottle, 'THROTTLE_RATES', rates),
            patch.object(ApiTokenWriteRateThrottle, 'THROTTLE_RATES', rates),
            patch.object(ApiTokenWriteDeclaredAgentRateThrottle, 'THROTTLE_RATES', rates),
            patch.object(CropViewSet, 'throttle_classes', ALL_TOKEN_THROTTLES),
        )

    def test_write_token_is_throttled_after_limit(self) -> None:
        raw_token = self._issue_token(scope=ProjectApiToken.SCOPE_WRITE)
        client = self._bearer_client(raw_token)
        patches = self._enable_throttles(_rates(write='1/hour'))
        with patches[0], patches[1], patches[2], patches[3]:
            first = client.post('/api/crops/', {'name': 'Erste'}, format='json')
            self.assertEqual(first.status_code, 201)

            second = client.post('/api/crops/', {'name': 'Zweite'}, format='json')
            self.assertEqual(second.status_code, 429)

    def test_declared_agent_write_uses_its_own_ceiling(self) -> None:
        raw_token = self._issue_token(scope=ProjectApiToken.SCOPE_WRITE)
        client = self._bearer_client(raw_token)
        client.credentials(
            HTTP_AUTHORIZATION=f'Bearer {raw_token}',
            **{DECLARED_CLIENT_TYPE_HEADER: DECLARED_AGENT_CLIENT_TYPE},
        )
        patches = self._enable_throttles(_rates(write='0/hour', declared_agent='1/hour'))
        with patches[0], patches[1], patches[2], patches[3]:
            response = client.post('/api/crops/', {'name': 'Agent crop'}, format='json')
            self.assertEqual(response.status_code, 201)

    def test_read_requests_do_not_consume_write_budget(self) -> None:
        raw_token = self._issue_token(scope=ProjectApiToken.SCOPE_WRITE)
        client = self._bearer_client(raw_token)
        patches = self._enable_throttles(_rates(read='1/hour'))
        with patches[0], patches[1], patches[2], patches[3]:
            first_read = client.get('/api/crops/')
            self.assertEqual(first_read.status_code, 200)

            write_response = client.post('/api/crops/', {'name': 'Unthrottled'}, format='json')
            self.assertEqual(write_response.status_code, 201)

            second_read = client.get('/api/crops/')
            self.assertEqual(second_read.status_code, 429)

    def test_session_authenticated_requests_are_never_throttled_by_token_throttles(self) -> None:
        self.client.force_authenticate(user=self.user)
        self.client.defaults['HTTP_X_PROJECT_ID'] = str(self.project.id)
        patches = self._enable_throttles(
            _rates(read='0/hour', write='0/hour', declared_agent='0/hour'),
        )
        with patches[0], patches[1], patches[2], patches[3]:
            response = self.client.post('/api/crops/', {'name': 'Session crop'}, format='json')
            self.assertEqual(response.status_code, 201)
