"""Local fixture guards, repeat safety and absence of global catalogue writes."""

from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test import TestCase, override_settings

from crops.models import CropSpecies
from crops.plant_health_models import PlantHealthEntry
from farm.management.commands.seed_private_plant_health_acceptance import MARKER
from farm.models import Crop, PlantingPlan, Project, ProjectMembership


@override_settings(DJANGO_ENV="development")
class PrivateHealthSeedTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="private-health-fixture")
        self.species = CropSpecies.objects.create(
            name="Synthetic fixture species", status="published"
        )
        self.entry = PlantHealthEntry.objects.create(
            name="Synthetic approved fixture", status="published"
        )
        self.options = {
            "username": self.user.username,
            "species_id": self.species.pk,
            "catalogue_entry_id": self.entry.pk,
            "database_name": str(connection.settings_dict["NAME"]),
            "stdout": StringIO(),
        }
        self.project_ids_before = set(Project.objects.values_list("pk", flat=True))
        self.species_ids_before = set(CropSpecies.objects.values_list("pk", flat=True))
        self.entry_ids_before = set(PlantHealthEntry.objects.values_list("pk", flat=True))
        environment = patch.dict("os.environ", {"OFP_LOCAL_TEST_DATA": "1"})
        environment.start()
        self.addCleanup(environment.stop)

    def seed(self, **options):
        call_command("seed_private_plant_health_acceptance", **{**self.options, **options})

    def test_preview_apply_repeat_preserve_manual_edits_and_do_not_write_global_data(self):
        self.seed()
        self.assertEqual(set(Project.objects.values_list("pk", flat=True)), self.project_ids_before)
        self.seed(apply=True)
        project = Project.objects.get(description=MARKER)
        self.assertEqual(Crop.objects.filter(project=project).count(), 4)
        self.assertEqual(ProjectMembership.objects.get(project=project).user_id, self.user.pk)
        parent = Crop.objects.get(project=project, variety="")
        plan = PlantingPlan.objects.get(project=project)
        original_crop_id = plan.crop_id
        parent.plant_health = {"entries": []}
        parent.notes = "Keep my manual edit"
        parent.save()
        self.seed(apply=True)
        parent.refresh_from_db()
        plan.refresh_from_db()
        self.assertEqual(parent.plant_health, {"entries": []})
        self.assertEqual(parent.notes, "Keep my manual edit")
        self.assertEqual(plan.crop_id, original_crop_id)
        self.assertEqual(
            set(PlantHealthEntry.objects.values_list("pk", flat=True)),
            self.entry_ids_before,
        )
        self.assertEqual(
            set(CropSpecies.objects.values_list("pk", flat=True)),
            self.species_ids_before,
        )
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_staff)
        self.assertFalse(self.user.is_superuser)

    def test_missing_prerequisites_or_database_confirmation_create_nothing(self):
        for options in [
            {"username": "missing"},
            {"catalogue_entry_id": 999999},
            {"database_name": "wrong"},
        ]:
            with self.subTest(options=options), self.assertRaises(CommandError):
                self.seed(apply=True, **options)
        self.assertEqual(set(Project.objects.values_list("pk", flat=True)), self.project_ids_before)

    def test_rejects_occupied_fixture_slug_without_granting_project_access(self):
        slug = (
            f"ofp-local-private-health-{self.user.pk}-{self.species.pk}-"
            f"{self.entry.identity_key.hex[:12]}"
        )
        project = Project.objects.create(name="Manual project", slug=slug)
        with self.assertRaisesMessage(CommandError, "ownership"):
            self.seed(apply=True)
        self.assertFalse(ProjectMembership.objects.filter(project=project).exists())
        self.assertFalse(Crop.objects.exists())

    def test_production_and_routing_overrides_are_rejected_before_writes(self):
        with override_settings(DJANGO_ENV="production"), self.assertRaises(CommandError):
            self.seed(apply=True)
        with (
            patch.dict("os.environ", {"PGHOSTADDR": "unapproved-target"}),
            self.assertRaises(CommandError),
        ):
            self.seed(apply=True)
        self.assertEqual(set(Project.objects.values_list("pk", flat=True)), self.project_ids_before)
