from __future__ import annotations

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import RequestFactory, TestCase

from accounts.models import UserProjectSettings
from farm.models import Bed, BedLayout, Crop, FieldLayout, Location, PlantingPlan, Project, ProjectMembership, PublicCrop, Season, Supplier
from config.languages import resolve_request_language
from farm.services.demo_project import (
    DEMO_PROJECT_DESCRIPTION,
    DEMO_PROJECT_NAME,
    DEMO_PROJECT_NAME_EN,
    DEMO_PROJECT_SLUG,
    create_or_reset_demo_project,
    create_personal_demo_project,
    resolve_demo_request_language,
)

User = get_user_model()


class DemoProjectServiceTests(TestCase):
    def test_create_or_reset_demo_project_replaces_project_data(self) -> None:
        result = create_or_reset_demo_project()

        self.assertEqual(result.project.slug, DEMO_PROJECT_SLUG)
        self.assertTrue(ProjectMembership.objects.filter(user=result.user, project=result.project, role='admin').exists())
        self.assertEqual(Location.objects.filter(project=result.project).count(), 2)
        self.assertEqual(Bed.objects.filter(project=result.project).count(), 12)
        self.assertEqual(Crop.objects.filter(project=result.project).count(), 20)
        self.assertEqual(PlantingPlan.objects.filter(project=result.project).count(), 17)
        self.assertEqual(Supplier.objects.filter(project=result.project).count(), 3)
        self.assertEqual(FieldLayout.objects.filter(project=result.project).count(), 4)
        self.assertEqual(BedLayout.objects.filter(project=result.project).count(), 12)
        self.assertEqual(Crop.objects.filter(project=result.project, crop_species__isnull=False).count(), 20)
        self.assertTrue(Crop.objects.filter(project=result.project, name='Tomate', variety='').exists())
        self.assertTrue(Crop.objects.filter(project=result.project, name='Tomate', variety='Moneymaker', harvest_duration_days=65).exists())
        self.assertTrue(Crop.objects.filter(project=result.project, name='Tomate', variety='San Marzano', row_spacing_m=0.90).exists())
        self.assertTrue(Crop.objects.filter(project=result.project, name='Gurke', variety='').exists())
        self.assertTrue(Crop.objects.filter(project=result.project, name='Gurke', variety='Arola', cultivation_types=['pre_cultivation']).exists())
        self.assertTrue(Crop.objects.filter(project=result.project, name='Salat', variety='', thousand_kernel_weight_g__isnull=True).exists())
        self.assertTrue(Crop.objects.filter(project=result.project, name='Salat', variety='Lollo Bionda', thousand_kernel_weight_g=1.10).exists())
        self.assertTrue(Crop.objects.filter(project=result.project, name='Salat', variety='Maikönig', thousand_kernel_weight_g__isnull=True).exists())
        self.assertTrue(
            Crop.objects.filter(
                project=result.project,
                name='Karotte',
                selected_seed_demand_supplier__isnull=False,
                supplier_data__packaging_sizes__0__size_unit='g',
            ).exists()
        )

        Location.objects.create(name='Temporary Location', project=result.project)
        second_result = create_or_reset_demo_project()

        self.assertEqual(second_result.project.id, result.project.id)
        self.assertFalse(Location.objects.filter(project=result.project, name='Temporary Location').exists())
        self.assertEqual(Location.objects.filter(project=result.project).count(), 2)

    def test_reset_wipes_stale_history_so_point_in_time_restore_stays_consistent(self) -> None:
        from farm.models import BatchOperation, EntityRevision

        result = create_or_reset_demo_project()
        project = result.project
        stale_revision_ids = set(
            EntityRevision.objects.filter(project=project).values_list('id', flat=True)
        )
        self.assertTrue(stale_revision_ids)
        stale_batch = BatchOperation.objects.create(
            project=project, operation_type=BatchOperation.TYPE_SEASON_DELETE,
        )

        create_or_reset_demo_project()

        # The reset hard-deletes every row; keeping their "created" revisions
        # would let a restore recreate rows that no longer exist. The
        # repopulation writes fresh revisions, but none of the old ones survive.
        self.assertFalse(
            EntityRevision.objects.filter(id__in=stale_revision_ids).exists()
        )
        self.assertFalse(BatchOperation.objects.filter(id=stale_batch.id).exists())

    def test_demo_project_has_multiple_seasons(self) -> None:
        result = create_or_reset_demo_project()

        seasons = Season.objects.filter(project=result.project).order_by('start_date')
        self.assertEqual(list(seasons.values_list('start_date__year', 'end_date__year')), [(2025, 2025), (2026, 2026)])
        self.assertFalse(PlantingPlan.objects.filter(project=result.project, season__isnull=True).exists())

        previous_season, current_season = seasons
        self.assertEqual(PlantingPlan.objects.filter(project=result.project, season=previous_season).count(), 5)
        self.assertEqual(PlantingPlan.objects.filter(project=result.project, season=current_season).count(), 12)

    def test_demo_project_layout_places_beds_inside_their_fields(self) -> None:
        result = create_or_reset_demo_project()

        expected_field_positions = {
            'Fr\u00fchbeete Nord': (40, 40),
            'Folientunnel S\u00fcd': (240, 40),
            'Wurzelgem\u00fcse': (40, 40),
            'Kohlquartier': (220, 40),
        }
        expected_positions = {
            'Salat 1': (12, 12),
            'Salat 2': (52, 12),
            'Kr\u00e4uter & Mangold': (92, 12),
            'Tomatenreihe 1': (14, 18),
            'Tomatenreihe 2': (54, 18),
            'Gurkenreihe': (94, 18),
            'Karotten 1': (8, 20),
            'Karotten 2': (38, 20),
            'Rote Bete': (68, 20),
            'Kohlrabi': (8, 24),
            'Zucchini': (36, 24),
            'Gr\u00fcnd\u00fcngung Reserve': (64, 24),
        }

        layouts_by_name = {
            layout.bed.name: (layout.x, layout.y)
            for layout in BedLayout.objects.filter(project=result.project).select_related('bed')
        }
        field_layouts_by_name = {
            layout.field.name: (layout.x, layout.y)
            for layout in FieldLayout.objects.filter(project=result.project).select_related('field')
        }

        self.assertEqual(field_layouts_by_name, expected_field_positions)
        self.assertEqual(layouts_by_name, expected_positions)

    def test_management_command_seeds_requested_demo_project(self) -> None:
        call_command(
            'seed_demo_project',
            project_slug='command-demo',
            user_email='command-demo@example.local',
            username='command-demo-user',
            password='CommandDemoPass123!',
        )

        project = Project.objects.get(slug='command-demo')
        user = User.objects.get(email='command-demo@example.local')
        self.assertEqual(project.name, 'Solawi Sonnenacker')
        self.assertTrue(ProjectMembership.objects.filter(project=project, user=user, role='admin').exists())
        self.assertEqual(PlantingPlan.objects.filter(project=project).count(), 17)
        self.assertEqual(PublicCrop.objects.filter(source_project=project, seed_packages=[]).count(), 20)
        self.assertTrue(PublicCrop.objects.filter(source_project=project, name='Tomate', variety='Roma', row_spacing_m=0.70).exists())
        self.assertTrue(PublicCrop.objects.filter(source_project=project, name='Tomate', variety='Moneymaker', row_spacing_m__isnull=True).exists())
        self.assertTrue(PublicCrop.objects.filter(source_project=project, name='Gurke', variety='Arola', cultivation_types=['pre_cultivation']).exists())

    def test_create_personal_demo_project_creates_owned_editable_project(self) -> None:
        user = User.objects.create_user(username='owner', email='owner@example.com', password='pass12345', is_active=True)

        result = create_personal_demo_project(user=user)

        self.assertTrue(result.created_project)
        self.assertEqual(result.project.name, DEMO_PROJECT_NAME)
        self.assertEqual(result.project.description, DEMO_PROJECT_DESCRIPTION)
        self.assertTrue(ProjectMembership.objects.filter(user=user, project=result.project, role='admin').exists())
        settings_obj = UserProjectSettings.objects.get(user=user)
        self.assertEqual(settings_obj.default_project_id, result.project.id)
        self.assertEqual(settings_obj.last_project_id, result.project.id)
        self.assertEqual(Location.objects.filter(project=result.project).count(), 2)
        self.assertEqual(Bed.objects.filter(project=result.project).count(), 12)
        self.assertEqual(Crop.objects.filter(project=result.project).count(), 20)
        self.assertEqual(PlantingPlan.objects.filter(project=result.project).count(), 17)

    def test_seeding_marks_when_it_finished_after_its_own_revisions(self) -> None:
        """The dashboard tells seed revisions from user changes by this marker."""
        from farm.models import EntityRevision

        user = User.objects.create_user(
            username='seeded', email='seeded@example.com', password='pass12345', is_active=True,
        )

        project = create_personal_demo_project(user=user).project

        project.refresh_from_db()
        self.assertIsNotNone(project.demo_seeded_at)
        self.assertTrue(EntityRevision.objects.filter(project=project).exists())
        self.assertFalse(
            EntityRevision.objects.filter(
                project=project, created_at__gt=project.demo_seeded_at,
            ).exists()
        )

    def test_create_personal_demo_project_can_create_english_template(self) -> None:
        user = User.objects.create_user(username='english', email='english@example.com', password='pass12345', is_active=True)

        result = create_personal_demo_project(user=user, language_code='en')

        self.assertTrue(result.created_project)
        self.assertEqual(result.project.name, DEMO_PROJECT_NAME_EN)
        self.assertTrue(Location.objects.filter(project=result.project, name='Farm Garden').exists())
        self.assertTrue(Bed.objects.filter(project=result.project, name='Tomato Row 1').exists())
        self.assertTrue(Crop.objects.filter(project=result.project, name='Carrot', crop_family='Carrot family').exists())
        self.assertTrue(PlantingPlan.objects.filter(project=result.project, notes='Early succession for the first CSA box.').exists())
        self.assertFalse(Crop.objects.filter(project=result.project, name='Karotte').exists())

    def test_create_personal_demo_project_is_idempotent_for_same_user(self) -> None:
        user = User.objects.create_user(username='repeat', email='repeat@example.com', password='pass12345', is_active=True)

        first = create_personal_demo_project(user=user)
        second = create_personal_demo_project(user=user)

        self.assertEqual(second.project.id, first.project.id)
        self.assertFalse(second.created_project)
        self.assertEqual(Project.objects.filter(memberships__user=user, name=DEMO_PROJECT_NAME).count(), 1)
        self.assertEqual(Location.objects.filter(project=first.project).count(), 2)

    def test_two_users_receive_separate_demo_projects_and_data(self) -> None:
        first_user = User.objects.create_user(username='first', email='first@example.com', password='pass12345', is_active=True)
        second_user = User.objects.create_user(username='second', email='second@example.com', password='pass12345', is_active=True)

        first = create_personal_demo_project(user=first_user)
        second = create_personal_demo_project(user=second_user)

        self.assertNotEqual(first.project.id, second.project.id)
        self.assertTrue(ProjectMembership.objects.filter(user=first_user, project=first.project, role='admin').exists())
        self.assertTrue(ProjectMembership.objects.filter(user=second_user, project=second.project, role='admin').exists())
        self.assertFalse(ProjectMembership.objects.filter(user=first_user, project=second.project).exists())
        self.assertEqual(Location.objects.filter(project=first.project).count(), 2)
        self.assertEqual(Location.objects.filter(project=second.project).count(), 2)

    def test_one_user_can_create_demo_projects_in_both_languages(self) -> None:
        user = User.objects.create_user(username='both', email='both@example.com', password='pass12345', is_active=True)

        german = create_personal_demo_project(user=user, language_code='de')
        english = create_personal_demo_project(user=user, language_code='en')
        repeated_english = create_personal_demo_project(user=user, language_code='en')

        self.assertNotEqual(german.project.id, english.project.id)
        self.assertEqual(english.project.id, repeated_english.project.id)
        self.assertEqual(Project.objects.filter(memberships__user=user).count(), 2)

    def test_personal_demo_project_creation_rolls_back_on_populate_error(self) -> None:
        user = User.objects.create_user(username='broken', email='broken@example.com', password='pass12345', is_active=True)

        with patch('farm.services.demo_project.populate_demo_project', side_effect=RuntimeError('boom')):
            with self.assertRaises(RuntimeError):
                create_personal_demo_project(user=user)

        self.assertFalse(Project.objects.filter(memberships__user=user, name=DEMO_PROJECT_NAME).exists())
        self.assertFalse(UserProjectSettings.objects.filter(user=user).exists())


class DemoRequestLanguageTests(TestCase):
    """The demo templates fall back to German where the rest of the API falls
    back to English; everything ahead of that last step is shared."""

    def setUp(self) -> None:
        self.factory = RequestFactory()

    def test_falls_back_to_german_where_the_api_falls_back_to_english(self) -> None:
        request = self.factory.get('/', HTTP_ACCEPT_LANGUAGE='fr')

        self.assertEqual(resolve_demo_request_language(request), 'de')
        self.assertEqual(resolve_request_language(request), 'en')

    def test_an_explicit_query_parameter_wins_over_the_demo_default(self) -> None:
        request = self.factory.get('/', {'language': 'en'})

        self.assertEqual(resolve_demo_request_language(request), 'en')

    def test_a_supported_accept_language_header_wins_over_the_demo_default(self) -> None:
        request = self.factory.get('/', HTTP_ACCEPT_LANGUAGE='en')

        self.assertEqual(resolve_demo_request_language(request), 'en')

    def test_the_stored_user_preference_wins_over_the_header(self) -> None:
        user = User.objects.create_user(username='pref', email='pref@example.com', password='pass12345', is_active=True)
        UserProjectSettings.objects.update_or_create(user=user, defaults={'ui_language': 'en'})
        request = self.factory.get('/', HTTP_ACCEPT_LANGUAGE='de')
        request.user = user

        self.assertEqual(resolve_demo_request_language(request), 'en')
