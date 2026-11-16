"""Private/public selections, inheritance, sync and portable history contracts."""

import json
from uuid import uuid4

from django.core.exceptions import ValidationError
from django.test import SimpleTestCase
from rest_framework.test import APIClient

from accounts.consent import record_acceptance
from accounts.models import AccountTrustProfile, DocumentConsent
from accounts.trust import grant_established_trust
from crops.models import CropSpecies
from crops.permissions import grant_public_library_moderator_access
from crops.plant_health_models import PlantHealthEntry
from crops.plant_health_values import normalize_plant_health, plant_health_identities
from farm.models import (
    Crop,
    EntityRevision,
    Project,
    ProjectApiToken,
    PublicCrop,
    PublicCropChangeProposal,
    PublicCropTranslation,
)
from farm.models.crops import crop_model_kwargs
from farm.services.crop_import.analysis import analyze_import_payload
from farm.services.public_crops import (
    _apply_public_crop_update,
    build_public_crop_payload,
    ensure_public_crop_revision,
    public_crop_field_changes,
)
from farm.tests.api_base import ProjectApiTestCase, User

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

    def test_unresolved_private_selections_are_never_published_automatically(self):
        self.crop.plant_health = selections("Unresolved private name")
        self.crop.save()
        self.assertEqual(build_public_crop_payload(self.crop)["plant_health"], selections())

    def map_name(self, name="Local", **overrides):
        return self.client.post(
            self.url + "plant-health/mappings/",
            {
                "expected_updated_at": self.crop.updated_at.isoformat(),
                "mappings": [
                    {"local_name": name, "catalogue_identity": str(self.entry.identity_key)}
                ],
                **overrides,
            },
            format="json",
        )

    def test_explicit_mapping_preserves_other_private_values_and_records_private_history(self):
        self.crop.plant_health = selections("Local", "Keep private")
        self.crop.save()
        count = PlantHealthEntry.objects.count()
        response = self.map_name("  LOCAL ")
        self.assertEqual(response.status_code, 200, response.data)
        self.crop.refresh_from_db()
        self.assertEqual(
            self.crop.plant_health,
            {
                "entries": [
                    {"name": self.entry.name, "catalogue_identity": str(self.entry.identity_key)},
                    {"name": "Keep private"},
                ]
            },
        )
        self.assertEqual(PlantHealthEntry.objects.count(), count)
        revision = EntityRevision.objects.filter(entity_type="crop", object_id=self.crop.pk).latest(
            "pk"
        )
        self.assertIn("plant_health", revision.changed_fields)
        self.assertTrue(revision.user_name)

    def test_mapping_rejects_stale_state_invalid_source_and_unreviewed_identity_atomically(self):
        self.crop.plant_health = selections("Local")
        self.crop.save()
        before = self.crop.plant_health
        for name, options, expected in [
            ("Missing", {}, 409),
            ("Local", {"expected_updated_at": "2000-01-01T00:00:00Z"}, 409),
            (
                "Local",
                {
                    "mappings": [
                        {"local_name": "Local", "catalogue_identity": str(self.entry.identity_key)},
                        {"local_name": "local", "catalogue_identity": str(self.entry.identity_key)},
                    ]
                },
                400,
            ),
        ]:
            with self.subTest(name=name, options=options):
                response = self.map_name(name, **options)
                self.assertEqual(response.status_code, expected, response.data)
                self.crop.refresh_from_db()
                self.assertEqual(self.crop.plant_health, before)
        self.entry.status = PlantHealthEntry.STATUS_PROPOSED
        self.entry.save()
        response = self.map_name()
        self.assertEqual(response.status_code, 400, response.data)
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.plant_health, before)

    def test_mapping_is_project_scoped_and_requires_write_token_scope(self):
        self.crop.plant_health = selections("Local")
        self.crop.save()
        other = Project.objects.create(name="Other mapping project", slug="other-mapping")
        foreign = Crop.objects.create(
            project=other, name="Foreign", plant_health=selections("Local")
        )
        payload = {
            "expected_updated_at": self.crop.updated_at.isoformat(),
            "mappings": [
                {"local_name": "Local", "catalogue_identity": str(self.entry.identity_key)},
            ],
        }
        response = self.client.post(
            f"{CROPS_URL}{foreign.pk}/plant-health/mappings/", payload, format="json"
        )
        self.assertEqual(response.status_code, 404, response.data)
        token_client = APIClient()
        for scope, expected in [
            (ProjectApiToken.SCOPE_READ, 403),
            (ProjectApiToken.SCOPE_WRITE, 200),
        ]:
            _, raw = ProjectApiToken.create_token(
                user=self.user,
                project=self.project,
                name=f"Mapping {scope}",
                scope=scope,
            )
            token_client.credentials(HTTP_AUTHORIZATION=f"Bearer {raw}")
            response = token_client.post(
                self.url + "plant-health/mappings/", payload, format="json"
            )
            self.assertEqual(response.status_code, expected, response.data)
        self.assertEqual(
            token_client.post(
                "/openfarmplanner/api/plant-health/entries/",
                {
                    "name": "No global token write",
                },
                format="json",
            ).status_code,
            403,
        )

    def test_inherited_mapping_requires_the_general_crop_and_keeps_live_inheritance(self):
        species = CropSpecies.objects.create(name="Synthetic inherited mapping", status="published")
        self.crop.crop_species = species
        self.crop.plant_health = selections("Inherited private name")
        self.crop.save()
        variety = Crop.objects.create(
            project=self.project,
            name=self.crop.name,
            variety="Synthetic mapped variety",
            crop_species=species,
            plant_health=None,
        )
        url = f"{CROPS_URL}{variety.pk}/"
        blocked = self.client.post(
            url + "plant-health/mappings/",
            {
                "expected_updated_at": variety.updated_at.isoformat(),
                "mappings": [
                    {
                        "local_name": "Inherited private name",
                        "catalogue_identity": str(self.entry.identity_key),
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(blocked.status_code, 409, blocked.data)
        self.assertEqual(blocked.data["code"], "plant_health_mapping_inherited")
        variety.refresh_from_db()
        self.assertIsNone(variety.plant_health)
        mapped = self.map_name("Inherited private name")
        self.assertEqual(mapped.status_code, 200, mapped.data)
        inherited = self.client.get(url)
        self.assertIsNone(inherited.data["plant_health"])
        self.assertEqual(
            inherited.data["effective_values"]["plant_health"],
            mapped.data["plant_health"],
        )
        self.crop.refresh_from_db()
        self.crop.plant_health["entries"].append({"name": "Later general-crop change"})
        self.crop.save()
        later = self.client.get(url)
        self.assertIsNone(later.data["plant_health"])
        self.assertIn(
            {"name": "Later general-crop change"},
            later.data["effective_values"]["plant_health"]["entries"],
        )


class PublicPlantHealthTests(ProjectApiTestCase):
    def setUp(self):
        super().setUp()
        grant_established_trust(self.user)
        record_acceptance(self.user, DocumentConsent.DOCUMENT_PUBLIC_LIBRARY)
        self.species = CropSpecies.objects.create(
            name="Synthetic public health", status="published"
        )
        self.entries = [
            PlantHealthEntry.objects.create(
                name="Same label",
                scientific_name=f"Syntheticus {suffix}",
                kind="pathogen",
                status="published",
            )
            for suffix in ("alpha", "beta", "gamma")
        ]
        self.crop.name = self.species.name
        self.crop.crop_species = self.species
        self.crop.plant_health = self.mixed(self.entries[0])
        self.crop.pests_diseases = "Early sowing protects against carrot fly. Repels aphids."
        self.crop.save()
        self.public = PublicCrop.objects.create(
            crop_species=self.species,
            created_by=self.user,
            status="published",
            original_language_code="de",
            **crop_model_kwargs(build_public_crop_payload(self.crop)),
        )
        ensure_public_crop_revision(self.public)
        self.crop.source_public_crop = self.public
        self.crop.source_public_version = self.public.version
        self.crop.origin_type = Crop.ORIGIN_IMPORTED
        self.crop.is_modified_from_source = False
        self.crop.save()
        self.crop_url = f"{CROPS_URL}{self.crop.pk}/"
        self.public_url = f"/openfarmplanner/api/public-crops/{self.public.pk}/"

    @staticmethod
    def official(entry):
        return {"name": entry.name, "catalogue_identity": str(entry.identity_key)}

    def mixed(self, entry, *private_names):
        names = private_names or ("Unresolved private name",)
        return {"entries": [*selections(*names)["entries"], self.official(entry)]}

    def edit_public(self, entry):
        response = self.client.patch(
            self.public_url,
            {
                "base_version": self.public.version,
                "plant_health": {"entries": [self.official(entry)]},
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.public.refresh_from_db()
        return response

    def sync(self, **options):
        return self.client.post(
            self.crop_url + "public-sync/",
            {
                "public_crop_id": self.public.pk,
                "base_version": self.public.version,
                **options,
            },
            format="json",
        )

    def test_public_projection_never_publishes_private_names_or_infers_mapping(self):
        self.crop.plant_health = self.mixed(self.entries[0], "Same label", "Repels aphids")
        self.crop.save()
        payload = build_public_crop_payload(self.crop)
        self.assertEqual(payload["plant_health"], {"entries": [self.official(self.entries[0])]})
        self.assertEqual(
            self.crop.plant_health["entries"][:2],
            selections("Same label", "Repels aphids")["entries"],
        )
        preview = self.client.get(
            self.crop_url + "publish-public/preview/",
            {
                "crop_species_id": self.species.pk,
                "original_language_code": "de",
                "publish_as_general": "true",
            },
        )
        self.assertEqual(preview.status_code, 200, preview.data)
        self.assertEqual(preview.data["unpublishable_plant_health_count"], 2)

    def test_private_only_edits_and_snapshot_names_do_not_count_as_library_divergence(self):
        changed = self.mixed(self.entries[0], "Another private name")
        changed["entries"][-1]["name"] = "Historical translated snapshot"
        self.crop.plant_health = changed
        self.crop.save()
        self.crop.refresh_from_db()
        self.assertFalse(self.crop.is_modified_from_source)
        self.assertFalse(
            any(
                field == "plant_health"
                for field, *_ in public_crop_field_changes(self.crop, self.public)
            )
        )

    def test_library_only_change_is_reviewable_and_pull_preserves_private_values(self):
        original_id, prose = self.crop.pk, self.crop.pests_diseases
        self.edit_public(self.entries[1])
        preview = self.client.get(self.crop_url + "public-update/")
        health = next(
            change for change in preview.data["changes"] if change["field"] == "plant_health"
        )
        self.assertFalse(health["locally_changed"])
        self.assertEqual(health["local_value"], {"entries": [self.official(self.entries[0])]})
        response = self.sync(pull_fields=["plant_health"])
        self.assertEqual(response.status_code, 200, response.data)
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.pk, original_id)
        self.assertEqual(self.crop.plant_health, self.mixed(self.entries[1]))
        self.assertEqual(self.crop.pests_diseases, prose)
        self.assertFalse(self.crop.is_modified_from_source)

    def test_local_only_and_conflicting_changes_keep_distinct_same_label_identities(self):
        response = self.client.patch(
            self.crop_url, {"plant_health": self.mixed(self.entries[1])}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.crop.refresh_from_db()
        self.assertTrue(self.crop.is_modified_from_source)
        preview = self.client.get(
            self.crop_url + "public-sync/", {"public_crop_id": self.public.pk}
        )
        self.assertEqual(preview.status_code, 200, preview.data)
        health = next(
            change for change in preview.data["changes"] if change["field"] == "plant_health"
        )
        self.assertNotEqual(
            plant_health_identities(health["local_value"]),
            plant_health_identities(health["public_value"]),
        )
        self.edit_public(self.entries[2])
        preview = self.client.get(self.crop_url + "public-update/")
        health = next(
            change for change in preview.data["changes"] if change["field"] == "plant_health"
        )
        self.assertTrue(health["locally_changed"])
        response = self.sync(push_fields=["plant_health"])
        self.assertEqual(response.status_code, 200, response.data)
        self.public.refresh_from_db()
        self.assertEqual(self.public.plant_health, {"entries": [self.official(self.entries[1])]})
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.plant_health, self.mixed(self.entries[1]))

    def test_pins_keep_official_choices_and_unpin_pull_still_preserves_private_names(self):
        response = self.client.patch(
            self.crop_url,
            {
                "plant_health": self.mixed(self.entries[1]),
                "library_pinned_fields": ["plant_health"],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.edit_public(self.entries[2])
        self.crop.refresh_from_db()
        _apply_public_crop_update(crop=self.crop, public_crop=self.public)
        self.assertEqual(self.crop.plant_health, self.mixed(self.entries[1]))
        response = self.sync(pull_fields=["plant_health"])
        self.assertEqual(response.status_code, 200, response.data)
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.library_pinned_fields, [])
        self.assertEqual(self.crop.plant_health, self.mixed(self.entries[2]))

    def test_full_update_preserves_names_and_unchanged_variety_inheritance(self):
        self.edit_public(self.entries[1])
        self.crop.refresh_from_db()
        _apply_public_crop_update(crop=self.crop, public_crop=self.public)
        self.assertEqual(self.crop.plant_health, self.mixed(self.entries[1]))
        variety = Crop.objects.create(
            project=self.project,
            crop_species=self.species,
            name=self.crop.name,
            variety="Synthetic inherits",
            plant_health=None,
        )
        entry = PublicCrop.objects.create(
            crop_species=self.species,
            created_by=self.user,
            status="published",
            original_language_code="de",
            **crop_model_kwargs(build_public_crop_payload(variety)),
        )
        variety.source_public_crop = entry
        variety.save()
        _apply_public_crop_update(crop=variety, public_crop=entry)
        self.assertIsNone(variety.plant_health)

    def test_oversized_merge_fails_atomically_instead_of_dropping_private_names(self):
        self.crop.plant_health = selections(*(f"Private {index}" for index in range(40)))
        self.crop.save()
        before = self.crop.plant_health
        self.edit_public(self.entries[1])
        response = self.sync(pull_fields=["plant_health"])
        self.assertEqual(response.status_code, 400, response.data)
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.plant_health, before)
        self.assertEqual(self.crop.source_public_version, 1)

    def test_public_writes_require_official_references_and_preserve_other_languages(self):
        PublicCropTranslation.objects.create(
            public_crop=self.public, language_code="fr", description="Keep French prose"
        )
        pending = PlantHealthEntry.objects.create(name="Pending identity")
        for value in [
            selections("Private"),
            {"entries": [{"catalogue_identity": str(uuid4())}]},
            {"entries": [self.official(pending)]},
        ]:
            with self.subTest(value=value):
                response = self.client.patch(
                    self.public_url, {"plant_health": value}, format="json"
                )
                self.assertEqual(response.status_code, 400, response.data)
        self.public.refresh_from_db()
        self.assertEqual(self.public.version, 1)
        self.edit_public(self.entries[1])
        self.assertEqual(
            self.public.translations.get(language_code="fr").description, "Keep French prose"
        )

    def test_moderated_reference_change_keeps_private_names_until_explicit_pull(self):
        contributor = User.objects.create_user(username="health-contributor", password="testpass")
        self.client.force_authenticate(contributor)
        response = self.client.patch(
            self.public_url,
            {
                "plant_health": {"entries": [self.official(self.entries[1])]},
            },
            format="json",
        )
        self.assertEqual(response.status_code, 202, response.data)
        proposal = PublicCropChangeProposal.objects.get(public_crop=self.public)
        self.public.refresh_from_db()
        self.assertEqual(self.public.plant_health, {"entries": [self.official(self.entries[0])]})
        grant_public_library_moderator_access(self.user)
        self.client.force_authenticate(self.user)
        approved = self.client.post(
            self.public_url + f"change-proposals/{proposal.pk}/approve/",
            {},
            format="json",
        )
        self.assertEqual(approved.status_code, 200, approved.data)
        self.public.refresh_from_db()
        self.crop.refresh_from_db()
        self.assertEqual(self.public.plant_health, {"entries": [self.official(self.entries[1])]})
        self.assertEqual(self.crop.plant_health, self.mixed(self.entries[0]))
        self.assertFalse(self.entries[1].hosts.exists())

    def test_public_history_restore_keeps_archived_identity_and_other_language_prose(self):
        PublicCropTranslation.objects.create(
            public_crop=self.public,
            language_code="fr",
            description="French notes stay",
        )
        self.edit_public(self.entries[1])
        self.entries[0].status = PlantHealthEntry.STATUS_ARCHIVED
        self.entries[0].save()
        response = self.client.post(
            self.public_url + "revert/",
            {
                "version": 1,
                "base_version": self.public.version,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.public.refresh_from_db()
        self.assertEqual(self.public.plant_health, {"entries": [self.official(self.entries[0])]})
        self.assertEqual(
            self.public.translations.get(language_code="fr").description, "French notes stay"
        )

    def test_moderated_owner_republication_retains_reopened_catalogue_reference(self):
        self.entries[0].status = PlantHealthEntry.STATUS_PROPOSED
        self.entries[0].save()
        self.crop.notes = "Unrelated owner edit"
        self.crop.save()
        AccountTrustProfile.objects.filter(user=self.user).update(trust_level="new")
        original = self.public.plant_health
        response = self.client.post(
            self.crop_url + "publish-public/",
            {
                "accepted_public_library_terms": True,
                "crop_species_id": self.species.pk,
                "original_language_code": "de",
                "publish_as_general": True,
            },
            format="json",
        )
        self.assertIn(response.status_code, (201, 202), response.data)
        proposal = PublicCropChangeProposal.objects.get(public_crop=self.public)
        self.assertEqual(proposal.proposed_data["plant_health"], original)
        self.assertEqual(proposal.proposed_data["notes"], "Unrelated owner edit")
        grant_public_library_moderator_access(self.user)
        approved = self.client.post(
            self.public_url + f"change-proposals/{proposal.pk}/approve/",
            {},
            format="json",
        )
        self.assertEqual(approved.status_code, 200, approved.data)
        self.public.refresh_from_db()
        self.crop.refresh_from_db()
        self.assertEqual(self.public.plant_health, original)
        self.assertIn({"name": "Unresolved private name"}, self.crop.plant_health["entries"])

    def test_queued_direct_edit_retains_reopened_reference_for_session_and_project_token(self):
        self.entries[0].status = PlantHealthEntry.STATUS_PROPOSED
        self.entries[0].save()
        profile = AccountTrustProfile.objects.get(user=self.user)
        profile.trust_level = AccountTrustProfile.TRUST_NEW
        profile.save()
        original = self.public.plant_health
        payload = {"notes": "Unrelated queued edit", "plant_health": original}
        response = self.client.patch(self.public_url, payload, format="json")
        self.assertEqual(response.status_code, 202, response.data)
        proposal = PublicCropChangeProposal.objects.get(pk=response.data["id"])
        self.assertEqual(proposal.proposed_data["plant_health"], original)
        proposal.delete()
        _, raw_token = ProjectApiToken.create_token(
            project=self.project,
            user=self.user,
            name="Synthetic queued retained identity",
            scope=ProjectApiToken.SCOPE_WRITE,
        )
        token_client = APIClient()
        token_client.credentials(HTTP_AUTHORIZATION=f"Bearer {raw_token}")
        response = token_client.patch(self.public_url, payload, format="json")
        self.assertEqual(response.status_code, 202, response.data)
        proposal = PublicCropChangeProposal.objects.get(pk=response.data["id"])
        self.assertEqual(proposal.proposed_data["plant_health"], original)
        self.public.refresh_from_db()
        self.assertEqual(self.public.plant_health, original)

    def linked_variety_for_override(self, private_value, public_value):
        self.crop.plant_health = None
        self.crop.save()
        public = PublicCrop.objects.create(
            name=self.species.name,
            variety="Synthetic override comparison",
            crop_species=self.species,
            status="published",
            original_language_code="de",
            created_by=self.user,
            plant_health=public_value,
        )
        ensure_public_crop_revision(public)
        variety = Crop.objects.create(
            project=self.project,
            name=self.species.name,
            crop_species=self.species,
            variety=public.variety,
            plant_health=private_value,
            source_public_crop=public,
            source_public_version=public.version,
            origin_type=Crop.ORIGIN_IMPORTED,
        )
        return variety, public

    def test_publishing_an_empty_variety_keeps_its_explicit_override(self):
        variety = Crop.objects.create(
            project=self.project,
            name=self.species.name,
            crop_species=self.species,
            variety="Synthetic published empty override",
            plant_health=selections(),
            growth_duration_days=42,
            harvest_duration_days=14,
        )
        response = self.client.post(
            f"{CROPS_URL}{variety.pk}/publish-public/",
            {
                "crop_species_id": self.species.pk,
                "original_language_code": "de",
                "accepted_public_library_terms": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["public_crop"]["plant_health"], selections())
        self.public.refresh_from_db()
        self.assertEqual(self.public.plant_health, {"entries": [self.official(self.entries[0])]})
        variety.refresh_from_db()
        self.assertEqual(variety.plant_health, selections())

    def test_pull_of_explicit_empty_suppresses_later_parent_changes(self):
        variety, public = self.linked_variety_for_override(None, selections())
        url = f"{CROPS_URL}{variety.pk}/public-sync/"
        preview = self.client.get(url, {"public_crop_id": public.pk})
        health = next(row for row in preview.data["changes"] if row["field"] == "plant_health")
        self.assertIsNone(health["local_value"])
        self.assertEqual(health["public_value"], selections())
        result = self.client.post(
            url,
            {
                "public_crop_id": public.pk,
                "base_version": public.version,
                "pull_fields": ["plant_health"],
            },
            format="json",
        )
        self.assertEqual(result.status_code, 200, result.data)
        variety.refresh_from_db()
        self.assertEqual(variety.plant_health, selections())
        self.crop.plant_health = self.mixed(self.entries[0])
        self.crop.save()
        current = self.client.get(f"{CROPS_URL}{variety.pk}/")
        self.assertEqual(current.data["effective_values"]["plant_health"], selections())

    def test_pull_of_null_releases_empty_override_and_keeps_live_inheritance(self):
        variety, public = self.linked_variety_for_override(selections(), None)
        result = self.client.post(
            f"{CROPS_URL}{variety.pk}/public-sync/",
            {
                "public_crop_id": public.pk,
                "base_version": public.version,
                "pull_fields": ["plant_health"],
            },
            format="json",
        )
        self.assertEqual(result.status_code, 200, result.data)
        variety.refresh_from_db()
        self.assertIsNone(variety.plant_health)
        self.crop.plant_health = self.mixed(self.entries[0])
        self.crop.save()
        current = self.client.get(f"{CROPS_URL}{variety.pk}/")
        self.assertEqual(
            current.data["effective_values"]["plant_health"],
            self.crop.plant_health,
        )

    def test_null_public_pull_never_copies_inherited_private_names_onto_the_variety(self):
        variety, public = self.linked_variety_for_override(None, None)
        for mode in ("full", "selected"):
            for parent_value in (
                selections(),
                selections("Parent-only private name"),
                self.mixed(self.entries[0]),
            ):
                with self.subTest(mode=mode, parent_value=parent_value):
                    self.crop.plant_health = parent_value
                    self.crop.save()
                    variety.plant_health = None
                    variety.save()
                    if mode == "full":
                        _apply_public_crop_update(crop=variety, public_crop=public)
                    else:
                        response = self.client.post(
                            f"{CROPS_URL}{variety.pk}/public-sync/",
                            {
                                "public_crop_id": public.pk,
                                "base_version": public.version,
                                "pull_fields": ["plant_health"],
                            },
                            format="json",
                        )
                        self.assertEqual(response.status_code, 200, response.data)
                    variety.refresh_from_db()
                    self.assertIsNone(variety.plant_health)
                    self.crop.plant_health = self.mixed(self.entries[1], "Later parent name")
                    self.crop.save()
                    current = self.client.get(f"{CROPS_URL}{variety.pk}/")
                    self.assertEqual(
                        current.data["effective_values"]["plant_health"], self.crop.plant_health
                    )

    def test_explicit_empty_can_be_shared_but_cannot_keep_an_empty_library_pin(self):
        self.crop.plant_health = selections()
        self.crop.save()
        preview = self.client.get(
            self.crop_url + "public-sync/", {"public_crop_id": self.public.pk}
        )
        health = next(row for row in preview.data["changes"] if row["field"] == "plant_health")
        self.assertTrue(health["pushable"])
        self.assertFalse(health["pinnable"])
        self.assertEqual(health["pin_blocked_reason"], "empty")
        response = self.sync(push_fields=["plant_health"])
        self.assertEqual(response.status_code, 200, response.data)
        self.public.refresh_from_db()
        self.assertEqual(self.public.plant_health, selections())
