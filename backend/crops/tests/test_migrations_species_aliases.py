import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


@pytest.mark.django_db(transaction=True)
class TestCropSpeciesAliasMigration:
    migrate_from = [('crops', '0013_replace_generic_fennel_species')]
    migrate_to = [('crops', '0014_sync_crop_species_aliases')]

    def setup_method(self):
        self.executor = MigrationExecutor(connection)
        self.executor.migrate(self.migrate_from)
        old_apps = self.executor.loader.project_state(self.migrate_from).apps

        species_model = old_apps.get_model('crops', 'CropSpecies')
        translation_model = old_apps.get_model('crops', 'CropSpeciesTranslation')

        species_model.objects.filter(
            name_normalized__in=['blumenkohl', 'karfiol', 'zuckererbse'],
        ).delete()
        self.austrian_species = species_model.objects.create(
            name='Karfiol',
            name_normalized='karfiol',
            status='published',
        )
        translation_model.objects.create(
            species=self.austrian_species,
            language_code='de',
            common_name='Karfiol',
            common_name_normalized='karfiol',
        )
        translation_model.objects.create(
            species=self.austrian_species,
            language_code='en',
            common_name='Cauliflower',
            common_name_normalized='cauliflower',
        )
        # A manually curated alias that is not part of the seed list must
        # survive the sync. Transactional tests flush the tables, so the
        # seed-migration rows are gone and this one is recreated here.
        species_model.objects.filter(name_normalized='aubergine').delete()
        aubergine = species_model.objects.create(
            name='Aubergine',
            name_normalized='aubergine',
            status='published',
        )
        translation_model.objects.create(
            species=aubergine,
            language_code='de',
            common_name='Aubergine',
            common_name_normalized='aubergine',
            synonyms=['Eierfrucht'],
        )
        translation_model.objects.create(
            species=aubergine,
            language_code='en',
            common_name='Eggplant',
            common_name_normalized='eggplant',
        )

        self.executor.loader.build_graph()
        self.executor.migrate(self.migrate_to)
        self.new_apps = self.executor.loader.project_state(self.migrate_to).apps

    def teardown_method(self):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(executor.loader.graph.leaf_nodes())

    def _translation(self, normalized_species_name, language_code='de'):
        translation_model = self.new_apps.get_model('crops', 'CropSpeciesTranslation')
        return translation_model.objects.get(
            species__name_normalized=normalized_species_name,
            language_code=language_code,
        )

    def test_renames_karfiol_into_the_canonical_blumenkohl_species(self):
        species_model = self.new_apps.get_model('crops', 'CropSpecies')

        assert not species_model.objects.filter(name_normalized='karfiol').exists()
        species = species_model.objects.get(name_normalized='blumenkohl')
        assert species.id == self.austrian_species.id
        assert species.name == 'Blumenkohl'
        assert self._translation('blumenkohl').common_name == 'Blumenkohl'

    def test_keeps_karfiol_as_the_austrian_display_name(self):
        translation = self._translation('blumenkohl')

        assert translation.regional_names == {'austria': 'Karfiol'}
        assert '\nkarfiol\n' in translation.search_text_normalized

    def test_creates_the_missing_crop_species(self):
        species_model = self.new_apps.get_model('crops', 'CropSpecies')

        for name in ['Pfefferoni', 'Puntarelle', 'Schnittkohl', 'Zuckererbse']:
            species = species_model.objects.get(name=name)
            assert species.status == 'published'
            assert species.scientific_name

    def test_seeds_swiss_and_austrian_aliases(self):
        assert self._translation('feldsalat').regional_names == {
            'austria': 'Vogerlsalat',
            'switzerland': 'Nüsslisalat',
        }
        assert self._translation('zucchini').regional_names == {'switzerland': 'Zucchetti'}
        assert self._translation('zuckererbse').regional_names == {'switzerland': 'Kefe'}
        assert 'Porree' in self._translation('lauch').synonyms

    def test_keeps_alias_data_that_was_not_seeded(self):
        translation = self._translation('aubergine')

        assert 'Eierfrucht' in translation.synonyms
        assert translation.regional_names == {'austria': 'Melanzani'}

    def test_never_registers_the_ambiguous_peperoni_alias(self):
        translation_model = self.new_apps.get_model('crops', 'CropSpeciesTranslation')

        for translation in translation_model.objects.all():
            aliases = [
                *(value for value in translation.synonyms if isinstance(value, str)),
                *(
                    value
                    for value in translation.regional_names.values()
                    if isinstance(value, str)
                ),
            ]
            assert not any(alias.casefold() == 'peperoni' for alias in aliases)
