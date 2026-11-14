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

    def test_normal_sqlite_concurrency_options_allow_safe_local_fixture_creation(self):
        public_count = PublicCrop.objects.count()
        options = {
            'timeout': 20,
            'transaction_mode': 'IMMEDIATE',
            'init_command': 'PRAGMA journal_mode=WAL;PRAGMA synchronous=NORMAL;',
        }
        with patch.dict(connection.settings_dict, {'OPTIONS': options}):
            self.seed(apply=True, include_direct_import=True)
        self.assertEqual(Project.objects.count(), len(self.project_ids_before) + 3)
        self.assertEqual(Crop.objects.count(), 26)
        self.assertEqual(PublicCrop.objects.count(), public_count)

    def test_nonstandard_sqlite_and_postgres_options_remain_refused(self):
        for options in [
            {'init_command': 'SELECT 1;'},
            {'uri': True},
            {'transaction_mode': 'DEFERRED'},
            {'timeout': 20, 'service': 'alternate'},
        ]:
            with patch.dict(connection.settings_dict, {'OPTIONS': options}):
                with self.assertRaises(CommandError):
                    self.seed(apply=True, include_direct_import=True)
        with patch.dict(connection.settings_dict, {
            'ENGINE': 'django.db.backends.postgresql', 'HOST': '127.0.0.1',
            'OPTIONS': {'timeout': 20},
        }), self.assertRaises(CommandError):
            self.seed(apply=True, include_direct_import=True)
        self.assertEqual(list(Project.objects.values_list('pk', flat=True)), self.project_ids_before)

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

    def test_optional_resolution_project_is_previewed_and_preserves_later_manual_decisions(self):
        self.seed(include_resolution=True)
        self.assertIn('3 projects', self.arguments['stdout'].getvalue())
        self.assertEqual(Crop.objects.count(), 0)
        self.seed(apply=True, include_resolution=True)
        self.assertEqual(Crop.objects.count(), 39)
        self.assertEqual(PlantingPlan.objects.count(), 36)
        project = Project.objects.get(
            slug=f'local-library-import-{self.user.pk}-{self.entry.pk}-resolve',
        )
        general = Crop.objects.get(project=project, variety='')
        self.assertEqual(general.harvest_duration_days, 27)
        self.assertEqual(general.growth_duration_days, 88)
        general.notes = 'Manually retained private notes'
        general.save()
        self.entry.harvest_duration_days = 31
        self.entry.save()
        before = list(Crop.objects.values_list('pk', 'updated_at'))
        self.seed(apply=True, include_resolution=True)
        self.assertEqual(list(Crop.objects.values_list('pk', 'updated_at')), before)
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.harvest_duration_days, 31)

    def test_optional_direct_import_project_is_empty_and_repeat_preserves_an_import(self):
        self.seed(include_direct_import=True)
        preview = self.arguments['stdout'].getvalue()
        self.assertIn('3 projects', preview)
        self.assertIn('one empty direct-import project', preview)
        self.assertEqual(Crop.objects.count(), 0)
        self.seed(apply=True, include_direct_import=True)
        direct = Project.objects.get(
            slug=f'local-library-import-{self.user.pk}-{self.entry.pk}-direct',
        )
        control = Project.objects.get(
            slug=f'local-library-import-{self.user.pk}-{self.entry.pk}-link',
        )
        self.assertFalse(Crop.objects.filter(project=direct).exists())
        self.assertFalse(PlantingPlan.objects.filter(project=direct).exists())
        self.assertEqual(Crop.objects.filter(project=control).count(), 13)
        self.assertEqual(Crop.objects.count(), 26)
        imported = Crop.objects.create(
            project=direct, name=self.entry.name, crop_species=self.species,
            derived_from_public_crop=self.entry, notes='Manually imported and unlinked',
        )
        before = list(Crop.objects.values_list('pk', 'updated_at'))
        public_count = PublicCrop.objects.count()
        self.seed(apply=True, include_direct_import=True)
        self.assertEqual(list(Crop.objects.values_list('pk', 'updated_at')), before)
        imported.refresh_from_db()
        self.assertEqual(imported.notes, 'Manually imported and unlinked')
        self.assertIsNone(imported.source_public_crop_id)
        self.assertEqual(PublicCrop.objects.count(), public_count)

    def test_direct_project_collision_rolls_back_new_populated_projects(self):
        occupied = Project.objects.create(
            slug=f'local-library-import-{self.user.pk}-{self.entry.pk}-direct',
            name='Unrelated direct project',
        )
        with self.assertRaisesMessage(CommandError, 'occupied'):
            self.seed(apply=True, include_direct_import=True, include_resolution=True)
        self.assertEqual(set(Project.objects.values_list('pk', flat=True)),
                         set(self.project_ids_before + [occupied.pk]))
        self.assertEqual(Crop.objects.count(), 0)
        self.assertEqual(PlantingPlan.objects.count(), 0)
