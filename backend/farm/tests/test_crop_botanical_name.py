"""The Latin (botanical) name of a crop: API, inheritance, import and crop library."""

from accounts.trust import grant_established_trust
from crops.models import CropSpecies
from farm.models import Crop, Project, ProjectMembership, PublicCrop, PublicCropRevision
from farm.services.public_crops import build_public_crop_snapshot, restore_public_crop_version
from farm.tests.api_base import ProjectApiTestCase

CROPS_URL = '/openfarmplanner/api/crops/'


class CropBotanicalNameTests(ProjectApiTestCase):
    def setUp(self):
        super().setUp()
        self.species = CropSpecies.objects.create(name='Botanical name test chard')
        self.kultur = Crop.objects.create(
            project=self.project, name='Mangold', variety='', crop_species=self.species,
            botanical_name='Beta vulgaris', growth_duration_days=60, harvest_duration_days=90,
        )

    def test_a_variety_inherits_the_kulturs_name_and_can_set_its_own(self):
        inheriting = Crop.objects.create(
            project=self.project, name='Mangold', variety='Bright Lights', crop_species=self.species,
        )
        own = Crop.objects.create(
            project=self.project, name='Mangold', variety='Glatter Silber', crop_species=self.species,
            botanical_name='Beta vulgaris var. flavescens',
        )

        inheriting_data = self.client.get(f'{CROPS_URL}{inheriting.id}/').data
        own_data = self.client.get(f'{CROPS_URL}{own.id}/').data

        self.assertEqual(inheriting_data['botanical_name'], '')
        self.assertEqual(inheriting_data['effective_values']['botanical_name'], 'Beta vulgaris')
        self.assertIn('botanical_name', inheriting_data['inherited_fields'])
        self.assertEqual(own_data['effective_values']['botanical_name'], 'Beta vulgaris var. flavescens')

    def test_the_api_saves_it(self):
        response = self.client.patch(
            f'{CROPS_URL}{self.kultur.id}/', {'botanical_name': 'Beta vulgaris subsp. vulgaris'}, format='json',
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.kultur.refresh_from_db()
        self.assertEqual(self.kultur.botanical_name, 'Beta vulgaris subsp. vulgaris')

    def test_the_spreadsheet_import_reads_it(self):
        response = self.client.post(
            f'{CROPS_URL}import/apply/',
            {'items': [{'name': 'Bartnelke', 'botanical_name': 'Dianthus barbatus'}]},
            format='json',
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Crop.objects.get(project=self.project, name='Bartnelke').botanical_name, 'Dianthus barbatus')

    def test_publishing_and_importing_carry_it_through_the_library(self):
        grant_established_trust(self.user)
        publish = self.client.post(f'{CROPS_URL}{self.kultur.id}/publish-public/', {
            'accepted_public_library_terms': True,
            'crop_species_id': self.species.id,
            'original_language_code': 'de',
            'publish_as_general': True,
        }, format='json')
        self.assertEqual(publish.status_code, 201, publish.data)
        entry = PublicCrop.objects.get(crop_species=self.species, variety='')
        self.assertEqual(entry.botanical_name, 'Beta vulgaris')

        other_project = Project.objects.create(name='Other', slug='other-botanical')
        ProjectMembership.objects.create(user=self.user, project=other_project, role='admin')
        self.client.defaults['HTTP_X_PROJECT_ID'] = str(other_project.id)
        imported = self.client.post(f'/openfarmplanner/api/public-crops/{entry.id}/import/', {}, format='json')

        self.assertEqual(imported.status_code, 201, imported.data)
        self.assertEqual(Crop.objects.get(id=imported.data['crop']['id']).botanical_name, 'Beta vulgaris')

    def test_editing_it_on_an_imported_crop_marks_it_modified_from_source(self):
        entry = PublicCrop.objects.create(
            name='Mangold', variety='', crop_species=self.species, botanical_name='Beta vulgaris',
        )
        crop = Crop.objects.create(
            project=self.project, name='Mangold', variety='Bright Lights', crop_species=self.species,
            source_public_crop=entry,
        )

        response = self.client.patch(
            f'{CROPS_URL}{crop.id}/', {'botanical_name': 'Beta vulgaris var. cicla'}, format='json',
        )

        self.assertEqual(response.status_code, 200, response.data)
        crop.refresh_from_db()
        self.assertTrue(crop.is_modified_from_source)

    def test_restoring_a_version_saved_before_the_field_existed_blanks_it(self) -> None:
        entry = PublicCrop.objects.create(
            name='Mangold', variety='', botanical_name='Beta vulgaris', version=2, created_by=self.user,
        )
        old_snapshot = build_public_crop_snapshot(entry)
        del old_snapshot['botanical_name']
        PublicCropRevision.objects.create(
            public_crop=entry, version=1, action='created', snapshot=old_snapshot,
        )

        restored = restore_public_crop_version(public_crop=entry, user=self.user, version=1)

        restored.refresh_from_db()
        self.assertEqual(restored.botanical_name, '')
