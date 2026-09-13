from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
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
from farm.services.yield_calendar import (
    build_yield_calendar,
    build_yield_calendar_for_season,
    iso_week_key,
    week_start_for_iso_year,
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

    def test_a_zero_length_harvest_window_contributes_nothing(self):
        """Distributing a yield over zero days would divide by zero.

        Note: the two early-return guards in `_accumulate_plan_yield` are both
        redundant — they state the same condition, and the week loop already
        yields no overlapping days for either shape, so removing both leaves
        this test passing. Pinned as behaviour, not as a guard on those lines.
        """
        crop = Crop.objects.create(name='Punkt', expected_yield=50, project=self.project)
        self._create_plan(crop=crop, harvest_start=date(2026, 3, 3), harvest_end=date(2026, 3, 3))

        response = self.client.get('/openfarmplanner/api/yield-calendar/?year=2026')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_an_inverted_harvest_window_contributes_nothing(self):
        crop = Crop.objects.create(name='Rückwärts', expected_yield=50, project=self.project)
        self._create_plan(crop=crop, harvest_start=date(2026, 3, 10), harvest_end=date(2026, 3, 3))

        response = self.client.get('/openfarmplanner/api/yield-calendar/?year=2026')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_a_crop_with_a_zero_expected_yield_is_left_out(self):
        """The calendar charts kilograms; a crop with no figure has nothing to
        chart and would otherwise draw a zero-height segment in the legend."""
        no_yield = Crop.objects.create(name='Ohne Ertrag', expected_yield=0, project=self.project)
        self._create_plan(
            crop=no_yield, harvest_start=date(2026, 3, 2), harvest_end=date(2026, 3, 9),
        )

        response = self.client.get('/openfarmplanner/api/yield-calendar/?year=2026')

        self.assertEqual(response.json(), [])

    def test_a_crop_with_no_expected_yield_at_all_is_left_out(self):
        """`expected_yield` is nullable, and the accumulator feeds it straight
        into `Decimal(...)` — so the queryset filter is what keeps a NULL from
        reaching it, not a check further down."""
        unknown = Crop.objects.create(name='Unbekannt', expected_yield=None, project=self.project)
        self._create_plan(
            crop=unknown, harvest_start=date(2026, 3, 2), harvest_end=date(2026, 3, 9),
        )

        response = self.client.get('/openfarmplanner/api/yield-calendar/?year=2026')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_a_plan_without_harvest_dates_is_left_out(self):
        crop = Crop.objects.create(name='Ungeplant', expected_yield=50, project=self.project)
        PlantingPlan.objects.create(
            crop=crop, bed=self.bed, planting_date=date(2026, 3, 2), project=self.project,
        )
        PlantingPlan.objects.filter(crop=crop).update(harvest_date=None, harvest_end_date=None)

        response = self.client.get('/openfarmplanner/api/yield-calendar/?year=2026')

        self.assertEqual(response.json(), [])

    def test_another_projects_plans_never_appear(self):
        other_project = Project.objects.create(name='Fremd', slug='yield-other-project')
        other_location = Location.objects.create(name='Fremd Loc', project=other_project)
        other_field = Field.objects.create(
            name='Fremd Field', location=other_location, project=other_project,
        )
        other_bed = Bed.objects.create(
            name='Fremd Bed', field=other_field, area_sqm=100, project=other_project,
        )
        other_crop = Crop.objects.create(name='Fremd', expected_yield=99, project=other_project)
        plan = PlantingPlan.objects.create(
            crop=other_crop, bed=other_bed, planting_date=date(2026, 3, 2), project=other_project,
        )
        PlantingPlan.objects.filter(id=plan.id).update(
            harvest_date=date(2026, 3, 2), harvest_end_date=date(2026, 3, 9),
        )

        response = self.client.get('/openfarmplanner/api/yield-calendar/?year=2026')

        self.assertEqual(response.json(), [])

    def test_serves_the_colour_the_crop_was_given(self):
        crop = Crop.objects.create(
            name='Bunt', expected_yield=10, display_color='#123456', project=self.project,
        )
        self._create_plan(crop=crop, harvest_start=date(2026, 3, 2), harvest_end=date(2026, 3, 9))

        response = self.client.get('/openfarmplanner/api/yield-calendar/?year=2026')

        self.assertEqual(response.json()[0]['crops'][0]['color'], '#123456')

    def test_falls_back_to_the_default_colour_for_a_row_with_none(self):
        """`Crop.save` generates a colour on create, so this branch is only
        reachable for a row cleared afterwards — a migration or a data fix.
        The chart still needs *some* colour for the segment."""
        crop = Crop.objects.create(name='Farblos', expected_yield=10, project=self.project)
        Crop.objects.filter(pk=crop.pk).update(display_color='')
        self._create_plan(crop=crop, harvest_start=date(2026, 3, 2), harvest_end=date(2026, 3, 9))

        response = self.client.get('/openfarmplanner/api/yield-calendar/?year=2026')

        self.assertEqual(response.json()[0]['crops'][0]['color'], '#3b82f6')

    def test_weeks_come_back_in_chronological_order(self):
        crop = Crop.objects.create(name='Lauch', expected_yield=10, project=self.project)
        for start in (date(2026, 6, 1), date(2026, 3, 2), date(2026, 4, 6)):
            self._create_plan(crop=crop, harvest_start=start, harvest_end=start + timedelta(days=7))

        response = self.client.get('/openfarmplanner/api/yield-calendar/?year=2026')

        iso_weeks = [row['iso_week'] for row in response.json()]
        self.assertEqual(iso_weeks, sorted(iso_weeks))
        self.assertEqual(iso_weeks, ['2026-W10', '2026-W15', '2026-W23'])

    def test_crops_within_a_week_come_back_in_name_order(self):
        for name in ('Zucchini', 'Aubergine', 'Mangold'):
            crop = Crop.objects.create(name=name, expected_yield=10, project=self.project)
            self._create_plan(
                crop=crop, harvest_start=date(2026, 3, 2), harvest_end=date(2026, 3, 9),
            )

        response = self.client.get('/openfarmplanner/api/yield-calendar/?year=2026')

        names = [item['crop_name'] for item in response.json()[0]['crops']]
        self.assertEqual(names, ['Aubergine', 'Mangold', 'Zucchini'])

    def test_a_contribution_that_rounds_to_zero_drops_its_whole_week(self):
        """One day out of a very long window rounds to 0.00 kg. Charting an
        empty week would draw a gap in the axis, so the week is dropped."""
        crop = Crop.objects.create(name='Winzig', expected_yield=1, project=self.project)
        # Sun 2026-03-01 is the last day of ISO week 9; the rest falls in later
        # weeks, so week 9 receives 1/365 kg and rounds away.
        self._create_plan(crop=crop, harvest_start=date(2026, 3, 1), harvest_end=date(2027, 3, 1))

        iso_weeks = [row['iso_week'] for row in self.client.get(
            '/openfarmplanner/api/yield-calendar/?year=2026'
        ).json()]

        self.assertNotIn('2026-W09', iso_weeks)
        self.assertIn('2026-W10', iso_weeks)

    def test_a_week_starting_in_the_previous_iso_year_belongs_to_that_year(self):
        """Weeks are attributed by the ISO year of their Monday, so a harvest
        crossing the boundary shows up split across the two yearly requests
        rather than being counted twice or lost."""
        crop = Crop.objects.create(name='Grünkohl', expected_yield=70, project=self.project)
        self._create_plan(crop=crop, harvest_start=date(2025, 12, 22), harvest_end=date(2026, 1, 5))

        weeks_2025 = [row['iso_week'] for row in self.client.get(
            '/openfarmplanner/api/yield-calendar/?year=2025'
        ).json()]
        weeks_2026 = [row['iso_week'] for row in self.client.get(
            '/openfarmplanner/api/yield-calendar/?year=2026'
        ).json()]

        self.assertEqual(weeks_2025, ['2025-W52'])
        self.assertEqual(weeks_2026, ['2026-W01'])
        total = sum(
            row['crops'][0]['yield']
            for row in (
                self.client.get('/openfarmplanner/api/yield-calendar/?year=2025').json()
                + self.client.get('/openfarmplanner/api/yield-calendar/?year=2026').json()
            )
        )
        self.assertAlmostEqual(total, 70.0, places=2)


class IsoWeekHelperTest(SimpleTestCase):
    """The two pure helpers the whole calendar is keyed on.

    Reached directly rather than through the endpoint: the year a week belongs
    to and the shape of its key decide which request returns it, so getting
    either wrong moves rows between years rather than changing a number inside
    one.
    """

    def test_a_year_starts_on_a_monday(self):
        for iso_year in (2024, 2025, 2026, 2027):
            with self.subTest(iso_year=iso_year):
                self.assertEqual(week_start_for_iso_year(iso_year).weekday(), 0)

    def test_iso_week_one_can_start_in_the_previous_calendar_year(self):
        # ISO week 1 is the week containing the first Thursday, so it reaches
        # back into December whenever January 1 falls late in the week. Using
        # the calendar January 1 as the year boundary would put those days in
        # the wrong year's calendar.
        self.assertEqual(week_start_for_iso_year(2026), date(2025, 12, 29))

    def test_iso_week_one_can_start_on_january_first(self):
        # The other side of the same rule: 2024 opens on a Monday, so nothing
        # is borrowed from December.
        self.assertEqual(week_start_for_iso_year(2024), date(2024, 1, 1))

    def test_a_week_key_is_zero_padded(self):
        # Keys are sorted as strings, so an unpadded "2026-W9" would sort
        # after "2026-W10" and scramble the calendar's order.
        self.assertEqual(iso_week_key(date(2026, 3, 2)), '2026-W10')
        self.assertEqual(iso_week_key(date(2026, 1, 5)), '2026-W02')

    def test_a_week_key_uses_the_iso_year_not_the_calendar_year(self):
        # 2025-12-29 is a Monday in ISO week 1 of 2026.
        self.assertEqual(iso_week_key(date(2025, 12, 29)), '2026-W01')


class YieldCalendarServiceTest(TestCase):
    """Cases the endpoint cannot express, reached through the service itself.

    The view resolves the language and the season from the request before
    calling in, so the two service entry points and their arguments are only
    separable one level down.
    """

    def setUp(self):
        self.project = Project.objects.create(name='Service Project', slug='service-project')

    def _create_plan(self, *, crop, harvest_start, harvest_end, season=None):
        """Create a plan whose harvest window is exactly the one given.

        The dates go in with a queryset update because ``PlantingPlan.save``
        recalculates them from the crop's timing for every new instance. Same
        approach as ``YieldCalendarAPITest``.
        """
        plan = PlantingPlan.objects.create(
            crop=crop, planting_date=harvest_start, project=self.project, season=season,
        )
        PlantingPlan.objects.filter(id=plan.id).update(
            harvest_date=harvest_start, harvest_end_date=harvest_end,
        )
        plan.refresh_from_db()
        return plan

    def _linked_crop(self, *, name: str, german_name: str, english_name: str) -> Crop:
        species = CropSpecies.objects.create(
            name=english_name, status=CropSpecies.STATUS_PUBLISHED,
        )
        CropSpeciesTranslation.objects.create(
            species=species, language_code='de', common_name=german_name,
        )
        CropSpeciesTranslation.objects.create(
            species=species, language_code='en', common_name=english_name,
        )
        return Crop.objects.create(
            name=name, expected_yield=100, crop_species=species, project=self.project,
        )

    def test_the_requested_language_decides_the_display_name(self):
        # The endpoint resolves one language per request, so asking for two
        # different ones is the only way to show the argument is used at all
        # rather than a fixed language being hardcoded.
        crop = self._linked_crop(
            name='Möhre Eigenname', german_name='Karotte', english_name='Carrot',
        )
        self._create_plan(crop=crop, harvest_start=date(2026, 3, 2), harvest_end=date(2026, 3, 9))

        german = build_yield_calendar(self.project, 2026, 'de')
        english = build_yield_calendar(self.project, 2026, 'en')

        self.assertEqual(german[0]['crops'][0]['crop_display_name'], 'Karotte')
        self.assertEqual(english[0]['crops'][0]['crop_display_name'], 'Carrot')

    def test_crops_in_a_week_are_ordered_by_the_name_the_user_sees(self):
        # The two orders disagree here on purpose: by stored name it is
        # Alpha then Beta, by German display name it is Karotte then Zwiebel
        # -- reversed. The chart's legend follows what is rendered, so the
        # display name has to be what decides.
        second = self._linked_crop(name='Alpha', german_name='Zwiebel', english_name='Onion')
        first = self._linked_crop(name='Beta', german_name='Karotte', english_name='Carrot')
        self._create_plan(crop=second, harvest_start=date(2026, 3, 2), harvest_end=date(2026, 3, 9))
        self._create_plan(crop=first, harvest_start=date(2026, 3, 2), harvest_end=date(2026, 3, 9))

        row = build_yield_calendar(self.project, 2026, 'de')[0]

        self.assertEqual(
            [crop['crop_display_name'] for crop in row['crops']], ['Karotte', 'Zwiebel'],
        )
        self.assertEqual([crop['crop_name'] for crop in row['crops']], ['Beta', 'Alpha'])

    def test_a_season_spanning_two_years_stays_scoped_to_its_own_plans(self):
        # The per-year loop passes the season down on every iteration. Dropping
        # that would quietly widen a season-scoped chart to the whole project,
        # which the single-year entry point's own scoping test cannot show.
        season = Season.objects.create(
            project=self.project, start_date=date(2026, 9, 1), end_date=date(2027, 8, 31),
        )
        crop = Crop.objects.create(name='Grünkohl', expected_yield=100, project=self.project)
        self._create_plan(
            crop=crop,
            harvest_start=date(2026, 10, 5),
            harvest_end=date(2026, 10, 12),
            season=season,
        )
        self._create_plan(
            crop=crop, harvest_start=date(2026, 10, 5), harvest_end=date(2026, 10, 12), season=None,
        )

        rows = build_yield_calendar_for_season(self.project, season, 'de')

        self.assertEqual([row['iso_week'] for row in rows], ['2026-W41'])
        self.assertAlmostEqual(rows[0]['crops'][0]['yield'], 100.0, places=2)

    def test_weeks_from_the_two_years_of_a_season_never_collide(self):
        # Per-year results are concatenated rather than merged, which is only
        # safe because the keys carry the ISO year: week 41 of one year and
        # week 41 of the next stay separate rows.
        season = Season.objects.create(
            project=self.project, start_date=date(2026, 9, 1), end_date=date(2027, 12, 31),
        )
        crop = Crop.objects.create(name='Grünkohl', expected_yield=100, project=self.project)
        # Derived from the week numbers rather than written as dates, since
        # deliberately picking the same week in two different years is the
        # whole point and the calendar dates for it do not line up.
        for iso_year in (2026, 2027):
            monday = date.fromisocalendar(iso_year, 41, 1)
            self._create_plan(
                crop=crop,
                harvest_start=monday,
                harvest_end=monday + timedelta(days=7),
                season=season,
            )

        rows = build_yield_calendar_for_season(self.project, season, 'de')
        weeks = [row['iso_week'] for row in rows]

        self.assertEqual(weeks, ['2026-W41', '2027-W41'])

    def test_a_plan_with_no_harvest_dates_is_left_out_even_with_a_yield(self):
        # The existing endpoint test pairs its dateless plan with a crop that
        # has no expected yield, so the yield filter excludes it first and the
        # date filters are never the thing doing the work. Here the crop has a
        # yield, which leaves the date filters as the only thing that can
        # exclude it -- and reaching the distribution with null dates would
        # raise rather than return an empty calendar.
        #
        # Which of the date filters does the excluding is not observable: the
        # `isnull` pair and the year-window comparisons each drop a null row on
        # their own, since SQL comparisons against NULL are never true. Removing
        # either alone changes nothing, so this pins the outcome rather than the
        # mechanism.
        crop = Crop.objects.create(name='Grünkohl', expected_yield=100, project=self.project)
        PlantingPlan.objects.create(
            crop=crop, planting_date=date(2026, 3, 2), project=self.project,
        )

        self.assertEqual(build_yield_calendar(self.project, 2026, 'de'), [])

    def test_a_plan_with_only_a_harvest_start_is_left_out(self):
        crop = Crop.objects.create(name='Grünkohl', expected_yield=100, project=self.project)
        plan = PlantingPlan.objects.create(
            crop=crop, planting_date=date(2026, 3, 2), project=self.project,
        )
        PlantingPlan.objects.filter(id=plan.id).update(
            harvest_date=date(2026, 3, 2), harvest_end_date=None,
        )

        self.assertEqual(build_yield_calendar(self.project, 2026, 'de'), [])

    def test_a_whole_week_split_keeps_both_halves(self):
        # One day of an eight-day window is an eighth of the yield, which lands
        # exactly on two decimals and needs no rounding at all. This pins the
        # split itself; the rounding mode is separated out below.
        crop = Crop.objects.create(name='Grünkohl', expected_yield=100, project=self.project)
        self._create_plan(crop=crop, harvest_start=date(2026, 3, 1), harvest_end=date(2026, 3, 9))

        rows = build_yield_calendar(self.project, 2026, 'de')

        self.assertEqual(
            {row['iso_week']: row['crops'][0]['yield'] for row in rows},
            {'2026-W09': 12.5, '2026-W10': 87.5},
        )

    def test_a_weekly_value_rounds_half_up_rather_than_to_even(self):
        # The two modes only diverge when the third decimal is exactly 5, so
        # the window is chosen to produce one: a yield of 1 over eight days
        # gives the first week 0.125. Half-up rounds that to 0.13; banker's
        # rounding would pull it down to 0.12 because 2 is even. The scale the
        # user reads is kilograms, where rounding down a value that sits
        # exactly on the boundary reads as the chart losing weight.
        crop = Crop.objects.create(name='Grünkohl', expected_yield=1, project=self.project)
        self._create_plan(crop=crop, harvest_start=date(2026, 3, 1), harvest_end=date(2026, 3, 9))

        rows = build_yield_calendar(self.project, 2026, 'de')

        self.assertEqual(rows[0]['crops'][0]['yield'], 0.13)

    def test_the_last_supported_year_does_not_overflow(self):
        # The year window normally ends at the start of the next ISO year,
        # which cannot be built for 9999 -- `date.fromisocalendar(10000, ...)`
        # is out of range. The view rejects anything above 9999 before it gets
        # here, so this is the one year that reaches the service at the very
        # top of the supported range.
        crop = Crop.objects.create(name='Grünkohl', expected_yield=100, project=self.project)
        self._create_plan(crop=crop, harvest_start=date(2026, 3, 2), harvest_end=date(2026, 3, 9))

        self.assertEqual(build_yield_calendar(self.project, 9999, 'de'), [])

    def test_the_year_window_filters_are_an_optimisation_only(self):
        # Recorded rather than asserted as a requirement. The queryset trims
        # plans that cannot touch the requested year, but the distribution
        # checks the ISO year of every week anyway, so removing either filter
        # changes only how many rows are read -- never the answer. The two
        # entry points below are the same harvest seen from both years.
        crop = Crop.objects.create(name='Grünkohl', expected_yield=100, project=self.project)
        self._create_plan(
            crop=crop, harvest_start=date(2026, 12, 21), harvest_end=date(2027, 1, 11),
        )

        this_year = [row['iso_week'] for row in build_yield_calendar(self.project, 2026, 'de')]
        next_year = [row['iso_week'] for row in build_yield_calendar(self.project, 2027, 'de')]

        self.assertTrue(all(week.startswith('2026-') for week in this_year))
        self.assertTrue(all(week.startswith('2027-') for week in next_year))
        self.assertEqual(len(this_year) + len(next_year), 3)
