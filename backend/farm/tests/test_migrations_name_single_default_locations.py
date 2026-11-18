import importlib
from typing import ClassVar

import pytest
from django.apps.registry import Apps

from farm.tests.migration_base import MigrationTestBase

MIGRATION = importlib.import_module(
    'farm.migrations.0146_name_single_default_locations_after_project'
)


@pytest.mark.django_db
class TestNameSingleDefaultLocationsMigration(MigrationTestBase):
    migrate_from: ClassVar = [('farm', '0145_add_retained_upload_cleanup')]
    migrate_to: ClassVar = [('farm', '0146_name_single_default_locations_after_project')]
    ids: ClassVar[dict[str, int]] = {}

    @classmethod
    def seed_before_migration(cls, apps: Apps) -> None:
        Project = apps.get_model('farm', 'Project')
        Location = apps.get_model('farm', 'Location')
        Field = apps.get_model('farm', 'Field')

        def project_with(key: str, project_name: str, *location_names: str) -> None:
            project = Project.objects.create(name=project_name, slug=f'loc-{key}')
            locations = [
                Location.objects.create(project=project, name=name, notes=f'{key} notes')
                for name in location_names
            ]
            cls.ids[key] = locations[0].pk
            cls.ids[f'{key}-field'] = Field.objects.create(
                project=project, location=locations[0], name=f'{key} field',
            ).pk

        project_with('german', 'Hof Sonnenacker', 'Hauptstandort')
        project_with('dutch', 'Tuinderij De Wei', 'Hoofdlocatie')
        project_with('custom', 'Gärtnerei Nord', 'Feld am Bach')
        project_with('several', 'Zwei Standorte', 'Main location', 'Pachtacker')
        project_with('lowercase', 'Kleingarten', 'hauptstandort')

    def name_of(self, key: str) -> str:
        return self.new_apps.get_model('farm', 'Location').objects.get(pk=self.ids[key]).name

    def test_renames_a_generated_single_location_after_the_project(self) -> None:
        assert self.name_of('german') == 'Hof Sonnenacker'
        assert self.name_of('dutch') == 'Tuinderij De Wei'

    def test_keeps_custom_names_multi_location_projects_and_inexact_matches(self) -> None:
        assert self.name_of('custom') == 'Feld am Bach'
        assert self.name_of('several') == 'Main location'
        assert self.name_of('lowercase') == 'hauptstandort'

    def test_keeps_the_location_its_notes_and_references(self) -> None:
        Location = self.new_apps.get_model('farm', 'Location')
        Field = self.new_apps.get_model('farm', 'Field')
        location = Location.objects.get(pk=self.ids['german'])
        assert location.notes == 'german notes'
        assert Field.objects.get(pk=self.ids['german-field']).location_id == location.pk

    def test_records_the_rename_in_the_project_history(self) -> None:
        EntityRevision = self.new_apps.get_model('farm', 'EntityRevision')
        revision = EntityRevision.objects.get(entity_type='location', object_id=self.ids['german'])
        assert revision.action == 'updated'
        assert revision.changed_fields == ['name']
        assert revision.snapshot['name'] == 'Hof Sonnenacker'
        assert not EntityRevision.objects.filter(
            entity_type='location', object_id=self.ids['custom'],
        ).exists()

    def test_running_it_again_changes_nothing(self) -> None:
        EntityRevision = self.new_apps.get_model('farm', 'EntityRevision')
        before = EntityRevision.objects.count()
        MIGRATION.rename_default_locations(self.new_apps, None)
        assert EntityRevision.objects.count() == before
        assert self.name_of('german') == 'Hof Sonnenacker'
