"""Prepare isolated local fixtures for one-time versus linked library imports."""

from __future__ import annotations

import os
from datetime import date
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.db import connection, transaction
from django.db.migrations.executor import MigrationExecutor

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
        if database.get("OPTIONS"):
            raise CommandError("Database connection options are not supported for local fixtures.")
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
        if not options["apply"]:
            self.stdout.write(
                "Preview only: two projects, each with one general culture, "
                "12 varieties and 12 plans. No changes made."
            )
            return
        with transaction.atomic():
            for mode in ("once", "link"):
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
                ProjectMembership.objects.create(project=project, user=user, role="admin")
                SeasonPattern.objects.create(project=project)
                year = date.today().year
                season = Season.objects.create(
                    project=project,
                    start_date=date(year, 1, 1),
                    end_date=date(year, 12, 31),
                    created_by=user,
                )
                general = Crop.objects.create(
                    project=project,
                    name=entry.name,
                    crop_species=entry.crop_species,
                    growth_duration_days=(entry.growth_duration_days or 80) + 10,
                    notes="Private acceptance-test notes: keep this value.",
                    cultivation_types=["pre_cultivation"],
                )
                for index in range(1, 13):
                    variety = Crop.objects.create(
                        project=project,
                        name=entry.name,
                        crop_species=entry.crop_species,
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
                self.stdout.write(
                    f"Created project {project.pk}: {project.name}; general culture {general.pk}."
                )
        self.stdout.write(
            "Fixtures ready. Import selected library values once in the first project "
            "and link in the second; preserve IDs, notes, variety overrides and plans."
        )
