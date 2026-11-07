from collections import Counter
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITestCase

from accounts.models import AccountTrustProfile
from accounts.trust import resolve_trust_level
from crops.models import CropSpecies
from farm.e2e_cross_browser_data import CROSS_BROWSER_PROJECT_NAME
from farm.e2e_views import (
    DATASET_CROSS_BROWSER,
    DATASET_DEMO,
    TEST_EMAIL_DOMAIN,
    E2EInvitationFixtureView,
    E2E_PUBLIC_CROP_VARIETY_PREFIXES,
)
from farm.models import Crop, CropCompanion, PlantingPlan, Project, PublicCrop, Season
from farm.services.crop_rotation import (
    STATUS_ACCEPTED,
    STATUS_CONFLICT,
    STATUS_HINT,
    STATUS_INFO,
    STATUS_OK,
    RotationService,
)

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

    def test_demo_setup_seeds_the_requested_demo_year(self) -> None:
        self.view._setup(SimpleNamespace(data={'demo_year': 2026}), self.scenario, dataset=DATASET_DEMO)

        project = Project.objects.get(slug=self.scenario)
        self.assertEqual(
            sorted(Season.objects.filter(project=project).values_list('start_date__year', flat=True)),
            [2023, 2024, 2025, 2026],
        )

    def test_demo_setup_rejects_a_non_numeric_demo_year(self) -> None:
        with self.assertRaises(ValidationError):
            self.view._setup(SimpleNamespace(data={'demo_year': 'soon'}), self.scenario, dataset=DATASET_DEMO)

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


class E2ECrossBrowserDatasetTest(TestCase):
    """The cross-browser screenshot suite's own data (farm/e2e_cross_browser_data.py).

    The names, dates and counts pinned here are the ones the specs in
    frontend/e2e-cross-browser/ assert and the baselines show.
    """

    scenario = 'cross-browser-dataset'

    def _setup(self) -> Project:
        E2EInvitationFixtureView()._setup(
            SimpleNamespace(data={}), self.scenario, dataset=DATASET_CROSS_BROWSER,
        )
        return Project.objects.get(slug=self.scenario)

    def test_setup_does_not_use_the_demo_seeding(self) -> None:
        with patch('farm.e2e_views.populate_demo_project') as populate_demo:
            project = self._setup()

        populate_demo.assert_not_called()
        self.assertEqual(project.name, CROSS_BROWSER_PROJECT_NAME)

    def test_setup_seeds_the_crops_and_seasons_the_specs_expect(self) -> None:
        project = self._setup()

        crops = Crop.objects.filter(project=project)
        kulturen = crops.filter(variety='').values_list('name', flat=True)
        self.assertEqual(sorted(kulturen), [
            'Buschbohne', 'Gurke', 'Karotte', 'Kartoffel',
            'Phacelia', 'Salat', 'Tomate', 'Zucchini',
        ])
        tomato_varieties = crops.filter(name='Tomate').exclude(variety='')
        self.assertEqual(list(tomato_varieties.values_list('variety', flat=True)), ['Roma'])
        seasons = Season.objects.filter(project=project)
        self.assertEqual(sorted(seasons.values_list('start_date__year', flat=True)), [2025, 2026])
        plans = PlantingPlan.objects.filter(project=project, season__start_date__year=2026)
        self.assertEqual(plans.count(), 12)
        may_tenth = plans.filter(planting_date=date(2026, 5, 10)).select_related('crop')
        self.assertEqual(
            [(plan.crop.name, plan.crop.variety) for plan in may_tenth], [('Gurke', 'Arola')],
        )

    def test_kultur_tomate_fills_the_screenshotted_form_sections(self) -> None:
        project = self._setup()

        tomato = Crop.objects.get(project=project, name='Tomate', variety='')
        self.assertEqual(tomato.tags, ['Fruchtgemüse'])
        self.assertEqual(tomato.crop_family_id, 'Solanaceae')
        self.assertEqual((tomato.sowing_depth_m, tomato.sowing_depth_max_m), (0.005, 0.005))
        self.assertEqual(tomato.seed_rate_pre_cultivation_unit, 'seeds_per_plant')
        self.assertIsNotNone(tomato.crop_species_id)
        neighbours = CropCompanion.objects.filter(project=project)
        self.assertEqual(sorted(neighbours.values_list('kind', flat=True)), ['bad', 'good'])

    def test_current_season_shows_every_rotation_status_and_starts_with_a_conflict(self) -> None:
        project = self._setup()

        service = RotationService(project.id, language_code='de')
        plans = list(
            PlantingPlan.objects.filter(project=project, planting_date__year=2026)
            .select_related('crop', 'bed').order_by('planting_date'),
        )
        statuses = Counter(service.check_plan(plan).status for plan in plans)
        self.assertEqual(
            set(statuses), {STATUS_OK, STATUS_CONFLICT, STATUS_ACCEPTED, STATUS_HINT, STATUS_INFO},
        )
        # The area-assignment dialog screenshot opens the first grid row.
        self.assertEqual(service.check_plan(plans[0]).status, STATUS_CONFLICT)

    def test_data_does_not_depend_on_the_server_date(self) -> None:
        def snapshot() -> list[tuple[str, str, str]]:
            project = self._setup()
            return list(
                PlantingPlan.objects.filter(project=project)
                .order_by('planting_date', 'bed__name')
                .values_list('crop__name', 'bed__name', 'planting_date'),
            )

        today = snapshot()
        with patch('django.utils.timezone.now', return_value=timezone.now().replace(year=2031)):
            later = snapshot()
        self.assertEqual(today, later)
