from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone

from accounts.models import AccountTrustProfile
from accounts.trust import resolve_trust_level
from farm.models import Crop, PlantingPlan, Project, ProjectMembership

User = get_user_model()


class TrustLevelTests(TestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(username='grower', email='grower@example.com', is_active=True)

    def _make_membership(self) -> Project:
        project = Project.objects.create(name='Test farm', slug='test-farm')
        ProjectMembership.objects.create(user=self.user, project=project, role=ProjectMembership.ROLE_ADMIN)
        return project

    def test_new_account_defaults_to_new_trust_level(self) -> None:
        self.assertEqual(resolve_trust_level(self.user), AccountTrustProfile.TRUST_NEW)
        profile = AccountTrustProfile.objects.get(user=self.user)
        self.assertIsNone(profile.established_at)

    def test_account_age_alone_does_not_promote(self) -> None:
        self.user.date_joined = timezone.now() - timedelta(days=30)
        self.user.save(update_fields=['date_joined'])
        self._make_membership()

        self.assertEqual(resolve_trust_level(self.user), AccountTrustProfile.TRUST_NEW)

    def test_activity_alone_does_not_promote_a_fresh_account(self) -> None:
        project = self._make_membership()
        for index in range(3):
            Crop.objects.create(project=project, name=f'Crop {index}')

        self.assertEqual(resolve_trust_level(self.user), AccountTrustProfile.TRUST_NEW)

    def test_age_and_activity_together_promote_to_established(self) -> None:
        self.user.date_joined = timezone.now() - timedelta(days=30)
        self.user.save(update_fields=['date_joined'])
        project = self._make_membership()
        Crop.objects.create(project=project, name='Tomato')
        Crop.objects.create(project=project, name='Carrot')
        crop = Crop.objects.create(project=project, name='Lettuce')
        PlantingPlan.objects.create(project=project, crop=crop)

        self.assertEqual(resolve_trust_level(self.user), AccountTrustProfile.TRUST_ESTABLISHED)
        profile = AccountTrustProfile.objects.get(user=self.user)
        self.assertIsNotNone(profile.established_at)

    def test_soft_deleted_crops_do_not_count_toward_activity(self) -> None:
        self.user.date_joined = timezone.now() - timedelta(days=30)
        self.user.save(update_fields=['date_joined'])
        project = self._make_membership()
        for index in range(3):
            Crop.objects.create(project=project, name=f'Crop {index}', deleted_at=timezone.now())

        self.assertEqual(resolve_trust_level(self.user), AccountTrustProfile.TRUST_NEW)

    def test_resolution_is_idempotent_once_established(self) -> None:
        self.user.date_joined = timezone.now() - timedelta(days=30)
        self.user.save(update_fields=['date_joined'])
        project = self._make_membership()
        for index in range(3):
            Crop.objects.create(project=project, name=f'Crop {index}')

        first = resolve_trust_level(self.user)
        established_at = AccountTrustProfile.objects.get(user=self.user).established_at
        second = resolve_trust_level(self.user)

        self.assertEqual(first, AccountTrustProfile.TRUST_ESTABLISHED)
        self.assertEqual(second, AccountTrustProfile.TRUST_ESTABLISHED)
        self.assertEqual(AccountTrustProfile.objects.get(user=self.user).established_at, established_at)
