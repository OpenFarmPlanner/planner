"""Local test data must be explicit, isolated and safe to prepare repeatedly."""

from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test import TestCase, override_settings

from crops.models import CropSpecies
from farm.models import Crop, PlantingPlan, Project, ProjectMembership, PublicCrop


@override_settings(DJANGO_ENV="development")
class LocalLibraryImportSeedTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="local-fixture-owner")
        self.species = CropSpecies.objects.create(name="Synthetic local fixture species")
        self.entry = PublicCrop.objects.create(
            name=self.species.name,
            crop_species=self.species,
            status="published",
            variety="",
            growth_duration_days=78,
        )
        self.project_ids_before = list(Project.objects.values_list("pk", flat=True))
        self.memberships_before = ProjectMembership.objects.filter(
            user=self.user, role="admin"
        ).count()
        self.arguments = {
            "username": self.user.username,
            "public_crop_id": self.entry.pk,
            "database_name": str(connection.settings_dict["NAME"]),
            "stdout": StringIO(),
        }
        self.environment = patch.dict("os.environ", {"OFP_LOCAL_TEST_DATA": "1"})
        self.environment.start()
        self.addCleanup(self.environment.stop)

    def seed(self, **options):
        call_command("seed_library_import_acceptance", **{**self.arguments, **options})

    def test_preview_and_invalid_target_never_write(self):
        self.seed()
        self.assertEqual(
            list(Project.objects.values_list("pk", flat=True)), self.project_ids_before
        )
        self.assertIn("Preview only", self.arguments["stdout"].getvalue())
        with self.assertRaisesMessage(CommandError, "does not match"):
            self.seed(database_name="another-database", apply=True)
        with override_settings(DJANGO_ENV="production"), self.assertRaises(CommandError):
            self.seed(apply=True)
        with patch.dict("os.environ", {"OFP_LOCAL_TEST_DATA": ""}), self.assertRaises(CommandError):
            self.seed(apply=True)
        self.assertEqual(
            list(Project.objects.values_list("pk", flat=True)), self.project_ids_before
        )

    def test_remote_and_overridden_connections_are_refused_before_connecting(self):
        for changes in [
            dict(ENGINE="django.db.backends.postgresql", HOST="production.example"),
            dict(ENGINE="django.db.backends.postgresql", HOST=""),
            dict(OPTIONS={"hostaddr": "198.51.100.1"}),
            dict(OPTIONS={"service": "production"}),
        ]:
            with patch.dict(connection.settings_dict, changes), self.assertRaises(CommandError):
                self.seed(apply=True)
        self.assertEqual(
            list(Project.objects.values_list("pk", flat=True)), self.project_ids_before
        )

    def test_pending_migrations_and_missing_prerequisites_do_not_create_partial_data(self):
        with patch(
            "farm.management.commands.seed_library_import_acceptance.MigrationExecutor"
        ) as executor:
            executor.return_value.migration_plan.return_value = ["pending"]
            with self.assertRaisesMessage(CommandError, "migrations"):
                self.seed(apply=True)
        for options in [dict(username="missing"), dict(public_crop_id=999999)]:
            with self.assertRaises(CommandError):
                self.seed(apply=True, **options)
        self.assertEqual(
            list(Project.objects.values_list("pk", flat=True)), self.project_ids_before
        )

    def test_postgres_environment_cannot_redirect_an_apparently_local_target(self):
        for key in ('PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE'):
            with patch.dict('os.environ', {key: 'remote-target'}), self.assertRaises(CommandError):
                self.seed(apply=True)
        self.assertEqual(
            list(Project.objects.values_list('pk', flat=True)), self.project_ids_before
        )

    def test_fixture_is_complete_and_repeated_run_preserves_manual_changes(self):
        self.seed(apply=True)
        self.assertEqual(Project.objects.count(), len(self.project_ids_before) + 2)
        self.assertEqual(Crop.objects.count(), 26)
        self.assertEqual(PlantingPlan.objects.count(), 24)
        self.assertEqual(
            ProjectMembership.objects.filter(user=self.user, role="admin").count(),
            self.memberships_before + 2,
        )
        general = Crop.objects.filter(variety="").first()
        self.assertEqual(general.growth_duration_days, 88)
        self.assertEqual(Crop.objects.filter(source_public_crop__isnull=False).count(), 0)
        before = list(PlantingPlan.objects.values_list("pk", "crop_id"))
        general.notes = "Manually changed during acceptance testing"
        general.save()
        self.seed(apply=True)
        general.refresh_from_db()
        self.assertEqual(general.notes, "Manually changed during acceptance testing")
        self.assertEqual(Crop.objects.count(), 26)
        self.assertEqual(list(PlantingPlan.objects.values_list("pk", "crop_id")), before)
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.growth_duration_days, 78)

    def test_collision_in_second_project_rolls_back_first_project_and_all_related_data(self):
        occupied = Project.objects.create(
            slug=f"local-library-import-{self.user.pk}-{self.entry.pk}-link",
            name="Existing unrelated project",
        )
        with self.assertRaisesMessage(CommandError, "occupied"):
            self.seed(apply=True)
        self.assertEqual(
            set(Project.objects.values_list("pk", flat=True)),
            set(self.project_ids_before + [occupied.pk]),
        )
        self.assertEqual(Crop.objects.count(), 0)
        self.assertEqual(PlantingPlan.objects.count(), 0)
