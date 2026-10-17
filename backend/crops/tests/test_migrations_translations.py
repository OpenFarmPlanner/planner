"""The translation backfill migrations must not lose or invent data.

Documented assumptions being verified here (see the migration docstrings):
  - existing species names were entered in a German-only UI, so they become
    the German translation;
  - English names are written only for species that match a curated entry in
    the frozen bootstrap snapshot (``crops/migrations/data/``) — never generated;
  - species with no curated match get German only, and are simply reported as
    "no translation in your language" in an English UI;
  - existing names, varieties and descriptions are never modified.
"""

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor


@pytest.mark.django_db(transaction=True)
class TestCropSpeciesTranslationBackfill:
    migrate_from = ('crops', '0004_add_crop_translations')
    migrate_to = ('crops', '0005_backfill_crop_species_translations')

    def setup_method(self):
        self.executor = MigrationExecutor(connection)
        self.executor.migrate([self.migrate_from])
        old_apps = self.executor.loader.project_state([self.migrate_from]).apps

        species_model = old_apps.get_model('crops', 'CropSpecies')
        translation_model = old_apps.get_model('crops', 'CropSpeciesTranslation')
        # A clean slate: assert exactly what this migration produces, not
        # whatever the seeded catalogue happens to contain.
        translation_model.objects.all().delete()
        species_model.objects.all().delete()

        species_model.objects.create(
            name='Tomate', name_normalized='tomate', status='published',
        )
        species_model.objects.create(
            name='Eigene Sonderkultur', name_normalized='eigene sonderkultur', status='proposed',
        )

        self.executor.loader.build_graph()
        self.executor.migrate([self.migrate_to])
        self.new_apps = self.executor.loader.project_state([self.migrate_to]).apps

    def teardown_method(self):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(executor.loader.graph.leaf_nodes())

    def _translations(self, name_normalized: str) -> dict[str, str]:
        species_model = self.new_apps.get_model('crops', 'CropSpecies')
        species = species_model.objects.get(name_normalized=name_normalized)
        return {row.language_code: row.common_name for row in species.translations.all()}

    def test_keeps_every_existing_species(self):
        species_model = self.new_apps.get_model('crops', 'CropSpecies')

        assert species_model.objects.count() == 2

    def test_takes_the_existing_name_as_the_german_translation(self):
        assert self._translations('tomate')['de'] == 'Tomate'
        assert self._translations('eigene sonderkultur')['de'] == 'Eigene Sonderkultur'

    def test_adds_the_curated_english_name_for_a_known_species(self):
        assert self._translations('tomate')['en'] == 'Tomato'

    def test_invents_no_english_name_for_an_unknown_species(self):
        translations = self._translations('eigene sonderkultur')

        assert 'en' not in translations
        assert set(translations) == {'de'}

    def test_leaves_the_canonical_name_untouched(self):
        species_model = self.new_apps.get_model('crops', 'CropSpecies')

        assert species_model.objects.get(name_normalized='tomate').name == 'Tomate'

    def test_preserves_the_proposal_status(self):
        species_model = self.new_apps.get_model('crops', 'CropSpecies')

        assert species_model.objects.get(name_normalized='eigene sonderkultur').status == 'proposed'

    def test_running_the_backfill_again_creates_no_duplicates(self):
        module = __import__(
            'crops.migrations.0005_backfill_crop_species_translations',
            fromlist=['backfill_translations'],
        )
        module.backfill_translations(self.new_apps, None)

        translation_model = self.new_apps.get_model('crops', 'CropSpeciesTranslation')
        assert translation_model.objects.filter(language_code='de').count() == 2
        assert translation_model.objects.filter(language_code='en').count() == 1


@pytest.mark.django_db(transaction=True)
class TestPublicCropTranslationBackfill:
    migrate_from = ('farm', '0082_add_crop_translations')
    migrate_to = ('farm', '0083_backfill_public_culture_translations')

    def setup_method(self):
        self.executor = MigrationExecutor(connection)
        self.executor.migrate([self.migrate_from])
        old_apps = self.executor.loader.project_state([self.migrate_from]).apps

        public_crop_model = old_apps.get_model('farm', 'PublicCulture')

        public_crop_model.objects.create(
            name='Tomate', variety='Moneymaker', notes='Robuste Freilandsorte.',
            name_normalized='tomate', variety_normalized='moneymaker',
            status='published', version=1, original_language_code='de',
        )
        public_crop_model.objects.create(
            name='Lettuce', variety='Bijella', notes='Crisp summer lettuce.',
            name_normalized='lettuce', variety_normalized='bijella',
            status='published', version=1, original_language_code='en',
        )
        # Published before the wizard recorded a language.
        public_crop_model.objects.create(
            name='Karotte', variety='Nantaise', notes='Süße Lagersorte.',
            name_normalized='karotte', variety_normalized='nantaise',
            status='published', version=1, original_language_code='',
        )
        # No description at all.
        public_crop_model.objects.create(
            name='Kohlrabi', variety='Lanro', notes='',
            name_normalized='kohlrabi', variety_normalized='lanro',
            status='published', version=1, original_language_code='de',
        )

        self.executor.loader.build_graph()
        self.executor.migrate([self.migrate_to])
        self.new_apps = self.executor.loader.project_state([self.migrate_to]).apps

    def teardown_method(self):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(executor.loader.graph.leaf_nodes())

    def _translations(self, name_normalized: str) -> dict[str, str]:
        model = self.new_apps.get_model('farm', 'PublicCulture')
        entry = model.objects.get(name_normalized=name_normalized)
        return {row.language_code: row.description for row in entry.translations.all()}

    def test_keeps_every_existing_entry(self):
        model = self.new_apps.get_model('farm', 'PublicCulture')

        assert model.objects.count() == 4

    def test_stores_the_description_under_the_recorded_original_language(self):
        assert self._translations('tomate') == {'de': 'Robuste Freilandsorte.'}
        assert self._translations('lettuce') == {'en': 'Crisp summer lettuce.'}

    def test_treats_an_unknown_original_language_as_german(self):
        assert self._translations('karotte') == {'de': 'Süße Lagersorte.'}

    def test_creates_no_row_for_an_empty_description(self):
        assert self._translations('kohlrabi') == {}

    def test_leaves_notes_in_place_for_existing_consumers(self):
        model = self.new_apps.get_model('farm', 'PublicCulture')

        assert model.objects.get(name_normalized='tomate').notes == 'Robuste Freilandsorte.'

    def test_invents_no_second_language(self):
        model = self.new_apps.get_model('farm', 'PublicCultureTranslation')

        assert model.objects.count() == 3

    def test_running_the_backfill_again_creates_no_duplicates(self):
        module = __import__(
            'farm.migrations.0083_backfill_public_culture_translations',
            fromlist=['backfill_translations'],
        )
        module.backfill_translations(self.new_apps, None)

        model = self.new_apps.get_model('farm', 'PublicCultureTranslation')
        assert model.objects.count() == 3


@pytest.mark.django_db(transaction=True)
class TestAsianGreensCollectiveSpeciesReplacement:
    """`Asiatisches Blattgemüse/Senfkohl` is a supplier category, not a species."""

    migrate_from = ('crops', '0010_sync_dach_crop_species_seed_data')
    migrate_to = ('crops', '0011_replace_asian_greens_collective_species')

    def setup_method(self):
        self.executor = MigrationExecutor(connection)
        self.executor.migrate([self.migrate_from])
        old_apps = self.executor.loader.project_state([self.migrate_from]).apps

        species_model = old_apps.get_model('crops', 'CropSpecies')
        translation_model = old_apps.get_model('crops', 'CropSpeciesTranslation')
        # Reproduce the pre-rename database instead of whatever the seed sync
        # produced, so the rename path is actually exercised.
        translation_model.objects.all().delete()
        species_model.objects.all().delete()

        leaf_mustard = species_model.objects.create(
            name='Senfkohl', name_normalized='senfkohl', status='published',
        )
        translation_model.objects.create(
            species=leaf_mustard, language_code='de',
            common_name='Senfkohl', common_name_normalized='senfkohl',
        )
        translation_model.objects.create(
            species=leaf_mustard, language_code='en',
            common_name='Mustard greens', common_name_normalized='mustard greens',
        )
        species_model.objects.create(
            name='Asiatisches Blattgemüse/Senfkohl',
            name_normalized='asiatisches blattgemüse/senfkohl',
            status='published',
        )
        species_model.objects.create(
            name='Tomate', name_normalized='tomate', status='published',
        )

        self.executor.loader.build_graph()
        self.executor.migrate([self.migrate_to])
        self.new_apps = self.executor.loader.project_state([self.migrate_to]).apps

    def teardown_method(self):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(executor.loader.graph.leaf_nodes())

    def _species(self, name_normalized: str):
        species_model = self.new_apps.get_model('crops', 'CropSpecies')
        return species_model.objects.get(name_normalized=name_normalized)

    def test_renames_the_german_leaf_mustard_label(self):
        species = self._species('blattsenf')

        assert species.name == 'Blattsenf'
        assert {row.language_code: row.common_name for row in species.translations.all()} == {
            'de': 'Blattsenf',
            'en': 'Mustard greens',
        }

    def test_creates_no_second_leaf_mustard_species(self):
        species_model = self.new_apps.get_model('crops', 'CropSpecies')

        assert not species_model.objects.filter(name_normalized='senfkohl').exists()
        assert species_model.objects.filter(name_normalized='blattsenf').count() == 1

    def test_rejects_the_collective_supplier_category(self):
        species = self._species('asiatisches blattgemüse/senfkohl')

        assert species.status == 'rejected'
        assert 'Blattsenf' in species.review_note

    def test_leaves_unrelated_species_untouched(self):
        assert self._species('tomate').status == 'published'


@pytest.mark.django_db(transaction=True)
class TestAsianGreensCollectiveSpeciesReplacementLeavesProposalsAlone:
    """An unreviewed user proposal under a collective name is not this migration's to reject."""

    migrate_from = ('crops', '0010_sync_dach_crop_species_seed_data')
    migrate_to = ('crops', '0011_replace_asian_greens_collective_species')

    def setup_method(self):
        self.executor = MigrationExecutor(connection)
        self.executor.migrate([self.migrate_from])
        old_apps = self.executor.loader.project_state([self.migrate_from]).apps

        species_model = old_apps.get_model('crops', 'CropSpecies')
        translation_model = old_apps.get_model('crops', 'CropSpeciesTranslation')
        translation_model.objects.all().delete()
        species_model.objects.all().delete()

        species_model.objects.create(
            name='Asiasalat', name_normalized='asiasalat', status='proposed',
        )

        self.executor.loader.build_graph()
        self.executor.migrate([self.migrate_to])
        self.new_apps = self.executor.loader.project_state([self.migrate_to]).apps

    def teardown_method(self):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(executor.loader.graph.leaf_nodes())

    def test_leaves_the_unreviewed_proposal_untouched(self):
        species_model = self.new_apps.get_model('crops', 'CropSpecies')

        proposal = species_model.objects.get(name_normalized='asiasalat')
        assert proposal.status == 'proposed'
        assert proposal.review_note == ''


@pytest.mark.django_db(transaction=True)
class TestAsianGreensRenameWithExistingBlattsenf:
    """A stray `Blattsenf` alongside legacy `Senfkohl` must not leave a duplicate."""

    migrate_from = ('crops', '0010_sync_dach_crop_species_seed_data')
    migrate_to = ('crops', '0011_replace_asian_greens_collective_species')

    def setup_method(self):
        self.executor = MigrationExecutor(connection)
        self.executor.migrate([self.migrate_from])
        old_apps = self.executor.loader.project_state([self.migrate_from]).apps

        species_model = old_apps.get_model('crops', 'CropSpecies')
        translation_model = old_apps.get_model('crops', 'CropSpeciesTranslation')
        translation_model.objects.all().delete()
        species_model.objects.all().delete()

        # The seed species under the old label, plus an independent species
        # that already carries the new label.
        legacy = species_model.objects.create(
            name='Senfkohl', name_normalized='senfkohl', status='published',
        )
        translation_model.objects.create(
            species=legacy, language_code='de',
            common_name='Senfkohl', common_name_normalized='senfkohl',
        )
        species_model.objects.create(
            name='Blattsenf', name_normalized='blattsenf', status='published',
        )

        self.executor.loader.build_graph()
        self.executor.migrate([self.migrate_to])
        self.new_apps = self.executor.loader.project_state([self.migrate_to]).apps

    def teardown_method(self):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(executor.loader.graph.leaf_nodes())

    def test_keeps_the_existing_blattsenf_species_published(self):
        species_model = self.new_apps.get_model('crops', 'CropSpecies')

        blattsenf = species_model.objects.get(name_normalized='blattsenf')
        assert blattsenf.status == 'published'
        assert {row.language_code: row.common_name for row in blattsenf.translations.all()} == {
            'de': 'Blattsenf',
        }

    def test_rejects_the_superseded_legacy_species(self):
        species_model = self.new_apps.get_model('crops', 'CropSpecies')

        legacy = species_model.objects.get(name_normalized='senfkohl')
        assert legacy.status == 'rejected'
        assert 'Blattsenf' in legacy.review_note

    def test_reverse_migration_restores_the_superseded_legacy_species(self):
        self.executor.loader.build_graph()
        self.executor.migrate([self.migrate_from])
        apps = self.executor.loader.project_state([self.migrate_from]).apps
        species_model = apps.get_model('crops', 'CropSpecies')

        legacy = species_model.objects.get(name_normalized='senfkohl')
        blattsenf = species_model.objects.get(name_normalized='blattsenf')
        assert legacy.status == 'published'
        assert legacy.review_note == ''
        assert blattsenf.status == 'published'


@pytest.mark.django_db(transaction=True)
class TestAsianGreensRenameWithProposedSenfkohlDuplicate:
    """An unreviewed 'Senfkohl' proposal alongside 'Blattsenf' is not this migration's to reject."""

    migrate_from = ('crops', '0010_sync_dach_crop_species_seed_data')
    migrate_to = ('crops', '0011_replace_asian_greens_collective_species')

    def setup_method(self):
        self.executor = MigrationExecutor(connection)
        self.executor.migrate([self.migrate_from])
        old_apps = self.executor.loader.project_state([self.migrate_from]).apps

        species_model = old_apps.get_model('crops', 'CropSpecies')
        translation_model = old_apps.get_model('crops', 'CropSpeciesTranslation')
        translation_model.objects.all().delete()
        species_model.objects.all().delete()

        species_model.objects.create(
            name='Senfkohl', name_normalized='senfkohl', status='proposed',
        )
        species_model.objects.create(
            name='Blattsenf', name_normalized='blattsenf', status='published',
        )

        self.executor.loader.build_graph()
        self.executor.migrate([self.migrate_to])
        self.new_apps = self.executor.loader.project_state([self.migrate_to]).apps

    def teardown_method(self):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(executor.loader.graph.leaf_nodes())

    def test_leaves_the_unreviewed_proposal_untouched(self):
        species_model = self.new_apps.get_model('crops', 'CropSpecies')

        proposal = species_model.objects.get(name_normalized='senfkohl')
        assert proposal.status == 'proposed'
        assert proposal.review_note == ''
