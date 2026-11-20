"""Crop-loss history, validation, permissions, and seasonal summaries."""

from datetime import date
from decimal import Decimal

from farm.history.project_restore import (
    CHECKPOINT_KEY,
    apply_project_state,
    capture_project_state,
    reconstruct_project_state,
)
from farm.models import (
    Crop,
    CropLoss,
    EntityRevision,
    HarvestAllocation,
    HarvestRecord,
    PlantingPlan,
    Project,
    Season,
)
from farm.tests.api_base import ProjectApiTestCase

LOSSES = "/openfarmplanner/api/crop-losses/"
PLANS = "/openfarmplanner/api/planting-plans/"


class CropLossApiTest(ProjectApiTestCase):
    def setUp(self):
        super().setUp()
        self.earlier = Season.objects.create(
            project=self.project,
            start_date=date(2025, 1, 1),
            end_date=date(2025, 12, 31),
        )
        self.current = Season.objects.create(
            project=self.project,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
        )
        self.client.defaults["HTTP_X_SEASON_ID"] = str(self.current.pk)
        self.crop.harvest_method = "per_sqm"
        self.crop.expected_yield = Decimal("3")
        self.crop.save()
        self.plan = PlantingPlan.objects.create(
            project=self.project,
            season=self.current,
            crop=self.crop,
            bed=self.bed,
            planting_date=date(2026, 5, 1),
            area_usage_sqm=5,
        )

    def record(self, **fields):
        return self.client.post(
            LOSSES,
            {
                "planting_plan": self.plan.pk,
                "date": "2026-05-03",
                "loss_type": "partial",
                "cause": "frost",
                **fields,
            },
            format="json",
        )

    def incidents(self, **query):
        response = self.client.get(LOSSES, query)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data["results"]

    def test_independent_incidents_leave_forecast_and_harvest_intact(self):
        harvest = HarvestRecord.objects.create(
            project=self.project,
            crop=self.crop,
            date=date(2026, 5, 8),
            quantity=4,
            unit="kg",
        )
        HarvestAllocation.objects.create(
            harvest=harvest,
            project=self.project,
            planting_plan=self.plan,
            quantity=3,
        )
        plan_url = f"{PLANS}{self.plan.pk}/"
        before = self.client.get(plan_url).data
        self.assertEqual(before["crop_loss_count"], 0)
        self.assertIsNotNone(before["actual_harvest"]["forecast_kg"])
        forecast_url = "/openfarmplanner/api/yield-calendar/"
        forecast = self.client.get(forecast_url).data

        frost = self.record(extent_unit="percent", extent_value="20.5", note="North side")
        pests = self.record(
            cause="pests", date="2026-05-04", extent_unit="plants", extent_value="3"
        )
        self.assertEqual(frost.status_code, 201, frost.data)
        self.assertEqual(pests.status_code, 201, pests.data)
        self.assertEqual(
            [
                (row["cause"], row["extent_unit"], Decimal(row["extent_value"]))
                for row in self.incidents(planting_plan=self.plan.pk)
            ],
            [("pests", "plants", Decimal(3)), ("frost", "percent", Decimal("20.5"))],
        )
        after = self.client.get(plan_url).data
        self.assertEqual(after["crop_loss_count"], 2)
        self.assertEqual(after["actual_harvest"], before["actual_harvest"])
        self.assertEqual(self.client.get(forecast_url).data, forecast)

        frost_url = f"{LOSSES}{frost.data['id']}/"
        updated = self.client.patch(frost_url, {"loss_type": "total"}, format="json")
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(updated.data["extent_unit"], "")
        self.assertIsNone(updated.data["extent_value"])
        self.assertEqual(updated.data["note"], "North side")
        self.assertEqual(self.client.delete(frost_url).status_code, 204)
        self.assertEqual(self.client.get(plan_url).data["crop_loss_count"], 1)
        self.assertEqual(Decimal(self.incidents()[0]["extent_value"]), Decimal(3))
        self.assertEqual(self.client.get(forecast_url).data, forecast)
        revisions = EntityRevision.objects.filter(
            entity_type="crop_loss", object_id=frost.data["id"]
        )
        self.assertEqual(
            set(revisions.values_list("action", flat=True)), {"created", "updated", "deleted"}
        )

    def test_validates_extent_and_keeps_zero_distinct_from_unrecorded_amount(self):
        invalid = [
            {"extent_value": "0"},
            {"extent_unit": "plants"},
            {"extent_unit": "percent", "extent_value": "100.001"},
            {"extent_unit": "plants", "extent_value": "1.250"},
            {"extent_unit": "sqm", "extent_value": "-0.100"},
            {"extent_unit": "sqm", "extent_value": "0.1234"},
            {"loss_type": "total", "extent_unit": "percent", "extent_value": "100"},
            {"cause": "unknown"},
            {"date": "2026-02-29"},
        ]
        for fields in invalid:
            with self.subTest(fields=fields):
                response = self.record(**fields)
                self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(CropLoss.objects.exists())
        for cause, extent_fields in (
            ("waterlogging", {"extent_unit": "sqm", "extent_value": "1.25"}),
            ("drought", {"extent_unit": "percent", "extent_value": "0"}),
            ("other", {}),
            ("disease", {"loss_type": "total"}),
        ):
            with self.subTest(cause=cause):
                response = self.record(cause=cause, **extent_fields)
                self.assertEqual(response.status_code, 201, response.data)
        self.assertIsNone(CropLoss.objects.get(cause="other").extent_value)
        self.assertEqual(CropLoss.objects.get(cause="drought").extent_value, Decimal(0))

    def test_uses_event_date_for_season_summary_and_keeps_one_original_plan(self):
        carry = PlantingPlan.objects.create(
            project=self.project,
            season=self.earlier,
            crop=self.crop,
            bed=self.bed,
            planting_date=date(2025, 12, 28),
            area_usage_sqm=5,
        )
        for day in ("2025-12-30", "2026-01-03", "2026-01-04"):
            response = self.record(planting_plan=carry.pk, date=day)
            self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(len(self.incidents()), 2)
        self.assertEqual(len(self.incidents(planting_plan=carry.pk)), 3)
        for season, count in ((self.earlier, 1), (self.current, 2)):
            response = self.client.get(PLANS, HTTP_X_SEASON_ID=str(season.pk))
            self.assertEqual(response.status_code, 200, response.data)
            row = next(row for row in response.data["results"] if row["id"] == carry.pk)
            self.assertEqual(row["crop_loss_count"], count)
        self.assertEqual(PlantingPlan.objects.get(pk=carry.pk).season_id, self.earlier.pk)

    def test_enforces_project_scope_and_keeps_plan_link_fixed(self):
        other = Project.objects.create(name="Other project", slug="other-project")
        crop = Crop.objects.create(name="Other crop", project=other)
        foreign = PlantingPlan.objects.create(
            project=other, crop=crop, planting_date=date(2026, 5, 1)
        )
        foreign_loss = CropLoss.objects.create(
            project=other,
            planting_plan=foreign,
            date=date(2026, 5, 2),
            loss_type="partial",
            cause="frost",
        )
        self.assertEqual(self.record(planting_plan=foreign.pk).status_code, 400)
        self.assertEqual(self.incidents(planting_plan=foreign.pk), [])
        self.assertEqual(self.client.get(f"{LOSSES}{foreign_loss.pk}/").status_code, 404)
        created = self.record()
        alternate = PlantingPlan.objects.create(
            project=self.project, crop=self.crop, season=self.current
        )
        response = self.client.patch(
            f"{LOSSES}{created.data['id']}/", {"planting_plan": alternate.pk}, format="json"
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(CropLoss.objects.get(pk=created.data["id"]).planting_plan_id, self.plan.pk)

    def test_accepts_pre_loss_project_checkpoints_and_preserves_the_backup(self):
        before = capture_project_state(self.project)
        del before["crop_loss"]
        checkpoint = EntityRevision.objects.create(
            project=self.project,
            entity_type="project",
            object_id=self.project.pk,
            action=EntityRevision.ACTION_UPDATED,
            snapshot={CHECKPOINT_KEY: before},
        )
        result = self.record(extent_unit="plants", extent_value="4")
        self.assertEqual(result.status_code, 201, result.data)
        backup = capture_project_state(self.project)
        apply_project_state(
            self.project, reconstruct_project_state(self.project, checkpoint, backup), backup
        )
        self.assertEqual(self.incidents(), [])
        apply_project_state(self.project, backup, capture_project_state(self.project))
        self.assertEqual(Decimal(self.incidents()[0]["extent_value"]), Decimal(4))
