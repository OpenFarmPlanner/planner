from typing import ClassVar

import pytest
from django.apps.registry import Apps

from farm.tests.migration_base import MigrationTestBase


@pytest.mark.django_db
class TestSpecificPropertyProfileMigration(MigrationTestBase):
    migrate_from: ClassVar[list[tuple[str, str]]] = [("crops", "0019_plant_family")]
    migrate_to: ClassVar[list[tuple[str, str]]] = [("crops", "0020_crop_specific_properties")]
    candidate_pk: ClassVar[int]
    unrelated_pk: ClassVar[int]
    canonical_pk: ClassVar[int]

    @classmethod
    def seed_before_migration(cls, apps: Apps) -> None:
        species = apps.get_model("crops", "CropSpecies")
        canonical, _ = species.objects.get_or_create(
            name_normalized="kartoffel",
            defaults={"name": "Kartoffel", "status": "published"},
        )
        canonical.scientific_name = ""
        canonical.save(update_fields=["scientific_name"])
        cls.canonical_pk = canonical.pk
        cls.candidate_pk = species.objects.create(
            name="Existing botanical candidate",
            name_normalized="existing botanical candidate",
            scientific_name="Solanum tuberosum",
        ).pk
        cls.unrelated_pk = species.objects.create(
            name="Potato-like label",
            name_normalized="potato-like label",
            scientific_name="Other species",
        ).pk

    def test_assigns_only_existing_botanical_metadata_without_changing_names(self) -> None:
        species = self.new_apps.get_model("crops", "CropSpecies")
        candidate = species.objects.get(pk=self.candidate_pk)
        assert candidate.specific_property_profile == "solanum_tuberosum"
        assert candidate.name == "Existing botanical candidate"
        assert candidate.scientific_name == "Solanum tuberosum"
        assert species.objects.get(pk=self.unrelated_pk).specific_property_profile == ""

    def test_existing_canonical_potato_without_botanical_metadata_gets_profile(self) -> None:
        species = self.new_apps.get_model("crops", "CropSpecies")
        canonical = species.objects.get(pk=self.canonical_pk)
        assert canonical.specific_property_profile == "solanum_tuberosum"
        assert canonical.name == "Kartoffel"
        assert canonical.scientific_name == ""
