"""The curated plant-family list, its seed data and the free-text mapping rule."""

from django.test import SimpleTestCase, TestCase

from crops.models import PlantFamily
from crops.plant_families import (
    PLANT_FAMILY_SEED_DATA,
    coerce_plant_family_key,
    load_plant_family_default_breaks,
    resolve_plant_family_key,
)

EXPECTED_SEED = {
    'Brassicaceae': ('Kreuzblütler', 4),
    'Solanaceae': ('Nachtschattengewächse', 3),
    'Apiaceae': ('Doldenblütler', 3),
    'Amaryllidaceae': ('Lauchgewächse', 3),
    'Fabaceae': ('Hülsenfrüchtler', 3),
    'Amaranthaceae': ('Fuchsschwanzgewächse', 3),
    'Cucurbitaceae': ('Kürbisgewächse', 2),
    'Asteraceae': ('Korbblütler', 2),
    'Poaceae': ('Süßgräser', None),
    'Lamiaceae': ('Lippenblütler', None),
    'Caprifoliaceae': ('Geißblattgewächse (Feldsalat)', None),
    'Boraginaceae': ('Raublattgewächse', None),
    'Polygonaceae': ('Knöterichgewächse', None),
    'Malvaceae': ('Malvengewächse', None),
    'Montiaceae': ('Quellkrautgewächse', None),
    'Tropaeolaceae': ('Kapuzinerkressengewächse', None),
}


class PlantFamilyResolverTest(SimpleTestCase):
    def test_seed_data_matches_the_curated_list(self):
        seeded = {
            seed.botanical_name: (seed.names['de'], seed.default_rotation_break_years)
            for seed in PLANT_FAMILY_SEED_DATA
        }
        self.assertEqual(seeded, EXPECTED_SEED)
        for seed in PLANT_FAMILY_SEED_DATA:
            self.assertTrue(seed.names.get('en'), seed.botanical_name)

    def test_botanical_german_and_english_names_resolve(self):
        for seed in PLANT_FAMILY_SEED_DATA:
            for spelling in (seed.botanical_name, *seed.names.values()):
                self.assertEqual(resolve_plant_family_key(spelling), seed.botanical_name, spelling)

    def test_case_whitespace_and_umlaut_variants_resolve(self):
        for spelling in ('brassicaceae', '  BRASSICACEAE ', 'Kreuzbluetler', 'kreuzblütler.'):
            self.assertEqual(resolve_plant_family_key(spelling), 'Brassicaceae', spelling)

    def test_common_variants_and_historical_synonyms_resolve(self):
        cases = {
            'Kreuzblütengewächse': 'Brassicaceae',
            'Kohlgewächse': 'Brassicaceae',
            'Cruciferae': 'Brassicaceae',
            'Leguminosen': 'Fabaceae',
            'Schmetterlingsblütler': 'Fabaceae',
            'Gänsefußgewächse': 'Amaranthaceae',
            'Chenopodiaceae': 'Amaranthaceae',
            'Zwiebelgewächse': 'Amaryllidaceae',
            'Alliaceae': 'Amaryllidaceae',
            'Umbelliferae': 'Apiaceae',
            'Compositae': 'Asteraceae',
            'Valerianaceae': 'Caprifoliaceae',
            'Geißblattgewächse': 'Caprifoliaceae',
        }
        for spelling, family in cases.items():
            self.assertEqual(resolve_plant_family_key(spelling), family, spelling)

    def test_compound_values_resolve_only_when_every_known_part_agrees(self):
        self.assertEqual(resolve_plant_family_key('Kreuzblütler (Brassicaceae)'), 'Brassicaceae')
        self.assertEqual(resolve_plant_family_key('Kohlgewächse / Cruciferae'), 'Brassicaceae')
        self.assertIsNone(resolve_plant_family_key('Nachtschatten / Kürbisgewächse'))
        self.assertIsNone(resolve_plant_family_key('Nachtschatten / Kürbis'))
        self.assertIsNone(resolve_plant_family_key('Kreuzblütler (Kohl, Rettich)'))

    def test_ambiguous_or_unknown_values_do_not_resolve(self):
        # Liliengewächse covered onions *and* asparagus in older books.
        for spelling in ('Liliengewächse', 'Rosaceae', 'Kohl', '', None, '   '):
            self.assertIsNone(resolve_plant_family_key(spelling), spelling)


class PlantFamilySeedTest(TestCase):
    def test_migration_seeds_every_family_with_both_languages(self):
        families = {family.pk: family for family in PlantFamily.objects.prefetch_related('translations')}
        self.assertEqual(set(families), set(EXPECTED_SEED))
        for key, (german_name, default_break) in EXPECTED_SEED.items():
            family = families[key]
            self.assertEqual(family.localized_name('de'), (german_name, 'de'))
            self.assertEqual(family.localized_name('en')[1], 'en')
            self.assertEqual(family.default_rotation_break_years, default_break)

    def test_localized_name_falls_back_to_the_botanical_name(self):
        family = PlantFamily.objects.create(botanical_name='Rosaceae')
        self.assertEqual(family.localized_name('de'), ('Rosaceae', ''))

    def test_default_breaks_map_every_family(self):
        breaks = load_plant_family_default_breaks()
        self.assertEqual(breaks['Brassicaceae'], 4)
        self.assertIsNone(breaks['Poaceae'])

    def test_coerce_keeps_stored_keys_and_maps_free_text(self):
        PlantFamily.objects.create(botanical_name='Rosaceae')
        self.assertEqual(coerce_plant_family_key('Rosaceae'), 'Rosaceae')
        self.assertEqual(coerce_plant_family_key('Kreuzblütler'), 'Brassicaceae')
        self.assertIsNone(coerce_plant_family_key('Liliengewächse'))
        self.assertIsNone(coerce_plant_family_key(''))
