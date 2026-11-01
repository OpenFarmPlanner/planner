"""Crop groups ("Gruppen"): normalization, inheritance, import, and staying out of the library."""

from crops.models import CropSpecies
from farm.models import Crop
from farm.services.crop_import.analysis import analyze_field
from farm.services.crop_import.field_specs import CROP_FIELD_SPECS
from farm.services.crop_tags import normalize_tags
from farm.services.public_crops import build_public_crop_payload
from farm.tests.api_base import ProjectApiTestCase

CROPS_URL = '/openfarmplanner/api/crops/'
TAGS_SPEC = next(spec for spec in CROP_FIELD_SPECS if spec.name == 'tags')


class NormalizeTagsTests(ProjectApiTestCase):
    def test_drops_list_markers_extra_spaces_and_duplicates(self):
        self.assertEqual(
            normalize_tags(['• Getreide', '  Baum  /  Sträucher ', 'getreide', '', '- Kräuter']),
            ['Getreide', 'Baum / Sträucher', 'Kräuter'],
        )

    def test_splits_one_text_at_commas_semicolons_and_line_breaks(self):
        self.assertEqual(normalize_tags('Kräuter, Blumen;Mehrjährig\nGründünger'),
                         ['Kräuter', 'Blumen', 'Mehrjährig', 'Gründünger'])


class CropTagsApiTests(ProjectApiTestCase):
    def setUp(self):
        super().setUp()
        self.species = CropSpecies.objects.create(name='Crop tags test chamomile')
        self.kultur = Crop.objects.create(
            project=self.project, name='Kamille', variety='', crop_species=self.species, tags=['Kräuter'],
        )

    def test_the_api_saves_cleaned_up_groups(self):
        response = self.client.patch(
            f'{CROPS_URL}{self.kultur.id}/', {'tags': ['• Kräuter', 'Blumen ', 'blumen']}, format='json',
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.kultur.refresh_from_db()
        self.assertEqual(self.kultur.tags, ['Kräuter', 'Blumen'])

    def test_a_known_group_takes_the_projects_spelling(self):
        other = Crop.objects.create(project=self.project, name='Salbei', variety='')

        response = self.client.patch(f'{CROPS_URL}{other.id}/', {'tags': ['kräuter']}, format='json')

        self.assertEqual(response.status_code, 200, response.data)
        other.refresh_from_db()
        self.assertEqual(other.tags, ['Kräuter'])

    def test_a_variety_without_own_groups_uses_the_kulturs(self):
        inheriting = Crop.objects.create(
            project=self.project, name='Kamille', variety='Bodegold', crop_species=self.species,
        )
        own = Crop.objects.create(
            project=self.project, name='Kamille', variety='Zierkamille', crop_species=self.species, tags=['Blumen'],
        )

        inheriting_data = self.client.get(f'{CROPS_URL}{inheriting.id}/').data
        own_data = self.client.get(f'{CROPS_URL}{own.id}/').data

        self.assertEqual(inheriting_data['tags'], [])
        self.assertEqual(inheriting_data['effective_values']['tags'], ['Kräuter'])
        self.assertIn('tags', inheriting_data['inherited_fields'])
        self.assertEqual(own_data['effective_values']['tags'], ['Blumen'])

    def test_the_spreadsheet_import_reads_them(self):
        response = self.client.post(
            f'{CROPS_URL}import/apply/',
            {'items': [{'name': 'Bartnelke', 'tags': ['• Blumen', 'Mehrjährig']}]},
            format='json',
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Crop.objects.get(project=self.project, name='Bartnelke').tags, ['Blumen', 'Mehrjährig'])

    def test_the_field_spec_accepts_a_separated_text(self):
        analysis = analyze_field(TAGS_SPEC, 'Gruppe', 'Kräuter, Blumen', None)

        self.assertEqual(analysis.api_value, ['Kräuter', 'Blumen'])
        self.assertFalse(analysis.errors)

    def test_groups_are_not_published_to_the_library(self):
        self.assertNotIn('tags', build_public_crop_payload(self.kultur))
