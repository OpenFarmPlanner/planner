"""Prepare private synthetic selections using existing catalogue/species identities only."""

from datetime import date

from django.contrib.auth import get_user_model
from django.core.management.base import CommandError, CommandParser
from django.db import transaction

from crops.models import CropSpecies
from crops.plant_health_models import PlantHealthEntry
from farm.management.commands.seed_library_import_acceptance import Command as LocalFixtureCommand
from farm.models import Crop, PlantingPlan, Project, ProjectMembership, Season, SeasonPattern
from farm.services.crop_plant_health import canonical_plant_health

MARKER = "Synthetic private plant-health acceptance fixture v1; not agronomic evidence."


class Command(LocalFixtureCommand):
    help = "Preview or create an isolated private plant-health project; never write global data."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument("--username", required=True)
        parser.add_argument("--species-id", type=int, required=True)
        parser.add_argument("--catalogue-entry-id", type=int, required=True)
        parser.add_argument("--database-name", required=True)
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args: object, **options: object) -> None:
        engine, host, database = self.validate_database(str(options["database_name"]))
        user = get_user_model().objects.filter(username=options["username"], is_active=True).first()
        species = CropSpecies.objects.filter(pk=options["species_id"], status="published").first()
        entry = PlantHealthEntry.objects.filter(
            pk=options["catalogue_entry_id"],
            status=PlantHealthEntry.STATUS_PUBLISHED,
        ).first()
        if user is None or species is None or entry is None:
            raise CommandError(
                "An active user, published species and published catalogue entry are required."
            )
        self.stdout.write(f'Target: {engine}, host={host or "local file"}, database={database}.')
        if not options["apply"]:
            self.stdout.write(
                "Preview only: one isolated project, a culture with private and catalogue entries, "
                "three varieties (inherited, empty override, own selection), and one plan. "
                "No global records, roles or existing project data will be changed."
            )
            return
        slug = f"ofp-local-private-health-{user.pk}-{species.pk}-{entry.identity_key.hex[:12]}"
        with transaction.atomic():
            project, created = Project.objects.get_or_create(
                slug=slug,
                defaults={
                    "name": "Private plant-health acceptance",
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
                return
            ProjectMembership.objects.create(project=project, user=user, role="admin")
            SeasonPattern.objects.create(project=project)
            year = date.today().year
            season = Season.objects.create(
                project=project,
                start_date=date(year, 1, 1),
                end_date=date(year, 12, 31),
                created_by=user,
            )
            parent = Crop.objects.create(
                project=project,
                name=species.name,
                crop_species=species,
                plant_health=canonical_plant_health(
                    {
                        "entries": [
                            {"catalogue_identity": str(entry.identity_key)},
                            {"name": "Synthetic private leaf spot"},
                        ]
                    },
                    project.pk,
                ),
                pests_diseases="Early sowing protects against carrot fly. Repels aphids.",
                notes=MARKER,
                cultivation_type="direct_sowing",
                cultivation_types=["direct_sowing"],
                growth_duration_days=30,
                harvest_duration_days=5,
            )
            for name, value in [
                ("Synthetic inherits", None),
                ("Synthetic empty override", {"entries": []}),
                ("Synthetic own selection", {"entries": [{"name": "Synthetic variety-only name"}]}),
            ]:
                variety = Crop.objects.create(
                    project=project,
                    name=parent.name,
                    crop_species=species,
                    variety=name,
                    cultivation_type="",
                    cultivation_types=[],
                    plant_health=value,
                )
                if value is None:
                    plan = PlantingPlan.objects.create(
                        project=project,
                        season=season,
                        crop=variety,
                        planting_date=date(year, 5, 1),
                        cultivation_type="direct_sowing",
                        quantity=8,
                        created_by=user,
                    )
                    self.stdout.write(
                        f"Inherited variety {variety.pk}; retained-plan fixture {plan.pk}."
                    )
            self.stdout.write(f"Created project {project.pk}, culture {parent.pk}. {MARKER}")
