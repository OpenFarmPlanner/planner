import copy
from unittest.mock import patch

from django.test import SimpleTestCase

from crops.models import CropSpecies
from crops.specific_properties import (
    PROPERTY_DEFINITIONS,
    PROPERTY_PROFILES,
    specific_property_errors,
)
from farm.crops.serializers.public import PublicCropUpdateSerializer
from farm.models import Crop, PublicCrop
from farm.services.crop_import.analysis import analyze_item
from farm.services.crop_import.spreadsheet import apply_crop_import, preview_crop_import
from farm.services.crop_inheritance import resolve_crop_field
from farm.services.public_crops import build_project_crop_payload, build_public_crop_payload
from farm.tests.api_base import ProjectApiTestCase


class SpecificPropertyValidationTest(SimpleTestCase):
    def test_validates_type_options_keys_and_species_scope(self) -> None:
        profile = "solanum_tuberosum"
        self.assertEqual(specific_property_errors({}, ""), [])
        self.assertEqual(specific_property_errors({"cooking_type": "waxy"}, profile), [])
        for value, scope in (
            ([], profile),
            (None, profile),
            ({"unknown": "waxy"}, profile),
            ({"cooking_type": "invalid"}, profile),
            ({"cooking_type": True}, profile),
            ({"cooking_type": ["waxy"]}, profile),
            ({"cooking_type": "waxy"}, ""),
        ):
            with self.subTest(value=value, scope=scope):
                self.assertTrue(specific_property_errors(value, scope))

    def test_registry_extension_requires_no_property_specific_model_field(self) -> None:
        with (
            patch.dict(
                PROPERTY_DEFINITIONS,
                {
                    "test_size": {
                        "type": "number",
                        "label_key": "test.size",
                        "minimum": 0,
                        "maximum": 10,
                    },
                },
            ),
            patch.dict(PROPERTY_PROFILES, {"test_profile": ["test_size"]}),
        ):
            self.assertEqual(specific_property_errors({"test_size": 2.5}, "test_profile"), [])
            for value in (-1, 11, float("inf"), True, "2.5"):
                self.assertTrue(specific_property_errors({"test_size": value}, "test_profile"))


class SpecificPropertiesApiTest(ProjectApiTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.species = CropSpecies.objects.create(
            name="Property test potato",
            scientific_name="Solanum tuberosum",
            specific_property_profile="solanum_tuberosum",
        )
        self.crop.crop_species = self.species
        self.crop.save()
        self.url = f"/openfarmplanner/api/crops/{self.crop.pk}/"

    def test_json_round_trip_and_omitted_values_do_not_clear(self) -> None:
        values = {"cooking_type": "waxy", "maturity_group": "early"}
        response = self.client.patch(self.url, {"specific_properties": values}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["specific_properties"], values)
        self.assertEqual(response.data["specific_property_profile"], "solanum_tuberosum")
        response = self.client.patch(self.url, {"notes": "Keep properties"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["specific_properties"], values)
        response = self.client.patch(self.url, {"specific_properties": {}}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["specific_properties"], {})

    def test_species_switch_requires_explicit_clear_and_profile_cannot_be_forged(self) -> None:
        self.crop.specific_properties = {"cooking_type": "floury"}
        self.crop.save()
        other = CropSpecies.objects.create(name="Property test ordinary species")
        response = self.client.patch(
            self.url,
            {
                "crop_species": other.pk,
                "specific_property_profile": "solanum_tuberosum",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("specific_properties", response.data)
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.crop_species_id, self.species.pk)
        self.assertEqual(self.crop.specific_properties, {"cooking_type": "floury"})
        response = self.client.patch(
            self.url,
            {
                "crop_species": other.pk,
                "specific_properties": {},
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["specific_property_profile"], "")

    def test_invalid_values_are_rejected_by_project_and_library_serializers(self) -> None:
        entry = PublicCrop.objects.create(name="Potato", crop_species=self.species)
        for properties in ({"unknown": "waxy"}, {"cooking_type": 1}, {"maturity_group": "winter"}):
            response = self.client.patch(
                self.url, {"specific_properties": properties}, format="json"
            )
            self.assertEqual(response.status_code, 400, response.data)
            serializer = PublicCropUpdateSerializer(
                entry,
                data={"specific_properties": properties},
                partial=True,
            )
            self.assertFalse(serializer.is_valid())

    def test_variety_values_are_owned_independently_and_use_explicit_library_payloads(self) -> None:
        self.crop.specific_properties = {"cooking_type": "waxy"}
        self.crop.save()
        variety = Crop.objects.create(
            project=self.project,
            name=self.crop.name,
            crop_species=self.species,
            variety="Early",
        )
        self.assertEqual(resolve_crop_field(variety, "specific_properties"), {})
        variety.specific_properties = {"cooking_type": "floury", "maturity_group": "very_early"}
        variety.save()
        payload = build_public_crop_payload(variety)
        self.assertEqual(payload["specific_properties"], variety.specific_properties)
        general_payload = build_public_crop_payload(
            variety,
            public_variety="",
            source_crop=self.crop,
            include_specific_properties=False,
        )
        self.assertEqual(general_payload["specific_properties"], self.crop.specific_properties)
        entry = PublicCrop.objects.create(
            name="Potato",
            variety="Library variety",
            crop_species=self.species,
            specific_properties=payload["specific_properties"],
        )
        self.assertEqual(
            build_project_crop_payload(entry)["specific_properties"], variety.specific_properties
        )
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.specific_properties, {"cooking_type": "waxy"})

    def test_library_link_rejects_incompatible_preserved_local_values(self) -> None:
        from rest_framework.exceptions import ValidationError

        from farm.services.public_crops import link_project_crop_to_public_reference

        self.crop.specific_properties = {"cooking_type": "waxy"}
        self.crop.save()
        ordinary = CropSpecies.objects.create(name="Ordinary link target")
        entry = PublicCrop.objects.create(name=ordinary.name, crop_species=ordinary)
        with self.assertRaises(ValidationError):
            link_project_crop_to_public_reference(crop=self.crop, public_crop=entry)
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.crop_species_id, self.species.pk)
        self.assertEqual(self.crop.specific_properties, {"cooking_type": "waxy"})
        self.assertIsNone(self.crop.source_public_crop_id)

    def test_spreadsheet_cells_merge_but_explicit_json_replaces(self) -> None:
        self.crop.name = self.species.name
        self.crop.specific_properties = {"cooking_type": "waxy", "maturity_group": "early"}
        self.crop.save()
        row = {"name": self.crop.name, "specific_properties.cooking_type": "floury"}
        preview = preview_crop_import(self.project, [copy.deepcopy(row)])[0]
        self.assertEqual(preview["status"], "update_candidate", preview)
        self.assertIn("specific_properties", [change["field"] for change in preview["diff"]])
        result = apply_crop_import(self.project, [copy.deepcopy(row)], confirm_updates=True)
        self.assertEqual(result["updated_count"], 1, result)
        self.crop.refresh_from_db()
        self.assertEqual(
            self.crop.specific_properties, {"cooking_type": "floury", "maturity_group": "early"}
        )
        apply_crop_import(self.project, [{"name": self.crop.name}], confirm_updates=True)
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.specific_properties["maturity_group"], "early")
        apply_crop_import(
            self.project,
            [{"name": self.crop.name, "specific_properties": {}}],
            confirm_updates=True,
        )
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.specific_properties, {})

    def test_spreadsheet_and_agent_previews_report_inapplicable_properties(self) -> None:
        row = {"name": "Ordinary unsupported species", "specific_properties.cooking_type": "waxy"}
        preview = preview_crop_import(self.project, [copy.deepcopy(row)])[0]
        self.assertEqual(preview["error_code"], "specific_properties_invalid", preview)
        result = apply_crop_import(self.project, [copy.deepcopy(row)], confirm_updates=True)
        self.assertEqual(result["created_count"], 0, result)
        self.assertEqual(len(result["errors"]), 1)
        analyzed = analyze_item(0, row, project=self.project, seen_identities={})
        self.assertEqual(analyzed["action"], "blocked", analyzed)
        self.assertIn(
            "specific_properties_invalid", [error["code"] for error in analyzed["errors"]]
        )

    def test_library_payloads_do_not_share_mutable_values_with_the_source(self) -> None:
        self.crop.specific_properties = {"cooking_type": "waxy"}
        payload = build_public_crop_payload(self.crop)
        payload["specific_properties"]["cooking_type"] = "floury"
        self.assertEqual(self.crop.specific_properties, {"cooking_type": "waxy"})

    def test_old_private_revision_clears_properties_that_did_not_exist(self) -> None:
        from farm.history.restore import restore_crop_from_revision
        from farm.models import EntityRevision

        self.crop.specific_properties = {"cooking_type": "waxy"}
        self.crop.save()
        restore_crop_from_revision(self.crop, EntityRevision(snapshot={"notes": "Old revision"}))
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.specific_properties, {})

    def test_curator_cannot_remove_a_profile_while_values_would_become_invalid(self) -> None:
        from crops.admin import CropSpeciesProfileForm

        self.crop.specific_properties = {"cooking_type": "waxy"}
        self.crop.save()
        form = CropSpeciesProfileForm(data={"specific_property_profile": ""}, instance=self.species)
        self.assertFalse(form.is_valid())
        self.assertIn("specific_property_profile", form.errors)

    def test_properties_do_not_make_another_projects_crop_writable(self) -> None:
        from farm.models import Project

        other_project = Project.objects.create(
            name="Other property project", slug="other-properties"
        )
        other_crop = Crop.objects.create(
            project=other_project,
            name="Private potato",
            crop_species=self.species,
            specific_properties={"cooking_type": "waxy"},
        )
        response = self.client.patch(
            f"/openfarmplanner/api/crops/{other_crop.pk}/",
            {"specific_properties": {"cooking_type": "floury"}},
            format="json",
        )
        self.assertEqual(response.status_code, 404, response.data)
        other_crop.refresh_from_db()
        self.assertEqual(other_crop.specific_properties, {"cooking_type": "waxy"})
