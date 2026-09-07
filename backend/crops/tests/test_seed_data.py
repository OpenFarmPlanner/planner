from django.test import SimpleTestCase

from crops.models import SUPPORTED_REGIONAL_NAME_KEYS
from crops.seed_data import (
    CROP_SPECIES_REGIONAL_NAME_SEED_DATA,
    CROP_SPECIES_SEED_DATA,
    CROP_SPECIES_SYNONYM_SEED_DATA,
    get_crop_species_seed_name,
    get_crop_species_seed_regional_names,
    get_crop_species_seed_synonyms,
)


class CropSpeciesSeedDataTest(SimpleTestCase):
    def test_seed_entries_have_stable_keys_and_initial_translations(self):
        keys = [entry.key for entry in CROP_SPECIES_SEED_DATA]
        german_names = [
            get_crop_species_seed_name(entry, 'de')
            for entry in CROP_SPECIES_SEED_DATA
        ]
        english_names = [
            get_crop_species_seed_name(entry, 'en')
            for entry in CROP_SPECIES_SEED_DATA
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

        for entry in CROP_SPECIES_SEED_DATA:
            self.assertIn('de', entry.translations)
            self.assertIn('en', entry.translations)
            self.assertIsInstance(entry.scientific_name, str)
            self.assertIsInstance(entry.family, str)
            self.assertIsInstance(entry.categories, tuple)
            for category in entry.categories:
                self.assertEqual(category, category.strip().lower())

    def test_seed_entries_can_carry_species_metadata(self):
        bulb_fennel = next(
            entry for entry in CROP_SPECIES_SEED_DATA if entry.key == 'fennel_bulb'
        )
        herb_fennel = next(
            entry for entry in CROP_SPECIES_SEED_DATA if entry.key == 'fennel_herb'
        )
        leaf_mustard = next(
            entry for entry in CROP_SPECIES_SEED_DATA if entry.key == 'leaf_mustard'
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

    def test_seed_entries_use_concrete_species_instead_of_supplier_categories(self):
        """Guards the naming convention documented in docs/crop-library-architecture.md.

        Slash collective names and supplier/shop categories mix several
        botanical species with different growing and harvest logic, so they
        must never become suggestable crop species again.
        """
        german_names = [
            get_crop_species_seed_name(entry, 'de')
            for entry in CROP_SPECIES_SEED_DATA
        ]
        english_names = [
            get_crop_species_seed_name(entry, 'en')
            for entry in CROP_SPECIES_SEED_DATA
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


class CropSpeciesSynonymSeedDataTest(SimpleTestCase):
    """The alias list decides which names must *not* become their own species."""

    def test_every_alias_belongs_to_a_seeded_species(self):
        seed_keys = {entry.key for entry in CROP_SPECIES_SEED_DATA}

        for key, synonyms_by_language in CROP_SPECIES_SYNONYM_SEED_DATA.items():
            self.assertIn(key, seed_keys)
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
            for entry in CROP_SPECIES_SEED_DATA
        }

        for key, synonyms_by_language in CROP_SPECIES_SYNONYM_SEED_DATA.items():
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
        self.assertIn('Erdapfel', get_crop_species_seed_synonyms('potato'))
        self.assertIn('Blumenkohl', get_crop_species_seed_synonyms('cauliflower'))
        self.assertIn('Porree', get_crop_species_seed_synonyms('leek'))
        self.assertIn('Paradeiser', get_crop_species_seed_synonyms('tomato'))
        self.assertIn('Meerrettich', get_crop_species_seed_synonyms('horseradish'))

    def test_ambiguous_names_are_aliases_of_every_candidate(self):
        """Rather offer both crops than force a wrong automatic assignment."""
        for key in ('pepper', 'chili', 'pepperoncini'):
            self.assertIn('Peperoni', get_crop_species_seed_synonyms(key))
        for key in ('bush_bean', 'pole_bean', 'french_bean'):
            self.assertIn('Fisolen', get_crop_species_seed_synonyms(key))

    def test_functionally_distinct_crops_are_species_not_aliases(self):
        """Different cultivation or harvest means an own species, not an alias.

        Pfefferoni has its own growing time and spacing, Schnittkohl is cut
        repeatedly as young leaves, Zuckererbse is eaten pod and all, and
        Puntarelle/Radicchio are grown and harvested unlike the other
        chicories — so none of them may be folded into Paprika, Grünkohl,
        Erbse, or Chicorée.
        """
        german_names = {
            get_crop_species_seed_name(entry, 'de')
            for entry in CROP_SPECIES_SEED_DATA
        }
        all_synonyms = {
            synonym.casefold()
            for synonyms_by_language in CROP_SPECIES_SYNONYM_SEED_DATA.values()
            for synonyms in synonyms_by_language.values()
            for synonym in synonyms
        }

        for name in ('Pfefferoni', 'Puntarelle', 'Radicchio', 'Schnittkohl', 'Zuckererbse'):
            with self.subTest(name=name):
                self.assertIn(name, german_names)
                self.assertNotIn(name.casefold(), all_synonyms)

    def test_swede_is_not_aliased_onto_kohlrabi(self):
        """Kohlrübe is the swede, a different crop the library does not seed."""
        self.assertEqual(get_crop_species_seed_synonyms('kohlrabi'), ())
        all_synonyms = {
            synonym.casefold()
            for synonyms_by_language in CROP_SPECIES_SYNONYM_SEED_DATA.values()
            for synonyms in synonyms_by_language.values()
            for synonym in synonyms
        }
        self.assertNotIn('kohlrübe', all_synonyms)


class CropSpeciesRegionalNameSeedDataTest(SimpleTestCase):
    """Regional display names follow docs/crop-taxonomy-guidelines.md §4."""

    def test_every_entry_targets_a_known_key_language_and_region(self):
        entries_by_key = {entry.key: entry for entry in CROP_SPECIES_SEED_DATA}

        for key, regional_names_by_language in CROP_SPECIES_REGIONAL_NAME_SEED_DATA.items():
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
            for entry in CROP_SPECIES_SEED_DATA
            for name in entry.translations.values()
        }
        entries_by_key = {entry.key: entry for entry in CROP_SPECIES_SEED_DATA}

        for key, regional_names_by_language in CROP_SPECIES_REGIONAL_NAME_SEED_DATA.items():
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
            for regional_names_by_language in CROP_SPECIES_REGIONAL_NAME_SEED_DATA.values()
            for regional_names in regional_names_by_language.values()
            for name in regional_names.values()
        }

        for ambiguous_term in ('peperoni', 'fisole', 'fisolen'):
            self.assertNotIn(ambiguous_term, displayed)

    def test_requested_regional_display_names_are_seeded(self):
        self.assertEqual(
            get_crop_species_seed_regional_names('aubergine'), {'austria': 'Melanzani'},
        )
        self.assertEqual(
            get_crop_species_seed_regional_names('potato'), {'austria': 'Erdapfel'},
        )
        self.assertEqual(
            get_crop_species_seed_regional_names('corn_salad'),
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
                    get_crop_species_seed_regional_names(key).get('switzerland'),
                    expected_name,
                )

    def test_unknown_key_returns_an_empty_mapping(self):
        self.assertEqual(get_crop_species_seed_regional_names('tomato', 'fr'), {})
        self.assertEqual(get_crop_species_seed_regional_names('does-not-exist'), {})
