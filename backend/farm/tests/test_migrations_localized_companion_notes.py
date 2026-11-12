from typing import ClassVar

import pytest
from django.apps.registry import Apps

from farm.tests.migration_base import MigrationTestBase


@pytest.mark.django_db
class TestLocalizedCompanionNotesMigration(MigrationTestBase):
    migrate_from: ClassVar = [("farm", "0140_crop_specific_properties")]
    migrate_to: ClassVar = [("farm", "0141_localized_companion_notes")]
    relation_id: ClassVar[int]
    entry_id: ClassVar[int]

    @classmethod
    def seed_before_migration(cls, apps: Apps) -> None:
        project = apps.get_model("farm", "Project").objects.create(name="Notes", slug="notes")
        crop = apps.get_model("farm", "Crop").objects.create(project=project, name="Notes crop")
        relation = apps.get_model("farm", "CropCompanion").objects.create(
            project=project,
            crop=crop,
            companion_text="Legacy neighbor",
            kind="good",
            note="Quelle\n2025",
        )
        cls.relation_id = relation.pk
        entry = apps.get_model("farm", "PublicCrop").objects.create(
            name="Legacy public notes",
            original_language_code="fr",
            companions=[
                {"family": "Brassicaceae", "kind": "good", "note": "Source française"},
            ],
        )
        cls.entry_id = entry.pk

    def test_preserves_private_legacy_text_without_translating_it(self) -> None:
        relation = self.new_apps.get_model("farm", "CropCompanion").objects.get(pk=self.relation_id)
        assert relation.note == "Quelle\n2025"
        assert relation.notes == {"de": "Quelle\n2025"}

    def test_preserves_public_notes_in_their_declared_original_language(self) -> None:
        entry = self.new_apps.get_model("farm", "PublicCrop").objects.get(pk=self.entry_id)
        assert entry.companions[0]["notes"] == {"fr": "Source française"}
        assert entry.companions[0]["note"] == "Source française"
