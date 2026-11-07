"""Sowing depth as a range: API writes, the single-depth rule, library edits and import."""

from farm.crops.serializers.public import (
    PublicCropChangeProposalSerializer,
    PublicCropUpdateSerializer,
)
from farm.models import Crop, PublicCrop
from farm.services.crop_import.spreadsheet import apply_crop_import, preview_crop_import
from farm.tests.api_base import ProjectApiTestCase


class SowingDepthApiTest(ProjectApiTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.url = f"/openfarmplanner/api/crops/{self.crop.pk}/"

    def patch(self, data: dict) -> dict:
        response = self.client.patch(self.url, data, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def stored(self) -> tuple[float | None, float | None]:
        self.crop.refresh_from_db()
        return self.crop.sowing_depth_m, self.crop.sowing_depth_max_m

    def test_a_range_is_stored_and_returned_in_centimetres(self) -> None:
        data = self.patch({"sowing_depth_cm": 2, "sowing_depth_max_cm": 3})
        self.assertEqual((data["sowing_depth_cm"], data["sowing_depth_max_cm"]), (2, 3))
        self.assertEqual(self.stored(), (0.02, 0.03))

    def test_the_lower_bound_alone_is_one_depth(self) -> None:
        # Clients from before the range send only sowing_depth_cm.
        self.patch({"sowing_depth_cm": 2, "sowing_depth_max_cm": 3})
        self.patch({"sowing_depth_cm": 4})
        self.assertEqual(self.stored(), (0.04, 0.04))
        self.patch({"sowing_depth_cm": None})
        self.assertEqual(self.stored(), (None, None))

    def test_a_missing_bound_takes_the_other_ones_value(self) -> None:
        self.patch({"sowing_depth_cm": None, "sowing_depth_max_cm": 3})
        self.assertEqual(self.stored(), (0.03, 0.03))
        self.patch({"sowing_depth_cm": 1, "sowing_depth_max_cm": None})
        self.assertEqual(self.stored(), (0.01, 0.01))

    def test_an_inverted_or_negative_range_is_rejected(self) -> None:
        for data in (
            {"sowing_depth_cm": 3, "sowing_depth_max_cm": 2},
            {"sowing_depth_cm": 1, "sowing_depth_max_cm": -1},
        ):
            with self.subTest(data=data):
                response = self.client.patch(self.url, data, format="json")
                self.assertEqual(response.status_code, 400)
                self.assertIn("sowing_depth_max_m", response.data)
        self.assertEqual(self.stored(), (None, None))


class SowingDepthLibraryTest(ProjectApiTestCase):
    def public_crop(self) -> PublicCrop:
        return PublicCrop(sowing_depth_m=0.01, sowing_depth_max_m=0.02)

    def test_a_library_edit_with_one_depth_sets_both_bounds(self) -> None:
        serializer = PublicCropUpdateSerializer(
            self.public_crop(), data={"sowing_depth_m": 0.04}, partial=True,
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data["sowing_depth_max_m"], 0.04)

    def test_a_library_edit_rejects_an_inverted_range(self) -> None:
        serializer = PublicCropUpdateSerializer(
            self.public_crop(), data={"sowing_depth_max_m": 0.005}, partial=True,
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("sowing_depth_max_m", serializer.errors)

    def test_a_proposal_with_one_depth_proposes_both_bounds(self) -> None:
        serializer = PublicCropChangeProposalSerializer(
            data={"summary": "Deeper", "proposed_data": {"sowing_depth_m": 0.04}},
            context={"public_crop": self.public_crop()},
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(
            serializer.validated_data["proposed_data"],
            {"sowing_depth_m": 0.04, "sowing_depth_max_m": 0.04},
        )

    def test_saving_one_bound_fills_the_other(self) -> None:
        public = PublicCrop.objects.create(name="Möhre", sowing_depth_m=0.02)
        self.assertEqual(public.sowing_depth_max_m, 0.02)


class SowingDepthImportTest(ProjectApiTestCase):
    def test_a_range_cell_and_a_single_depth_are_imported(self) -> None:
        rows = [
            {"name": "Karotten", "variety": "Nantaise", "sowing_depth": "2-3"},
            {"name": "Fenchel", "variety": "Finale", "sowing_depth": "0,5 - 1"},
            {"name": "Salat", "variety": "Maikönig", "sowing_depth": "1"},
        ]
        result = apply_crop_import(self.project, [dict(row) for row in rows], confirm_updates=True)
        self.assertEqual(result["created_count"], 3, result)
        stored = {
            crop.name: (crop.sowing_depth_m, crop.sowing_depth_max_m)
            for crop in Crop.objects.filter(variety__in=["Nantaise", "Finale", "Maikönig"])
        }
        self.assertEqual(stored, {
            "Karotten": (0.02, 0.03), "Fenchel": (0.005, 0.01), "Salat": (0.01, 0.01),
        })

    def test_a_cell_that_is_no_depth_is_reported_and_only_that_cell_is_dropped(self) -> None:
        row = {"name": "Beifuß", "variety": "Wild", "sowing_depth": "Kk"}
        preview = preview_crop_import(self.project, [dict(row)])[0]
        self.assertEqual(preview["status"], "create", preview)
        self.assertEqual(
            [(issue["field"], issue["code"]) for issue in preview["timing_window_issues"]],
            [("sowing_depth", "range_not_recognized")],
        )
        result = apply_crop_import(self.project, [dict(row)], confirm_updates=True)
        self.assertEqual(result["created_count"], 1, result)
        crop = Crop.objects.get(name="Beifuß")
        self.assertEqual((crop.sowing_depth_m, crop.sowing_depth_max_m), (None, None))
