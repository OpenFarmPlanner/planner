import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


@pytest.mark.django_db(transaction=True)
class TestEndiveSearchAliasMigration:
    migrate_from = [('crops', '0015_crop_species_regional_display_names')]
    migrate_to = [('crops', '0016_endive_search_aliases')]

    def setup_method(self):
        self.executor = MigrationExecutor(connection)
        self.executor.migrate(self.migrate_from)
        old_apps = self.executor.loader.project_state(self.migrate_from).apps

        species_model = old_apps.get_model('crops', 'CropSpecies')
        translation_model = old_apps.get_model('crops', 'CropSpeciesTranslation')

        # Transactional tests flush the tables between tests, so recreate the
        # species from a known state instead of relying on the seed rows.
        species_model.objects.filter(name_normalized__in=['endivie', 'chicoree']).delete()
        endive = species_model.objects.create(
            name='Endivie', name_normalized='endivie', status='published',
        )
        translation_model.objects.create(
            species=endive,
            language_code='de',
            common_name='Endivie',
            common_name_normalized='endivie',
            # A hand-curated alias next to the ones 0014 seeded.
            synonyms=['Winterendivie', 'Escariol', 'Glatte Endivie'],
        )
        chicory = species_model.objects.create(
            name='Chicorée', name_normalized='chicoree', status='published',
        )
        translation_model.objects.create(
            species=chicory,
            language_code='de',
            common_name='Chicorée',
            common_name_normalized='chicoree',
            synonyms=['Brüsseler Endivie', 'Chicoree'],
        )

        self.executor.loader.build_graph()
        self.executor.migrate(self.migrate_to)
        self.new_apps = self.executor.loader.project_state(self.migrate_to).apps

    def teardown_method(self):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(executor.loader.graph.leaf_nodes())

    def _translation(self, apps, normalized_species_name):
        translation_model = apps.get_model('crops', 'CropSpeciesTranslation')
        return translation_model.objects.get(
            species__name_normalized=normalized_species_name,
            language_code='de',
        )

    def test_adds_the_smooth_and_curly_endive_names_as_aliases(self):
        translation = self._translation(self.new_apps, 'endivie')

        assert translation.synonyms == [
            'Winterendivie', 'Escariol', 'Glatte Endivie',
            'Eskariol', 'Frisée', 'Frisee', 'Endiviensalat',
        ]
        for term in ('eskariol', 'escariol', 'frisée', 'frisee', 'endiviensalat'):
            assert f'\n{term}\n' in translation.search_text_normalized

    def test_does_not_create_separate_endive_species(self):
        species_model = self.new_apps.get_model('crops', 'CropSpecies')

        assert not species_model.objects.filter(
            name_normalized__in=['eskariol', 'escariol', 'frisée', 'frisee', 'endiviensalat'],
        ).exists()

    def test_leaves_chicory_untouched(self):
        translation = self._translation(self.new_apps, 'chicoree')

        assert translation.synonyms == ['Brüsseler Endivie', 'Chicoree']

    def test_reverse_removes_only_the_added_aliases(self):
        self.executor.loader.build_graph()
        self.executor.migrate(self.migrate_from)
        reverted_apps = self.executor.loader.project_state(self.migrate_from).apps

        translation = self._translation(reverted_apps, 'endivie')

        assert translation.synonyms == ['Winterendivie', 'Escariol', 'Glatte Endivie']
        assert '\nfrisee\n' not in translation.search_text_normalized
