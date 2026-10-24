from __future__ import annotations

from collections import Counter
from datetime import date
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import RequestFactory, TestCase

from accounts.models import UserProjectSettings
from farm.models import Bed, BedLayout, Crop, FieldLayout, Location, PlantingPlan, Project, ProjectMembership, PublicCrop, Season, Supplier
from config.languages import resolve_request_language
from farm.services.bed_capacity import calculate_bed_capacity
from farm.services.crop_import.field_specs import seed_rate_value_constraint_error
from farm.services.crop_rotation import (
    BREAK_SOURCE_CROP,
    BREAK_SOURCE_FAMILY,
    KIND_NO_BREAK,
    KIND_NO_FAMILY,
    KIND_NO_HISTORY,
    KIND_NUTRIENT_HINT,
    STATUS_ACCEPTED,
    STATUS_CONFLICT,
    STATUS_HINT,
    STATUS_INFO,
    STATUS_OK,
    RotationResult,
    RotationService,
    preview_season_copy,
    suggest_beds,
)
from farm.services.demo_project import (
    DEMO_PROJECT_DESCRIPTION,
    DEMO_PROJECT_NAME,
    DEMO_PROJECT_NAME_EN,
    DEMO_PROJECT_SLUG,
    create_or_reset_demo_project,
    create_personal_demo_project,
    demo_current_year,
    get_demo_project_description,
    get_demo_project_name,
    resolve_demo_language,
    resolve_demo_request_language,
)
from farm.services.seasons import build_planting_plan_copies
from farm.services.young_plant_demand import build_young_plant_demand_rows

User = get_user_model()


class DemoProjectServiceTests(TestCase):
    def test_demo_project_lists_bought_in_young_plants(self) -> None:
        result = create_or_reset_demo_project()
        season = Season.objects.get(
            project=result.project, start_date__year=demo_current_year(),
        )

        rows = build_young_plant_demand_rows(
            project=result.project, language_code='de', season_id=season.id,
        )

        plans_by_crop: Counter[str] = Counter()
        for row in rows:
            plans_by_crop[row['crop_name']] += row['plan_count']
        # Both broccoli beds share a row when 20 and 22 April fall in one ISO week.
        self.assertEqual(plans_by_crop, Counter({'Brokkoli': 2, 'Tomate': 1}))
        self.assertTrue(all(row['plant_count'] for row in rows))

    def test_create_or_reset_demo_project_replaces_project_data(self) -> None:
        result = create_or_reset_demo_project()

        self.assertEqual(result.project.slug, DEMO_PROJECT_SLUG)
        self.assertTrue(ProjectMembership.objects.filter(user=result.user, project=result.project, role='admin').exists())
        self.assertEqual(Location.objects.filter(project=result.project).count(), 3)
        self.assertEqual(Bed.objects.filter(project=result.project).count(), 20)
        self.assertEqual(Crop.objects.filter(project=result.project).count(), 30)
        self.assertEqual(PlantingPlan.objects.filter(project=result.project).count(), 65)
        self.assertEqual(Supplier.objects.filter(project=result.project).count(), 3)
        self.assertEqual(FieldLayout.objects.filter(project=result.project).count(), 6)
        self.assertEqual(BedLayout.objects.filter(project=result.project).count(), 20)
        self.assertEqual(Crop.objects.filter(project=result.project, crop_species__isnull=False).count(), 30)
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
        self.assertEqual(Location.objects.filter(project=result.project).count(), 3)

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
        current_year = demo_current_year()

        seasons = Season.objects.filter(project=result.project).order_by('start_date')
        self.assertEqual(
            list(seasons.values_list('start_date__year', 'end_date__year')),
            [(year, year) for year in range(current_year - 3, current_year + 1)],
        )
        self.assertFalse(PlantingPlan.objects.filter(project=result.project, season__isnull=True).exists())

        self.assertEqual(
            [PlantingPlan.objects.filter(project=result.project, season=season).count() for season in seasons],
            [1, 20, 22, 22],
        )

    def test_demo_seasons_follow_the_current_date(self) -> None:
        with patch('farm.services.demo_project.demo_current_year', return_value=2031):
            result = create_or_reset_demo_project()

        self.assertEqual(
            sorted(Season.objects.filter(project=result.project).values_list('start_date__year', flat=True)),
            [2028, 2029, 2030, 2031],
        )

    def test_only_the_new_bed_has_no_planting_history(self) -> None:
        result = create_or_reset_demo_project()
        current_year = demo_current_year()

        for bed in Bed.objects.filter(project=result.project):
            history_years = set(
                PlantingPlan.objects.filter(bed=bed, planting_date__year__lt=current_year)
                .values_list('planting_date__year', flat=True)
            )
            if bed.name == 'Karotten 2':
                self.assertEqual(history_years, set(), bed.name)
                self.assertTrue(bed.notes)
            else:
                self.assertIn(current_year - 1, history_years, bed.name)
                self.assertIn(current_year - 2, history_years, bed.name)

    def test_rotation_statuses_do_not_depend_on_the_demo_language(self) -> None:
        statuses = {}
        for language in ('de', 'en'):
            result = create_or_reset_demo_project(language_code=language)
            service = RotationService(result.project.id, language_code=language)
            plans = PlantingPlan.objects.filter(
                project=result.project, planting_date__year=demo_current_year(),
            ).select_related('crop', 'bed')
            statuses[language] = Counter(service.check_plan(plan).status for plan in plans)

        self.assertEqual(statuses['de'], statuses['en'])
        self.assertEqual(
            set(statuses['de']), {STATUS_OK, STATUS_CONFLICT, STATUS_ACCEPTED, STATUS_HINT, STATUS_INFO},
        )

    def test_demo_project_layout_places_beds_inside_their_fields(self) -> None:
        result = create_or_reset_demo_project()

        expected_field_positions = {
            'Fr\u00fchbeete Nord': (40, 40),
            'Folientunnel S\u00fcd': (240, 40),
            'Wurzelgem\u00fcse': (40, 40),
            'Kohlquartier': (220, 40),
            'Schlag Nord': (40, 40),
            'Schlag S\u00fcd': (240, 40),
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
            'Kartoffeln 1': (8, 24),
            'Kartoffeln 2': (36, 24),
            'Brokkoli': (64, 24),
            'Kohlbeet': (92, 24),
            'Bohnen': (8, 24),
            'Knoblauch & Lauch': (36, 24),
            'Zuckermais': (64, 24),
            'K\u00fcrbisbeet': (92, 24),
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

    def test_demo_seed_rates_pass_the_unit_constraints(self) -> None:
        # The crop API rejects e.g. 1.2 seeds per plant, so a demo crop carrying
        # one could not be saved again without the user touching the seed rate.
        result = create_or_reset_demo_project()

        violations = []
        for crop in Crop.objects.filter(project=result.project):
            rates = [
                (crop.seed_rate_value, crop.seed_rate_unit),
                (crop.seed_rate_direct_value, crop.seed_rate_direct_unit),
                (crop.seed_rate_pre_cultivation_value, crop.seed_rate_pre_cultivation_unit),
                *(
                    (entry.get('value'), entry.get('unit'))
                    for entry in (crop.seed_rate_by_cultivation or {}).values()
                ),
            ]
            violations.extend(
                (crop.name, crop.variety, value, unit)
                for value, unit in rates
                if value is not None and seed_rate_value_constraint_error(value, unit)
            )

        self.assertEqual(violations, [])

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
        self.assertEqual(PlantingPlan.objects.filter(project=project).count(), 65)
        self.assertEqual(PublicCrop.objects.filter(source_project=project, seed_packages=[]).count(), 30)
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
        self.assertEqual(Location.objects.filter(project=result.project).count(), 3)
        self.assertEqual(Bed.objects.filter(project=result.project).count(), 20)
        self.assertEqual(Crop.objects.filter(project=result.project).count(), 30)
        self.assertEqual(PlantingPlan.objects.filter(project=result.project).count(), 65)

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
        self.assertTrue(Crop.objects.filter(project=result.project, name='Carrot', crop_family_id='Apiaceae').exists())
        self.assertTrue(PlantingPlan.objects.filter(project=result.project, notes='Early succession for the first CSA box.').exists())
        self.assertFalse(Crop.objects.filter(project=result.project, name='Karotte').exists())

    def test_create_personal_demo_project_is_idempotent_for_same_user(self) -> None:
        user = User.objects.create_user(username='repeat', email='repeat@example.com', password='pass12345', is_active=True)

        first = create_personal_demo_project(user=user)
        second = create_personal_demo_project(user=user)

        self.assertEqual(second.project.id, first.project.id)
        self.assertFalse(second.created_project)
        self.assertEqual(Project.objects.filter(memberships__user=user, name=DEMO_PROJECT_NAME).count(), 1)
        self.assertEqual(Location.objects.filter(project=first.project).count(), 3)

    def test_two_users_receive_separate_demo_projects_and_data(self) -> None:
        first_user = User.objects.create_user(username='first', email='first@example.com', password='pass12345', is_active=True)
        second_user = User.objects.create_user(username='second', email='second@example.com', password='pass12345', is_active=True)

        first = create_personal_demo_project(user=first_user)
        second = create_personal_demo_project(user=second_user)

        self.assertNotEqual(first.project.id, second.project.id)
        self.assertTrue(ProjectMembership.objects.filter(user=first_user, project=first.project, role='admin').exists())
        self.assertTrue(ProjectMembership.objects.filter(user=second_user, project=second.project, role='admin').exists())
        self.assertFalse(ProjectMembership.objects.filter(user=first_user, project=second.project).exists())
        self.assertEqual(Location.objects.filter(project=first.project).count(), 3)
        self.assertEqual(Location.objects.filter(project=second.project).count(), 3)

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
        request = self.factory.get('/', HTTP_ACCEPT_LANGUAGE='it')

        self.assertEqual(resolve_demo_request_language(request), 'de')
        self.assertEqual(resolve_request_language(request), 'en')

    def test_french_and_spanish_get_the_english_demo(self) -> None:
        # Supported UI languages without demo templates must not raise a
        # KeyError and must not silently get the German templates either.
        for language in ('fr', 'es'):
            with self.subTest(language=language):
                request = self.factory.get('/', HTTP_ACCEPT_LANGUAGE=language)
                self.assertEqual(resolve_request_language(request), language)
                self.assertEqual(resolve_demo_request_language(request), 'en')
                self.assertEqual(resolve_demo_language(language), 'en')
                self.assertEqual(get_demo_project_name(language), get_demo_project_name('en'))
                self.assertEqual(get_demo_project_description(language), get_demo_project_description('en'))

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


class DemoRotationCasesTests(TestCase):
    """Every crop rotation and bed capacity case the demo shows on purpose.

    Mirrors the "Demo cases" table in docs/crop-rotation.md, so each row there
    can be checked by hand in a fresh demo project.
    """

    @classmethod
    def setUpTestData(cls) -> None:
        cls.result = create_or_reset_demo_project(language_code='de')
        cls.project = cls.result.project
        cls.year = demo_current_year()

    def setUp(self) -> None:
        self.service = RotationService(self.project.id, language_code='de')

    def plan(self, culture: str, bed: str, *, month: int | None = None) -> PlantingPlan:
        plans = PlantingPlan.objects.filter(
            project=self.project, planting_date__year=self.year, crop__name=culture, bed__name=bed,
        ).select_related('crop', 'bed', 'bed__field__location')
        if month is not None:
            plans = plans.filter(planting_date__month=month)
        return plans.get()

    def check(self, culture: str, bed: str, *, month: int | None = None) -> RotationResult:
        return self.service.check_plan(self.plan(culture, bed, month=month))

    def bed_options(self, plan: PlantingPlan) -> dict[str, dict]:
        rows = suggest_beds(
            self.service,
            crop=plan.crop,
            start=plan.planting_date,
            end=plan.harvest_end_date,
            exclude_plan_id=plan.pk,
            needed_area_sqm=plan.area_usage_sqm,
        )
        return {row['bed_name']: row for row in rows}

    def test_conflict_from_the_cultures_own_break(self) -> None:
        result = self.check('Kartoffel', 'Kartoffeln 1')

        self.assertEqual(result.status, STATUS_CONFLICT)
        finding = result.findings[0]
        self.assertEqual(finding.break_source, BREAK_SOURCE_CROP)
        self.assertEqual(finding.crop_label, 'Kartoffel')
        self.assertEqual(finding.break_years, 4)
        self.assertEqual(finding.year, self.year - 2)

    def test_conflict_from_the_family_default(self) -> None:
        result = self.check('Brokkoli', 'Kohlbeet')

        self.assertEqual(result.status, STATUS_CONFLICT)
        self.assertEqual(result.findings[0].break_source, BREAK_SOURCE_FAMILY)
        self.assertEqual(result.findings[0].break_years, 4)

    def test_conflict_where_the_previous_cultures_stricter_break_applies(self) -> None:
        result = self.check('Buschbohne', 'Bohnen')

        self.assertEqual(result.status, STATUS_CONFLICT)
        finding = result.findings[0]
        self.assertEqual(finding.previous_crop_label, 'Erbse')
        self.assertEqual(finding.crop_label, 'Erbse')
        self.assertEqual(finding.break_years, 5)
        self.assertEqual(finding.break_source, BREAK_SOURCE_CROP)

    def test_conflict_between_two_plans_in_the_same_year(self) -> None:
        spring = self.check('Salat', 'Salat 1', month=2)
        autumn = self.check('Salat', 'Salat 1', month=8)

        for result in (spring, autumn):
            self.assertEqual(result.status, STATUS_CONFLICT)
            self.assertEqual(result.findings[0].year, self.year)
            self.assertEqual(result.findings[0].break_source, BREAK_SOURCE_FAMILY)

    def test_conflict_through_a_plan_crossing_the_year_boundary(self) -> None:
        result = self.check('Lauch', 'Knoblauch & Lauch')

        self.assertEqual(result.status, STATUS_CONFLICT)
        finding = result.findings[0]
        self.assertEqual(finding.previous_crop_label, 'Knoblauch')
        self.assertEqual(finding.year, self.year)
        garlic = PlantingPlan.objects.get(pk=finding.previous_plan_id)
        self.assertEqual(garlic.planting_date.year, self.year - 1)
        self.assertEqual(garlic.harvest_end_date.year, self.year)

    def test_conflict_with_a_green_manure_of_the_same_family(self) -> None:
        result = self.check('Brokkoli', 'Kohlbeet')

        self.assertEqual(result.findings[0].previous_crop_label, 'Senf')
        self.assertEqual(result.findings[0].family_key, 'Brassicaceae')

    def test_accepted_conflict_records_user_and_date(self) -> None:
        plan = self.plan('Tomate', 'Tomatenreihe 1')

        self.assertEqual(self.service.check_plan(plan).status, STATUS_ACCEPTED)
        self.assertEqual(plan.rotation_conflict_accepted_by, self.result.user)
        self.assertIsNotNone(plan.rotation_conflict_accepted_at)
        self.assertTrue(plan.notes)

    def test_hint_for_a_heavy_feeder_after_a_heavy_feeder(self) -> None:
        result = self.check('Kartoffel', 'Kartoffeln 2')

        self.assertEqual(result.status, STATUS_HINT)
        self.assertEqual(result.findings[0].kind, KIND_NUTRIENT_HINT)
        self.assertEqual(result.findings[0].previous_crop_label, 'Zucchini (Costata Romanesco)')

    def test_no_hint_when_a_legume_came_in_between(self) -> None:
        result = self.check('Brokkoli', 'Brokkoli')

        self.assertEqual(result.status, STATUS_OK)
        self.assertEqual(result.findings[0].previous_crop_label, 'Erbse')

    def test_info_for_a_culture_without_a_plant_family(self) -> None:
        result = self.check('Erdbeere', 'Gründüngung Reserve')

        self.assertEqual(result.status, STATUS_INFO)
        self.assertEqual(result.findings[0].kind, KIND_NO_FAMILY)

    def test_info_for_a_family_without_a_break(self) -> None:
        for culture, bed in (('Phacelia', 'Gründüngung Reserve'), ('Zuckermais', 'Zuckermais')):
            with self.subTest(culture=culture):
                result = self.check(culture, bed)
                self.assertEqual(result.status, STATUS_INFO)
                self.assertEqual(result.findings[0].kind, KIND_NO_BREAK)

    def test_ok_for_a_bed_without_history(self) -> None:
        result = self.check('Karotte', 'Karotten 2')

        self.assertEqual(result.status, STATUS_OK)
        self.assertEqual(result.findings[0].kind, KIND_NO_HISTORY)

    def test_ok_after_a_different_family(self) -> None:
        result = self.check('Mangold', 'Kräuter & Mangold')

        self.assertEqual(result.status, STATUS_OK)
        finding = result.findings[0]
        self.assertEqual(finding.previous_crop_label, 'Salat (Lollo Bionda)')
        self.assertNotEqual(finding.previous_family_key, finding.family_key)

    def test_ok_for_the_same_family_outside_the_break(self) -> None:
        result = self.check('Zucchini', 'Kürbisbeet')

        self.assertEqual(result.status, STATUS_OK)
        self.assertEqual(result.findings[0].year, self.year - 3)

    def test_conflict_suggests_beds_in_another_location(self) -> None:
        plan = self.plan('Lauch', 'Knoblauch & Lauch')
        location = plan.bed.field.location.name

        matching = [
            row for row in self.bed_options(plan).values()
            if row['has_enough_area'] and row['status'] != STATUS_CONFLICT
        ]

        self.assertTrue(any(row['location_name'] != location for row in matching), matching)

    def test_partially_occupied_bed_with_enough_room_stays_selectable(self) -> None:
        option = self.bed_options(self.plan('Lauch', 'Knoblauch & Lauch'))['Zuckermais']

        self.assertTrue(option['has_enough_area'])
        self.assertTrue(option['is_partially_occupied'])
        self.assertEqual(option['free_area_sqm'], 12.0)
        self.assertEqual(option['bed_area_sqm'], 24.0)

    def test_bed_without_enough_room_names_the_blocking_plan(self) -> None:
        option = self.bed_options(self.plan('Lauch', 'Knoblauch & Lauch'))['Bohnen']

        self.assertFalse(option['has_enough_area'])
        self.assertEqual(option['free_area_sqm'], 4.0)
        self.assertEqual(option['blocking_plan']['crop_label'], 'Buschbohne')
        self.assertEqual(option['blocking_plan']['end_date'], f'{self.year}-08-10')

    def test_copying_the_season_shows_conflicts_and_a_hint(self) -> None:
        source = Season.objects.get(project=self.project, start_date__year=self.year)
        target = Season.objects.create(
            project=self.project, start_date=date(self.year + 1, 1, 1), end_date=date(self.year + 1, 12, 31),
        )
        pairs, _ = build_planting_plan_copies(source_season=source, target_season=target)

        preview = preview_season_copy(self.service, pairs)

        self.assertGreaterEqual(preview['conflict_count'], 1)
        self.assertGreaterEqual(preview['hint_count'], 1)
        hints = [item['crop_label'] for item in preview['items'] if item['status'] == STATUS_HINT]
        self.assertIn('Zuckermais', hints)

    def test_no_bed_is_overbooked(self) -> None:
        """Every seeded plan passes the capacity rule of the save check."""
        for plan in PlantingPlan.objects.filter(project=self.project).select_related('bed'):
            end = plan.harvest_end_date or plan.harvest_date or plan.planting_date
            capacity = calculate_bed_capacity(
                plan.bed, start=plan.planting_date, end=end, exclude_plan_id=plan.pk,
            )
            self.assertTrue(
                capacity.has_room_for(plan.area_usage_sqm),
                f'{plan} needs {plan.area_usage_sqm} m², {capacity.free_area_sqm} free',
            )
