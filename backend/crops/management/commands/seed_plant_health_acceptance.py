"""Preview or create synthetic local catalogue rows without granting roles or resetting data."""

from uuid import NAMESPACE_URL, uuid5

from django.contrib.auth import get_user_model
from django.core.management.base import CommandError, CommandParser
from django.db import transaction

from config.languages import SUPPORTED_LANGUAGE_CODES
from crops.models import CropSpecies
from crops.permissions import is_public_library_moderator
from crops.plant_health_models import PlantHealthEntry
from crops.plant_health_services import write_entry, write_host
from farm.management.commands.seed_library_import_acceptance import Command as LocalFixtureCommand

MARKER = "Synthetic local plant-health acceptance fixture v1; not agronomic evidence."
SOURCE = [{"url": "https://example.org/synthetic-local-plant-health", "evidence": MARKER}]


class Command(LocalFixtureCommand):
    help = "Preview or create synthetic local catalogue entries; never reset existing data."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--username", required=True)
        parser.add_argument("--species-id", required=True, type=int)
        parser.add_argument("--database-name", required=True)
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args: object, **options: object) -> None:
        engine, host, name = self.validate_database(str(options["database_name"]))
        user = get_user_model().objects.filter(username=options["username"], is_active=True).first()
        species = CropSpecies.objects.filter(pk=options["species_id"], status="published").first()
        if user is None or not is_public_library_moderator(user) or species is None:
            raise CommandError("An existing local moderator and published species are required.")
        self.stdout.write(f'Target: {engine}, host={host or "local file"}, database={name}.')
        if not options["apply"]:
            self.stdout.write(
                "Preview only: one pending proposal, one specific identity with a synthetic "
                "qualified host, and two distinct broad concepts sharing a label. No writes."
            )
            return
        with transaction.atomic():
            for key in ["pending", "specific", "broad-a", "broad-b"]:
                identity = uuid5(NAMESPACE_URL, f"ofp-local-plant-health-{user.pk}-{key}")
                entry = PlantHealthEntry.objects.filter(identity_key=identity).first()
                if entry is not None:
                    if entry.proposed_by_id != user.pk or entry.sources != SOURCE:
                        raise CommandError(
                            "Fixture identity has different ownership; nothing changed."
                        )
                    self.stdout.write(f"Kept {entry.pk}; no reset performed.")
                    continue
                name = "Synthetic broad label" if key.startswith("broad") else f"Synthetic {key}"
                entry = write_entry(
                    None,
                    {
                        "identity_key": identity,
                        "name": name,
                        "kind": "pathogen" if key == "specific" else "group",
                        "scientific_name": f"Syntheticus localfixture {user.pk}"
                        if key == "specific"
                        else "",
                        "sources": SOURCE,
                        "translations": [
                            {
                                "language_code": code,
                                "preferred_name": name,
                                "synonyms": [f"Synthetic alias {key} {user.pk}"],
                            }
                            for code in (["de"] if key == "pending" else SUPPORTED_LANGUAGE_CODES)
                        ],
                    },
                    user,
                )
                if key != "pending":
                    entry = write_entry(
                        entry, {}, user, review_action="approve", review_note=MARKER
                    )
                if key == "specific":
                    write_host(
                        None,
                        {
                            "entry": entry,
                            "species": species,
                            "variety_name": "Synthetic variety",
                            "qualification": MARKER,
                            "sources": SOURCE,
                            "is_confirmed": True,
                        },
                        user,
                    )
                self.stdout.write(f"Created entry {entry.pk}: {entry.name} ({entry.status}).")
