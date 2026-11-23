from datetime import date

from django.utils import timezone

from farm.models import Crop, HarvestAllocation, HarvestRecord, PlantingPlan, Project, Season, Task
from farm.tests.api_base import ProjectApiTestCase

PLANS = "/openfarmplanner/api/planting-plans/"


class ActualHarvestDatesTest(ProjectApiTestCase):
    def season(self, start: str, end: str) -> Season:
        return Season.objects.create(project=self.project, start_date=start, end_date=end)

    def perennial(self, origin: Season, window: str, **dates) -> PlantingPlan:
        crop = Crop.objects.create(
            project=self.project,
            name="Perennial harvest trial",
            life_cycle="perennial",
            standing_time_years=10,
            annual_harvest_window=window,
        )
        return PlantingPlan.objects.create(
            project=self.project,
            crop=crop,
            bed=self.bed,
            season=origin,
            planting_date=date(2025, 3, 15),
            clearing_date=date(2030, 8, 1),
            area_usage_sqm=6,
            **dates,
        )

    def edit(self, plan: PlantingPlan, season: Season, **data):
        return self.client.patch(
            f"{PLANS}{plan.pk}/harvest-actual-dates/?record_season={season.pk}",
            data,
            format="json",
        )

    def details(self, plan: PlantingPlan, season: Season) -> dict:
        response = self.client.get(
            f"{PLANS}{plan.pk}/",
            {
                "across_seasons": "true",
                "record_season": season.pk,
            },
        )
        self.assertEqual(response.status_code, 200, response.data)
        return response.json()

    def test_carried_annual_can_record_a_harvest_crossing_the_planned_season(self):
        origin = self.season("2025-01-01", "2025-12-31")
        spring = self.season("2026-01-01", "2026-06-30")
        summer = self.season("2026-07-01", "2026-08-31")
        plan = PlantingPlan.objects.create(
            project=self.project,
            crop=self.crop,
            bed=self.bed,
            season=origin,
            area_usage_sqm=6,
            planting_date=date(2025, 10, 2),
            harvest_date=date(2026, 6, 10),
            harvest_end_date=date(2026, 6, 20),
            harvest_date_is_explicit=True,
            harvest_end_date_is_explicit=True,
        )
        record = HarvestRecord.objects.create(
            project=self.project,
            crop=self.crop,
            date=date(2026, 6, 11),
            quantity=2,
            unit="kg",
        )
        allocation = HarvestAllocation.objects.create(
            project=self.project,
            harvest=record,
            planting_plan=plan,
            quantity=2,
        )
        task = Task.objects.create(
            project=self.project,
            planting_plan=plan,
            title="Start harvesting",
            season=spring,
            due_date=date(2026, 6, 10),
            status="completed",
        )
        self.assertIsNone(
            self.details(plan, spring)["harvest_actual_occurrences"][0]["actual_start_date"]
        )
        response = self.edit(plan, spring, start_date="2026-06-25", end_date="2026-07-05")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            response.json()["harvest_actual_occurrences"][0],
            {
                "year": None,
                "planned_start_date": "2026-06-10",
                "planned_end_date": "2026-06-20",
                "actual_start_date": "2026-06-25",
                "actual_end_date": "2026-07-05",
            },
        )
        listed = self.client.get(PLANS, HTTP_X_SEASON_ID=str(summer.pk)).json()["results"]
        (annual,) = listed
        self.assertTrue(annual["carried_over"])
        self.assertEqual(annual["harvest_actual_occurrences"][0]["actual_start_date"], "2026-06-25")
        self.assertEqual(annual["harvest_actual_occurrences"][0]["actual_end_date"], "2026-07-05")
        rejected = self.client.patch(
            f"{PLANS}{plan.pk}/",
            {"planting_date": "2026-07-01"},
            format="json",
            HTTP_X_SEASON_ID=str(summer.pk),
        )
        self.assertEqual(rejected.status_code, 404)
        self.assertEqual(self.edit(plan, summer, end_date="2026-06-24").status_code, 400)
        self.assertEqual(self.edit(plan, summer, end_date=None).status_code, 200)
        self.assertEqual(
            self.client.get(PLANS, HTTP_X_SEASON_ID=str(summer.pk)).json()["results"], []
        )
        plan.refresh_from_db()
        self.assertEqual(
            (plan.season_id, plan.bed_id, plan.area_usage_sqm), (origin.pk, self.bed.pk, 6)
        )
        self.assertEqual(plan.planting_date, date(2025, 10, 2))
        self.assertEqual(plan.planned_harvest_dates(), (date(2026, 6, 10), date(2026, 6, 20)))
        self.assertIsNone(plan.clearing_date)
        allocation.refresh_from_db()
        self.assertEqual(allocation.quantity, 2)
        self.assertEqual(allocation.harvest.date, date(2026, 6, 11))
        task.refresh_from_db()
        self.assertEqual((task.status, task.due_date), ("completed", date(2026, 6, 10)))

    def test_perennial_actuals_are_independent_and_legacy_values_are_preserved(self):
        origin = self.season("2025-01-01", "2025-12-31")
        seasons = {
            year: self.season(f"{year}-01-01", f"{year}-12-31") for year in (2026, 2027, 2028)
        }
        plan = self.perennial(origin, "02-29/03-10", actual_harvest_start_date=date(2025, 4, 2))
        for year, actual in ((2026, "2026-03-01"), (2027, "2027-03-02"), (2028, "2028-02-29")):
            response = self.edit(plan, seasons[year], year=year, start_date=actual)
            self.assertEqual(response.status_code, 200, response.data)
            (occurrence,) = response.json()["harvest_actual_occurrences"]
            self.assertEqual(occurrence["year"], year)
            self.assertEqual(occurrence["actual_start_date"], actual)
            self.assertIsNone(occurrence["actual_end_date"])
        self.assertEqual(
            self.edit(plan, seasons[2026], year=2027, start_date=None).status_code, 400
        )
        self.assertEqual(
            self.edit(plan, seasons[2027], year=2027, end_date="2027-02-17").status_code, 400
        )
        self.assertEqual(
            self.edit(plan, seasons[2027], year=2027, start_date="2023-04-01").status_code, 400
        )
        self.assertEqual(
            self.edit(plan, seasons[2026], year=2026, start_date=None).status_code, 200
        )
        legacy = self.details(plan, origin)
        self.assertEqual(legacy["harvest_actual_occurrences"][0]["actual_start_date"], "2025-04-02")
        self.assertEqual(legacy["planting_date"], "2025-03-15")
        self.assertEqual(
            self.details(plan, seasons[2028])["seasonal_harvest"]["periods"],
            [
                {"start_date": "2028-02-29", "end_date": "2028-03-10"},
            ],
        )
        details = self.details(plan, seasons[2027])
        self.assertEqual(details["seasonal_harvest"]["actual_start_date"], "2027-03-02")
        self.assertEqual(
            {
                item["year"]: item["actual_start_date"]
                for item in details["harvest_windows_by_year"]["occurrences"]
            },
            {
                2026: None,
                2027: "2027-03-02",
                2028: "2028-02-29",
                2029: None,
                2030: None,
            },
        )
        self.assertEqual(self.edit(plan, origin, year=2025, start_date=None).status_code, 200)
        self.assertEqual(self.details(plan, origin)["harvest_actual_occurrences"], [])
        plan.refresh_from_db()
        self.assertEqual(plan.actual_harvest_start_date, date(2025, 4, 2))

    def test_cross_year_period_uses_one_key_in_overlapping_seasons(self):
        origin = self.season("2025-01-01", "2025-12-31")
        winter = self.season("2026-10-01", "2026-12-31")
        next_year = self.season("2027-01-01", "2027-12-31")
        overlap = self.season("2026-12-26", "2027-02-01")
        plan = self.perennial(origin, "12-20/01-10")
        response = self.edit(
            plan, winter, year=2026, start_date="2026-12-29", end_date="2027-01-13"
        )
        self.assertEqual(response.status_code, 200, response.data)
        for season in (winter, next_year, overlap):
            occurrences = self.details(plan, season)["harvest_actual_occurrences"]
            (old,) = [item for item in occurrences if item["year"] == 2026]
            self.assertEqual(old["actual_start_date"], "2026-12-29")
            self.assertEqual(old["actual_end_date"], "2027-01-13")
        response = self.edit(plan, next_year, year=2027, start_date="2027-01-12")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(
            self.edit(plan, overlap, year=2026, end_date="2027-01-12").status_code, 200
        )
        plan.refresh_from_db()
        self.assertEqual(list(plan.harvest_occurrence_actuals["occurrences"]), ["2026"])

    def test_lifetime_pages_keep_recorded_years_after_the_forecast_is_shortened(self):
        origin = self.season("2025-01-01", "2025-12-31")
        later = self.season("2052-01-01", "2052-12-31")
        plan = self.perennial(origin, "09-01/10-15")
        plan.clearing_date = date(2055, 1, 1)
        plan.save(update_fields=["clearing_date"])
        recorded = self.edit(plan, later, year=2052, start_date="2052-09-02")
        self.assertEqual(recorded.status_code, 200, recorded.data)
        plan.clearing_date = date(2027, 12, 31)
        plan.save(update_fields=["clearing_date"])
        page = self.details(plan, origin)["harvest_windows_by_year"]
        self.assertEqual([item["year"] for item in page["occurrences"]], [2025, 2026, 2027])
        self.assertEqual(page["next_year"], 2052)
        response = self.client.get(
            f"{PLANS}{plan.pk}/",
            {"across_seasons": "true", "record_season": origin.pk, "harvest_year": 2052},
        )
        self.assertEqual(response.status_code, 200, response.data)
        (old,) = response.json()["harvest_windows_by_year"]["occurrences"]
        self.assertEqual(old["year"], 2052)
        self.assertIsNone(old["default"])
        self.assertEqual(old["actual_start_date"], "2052-09-02")
        self.assertEqual(
            self.details(plan, later)["harvest_actual_occurrences"][0]["actual_start_date"],
            "2052-09-02",
        )

    def test_scoped_edit_rejects_foreign_irrelevant_and_archived_seasons(self):
        origin = self.season("2025-01-01", "2025-12-31")
        later = self.season("2026-01-01", "2026-12-31")
        archived = self.season("2027-01-01", "2027-12-31")
        irrelevant = self.season("2024-01-01", "2024-12-31")
        foreign = Project.objects.create(name="Another project", slug="another-project")
        foreign_season = Season.objects.create(
            project=foreign,
            start_date="2026-01-01",
            end_date="2026-12-31",
        )
        plan = self.perennial(origin, "03-12/04-09")
        payload = {"year": 2026, "start_date": "2026-03-14"}
        for season in (irrelevant, foreign_season):
            self.assertEqual(self.edit(plan, season, **payload).status_code, 404)
        self.assertEqual(self.edit(plan, later, year=2026).status_code, 400)
        Season.objects.filter(pk=archived.pk).update(deleted_at=timezone.now())
        self.assertEqual(
            self.edit(plan, archived, year=2027, start_date="2027-03-14").status_code, 404
        )
        Season.objects.filter(pk=origin.pk).update(deleted_at=timezone.now())
        self.assertEqual(self.edit(plan, later, **payload).status_code, 404)
        plan.refresh_from_db()
        self.assertEqual(plan.harvest_occurrence_actuals, {})
