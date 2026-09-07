from django.test import SimpleTestCase

from crops.models import SUPPORTED_REGIONAL_NAME_KEYS
from crops.seed_data import (
    CROP_SPECIES_SEED_DATA,
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
        self.assertGreaterEqual(len(keys), 185)
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
        self.assertIn('Blumenkohl', german_names)
        self.assertNotIn('Karfiol', german_names)
        self.assertIn('Pfefferoni', german_names)
        self.assertIn('Puntarelle', german_names)
        self.assertIn('Radicchio', german_names)
        self.assertIn('Schnittkohl', german_names)
        self.assertIn('Zuckererbse', german_names)
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


class CropSpeciesSeedAliasTest(SimpleTestCase):
    """Alias data must follow docs/crop-taxonomy-guidelines.md."""

    def _entry(self, key: str):
        return next(entry for entry in CROP_SPECIES_SEED_DATA if entry.key == key)

    def test_regional_names_use_supported_region_keys_and_known_languages(self):
        for entry in CROP_SPECIES_SEED_DATA:
            for language_code, regional_names in entry.regional_names.items():
                self.assertIn(language_code, entry.translations)
                for region, name in regional_names.items():
                    self.assertIn(region, SUPPORTED_REGIONAL_NAME_KEYS)
                    self.assertEqual(name, name.strip())
                    self.assertTrue(name)
            for language_code, synonyms in entry.synonyms.items():
                self.assertIn(language_code, entry.translations)
                self.assertEqual(len(synonyms), len(set(synonyms)))
                for synonym in synonyms:
                    self.assertEqual(synonym, synonym.strip())
                    self.assertTrue(synonym)

    def test_no_alias_repeats_a_canonical_name_of_another_species(self):
        """An alias that is also a canonical name would make two species collide."""
        canonical_names = {
            name.casefold()
            for entry in CROP_SPECIES_SEED_DATA
            for name in entry.translations.values()
        }
        for entry in CROP_SPECIES_SEED_DATA:
            own_names = {name.casefold() for name in entry.translations.values()}
            aliases = [
                *(
                    synonym
                    for synonyms in entry.synonyms.values()
                    for synonym in synonyms
                ),
                *(
                    name
                    for regional_names in entry.regional_names.values()
                    for name in regional_names.values()
                ),
            ]
            for alias in aliases:
                key = alias.casefold()
                self.assertFalse(
                    key in canonical_names and key not in own_names,
                    f'{entry.key}: "{alias}" is the canonical name of another species',
                )

    def test_alias_is_not_repeated_in_both_alias_fields(self):
        """Regional names are already searchable; repeating them adds no value."""
        for entry in CROP_SPECIES_SEED_DATA:
            for language_code in entry.translations:
                synonyms = {
                    synonym.casefold()
                    for synonym in get_crop_species_seed_synonyms(entry, language_code)
                }
                regional_names = {
                    name.casefold()
                    for name in get_crop_species_seed_regional_names(
                        entry, language_code,
                    ).values()
                }
                self.assertFalse(synonyms & regional_names, entry.key)

    def test_requested_regional_aliases_are_seeded(self):
        self.assertEqual(
            get_crop_species_seed_regional_names(self._entry('cauliflower')),
            {'austria': 'Karfiol'},
        )
        self.assertEqual(
            get_crop_species_seed_regional_names(self._entry('potato')),
            {'austria': 'Erdapfel'},
        )
        self.assertEqual(
            get_crop_species_seed_regional_names(self._entry('aubergine')),
            {'austria': 'Melanzani'},
        )
        self.assertIn('Porree', get_crop_species_seed_synonyms(self._entry('leek')))

        swiss_aliases = {
            'corn_salad': 'Nüsslisalat',
            'beetroot': 'Rande',
            'cabbage': 'Kabis',
            'summer_squash': 'Zucchetti',
            'kale': 'Federkohl',
            'savoy_cabbage': 'Wirz',
            'red_cabbage': 'Rotkabis',
            'pointed_cabbage': 'Spitzkabis',
            'carrot': 'Rüebli',
            'chard': 'Krautstiel',
            'snow_pea': 'Kefe',
        }
        for key, expected_name in swiss_aliases.items():
            self.assertEqual(
                get_crop_species_seed_regional_names(self._entry(key)).get('switzerland'),
                expected_name,
                key,
            )

    def test_ambiguous_peperoni_is_never_seeded_as_an_alias(self):
        """Swiss "Peperoni" (= Paprika) collides with the hot-pepper reading elsewhere.

        Guards the manual-decision rule in docs/crop-taxonomy-guidelines.md §4:
        the term must not silently resolve to any species.
        """
        for entry in CROP_SPECIES_SEED_DATA:
            aliases = [
                *(
                    synonym
                    for synonyms in entry.synonyms.values()
                    for synonym in synonyms
                ),
                *(
                    name
                    for regional_names in entry.regional_names.values()
                    for name in regional_names.values()
                ),
            ]
            for alias in aliases:
                self.assertNotEqual(alias.casefold(), 'peperoni', entry.key)
