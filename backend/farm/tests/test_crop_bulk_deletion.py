"""Bulk crop selection, provenance, archive and recovery contracts."""

from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import IntegrityError

from crops.models import CropSpecies, CropSpeciesTranslation
from farm.history.project_restore import capture_project_state
from farm.history.records import revision_batch
from farm.models import (
    BatchOperation,
    Crop,
    CropSupplierData,
    EntityRevision,
    PlantingPlan,
    Project,
    ProjectMembership,
    PublicCrop,
    SeedPackage,
)
from farm.tests.test_history_invariants import API, HistoryInvariantTestCase

BULK_URL = f"{API}/crops/bulk-delete/"


class CropBulkDeletionTests(HistoryInvariantTestCase):
    def crop(self, name, **fields):
        return self.write("create crop", "post", "/crops/", {"name": name, **fields})["id"]

    def selection(self, *crop_ids, delete_varieties=True, scope="selected"):
        return {
            "expected_project_id": self.project.pk,
            "scope": scope,
            "crop_ids": list(crop_ids),
            "delete_varieties": delete_varieties,
        }

    def preview(self, selection, **headers):
        response = self.client.post(f"{BULK_URL}preview/", selection, format="json", **headers)
        self.assertEqual(response.status_code, 200, response.json())
        return response.json()

    def confirm_payload(self, selection, preview, **options):
        return {
            **selection, "request_id": str(uuid4()), "preview_token": preview["token"], **options,
        }

    def confirm(self, payload):
        return self.client.post(BULK_URL, payload, format="json")

    def recover(self, batch_id):
        return self.client.post(f"{BULK_URL}undo/", {
            "batch_id": batch_id, "expected_project_id": self.project.pk,
        }, format="json")

    def test_preview_names_match_crop_list_language_and_region(self):
        self.project.region = Project.REGION_AUSTRIA
        self.project.save(update_fields=["region"])
        species = CropSpecies.objects.create(
            name="Test deletion species", status=CropSpecies.STATUS_PUBLISHED,
        )
        CropSpeciesTranslation.objects.create(
            species=species, language_code="de", common_name="Deutscher Name",
            regional_names={"austria": "Österreichischer Name"},
        )
        CropSpeciesTranslation.objects.create(
            species=species, language_code="en", common_name="English name",
        )
        crop = Crop.objects.create(project=self.project, crop_species=species, name="Stored name")
        variety = Crop.objects.create(
            project=self.project, crop_species=species, name=crop.name, variety="Private variety",
        )
        selection = self.selection(variety.pk, delete_varieties=False)
        localized = {}
        for language, expected in (("de-AT", "Österreichischer Name"), ("en", "English name")):
            detail = self.client.get(f"{API}/crops/{crop.pk}/", HTTP_ACCEPT_LANGUAGE=language)
            self.assertEqual(detail.json()["crop_display_name"], expected)
            localized[language] = self.preview(selection, HTTP_ACCEPT_LANGUAGE=language)
            preview = localized[language]
            self.assertEqual(preview["affected_records"], [{
                "id": variety.pk, "name": expected, "variety": "Private variety",
                "parent_id": crop.pk, "parent_name": expected,
            }])
            self.assertEqual(preview["samples"], [{
                "id": variety.pk, "name": f"{expected} (Private variety)",
            }])
            required = self.preview(
                self.selection(crop.pk, delete_varieties=False), HTTP_ACCEPT_LANGUAGE=language,
            )["required_varieties"]
            self.assertEqual(required, preview["affected_records"])
        self.assertIsNotNone(localized["en"]["token"])
        self.assertEqual(localized["en"]["token"], localized["de-AT"]["token"])

    def test_group_preview_then_atomic_archive_idempotent_retry_and_recovery(self):
        supplier = self.write("supplier", "post", "/suppliers/", {"name": "Seed shop"})
        general = self.crop("Tomato", seed_packages=[{"size_value": 5, "size_unit": "g"}])
        variety = self.crop("Tomato", variety="Roma", supplier_data_input=[
            {"supplier_id": supplier["id"], "notes": "Seed offer"},
        ])
        other_crop = self.crop("Bean")
        before, counts = capture_project_state(self.project), self.history_counts()
        excluded = self.preview(self.selection(general, delete_varieties=False))
        self.assertEqual(excluded["blocked_count"], 1)
        self.assertEqual(excluded["blockers"][0]["code"], "varieties_required")
        self.assertEqual([record["id"] for record in excluded["affected_records"]], [general])
        self.assertEqual(excluded["required_varieties"], [{
            "id": variety, "name": "Tomato", "variety": "Roma",
            "parent_id": general, "parent_name": "Tomato",
        }])
        self.assertIsNone(excluded["token"])
        explicit = self.preview(self.selection(general, variety, variety, delete_varieties=False))
        self.assertEqual(explicit["selected_count"], 2)
        self.assertEqual(explicit["additional_count"], 0)
        self.assertIsNotNone(explicit["token"])

        selection = self.selection(general)
        plan = self.preview(selection)
        self.assertEqual(plan["selected_count"], 1)
        self.assertEqual(plan["affected_count"], 2)
        self.assertEqual(plan["general_count"], 1)
        self.assertEqual(plan["variety_count"], 1)
        self.assertEqual(plan["additional_count"], 1)
        self.assertEqual(plan["seed_package_count"], 1)
        self.assertEqual(plan["supplier_offer_count"], 1)
        self.assertEqual({sample["id"] for sample in plan["samples"]}, {general, variety})
        self.assertEqual([record["id"] for record in plan["affected_records"]], [general, variety])
        self.assertEqual(plan["required_varieties"], [])
        self.assertIsNotNone(plan["token"])
        self.assertEqual(capture_project_state(self.project), before)
        self.assertEqual(self.history_counts(), counts)

        payload = self.confirm_payload(selection, plan)
        response = self.confirm(payload)
        self.assertEqual(response.status_code, 200, response.json())
        receipt = response.json()
        self.assertEqual(receipt["deleted_count"], 2)
        self.assertEqual(
            set(Crop.objects.filter(project=self.project).values_list("pk", flat=True)),
            {other_crop},
        )
        self.assertTrue(SeedPackage.objects.filter(project=self.project, crop_id=general).exists())
        self.assertTrue(
            CropSupplierData.objects.filter(project=self.project, crop_id=variety).exists()
        )
        self.assertEqual(
            Crop.all_objects.filter(pk__in=[general, variety], deleted_at__isnull=False).count(),
            2,
        )
        batch = BatchOperation.objects.get(pk=receipt["batch_id"])
        self.assertEqual(batch.operation_type, BatchOperation.TYPE_CROP_BULK_DELETE)
        revisions = batch.revisions.filter(entity_type="crop")
        self.assertEqual(set(revisions.values_list("object_id", flat=True)), {general, variety})
        self.assertEqual(
            set(revisions.values_list("action", flat=True)), {EntityRevision.ACTION_DELETED},
        )
        self.assertEqual(set(revisions.values_list("user_name", flat=True)), {self.user.email})

        versions = self.history_counts()
        self.assertEqual(self.confirm(payload).json(), receipt)
        self.assertEqual(self.history_counts(), versions)
        history = self.client.get(f"{API}/history/project/").json()
        groups = [entry for entry in history if entry.get("batch_id") == batch.pk]
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["batch_context"]["deleted_count"], 2)
        self.assertFalse(groups[0]["batch_context"]["is_reverted"])
        self.assertNotIn("_crop_ids", groups[0]["batch_context"])

        response = self.recover(batch.pk)
        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(response.json()["restored_count"], 2)
        self.assert_state(before, "archive recovery should restore the crop group")
        versions = self.history_counts()
        self.assertEqual(self.recover(batch.pk).json(), response.json())
        self.assertEqual(self.history_counts(), versions)

    def test_planting_plan_added_after_preview_blocks_the_entire_batch(self):
        crop = self.crop("Chard")
        unplanned = self.crop("Basil")
        location = self.write("location", "post", "/locations/", {"name": "Garden"})
        field = self.write("field", "post", "/fields/", {
            "location": location["id"], "name": "Field",
        })
        bed = self.write("bed", "post", "/beds/", {
            "field": field["id"], "name": "Bed", "area_sqm": 10,
        })
        season = self.write("season", "post", "/seasons/", {
            "start_date": "2026-01-01", "end_date": "2026-12-31",
        })
        selection = self.selection(crop, unplanned)
        before_plan = self.preview(selection)
        plan = self.write("planting plan", "post", "/planting-plans/", {
            "crop": crop, "bed": bed["id"], "season": season["id"],
            "planting_date": "2026-05-01", "area_usage_sqm": 2,
        })
        before, counts = capture_project_state(self.project), self.history_counts()
        response = self.confirm(self.confirm_payload(selection, before_plan))
        self.assert_refusal_is_atomic(response.status_code, before, counts)
        self.assertEqual(response.json()["code"], "crop_bulk_delete_preview_changed")
        self.assertEqual(response.json()["blocked_count"], 1)
        self.assertEqual(response.json()["skipped_count"], 1)
        self.assertEqual(response.json()["deleted_count"], 0)
        self.assertEqual(PlantingPlan.objects.get(pk=plan["id"]).crop_id, crop)
        with_plan = self.preview(selection)
        self.assertEqual(with_plan["planting_plan_count"], 1)
        self.assertEqual(with_plan["blockers"], [{
            "code": "planting_plans", "count": 1, "samples": [{"id": crop, "name": "Chard"}],
        }])
        self.assertIsNone(with_plan["token"])

    def test_mid_batch_failure_leaves_every_crop_intact(self):
        first = self.crop("Chard")
        second = self.crop("Bean")
        selection = self.selection(first, second)
        payload = self.confirm_payload(selection, self.preview(selection))
        before, counts = capture_project_state(self.project), self.history_counts()
        original_save = Crop.save

        def save_or_fail(crop, *args, **kwargs):
            if crop.pk == second:
                raise IntegrityError("Synthetic archive failure")
            return original_save(crop, *args, **kwargs)

        with patch.object(Crop, "save", save_or_fail):
            response = self.confirm(payload)
        self.assert_refusal_is_atomic(response.status_code, before, counts)
        self.assertEqual(response.json(), {
            "code": "crop_bulk_delete_write_failed",
            "detail": "The crop batch could not be archived.",
            "deleted_count": 0, "blocked_count": 0, "skipped_count": 0, "failed_count": 2,
        })
        self.assertFalse(BatchOperation.objects.filter(request_id=payload["request_id"]).exists())

    def test_all_requires_explicit_confirmation_and_is_bound_to_current_project(self):
        first = self.crop("Kale")
        second = self.crop("Pea")
        foreign = Project.objects.create(name="Other project", slug="other-bulk-delete")
        ProjectMembership.objects.create(user=self.user, project=foreign, role="admin")
        foreign_crop = Crop.objects.create(project=foreign, name="Outside selection")
        selection = self.selection(scope="all")
        preview = self.preview(selection)
        self.assertEqual(preview["affected_count"], 2)
        self.assertEqual(self.confirm(self.confirm_payload(selection, preview)).status_code, 400)
        mixed = self.preview(self.selection(first, foreign_crop.pk))
        self.assertEqual(mixed["missing_count"], 1)
        self.assertIsNone(mixed["token"])

        interleaved = self.crop("New crop")
        before, counts = capture_project_state(self.project), self.history_counts()
        stale = self.confirm(self.confirm_payload(selection, preview, confirm_all=True))
        self.assert_refusal_is_atomic(stale.status_code, before, counts)
        updated = self.preview(selection)
        self.assertEqual(updated["affected_count"], 3)
        request = self.confirm_payload(selection, updated, confirm_all=True)
        self.client.defaults["HTTP_X_PROJECT_ID"] = str(foreign.pk)
        self.assertEqual(self.confirm(request).json()["code"], "crop_bulk_delete_project_changed")
        self.client.defaults["HTTP_X_PROJECT_ID"] = str(self.project.pk)
        response = self.confirm(request)
        self.assertEqual(response.status_code, 200, response.json())
        self.assertTrue(Crop.objects.filter(pk=foreign_crop.pk).exists())
        self.assertFalse(Crop.objects.filter(pk__in=[first, second, interleaved]).exists())

    def test_limit_rejects_all_without_mutation(self):
        self.crop("Carrot")
        self.crop("Chard")
        before, counts = capture_project_state(self.project), self.history_counts()
        with patch("farm.services.crop_deletion.MAX_BULK_CROPS", 1):
            response = self.client.post(f"{BULK_URL}preview/", self.selection(scope="all"),
                                        format="json")
        self.assertEqual(response.json()["code"], "crop_bulk_delete_limit")
        self.assert_refusal_is_atomic(response.status_code, before, counts)

    def test_only_members_of_the_active_project_can_preview_or_confirm(self):
        crop = self.crop("Restricted crop")
        selection = self.selection(crop)
        payload = self.confirm_payload(selection, self.preview(selection))
        before, counts = capture_project_state(self.project), self.history_counts()
        outsider = get_user_model().objects.create_user(username="bulk-crop-outsider")
        self.client.force_authenticate(user=outsider)
        response = self.client.post(f"{BULK_URL}preview/", selection, format="json")
        self.assertEqual(response.status_code, 403, response.json())
        denied = self.confirm(payload)
        self.assertEqual(denied.status_code, 403, denied.json())
        self.assertEqual(capture_project_state(self.project), before)
        self.assertEqual(self.history_counts(), counts)

    def test_import_sources_are_server_owned_and_do_not_change_on_update(self):
        manual = self.crop("Handwritten crop", creation_origin="library_import")
        legacy = Crop.objects.create(
            project=self.project, name="Unknown crop", origin_type="imported",
        )
        with revision_batch(BatchOperation.objects.create(
            project=self.project, operation_type=BatchOperation.TYPE_CROP_IMPORT,
        )):
            old_import = Crop.objects.create(project=self.project, name="Recorded legacy import")
        file_result = self.write("file import", "post", "/crops/import/apply/", {
            "items": [
                {"name": "Imported chard"}, {"name": "Handwritten crop", "notes": "File edit"},
            ],
            "confirm_updates": True,
        })
        file_crop = next(
            row["crop_id"] for row in file_result["results"] if row["status"] == "created"
        )
        species = CropSpecies.objects.create(name="Library test species")
        public = PublicCrop.objects.create(
            name="Public bean", status=PublicCrop.STATUS_PUBLISHED, crop_species=species,
            created_by=self.user,
        )
        self.write("library import", "post", f"/public-crops/{public.pk}/import/", {})
        imported = Crop.objects.get(project=self.project, source_public_crop=public)
        page = self.client.get(f"{API}/crops/").json()["results"]
        origins = {crop["id"]: crop["creation_origin"] for crop in page}
        self.assertEqual(origins[manual], "manual")
        self.assertEqual(origins[legacy.pk], None)
        self.assertEqual(origins[old_import.pk], "file_import")
        self.assertEqual(origins[file_crop], "file_import")
        self.assertEqual(origins[imported.pk], "library_import")
        selection = self.selection(imported.pk)
        response = self.confirm(self.confirm_payload(selection, self.preview(selection)))
        self.assertEqual(response.status_code, 200, response.json())
        self.assertEqual(PublicCrop.objects.get(pk=public.pk).status, PublicCrop.STATUS_PUBLISHED)
