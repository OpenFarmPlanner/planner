import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


@pytest.mark.django_db(transaction=True)
class TestCropSpeciesRegionalDisplayNameMigration:
    migrate_from = [('crops', '0014_crop_species_search_aliases')]
    migrate_to = [('crops', '0015_crop_species_regional_display_names')]

    def setup_method(self):
        self.executor = MigrationExecutor(connection)
        self.executor.migrate(self.migrate_from)
        old_apps = self.executor.loader.project_state(self.migrate_from).apps

        species_model = old_apps.get_model('crops', 'CropSpecies')
        translation_model = old_apps.get_model('crops', 'CropSpeciesTranslation')

        # Transactional tests flush the tables, so after the first test the
        # seed-migration rows are gone and the species this migration writes to
        # have to be recreated. Before the first test they are still there, so
        # clear them first and always start from a known state.
        species_model.objects.filter(
            name_normalized__in=['aubergine', 'feldsalat', 'zucchini', 'zuckererbse'],
        ).delete()
        for german_name, english_name in [
            ('Aubergine', 'Eggplant'),
            ('Feldsalat', 'Corn salad'),
            ('Zucchini', 'Zucchini'),
            ('Zuckererbse', 'Sugar pea'),
        ]:
            species = species_model.objects.create(
                name=german_name,
                name_normalized=german_name.casefold(),
                status='published',
            )
            translation_model.objects.create(
                species=species,
                language_code='de',
                common_name=german_name,
                common_name_normalized=german_name.casefold(),
                # A regional name curated outside the seed list, as migration
                # 0008 wrote it before the seed data carried Melanzani.
                regional_names=(
                    {'austria': 'Melanzani'} if german_name == 'Aubergine' else {}
                ),
            )
            translation_model.objects.create(
                species=species,
                language_code='en',
                common_name=english_name,
                common_name_normalized=english_name.casefold(),
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

    def test_seeds_swiss_and_austrian_display_names(self):
        assert self._translation('feldsalat').regional_names == {
            'austria': 'Vogerlsalat',
            'switzerland': 'Nüsslisalat',
        }
        assert self._translation('zucchini').regional_names == {'switzerland': 'Zucchetti'}
        assert self._translation('zuckererbse').regional_names == {'switzerland': 'Kefe'}

    def test_regional_names_are_searchable(self):
        assert '\nnüsslisalat\n' in self._translation('feldsalat').search_text_normalized

    def test_keeps_a_regional_name_curated_outside_the_seed_list(self):
        assert self._translation('aubergine').regional_names == {'austria': 'Melanzani'}

    def test_reverse_keeps_a_regional_name_an_earlier_migration_owns(self):
        """Rolling back must not delete what 0008 wrote.

        0008 added the Austrian aubergine name before the seed list carried
        it, so the stored value is identical to the seeded one. Matching on
        the value alone cannot tell the two apart, and dropping it loses data
        this migration never added.
        """
        self.executor.loader.build_graph()
        self.executor.migrate(self.migrate_from)
        reverted_apps = self.executor.loader.project_state(self.migrate_from).apps
        translation_model = reverted_apps.get_model('crops', 'CropSpeciesTranslation')

        def regional_names(normalized_species_name):
            return translation_model.objects.get(
                species__name_normalized=normalized_species_name,
                language_code='de',
            ).regional_names

        assert regional_names('aubergine') == {'austria': 'Melanzani'}
        # The names this migration did add are still removed.
        assert regional_names('feldsalat') == {}

    def test_never_registers_the_ambiguous_peperoni_as_a_display_name(self):
        """Guards docs/crop-taxonomy-guidelines.md §4.

        "Peperoni" is a search alias of several species on purpose; making it
        any species' displayed name would pick one of those readings silently.
        """
        translation_model = self.new_apps.get_model('crops', 'CropSpeciesTranslation')

        for translation in translation_model.objects.all():
            names = [
                value
                for value in translation.regional_names.values()
                if isinstance(value, str)
            ]
            assert not any(name.casefold() == 'peperoni' for name in names)
