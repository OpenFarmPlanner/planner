"""Prepare an isolated local project for testing crop-library history."""

from django.contrib.auth import get_user_model
from django.core.management.base import CommandError, CommandParser
from django.db import transaction

from farm.management.commands.seed_library_import_acceptance import Command as LocalFixtureCommand
from farm.models import Project, ProjectMembership, PublicCrop

MARKER = "Synthetic crop library history acceptance fixture; private local test data."


class Command(LocalFixtureCommand):
    help = "Preview or create a private project for testing the history of a linked library import."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--username", required=True)
        parser.add_argument("--public-crop-id", type=int, required=True)
        parser.add_argument("--database-name", required=True)
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args: object, **options: object) -> None:
        engine, host, database = self.validate_database(str(options["database_name"]))
        user = get_user_model().objects.filter(username=options["username"], is_active=True).first()
        if user is None:
            raise CommandError("An existing active local user is required.")
        entry = PublicCrop.objects.filter(
            pk=options["public_crop_id"], status=PublicCrop.STATUS_PUBLISHED,
        ).first()
        if entry is None or not entry.seed_packages:
            raise CommandError(
                "Choose an existing published local library entry with seed packages."
            )

        self.stdout.write(f'Target: {engine}, host={host or "local file"}, database={database}.')
        self.stdout.write(
            f'Library entry {entry.pk}: {entry.name} ({len(entry.seed_packages)} packages).'
        )
        if not options["apply"]:
            self.stdout.write("Preview only: one private project for a linked library import.")
            return

        with transaction.atomic():
            project, created = Project.objects.get_or_create(
                slug=f"ofp-local-crop-library-history-{user.pk}-{entry.pk}",
                defaults={"name": "Crop library history acceptance", "description": MARKER},
            )
            if created:
                ProjectMembership.objects.create(project=project, user=user, role="admin")
            elif project.description != MARKER or not ProjectMembership.objects.filter(
                project=project, user=user, role="admin",
            ).exists():
                raise CommandError("Fixture slug has different ownership; nothing changed.")
        self.stdout.write(
            f"Use project {project.pk} and import library entry {entry.pk} with linking."
        )
