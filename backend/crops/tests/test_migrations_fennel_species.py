import pytest

from farm.tests.migration_base import MigrationTestBase


@pytest.mark.django_db
class TestGenericFennelSpeciesMigration(MigrationTestBase):
    migrate_from = [('crops', '0012_crop_species_metadata')]
    migrate_to = [('crops', '0013_replace_generic_fennel_species')]

    @classmethod
    def seed_before_migration(cls, apps):
        species_model = apps.get_model('crops', 'CropSpecies')
        translation_model = apps.get_model('crops', 'CropSpeciesTranslation')

        species_model.objects.filter(
            name_normalized__in=['fenchel', 'gewürzfenchel'],
        ).delete()
        cls.generic_species = species_model.objects.create(
            name='Fenchel',
            name_normalized='fenchel',
            status='published',
        )
        translation_model.objects.create(
            species=cls.generic_species,
            language_code='de',
            common_name='Fenchel',
            common_name_normalized='fenchel',
        )
        translation_model.objects.create(
            species=cls.generic_species,
            language_code='en',
            common_name='Fennel',
            common_name_normalized='fennel',
        )

    def test_replaces_generic_fennel_with_published_herb_fennel(self):
        species_model = self.new_apps.get_model('crops', 'CropSpecies')

        species = species_model.objects.get(name_normalized='gewürzfenchel')

        assert species.name == 'Gewürzfenchel'
        assert species.status == 'published'

    def test_adds_herb_fennel_metadata(self):
        species_model = self.new_apps.get_model('crops', 'CropSpecies')

        species = species_model.objects.get(name_normalized='gewürzfenchel')

        assert species.scientific_name == 'Foeniculum vulgare'
        assert species.family == 'Apiaceae'
        assert species.categories == ['herb']

    def test_replaces_generic_translations(self):
        species_model = self.new_apps.get_model('crops', 'CropSpecies')
        species = species_model.objects.get(name_normalized='gewürzfenchel')

        translations = {
            translation.language_code: translation.common_name
            for translation in species.translations.all()
        }

        assert translations['de'] == 'Gewürzfenchel'
        assert translations['en'] == 'Common fennel'

    def test_leaves_no_published_generic_fennel_species(self):
        species_model = self.new_apps.get_model('crops', 'CropSpecies')

        assert not species_model.objects.filter(
            name_normalized='fenchel',
            status='published',
        ).exists()
