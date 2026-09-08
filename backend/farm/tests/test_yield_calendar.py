from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from crops.models import CropSpecies, CropSpeciesTranslation
from farm.models import (
    Bed,
    Crop,
    Field,
    Location,
    PlantingPlan,
    Project,
    ProjectMembership,
    Season,
)

User = get_user_model()


class YieldCalendarAPITest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username='yielduser', email='yield@example.com', password='testpass', is_active=True)
        self.project = Project.objects.create(name='Yield Project', slug='yield-project')
        ProjectMembership.objects.create(user=self.user, project=self.project, role='admin')
        self.client.force_authenticate(user=self.user)
        self.client.defaults['HTTP_X_PROJECT_ID'] = str(self.project.id)
        location = Location.objects.create(name='Loc', project=self.project)
        field = Field.objects.create(name='Field', location=location, project=self.project)
        self.bed = Bed.objects.create(name='Bed', field=field, area_sqm=100, project=self.project)

    def _create_plan(self, *, crop: Crop, harvest_start: date, harvest_end: date):
        plan = PlantingPlan.objects.create(
            crop=crop,
            bed=self.bed,
            planting_date=harvest_start,
            project=self.project,
        )
        PlantingPlan.objects.filter(id=plan.id).update(harvest_date=harvest_start, harvest_end_date=harvest_end)
        plan.refresh_from_db()
        return plan

    def test_rejects_non_numeric_year_with_structured_error(self):
        response = self.client.get('/openfarmplanner/api/yield-calendar/?year=invalid')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'], 'invalid_year')

    def test_rejects_out_of_range_year_with_structured_error(self):
        response = self.client.get('/openfarmplanner/api/yield-calendar/?year=10000')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'], 'year_out_of_range')

    def test_harvest_inside_single_week_goes_to_one_week(self):
        carrot = Crop.objects.create(name='Karotte', expected_yield=70, display_color='#F4A261', project=self.project)
        self._create_plan(crop=carrot, harvest_start=date(2026, 3, 3), harvest_end=date(2026, 3, 6))

        response = self.client.get('/openfarmplanner/api/yield-calendar/?year=2026')
        self.assertEqual(response.status_code, 200)

        payload = response.json()
        self.assertEqual(len(payload), 1)
        self.assertEqual(payload[0]['iso_week'], '2026-W10')
        self.assertEqual(payload[0]['crops'][0]['crop_name'], 'Karotte')
        self.assertAlmostEqual(payload[0]['crops'][0]['yield'], 70.0, places=2)

    def test_yield_calendar_localizes_linked_crop_species_name(self):
        species = CropSpecies.objects.create(name='Yield Calendar Localized Species')
        CropSpeciesTranslation.objects.create(species=species, language_code='de', common_name='Ackerbohne')
        CropSpeciesTranslation.objects.create(species=species, language_code='en', common_name='Broad bean')
        bean = Crop.objects.create(
            name='Ackerbohne',
            crop_species=species,
            expected_yield=70,
            display_color='#6D597A',
            project=self.project,
        )
        self._create_plan(crop=bean, harvest_start=date(2026, 3, 3), harvest_end=date(2026, 3, 6))

        response = self.client.get('/openfarmplanner/api/yield-calendar/?year=2026', HTTP_ACCEPT_LANGUAGE='en')

        self.assertEqual(response.status_code, 200)
        crop = response.json()[0]['crops'][0]
        self.assertEqual(crop['crop_id'], bean.id)
        self.assertEqual(crop['crop_name'], 'Ackerbohne')
        self.assertEqual(crop['crop_display_name'], 'Broad bean')
        self.assertEqual(crop['crop_display_language_code'], 'en')

    def test_harvest_spanning_multiple_weeks_splits_proportionally(self):
        leek = Crop.objects.create(name='Lauch', expected_yield=100, display_color='#2A9D8F', project=self.project)
        self._create_plan(crop=leek, harvest_start=date(2026, 3, 5), harvest_end=date(2026, 3, 17))

        response = self.client.get('/openfarmplanner/api/yield-calendar/?year=2026')
        self.assertEqual(response.status_code, 200)

        rows = {row['iso_week']: row for row in response.json()}
        self.assertAlmostEqual(rows['2026-W10']['crops'][0]['yield'], 33.33, places=2)
        self.assertAlmostEqual(rows['2026-W11']['crops'][0]['yield'], 58.33, places=2)
        self.assertAlmostEqual(rows['2026-W12']['crops'][0]['yield'], 8.33, places=2)

    def test_iso_year_boundary_uses_iso_week_keys(self):
        spinach = Crop.objects.create(name='Spinat', expected_yield=80, display_color='#90BE6D', project=self.project)
        self._create_plan(crop=spinach, harvest_start=date(2024, 12, 30), harvest_end=date(2025, 1, 6))

        response = self.client.get('/openfarmplanner/api/yield-calendar/?year=2025')
        self.assertEqual(response.status_code, 200)

        payload = response.json()
        self.assertEqual(len(payload), 1)
        self.assertEqual(payload[0]['iso_week'], '2025-W01')
        self.assertEqual(payload[0]['week_start'], '2024-12-30')
        self.assertEqual(payload[0]['week_end'], '2025-01-06')
        self.assertAlmostEqual(payload[0]['crops'][0]['yield'], 80.0, places=2)

    def test_multiple_plans_same_crop_same_week_sum(self):
        onion = Crop.objects.create(name='Zwiebel', expected_yield=10, display_color='#E9C46A', project=self.project)
        self._create_plan(crop=onion, harvest_start=date(2026, 3, 2), harvest_end=date(2026, 3, 9))
        self._create_plan(crop=onion, harvest_start=date(2026, 3, 2), harvest_end=date(2026, 3, 9))

        response = self.client.get('/openfarmplanner/api/yield-calendar/?year=2026')
        self.assertEqual(response.status_code, 200)

        payload = response.json()
        self.assertEqual(len(payload), 1)
        self.assertAlmostEqual(payload[0]['crops'][0]['yield'], 20.0, places=2)

    def test_multiple_crops_are_separate_stack_segments(self):
        tomato = Crop.objects.create(name='Tomate', expected_yield=30, display_color='#E63946', project=self.project)
        carrot = Crop.objects.create(name='Karotte', expected_yield=20, display_color='#F4A261', project=self.project)

        self._create_plan(crop=tomato, harvest_start=date(2026, 3, 2), harvest_end=date(2026, 3, 9))
        self._create_plan(crop=carrot, harvest_start=date(2026, 3, 2), harvest_end=date(2026, 3, 9))

        response = self.client.get('/openfarmplanner/api/yield-calendar/?year=2026')
        self.assertEqual(response.status_code, 200)

        crops = response.json()[0]['crops']
        names = {item['crop_name'] for item in crops}
        self.assertEqual(names, {'Tomate', 'Karotte'})
        yields = {item['crop_name']: item['yield'] for item in crops}
        self.assertAlmostEqual(yields['Tomate'], 30.0, places=2)
        self.assertAlmostEqual(yields['Karotte'], 20.0, places=2)

    def test_scoped_to_the_active_season_when_the_header_is_present(self):
        """Without X-Season-Id, plans from every season still aggregate together
        (backward-compatible); with it, only the active season's plans count."""
        carrot = Crop.objects.create(name='Karotte', expected_yield=70, display_color='#F4A261', project=self.project)
        season_a = Season.objects.create(project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31))
        season_b = Season.objects.create(project=self.project, start_date=date(2027, 1, 1), end_date=date(2027, 12, 31))
        plan_a = self._create_plan(crop=carrot, harvest_start=date(2026, 3, 3), harvest_end=date(2026, 3, 6))
        plan_a.season = season_a
        plan_a.save(update_fields=['season'])
        plan_b = self._create_plan(crop=carrot, harvest_start=date(2026, 3, 3), harvest_end=date(2026, 3, 6))
        plan_b.season = season_b
        plan_b.save(update_fields=['season'])

        unscoped = self.client.get('/openfarmplanner/api/yield-calendar/?year=2026')
        self.assertAlmostEqual(unscoped.json()[0]['crops'][0]['yield'], 140.0, places=2)

        scoped = self.client.get('/openfarmplanner/api/yield-calendar/?year=2026', HTTP_X_SEASON_ID=str(season_a.id))
        self.assertAlmostEqual(scoped.json()[0]['crops'][0]['yield'], 70.0, places=2)

    def test_active_season_without_year_param_spans_every_iso_year_it_covers(self):
        """A non-calendar-aligned season returns weeks from both of its ISO
        years in one response, instead of only the single year that would
        otherwise default from today's date."""
        carrot = Crop.objects.create(name='Karotte', expected_yield=70, display_color='#F4A261', project=self.project)
        season = Season.objects.create(
            project=self.project, start_date=date(2025, 9, 1), end_date=date(2026, 8, 31),
        )
        for plan in (
            self._create_plan(crop=carrot, harvest_start=date(2025, 10, 6), harvest_end=date(2025, 10, 9)),
            self._create_plan(crop=carrot, harvest_start=date(2026, 3, 3), harvest_end=date(2026, 3, 6)),
        ):
            plan.season = season
            plan.save(update_fields=['season'])

        response = self.client.get('/openfarmplanner/api/yield-calendar/', HTTP_X_SEASON_ID=str(season.id))
        self.assertEqual(response.status_code, 200)
        iso_weeks = {row['iso_week'] for row in response.json()}
        self.assertEqual(iso_weeks, {'2025-W41', '2026-W10'})
