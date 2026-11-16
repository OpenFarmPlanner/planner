"""Prepare isolated private fixtures for full restoration and selective import undo."""

from datetime import date
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.management.base import CommandError, CommandParser
from django.db import transaction

from farm.history.import_operations import execute_import_request
from farm.management.commands.seed_library_import_acceptance import Command as LocalFixtureCommand
from farm.models import Bed, Crop, Field, Location, PlantingPlan, Project, ProjectMembership
from farm.services.crop_import.spreadsheet import apply_crop_import
from farm.services.crop_inheritance import GENERAL_CROP_ROW_Q

MARKER = "Synthetic import history acceptance fixture v1; private local test data."


class Command(LocalFixtureCommand):
    help = "Preview or create three isolated import-history projects; preserve existing fixtures."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--username", required=True)
        parser.add_argument("--database-name", required=True)
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args: object, **options: object) -> None:
        engine, host, database = self.validate_database(str(options["database_name"]))
        user = get_user_model().objects.filter(username=options["username"], is_active=True).first()
        if user is None:
            raise CommandError("An existing active local user is required.")
        self.stdout.write(f'Target: {engine}, host={host or "local file"}, database={database}.')
        if not options["apply"]:
            self.stdout.write(
                "Preview only: three private projects "
                "(safe undo, dependency conflict, full restore), "
                "each with a two-batch create/update import and unrelated later data. "
                "No global records or existing projects will change."
            )
            return
        with transaction.atomic():
            for scenario in ("safe", "conflict", "full"):
                project, created = Project.objects.get_or_create(
                    slug=f"ofp-local-import-history-{user.pk}-{scenario}",
                    defaults={
                        "name": f"Import history acceptance: {scenario}",
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
                        raise CommandError("Fixture slug has different ownership; nothing changed.")
                    self.stdout.write(f"Kept project {project.pk}; manual edits were not reset.")
                    continue
                ProjectMembership.objects.create(project=project, user=user, role="admin")
                self._populate(project, user.pk, user.username, scenario)

    def _populate(self, project: Project, user_id: int, username: str, scenario: str) -> None:
        Crop.objects.create(project=project, name="Existing acceptance crop", notes="Before import")
        identifier = str(uuid4())
        for rows in (
            [
                {"name": "Existing acceptance crop", "notes": "Imported notes"},
                {"name": "Created acceptance crop"},
            ],
            [{"name": "Created acceptance crop", "variety": "Synthetic variety"}],
        ):
            execute_import_request(
                project,
                request_id=identifier,
                actor_id=user_id,
                actor_label=username,
                phase="crops",
                run=lambda rows=rows: apply_crop_import(
                    project, rows, confirm_updates=True, defer_companions=True
                ),
            )
        execute_import_request(
            project,
            request_id=identifier,
            actor_id=user_id,
            actor_label=username,
            phase="finalize",
            run=lambda: {"created_count": 0, "updated_count": 0, "skipped_count": 0, "results": []},
        )
        later = Crop.objects.create(project=project, name="Later independent crop")
        location = Location.objects.create(project=project, name="Later independent location")
        field = Field.objects.create(
            project=project, location=location, name="Later independent field"
        )
        bed = Bed.objects.create(
            project=project, field=field, name="Later independent bed", area_sqm=2
        )
        if scenario == "conflict":
            PlantingPlan.objects.create(
                project=project,
                bed=bed,
                crop=Crop.objects.get(
                    GENERAL_CROP_ROW_Q, project=project, name="Created acceptance crop"
                ),
                planting_date=date.today(),
            )
        self.stdout.write(
            f"Created project {project.pk}: {scenario}; later crop {later.pk}, bed {bed.pk}. "
            "Open project version history and select the three-crop import."
        )
