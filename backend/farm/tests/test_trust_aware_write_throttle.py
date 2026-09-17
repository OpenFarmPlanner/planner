"""Focused test for accounts.throttling.TrustAwareWriteRateThrottle.

DRF scoped throttling is disabled in test settings (config/settings_test.py)
by default, so this test re-enables exactly the throttle class it exercises,
following the pattern in accounts/tests/test_guest_demo.py.
"""

from __future__ import annotations

from unittest.mock import patch

from django.core.cache import cache
from django.utils import timezone

from accounts.throttling import TrustAwareWriteRateThrottle
from farm.crops.views.crops import CropViewSet
from farm.models import Crop
from farm.tests.api_base import ProjectApiTestCase


class TrustAwareWriteRateThrottleTests(ProjectApiTestCase):
    def setUp(self) -> None:
        super().setUp()
        cache.clear()

    def _enable_throttle(self, rate: str):
        rates = {'write_new_account': rate}
        return (
            patch.object(TrustAwareWriteRateThrottle, 'THROTTLE_RATES', rates),
            patch.object(CropViewSet, 'throttle_classes', [TrustAwareWriteRateThrottle]),
        )

    def test_new_account_is_throttled_after_limit(self) -> None:
        patches = self._enable_throttle('1/hour')
        with patches[0], patches[1]:
            first = self.client.post(
                '/api/crops/', {'name': 'Radish'}, format='json',
            )
            self.assertEqual(first.status_code, 201)

            second = self.client.post(
                '/api/crops/', {'name': 'Spinach'}, format='json',
            )
            self.assertEqual(second.status_code, 429)

    def test_established_account_is_not_throttled(self) -> None:
        self.user.date_joined = timezone.now() - timezone.timedelta(days=30)
        self.user.save(update_fields=['date_joined'])
        for index in range(3):
            Crop.objects.create(project=self.project, name=f'Established crop {index}')

        patches = self._enable_throttle('1/hour')
        with patches[0], patches[1]:
            first = self.client.post('/api/crops/', {'name': 'Radish'}, format='json')
            self.assertEqual(first.status_code, 201)

            second = self.client.post('/api/crops/', {'name': 'Spinach'}, format='json')
            self.assertEqual(second.status_code, 201)

    def test_reads_are_never_throttled(self) -> None:
        patches = self._enable_throttle('1/hour')
        with patches[0], patches[1]:
            self.client.post('/api/crops/', {'name': 'Radish'}, format='json')

            first_read = self.client.get('/api/crops/')
            second_read = self.client.get('/api/crops/')
            self.assertEqual(first_read.status_code, 200)
            self.assertEqual(second_read.status_code, 200)
