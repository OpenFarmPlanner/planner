from types import SimpleNamespace

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import AccountTrustProfile
from accounts.trust import resolve_trust_level
from crops.models import CropSpecies
from farm.e2e_views import TEST_EMAIL_DOMAIN, E2EInvitationFixtureView, E2E_PUBLIC_CROP_VARIETY_PREFIXES
from farm.models import Crop, Project, PublicCrop

User = get_user_model()


class E2EInvitationFixtureViewResetTest(TestCase):
    def test_reset_removes_public_crops_created_by_the_scenario(self) -> None:
        scenario = 'public-crop-library-cleanup'
        admin = User.objects.create_user(
            username=f'{scenario}-admin',
            email=f'{scenario}-admin@e2e.local',
            password='Pass12345!',
            is_active=True,
        )
        project = Project.objects.create(name='E2E Project', slug=scenario)
        crop = Crop.objects.create(
            name='Ackerbohne',
            variety=f'{E2E_PUBLIC_CROP_VARIETY_PREFIXES[0]}123',
            project=project,
        )
        public_crop = PublicCrop.objects.create(
            name='Ackerbohne',
            variety=f'{E2E_PUBLIC_CROP_VARIETY_PREFIXES[0]}123',
            status=PublicCrop.STATUS_PUBLISHED,
            created_by=admin,
            source_project=project,
            source_project_crop=crop,
        )
        orphaned_fixture_crop = PublicCrop.objects.create(
            name='Ackerbohne',
            variety=f'{E2E_PUBLIC_CROP_VARIETY_PREFIXES[1]}123',
            status=PublicCrop.STATUS_PUBLISHED,
            created_by=admin,
        )
        unrelated = PublicCrop.objects.create(
            name='Ackerbohne',
            variety=f'{E2E_PUBLIC_CROP_VARIETY_PREFIXES[0]}manual',
            status=PublicCrop.STATUS_PUBLISHED,
        )

        E2EInvitationFixtureView()._reset(scenario)

        self.assertFalse(PublicCrop.objects.filter(pk=public_crop.pk).exists())
        self.assertFalse(PublicCrop.objects.filter(pk=orphaned_fixture_crop.pk).exists())
        self.assertTrue(PublicCrop.objects.filter(pk=unrelated.pk).exists())


class E2EFixtureUserTrustLevelTest(APITestCase):
    """Fixture users must reach the library's direct-publish path.

    They are created directly rather than through registration, so without an
    explicit grant they sit at the `new` trust level and every crop-library
    publish is queued for moderation instead of applying live
    (docs/account-trust-levels.md). The E2E specs read `public_crop` off the
    publish response, so that routing breaks them with a bare
    `TypeError: Cannot read properties of undefined (reading 'id')`.
    """

    def setUp(self) -> None:
        cache.clear()
        self.scenario = 'trust-level-fixture'
        self.view = E2EInvitationFixtureView()

    def _setup_scenario(self) -> dict:
        # `_setup` only reads `request.data`, so a stub keeps this focused on
        # the fixture behavior instead of DRF request plumbing.
        return self.view._setup(SimpleNamespace(data={}), self.scenario)

    def test_setup_grants_fixture_users_established_trust(self) -> None:
        self._setup_scenario()

        for role in ('admin', 'invitee', 'outsider'):
            user = User.objects.get(email=f'{self.scenario}-{role}@{TEST_EMAIL_DOMAIN}')
            self.assertEqual(
                resolve_trust_level(user),
                AccountTrustProfile.TRUST_ESTABLISHED,
                f'{role} fixture user should not be treated as a brand-new signup',
            )

    def test_empty_user_setup_grants_established_trust(self) -> None:
        self.view._setup_empty_user(self.scenario)

        user = User.objects.get(email=f'{self.scenario}-starter@{TEST_EMAIL_DOMAIN}')
        self.assertEqual(resolve_trust_level(user), AccountTrustProfile.TRUST_ESTABLISHED)

    def test_fixture_admin_publishes_to_the_library_directly(self) -> None:
        """The end-to-end shape the failing spec depends on: a publish by a
        fixture user returns the created `public_crop`, not a moderation
        queue receipt."""
        self._setup_scenario()
        admin = User.objects.get(email=f'{self.scenario}-admin@{TEST_EMAIL_DOMAIN}')
        project = Project.objects.get(slug=self.scenario)
        species = CropSpecies.objects.create(name='Testart')
        crop = Crop.objects.create(
            name='Ackerbohne',
            variety='Publish Direkt',
            project=project,
            crop_species=species,
            growth_duration_days=40,
            harvest_duration_days=14,
        )

        self.client.force_authenticate(user=admin)
        response = self.client.post(
            f'/openfarmplanner/api/crops/{crop.id}/publish-public/',
            {
                'accepted_public_library_terms': True,
                'crop_species_id': species.id,
                'original_language_code': 'de',
            },
            format='json',
            headers={'X-Project-Id': str(project.id)},
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        self.assertIn('public_crop', response.data)
        self.assertIsNotNone(response.data['public_crop']['id'])
