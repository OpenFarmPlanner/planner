"""Local test data must be explicit, isolated and safe to prepare repeatedly."""

from datetime import date
from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test import TestCase, override_settings

from crops.models import CropSpecies
from farm.history.project_restore import CHECKPOINT_KEY
from farm.models import (
    Crop,
    CropCompanion,
    HarvestAllocation,
    PlantingPlan,
    Project,
    ProjectMembership,
    PublicCrop,
)
from farm.services.seasonal_harvest import recurring_harvest_schedule


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

    def test_bed_picker_fixture_previews_and_is_idempotent(self):
        command = 'seed_bed_picker_acceptance'
        arguments = {key: value for key, value in self.arguments.items() if key != 'public_crop_id'}
        projects = Project.objects.filter(slug=f'ofp-local-bed-picker-{self.user.pk}')
        call_command(command, **arguments)
        self.assertFalse(projects.exists())
        with self.assertRaisesMessage(CommandError, 'does not match'):
            call_command(command, **{**arguments, 'database_name': 'wrong-target'}, apply=True)
        self.assertFalse(projects.exists())

        call_command(command, **arguments, apply=True)
        project = projects.get()
        self.assertTrue(ProjectMembership.objects.filter(
            project=project, user=self.user, role='admin',
        ).exists())
        self.assertEqual(project.locations.count(), 2)
        self.assertEqual(project.beds.count(), 4)
        self.assertEqual(project.planting_plans.count(), 3)

        call_command(command, **arguments, apply=True)
        self.assertEqual(projects.get().beds.count(), 4)

    def test_perennial_harvest_fixture_previews_and_preserves_manual_edits(self):
        command = 'seed_perennial_harvest_acceptance'
        arguments = {key: value for key, value in self.arguments.items() if key != 'public_crop_id'}
        projects = Project.objects.filter(slug=f'ofp-local-perennial-harvest-{self.user.pk}')
        call_command(command, **arguments)
        self.assertFalse(projects.exists())
        with self.assertRaisesMessage(CommandError, 'does not match'):
            call_command(command, **{**arguments, 'database_name': 'wrong-target'}, apply=True)
        self.assertFalse(projects.exists())

        call_command(command, **arguments, apply=True)
        project = projects.get()
        self.assertTrue(ProjectMembership.objects.filter(
            project=project, user=self.user, role='admin',
        ).exists())
        self.assertEqual(project.seasons.count(), 5)
        apple = project.planting_plans.get(crop__name='Apple')
        schedule = recurring_harvest_schedule(apple)
        self.assertEqual(schedule.project(date(2025, 1, 1), date(2026, 12, 31)), [])
        first, = schedule.project(date(2027, 1, 1), date(2027, 12, 31))
        self.assertEqual((first.start_date, first.end_date), (date(2027, 9, 1), date(2027, 10, 15)))
        last, = schedule.project(date(2028, 9, 1), date(2029, 8, 31))
        self.assertEqual(last.end_date, date(2028, 9, 10))
        self.assertEqual(apple.actual_harvest_start_date, date(2025, 10, 3))
        self.assertEqual(HarvestAllocation.objects.get(planting_plan=apple).quantity, 3)
        garlic = project.planting_plans.get(crop__name='Overwintering garlic')
        self.assertGreater(garlic.harvest_date, garlic.season.end_date)
        self.assertIsNone(recurring_harvest_schedule(garlic))
        rhubarb = project.planting_plans.get(crop__name='Legacy rhubarb')
        self.assertIsNone(recurring_harvest_schedule(rhubarb))

        apple.notes = 'Keep this manual edit'
        apple.save(update_fields=['notes'])
        call_command(command, **arguments, apply=True)
        apple.refresh_from_db()
        self.assertEqual(apple.notes, 'Keep this manual edit')
        self.assertEqual(project.planting_plans.count(), 4)
        self.assertEqual(HarvestAllocation.objects.filter(planting_plan=apple).count(), 1)

    def test_yield_comparison_fixture_previews_and_preserves_manual_edits(self):
        command = 'seed_yield_comparison_acceptance'
        arguments = {key: value for key, value in self.arguments.items() if key != 'public_crop_id'}
        projects = Project.objects.filter(slug=f'ofp-local-yield-comparison-{self.user.pk}')
        call_command(command, **arguments)
        self.assertFalse(projects.exists())
        with self.assertRaisesMessage(CommandError, 'does not match'):
            call_command(command, **{**arguments, 'database_name': 'wrong-target'}, apply=True)
        self.assertFalse(projects.exists())

        call_command(command, **arguments, apply=True)
        project = projects.get()
        self.assertEqual(project.seasons.count(), 4)
        self.assertEqual(project.locations.count(), 2)
        self.assertEqual(project.harvest_records.count(), 6)
        plan = project.planting_plans.order_by('pk').first()
        plan.notes = 'Keep this manual edit'
        plan.save(update_fields=['notes'])
        call_command(command, **arguments, apply=True)
        plan.refresh_from_db()
        self.assertEqual(plan.notes, 'Keep this manual edit')
        self.assertEqual(project.planting_plans.count(), 5)

    def test_season_creation_fixture_previews_and_preserves_manual_edits(self):
        command = 'seed_season_creation_dates_acceptance'
        arguments = {key: value for key, value in self.arguments.items() if key != 'public_crop_id'}
        call_command(command, **arguments)
        self.assertEqual(Project.objects.count(), len(self.project_ids_before))
        with self.assertRaisesMessage(CommandError, 'does not match'):
            call_command(command, apply=True, **{**arguments, 'database_name': 'wrong-target'})

        call_command(command, apply=True, **arguments)
        projects = Project.objects.filter(
            slug__startswith=f'ofp-local-season-creation-dates-{self.user.pk}-',
        )
        self.assertEqual(projects.count(), 2)
        for project in projects:
            self.assertTrue(ProjectMembership.objects.filter(
                project=project, user=self.user, role='admin',
            ).exists())
            plan = project.planting_plans.get()
            self.assertEqual((plan.planting_date.month, plan.planting_date.day), (4, 1))
            self.assertEqual((plan.actual_sowing_date.month, plan.actual_sowing_date.day), (4, 6))
            self.assertTrue(plan.harvest_date_is_explicit)
            self.assertIsNone(plan.actual_harvest_start_date)
            plan.notes = 'Keep this manual edit'
            plan.save(update_fields=['notes'])
        call_command(command, apply=True, **arguments)
        edited_plans = PlantingPlan.objects.filter(
            project__in=projects, notes='Keep this manual edit',
        )
        self.assertEqual(edited_plans.count(), 2)
        self.assertEqual(PlantingPlan.objects.filter(project__in=projects).count(), 2)

    def test_historical_season_fixture_previews_and_preserves_manual_edits(self):
        command = 'seed_season_creation_dates_acceptance'
        arguments = {key: value for key, value in self.arguments.items() if key != 'public_crop_id'}
        call_command(command, historical_copy=True, **arguments)
        self.assertEqual(Project.objects.count(), len(self.project_ids_before))

        call_command(command, historical_copy=True, apply=True, **arguments)
        project = Project.objects.get(name='Historical season copy')
        self.assertTrue(ProjectMembership.objects.filter(
            project=project, user=self.user, role='admin',
        ).exists())
        self.assertEqual(
            list(project.seasons.order_by('start_date').values_list('start_date', flat=True)),
            [date(2024, 1, 1), date(2025, 1, 1), date(2026, 1, 1)],
        )
        lettuce = project.planting_plans.get(crop__name='Lettuce')
        self.assertEqual(lettuce.actual_sowing_date, date(2024, 2, 29))
        carrot = project.planting_plans.get(crop__name='Carrot')
        self.assertEqual(carrot.planting_date, date(2026, 4, 1))

        lettuce.notes = 'Keep this manual edit'
        lettuce.save(update_fields=['notes'])
        call_command(command, historical_copy=True, apply=True, **arguments)
        lettuce.refresh_from_db()
        self.assertEqual(lettuce.notes, 'Keep this manual edit')
        self.assertEqual(project.planting_plans.count(), 2)
        self.assertEqual(Project.objects.count(), len(self.project_ids_before) + 1)

    def test_bed_capacity_fixture_previews_and_preserves_manual_edits(self):
        command = 'seed_bed_capacity_acceptance'
        arguments = {key: value for key, value in self.arguments.items() if key != 'public_crop_id'}
        call_command(command, **arguments)
        self.assertEqual(Project.objects.count(), len(self.project_ids_before))
        with self.assertRaisesMessage(CommandError, 'does not match'):
            call_command(command, apply=True, **{**arguments, 'database_name': 'wrong-target'})

        call_command(command, apply=True, **arguments)
        project = Project.objects.get(slug=f'ofp-local-bed-capacity-{self.user.pk}')
        bed = project.beds.get(name='Carrot and lettuce')
        first, second = project.planting_plans.filter(bed=bed).order_by('planting_date')
        self.assertEqual((bed.area_sqm, first.area_usage_sqm, second.area_usage_sqm), (10, 5, 3))
        self.assertGreater(first.occupancy_end_date, second.planting_date)
        unmeasured = project.planting_plans.get(bed__name='Unmeasured planting')
        self.assertIsNone(unmeasured.area_usage_sqm)
        self.assertFalse(project.beds.get(name='Unused bed').planting_plans.exists())
        checkpoints = project.entity_revisions.filter(
            entity_type='project', snapshot__has_key=CHECKPOINT_KEY,
        )
        self.assertEqual(checkpoints.count(), 1)

        first.notes = 'Keep the manual edit'
        first.save(update_fields=['notes'])
        call_command(command, apply=True, **arguments)
        first.refresh_from_db()
        self.assertEqual(first.notes, 'Keep the manual edit')
        self.assertEqual(Project.objects.count(), len(self.project_ids_before) + 1)
        self.assertEqual(project.planting_plans.count(), 3)
        self.assertEqual(checkpoints.count(), 1)

    def test_structure_supplier_fixture_has_a_complete_repeat_safe_baseline(self):
        command = 'seed_structure_supplier_history_acceptance'
        arguments = {key: value for key, value in self.arguments.items() if key != 'public_crop_id'}
        call_command(command, **arguments)
        self.assertEqual(Project.objects.count(), len(self.project_ids_before))
        with self.assertRaisesMessage(CommandError, 'does not match'):
            call_command(command, apply=True, **{**arguments, 'database_name': 'wrong-target'})

        call_command(command, apply=True, **arguments)
        project = Project.objects.get(slug=f'ofp-local-structure-supplier-history-{self.user.pk}')
        field = project.fields.get(name='North field')
        self.assertEqual(set(field.beds.values_list('name', flat=True)), {'North 1', 'North 2'})
        crop = project.crops.get(name='Lettuce')
        offer = crop.supplier_data.get()
        self.assertEqual(offer.supplier_id, crop.selected_seed_demand_supplier_id)
        self.assertEqual(
            (offer.seed_status, offer.seed_exemption_status), ('conventional', 'approved'),
        )
        checkpoints = project.entity_revisions.filter(
            entity_type='project', snapshot__has_key=CHECKPOINT_KEY,
        )
        self.assertEqual(checkpoints.count(), 1)

        field.notes = 'Keep my edit'
        field.save(update_fields=['notes'])
        call_command(command, apply=True, **arguments)
        field.refresh_from_db()
        self.assertEqual(field.notes, 'Keep my edit')
        self.assertEqual(Project.objects.count(), len(self.project_ids_before) + 1)
        self.assertEqual(checkpoints.count(), 1)

    def test_season_task_history_fixture_previews_and_preserves_manual_edits(self):
        command = 'seed_season_task_history_acceptance'
        arguments = {key: value for key, value in self.arguments.items() if key != 'public_crop_id'}
        call_command(command, **arguments)
        self.assertEqual(Project.objects.count(), len(self.project_ids_before))
        with self.assertRaisesMessage(CommandError, 'does not match'):
            call_command(command, apply=True, **{**arguments, 'database_name': 'wrong-target'})

        call_command(command, apply=True, **arguments)
        project = Project.objects.get(slug=f'ofp-local-season-task-history-{self.user.pk}')
        first, second, third = project.tasks.filter(template__isnull=False).order_by(
            'occurrence_index',
        )
        self.assertEqual(first.status, 'completed')
        self.assertTrue(second.due_date_overridden)
        self.assertIsNone(second.due_date)
        self.assertIsNotNone(third.deleted_at)
        self.assertIsNotNone(project.tasks.get(title='Manual check').planting_plan_id)
        self.assertIsNone(project.tasks.get(title='Unrelated task').planting_plan_id)
        self.assertTrue(project.entity_revisions.filter(snapshot__has_key=CHECKPOINT_KEY).exists())

        first.title = 'Keep my edited task title'
        first.save(update_fields=['title'])
        call_command(command, apply=True, **arguments)
        first.refresh_from_db()
        self.assertEqual(first.title, 'Keep my edited task title')
        self.assertEqual(Project.objects.count(), len(self.project_ids_before) + 1)

    def test_crop_site_fixture_is_previewed_and_preserves_manual_edits(self):
        command = 'seed_crop_site_acceptance'
        arguments = {key: value for key, value in self.arguments.items() if key != 'public_crop_id'}
        call_command(command, **arguments)
        self.assertEqual(Project.objects.count(), len(self.project_ids_before))
        call_command(command, apply=True, **arguments)
        project = Project.objects.get(slug=f'ofp-local-crop-site-{self.user.pk}')
        plan = PlantingPlan.objects.get(project=project)
        self.assertEqual(plan.bed.name, 'Inherited bed')
        self.assertEqual(plan.crop.light_requirement, ['full_sun', 'partial_shade'])
        self.assertEqual(project.beds.get(name='Sunny override bed').irrigation, 'available')
        plan.crop.notes = 'Preserve my edit'
        plan.crop.save()
        call_command(command, apply=True, **arguments)
        plan.crop.refresh_from_db()
        self.assertEqual(plan.crop.notes, 'Preserve my edit')
        self.assertEqual(Project.objects.count(), len(self.project_ids_before) + 1)

    def test_timing_windows_fixture_previews_and_preserves_manual_edits(self):
        command = 'seed_timing_windows_acceptance'
        arguments = {key: value for key, value in self.arguments.items() if key != 'public_crop_id'}
        call_command(command, **arguments)
        self.assertEqual(Project.objects.count(), len(self.project_ids_before))
        call_command(command, apply=True, **arguments)
        project = Project.objects.get(slug=f'ofp-local-timing-windows-{self.user.pk}')
        crops = {crop.name: crop for crop in Crop.objects.filter(project=project)}
        self.assertEqual(crops['Timing windows empty'].timing_windows.count(), 0)
        self.assertEqual(crops['Timing windows partial'].timing_windows.count(), 2)
        full = crops['Timing windows full']
        self.assertEqual(set(full.timing_windows.values_list('kind', flat=True)), {
            'pre_cultivation', 'direct_sowing', 'planting',
        })
        full.timing_windows.all().delete()
        call_command(command, apply=True, **arguments)
        self.assertFalse(full.timing_windows.exists())
        self.assertEqual(Crop.objects.filter(project=project).count(), 3)

    def test_companion_history_fixture_is_previewed_and_repeat_safe(self):
        command = 'seed_companion_history_acceptance'
        arguments = {key: value for key, value in self.arguments.items() if key != 'public_crop_id'}
        call_command(command, **arguments)
        self.assertEqual(Project.objects.count(), len(self.project_ids_before))
        call_command(command, apply=True, **arguments)
        project = Project.objects.get(slug=f'ofp-local-companion-history-{self.user.pk}')
        relation = CropCompanion.objects.get(project=project)
        self.assertEqual(relation.crop.name, 'Companion history owner')
        self.assertEqual(relation.companion_text, 'Companion history later')
        self.assertEqual(Crop.objects.filter(project=project).count(), 2)
        relation.note = 'Keep the manual edit'
        relation.save(update_fields=['note'])

        call_command(command, apply=True, **arguments)
        relation.refresh_from_db()
        self.assertEqual(relation.note, 'Keep the manual edit')
        self.assertEqual(Project.objects.count(), len(self.project_ids_before) + 1)

    def test_crop_library_history_fixture_requires_packages_and_preserves_local_edits(self):
        command = 'seed_crop_library_history_acceptance'
        with self.assertRaisesMessage(CommandError, 'with seed packages'):
            call_command(command, **self.arguments)
        self.entry.seed_packages = [{'size_value': 25, 'size_unit': 'g'}]
        self.entry.save()

        call_command(command, **self.arguments)
        self.assertEqual(
            list(Project.objects.values_list('pk', flat=True)), self.project_ids_before,
        )
        call_command(command, apply=True, **self.arguments)
        project = Project.objects.get(
            slug=f'ofp-local-crop-library-history-{self.user.pk}-{self.entry.pk}',
        )
        self.assertTrue(ProjectMembership.objects.filter(
            project=project, user=self.user, role='admin',
        ).exists())
        self.assertFalse(Crop.objects.filter(project=project).exists())
        crop = Crop.objects.create(project=project, name='My test crop', notes='Keep this edit')

        call_command(command, apply=True, **self.arguments)
        self.assertEqual(Project.objects.count(), len(self.project_ids_before) + 1)
        self.assertEqual(Crop.objects.get(pk=crop.pk).notes, 'Keep this edit')
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.seed_packages, [{'size_value': 25, 'size_unit': 'g'}])

    def test_import_history_fixture_is_previewed_and_repeat_safe(self):
        arguments = {key: value for key, value in self.arguments.items() if key != 'public_crop_id'}
        before = Project.objects.count()
        call_command('seed_import_history_acceptance', **arguments)
        self.assertEqual(Project.objects.count(), before)
        call_command('seed_import_history_acceptance', apply=True, **arguments)
        self.assertEqual(Project.objects.count(), before + 3)
        project = Project.objects.get(slug=f'ofp-local-import-history-{self.user.pk}-safe')
        crop = Crop.objects.get(project=project, name='Later independent crop')
        crop.notes = 'Preserve my manual edit'
        crop.save()
        revisions = project.entity_revisions.count()
        call_command('seed_import_history_acceptance', apply=True, **arguments)
        crop.refresh_from_db()
        self.assertEqual(crop.notes, 'Preserve my manual edit')
        self.assertEqual(project.entity_revisions.count(), revisions)

    def test_variety_fixture_is_guarded_previewed_and_preserves_manual_edits(self):
        arguments = {key: value for key, value in self.arguments.items() if key != 'public_crop_id'}
        before = Project.objects.count()
        call_command('seed_variety_conflict_acceptance', **arguments)
        self.assertEqual(Project.objects.count(), before)
        with self.assertRaises(CommandError):
            call_command('seed_variety_conflict_acceptance', apply=True,
                         **{**arguments, 'database_name': 'wrong-target'})
        call_command('seed_variety_conflict_acceptance', apply=True, **arguments)
        project = Project.objects.get(slug=f'ofp-local-variety-conflict-{self.user.pk}')
        crop = Crop.objects.get(project=project, name='Source', variety='')
        crop.notes = 'Keep manual edit'
        crop.save()
        revisions = project.entity_revisions.count()
        call_command('seed_variety_conflict_acceptance', apply=True, **arguments)
        crop.refresh_from_db()
        self.assertEqual(crop.notes, 'Keep manual edit')
        self.assertEqual(project.entity_revisions.count(), revisions)
        self.assertEqual(Project.objects.count(), before + 1)

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
        if connection.vendor != 'sqlite':
            self.skipTest('SQLite-specific concurrency options; PostgreSQL uses its native locks.')
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


    def test_name_conflict_fixtures_preview_guard_and_repeat_preserve_local_values(self):
        self.seed(include_name_conflicts=True)
        self.assertIn('5 projects', self.arguments['stdout'].getvalue())
        self.assertEqual(Crop.objects.count(), 0)
        with override_settings(DJANGO_ENV='production'), self.assertRaises(CommandError):
            self.seed(apply=True, include_name_conflicts=True)
        self.seed(apply=True, include_name_conflicts=True)
        for mode in ('unclassified-picker', 'unclassified-page', 'legacy-sync'):
            project = Project.objects.get(
                slug=f'local-library-import-{self.user.pk}-{self.entry.pk}-{mode}',
            )
            manual = Crop.objects.get(project=project, name=self.entry.name, variety='')
            self.assertIsNone(manual.crop_species_id)
            self.assertIsNone(manual.source_public_crop_id)
            self.assertEqual(PlantingPlan.objects.filter(project=project).count(), 12)
            if mode == 'legacy-sync':
                imported = Crop.objects.get(project=project, source_public_crop=self.entry)
                self.assertEqual(imported.name, f'{self.entry.name} (2)')
                self.assertEqual(imported.crop_species_id, self.species.pk)
            else:
                self.assertEqual(Crop.objects.filter(project=project).count(), 13)
        manual.notes = 'Preserved manual acceptance edits'
        manual.save()
        before = list(Crop.objects.order_by('pk').values())
        public_before = list(PublicCrop.objects.values())
        self.seed(apply=True, include_name_conflicts=True)
        self.assertEqual(list(Crop.objects.order_by('pk').values()), before)
        self.assertEqual(list(PublicCrop.objects.values()), public_before)

    def test_variety_selection_fixture_is_isolated_previewed_and_idempotent(self):
        before_public = list(PublicCrop.objects.values())
        self.seed(include_variety_selection=True)
        self.assertEqual(list(PublicCrop.objects.values()), before_public)
        self.seed(apply=True, include_variety_selection=True)
        projects = Project.objects.filter(
            slug__startswith=f"local-variety-selection-{self.user.pk}-"
        )
        self.assertEqual(projects.count(), 2)
        empty = projects.get(slug__endswith="-empty")
        partial = projects.get(slug__endswith="-partial")
        self.assertEqual(Crop.objects.filter(project=empty).count(), 0)
        self.assertEqual(
            Crop.objects.filter(project=partial, source_public_crop__isnull=False).count(), 2
        )
        local = Crop.objects.get(project=partial, variety="Rodelika")
        self.assertIsNone(local.source_public_crop_id)
        self.assertEqual(local.growth_duration_days, 105)
        self.assertEqual(PlantingPlan.objects.get(project=partial).crop_id, local.pk)
        self.assertEqual(PublicCrop.objects.filter(crop_species=local.crop_species).count(), 4)
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.name, self.species.name)
        snapshot = list(Crop.objects.filter(project=partial).values())
        public_snapshot = list(PublicCrop.objects.values())
        self.seed(apply=True, include_variety_selection=True)
        self.assertEqual(list(Crop.objects.filter(project=partial).values()), snapshot)
        self.assertEqual(list(PublicCrop.objects.values()), public_snapshot)

    def test_variety_selection_fixture_rolls_back_an_occupied_synthetic_identity(self):
        CropSpecies.objects.create(name=f"Carrot (local variety selection {self.user.pk})")
        before = list(Project.objects.values_list("pk", flat=True))
        with self.assertRaisesMessage(CommandError, "identity is occupied"):
            self.seed(apply=True, include_variety_selection=True)
        self.assertEqual(list(Project.objects.values_list("pk", flat=True)), before)


@override_settings(DJANGO_ENV='development')
class SpeciesModerationLocalSeedTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='species-seed', is_staff=True)
        self.published = CropSpecies.objects.create(name='Existing published catalogue species')
        self.existing_species = list(CropSpecies.objects.order_by('pk').values())
        self.projects_before = Project.objects.count()
        self.memberships_before = ProjectMembership.objects.filter(user=self.user).count()
        self.options = {
            'username': self.user.username, 'database_name': str(connection.settings_dict['NAME']),
            'stdout': StringIO(),
        }
        environment = patch.dict('os.environ', {'OFP_LOCAL_TEST_DATA': '1'})
        environment.start()
        self.addCleanup(environment.stop)

    def seed(self, **options):
        call_command('seed_species_moderation_acceptance', **{**self.options, **options})

    def test_preview_repeat_and_manual_decisions_preserve_existing_data(self):
        existing = CropSpecies.objects.filter(pk=self.published.pk).values().get()
        self.seed()
        self.assertEqual(list(CropSpecies.objects.order_by('pk').values()), self.existing_species)
        self.assertEqual(Project.objects.count(), self.projects_before)
        self.seed(apply=True)
        self.assertEqual(
            list(CropSpecies.objects.filter(
                pk__in=[row['id'] for row in self.existing_species],
            ).order_by('pk').values()), self.existing_species,
        )
        self.assertEqual(
            CropSpecies.objects.filter(proposed_by=self.user, status='proposed').count(), 3,
        )
        counts = {}
        for species in CropSpecies.objects.filter(proposed_by=self.user):
            counts[species.name.rsplit(' ', 1)[-1]] = sum(
                bool(row.common_name.strip()) for row in species.translations.all()
            )
        self.assertEqual(counts, {'complete': 7, 'optional-missing': 5, 'required-missing': 5})
        proposal = CropSpecies.objects.filter(proposed_by=self.user).first()
        proposal.status = 'published'
        proposal.name = 'Manual local decision and rename'
        proposal.save()
        before = list(CropSpecies.objects.order_by('pk').values())
        self.seed(apply=True)
        self.assertEqual(list(CropSpecies.objects.order_by('pk').values()), before)
        self.assertEqual(CropSpecies.objects.filter(pk=self.published.pk).values().get(), existing)
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_superuser)
        self.assertEqual(
            ProjectMembership.objects.filter(user=self.user).count(), self.memberships_before + 1,
        )

    def test_explicit_target_and_existing_moderator_are_required(self):
        with self.assertRaises(CommandError):
            self.seed(apply=True, database_name='wrong-target')
        self.user.is_staff = False
        self.user.save()
        with self.assertRaises(CommandError):
            self.seed(apply=True)
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_staff)
        self.assertEqual(list(CropSpecies.objects.order_by('pk').values()), self.existing_species)
        self.assertEqual(Project.objects.count(), self.projects_before)

    def test_existing_fixture_project_with_different_ownership_is_not_changed(self):
        project = Project.objects.create(
            name='Unrelated project', slug=f'ofp-local-species-moderation-{self.user.pk}',
            description='Existing unrelated data',
        )
        with self.assertRaises(CommandError):
            self.seed(apply=True)
        project.refresh_from_db()
        self.assertEqual(project.description, 'Existing unrelated data')
        self.assertFalse(CropSpecies.objects.filter(proposed_by=self.user).exists())
