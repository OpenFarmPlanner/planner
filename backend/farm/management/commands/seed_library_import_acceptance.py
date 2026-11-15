"""Prepare isolated local fixtures for one-time versus linked library imports."""

from __future__ import annotations

import os
from datetime import date
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.models import AbstractBaseUser
from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.db import connection, transaction
from django.db.migrations.executor import MigrationExecutor

from config.sqlite_options import SQLITE_CONCURRENCY_OPTIONS
from farm.models import (
    Crop,
    PlantingPlan,
    Project,
    ProjectMembership,
    PublicCrop,
    Season,
    SeasonPattern,
)

MARKER = "Synthetic library import acceptance fixture v1."


class Command(BaseCommand):
    help = "Preview or create isolated local library import test projects without resetting data."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--username", required=True)
        parser.add_argument("--public-crop-id", type=int, required=True)
        parser.add_argument(
            "--database-name", required=True, help="Exact configured local database name/path."
        )
        parser.add_argument(
            "--apply", action="store_true", help="Write fixtures; otherwise only preview."
        )
        parser.add_argument(
            "--include-resolution", action="store_true",
            help="Also prepare a third project for explicit share, pull and private-pin decisions.",
        )
        parser.add_argument(
            "--include-direct-import", action="store_true",
            help="Also prepare an empty project for a one-click linked library import.",
        )

        parser.add_argument(
            "--include-name-conflicts", action="store_true",
            help="Add two unclassified import targets and a legacy numbered-name sync conflict.",
        )

        parser.add_argument(
            "--include-variety-selection", action="store_true",
            help="Add synthetic Carrot entries with empty/partially linked local projects.",
        )

    def validate_database(self, confirmed_name: str) -> tuple[str, str, str]:
        database = connection.settings_dict
        if (
            settings.DJANGO_ENV not in {"development", "test"}
            or os.getenv("OFP_LOCAL_TEST_DATA") != "1"
        ):
            raise CommandError(
                "Set DJANGO_ENV=development and OFP_LOCAL_TEST_DATA=1 explicitly "
                "in a local environment."
            )
        engine, host, name = database["ENGINE"], database.get("HOST", ""), str(database["NAME"])
        if engine == "django.db.backends.sqlite3":
            if name != ":memory:" and not Path(name).resolve().is_relative_to(
                Path(settings.BASE_DIR).resolve()
            ):
                raise CommandError(
                    "SQLite fixtures require a database within the local backend directory."
                )
        elif engine != "django.db.backends.postgresql" or host not in {
            "localhost",
            "127.0.0.1",
            "::1",
        }:
            raise CommandError(
                "Fixtures require local SQLite or loopback PostgreSQL; "
                "remote/socket targets are refused."
            )
        connection_options = database.get("OPTIONS") or {}
        if connection_options and (
            engine != "django.db.backends.sqlite3"
            or not isinstance(connection_options, dict)
            or any(
                key not in SQLITE_CONCURRENCY_OPTIONS
                or value != SQLITE_CONCURRENCY_OPTIONS[key]
                for key, value in connection_options.items()
            )
        ):
            raise CommandError(
                "Only standard SQLite concurrency options are supported for local fixtures."
            )
        if any(os.getenv(key) for key in ('PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE')):
            raise CommandError('PostgreSQL routing environment overrides are not supported.')
        if confirmed_name != name:
            raise CommandError("The confirmed database name does not match the configured target.")
        executor = MigrationExecutor(connection)
        if executor.migration_plan(executor.loader.graph.leaf_nodes()):
            raise CommandError(
                "Apply this checkout's migrations locally before preparing fixtures."
            )
        return engine, host, name

    def handle(self, *args: object, **options: object) -> None:
        engine, host, name = self.validate_database(str(options["database_name"]))
        user = get_user_model().objects.filter(username=options["username"], is_active=True).first()
        entry = (
            PublicCrop.objects.select_related("crop_species")
            .filter(
                pk=options["public_crop_id"],
                status=PublicCrop.STATUS_PUBLISHED,
                variety="",
                crop_species__status="published",
            )
            .first()
        )
        if user is None or entry is None:
            raise CommandError(
                "An existing active local user and published species-level "
                "library entry are required."
            )
        self.stdout.write(
            f'Target: {engine}, host={host or "local file"}, database={name}; '
            f"user={user.username}; entry={entry.pk}."
        )
        modes = self._fixture_modes(options)
        if not options["apply"]:
            self._preview(modes, options)
            return
        with transaction.atomic():
            for mode in modes:
                slug = f"local-library-import-{user.pk}-{entry.pk}-{mode}"
                project, created = Project.objects.get_or_create(
                    slug=slug,
                    defaults={
                        "name": f"Library import test {entry.name} ({mode})",
                        "description": MARKER,
                    },
                )
                if not created:
                    if (
                        project.description != MARKER
                        or not ProjectMembership.objects.filter(
                            project=project,
                            user=user,
                            role="admin",
                        ).exists()
                    ):
                        raise CommandError(
                            "Fixture slug is occupied by another project; nothing was changed."
                        )
                    self.stdout.write(
                        f"Kept existing test project {project.pk}: {project.name}; "
                        "no reset performed."
                    )
                    continue
                self._populate_project(project, user, entry, mode)
            if options.get("include_variety_selection"):
                self._seed_variety_selection(user)
        self.stdout.write(
            "Fixtures ready. Import selected library values once in the first project "
            "and link in the second; preserve IDs, notes, variety overrides and plans."
        )
        if options.get("include_resolution"):
            self.stdout.write(
                "In the resolve project, take the library growth duration, explicitly share "
                "the local harvest duration, and keep notes local only. Use an established "
                "local session account; this command changes no contribution permissions "
                "and does not edit the library entry."
            )
        if options.get("include_direct_import"):
            self.stdout.write(
                "In the direct project, import the selected entry once and verify its link. "
                "Unlink it and verify the culture remains. In the link project, verify "
                "the existing-culture comparison still opens. Repeated seeding preserves "
                "these manual decisions."
            )
        if options.get("include_name_conflicts"):
            self.stdout.write(
                "In each unclassified project, use the picker/page import, explicitly select "
                "the existing culture and confirm. In legacy-sync, take the library name: "
                "expect a conflict and unchanged rows, then cancel. No repair is performed."
            )

    @staticmethod
    def _fixture_modes(options: dict[str, object]) -> tuple[str, ...]:
        modes = (
            ("once", "link", "resolve") if options.get("include_resolution") else ("once", "link")
        )
        if options.get("include_direct_import"):
            modes += ("direct",)
        if options.get("include_name_conflicts"):
            modes += ("unclassified-picker", "unclassified-page", "legacy-sync")
        return modes

    def _preview(self, modes: tuple[str, ...], options: dict[str, object]) -> None:
        if options.get("include_variety_selection"):
            self.stdout.write("Also preview: isolated synthetic Carrot with three varieties; "
                              "empty and partially linked projects. No library rows changed.")
        if options.get("include_name_conflicts"):
            self.stdout.write(
                f"Preview only: {len(modes)} projects ({', '.join(modes)}); "
                "unclassified modes keep the general culture and varieties without a species. "
                "The legacy-sync project also has a numbered linked general culture. "
                "No changes made."
            )
            return
        if options.get("include_direct_import"):
            self.stdout.write(
                f"Preview only: {len(modes)} projects: {len(modes) - 1} with one "
                "general culture, 12 varieties and 12 plans each, plus one empty "
                "direct-import project. No changes made."
            )
        else:
            self.stdout.write(
                f"Preview only: {len(modes)} projects, each with one general culture, "
                "12 varieties and 12 plans. No changes made."
            )

    def _populate_project(
        self, project: Project, user: AbstractBaseUser, entry: PublicCrop, mode: str,
    ) -> None:
        ProjectMembership.objects.create(project=project, user=user, role="admin")
        SeasonPattern.objects.create(project=project)
        year = date.today().year
        season = Season.objects.create(
            project=project,
            start_date=date(year, 1, 1),
            end_date=date(year, 12, 31),
            created_by=user,
        )
        if mode == "direct":
            self.stdout.write(
                f"Created empty project {project.pk}: {project.name}; no matching culture."
            )
            return
        unclassified = mode.startswith("unclassified-") or mode == "legacy-sync"
        general = Crop.objects.create(
            project=project,
            name=entry.name,
            crop_species=None if unclassified else entry.crop_species,
            growth_duration_days=(entry.growth_duration_days or 80) + 10,
            harvest_duration_days=(entry.harvest_duration_days or 20) + 7
            if mode == "resolve" else None,
            notes="Private acceptance-test notes: keep this value.",
            cultivation_types=["pre_cultivation"],
        )
        for index in range(1, 13):
            variety = Crop.objects.create(
                project=project,
                name=entry.name,
                crop_species=None if unclassified else entry.crop_species,
                variety=f"Test variety {index:02d}",
                growth_duration_days=105 if index == 1 else None,
            )
            PlantingPlan.objects.create(
                project=project,
                season=season,
                crop=variety,
                planting_date=date(year, 5, 15),
                quantity=8,
                cultivation_type="pre_cultivation",
                created_by=user,
            )
        if mode == "legacy-sync":
            from farm.services.public_crops import import_public_crop_into_project

            imported, _ = import_public_crop_into_project(
                public_crop=entry, project=project, mode="new", base_version=entry.version,
            )
            self.stdout.write(
                f"Legacy sync conflict: manual culture {general.pk}; "
                f"numbered linked culture {imported.pk}. Both rows must be preserved."
            )
        self.stdout.write(
            f"Created project {project.pk}: {project.name}; general culture {general.pk}."
        )

    def _seed_variety_selection(self, user: AbstractBaseUser) -> None:
        from crops.models import CropSpecies
        from farm.services.public_crops import import_public_crop_into_project

        name = f"Carrot (local variety selection {user.pk})"
        species, created = CropSpecies.objects.get_or_create(name=name)
        if not created:
            projects = Project.objects.filter(
                slug__startswith=f"local-variety-selection-{user.pk}-"
            )
            if projects.count() != 2 or any(
                project.description != MARKER
                or not ProjectMembership.objects.filter(
                    project=project, user=user, role="admin"
                ).exists()
                for project in projects
            ):
                raise CommandError(
                    "Synthetic selection fixture identity is occupied; nothing changed."
                )
            self.stdout.write(
                "Kept existing synthetic variety selection projects; no reset performed."
            )
            return
        entries = [
            PublicCrop.objects.create(
                name=name,
                crop_species=species,
                variety=variety,
                status=PublicCrop.STATUS_PUBLISHED,
                created_by=user,
                growth_duration_days=78 if not variety else 90,
                notes="Synthetic local variety selection fixture.",
            )
            for variety in ("", "Nantaise 2", "Nantaise 2/Milan", "Rodelika")
        ]
        for mode in ("empty", "partial"):
            project = Project.objects.create(
                name=f"Carrot variety selection ({mode})",
                description=MARKER,
                slug=f"local-variety-selection-{user.pk}-{mode}",
            )
            ProjectMembership.objects.create(project=project, user=user, role="admin")
            SeasonPattern.objects.create(project=project)
            if mode == "partial":
                for entry in entries[:2]:
                    import_public_crop_into_project(public_crop=entry, project=project)
                target = Crop.objects.create(
                    project=project,
                    name=name,
                    variety="Rodelika",
                    crop_species=species,
                    notes="Private synthetic variety notes; keep local.",
                    growth_duration_days=105,
                )
                PlantingPlan.objects.create(
                    project=project,
                    crop=target,
                    planting_date=date(date.today().year, 5, 15),
                    quantity=8,
                    cultivation_type="direct_sowing",
                    created_by=user,
                )
            self.stdout.write(
                f"Variety selection project {project.pk} ({mode}); library culture {entries[0].pk}."
            )
