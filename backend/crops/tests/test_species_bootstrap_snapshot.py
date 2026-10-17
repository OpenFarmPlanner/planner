"""Integrity of the frozen crop-species bootstrap snapshot.

The snapshot only feeds the historical migrations of a fresh database; the
database is the maintained source. These invariants are the ones the retired
``crops/seed_data.py`` was held to, so a fresh database keeps starting from a
consistent catalogue.
"""

import ast
import hashlib
import json
import sys
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase

from crops.migrations.data import species_bootstrap
from crops.migrations.data.species_bootstrap import (
    BOOTSTRAP_SPECIES,
    BOOTSTRAP_SPECIES_REGIONAL_NAMES,
    BOOTSTRAP_SPECIES_SYNONYMS,
    SNAPSHOT_PATH,
    get_bootstrap_species_name,
    get_bootstrap_species_regional_names,
    get_bootstrap_species_synonyms,
)
from crops.models import SUPPORTED_REGIONAL_NAME_KEYS

FROZEN_SNAPSHOT_SHA256 = 'cf264e10600b0824d9d35e68f485c4a3694e6ce9bfe2df07640864abf0a78673'


class BootstrapSnapshotFrozenTest(SimpleTestCase):
    def test_snapshot_file_is_unchanged(self):
        """Names, synonyms and languages are maintained through the API, not here.

        Editing the snapshot would make a fresh database differ from every
        existing one without a migration recording the change.
        """
        digest = hashlib.sha256(SNAPSHOT_PATH.read_bytes()).hexdigest()
        self.assertEqual(
            digest,
            FROZEN_SNAPSHOT_SHA256,
            'species_bootstrap_v1.json is frozen. Maintain crop-species names '
            'through the API instead; see crops/migrations/data/README.md.',
        )

    def test_snapshot_has_the_expected_shape(self):
        payload = json.loads(SNAPSHOT_PATH.read_text(encoding='utf-8'))

        self.assertEqual(payload['version'], 1)
        self.assertEqual(set(payload), {'version', 'species', 'synonyms', 'regional_names'})
        for item in payload['species']:
            self.assertEqual(
                set(item),
                {'key', 'translations', 'scientific_name', 'family', 'categories'},
            )

    def test_loader_imports_only_the_standard_library(self):
        """Migrations must not depend on application code that keeps changing."""
        tree = ast.parse(Path(species_bootstrap.__file__).read_text(encoding='utf-8'))
        imported = {
            alias.name.split('.')[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.Import)
            for alias in node.names
        } | {
            node.module.split('.')[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom) and node.module
        }

        self.assertTrue(imported)
        for module_name in imported:
            with self.subTest(module=module_name):
                self.assertIn(module_name, sys.stdlib_module_names | {'__future__'})

    def test_only_migrations_and_tests_read_the_snapshot(self):
        """App code reads crop-species names from the database, never from here."""
        backend_dir = Path(settings.BASE_DIR)
        packages = [path.parent for path in backend_dir.glob('*/__init__.py')]
        offenders = []
        for path in (file for package in packages for file in package.rglob('*.py')):
            relative = path.relative_to(backend_dir)
            if 'migrations' in relative.parts or 'tests' in relative.parts:
                continue
            if 'species_bootstrap' in path.read_text(encoding='utf-8'):
                offenders.append(str(relative))

        self.assertEqual(offenders, [])


class BootstrapSpeciesSnapshotTest(SimpleTestCase):
    def test_entries_have_stable_keys_and_initial_translations(self):
        keys = [entry.key for entry in BOOTSTRAP_SPECIES]
        german_names = [
            get_bootstrap_species_name(entry, 'de')
            for entry in BOOTSTRAP_SPECIES
        ]
        english_names = [
            get_bootstrap_species_name(entry, 'en')
            for entry in BOOTSTRAP_SPECIES
        ]

        self.assertEqual(len(keys), len(set(keys)))
        self.assertEqual(len(german_names), len(set(german_names)))
        self.assertGreaterEqual(len(keys), 180)
        self.assertIn('Tomate', german_names)
        self.assertIn('Kartoffel', german_names)
        self.assertIn('Zwiebel', german_names)
        self.assertNotIn('Bohne', german_names)
        self.assertIn('Buschbohne', german_names)
        self.assertIn('Stangenbohne', german_names)
        self.assertIn('Feuerbohne', german_names)
        self.assertIn('Sojabohne', german_names)
        self.assertNotIn('Kohl', german_names)
        self.assertIn('Weißkraut', german_names)
        self.assertIn('Chinakohl', german_names)
        self.assertIn('Grünkohl', german_names)
        self.assertIn('Kohlrabi', german_names)
        self.assertIn('Rotkraut', german_names)
        self.assertIn('Spitzkraut', german_names)
        self.assertIn('Wirsing', german_names)
        self.assertIn('Raps', german_names)
        self.assertIn('Dinkel', german_names)
        self.assertNotIn('Fenchel', german_names)
        self.assertIn('Gewürzfenchel', german_names)
        self.assertIn('Knollenfenchel', german_names)
        self.assertNotIn('Gründüngung', german_names)
        self.assertNotIn('Green manure', english_names)

        dach_supplier_extension_names = [
            'Alexandrinerklee',
            'Bischofskraut',
            'Blattsenf',
            'Brunnenkresse',
            'Gartenmelde',
            'Inkarnatklee',
            'Kapuzinerkresse',
            'Komatsuna',
            'Kornblume',
            'Mizuna',
            'Neuseeländer Spinat',
            'Ölrettich',
            'Phacelia',
            'Portulak',
            'Ringelblume',
            'Salatrauke',
            'Shiso',
            'Strohblume',
            'Tatsoi',
            'Wilde Rauke',
            'Winterkresse',
            'Winterportulak',
            'Zinnie',
            'Zuckerhut',
        ]
        for name in dach_supplier_extension_names:
            self.assertIn(name, german_names)

        for entry in BOOTSTRAP_SPECIES:
            self.assertIn('de', entry.translations)
            self.assertIn('en', entry.translations)
            self.assertIsInstance(entry.scientific_name, str)
            self.assertIsInstance(entry.family, str)
            self.assertIsInstance(entry.categories, tuple)
            for category in entry.categories:
                self.assertEqual(category, category.strip().lower())

    def test_entries_can_carry_species_metadata(self):
        bulb_fennel = next(
            entry for entry in BOOTSTRAP_SPECIES if entry.key == 'fennel_bulb'
        )
        herb_fennel = next(
            entry for entry in BOOTSTRAP_SPECIES if entry.key == 'fennel_herb'
        )
        leaf_mustard = next(
            entry for entry in BOOTSTRAP_SPECIES if entry.key == 'leaf_mustard'
        )

        self.assertEqual(bulb_fennel.scientific_name, 'Foeniculum vulgare var. azoricum')
        self.assertEqual(bulb_fennel.family, 'Apiaceae')
        self.assertEqual(bulb_fennel.categories, ('vegetable',))
        self.assertEqual(herb_fennel.scientific_name, 'Foeniculum vulgare')
        self.assertEqual(herb_fennel.family, 'Apiaceae')
        self.assertEqual(herb_fennel.categories, ('herb',))
        self.assertEqual(leaf_mustard.scientific_name, 'Brassica juncea')
        self.assertEqual(leaf_mustard.family, 'Brassicaceae')
        self.assertEqual(leaf_mustard.categories, ('vegetable',))

    def test_entries_use_concrete_species_instead_of_supplier_categories(self):
        """Guards the naming convention documented in docs/crop-library-architecture.md.

        Slash collective names and supplier/shop categories mix several
        botanical species with different growing and harvest logic, so they
        must never become suggestable crop species again.
        """
        german_names = [
            get_bootstrap_species_name(entry, 'de')
            for entry in BOOTSTRAP_SPECIES
        ]
        english_names = [
            get_bootstrap_species_name(entry, 'en')
            for entry in BOOTSTRAP_SPECIES
        ]

        for name in german_names + english_names:
            self.assertNotIn('/', name)

        supplier_category_names = [
            'Asiatisches Blattgemüse/Senfkohl',
            'Asiatisches Blattgemüse',
            'Asiatische Blattgemüse',
            'Asiasalat',
            'Asiasalate',
            'Asian greens',
            'Fenchel',
            'Fennel',
        ]
        for name in supplier_category_names:
            self.assertNotIn(name, german_names)
            self.assertNotIn(name, english_names)

        concrete_asian_greens_names = [
            'Blattsenf',
            'Chinakohl',
            'Komatsuna',
            'Mibuna',
            'Mizuna',
            'Pak Choi',
            'Tatsoi',
        ]
        for name in concrete_asian_greens_names:
            self.assertIn(name, german_names)
        self.assertIn('Mustard greens', english_names)


class BootstrapSpeciesSynonymsTest(SimpleTestCase):
    """The alias list decides which names must *not* become their own species."""

    def test_every_alias_belongs_to_a_seeded_species(self):
        snapshot_keys = {entry.key for entry in BOOTSTRAP_SPECIES}

        for key, synonyms_by_language in BOOTSTRAP_SPECIES_SYNONYMS.items():
            self.assertIn(key, snapshot_keys)
            for language_code, synonyms in synonyms_by_language.items():
                self.assertIn(language_code, {'de', 'en'})
                self.assertIsInstance(synonyms, tuple)
                for synonym in synonyms:
                    self.assertEqual(synonym, ' '.join(synonym.split()))
                self.assertEqual(len(synonyms), len({item.casefold() for item in synonyms}))

    def test_no_alias_shadows_another_species_name(self):
        """An alias that names a *different* species would merge two crops."""
        names_by_key = {
            entry.key: {name.casefold() for name in entry.translations.values()}
            for entry in BOOTSTRAP_SPECIES
        }

        for key, synonyms_by_language in BOOTSTRAP_SPECIES_SYNONYMS.items():
            foreign_names = {
                name
                for other_key, names in names_by_key.items()
                if other_key != key
                for name in names
            }
            for synonyms in synonyms_by_language.values():
                for synonym in synonyms:
                    with self.subTest(key=key, synonym=synonym):
                        self.assertNotIn(synonym.casefold(), foreign_names)

    def test_regional_names_of_the_same_crop_are_aliases(self):
        self.assertIn('Erdapfel', get_bootstrap_species_synonyms('potato'))
        self.assertIn('Blumenkohl', get_bootstrap_species_synonyms('cauliflower'))
        self.assertIn('Porree', get_bootstrap_species_synonyms('leek'))
        self.assertIn('Paradeiser', get_bootstrap_species_synonyms('tomato'))
        self.assertIn('Meerrettich', get_bootstrap_species_synonyms('horseradish'))

    def test_ambiguous_names_are_aliases_of_every_candidate(self):
        """Rather offer both crops than force a wrong automatic assignment."""
        for key in ('pepper', 'chili', 'pepperoncini'):
            self.assertIn('Peperoni', get_bootstrap_species_synonyms(key))
        for key in ('bush_bean', 'pole_bean', 'french_bean'):
            self.assertIn('Fisolen', get_bootstrap_species_synonyms(key))

    def test_functionally_distinct_crops_are_species_not_aliases(self):
        """Different cultivation or harvest means an own species, not an alias.

        Pfefferoni has its own growing time and spacing, Schnittkohl is cut
        repeatedly as young leaves, Zuckererbse is eaten pod and all, and
        Puntarelle/Radicchio are grown and harvested unlike the other
        chicories — so none of them may be folded into Paprika, Grünkohl,
        Erbse, or Chicorée.
        """
        german_names = {
            get_bootstrap_species_name(entry, 'de')
            for entry in BOOTSTRAP_SPECIES
        }
        all_synonyms = {
            synonym.casefold()
            for synonyms_by_language in BOOTSTRAP_SPECIES_SYNONYMS.values()
            for synonyms in synonyms_by_language.values()
            for synonym in synonyms
        }

        for name in ('Pfefferoni', 'Puntarelle', 'Radicchio', 'Schnittkohl', 'Zuckererbse'):
            with self.subTest(name=name):
                self.assertIn(name, german_names)
                self.assertNotIn(name.casefold(), all_synonyms)

    def test_smooth_and_curly_endive_are_aliases_of_endivie(self):
        """Eskariol and Frisée differ only on the variety level."""
        german_names = {
            get_bootstrap_species_name(entry, 'de').casefold()
            for entry in BOOTSTRAP_SPECIES
        }
        endive_synonyms = get_bootstrap_species_synonyms('endive')

        for name in ('Eskariol', 'Escariol', 'Frisée', 'Frisee', 'Endiviensalat'):
            with self.subTest(name=name):
                self.assertIn(name, endive_synonyms)
                self.assertNotIn(name.casefold(), german_names)
        for name in ('Endivie glatt', 'Endivie krause', 'Glatte Endivie', 'Krause Endivie'):
            with self.subTest(name=name):
                self.assertNotIn(name.casefold(), german_names)

    def test_chicory_and_radicchio_stay_separate_from_endive(self):
        """Forced Chicorée and Radicchio have their own cultivation logic."""
        german_names = {
            get_bootstrap_species_name(entry, 'de')
            for entry in BOOTSTRAP_SPECIES
        }
        endive_synonyms = {
            synonym.casefold() for synonym in get_bootstrap_species_synonyms('endive')
        }

        for name in ('Chicorée', 'Radicchio'):
            with self.subTest(name=name):
                self.assertIn(name, german_names)
                self.assertNotIn(name.casefold(), endive_synonyms)

    def test_swede_is_not_aliased_onto_kohlrabi(self):
        """Kohlrübe is the swede, a different crop the library does not seed."""
        self.assertEqual(get_bootstrap_species_synonyms('kohlrabi'), ())
        all_synonyms = {
            synonym.casefold()
            for synonyms_by_language in BOOTSTRAP_SPECIES_SYNONYMS.values()
            for synonyms in synonyms_by_language.values()
            for synonym in synonyms
        }
        self.assertNotIn('kohlrübe', all_synonyms)


class BootstrapSpeciesRegionalNamesTest(SimpleTestCase):
    """Regional display names follow docs/crop-taxonomy-guidelines.md §4."""

    def test_every_entry_targets_a_known_key_language_and_region(self):
        entries_by_key = {entry.key: entry for entry in BOOTSTRAP_SPECIES}

        for key, regional_names_by_language in BOOTSTRAP_SPECIES_REGIONAL_NAMES.items():
            with self.subTest(key=key):
                entry = entries_by_key.get(key)
                self.assertIsNotNone(entry, f'{key} is not a seeded species')
                for language_code, regional_names in regional_names_by_language.items():
                    self.assertIn(language_code, entry.translations)
                    for region, name in regional_names.items():
                        self.assertIn(region, SUPPORTED_REGIONAL_NAME_KEYS)
                        self.assertTrue(name)
                        self.assertEqual(name, name.strip())

    def test_a_regional_name_is_never_another_species_canonical_name(self):
        """Displaying one species under another's name would merge them for the user."""
        canonical_names = {
            name.casefold()
            for entry in BOOTSTRAP_SPECIES
            for name in entry.translations.values()
        }
        entries_by_key = {entry.key: entry for entry in BOOTSTRAP_SPECIES}

        for key, regional_names_by_language in BOOTSTRAP_SPECIES_REGIONAL_NAMES.items():
            own_names = {
                name.casefold()
                for name in entries_by_key[key].translations.values()
            }
            for regional_names in regional_names_by_language.values():
                for name in regional_names.values():
                    with self.subTest(key=key, name=name):
                        self.assertFalse(
                            name.casefold() in canonical_names
                            and name.casefold() not in own_names,
                        )

    def test_ambiguous_terms_never_become_a_displayed_regional_name(self):
        """A term that means different crops per region must stay search-only.

        "Peperoni" is a search alias of Chili, Paprika and Pfefferoni on
        purpose; promoting it to a display name would pick one reading and
        show sweet peppers as chillies, or the reverse, depending on region.
        """
        displayed = {
            name.casefold()
            for regional_names_by_language in BOOTSTRAP_SPECIES_REGIONAL_NAMES.values()
            for regional_names in regional_names_by_language.values()
            for name in regional_names.values()
        }

        for ambiguous_term in ('peperoni', 'fisole', 'fisolen'):
            self.assertNotIn(ambiguous_term, displayed)

    def test_requested_regional_display_names_are_seeded(self):
        self.assertEqual(
            get_bootstrap_species_regional_names('aubergine'), {'austria': 'Melanzani'},
        )
        self.assertEqual(
            get_bootstrap_species_regional_names('potato'), {'austria': 'Erdapfel'},
        )
        self.assertEqual(
            get_bootstrap_species_regional_names('corn_salad'),
            {'austria': 'Vogerlsalat', 'switzerland': 'Nüsslisalat'},
        )

        swiss_names = {
            'beetroot': 'Rande',
            'cabbage': 'Kabis',
            'carrot': 'Rüebli',
            'chard': 'Krautstiel',
            'kale': 'Federkohl',
            'pointed_cabbage': 'Spitzkabis',
            'red_cabbage': 'Rotkabis',
            'savoy_cabbage': 'Wirz',
            'sugar_pea': 'Kefe',
            'summer_squash': 'Zucchetti',
        }
        for key, expected_name in swiss_names.items():
            with self.subTest(key=key):
                self.assertEqual(
                    get_bootstrap_species_regional_names(key).get('switzerland'),
                    expected_name,
                )

    def test_unknown_key_returns_an_empty_mapping(self):
        self.assertEqual(get_bootstrap_species_regional_names('tomato', 'fr'), {})
        self.assertEqual(get_bootstrap_species_regional_names('does-not-exist'), {})
