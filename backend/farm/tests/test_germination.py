"""Germination fields, inheritance, spreadsheet conversion and plan hints."""

from datetime import date

from django.core.exceptions import ValidationError

from crops.models import CropSpecies
from farm.crops.serializers.public import (
    PublicCropChangeProposalSerializer,
    PublicCropUpdateSerializer,
)
from farm.models import Crop, CropTimingWindow, PlantingPlan, PublicCrop, Season
from farm.services.crop_import.spreadsheet import apply_crop_import, preview_crop_import
from farm.services.crop_inheritance import resolve_crop_field
from farm.services.germination_check import check_germination
from farm.services.timing_window_check import TimingWindowChecker
from farm.tests.api_base import ProjectApiTestCase


class GerminationTest(ProjectApiTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.crop.germination_types = ["cold", "light"]
        self.crop.germination_days_min = 7
        self.crop.germination_days_max = 14
        self.crop.propagation_duration_days = 10
        self.crop.save()

    def check(self, day: date | None, kind: str = "direct_sowing") -> dict:
        return check_germination(
            PlantingPlan(
                project=self.project,
                crop=self.crop,
                planting_date=day,
                cultivation_type=kind,
            ),
            TimingWindowChecker(self.project.pk),
        )

    def test_warm_season_boundaries_and_cold_requirements(self) -> None:
        for kind in ("cold", "frost"):
            self.crop.germination_types = [kind]
            self.crop.save()
            for day, flagged in (
                (date(2026, 3, 31), False),
                (date(2026, 4, 1), True),
                (date(2026, 8, 31), True),
                (date(2026, 9, 1), False),
            ):
                with self.subTest(kind=kind, day=day):
                    self.assertEqual(bool(self.check(day)["germination_findings"]), flagged)
        for kind in ("light", "dark"):
            self.crop.germination_types = [kind]
            self.crop.save()
            self.assertEqual(self.check(date(2026, 6, 1))["germination_findings"], [])

    def test_sowing_date_and_emergence_for_direct_and_transplanted_plans(self) -> None:
        direct = self.check(date(2026, 4, 1))
        self.assertEqual(direct["expected_emergence"], {"min": "2026-04-08", "max": "2026-04-15"})
        propagated = self.check(date(2026, 4, 5), "pre_cultivation")
        self.assertEqual(
            propagated["germination_findings"],
            [
                {"code": "propagation_shorter_than_germination"},
            ],
        )
        self.assertEqual(
            propagated["expected_emergence"], {"min": "2026-04-02", "max": "2026-04-09"}
        )
        self.assertEqual(
            self.check(date(2026, 6, 1), "purchased_transplant"),
            {
                "germination_findings": [],
                "expected_emergence": None,
            },
        )
        self.crop.propagation_duration_days = 14
        self.assertEqual(
            self.check(date(2026, 3, 1), "pre_cultivation")["germination_findings"], []
        )

    def test_matching_sowing_window_suppresses_only_the_cold_hint(self) -> None:
        CropTimingWindow.objects.create(
            crop=self.crop,
            kind="pre_cultivation",
            unit="iso_week",
            start_week=20,
            end_week=25,
        )
        self.assertEqual(
            self.check(date(2026, 6, 1), "pre_cultivation")["germination_findings"],
            [
                {"code": "propagation_shorter_than_germination"},
            ],
        )
        self.assertEqual(
            self.check(date(2026, 6, 1))["germination_findings"],
            [
                {"code": "cold_period_required"},
            ],
        )

    def test_missing_values_and_overflow(self) -> None:
        self.assertIsNone(self.check(None)["expected_emergence"])
        self.assertIsNone(self.check(date.max)["expected_emergence"])
        self.crop.propagation_duration_days = None
        self.assertIsNone(self.check(date(2026, 6, 1), "pre_cultivation")["expected_emergence"])
        self.crop.germination_days_min = None
        self.assertEqual(
            self.check(date(2026, 1, 1))["expected_emergence"],
            {
                "min": "2026-01-15",
                "max": "2026-01-15",
            },
        )

    def test_variety_inherits_and_can_override_germination(self) -> None:
        species = CropSpecies.objects.create(name="Germination species")
        self.crop.crop_species = species
        self.crop.save()
        variety = Crop.objects.create(
            name=self.crop.name,
            variety="Early",
            project=self.project,
            crop_species=species,
        )
        self.assertEqual(resolve_crop_field(variety, "germination_days_max"), 14)
        self.assertEqual(resolve_crop_field(variety, "germination_types"), ["cold", "light"])
        inherited_plan = PlantingPlan(
            project=self.project,
            crop=variety,
            planting_date=date(2026, 6, 1),
            cultivation_type="direct_sowing",
        )
        inherited = check_germination(inherited_plan, TimingWindowChecker(self.project.pk))
        self.assertEqual(inherited["germination_findings"], [{"code": "cold_period_required"}])
        self.assertEqual(inherited["expected_emergence"]["max"], "2026-06-15")
        from farm.services.public_crops import build_public_crop_payload

        payload = build_public_crop_payload(variety)
        self.assertEqual(payload["germination_days_max"], 14)
        self.assertEqual(payload["germination_types"], ["cold", "light"])
        variety.germination_days_min = 2
        variety.germination_days_max = 5
        variety.germination_types = ["dark"]
        variety.save()
        self.assertEqual(resolve_crop_field(variety, "germination_days_max"), 5)
        self.assertEqual(resolve_crop_field(variety, "germination_types"), ["dark"])
        self.crop.germination_types = ["frost"]
        self.crop.save()
        self.crop = variety
        result = self.check(date(2026, 6, 1))
        self.assertEqual(result["germination_findings"], [])

    def test_api_and_public_edit_validate_ranges_and_types(self) -> None:
        url = f"/openfarmplanner/api/crops/{self.crop.pk}/"
        for data in (
            {"germination_days_max": 2},
            {"germination_days_min": -1},
            {"germination_days_max": 1.5},
            {"germination_types": ["invalid"]},
            {"germination_types": ["cold", "cold"]},
            {
                "germination_temperature_optimal_min_c": 25,
                "germination_temperature_optimal_max_c": 18,
            },
        ):
            with self.subTest(data=data):
                self.assertEqual(self.client.patch(url, data, format="json").status_code, 400)
                serializer = PublicCropUpdateSerializer(
                    instance=PublicCrop(germination_days_min=7, germination_days_max=14),
                    data=data,
                    partial=True,
                )
                self.assertFalse(serializer.is_valid())
        self.crop.germination_types = [dict(invalid=True)]
        with self.assertRaises(ValidationError):
            self.crop.clean()

    def test_proposal_validates_partial_ranges_against_the_current_entry(self) -> None:
        public = PublicCrop(germination_days_min=7, germination_days_max=14)
        invalid = PublicCropChangeProposalSerializer(
            data={"summary": "Earlier germination", "proposed_data": {"germination_days_max": 5}},
            context={"public_crop": public},
        )
        self.assertFalse(invalid.is_valid())
        valid = PublicCropChangeProposalSerializer(
            data={
                "summary": "Earlier germination",
                "proposed_data": {
                    "germination_days_min": 2,
                    "germination_days_max": 5,
                },
            },
            context={"public_crop": public},
        )
        self.assertTrue(valid.is_valid(), valid.errors)

    def test_spreadsheet_ranges_preview_and_apply(self) -> None:
        row = {
            "name": self.crop.name,
            "germination_temperature_optimal": "18–25",
            "germination_days": "10-20",
            "germination_cold": True,
            "germination_light": True,
            "germination_pretreatment": "Chill four weeks.",
        }
        preview = preview_crop_import(self.project, [dict(row)])[0]
        self.assertEqual(preview["status"], "update_candidate")
        self.assertIn("germination_days_max", [change["field"] for change in preview["diff"]])
        applied = apply_crop_import(self.project, [dict(row)], confirm_updates=True)
        self.assertEqual(applied["updated_count"], 1, applied)
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.germination_days_max, 20)
        self.assertEqual(self.crop.germination_types, ["cold", "light"])
        self.assertEqual(self.crop.germination_temperature_optimal_min_c, 18)
        result = apply_crop_import(
            self.project,
            [
                {
                    "name": "Single value",
                    "germination_days": "7",
                }
            ],
            confirm_updates=True,
        )
        self.assertEqual(result["created_count"], 1, result)
        single = Crop.objects.get(name="Single value")
        self.assertEqual((single.germination_days_min, single.germination_days_max), (7, 7))

    def test_a_rejected_range_cell_is_reported_and_only_that_cell_is_dropped(self) -> None:
        row = {
            "name": "Kartoffeln",
            "variety": "Linda",
            "germination_days": "fk",
            "germination_temperature_optimal": "8-12",
        }
        issue = {
            "field": "germination_days",
            "value": "fk",
            "code": "range_not_recognized",
            "message": "Enter a number or a range such as 18–25.",
        }
        preview = preview_crop_import(self.project, [dict(row)])[0]
        self.assertEqual(preview["status"], "create", preview)
        self.assertEqual(preview["timing_window_issues"], [issue])
        applied = apply_crop_import(self.project, [dict(row)], confirm_updates=True)
        self.assertEqual(applied["created_count"], 1, applied)
        self.assertEqual(applied["timing_window_issues"], [{"index": 0, **issue}])
        crop = Crop.objects.get(name="Kartoffeln", variety="Linda")
        self.assertEqual((crop.germination_days_min, crop.germination_days_max), (None, None))
        self.assertEqual(crop.germination_temperature_optimal_min_c, 8)

    def test_saved_and_live_plan_checks_agree(self) -> None:
        season = Season.objects.create(
            project=self.project,
            start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31),
        )
        plan = PlantingPlan.objects.create(
            project=self.project,
            season=season,
            crop=self.crop,
            bed=self.bed,
            planting_date=date(2026, 6, 1),
            cultivation_type="pre_cultivation",
            area_usage_sqm=2,
        )
        saved = self.client.get(f"/openfarmplanner/api/planting-plans/{plan.pk}/").data
        live = self.client.get(
            "/openfarmplanner/api/planting-plans/timing-window-check/",
            {
                "crop_id": self.crop.pk,
                "planting_date": "2026-06-01",
                "cultivation_type": "pre_cultivation",
            },
        )
        self.assertEqual(live.status_code, 200, live.data)
        for field in ("germination_findings", "expected_emergence"):
            self.assertEqual(saved[field], live.data[field])
        self.assertEqual(len(saved["germination_findings"]), 2)


class GerminationRequirementsTest(ProjectApiTestCase):
    def test_canonical_requirements_round_trip_and_preserve_explicit_none_for_old_clients(self) -> None:
        url = f'/openfarmplanner/api/crops/{self.crop.pk}/'
        values = {
            'germination_temperature_requirement': 'cold_stratification',
            'germination_light_requirement': 'light',
            'stratification_days_min': 0, 'stratification_days_max': 28,
            'stratification_temperature_min_c': -5.5, 'stratification_temperature_max_c': 4.5,
            'germination_temperature_optimal_min_c': 18,
        }
        response = self.client.patch(url, values, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        for field, value in values.items():
            self.assertEqual(response.data[field], value)
        self.assertEqual(response.data['germination_types'], ['cold', 'light'])
        response = self.client.patch(url, {'germination_temperature_requirement': 'none'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['germination_types'], ['light'])
        # An old client resends the unchanged list while editing another field.
        response = self.client.patch(url, {'germination_types': ['light'], 'notes': 'Old client edit'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['germination_temperature_requirement'], 'none')
        self.assertEqual(response.data['stratification_temperature_min_c'], -5.5)

    def test_ranges_validate_partial_patch_and_allow_empty_or_negative_temperature(self) -> None:
        public = PublicCrop(stratification_days_min=14, stratification_temperature_min_c=-5)
        for data in (
            {'stratification_days_max': 7}, {'stratification_days_min': -1},
            {'stratification_days_min': 1.5}, {'stratification_temperature_max_c': -6},
            {'stratification_temperature_min_c': -274},
            {'germination_light_requirement': 'light,dark'},
            {'germination_temperature_requirement': 'invalid'},
        ):
            serializer = PublicCropUpdateSerializer(instance=public, data=data, partial=True)
            self.assertFalse(serializer.is_valid(), data)
        serializer = PublicCropUpdateSerializer(
            instance=public,
            data={'stratification_days_min': None, 'stratification_temperature_max_c': -1.5}, partial=True,
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_conflicting_legacy_values_survive_edit_and_spreadsheet_round_trip(self) -> None:
        self.crop.germination_types = ['cold', 'frost', 'light', 'dark']
        self.crop.save()
        self.assertEqual(self.crop.germination_temperature_requirement, '')
        self.assertEqual(self.crop.germination_light_requirement, '')
        response = self.client.patch(
            f'/openfarmplanner/api/crops/{self.crop.pk}/',
            {'notes': 'Keep conflicts', 'germination_temperature_requirement': '', 'germination_light_requirement': ''},
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['germination_types'], ['cold', 'frost', 'light', 'dark'])
        row = {
            'name': 'Portable conflict', 'germination_types': ['cold', 'frost', 'light', 'dark'],
            'germination_temperature_requirement': '', 'germination_light_requirement': '',
            'stratification_days_min': 14, 'stratification_temperature_min_c': -5,
        }
        result = apply_crop_import(self.project, [row], confirm_updates=True)
        self.assertEqual(result['created_count'], 1, result)
        created = Crop.objects.get(project=self.project, name='Portable conflict')
        self.assertEqual(created.germination_types, row['germination_types'])
        self.assertIsNone(created.stratification_days_max)
        self.assertIsNone(created.stratification_temperature_max_c)

    def test_requirements_inherit_and_explicit_none_overrides(self) -> None:
        species = CropSpecies.objects.create(name='Canonical requirements species')
        self.crop.crop_species = species
        self.crop.germination_temperature_requirement = 'cold_stratification'
        self.crop.germination_light_requirement = 'light'
        self.crop.stratification_days_min = 14
        self.crop.save()
        variety = Crop.objects.create(name=self.crop.name, variety='Early', project=self.project, crop_species=species)
        self.assertEqual(resolve_crop_field(variety, 'germination_temperature_requirement'), 'cold_stratification')
        self.assertEqual(resolve_crop_field(variety, 'stratification_days_min'), 14)
        response = self.client.patch(
            f'/openfarmplanner/api/crops/{variety.pk}/',
            {'germination_light_requirement': 'dark'}, format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        variety.refresh_from_db()
        self.assertEqual(variety.germination_temperature_requirement, '')
        self.assertEqual(resolve_crop_field(variety, 'germination_temperature_requirement'), 'cold_stratification')
        variety.germination_temperature_requirement = 'none'
        variety.save()
        self.assertEqual(resolve_crop_field(variety, 'germination_temperature_requirement'), 'none')
        self.assertEqual(resolve_crop_field(variety, 'germination_light_requirement'), 'dark')

    def test_conflicting_variety_axis_does_not_inherit_a_guessed_requirement(self) -> None:
        from farm.services.crop_inheritance import build_inherited_crop_values

        species = CropSpecies.objects.create(name='Conflicting requirements species')
        self.crop.crop_species = species
        self.crop.germination_temperature_requirement = 'cold_stratification'
        self.crop.save()
        variety = Crop.objects.create(
            name=self.crop.name, variety='Historical conflict', project=self.project,
            crop_species=species, germination_types=['cold', 'frost'],
        )
        self.assertEqual(resolve_crop_field(variety, 'germination_temperature_requirement'), '')
        self.assertEqual(resolve_crop_field(variety, 'germination_types'), ['cold', 'frost'])
        self.assertNotIn('germination_temperature_requirement', build_inherited_crop_values(variety))

    def test_new_canonical_values_publish_and_import_through_library_payload(self) -> None:
        from farm.services.public_crops import build_public_crop_payload

        self.crop.germination_temperature_requirement = 'frost_treatment'
        self.crop.germination_light_requirement = 'dark'
        self.crop.stratification_days_min = 14
        self.crop.stratification_temperature_min_c = -5
        self.crop.save()
        payload = build_public_crop_payload(self.crop)
        self.assertEqual(payload['germination_temperature_requirement'], 'frost_treatment')
        self.assertEqual(payload['germination_light_requirement'], 'dark')
        self.assertEqual(payload['stratification_temperature_min_c'], -5)
        self.assertIsNone(payload['stratification_days_max'])
        public = PublicCrop.objects.create(**payload)
        self.assertEqual(public.germination_types, ['frost', 'dark'])

    def test_old_history_snapshot_resolves_conflicts_and_clears_new_ranges(self) -> None:
        from farm.germination import upgrade_germination_snapshot

        snapshot = upgrade_germination_snapshot({'germination_types': ['cold', 'frost', 'light']})
        self.assertEqual(snapshot['germination_temperature_requirement'], '')
        self.assertEqual(snapshot['germination_light_requirement'], 'light')
        self.assertIsNone(snapshot['stratification_days_min'])
        self.assertEqual(snapshot['germination_types'], ['cold', 'frost', 'light'])

    def test_restoring_an_old_revision_does_not_keep_new_stratification_values(self) -> None:
        from farm.history.restore import restore_crop_from_revision
        from farm.models import EntityRevision

        self.crop.germination_temperature_requirement = 'none'
        self.crop.stratification_days_min = 14
        self.crop.save()
        revision = EntityRevision(snapshot={'germination_types': ['cold', 'frost', 'light']})
        restore_crop_from_revision(self.crop, revision)
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.germination_types, ['cold', 'frost', 'light'])
        self.assertEqual(self.crop.germination_temperature_requirement, '')
        self.assertEqual(self.crop.germination_light_requirement, 'light')
        self.assertIsNone(self.crop.stratification_days_min)
