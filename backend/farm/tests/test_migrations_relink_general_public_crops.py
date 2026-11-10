import pytest
from django.db import connection

from farm.tests.migration_base import MigrationTestBase


@pytest.mark.django_db
class TestRelinkGeneralPublicCropsMigration(MigrationTestBase):
    """The backfill for species-level entries created by a Sorte publish.

    They used to record the Sorte as their origin, which left the project's
    general Kultur looking unpublished.
    """

    migrate_from = [('farm', '0092_add_seasons')]
    migrate_to = [('farm', '0093_relink_general_public_cultures')]

    @classmethod
    def _create_species_id(cls, name):
        columns = {
            column.name
            for column in connection.introspection.get_table_description(
                connection.cursor(),
                'crops_cropspecies',
            )
        }
        values = {
            'name': name,
            'name_normalized': name.lower(),
            'status': 'published',
            'review_note': '',
        }
        insert_values = {
            column: value for column, value in values.items() if column in columns
        }
        column_names = ', '.join(insert_values)
        placeholders = ', '.join(['%s'] * len(insert_values))
        with connection.cursor() as cursor:
            cursor.execute(
                f'INSERT INTO crops_cropspecies ({column_names}) VALUES ({placeholders})',
                list(insert_values.values()),
            )
            return cursor.lastrowid

    @classmethod
    def seed_before_migration(cls, apps):
        project_model = apps.get_model('farm', 'Project')
        crop_model = apps.get_model('farm', 'Culture')
        public_crop_model = apps.get_model('farm', 'PublicCulture')

        project = project_model.objects.create(name='Migration Project', slug='migration-project')
        species_id = cls._create_species_id('Lettuce')
        other_species_id = cls._create_species_id('Carrot')

        cls.general_crop = crop_model.objects.create(
            name='Lettuce',
            name_normalized='lettuce',
            variety='',
            variety_normalized=None,
            crop_species_id=species_id,
            project_id=project.id,
        )
        cls.variety_crop = crop_model.objects.create(
            name='Lettuce',
            name_normalized='lettuce',
            variety='Bijella',
            variety_normalized='bijella',
            crop_species_id=species_id,
            project_id=project.id,
        )
        cls.orphan_variety_crop = crop_model.objects.create(
            name='Carrot',
            name_normalized='carrot',
            variety='Nantes',
            variety_normalized='nantes',
            crop_species_id=other_species_id,
            project_id=project.id,
        )

        cls.general_entry = public_crop_model.objects.create(
            name='Lettuce',
            name_normalized='lettuce',
            variety='',
            variety_normalized='',
            status='published',
            crop_species_id=species_id,
            source_project_culture_id=cls.variety_crop.id,
            source_project_id=project.id,
        )
        cls.variety_entry = public_crop_model.objects.create(
            name='Lettuce',
            name_normalized='lettuce',
            variety='Bijella',
            variety_normalized='bijella',
            status='published',
            crop_species_id=species_id,
            source_project_culture_id=cls.variety_crop.id,
            source_project_id=project.id,
        )
        cls.orphan_general_entry = public_crop_model.objects.create(
            name='Carrot',
            name_normalized='carrot',
            variety='',
            variety_normalized='',
            status='published',
            crop_species_id=other_species_id,
            source_project_culture_id=cls.orphan_variety_crop.id,
            source_project_id=project.id,
        )

    def _public_crop_model(self):
        apps = self.new_apps
        return apps.get_model('farm', 'PublicCulture')

    def test_general_entry_is_relinked_to_the_projects_general_kultur(self):
        entry = self._public_crop_model().objects.get(pk=self.general_entry.pk)

        assert entry.source_project_culture_id == self.general_crop.id

    def test_variety_entry_keeps_its_own_sorte(self):
        entry = self._public_crop_model().objects.get(pk=self.variety_entry.pk)

        assert entry.source_project_culture_id == self.variety_crop.id

    def test_general_entry_without_a_local_kultur_is_left_alone(self):
        entry = self._public_crop_model().objects.get(pk=self.orphan_general_entry.pk)

        assert entry.source_project_culture_id == self.orphan_variety_crop.id
