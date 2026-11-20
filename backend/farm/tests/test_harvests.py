"""Dated harvest recording, allocation, conversions and seasonal totals."""

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
    EntityRevision,
    HarvestAllocation,
    HarvestRecord,
    PlantingPlan,
    Project,
    PublicCrop,
    Season,
)
from farm.tests.api_base import ProjectApiTestCase

HARVESTS = "/openfarmplanner/api/harvests/"
PLANS = "/openfarmplanner/api/planting-plans/"


class HarvestApiTest(ProjectApiTestCase):
    def setUp(self):
        super().setUp()
        self.earlier = self.season(2025)
        self.current = self.season(2026)
        self.client.defaults["HTTP_X_SEASON_ID"] = str(self.current.pk)
        self.crop.harvest_method = "per_sqm"
        self.crop.expected_yield = Decimal("3")
        self.crop.default_harvest_unit = "piece"
        self.crop.average_harvest_piece_weight_g = Decimal(80)
        self.crop.save()

    def season(self, year):
        return Season.objects.create(
            project=self.project,
            start_date=date(year, 1, 1),
            end_date=date(year, 12, 31),
        )

    def plan(self, planted=date(2026, 5, 1), season=None, crop=None, **kwargs):
        return PlantingPlan.objects.create(
            project=self.project,
            season=season or self.current,
            crop=crop or self.crop,
            bed=self.bed,
            planting_date=planted,
            area_usage_sqm=Decimal("5"),
            **kwargs,
        )

    def harvest(self, **attrs):
        return self.client.post(
            HARVESTS,
            {
                "crop": self.crop.pk,
                "date": "2026-05-08",
                "unit": "kg",
                "quantity": "12",
                **attrs,
            },
            format="json",
        )

    @staticmethod
    def allocation(plan, quantity, area=None):
        return {"planting_plan": plan.pk, "quantity": quantity, "harvested_area_sqm": area}

    def total(self, plan):
        response = self.client.get(f"{PLANS}{plan.pk}/")
        self.assertEqual(response.status_code, 200, response.data)
        return response.data["actual_harvest"]

    def test_unassigned_and_split_records_contribute_once_and_edits_replace_allocations(self):
        first = self.plan()
        second = self.plan(planted=date(2026, 5, 2))
        created = self.harvest(note="First picking")
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data["allocations"], [])
        self.assertEqual(created.data["unallocated_quantity"], "12")
        self.assertIsNone(self.total(first))

        detail = f"{HARVESTS}{created.data['id']}/"
        split = self.client.patch(
            detail,
            {
                "allocations": [
                    self.allocation(first, "8", "2"),
                    self.allocation(second, "3"),
                ]
            },
            format="json",
        )
        self.assertEqual(split.status_code, 200, split.data)
        self.assertEqual(split.data["unallocated_quantity"], "1")
        self.assertEqual(split.data["allocations"][0]["kilograms_per_harvested_sqm"], "4")
        self.assertEqual(self.total(first)["forecast_kg"], "15")
        self.assertEqual(self.total(first)["actual_kg_per_sqm"], "1.6")
        self.assertEqual(self.total(first)["forecast_percentage"], "53.333333")
        self.assertEqual(self.total(second)["measured_kg"], "3")

        repeat = self.harvest(
            unit="g", quantity="1200", allocations=[self.allocation(first, "800")]
        )
        self.assertEqual(repeat.status_code, 201, repeat.data)
        self.assertEqual(self.total(first)["quantities"], [{"unit": "kg", "quantity": "8.8"}])
        summary = self.client.get(f"{HARVESTS}summary/")
        self.assertEqual(summary.data["quantities"], [{"unit": "kg", "quantity": "13.2"}])

        revised = self.client.patch(
            detail,
            {
                "quantity": "7",
                "allocations": [self.allocation(second, "6")],
            },
            format="json",
        )
        self.assertEqual(revised.status_code, 200, revised.data)
        self.assertEqual(self.total(first)["measured_kg"], "0.8")
        self.assertEqual(self.total(second)["measured_kg"], "6")
        self.assertEqual(self.client.delete(detail).status_code, 204)
        self.assertIsNone(self.total(second))
        self.assertEqual(self.client.get(f"{HARVESTS}summary/").data["measured_kg"], "1.2")

    def test_validates_total_unique_plan_area_positive_values_and_project_scope(self):
        plan = self.plan()
        other_project = Project.objects.create(name="Other Harvest Project")
        other_crop = Crop.objects.create(project=other_project, name="Other harvest crop")
        outside = PlantingPlan.objects.create(project=other_project, crop=other_crop)
        for patch in (
            {"quantity": "0"},
            {"unit": "litre"},
            {"grams_per_unit": "50"},
            {"crop": other_crop.pk},
            {"allocations": [self.allocation(plan, "13")]},
            {"allocations": [self.allocation(plan, "2"), self.allocation(plan, "3")]},
            {"allocations": [self.allocation(plan, "3", "6")]},
            {"allocations": [self.allocation(outside, "6")]},
        ):
            with self.subTest(patch=patch):
                rejected = self.harvest(**patch)
                self.assertEqual(rejected.status_code, 400, rejected.data)
        self.assertEqual(HarvestRecord.objects.count(), 0)
        self.assertEqual(HarvestAllocation.objects.count(), 0)

    def test_suggestions_and_record_dates_include_prior_annual_and_perennial_plans(self):
        self.crop.life_cycle = "annual"
        self.crop.growth_duration_days = 120
        self.crop.harvest_duration_days = 25
        self.crop.save()
        annual = self.plan(date(2025, 10, 1), self.earlier)
        perennial_crop = Crop.objects.create(
            project=self.project,
            name="Rhubarb",
            life_cycle="perennial",
            standing_time_years=6,
        )
        perennial = self.plan(
            date(2025, 4, 1), self.earlier, perennial_crop, clearing_date=date(2031, 4, 1)
        )
        old_scope = {"HTTP_X_SEASON_ID": str(self.earlier.pk)}
        new_scope = {"HTTP_X_SEASON_ID": str(self.current.pk)}
        suggestion_url = f"{HARVESTS}suggestions/"
        for crop, plan in ((self.crop, annual), (perennial_crop, perennial)):
            with self.subTest(crop=crop.name):
                found = self.client.get(suggestion_url, {"crop": crop.pk, "date": "2026-02-01"})
                self.assertEqual(found.status_code, 200, found.data)
                self.assertEqual([row["id"] for row in found.data], [plan.pk])
                created = self.harvest(
                    crop=crop.pk,
                    date="2026-02-01",
                    quantity="2",
                    allocations=[self.allocation(plan, "2")],
                )
                self.assertEqual(created.status_code, 201, created.data)
                self.assertEqual(
                    self.total(plan)["forecast_percentage"],
                    "13.333333" if plan.pk == annual.pk else None,
                )
        none = self.client.get(suggestion_url, {"crop": self.crop.pk, "date": "2027-03-01"})
        self.assertEqual(none.data, [])
        newest = self.plan(date(2026, 1, 21))
        many = self.client.get(suggestion_url, {"crop": self.crop.pk, "date": "2026-02-01"})
        self.assertEqual([row["id"] for row in many.data], [annual.pk, newest.pk])
        self.assertEqual(self.client.get(HARVESTS, **old_scope).data["count"], 0)
        self.assertEqual(self.client.get(HARVESTS, **new_scope).data["count"], 2)
        self.assertEqual(
            self.client.get(f"{HARVESTS}summary/", **new_scope).data["measured_kg"], "4"
        )
        self.assertEqual(
            self.client.get(HARVESTS, {"planting_plan": annual.pk}, **old_scope).data["count"], 1
        )
        annual.refresh_from_db()
        perennial.refresh_from_db()
        self.assertEqual(
            [annual.season_id, perennial.season_id], [self.earlier.pk, self.earlier.pk]
        )
        self.assertEqual(PlantingPlan.objects.count(), 3)

    def test_estimates_use_the_saved_factor_and_unconvertible_quantities_suppress_comparison(self):
        public = PublicCrop.objects.create(
            name="Reference harvest", average_harvest_piece_weight_g=80
        )
        self.crop.source_public_crop = public
        self.crop.save()
        plan = self.plan()
        counted = self.harvest(unit="piece", quantity="5", allocations=[self.allocation(plan, "5")])
        self.assertEqual(counted.status_code, 201, counted.data)
        self.assertEqual(counted.data["conversion_source"], "library")
        self.assertEqual(counted.data["estimated_kg"], "0.4")
        self.assertIsNone(counted.data["measured_kg"])

        self.crop.average_harvest_piece_weight_g = Decimal(100)
        self.crop.save()
        detail = f"{HARVESTS}{counted.data['id']}/"
        updated = self.client.patch(detail, {"note": "Retain original factor"}, format="json")
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(updated.data["estimated_kg"], "0.4")
        manual = self.client.patch(detail, {"grams_per_unit": "90"}, format="json")
        self.assertEqual(manual.data["conversion_source"], "manual")
        self.assertEqual(manual.data["estimated_kg"], "0.45")

        measured = self.harvest(quantity="4", allocations=[self.allocation(plan, "4")])
        self.assertEqual(measured.status_code, 201, measured.data)
        totals = self.total(plan)
        self.assertEqual(
            totals["quantities"],
            [
                {"unit": "kg", "quantity": "4"},
                {"unit": "piece", "quantity": "5"},
            ],
        )
        self.assertEqual(totals["estimated_kg"], "0.45")
        self.assertIsNotNone(totals["forecast_percentage"])
        bunch = self.harvest(unit="bunch", quantity="3", allocations=[self.allocation(plan, "3")])
        self.assertEqual(bunch.status_code, 201, bunch.data)
        self.assertIsNone(bunch.data["estimated_kg"])
        self.assertIsNone(self.total(plan)["forecast_percentage"])

    def test_project_restore_accepts_pre_harvest_checkpoints_and_retains_their_backup(self):
        plan = self.plan()
        old_state = capture_project_state(self.project)
        for label in ("harvest_record", "harvest_allocation"):
            del old_state[label]
        checkpoint = EntityRevision.objects.create(
            project=self.project, entity_type="project", object_id=self.project.pk,
            action=EntityRevision.ACTION_UPDATED, snapshot={CHECKPOINT_KEY: old_state},
        )
        harvest = self.harvest(allocations=[self.allocation(plan, "6")])
        self.assertEqual(harvest.status_code, 201, harvest.data)
        backup = capture_project_state(self.project)
        target = reconstruct_project_state(self.project, checkpoint, backup)
        apply_project_state(self.project, target, backup)
        self.assertFalse(HarvestRecord.objects.filter(project=self.project).exists())
        self.assertTrue(PlantingPlan.objects.filter(pk=plan.pk).exists())
        apply_project_state(self.project, backup, capture_project_state(self.project))
        restored = HarvestAllocation.objects.get(planting_plan=plan)
        self.assertEqual(restored.quantity, Decimal("6"))
        self.assertEqual(restored.harvest.quantity, Decimal("12"))
