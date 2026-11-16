"""Private selections, inheritance, unchanged prose and reversible import semantics."""

import json
from uuid import uuid4

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase
from rest_framework.test import APIClient

from crops.models import CropSpecies
from crops.plant_health_models import PlantHealthEntry
from crops.plant_health_values import normalize_plant_health
from farm.models import Crop, EntityRevision, Project, ProjectApiToken
from farm.services.crop_import.analysis import analyze_import_payload
from farm.services.public_crops import build_public_crop_payload
from farm.tests.api_base import ProjectApiTestCase

CROPS_URL = "/openfarmplanner/api/crops/"


def selections(*names):
    return {"entries": [{"name": name} for name in names]}


class PlantHealthValueTests(SimpleTestCase):
    def test_normalizes_only_case_and_spacing_without_splitting_or_merging_identities(self):
        identity = str(uuid4())
        value = {
            "entries": [
                {"name": " A; B, C "},
                {"name": "a;  b, c"},
                {"name": "A; B, C", "catalogue_identity": identity},
                {"name": "é"},
                {"name": "e"},
            ]
        }
        self.assertEqual(
            normalize_plant_health(value),
            {
                "entries": [
                    {"name": "A; B, C"},
                    {"name": "A; B, C", "catalogue_identity": identity},
                    {"name": "é"},
                    {"name": "e"},
                ]
            },
        )

    def test_rejects_malformed_or_unbounded_values_instead_of_guessing_from_prose(self):
        for value in [
            "repels aphids",
            [],
            {},
            {"entries": "aphids"},
            selections(""),
            selections("x" * 201),
            selections(*["x"] * 41),
            {"entries": [{"name": "x", "is_confirmed": True}]},
            {"entries": [{"catalogue_identity": "not-a-uuid"}]},
        ]:
            with self.subTest(value=value), self.assertRaises(ValidationError):
                normalize_plant_health(value)


class PrivatePlantHealthTests(ProjectApiTestCase):
    def setUp(self):
        super().setUp()
        self.url = f"{CROPS_URL}{self.crop.pk}/"
        self.entry = PlantHealthEntry.objects.create(
            name="Synthetic organism",
            scientific_name="Syntheticus testus",
            kind=PlantHealthEntry.KIND_PATHOGEN,
            status=PlantHealthEntry.STATUS_PUBLISHED,
        )

    def patch(self, payload):
        return self.client.patch(self.url, payload, format="json")

    def test_reuses_only_the_active_projects_local_spellings_and_does_not_publish(self):
        other_project = Project.objects.create(name="Other", slug="other-health-project")
        Crop.objects.create(
            project=other_project, name="Other crop", plant_health=selections("PRIVATE local")
        )
        Crop.objects.create(
            project=self.project, name="Known crop", plant_health=selections("Leaf Spot")
        )
        response = self.patch({"plant_health": selections("leaf  SPOT", "private LOCAL")})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["plant_health"], selections("Leaf Spot", "private LOCAL"))
        self.assertEqual(PlantHealthEntry.objects.count(), 1)

    def test_catalogue_identity_is_not_inferred_from_local_text_and_forged_labels_are_ignored(self):
        identity = str(self.entry.identity_key)
        response = self.patch(
            {
                "plant_health": {
                    "entries": [
                        {"name": "Synthetic organism"},
                        {"name": "Forged taxon label", "catalogue_identity": identity},
                    ]
                }
            }
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            response.data["plant_health"]["entries"],
            [
                {"name": "Synthetic organism"},
                {"name": self.entry.name, "catalogue_identity": identity},
            ],
        )

    def test_unavailable_catalogue_identity_rejects_the_entire_update(self):
        for entry in [None, PlantHealthEntry.objects.create(name="Unreviewed proposal")]:
            identity = str(entry.identity_key) if entry else str(uuid4())
            response = self.patch(
                {
                    "notes": "Must not be saved",
                    "plant_health": {
                        "entries": [{"catalogue_identity": identity}],
                    },
                }
            )
            self.assertEqual(response.status_code, 400, response.data)
            self.crop.refresh_from_db()
            self.assertEqual(self.crop.notes, "")
            self.assertIsNone(self.crop.plant_health)

    def test_retains_an_existing_reference_after_archival_and_keeps_its_history_name(self):
        identity = str(self.entry.identity_key)
        saved = self.patch({"plant_health": {"entries": [{"catalogue_identity": identity}]}}).data[
            "plant_health"
        ]
        self.entry.name = "Renamed archived identity"
        self.entry.status = PlantHealthEntry.STATUS_ARCHIVED
        self.entry.save()
        response = self.patch({"plant_health": saved, "notes": "Other edit"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["plant_health"], saved)

    def test_live_variety_inheritance_and_explicit_empty_override_are_distinct(self):
        species = CropSpecies.objects.create(name="Synthetic health species")
        self.crop.crop_species = species
        self.crop.plant_health = selections("Parent entry")
        self.crop.save()
        variety = Crop.objects.create(
            project=self.project,
            name=self.crop.name,
            variety="Test variety",
            crop_species=species,
        )
        url = f"{CROPS_URL}{variety.pk}/"
        inherited = self.client.get(url).data
        self.assertIsNone(inherited["plant_health"])
        self.assertEqual(inherited["effective_values"]["plant_health"], selections("Parent entry"))
        self.assertIn("plant_health", inherited["inherited_fields"])
        overridden = self.client.patch(url, {"plant_health": selections()}, format="json")
        self.assertEqual(overridden.status_code, 200, overridden.data)
        self.assertEqual(overridden.data["effective_values"]["plant_health"], selections())
        self.assertNotIn("plant_health", overridden.data["inherited_fields"])
        self.crop.plant_health = selections("Changed parent")
        self.crop.save()
        self.assertEqual(
            self.client.get(url).data["effective_values"]["plant_health"], selections()
        )
        restored = self.client.patch(url, {"plant_health": None}, format="json")
        self.assertEqual(
            restored.data["effective_values"]["plant_health"], selections("Changed parent")
        )

    def test_omission_preserves_entries_and_arbitrary_legacy_prose_never_becomes_a_tag(self):
        prose = "Early sowing protects against carrot fly; repels aphids."
        response = self.patch(
            {"pests_diseases": prose, "plant_health": selections("Explicit name")}
        )
        self.assertEqual(response.status_code, 200, response.data)
        response = self.patch({"notes": "Unrelated edit"})
        self.assertEqual(response.data["pests_diseases"], prose)
        self.assertEqual(response.data["plant_health"], selections("Explicit name"))
        response = self.patch({"plant_health": selections()})
        self.assertEqual(response.data["pests_diseases"], prose)

    def test_history_restores_selections_and_old_snapshots_clear_the_new_field_only(self):
        legacy = EntityRevision.objects.filter(entity_type="crop", object_id=self.crop.pk).latest(
            "pk"
        )
        snapshot = dict(legacy.snapshot)
        snapshot.pop("plant_health")
        snapshot["pests_diseases"] = "Legacy prose remains explanatory."
        legacy.snapshot = snapshot
        legacy.save(update_fields=["snapshot"])
        self.patch({"plant_health": selections("First selection")})
        selected = EntityRevision.objects.filter(entity_type="crop", object_id=self.crop.pk).latest(
            "pk"
        )
        self.patch({"plant_health": selections("Later selection")})
        response = self.client.post(
            f"{self.url}restore/", {"history_id": selected.pk}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.plant_health, selections("First selection"))
        response = self.client.post(f"{self.url}restore/", {"history_id": legacy.pk}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.crop.refresh_from_db()
        self.assertIsNone(self.crop.plant_health)
        self.assertEqual(self.crop.pests_diseases, snapshot["pests_diseases"])

    def test_spreadsheet_json_cell_preserves_escaping_and_legacy_notes_and_can_clear(self):
        names = ["Name; with, delimiters", 'A "quoted" name']
        prose = "Repels aphids is a note, not a host claim."
        row = {
            "name": "Spreadsheet fixture",
            "plant_health": json.dumps(names),
            "pests_diseases": prose,
        }
        preview = self.client.post(f"{CROPS_URL}import/preview/", {"items": [row]}, format="json")
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertFalse(Crop.objects.filter(name=row["name"]).exists())
        response = self.client.post(f"{CROPS_URL}import/apply/", {"items": [row]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        crop = Crop.objects.get(project=self.project, name=row["name"])
        self.assertEqual(crop.plant_health, selections(*names))
        self.assertEqual(crop.pests_diseases, prose)
        response = self.client.post(
            f"{CROPS_URL}import/apply/",
            {
                "items": [{"name": crop.name, "plant_health": "[]"}],
                "confirm_updates": True,
            },
            format="json",
        )
        crop.refresh_from_db()
        self.assertEqual(crop.plant_health, selections(), response.data)
        self.assertEqual(crop.pests_diseases, prose)

    def test_agent_preview_validates_references_without_writing(self):
        preview = analyze_import_payload(
            [
                {
                    "name": "Preview fixture",
                    "plant_health": {"entries": [{"catalogue_identity": str(uuid4())}]},
                }
            ],
            project=self.project,
        )
        self.assertTrue(preview["items"][0]["errors"])
        self.assertFalse(Crop.objects.filter(name="Preview fixture").exists())

    def test_confirmed_agent_import_can_explicitly_restore_inheritance(self):
        self.crop.plant_health = selections("Own selection")
        self.crop.save()
        _, raw = ProjectApiToken.create_token(
            user=self.user,
            project=self.project,
            name="Synthetic health import",
            scope=ProjectApiToken.SCOPE_WRITE,
        )
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {raw}")
        response = client.post(
            "/api/crop-imports/preview/",
            {
                "items": [
                    {
                        "name": self.crop.name,
                        "plant_health": None,
                    }
                ]
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["items"][0]["action"], "update")
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.plant_health, selections("Own selection"))
        applied = client.post(
            f'/api/crop-imports/{response.data["draft_id"]}/apply/',
            {
                "checksum": response.data["checksum"],
                "confirm": True,
                "acknowledge_warnings": True,
            },
            format="json",
        )
        self.assertEqual(applied.status_code, 200, applied.data)
        self.crop.refresh_from_db()
        self.assertIsNone(self.crop.plant_health)

    def test_private_selections_are_not_automatically_published_in_this_part(self):
        self.crop.plant_health = selections("Unresolved private name")
        self.crop.save()
        self.assertNotIn("plant_health", build_public_crop_payload(self.crop))
