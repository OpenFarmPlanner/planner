"""Lineage and read-only actuals on copied planting plans."""

from datetime import date

from farm.history.project_restore import apply_project_state, capture_project_state
from farm.models import (
    Crop,
    CropLoss,
    HarvestAllocation,
    HarvestRecord,
    PlantingPlan,
    Project,
    Season,
)
from farm.tests.api_base import ProjectApiTestCase

PLANS = "/openfarmplanner/api/planting-plans/"
SEASONS = "/openfarmplanner/api/seasons/"


class PlantingPlanCopyReferenceTest(ProjectApiTestCase):
    def setUp(self):
        super().setUp()
        self.source_season = self.season(2025, "Source from autumn to late summer")
        self.target_season = self.season(2026, "Next season")
        self.source = PlantingPlan.objects.create(
            project=self.project,
            season=self.source_season,
            bed=self.bed,
            crop=self.crop,
            cultivation_type="pre_cultivation",
            planting_date=date(2026, 3, 10),
            actual_propagation_start_date=date(2026, 2, 20),
            actual_sowing_date=date(2026, 2, 23),
            actual_transplanting_date=date(2026, 3, 12),
            actual_harvest_start_date=date(2026, 3, 21),
            recorded_harvest_end_date=date(2026, 3, 25),
        )

    def season(self, year, label):
        return Season.objects.create(
            project=self.project,
            start_date=date(year, 9, 1),
            end_date=date(year + 1, 8, 31),
            custom_label=label,
        )

    def copy(self, source, target, **options):
        response = self.client.post(
            f"{SEASONS}{target.pk}/copy-from/",
            {
                "source_season_id": source.pk,
                **options,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        return PlantingPlan.objects.filter(season=target).latest("pk")

    def details(self, plan):
        response = self.client.get(f"{PLANS}{plan.pk}/", {"across_seasons": "true"})
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def harvest(self, day, unit, amount, *, allocated=True):
        record = HarvestRecord.objects.create(
            project=self.project,
            crop=self.crop,
            date=day,
            unit=unit,
            quantity=amount,
        )
        if allocated:
            HarvestAllocation.objects.create(
                project=self.project,
                harvest=record,
                planting_plan=self.source,
                quantity=amount,
            )

    def test_source_actuals_are_live_and_dates_and_units_stay_separate(self):
        self.harvest(date(2026, 3, 21), "kg", 2)
        self.harvest(date(2026, 3, 22), "g", 750)
        self.harvest(date(2026, 3, 23), "piece", 3)
        self.harvest(date(2026, 3, 21), "kg", 90, allocated=False)
        self.harvest(date(2026, 9, 4), "kg", 7)
        for day in (date(2026, 3, 18), date(2026, 9, 4)):
            CropLoss.objects.create(
                project=self.project,
                planting_plan=self.source,
                date=day,
                loss_type="partial",
                cause="frost",
            )
        normal = self.copy(self.source_season, self.target_season)
        actual_based = self.copy(self.source_season, self.target_season, use_actual_dates=True)
        self.assertEqual(normal.planting_date, date(2027, 3, 10))
        self.assertEqual(actual_based.planting_date, date(2027, 3, 12))
        self.assertIsNone(self.details(self.source)["previous_season_reference"])
        listed = self.client.get(PLANS, HTTP_X_SEASON_ID=str(self.target_season.pk)).data["results"]
        self.assertEqual({row["id"] for row in listed}, {normal.pk, actual_based.pk})
        self.assertTrue(all("previous_season_reference" not in row for row in listed))
        for copy in (normal, actual_based):
            with self.subTest(copy=copy.pk):
                self.assertEqual(copy.copied_from_plan_id, self.source.pk)
                details = self.details(copy)
                self.assertTrue(
                    all(details[field] is None for field in PlantingPlan.ACTUAL_DATE_FIELDS)
                )
                self.assertIsNone(details["actual_harvest"])
                self.assertEqual(details["crop_loss_count"], 0)
                reference = details["previous_season_reference"]
                self.assertEqual(reference["source_plan_id"], self.source.pk)
                self.assertEqual(reference["source_season_id"], self.source_season.pk)
                self.assertEqual(reference["source_season_label"], self.source_season.custom_label)
                self.assertEqual(
                    reference["actual_dates"],
                    {
                        "actual_propagation_start_date": "2026-02-20",
                        "actual_sowing_date": "2026-02-23",
                        "actual_transplanting_date": "2026-03-12",
                        "actual_harvest_start_date": "2026-03-21",
                        "recorded_harvest_end_date": "2026-03-25",
                    },
                )
                self.assertEqual(
                    reference["harvest_quantities"],
                    [
                        {"unit": "kg", "quantity": "2.75"},
                        {"unit": "piece", "quantity": "3"},
                    ],
                )
                self.assertEqual(reference["crop_loss_count"], 1)
        edited = self.client.patch(
            f"{PLANS}{self.source.pk}/",
            {
                "recorded_harvest_end_date": "2026-03-26",
            },
            format="json",
        )
        self.assertEqual(edited.status_code, 200, edited.data)
        reference = self.details(normal)["previous_season_reference"]
        self.assertEqual(reference["actual_dates"]["recorded_harvest_end_date"], "2026-03-26")

    def test_repeated_copies_follow_the_direct_plan_even_after_a_bed_change(self):
        following = self.season(2027, "Following season")
        middle = self.copy(self.source_season, self.target_season)
        moved = self.client.patch(f"{PLANS}{middle.pk}/", {"bed": None}, format="json")
        self.assertEqual(moved.status_code, 200, moved.data)
        denied = self.client.post(
            f"{SEASONS}{following.pk}/copy-from/",
            {
                "source_season_id": self.source_season.pk,
            },
            format="json",
        )
        self.assertEqual(denied.status_code, 400, denied.data)
        self.assertFalse(PlantingPlan.objects.filter(season=following).exists())

        latest = self.copy(self.target_season, following)
        middle_reference = self.details(middle)["previous_season_reference"]
        self.assertEqual(middle_reference["source_plan_id"], self.source.pk)
        latest_reference = self.details(latest)["previous_season_reference"]
        self.assertEqual(latest_reference["source_plan_id"], middle.pk)
        self.assertEqual(latest_reference["actual_dates"], {})
        self.assertEqual(latest_reference["harvest_quantities"], [])
        self.assertEqual(latest_reference["crop_loss_count"], 0)

    def test_deleted_source_has_an_unavailable_marker_and_history_recovers_link(self):
        copied = self.copy(self.source_season, self.target_season)
        baseline = capture_project_state(self.project)
        removed = self.client.delete(f"{PLANS}{self.source.pk}/")
        self.assertEqual(removed.status_code, 204, removed.data)
        copied.refresh_from_db()
        self.assertTrue(copied.is_season_copy)
        self.assertIsNone(copied.copied_from_plan_id)
        self.assertEqual(self.details(copied)["previous_season_reference"], {"available": False})
        apply_project_state(self.project, baseline, capture_project_state(self.project))
        self.assertEqual(
            self.details(copied)["previous_season_reference"]["source_plan_id"],
            self.source.pk,
        )

    def test_api_cannot_supply_lineage_and_cross_project_source_is_unavailable(self):
        created = self.client.post(
            PLANS,
            {
                "crop": self.crop.pk,
                "season": self.target_season.pk,
                "planting_date": "2027-03-10",
                "copied_from_plan": self.source.pk,
                "is_season_copy": True,
            },
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.data)
        ordinary = PlantingPlan.objects.get(pk=created.data["id"])
        self.assertIsNone(self.details(ordinary)["previous_season_reference"])

        foreign_project = Project.objects.create(name="Foreign project", slug="foreign-project")
        foreign_crop = Crop.objects.create(name="Foreign crop", project=foreign_project)
        foreign_season = Season.objects.create(
            project=foreign_project,
            start_date=date(2025, 9, 1),
            end_date=date(2026, 8, 31),
            custom_label="Foreign season",
        )
        foreign = PlantingPlan.objects.create(
            project=foreign_project,
            crop=foreign_crop,
            season=foreign_season,
            actual_sowing_date=date(2026, 5, 1),
        )
        copied = self.copy(self.source_season, self.target_season)
        PlantingPlan.objects.filter(pk=copied.pk).update(copied_from_plan=foreign)
        details = self.details(copied)
        self.assertEqual(details["previous_season_reference"], {"available": False})
        self.assertNotIn("copied_from_plan", details)
