"""API tests for the public crop library endpoints."""


from datetime import datetime, timedelta, timezone as datetime_timezone
from decimal import Decimal

from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase as DRFAPITestCase

from accounts.guest_demo import create_guest_demo_session
from accounts.models import DocumentConsent
from crops.models import CropSpecies, CropSpeciesTranslation
from crops.permissions import grant_public_library_moderator_access
from farm.models import (
    Crop,
    EntityRevision,
    Project,
    ProjectMembership,
    PublicCrop,
    PublicCropChangeProposal,
    PublicCropDiscussionComment,
    PublicCropDiscussionTopic,
    PublicCropRevision,
    PublicCropStatusEvent,
    PublicCropTranslation,
    SeedPackage,
)
from farm.services.crop_inheritance import get_general_crop
from farm.tests.api_base import User


class PublicCropLibraryApiTest(DRFAPITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='library-user', email='library@example.com', password='testpass', is_active=True)
        self.project = Project.objects.create(name='Library Project', slug='library-project')
        ProjectMembership.objects.create(user=self.user, project=self.project, role='admin')
        self.client.force_authenticate(user=self.user)
        self.client.defaults['HTTP_X_PROJECT_ID'] = str(self.project.id)
        self.species = CropSpecies.objects.create(name='Lettuce')
        self.crop = Crop.objects.create(
            name='Lettuce',
            variety='Bijella',
            crop_species=self.species,
            growth_duration_days=50,
            harvest_duration_days=20,
            notes='Project-local notes',
            project=self.project,
        )
        SeedPackage.objects.create(crop=self.crop, project=self.project, size_value='25.0', size_unit='g')

    def publish_current_crop(self):
        return self.client.post(
            f'/openfarmplanner/api/crops/{self.crop.id}/publish-public/',
            {
                'accepted_public_library_terms': True,
                'crop_species_id': self.species.id,
                'original_language_code': 'en',
            },
            format='json',
        )

    def test_publish_project_crop_creates_separate_public_crop(self):
        response = self.publish_current_crop()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['operation'], 'created')
        # Publishing a variety also auto-creates the species-level general
        # entry, since none existed yet for this species.
        self.assertEqual(PublicCrop.objects.count(), 2)
        public_crop = PublicCrop.objects.get(variety='Bijella')
        self.assertEqual(public_crop.name, self.crop.name)
        self.assertEqual(public_crop.variety, self.crop.variety)
        self.assertEqual(public_crop.source_project_crop, self.crop)
        self.assertEqual(public_crop.crop_species, self.species)
        self.assertEqual(public_crop.original_language_code, 'en')
        self.assertEqual(public_crop.seed_packages[0]['size_value'], 25.0)
        self.assertEqual(response.data['duplicates'], [])
        general_public_crop = PublicCrop.objects.get(variety='')
        self.assertEqual(general_public_crop.crop_species, self.species)
        self.assertEqual(general_public_crop.growth_duration_days, 50)
        self.assertTrue(
            DocumentConsent.objects.filter(
                user=self.user,
                document=DocumentConsent.DOCUMENT_PUBLIC_LIBRARY,
            ).exists()
        )

    def test_public_crop_response_exposes_project_crop_unit_aliases(self):
        PublicCrop.objects.create(
            name='Carrot',
            variety='Nantes',
            status=PublicCrop.STATUS_PUBLISHED,
            crop_species=self.species,
            created_by=self.user,
            cultivation_types=['direct_sowing', 'pre_cultivation'],
            distance_within_row_m=Decimal('0.30'),
            row_spacing_m=Decimal('0.44'),
            sowing_depth_m=Decimal('0.02'),
            seed_rate_by_cultivation={
                'direct_sowing': {'value': 12, 'unit': 'seeds_per_lfm'},
                'pre_cultivation': {'value': 3, 'unit': 'seeds_per_plant'},
            },
        )

        response = self.client.get('/openfarmplanner/api/public-crops/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        public_crop = response.data['results'][0]
        self.assertEqual(public_crop['distance_within_row_m'], 0.3)
        self.assertEqual(public_crop['distance_within_row_cm'], 30)
        self.assertEqual(public_crop['row_spacing_m'], 0.44)
        self.assertEqual(public_crop['row_spacing_cm'], 44)
        self.assertEqual(public_crop['sowing_depth_m'], 0.02)
        self.assertEqual(public_crop['sowing_depth_cm'], 2)
        self.assertEqual(
            public_crop['seed_requirements'],
            {
                'direct_sowing': {'value': 12, 'unit': 'seeds_per_lfm'},
                'pre_cultivation': {'value': 3, 'unit': 'seeds_per_plant'},
            },
        )
        self.assertEqual(public_crop['seed_rate_direct_value'], 12)
        self.assertEqual(public_crop['seed_rate_direct_unit'], 'seeds_per_lfm')
        self.assertEqual(public_crop['seed_rate_pre_cultivation_value'], 3)
        self.assertEqual(public_crop['seed_rate_pre_cultivation_unit'], 'seeds_per_plant')

    def test_public_crop_response_omits_seed_safety_margin(self):
        # The safety margin is a farm-specific planning decision, not a
        # property of the crop, so it is not public-library data.
        PublicCrop.objects.create(
            name='Carrot',
            variety='Nantes',
            status=PublicCrop.STATUS_PUBLISHED,
            crop_species=self.species,
            created_by=self.user,
            cultivation_types=['direct_sowing'],
        )

        response = self.client.get('/openfarmplanner/api/public-crops/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        public_crop = response.data['results'][0]
        self.assertNotIn('sowing_calculation_safety_percent', public_crop)
        self.assertNotIn('sowing_calculation_safety_percent_direct', public_crop)
        self.assertNotIn('sowing_calculation_safety_percent_pre_cultivation', public_crop)

    def test_publish_keeps_the_seed_safety_margin_out_of_the_public_entry(self):
        self.crop.sowing_calculation_safety_percent = 15
        self.crop.save()

        response = self.publish_current_crop()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        public_crop = PublicCrop.objects.get(variety='Bijella')
        self.assertFalse(hasattr(public_crop, 'sowing_calculation_safety_percent'))
        self.assertNotIn('sowing_calculation_safety_percent', response.data['public_crop'])

    def test_publish_requires_public_library_contribution_terms(self):
        response = self.client.post(f'/openfarmplanner/api/crops/{self.crop.id}/publish-public/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['code'], 'public_library_terms_required')
        self.assertEqual(PublicCrop.objects.count(), 0)

    def test_guest_demo_user_cannot_publish_to_public_library(self):
        demo_session = create_guest_demo_session()
        demo_crop = Crop.objects.filter(project=demo_session.project).first()
        self.client.force_authenticate(user=demo_session.user)
        self.client.defaults['HTTP_X_PROJECT_ID'] = str(demo_session.project_id)

        response = self.client.post(
            f'/openfarmplanner/api/crops/{demo_crop.id}/publish-public/',
            {'accepted_public_library_terms': True},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['code'], 'guest_demo_restricted')
        self.assertEqual(PublicCrop.objects.count(), 0)

    def test_publish_preview_reports_quality_gate_status(self):
        response = self.client.get(
            f'/openfarmplanner/api/crops/{self.crop.id}/publish-public/preview/',
            {'crop_species_id': self.species.id, 'original_language_code': 'en'},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['can_publish'])
        self.assertEqual(response.data['crop_species']['name'], 'Lettuce')
        self.assertEqual(response.data['original_language_code'], 'en')
        self.assertEqual(response.data['missing_required_fields'], [])

    def test_publish_allows_a_freshly_proposed_crop_species(self):
        proposed_species = CropSpecies.objects.create(
            name='Zzz Testonly Kohlrabusch', status=CropSpecies.STATUS_PROPOSED, proposed_by=self.user,
        )

        preview = self.client.get(
            f'/openfarmplanner/api/crops/{self.crop.id}/publish-public/preview/',
            {'crop_species_id': proposed_species.id, 'original_language_code': 'en'},
        )
        self.assertEqual(preview.status_code, status.HTTP_200_OK)
        self.assertTrue(preview.data['can_publish'])
        self.assertEqual(preview.data['crop_species']['name'], 'Zzz Testonly Kohlrabusch')

        response = self.client.post(
            f'/openfarmplanner/api/crops/{self.crop.id}/publish-public/',
            {
                'accepted_public_library_terms': True,
                'crop_species_id': proposed_species.id,
                'original_language_code': 'en',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        public_crop = PublicCrop.objects.get(variety='Bijella')
        self.assertEqual(public_crop.crop_species_id, proposed_species.id)
        proposed_species.refresh_from_db()
        self.assertEqual(proposed_species.status, CropSpecies.STATUS_PROPOSED)

    def test_publish_still_rejects_a_rejected_crop_species(self):
        rejected_species = CropSpecies.objects.create(
            name='Zzz Testonly Rutabusch', status=CropSpecies.STATUS_REJECTED, proposed_by=self.user,
        )

        preview = self.client.get(
            f'/openfarmplanner/api/crops/{self.crop.id}/publish-public/preview/',
            {'crop_species_id': rejected_species.id, 'original_language_code': 'en'},
        )
        self.assertEqual(preview.status_code, status.HTTP_200_OK)
        self.assertFalse(preview.data['can_publish'])
        self.assertIsNone(preview.data['crop_species'])

        response = self.client.post(
            f'/openfarmplanner/api/crops/{self.crop.id}/publish-public/',
            {
                'accepted_public_library_terms': True,
                'crop_species_id': rejected_species.id,
                'original_language_code': 'en',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['code'], 'public_crop_publishing_checks_failed')
        self.assertEqual(PublicCrop.objects.count(), 0)

    def test_publish_preview_blocks_missing_required_public_fields(self):
        self.crop.variety = ''
        self.crop.save()

        response = self.client.get(
            f'/openfarmplanner/api/crops/{self.crop.id}/publish-public/preview/',
            {'crop_species_id': self.species.id, 'original_language_code': 'en'},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data['can_publish'])
        self.assertEqual(response.data['missing_required_fields'][0]['field'], 'variety')

    def test_publish_as_general_crop_allows_empty_public_variety(self):
        response = self.client.post(
            f'/openfarmplanner/api/crops/{self.crop.id}/publish-public/',
            {
                'accepted_public_library_terms': True,
                'crop_species_id': self.species.id,
                'original_language_code': 'en',
                'publish_as_general': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        public_crop = PublicCrop.objects.get()
        self.assertEqual(public_crop.name, self.crop.name)
        self.assertEqual(public_crop.variety, '')
        self.assertEqual(public_crop.crop_species, self.species)

    def test_publish_preview_as_general_crop_does_not_require_variety(self):
        self.crop.variety = ''
        self.crop.save()

        response = self.client.get(
            f'/openfarmplanner/api/crops/{self.crop.id}/publish-public/preview/',
            {'crop_species_id': self.species.id, 'original_language_code': 'en', 'publish_as_general': 'true'},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['can_publish'])
        self.assertEqual(response.data['missing_required_fields'], [])

    def test_publish_preview_accepts_required_fields_inherited_from_general_crop(self):
        general_crop = Crop.objects.create(
            name='Lettuce',
            variety='',
            crop_species=self.species,
            growth_duration_days=55,
            harvest_duration_days=25,
            project=self.project,
        )
        self.assertIsNone(general_crop.variety_normalized)
        self.crop.growth_duration_days = None
        self.crop.harvest_duration_days = None
        self.crop.save()

        response = self.client.get(
            f'/openfarmplanner/api/crops/{self.crop.id}/publish-public/preview/',
            {'crop_species_id': self.species.id, 'original_language_code': 'en'},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['missing_required_fields'], [])
        self.assertTrue(response.data['can_publish'])

        publish = self.publish_current_crop()
        self.assertEqual(publish.status_code, status.HTTP_201_CREATED)
        variety_entry = PublicCrop.objects.get(source_project_crop=self.crop)
        self.assertEqual(variety_entry.growth_duration_days, 55)
        self.assertEqual(variety_entry.harvest_duration_days, 25)

    def test_publish_preview_allows_update_of_owned_public_crop(self):
        public_crop = PublicCrop.objects.create(
            name=self.crop.name,
            variety=self.crop.variety,
            status=PublicCrop.STATUS_PUBLISHED,
            crop_species=self.species,
            created_by=self.user,
            source_project=self.project,
            source_project_crop=self.crop,
        )
        self.crop.source_public_crop = public_crop
        self.crop.source_public_version = public_crop.version
        self.crop.save(update_fields=['source_public_crop', 'source_public_version'])

        response = self.client.get(
            f'/openfarmplanner/api/crops/{self.crop.id}/publish-public/preview/',
            {'crop_species_id': self.species.id, 'original_language_code': 'en'},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['can_publish'])
        self.assertEqual(response.data['duplicates'], [])

    def test_publish_rejects_duplicates_with_conflict_response(self):
        other_crop = Crop.objects.create(
            name='Lettuce',
            variety='Bijella',
            crop_species=self.species,
            project=self.project,
        )
        PublicCrop.objects.create(
            name='Lettuce',
            variety='Bijella',
            status='published',
            crop_species=self.species,
            created_by=self.user,
            source_project=self.project,
            source_project_crop=other_crop,
        )

        response = self.publish_current_crop()

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['code'], 'duplicate_public_crop')
        self.assertEqual(response.data['detail'], 'A similar public crop already exists.')
        self.assertEqual(len(response.data['duplicates']), 1)
        self.assertEqual(response.data['duplicates'][0]['name'], 'Lettuce')
        self.assertTrue(response.data['duplicates'][0]['is_mine'])
        self.assertEqual(response.data['normalized_identity']['name'], 'lettuce')
        self.assertEqual(response.data['normalized_identity']['variety'], 'bijella')
        self.assertEqual(PublicCrop.objects.count(), 1)

    def test_publish_conflict_response_flags_foreign_duplicates_as_not_mine(self):
        other_user = User.objects.create_user(username='foreign-owner', email='foreign@example.com', password='testpass', is_active=True)
        other_crop = Crop.objects.create(
            name='Lettuce',
            variety='Bijella',
            crop_species=self.species,
            project=self.project,
        )
        PublicCrop.objects.create(
            name='Lettuce',
            variety='Bijella',
            status='published',
            crop_species=self.species,
            created_by=other_user,
            source_project=self.project,
            source_project_crop=other_crop,
        )

        response = self.publish_current_crop()

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(len(response.data['duplicates']), 1)
        self.assertFalse(response.data['duplicates'][0]['is_mine'])

    def test_second_publish_updates_own_linked_public_crop_and_increments_version(self):
        first_publish = self.publish_current_crop()
        self.assertEqual(first_publish.status_code, status.HTTP_201_CREATED)
        public_crop_id = first_publish.data['public_crop']['id']

        self.crop.notes = 'Updated local notes'
        self.crop.save()

        second_publish = self.publish_current_crop()

        self.assertEqual(second_publish.status_code, status.HTTP_201_CREATED)
        self.assertEqual(second_publish.data['operation'], 'updated')
        self.assertEqual(second_publish.data['public_crop']['id'], public_crop_id)
        # variety entry (updated in place) + the general entry auto-created on first publish
        self.assertEqual(PublicCrop.objects.count(), 2)

        updated_public = PublicCrop.objects.get(id=public_crop_id)
        self.assertEqual(updated_public.version, 2)
        self.assertEqual(updated_public.notes, 'Updated local notes')

    def test_publish_links_local_crop_to_its_owned_public_entry(self):
        response = self.publish_current_crop()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        public_crop_id = response.data['public_crop']['id']

        self.crop.refresh_from_db()
        self.assertEqual(self.crop.source_public_crop_id, public_crop_id)
        self.assertEqual(
            self.crop.source_public_version,
            PublicCrop.objects.get(id=public_crop_id).version,
        )
        # A freshly published crop matches its entry, so no pull is pending and
        # the "Importiert" origin must not be set on the user's own row.
        self.assertFalse(self.crop.is_modified_from_source)
        self.assertNotEqual(self.crop.origin_type, Crop.ORIGIN_IMPORTED)

    def test_publish_updates_own_imported_public_crop(self):
        own_public = PublicCrop.objects.create(
            name='Carrot',
            variety='Mokum',
            status='published',
            crop_species=self.species,
            original_language_code='en',
            created_by=self.user,
            source_project=self.project,
            version=3,
        )
        self.crop.source_public_crop = own_public
        self.crop.source_public_version = own_public.version
        self.crop.name = 'Carrot'
        self.crop.variety = 'Mokum'
        self.crop.notes = 'Refined owner notes'
        self.crop.seed_supplier = 'Reinsaat'
        self.crop.save()

        response = self.publish_current_crop()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['operation'], 'updated')
        self.assertEqual(response.data['public_crop']['id'], own_public.id)

        own_public.refresh_from_db()
        self.assertEqual(own_public.version, 4)
        self.assertEqual(own_public.notes, 'Refined owner notes')

    def test_publish_does_not_update_foreign_source_public_crop(self):
        other_user = User.objects.create_user(username='other-owner', email='other@example.com', password='testpass', is_active=True)
        foreign_public = PublicCrop.objects.create(
            name='Lettuce',
            variety='Bijella',
            status='published',
            crop_species=self.species,
            created_by=other_user,
            source_project=self.project,
            source_project_crop=self.crop,
            version=5,
        )
        self.crop.source_public_crop = foreign_public
        self.crop.save()

        response = self.publish_current_crop()

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['code'], 'duplicate_public_crop')
        foreign_public.refresh_from_db()
        self.assertEqual(foreign_public.version, 5)
        self.assertEqual(PublicCrop.objects.count(), 1)

    def test_publish_rejects_duplicates_using_normalized_fields(self):
        PublicCrop.objects.create(
            name=' Lettuce ',
            variety='BIJELLA',
            status='published',
            crop_species=self.species,
            created_by=self.user,
            source_project=self.project,
        )
        self.crop.name = '  lettuce'
        self.crop.variety = 'bijella  '
        self.crop.save()

        response = self.publish_current_crop()

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(len(response.data['duplicates']), 1)
        self.assertEqual(PublicCrop.objects.count(), 1)

    def test_publish_allows_new_public_crop_for_different_normalized_identity(self):
        other_crop = Crop.objects.create(
            name='Lettuce',
            variety='Bijella',
            crop_species=self.species,
            project=self.project,
        )
        PublicCrop.objects.create(
            name='Lettuce',
            variety='Bijella',
            status='published',
            crop_species=self.species,
            created_by=self.user,
            source_project=self.project,
            source_project_crop=other_crop,
        )
        self.crop.variety = 'Other Variety'
        self.crop.save()

        response = self.publish_current_crop()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        # existing 'Bijella' duplicate + new 'Other Variety' + auto-created general entry
        self.assertEqual(PublicCrop.objects.count(), 3)

    def test_publish_does_not_touch_an_existing_general_public_crop(self):
        existing_general = PublicCrop.objects.create(
            name='Lettuce',
            variety='',
            status='published',
            crop_species=self.species,
            created_by=self.user,
            growth_duration_days=99,
            harvest_duration_days=99,
        )

        response = self.publish_current_crop()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(PublicCrop.objects.filter(variety='').count(), 1)
        existing_general.refresh_from_db()
        self.assertEqual(existing_general.growth_duration_days, 99)
        self.assertEqual(existing_general.version, 1)

    def test_general_kultur_uses_existing_owned_general_public_entry_from_another_project(self):
        """Publishing a Sorte should connect the local Kultur to the user's general entry."""
        other_project = Project.objects.create(name='Previous Project', slug='previous-project')
        ProjectMembership.objects.create(user=self.user, project=other_project, role='admin')
        other_general_kultur = Crop.objects.create(
            name='Lettuce',
            crop_species=self.species,
            growth_duration_days=99,
            harvest_duration_days=99,
            project=other_project,
        )
        existing_general = PublicCrop.objects.create(
            name='Lettuce',
            variety='',
            status='published',
            crop_species=self.species,
            created_by=self.user,
            source_project=other_project,
            source_project_crop=other_general_kultur,
            growth_duration_days=99,
            harvest_duration_days=99,
        )
        general_kultur = self._create_general_kultur()

        response = self.publish_current_crop()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(PublicCrop.objects.filter(variety='').count(), 1)
        existing_general.refresh_from_db()
        self.assertEqual(existing_general.source_project_crop, other_general_kultur)

        rows = {
            row['id']: row
            for row in self.client.get('/openfarmplanner/api/crops/').data['results']
        }
        general_row = rows[general_kultur.id]
        self.assertEqual(general_row['owned_public_crop_id'], existing_general.id)
        self.assertEqual(general_row['owned_public_crop_role'], 'contributor')
        self.assertIsNone(general_row['public_publish_blocked_reason'])

    def test_publishing_general_kultur_updates_existing_owned_general_public_entry(
        self,
    ):
        other_project = Project.objects.create(name='Previous Project', slug='previous-project')
        ProjectMembership.objects.create(user=self.user, project=other_project, role='admin')
        other_general_kultur = Crop.objects.create(
            name='Lettuce',
            crop_species=self.species,
            growth_duration_days=99,
            harvest_duration_days=99,
            project=other_project,
        )
        existing_general = PublicCrop.objects.create(
            name='Lettuce',
            variety='',
            status='published',
            crop_species=self.species,
            created_by=self.user,
            source_project=other_project,
            source_project_crop=other_general_kultur,
            growth_duration_days=99,
            harvest_duration_days=99,
            version=3,
        )
        general_kultur = self._create_general_kultur(
            growth_duration_days=60,
            harvest_duration_days=30,
        )

        response = self.client.post(
            f'/openfarmplanner/api/crops/{general_kultur.id}/publish-public/',
            {
                'accepted_public_library_terms': True,
                'crop_species_id': self.species.id,
                'original_language_code': 'en',
                'publish_as_general': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['operation'], 'updated')
        self.assertEqual(response.data['public_crop']['id'], existing_general.id)
        self.assertEqual(PublicCrop.objects.filter(variety='').count(), 1)
        existing_general.refresh_from_db()
        self.assertEqual(existing_general.source_project_crop, general_kultur)
        self.assertEqual(existing_general.growth_duration_days, 60)
        self.assertEqual(existing_general.version, 4)

    def _create_general_kultur(self, **overrides) -> Crop:
        return Crop.objects.create(
            name=overrides.pop('name', 'Lettuce'),
            crop_species=self.species,
            growth_duration_days=overrides.pop('growth_duration_days', 60),
            harvest_duration_days=overrides.pop('harvest_duration_days', 30),
            project=self.project,
            **overrides,
        )

    def test_publishing_a_sorte_records_the_general_kultur_as_the_entry_owner(self):
        """The species-level entry belongs to the Kultur, not to the Sorte.

        Publishing a Sorte creates the species-level entry alongside it. If that
        entry kept pointing at the Sorte, the Kultur the user then sees as
        published would not be recognized as published at all and its menu would
        keep offering "publish" instead of "update library".
        """
        general_kultur = self._create_general_kultur()

        response = self.publish_current_crop()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        general_public_crop = PublicCrop.objects.get(variety='')
        self.assertEqual(general_public_crop.source_project_crop, general_kultur)
        self.assertEqual(general_public_crop.source_project, self.project)
        self.assertEqual(
            PublicCrop.objects.get(variety='Bijella').source_project_crop,
            self.crop,
        )

    def test_publishing_a_sorte_keeps_the_general_kultur_name_for_the_species_entry(self):
        general_kultur = self._create_general_kultur(name='t')
        self.crop.name = 'PublishCopy 1787901718647'
        self.crop.save(update_fields=['name', 'name_normalized', 'updated_at'])

        response = self.publish_current_crop()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        general_public_crop = PublicCrop.objects.get(variety='')
        self.assertEqual(general_public_crop.name, 't')
        self.assertEqual(general_public_crop.source_project_crop, general_kultur)
        self.assertEqual(
            PublicCrop.objects.get(variety='Bijella').name,
            'PublishCopy 1787901718647',
        )

    def test_publishing_a_sorte_without_a_general_kultur_keeps_the_sorte_as_owner(self):
        """Nothing else can own the entry when the project has no general Kultur."""
        self.publish_current_crop()

        self.assertEqual(PublicCrop.objects.get(variety='').source_project_crop, self.crop)

    def test_publishing_a_sorte_keeps_species_invariant_fields_off_the_variety_entry(self):
        """crop_family / nutrient_demand describe the species: the Sorte's public
        variety entry never carries them, and the species-level entry takes them
        from the project's general Kultur, not from the Sorte."""
        general_kultur = self._create_general_kultur(
            crop_family='Asteraceae', nutrient_demand='high',
        )
        # A stale value on the Sorte itself must be ignored on publish.
        Crop.objects.filter(pk=self.crop.pk).update(crop_family='Wrong', nutrient_demand='low')

        response = self.publish_current_crop()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        variety_entry = PublicCrop.objects.get(variety='Bijella')
        self.assertEqual(variety_entry.crop_family, '')
        self.assertEqual(variety_entry.nutrient_demand, '')

        general_entry = PublicCrop.objects.get(variety='')
        self.assertEqual(general_entry.source_project_crop, general_kultur)
        self.assertEqual(general_entry.crop_family, 'Asteraceae')
        self.assertEqual(general_entry.nutrient_demand, 'high')

    def test_updating_a_sorte_entry_does_not_wipe_a_curated_species_invariant_value(self):
        """The project-side update omits these fields, so a value curated on the
        public variety entry survives."""
        self._create_general_kultur(crop_family='Asteraceae')
        self.publish_current_crop()
        variety_entry = PublicCrop.objects.get(variety='Bijella')
        PublicCrop.objects.filter(pk=variety_entry.pk).update(
            crop_family='Curated', nutrient_demand='medium',
        )

        self.crop.notes = 'Local edit to trigger an update'
        self.crop.save()
        response = self.publish_current_crop()
        self.assertEqual(response.data['operation'], 'updated')

        variety_entry.refresh_from_db()
        self.assertEqual(variety_entry.crop_family, 'Curated')
        self.assertEqual(variety_entry.nutrient_demand, 'medium')

    def test_general_kultur_published_through_a_sorte_offers_a_library_update(self):
        """The menu state the frontend derives must match a directly published Kultur."""
        general_kultur = self._create_general_kultur()
        self.publish_current_crop()

        rows = {row['id']: row for row in self.client.get('/openfarmplanner/api/crops/').data['results']}
        general_row = rows[general_kultur.id]
        general_public_crop = PublicCrop.objects.get(variety='')
        self.assertEqual(general_row['owned_public_crop_id'], general_public_crop.id)
        self.assertEqual(general_row['owned_public_crop_role'], 'contributor')
        # The entry carries the Sorte's values, so the Kultur still has
        # something of its own to contribute and the action stays enabled.
        self.assertIsNone(general_row['public_publish_blocked_reason'])

    def test_general_kultur_published_through_a_sorte_reports_no_local_changes(self):
        """With identical values there is nothing to contribute, exactly as for a Sorte."""
        # Same values as the Sorte the entry was published from, so the
        # published fields of both sides match.
        general_kultur = self._create_general_kultur(
            growth_duration_days=self.crop.growth_duration_days,
            harvest_duration_days=self.crop.harvest_duration_days,
            notes=self.crop.notes,
            display_color=self.crop.display_color,
        )
        self.publish_current_crop()

        rows = {row['id']: row for row in self.client.get('/openfarmplanner/api/crops/').data['results']}
        self.assertEqual(rows[general_kultur.id]['public_publish_blocked_reason'], 'no_local_changes')

    def test_sorte_that_only_inherits_timing_reports_no_local_changes(self):
        """A Sorte whose timing comes from its general Kultur has nothing extra to
        contribute after publishing: the published entry already carries the
        resolved values, so the detail view shows the "Aktuell" badge, not a
        "Bibliothek aktualisieren" button."""
        self._create_general_kultur(
            growth_duration_days=50,
            harvest_duration_days=20,
            notes=self.crop.notes,
            display_color=self.crop.display_color,
        )
        self.crop.growth_duration_days = None
        self.crop.harvest_duration_days = None
        self.crop.save()
        self.publish_current_crop()

        rows = {row['id']: row for row in self.client.get('/openfarmplanner/api/crops/').data['results']}
        self.assertEqual(rows[self.crop.id]['public_publish_blocked_reason'], 'no_local_changes')

    def test_publishing_the_general_kultur_updates_the_entry_created_by_the_sorte(self):
        general_kultur = self._create_general_kultur()
        self.publish_current_crop()
        general_public_crop = PublicCrop.objects.get(variety='')

        response = self.client.post(
            f'/openfarmplanner/api/crops/{general_kultur.id}/publish-public/',
            {
                'accepted_public_library_terms': True,
                'crop_species_id': self.species.id,
                'original_language_code': 'en',
                'publish_as_general': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['operation'], 'updated')
        self.assertEqual(PublicCrop.objects.filter(variety='').count(), 1)
        general_public_crop.refresh_from_db()
        self.assertEqual(general_public_crop.growth_duration_days, 60)
        self.assertEqual(general_public_crop.version, 2)

    def test_publishing_one_sorte_keeps_the_local_kultur_group_together(self):
        """Publishing must link the whole Kultur group, not fork off the published Sorte.

        A project's Kultur groups its Sorten by ``crop_species`` as soon as one
        row has one, and by name while none has. Linking only the published
        Sorte would therefore leave the general Kultur and the unpublished
        Sorten behind as a second Kultur of the same name.
        """
        species = CropSpecies.objects.create(name='Raphanus sativus')
        kultur = Crop.objects.create(
            name='Radish',
            variety='',
            project=self.project,
            growth_duration_days=28,
            harvest_duration_days=14,
        )
        published_sorte = Crop.objects.create(
            name='Radish',
            variety='Cherry Belle',
            project=self.project,
            growth_duration_days=28,
            harvest_duration_days=14,
        )
        unpublished_sorte = Crop.objects.create(
            name='Radish',
            variety='French Breakfast',
            project=self.project,
            growth_duration_days=30,
            harvest_duration_days=14,
        )

        response = self.client.post(
            f'/openfarmplanner/api/crops/{published_sorte.id}/publish-public/',
            {
                'accepted_public_library_terms': True,
                'crop_species_id': species.id,
                'original_language_code': 'en',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        radish_crops = Crop.objects.filter(project=self.project, name='Radish')
        self.assertEqual(radish_crops.count(), 3)
        self.assertEqual(radish_crops.filter(variety='').count(), 1)
        # One Kultur, not two: every row of the group resolves to the same
        # species, so the crop tree keeps showing a single "Radish" node.
        self.assertEqual({crop.crop_species_id for crop in radish_crops}, {species.id})
        published_sorte.refresh_from_db()
        unpublished_sorte.refresh_from_db()
        self.assertEqual(get_general_crop(published_sorte), kultur)
        self.assertEqual(get_general_crop(unpublished_sorte), kultur)

    def test_linking_a_sorte_to_a_public_entry_keeps_the_local_kultur_group_together(self):
        species = CropSpecies.objects.create(name='Cucurbita pepo')
        public_entry = PublicCrop.objects.create(
            name='Zucchini',
            variety='Black Beauty',
            status='published',
            crop_species=species,
            created_by=self.user,
            growth_duration_days=50,
            harvest_duration_days=40,
        )
        kultur = Crop.objects.create(name='Zucchini', variety='', project=self.project)
        linked_sorte = Crop.objects.create(
            name='Zucchini', variety='Black Beauty', project=self.project,
        )
        other_sorte = Crop.objects.create(
            name='Zucchini', variety='Costata Romanesco', project=self.project,
        )

        response = self.client.post(
            f'/openfarmplanner/api/crops/{linked_sorte.id}/link-public-crop/',
            {'public_crop_id': public_entry.id},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        zucchini_crops = Crop.objects.filter(project=self.project, name='Zucchini')
        self.assertEqual(zucchini_crops.count(), 3)
        self.assertEqual({crop.crop_species_id for crop in zucchini_crops}, {species.id})
        linked_sorte.refresh_from_db()
        other_sorte.refresh_from_db()
        self.assertEqual(get_general_crop(linked_sorte), kultur)
        self.assertEqual(get_general_crop(other_sorte), kultur)

    def test_publish_preview_reports_stale_general_crop_notice(self):
        general = PublicCrop.objects.create(
            name='Lettuce',
            variety='',
            status='published',
            crop_species=self.species,
            created_by=self.user,
            growth_duration_days=10,
            harvest_duration_days=10,
        )
        PublicCrop.objects.filter(pk=general.pk).update(updated_at=timezone.now() - timedelta(days=800))

        response = self.client.get(
            f'/openfarmplanner/api/crops/{self.crop.id}/publish-public/preview/',
            {'crop_species_id': self.species.id, 'original_language_code': 'en'},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        notice = response.data['general_crop_notice']
        self.assertIsNotNone(notice)
        self.assertEqual(notice['public_crop_id'], general.id)
        self.assertTrue(notice['is_stale'])
        self.assertFalse(notice['is_incomplete'])

    def test_publish_preview_reports_incomplete_general_crop_notice(self):
        general = PublicCrop.objects.create(
            name='Lettuce',
            variety='',
            status='published',
            crop_species=self.species,
            created_by=self.user,
            growth_duration_days=None,
            harvest_duration_days=None,
        )

        response = self.client.get(
            f'/openfarmplanner/api/crops/{self.crop.id}/publish-public/preview/',
            {'crop_species_id': self.species.id, 'original_language_code': 'en'},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        notice = response.data['general_crop_notice']
        self.assertIsNotNone(notice)
        self.assertEqual(notice['public_crop_id'], general.id)
        self.assertTrue(notice['is_incomplete'])
        self.assertFalse(notice['is_stale'])

    def test_publish_preview_reports_no_general_crop_notice_when_up_to_date(self):
        PublicCrop.objects.create(
            name='Lettuce',
            variety='',
            status='published',
            crop_species=self.species,
            created_by=self.user,
            growth_duration_days=50,
            harvest_duration_days=20,
        )

        response = self.client.get(
            f'/openfarmplanner/api/crops/{self.crop.id}/publish-public/preview/',
            {'crop_species_id': self.species.id, 'original_language_code': 'en'},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data['general_crop_notice'])

    def test_publish_preview_reports_no_general_crop_notice_when_no_general_entry_exists(self):
        response = self.client.get(
            f'/openfarmplanner/api/crops/{self.crop.id}/publish-public/preview/',
            {'crop_species_id': self.species.id, 'original_language_code': 'en'},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data['general_crop_notice'])

    def test_public_crop_list_filters_by_crop_species(self):
        other_species = CropSpecies.objects.create(name='Carrot')
        PublicCrop.objects.create(
            name='Lettuce', variety='Bijella', status='published',
            crop_species=self.species, created_by=self.user,
        )
        PublicCrop.objects.create(
            name='Carrot', variety='Mokum', status='published',
            crop_species=other_species, created_by=self.user,
        )

        response = self.client.get('/openfarmplanner/api/public-crops/', {'crop_species': self.species.id})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        names = [item['variety'] for item in response.data['results']]
        self.assertEqual(names, ['Bijella'])

    def test_public_crop_api_hides_entries_under_rejected_species(self):
        rejected_species = CropSpecies.objects.create(
            name='Rejected bean', status=CropSpecies.STATUS_REJECTED,
        )
        hidden = PublicCrop.objects.create(
            name='Rejected bean', variety='Test', status='published',
            crop_species=rejected_species, created_by=self.user,
        )
        visible = PublicCrop.objects.create(
            name='Lettuce', variety='Bijella', status='published',
            crop_species=self.species, created_by=self.user,
        )

        list_response = self.client.get('/openfarmplanner/api/public-crops/')
        detail_response = self.client.get(f'/openfarmplanner/api/public-crops/{hidden.id}/')

        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        ids = {item['id'] for item in list_response.data['results']}
        self.assertIn(visible.id, ids)
        self.assertNotIn(hidden.id, ids)
        self.assertEqual(detail_response.status_code, status.HTTP_404_NOT_FOUND)

    def test_import_public_crop_creates_project_local_copy(self):
        public_crop = PublicCrop.objects.create(
            name='Bean',
            variety='Canadian Wonder',
            status='published',
            created_by=self.user,
            growth_duration_days=70,
            harvest_duration_days=30,
            notes='Public notes',
            seed_packages=[{'size_value': 15.0, 'size_unit': 'g'}],
        )

        response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['operation'], 'created')
        imported = Crop.objects.get(id=response.data['crop']['id'])
        self.assertEqual(imported.project, self.project)
        self.assertEqual(imported.source_public_crop, public_crop)
        self.assertEqual(imported.origin_type, Crop.ORIGIN_IMPORTED)
        self.assertFalse(imported.is_modified_from_source)
        self.assertEqual(imported.seed_packages.count(), 1)
        self.assertEqual(float(imported.seed_packages.first().size_value), 15.0)

    def test_import_does_not_overwrite_the_project_seed_safety_margin(self):
        public_crop = PublicCrop.objects.create(
            name='Lettuce',
            variety='Bijella',
            status='published',
            crop_species=self.species,
            created_by=self.user,
            growth_duration_days=70,
        )
        self.crop.source_public_crop = public_crop
        self.crop.source_public_version = public_crop.version
        self.crop.sowing_calculation_safety_percent = 15
        self.crop.save()

        response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/import/',
            {'mode': 'update'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.crop.refresh_from_db()
        self.assertEqual(self.crop.growth_duration_days, 70)
        self.assertEqual(self.crop.sowing_calculation_safety_percent, 15)

    def test_import_variety_public_crop_also_creates_missing_local_general_crop(self):
        bean_species = CropSpecies.objects.create(name='Bean')
        PublicCrop.objects.create(
            name='Bean',
            variety='',
            status='published',
            created_by=self.user,
            crop_species=bean_species,
            crop_family='Fabaceae',
            growth_duration_days=110,
        )
        variety_public_crop = PublicCrop.objects.create(
            name='Bean',
            variety='Canadian Wonder',
            status='published',
            created_by=self.user,
            crop_species=bean_species,
            crop_family='Fabaceae',
            growth_duration_days=110,
        )

        response = self.client.post(f'/openfarmplanner/api/public-crops/{variety_public_crop.id}/import/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        general = Crop.objects.get(project=self.project, crop_species=bean_species, variety='')
        self.assertEqual(general.crop_family, 'Fabaceae')
        self.assertEqual(general.growth_duration_days, 110)
        self.assertEqual(general.origin_type, Crop.ORIGIN_IMPORTED)

    def test_import_variety_public_crop_does_not_touch_existing_local_general_crop(self):
        bean_species = CropSpecies.objects.create(name='Bean')
        PublicCrop.objects.create(
            name='Bean', variety='', status='published', created_by=self.user,
            crop_species=bean_species, crop_family='Fabaceae',
        )
        variety_public_crop = PublicCrop.objects.create(
            name='Bean', variety='Canadian Wonder', status='published', created_by=self.user,
            crop_species=bean_species, crop_family='Fabaceae',
        )
        existing_general = Crop.objects.create(
            name='Bean', variety='', crop_species=bean_species, crop_family='Custom', project=self.project,
        )

        response = self.client.post(f'/openfarmplanner/api/public-crops/{variety_public_crop.id}/import/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(Crop.objects.filter(project=self.project, crop_species=bean_species, variety='').count(), 1)
        existing_general.refresh_from_db()
        self.assertEqual(existing_general.crop_family, 'Custom')

    def test_public_crop_list_shows_no_import_status_when_not_yet_imported(self):
        PublicCrop.objects.create(
            name='Bean', variety='Canadian Wonder', status='published', created_by=self.user,
        )

        response = self.client.get('/openfarmplanner/api/public-crops/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        entry = next(row for row in response.data['results'] if row['name'] == 'Bean')
        self.assertIsNone(entry['project_import_status'])

    def test_public_crop_detail_shows_import_status_after_import(self):
        public_crop = PublicCrop.objects.create(
            name='Bean', variety='Canadian Wonder', status='published', created_by=self.user,
        )
        import_response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')
        imported_id = import_response.data['crop']['id']

        detail_response = self.client.get(f'/openfarmplanner/api/public-crops/{public_crop.id}/')

        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)
        self.assertEqual(detail_response.data['project_import_status'], {
            'crop_id': imported_id,
            'crop_name': 'Bean (Canadian Wonder)',
            'is_modified_from_source': False,
        })

    def test_public_crop_import_status_flags_local_modification(self):
        public_crop = PublicCrop.objects.create(
            name='Bean', variety='Canadian Wonder', status='published', created_by=self.user,
            notes='Public notes',
        )
        import_response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')
        imported_id = import_response.data['crop']['id']
        Crop.objects.filter(id=imported_id).update(notes='Locally edited notes')
        imported = Crop.objects.get(id=imported_id)
        imported.notes = 'Locally edited again'
        imported.save()

        detail_response = self.client.get(f'/openfarmplanner/api/public-crops/{public_crop.id}/')

        self.assertTrue(detail_response.data['project_import_status']['is_modified_from_source'])

    def test_public_crop_import_status_is_project_scoped(self):
        public_crop = PublicCrop.objects.create(
            name='Bean', variety='Canadian Wonder', status='published', created_by=self.user,
        )
        self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')

        other_project = Project.objects.create(name='Other Project', slug='other-project')
        ProjectMembership.objects.create(user=self.user, project=other_project, role='admin')
        self.client.defaults['HTTP_X_PROJECT_ID'] = str(other_project.id)

        detail_response = self.client.get(f'/openfarmplanner/api/public-crops/{public_crop.id}/')

        self.assertIsNone(detail_response.data['project_import_status'])

    def test_public_crop_exposes_imported_crops_count_across_projects(self):
        public_crop = PublicCrop.objects.create(
            name='Bean', variety='Canadian Wonder', status='published', created_by=self.user,
        )
        self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')

        other_project = Project.objects.create(name='Other Project', slug='other-project')
        ProjectMembership.objects.create(user=self.user, project=other_project, role='admin')
        self.client.defaults['HTTP_X_PROJECT_ID'] = str(other_project.id)
        self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')

        detail_response = self.client.get(f'/openfarmplanner/api/public-crops/{public_crop.id}/')
        self.assertEqual(detail_response.data['imported_crops_count'], 2)

        list_response = self.client.get('/openfarmplanner/api/public-crops/')
        entry = next(row for row in list_response.data['results'] if row['id'] == public_crop.id)
        self.assertEqual(entry['imported_crops_count'], 2)

    def test_public_crop_edit_response_reports_imported_crops_count(self):
        self.user.is_staff = True
        self.user.save(update_fields=['is_staff'])
        public_crop = PublicCrop.objects.create(
            name='Bean', variety='Canadian Wonder', status='published', created_by=self.user, version=1,
        )
        self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')

        response = self.client.patch(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/',
            {'base_version': 1, 'variety': 'Canadian Wonder II'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['imported_crops_count'], 1)

    def test_import_public_crop_keeps_species_translation_link_and_serves_english_name(self):
        species = CropSpecies.objects.create(name='Localized Import Species 1')
        CropSpeciesTranslation.objects.create(species=species, language_code='de', common_name='Ackerbohne')
        CropSpeciesTranslation.objects.create(species=species, language_code='en', common_name='Broad bean')
        public_crop = PublicCrop.objects.create(
            name='Ackerbohne',
            variety='Hangdown',
            status='published',
            crop_species=species,
            created_by=self.user,
            notes='Deutsche Beschreibung',
            original_language_code='de',
        )
        PublicCropTranslation.objects.create(
            public_crop=public_crop,
            language_code='de',
            description='Deutsche Beschreibung',
        )
        PublicCropTranslation.objects.create(
            public_crop=public_crop,
            language_code='en',
            description='English description',
        )

        response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/import/',
            {},
            format='json',
            HTTP_ACCEPT_LANGUAGE='en',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        imported = Crop.objects.select_related('crop_species', 'source_public_crop').get(id=response.data['crop']['id'])
        self.assertEqual(imported.name, 'Ackerbohne')
        self.assertEqual(imported.crop_species, species)
        self.assertEqual(imported.source_public_crop, public_crop)
        self.assertEqual(imported.crop_species.translations_by_language(), {
            'de': 'Ackerbohne',
            'en': 'Broad bean',
        })
        self.assertEqual(imported.source_public_crop.descriptions_by_language(), {
            'de': 'Deutsche Beschreibung',
            'en': 'English description',
        })
        self.assertEqual(response.data['crop']['crop_display_name'], 'Broad bean')
        self.assertEqual(response.data['crop']['crop_display_language_code'], 'en')
        self.assertEqual(response.data['crop']['description_language_code'], 'de')
        self.assertEqual(response.data['crop']['crop_species_translations'], {
            'de': 'Ackerbohne',
            'en': 'Broad bean',
        })

        detail_response = self.client.get(
            f'/openfarmplanner/api/crops/{imported.id}/',
            HTTP_ACCEPT_LANGUAGE='en',
        )

        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)
        self.assertEqual(detail_response.data['name'], 'Ackerbohne')
        self.assertEqual(detail_response.data['crop_display_name'], 'Broad bean')
        self.assertEqual(detail_response.data['crop_display_language_code'], 'en')
        self.assertEqual(detail_response.data['description_language_code'], 'de')

    def test_imported_crop_detail_serves_german_name_when_requested(self):
        species = CropSpecies.objects.create(name='Localized Import Species 2')
        CropSpeciesTranslation.objects.create(species=species, language_code='de', common_name='Ackerbohne')
        CropSpeciesTranslation.objects.create(species=species, language_code='en', common_name='Broad bean')
        public_crop = PublicCrop.objects.create(
            name='Ackerbohne',
            variety='Hangdown',
            status='published',
            crop_species=species,
            created_by=self.user,
            original_language_code='de',
        )
        import_response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')
        imported_id = import_response.data['crop']['id']

        detail_response = self.client.get(
            f'/openfarmplanner/api/crops/{imported_id}/',
            HTTP_ACCEPT_LANGUAGE='de',
        )

        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)
        self.assertEqual(detail_response.data['crop_display_name'], 'Ackerbohne')
        self.assertEqual(detail_response.data['crop_display_language_code'], 'de')
        self.assertIsNone(detail_response.data['description_language_code'])

    def test_imported_crop_detail_reports_original_notes_language(self):
        species = CropSpecies.objects.create(name='Localized Import Species With Notes')
        CropSpeciesTranslation.objects.create(
            species=species,
            language_code='de',
            common_name='Ackerbohne',
        )
        public_crop = PublicCrop.objects.create(
            name='Ackerbohne',
            variety='Hangdown',
            notes='Deutsche Beschreibung',
            status='published',
            crop_species=species,
            created_by=self.user,
            original_language_code='de',
        )
        PublicCropTranslation.objects.create(
            public_crop=public_crop,
            language_code='de',
            description='Deutsche Beschreibung',
        )
        import_response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/import/',
            {},
            format='json',
        )
        imported_id = import_response.data['crop']['id']

        detail_response = self.client.get(
            f'/openfarmplanner/api/crops/{imported_id}/',
            HTTP_ACCEPT_LANGUAGE='de',
        )

        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)
        self.assertEqual(detail_response.data['notes'], 'Deutsche Beschreibung')
        self.assertEqual(detail_response.data['description_language_code'], 'de')

    def test_imported_crop_detail_falls_back_when_requested_translation_is_missing(self):
        species = CropSpecies.objects.create(name='Localized Import Species 3')
        CropSpeciesTranslation.objects.create(species=species, language_code='de', common_name='Ackerbohne')
        public_crop = PublicCrop.objects.create(
            name='Ackerbohne',
            variety='Hangdown',
            status='published',
            crop_species=species,
            created_by=self.user,
            original_language_code='de',
        )
        import_response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')
        imported_id = import_response.data['crop']['id']

        detail_response = self.client.get(
            f'/openfarmplanner/api/crops/{imported_id}/',
            HTTP_ACCEPT_LANGUAGE='en',
        )

        self.assertEqual(detail_response.status_code, status.HTTP_200_OK)
        self.assertEqual(detail_response.data['crop_display_name'], 'Ackerbohne')
        self.assertEqual(detail_response.data['crop_display_language_code'], 'de')

    def test_editing_imported_crop_does_not_change_public_crop(self):
        public_crop = PublicCrop.objects.create(
            name='Carrot',
            variety='Mokum',
            status='published',
            created_by=self.user,
            growth_duration_days=90,
            harvest_duration_days=14,
        )
        import_response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')
        imported_id = import_response.data['crop']['id']

        detail_response = self.client.get(f'/openfarmplanner/api/crops/{imported_id}/')
        payload = dict(detail_response.data)
        payload['growth_duration_days'] = 120
        payload['cultivation_types'] = ['pre_cultivation']
        payload['cultivation_type'] = 'pre_cultivation'
        payload['supplier'] = None
        payload['supplier_id'] = None
        payload.pop('image_file', None)

        update_response = self.client.put(
            f'/openfarmplanner/api/crops/{imported_id}/',
            payload,
            format='json',
        )

        self.assertEqual(update_response.status_code, status.HTTP_200_OK)
        public_crop.refresh_from_db()
        imported = Crop.objects.get(id=imported_id)
        self.assertEqual(public_crop.growth_duration_days, 90)
        self.assertEqual(imported.growth_duration_days, 120)
        self.assertEqual(imported.origin_type, Crop.ORIGIN_IMPORTED)
        self.assertTrue(imported.is_modified_from_source)

    def test_editing_imported_crop_normalizes_long_origin_type_without_db_error(self):
        public_crop = PublicCrop.objects.create(
            name='Pepper',
            variety='Red Flame',
            status='published',
            created_by=self.user,
            growth_duration_days=85,
            harvest_duration_days=20,
        )
        import_response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')
        imported_id = import_response.data['crop']['id']

        detail_response = self.client.get(f'/openfarmplanner/api/crops/{imported_id}/')
        payload = dict(detail_response.data)
        payload['notes'] = 'Changed locally'
        payload['cultivation_types'] = ['pre_cultivation']
        payload['cultivation_type'] = 'pre_cultivation'
        payload['origin_type'] = 'imported_from_public_library_template'
        payload['supplier'] = None
        payload['supplier_id'] = None
        payload.pop('image_file', None)

        update_response = self.client.put(f'/openfarmplanner/api/crops/{imported_id}/', payload, format='json')

        self.assertEqual(update_response.status_code, status.HTTP_200_OK)
        imported = Crop.objects.get(id=imported_id)
        self.assertEqual(imported.origin_type, Crop.ORIGIN_IMPORTED)
        self.assertTrue(imported.is_modified_from_source)

    def test_editing_imported_crop_with_supplier_name_and_null_supplier_id_keeps_supplier_null(self):
        public_crop = PublicCrop.objects.create(
            name='Lettuce',
            variety='Bijella',
            status='published',
            created_by=self.user,
        )
        import_response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')
        imported_id = import_response.data['crop']['id']

        # Public crops no longer carry supplier data, so seed this
        # pre-existing legacy text value directly to test that a PUT with an
        # explicit null supplier_id (and a supplier_name that is therefore
        # ignored) does not wipe it out.
        Crop.objects.filter(id=imported_id).update(seed_supplier='Reinsaat')

        detail_response = self.client.get(f'/openfarmplanner/api/crops/{imported_id}/')
        payload = dict(detail_response.data)
        payload['notes'] = 'Local edit'
        payload['supplier_id'] = None
        payload['supplier_name'] = 'Reinsaat'
        payload['cultivation_types'] = ['pre_cultivation']
        payload['cultivation_type'] = 'pre_cultivation'
        payload.pop('image_file', None)

        update_response = self.client.put(f'/openfarmplanner/api/crops/{imported_id}/', payload, format='json')

        self.assertEqual(update_response.status_code, status.HTTP_200_OK)
        imported = Crop.objects.get(id=imported_id)
        self.assertIsNone(imported.supplier_id)
        self.assertEqual(imported.seed_supplier, 'Reinsaat')

    def test_reimporting_an_unchanged_import_is_a_no_op(self):
        public_crop = PublicCrop.objects.create(
            name='Carrot',
            variety='Nantes',
            status='published',
            created_by=self.user,
            growth_duration_days=70,
        )
        first_response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')
        imported_id = first_response.data['crop']['id']
        revision_count_after_first_import = EntityRevision.objects.filter(entity_type='crop', object_id=imported_id).count()

        second_response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')

        self.assertEqual(second_response.status_code, status.HTTP_200_OK)
        self.assertEqual(second_response.data['operation'], 'unchanged')
        self.assertEqual(second_response.data['crop']['id'], imported_id)
        self.assertEqual(Crop.objects.filter(source_public_crop=public_crop).count(), 1)
        self.assertEqual(
            EntityRevision.objects.filter(entity_type='crop', object_id=imported_id).count(),
            revision_count_after_first_import,
        )

    def test_reimporting_after_library_update_with_no_local_changes_syncs_automatically(self):
        public_crop = PublicCrop.objects.create(
            name='Carrot',
            variety='Nantes',
            status='published',
            created_by=self.user,
            growth_duration_days=70,
        )
        first_response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')
        imported_id = first_response.data['crop']['id']
        revision_count_after_first_import = EntityRevision.objects.filter(entity_type='crop', object_id=imported_id).count()

        public_crop.growth_duration_days = 80
        public_crop.version = 2
        public_crop.save(update_fields=['growth_duration_days', 'version'])

        second_response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')

        self.assertEqual(second_response.status_code, status.HTTP_200_OK)
        self.assertEqual(second_response.data['operation'], 'updated')
        self.assertEqual(second_response.data['crop']['id'], imported_id)
        self.assertEqual(Crop.objects.filter(source_public_crop=public_crop).count(), 1)
        imported = Crop.objects.get(id=imported_id)
        self.assertEqual(imported.growth_duration_days, 80)
        self.assertEqual(imported.source_public_version, 2)
        self.assertFalse(imported.is_modified_from_source)
        self.assertEqual(
            EntityRevision.objects.filter(entity_type='crop', object_id=imported_id).count(),
            revision_count_after_first_import + 1,
        )

    def test_reimporting_after_version_bump_with_no_compared_change_is_a_no_op(self):
        """A library version bump that touches only a non-compared field (here
        the project-local ``display_color``) is not a real update: the auto
        re-import must report ``unchanged`` and record no revision, matching
        ``has_pending_public_crop_update`` -- the detail badge and the re-import
        decision must never disagree over a version-only bump."""
        public_crop = PublicCrop.objects.create(
            name='Carrot',
            variety='Nantes',
            status='published',
            created_by=self.user,
            growth_duration_days=70,
        )
        first_response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')
        imported_id = first_response.data['crop']['id']
        revision_count_after_first_import = EntityRevision.objects.filter(entity_type='crop', object_id=imported_id).count()

        public_crop.display_color = '#123456'
        public_crop.version = 2
        public_crop.save(update_fields=['display_color', 'version'])

        second_response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')

        self.assertEqual(second_response.status_code, status.HTTP_200_OK)
        self.assertEqual(second_response.data['operation'], 'unchanged')
        self.assertEqual(second_response.data['crop']['id'], imported_id)
        self.assertEqual(Crop.objects.filter(source_public_crop=public_crop).count(), 1)
        imported = Crop.objects.get(id=imported_id)
        self.assertFalse(imported.is_modified_from_source)
        self.assertEqual(
            EntityRevision.objects.filter(entity_type='crop', object_id=imported_id).count(),
            revision_count_after_first_import,
        )

    def test_reimporting_with_local_changes_requires_confirmation(self):
        public_crop = PublicCrop.objects.create(
            name='Carrot',
            variety='Nantes',
            status='published',
            created_by=self.user,
            growth_duration_days=70,
        )
        first_response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')
        imported_id = first_response.data['crop']['id']
        imported = Crop.objects.get(id=imported_id)
        imported.notes = 'Local edit'
        imported.save()
        self.assertTrue(Crop.objects.get(id=imported_id).is_modified_from_source)

        response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['code'], 'import_requires_confirmation')
        self.assertEqual(response.data['existing_crop_id'], imported_id)
        self.assertEqual(Crop.objects.filter(source_public_crop=public_crop).count(), 1)

    def test_reimporting_after_variety_rename_flags_variety_changed_in_confirmation_response(self):
        """A public variety rename propagates through the existing 4-case import model.

        Renaming the linked public entry's variety and then re-importing into a
        locally-modified copy should raise the same confirmation-required
        conflict as any other field change, with `variety_changed` set so the
        frontend can call the identity rename out explicitly.
        """
        self.user.is_staff = True
        self.user.save(update_fields=['is_staff'])
        public_crop = PublicCrop.objects.create(
            name='Carrot', variety='Nantes', status='published', created_by=self.user,
            growth_duration_days=70,
        )
        first_response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')
        imported_id = first_response.data['crop']['id']
        imported = Crop.objects.get(id=imported_id)
        imported.notes = 'Local edit'
        imported.save()

        self.client.patch(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/',
            {'base_version': public_crop.version, 'variety': 'Nantes II'},
            format='json',
        )

        response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['code'], 'import_requires_confirmation')
        self.assertTrue(response.data['variety_changed'])
        self.assertEqual(response.data['existing_variety'], 'Nantes')
        self.assertEqual(response.data['public_variety'], 'Nantes II')

    def _import_and_rename_variety(self, *, variety: str = 'Nantes', renamed_to: str = 'Nantes II'):
        """Publish `variety`, import it into the project, then rename it publicly."""
        self.user.is_staff = True
        self.user.save(update_fields=['is_staff'])
        public_crop = PublicCrop.objects.create(
            name='Carrot', variety=variety, status='published', created_by=self.user,
            growth_duration_days=70,
        )
        import_response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json',
        )
        imported = Crop.objects.get(id=import_response.data['crop']['id'])
        self.client.patch(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/',
            {'base_version': public_crop.version, 'variety': renamed_to},
            format='json',
        )
        public_crop.refresh_from_db()
        return public_crop, imported

    def test_public_update_preview_reports_variety_rename_for_unmodified_copy(self):
        """A public variety rename must surface on the private crop as a pending update.

        The rename is only ever applied after the user confirms it, so the
        preview is what makes it visible at all — without `variety` in the
        compared field set the copy would keep the old Sorte with no hint.
        """
        _, imported = self._import_and_rename_variety()

        response = self.client.get(f'/openfarmplanner/api/crops/{imported.id}/public-update/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['available'])
        self.assertEqual(response.data['local_version'], 1)
        self.assertEqual(response.data['public_version'], 2)
        self.assertFalse(response.data['has_local_changes'])
        self.assertEqual(
            [change for change in response.data['changes'] if change['field'] == 'variety'],
            [{'field': 'variety', 'local_value': 'Nantes', 'public_value': 'Nantes II'}],
        )
        imported.refresh_from_db()
        self.assertEqual(imported.variety, 'Nantes', 'the preview must not apply anything')

    def test_public_update_preview_flags_local_changes_alongside_the_rename(self):
        _, imported = self._import_and_rename_variety()
        imported.notes = 'Local edit'
        imported.save()

        response = self.client.get(f'/openfarmplanner/api/crops/{imported.id}/public-update/')

        self.assertTrue(response.data['available'])
        self.assertTrue(response.data['has_local_changes'])
        changed_fields = {change['field'] for change in response.data['changes']}
        self.assertIn('variety', changed_fields)
        self.assertIn('notes', changed_fields)

    def test_public_update_preview_reports_nothing_for_a_current_copy(self):
        public_crop = PublicCrop.objects.create(
            name='Carrot', variety='Nantes', status='published', created_by=self.user,
            growth_duration_days=70,
        )
        import_response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json',
        )
        imported_id = import_response.data['crop']['id']

        response = self.client.get(f'/openfarmplanner/api/crops/{imported_id}/public-update/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data, {'available': False})

    def test_a_version_bump_with_no_compared_field_change_is_not_a_pending_update(self):
        """A translation-only edit (or a value the copy already matches) bumps
        the public version but leaves every compared field equal — nothing to
        review, so no notice and the push stays blocked as "no local changes"."""
        public_crop = PublicCrop.objects.create(
            name='Carrot', variety='Nantes', status='published', created_by=self.user,
            growth_duration_days=70, display_color='#123456',
        )
        import_response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json',
        )
        imported = Crop.objects.get(id=import_response.data['crop']['id'])
        PublicCrop.objects.filter(pk=public_crop.pk).update(version=public_crop.version + 1)

        preview = self.client.get(f'/openfarmplanner/api/crops/{imported.id}/public-update/')
        self.assertEqual(preview.data, {'available': False})

        rows = {row['id']: row for row in self.client.get('/openfarmplanner/api/crops/').data['results']}
        self.assertFalse(rows[imported.id]['public_update_available'])
        self.assertFalse(rows[imported.id]['public_update_rejected'])
        self.assertEqual(rows[imported.id]['public_publish_blocked_reason'], 'no_local_changes')

        reject = self.client.post(
            f'/openfarmplanner/api/crops/{imported.id}/public-update/reject/', {}, format='json',
        )
        self.assertEqual(reject.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_display_color_only_difference_is_not_a_pending_update(self):
        """An imported crop always gets an auto colour; a public entry often has
        none, so a colour mismatch alone never announces a library update."""
        public_crop = PublicCrop.objects.create(
            name='Carrot', variety='Danvers', status='published', created_by=self.user,
            growth_duration_days=70,
        )
        import_response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json',
        )
        imported = Crop.objects.get(id=import_response.data['crop']['id'])
        # Bump the version and change *only* the colour.
        PublicCrop.objects.filter(pk=public_crop.pk).update(
            version=public_crop.version + 1, display_color='#abcdef',
        )
        self.assertNotEqual(imported.display_color, '#abcdef')

        preview = self.client.get(f'/openfarmplanner/api/crops/{imported.id}/public-update/')
        self.assertEqual(preview.data, {'available': False})

    def test_crop_list_flags_a_pending_public_update(self):
        _, imported = self._import_and_rename_variety()

        response = self.client.get('/openfarmplanner/api/crops/')

        rows = {row['id']: row for row in response.data['results']}
        self.assertTrue(rows[imported.id]['public_update_available'])
        self.assertFalse(rows[self.crop.id]['public_update_available'])

    def _reject_public_update(self, crop_id: int):
        return self.client.post(
            f'/openfarmplanner/api/crops/{crop_id}/public-update/reject/', {}, format='json',
        )

    def test_rejecting_a_public_update_silences_the_notice_without_touching_the_copy(self):
        _, imported = self._import_and_rename_variety()

        response = self._reject_public_update(imported.id)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data['public_update_available'])
        self.assertTrue(response.data['public_update_rejected'])
        imported.refresh_from_db()
        self.assertEqual(imported.variety, 'Nantes', 'rejecting must not change the local copy')
        self.assertEqual(imported.source_public_version, 1)
        self.assertFalse(imported.is_modified_from_source)

    def test_rejected_update_keeps_the_diff_reachable_for_a_later_change_of_mind(self):
        """The user must be able to reopen the diff without waiting for a new public edit."""
        _, imported = self._import_and_rename_variety()
        self._reject_public_update(imported.id)

        response = self.client.get(f'/openfarmplanner/api/crops/{imported.id}/public-update/')

        self.assertTrue(response.data['available'])
        self.assertTrue(response.data['is_rejected'])
        self.assertEqual(
            [change for change in response.data['changes'] if change['field'] == 'variety'],
            [{'field': 'variety', 'local_value': 'Nantes', 'public_value': 'Nantes II'}],
        )

    def test_a_newer_public_version_surfaces_the_notice_again_after_a_rejection(self):
        public_crop, imported = self._import_and_rename_variety()
        self._reject_public_update(imported.id)

        self.client.patch(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/',
            {'base_version': public_crop.version, 'growth_duration_days': 90},
            format='json',
        )

        response = self.client.get('/openfarmplanner/api/crops/')
        row = {item['id']: item for item in response.data['results']}[imported.id]
        self.assertTrue(row['public_update_available'])
        self.assertFalse(row['public_update_rejected'])

    def test_applying_the_update_clears_an_earlier_rejection(self):
        public_crop, imported = self._import_and_rename_variety()
        self._reject_public_update(imported.id)

        self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/import/',
            {'mode': 'update'},
            format='json',
        )

        imported.refresh_from_db()
        self.assertIsNone(imported.rejected_public_version)

    def test_rejecting_without_a_pending_update_is_a_bad_request(self):
        public_crop = PublicCrop.objects.create(
            name='Carrot', variety='Nantes', status='published', created_by=self.user,
            growth_duration_days=70,
        )
        import_response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json',
        )

        response = self._reject_public_update(import_response.data['crop']['id'])

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['code'], 'no_pending_public_update')

    def test_publish_block_reason_tracks_the_update_decision_states(self):
        public_crop, imported = self._import_and_rename_variety()
        rows = {row['id']: row for row in self.client.get('/openfarmplanner/api/crops/').data['results']}
        self.assertEqual(rows[imported.id]['public_publish_blocked_reason'], 'update_pending')

        self._reject_public_update(imported.id)
        rows = {row['id']: row for row in self.client.get('/openfarmplanner/api/crops/').data['results']}
        self.assertEqual(rows[imported.id]['public_publish_blocked_reason'], 'update_rejected')

        self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/import/',
            {'mode': 'update'},
            format='json',
        )
        rows = {row['id']: row for row in self.client.get('/openfarmplanner/api/crops/').data['results']}
        self.assertEqual(rows[imported.id]['public_publish_blocked_reason'], 'no_local_changes')

        imported.refresh_from_db()
        imported.notes = 'Local edit after aligning'
        imported.save()
        rows = {row['id']: row for row in self.client.get('/openfarmplanner/api/crops/').data['results']}
        self.assertIsNone(rows[imported.id]['public_publish_blocked_reason'])

    def test_manual_crops_are_never_publish_blocked(self):
        response = self.client.get('/openfarmplanner/api/crops/')

        rows = {row['id']: row for row in response.data['results']}
        self.assertIsNone(rows[self.crop.id]['public_publish_blocked_reason'])

    def test_owner_publish_block_reason_tracks_local_changes_without_an_import_link(self):
        """A crop published straight from local data (never imported) has no
        `source_public_crop`, so the block reason must be derived by comparing
        against the owned entry directly instead of the import-lineage fields."""
        self.publish_current_crop()

        rows = {row['id']: row for row in self.client.get('/openfarmplanner/api/crops/').data['results']}
        self.assertEqual(rows[self.crop.id]['public_publish_blocked_reason'], 'no_local_changes')

        self.crop.refresh_from_db()
        self.crop.notes = 'Local edit after publishing'
        self.crop.save()
        rows = {row['id']: row for row in self.client.get('/openfarmplanner/api/crops/').data['results']}
        self.assertIsNone(rows[self.crop.id]['public_publish_blocked_reason'])

    def test_publishing_over_a_rejected_public_version_is_refused(self):
        """The lock exists so a declined public change cannot be silently overwritten."""
        public_crop, imported = self._import_and_rename_variety()
        imported.notes = 'Local edit'
        imported.save()
        self._reject_public_update(imported.id)

        response = self.client.post(
            f'/openfarmplanner/api/crops/{imported.id}/publish-public/',
            {
                'crop_species_id': self.species.id,
                'original_language_code': 'de',
                'accepted_public_library_terms': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['code'], 'public_crop_update_blocked')
        self.assertEqual(response.data['reason'], 'update_rejected')
        public_crop.refresh_from_db()
        self.assertEqual(public_crop.variety, 'Nantes II')

    def test_confirming_the_update_applies_the_variety_rename_to_an_unmodified_copy(self):
        public_crop, imported = self._import_and_rename_variety()

        response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/import/',
            {'mode': 'update'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['operation'], 'updated')
        imported.refresh_from_db()
        self.assertEqual(imported.variety, 'Nantes II')
        self.assertEqual(imported.source_public_version, 2)
        self.assertFalse(imported.is_modified_from_source)
        preview = self.client.get(f'/openfarmplanner/api/crops/{imported.id}/public-update/')
        self.assertFalse(preview.data['available'])

    def test_reimporting_with_mode_update_overwrites_local_changes(self):
        public_crop = PublicCrop.objects.create(
            name='Carrot',
            variety='Nantes',
            status='published',
            created_by=self.user,
            growth_duration_days=70,
        )
        first_response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')
        imported_id = first_response.data['crop']['id']
        imported = Crop.objects.get(id=imported_id)
        imported.notes = 'Local edit'
        imported.save()
        self.assertTrue(Crop.objects.get(id=imported_id).is_modified_from_source)

        response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/import/',
            {'mode': 'update'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['operation'], 'updated')
        self.assertEqual(Crop.objects.filter(source_public_crop=public_crop).count(), 1)
        imported.refresh_from_db()
        self.assertEqual(imported.notes, public_crop.notes)
        self.assertFalse(imported.is_modified_from_source)

    def test_reimporting_with_mode_new_creates_a_uniquely_named_copy(self):
        public_crop = PublicCrop.objects.create(
            name='Carrot',
            variety='Nantes',
            status='published',
            created_by=self.user,
            growth_duration_days=70,
        )
        first_response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')
        imported_id = first_response.data['crop']['id']
        imported = Crop.objects.get(id=imported_id)
        imported.notes = 'Local edit'
        imported.save()

        response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/import/',
            {'mode': 'new'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['operation'], 'created')
        new_crop_id = response.data['crop']['id']
        self.assertNotEqual(new_crop_id, imported_id)
        new_crop = Crop.objects.get(id=new_crop_id)
        self.assertEqual(new_crop.name, 'Carrot (2)')
        self.assertEqual(new_crop.variety, 'Nantes')
        self.assertEqual(Crop.objects.filter(source_public_crop=public_crop).count(), 2)
        # The original, locally-edited crop is untouched.
        imported.refresh_from_db()
        self.assertEqual(imported.notes, 'Local edit')

    def test_public_library_list_requires_authentication(self):
        self.client.force_authenticate(user=None)
        response = self.client.get('/openfarmplanner/api/public-crops/')
        self.assertIn(response.status_code, {status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN})

    def test_public_library_list_returns_matching_results(self):
        PublicCrop.objects.create(name='Tomato', variety='Roma', status='published', created_by=self.user)
        PublicCrop.objects.create(name='Bean', variety='Neckargold', status='published', created_by=self.user)

        response = self.client.get('/openfarmplanner/api/public-crops/?q=Roma')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 1)
        self.assertEqual(response.data['results'][0]['name'], 'Tomato')

    def test_public_crop_serializes_thousand_kernel_weight_as_number_not_string(self):
        public_crop = PublicCrop.objects.create(
            name='Bean',
            variety='Neckargold',
            status='published',
            created_by=self.user,
            thousand_kernel_weight_g=Decimal('472.00'),
        )

        response = self.client.get(f'/openfarmplanner/api/public-crops/{public_crop.id}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['thousand_kernel_weight_g'], 472.0)
        self.assertNotIsInstance(response.data['thousand_kernel_weight_g'], str)

    def test_authenticated_user_can_create_topic_and_reply_on_public_crop(self):
        public_crop = PublicCrop.objects.create(name='Tomato', variety='Roma', status='published', created_by=self.user)

        create_response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/discussion-topics/',
            {'title': 'Growth period', 'body': 'Works well under cover in spring.'},
            format='json',
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED, create_response.data)
        topic = PublicCropDiscussionTopic.objects.get()
        first_comment = topic.comments.get()
        reply_response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/discussion-topics/{topic.id}/comments/',
            {'body': 'Agreed.', 'parent': first_comment.id},
            format='json',
        )

        self.assertEqual(reply_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(PublicCropDiscussionComment.objects.count(), 2)
        self.assertEqual(reply_response.data['parent'], first_comment.id)

    def test_nested_discussion_replies_keep_their_exact_parent(self):
        public_crop = PublicCrop.objects.create(name='Tomato', variety='Roma', status='published', created_by=self.user)
        topic = PublicCropDiscussionTopic.objects.create(public_crop=public_crop, title='Nested replies', created_by=self.user)
        comment_a = PublicCropDiscussionComment.objects.create(topic=topic, body='A', created_by=self.user)

        response_b = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/discussion-topics/{topic.id}/comments/',
            {'body': 'B', 'parent': comment_a.id},
            format='json',
        )
        response_c = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/discussion-topics/{topic.id}/comments/',
            {'body': 'C', 'parent': response_b.data['id']},
            format='json',
        )
        response_d = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/discussion-topics/{topic.id}/comments/',
            {'body': 'D', 'parent': comment_a.id},
            format='json',
        )

        self.assertEqual(response_b.status_code, status.HTTP_201_CREATED, response_b.data)
        self.assertEqual(response_c.status_code, status.HTTP_201_CREATED, response_c.data)
        self.assertEqual(response_d.status_code, status.HTTP_201_CREATED, response_d.data)
        self.assertEqual(response_b.data['parent'], comment_a.id)
        self.assertEqual(response_c.data['parent'], response_b.data['id'])
        self.assertEqual(response_d.data['parent'], comment_a.id)

    def test_discussion_topics_include_activity_preview_and_are_sorted_by_activity(self):
        public_crop = PublicCrop.objects.create(name='Tomato', variety='Roma', status='published', created_by=self.user)
        older_topic = PublicCropDiscussionTopic.objects.create(public_crop=public_crop, title='Older topic', created_by=self.user)
        newer_topic = PublicCropDiscussionTopic.objects.create(public_crop=public_crop, title='Active topic', created_by=self.user)
        now = timezone.now()
        older_comment = PublicCropDiscussionComment.objects.create(topic=older_topic, body='Older preview', created_by=self.user)
        first_newer_comment = PublicCropDiscussionComment.objects.create(topic=newer_topic, body='First active comment', created_by=self.user)
        latest_newer_comment = PublicCropDiscussionComment.objects.create(topic=newer_topic, body='Latest active preview', created_by=self.user)
        PublicCropDiscussionComment.objects.filter(pk=older_comment.pk).update(created_at=now - timedelta(days=2))
        PublicCropDiscussionComment.objects.filter(pk=first_newer_comment.pk).update(created_at=now - timedelta(days=1))
        PublicCropDiscussionComment.objects.filter(pk=latest_newer_comment.pk).update(created_at=now)

        response = self.client.get(f'/openfarmplanner/api/public-crops/{public_crop.id}/discussion-topics/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([topic['title'] for topic in response.data], ['Active topic', 'Older topic'])
        self.assertEqual(response.data[0]['comment_count'], 2)
        self.assertEqual(response.data[0]['last_comment_preview'], 'Latest active preview')
        self.assertIsNotNone(response.data[0]['last_activity_at'])

    def test_discussion_topics_hide_threads_without_visible_comments(self):
        public_crop = PublicCrop.objects.create(name='Tomato', variety='Roma', status='published', created_by=self.user)
        visible_topic = PublicCropDiscussionTopic.objects.create(public_crop=public_crop, title='Visible topic', created_by=self.user)
        deleted_topic = PublicCropDiscussionTopic.objects.create(public_crop=public_crop, title='Deleted topic', created_by=self.user)
        PublicCropDiscussionComment.objects.create(topic=visible_topic, body='Still visible', created_by=self.user)
        PublicCropDiscussionComment.objects.create(
            topic=deleted_topic,
            body='',
            created_by=self.user,
            deleted_at=timezone.now(),
            deleted_by=self.user,
        )

        response = self.client.get(f'/openfarmplanner/api/public-crops/{public_crop.id}/discussion-topics/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([topic['title'] for topic in response.data], ['Visible topic'])
        self.assertEqual(response.data[0]['comment_count'], 1)

    def test_anonymous_user_can_read_but_cannot_create_discussions(self):
        public_crop = PublicCrop.objects.create(name='Tomato', variety='Roma', status='published', created_by=self.user)
        self.client.force_authenticate(user=None)
        list_response = self.client.get(f'/openfarmplanner/api/public-crops/{public_crop.id}/discussion-topics/')
        create_response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/discussion-topics/',
            {'title': 'Anonymous', 'body': 'Not allowed'},
            format='json',
        )
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertIn(create_response.status_code, {status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN})

    def test_guest_demo_user_can_read_but_cannot_create_public_discussions(self):
        public_crop = PublicCrop.objects.create(name='Lettuce', variety='Bijella', status='published', created_by=self.user)
        demo_session = create_guest_demo_session()
        self.client.force_authenticate(user=demo_session.user)

        list_response = self.client.get(f'/openfarmplanner/api/public-crops/{public_crop.id}/discussion-topics/')
        create_response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/discussion-topics/',
            {'title': 'Demo topic', 'body': 'Demo text'},
            format='json',
        )

        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(create_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(create_response.data['code'], 'guest_demo_restricted')
        self.assertFalse(PublicCropDiscussionTopic.objects.filter(public_crop=public_crop).exists())

    def test_comment_owner_can_edit_and_soft_delete_but_other_user_cannot(self):
        public_crop = PublicCrop.objects.create(name='Tomato', variety='Roma', status='published', created_by=self.user)
        topic = PublicCropDiscussionTopic.objects.create(public_crop=public_crop, title='Spacing', created_by=self.user)
        root_comment = PublicCropDiscussionComment.objects.create(topic=topic, body='Original root', created_by=self.user)
        comment = PublicCropDiscussionComment.objects.create(topic=topic, parent=root_comment, body='Original reply', created_by=self.user)
        child_comment = PublicCropDiscussionComment.objects.create(topic=topic, parent=comment, body='Reply child', created_by=self.user)
        other_user = User.objects.create_user(username='comment-other', password='testpass')
        self.client.force_authenticate(other_user)
        forbidden = self.client.patch(f'/openfarmplanner/api/public-crops/{public_crop.id}/discussion-comments/{comment.id}/', {'body': 'Changed'}, format='json')
        self.assertEqual(forbidden.status_code, status.HTTP_403_FORBIDDEN)
        self.client.force_authenticate(self.user)
        edited = self.client.patch(f'/openfarmplanner/api/public-crops/{public_crop.id}/discussion-comments/{comment.id}/', {'body': 'Changed'}, format='json')
        deleted = self.client.delete(f'/openfarmplanner/api/public-crops/{public_crop.id}/discussion-comments/{comment.id}/')
        comment.refresh_from_db()
        self.assertEqual(edited.status_code, status.HTTP_200_OK)
        self.assertTrue(edited.data['is_edited'])
        self.assertEqual(deleted.status_code, status.HTTP_204_NO_CONTENT)
        self.assertIsNotNone(comment.deleted_at)
        self.assertEqual(comment.body, '')
        list_response = self.client.get(f'/openfarmplanner/api/public-crops/{public_crop.id}/discussion-topics/{topic.id}/comments/')
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        deleted_comment_payload = next(item for item in list_response.data if item['id'] == comment.id)
        self.assertEqual(deleted_comment_payload['deletion_kind'], 'author')
        child_comment.refresh_from_db()
        self.assertEqual(child_comment.parent_id, comment.id)

    def test_comment_owner_can_delete_root_discussion_post_without_visible_replies(self):
        public_crop = PublicCrop.objects.create(name='Tomato', variety='Roma', status='published', created_by=self.user)
        topic = PublicCropDiscussionTopic.objects.create(public_crop=public_crop, title='Root delete', created_by=self.user)
        root_comment = PublicCropDiscussionComment.objects.create(topic=topic, body='Root content', created_by=self.user)

        response = self.client.delete(f'/openfarmplanner/api/public-crops/{public_crop.id}/discussion-comments/{root_comment.id}/')

        root_comment.refresh_from_db()
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertIsNotNone(root_comment.deleted_at)
        self.assertEqual(root_comment.body, '')

        topics_response = self.client.get(f'/openfarmplanner/api/public-crops/{public_crop.id}/discussion-topics/')
        self.assertEqual(topics_response.status_code, status.HTTP_200_OK)
        self.assertEqual(topics_response.data, [])

    def test_comment_owner_cannot_delete_root_discussion_post_with_visible_replies(self):
        public_crop = PublicCrop.objects.create(name='Tomato', variety='Roma', status='published', created_by=self.user)
        topic = PublicCropDiscussionTopic.objects.create(public_crop=public_crop, title='Root guard', created_by=self.user)
        root_comment = PublicCropDiscussionComment.objects.create(topic=topic, body='Root content', created_by=self.user)
        PublicCropDiscussionComment.objects.create(topic=topic, parent=root_comment, body='Visible reply', created_by=self.user)

        response = self.client.delete(f'/openfarmplanner/api/public-crops/{public_crop.id}/discussion-comments/{root_comment.id}/')

        root_comment.refresh_from_db()
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['code'], 'visible_replies_exist')
        self.assertIsNone(root_comment.deleted_at)
        self.assertEqual(root_comment.body, 'Root content')

    def test_comment_owner_can_delete_root_discussion_post_when_replies_are_deleted(self):
        public_crop = PublicCrop.objects.create(name='Tomato', variety='Roma', status='published', created_by=self.user)
        topic = PublicCropDiscussionTopic.objects.create(public_crop=public_crop, title='Deleted replies', created_by=self.user)
        root_comment = PublicCropDiscussionComment.objects.create(topic=topic, body='Root content', created_by=self.user)
        deleted_reply = PublicCropDiscussionComment.objects.create(
            topic=topic,
            parent=root_comment,
            body='',
            created_by=self.user,
            deleted_at=timezone.now(),
            deleted_by=self.user,
        )

        response = self.client.delete(f'/openfarmplanner/api/public-crops/{public_crop.id}/discussion-comments/{root_comment.id}/')

        root_comment.refresh_from_db()
        deleted_reply.refresh_from_db()
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertIsNotNone(root_comment.deleted_at)
        self.assertEqual(deleted_reply.parent_id, root_comment.id)

    def test_comment_permissions_mark_root_delete_unavailable_for_owner(self):
        public_crop = PublicCrop.objects.create(name='Tomato', variety='Roma', status='published', created_by=self.user)
        topic = PublicCropDiscussionTopic.objects.create(public_crop=public_crop, title='Permissions', created_by=self.user)
        root_comment = PublicCropDiscussionComment.objects.create(topic=topic, body='Root content', created_by=self.user)
        reply = PublicCropDiscussionComment.objects.create(topic=topic, parent=root_comment, body='Reply content', created_by=self.user)

        response = self.client.get(f'/openfarmplanner/api/public-crops/{public_crop.id}/discussion-topics/{topic.id}/comments/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        by_id = {comment['id']: comment for comment in response.data}
        self.assertTrue(by_id[root_comment.id]['can_edit'])
        self.assertFalse(by_id[root_comment.id]['can_delete'])
        self.assertEqual(by_id[root_comment.id]['delete_blocked_reason'], 'visible_replies')
        self.assertTrue(by_id[reply.id]['can_delete'])

    def test_topic_keeps_exact_revision_when_new_versions_are_created(self):
        public_crop = PublicCrop.objects.create(name='Tomato', variety='Roma', status='published', created_by=self.user, version=1)
        revision = PublicCropRevision.objects.create(public_crop=public_crop, version=1, action='created', snapshot={})
        response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/discussion-topics/',
            {'title': 'Version-specific question', 'body': 'About version one', 'revision': revision.id},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        public_crop.version = 2
        public_crop.save(update_fields=['version'])
        PublicCropRevision.objects.create(public_crop=public_crop, version=2, action='updated', snapshot={})
        topic = PublicCropDiscussionTopic.objects.get()
        self.assertEqual(topic.revision_id, revision.id)
        self.assertEqual(topic.revision.version, 1)

    def test_public_library_moderator_can_soft_delete_foreign_comment(self):
        public_crop = PublicCrop.objects.create(name='Tomato', variety='Roma', status='published', created_by=self.user)
        topic = PublicCropDiscussionTopic.objects.create(public_crop=public_crop, title='Moderation', created_by=self.user)
        comment = PublicCropDiscussionComment.objects.create(topic=topic, body='Problematic', created_by=self.user)
        moderator = User.objects.create_user(username='discussion-moderator', password='testpass')
        grant_public_library_moderator_access(moderator)
        self.client.force_authenticate(moderator)
        response = self.client.delete(f'/openfarmplanner/api/public-crops/{public_crop.id}/discussion-comments/{comment.id}/')
        comment.refresh_from_db()
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertIsNotNone(comment.deleted_at)
        list_response = self.client.get(f'/openfarmplanner/api/public-crops/{public_crop.id}/discussion-topics/{topic.id}/comments/')
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(list_response.data[0]['deletion_kind'], 'moderator')

    def test_public_library_moderator_can_soft_delete_root_discussion_post(self):
        public_crop = PublicCrop.objects.create(name='Tomato', variety='Roma', status='published', created_by=self.user)
        topic = PublicCropDiscussionTopic.objects.create(public_crop=public_crop, title='Moderation root', created_by=self.user)
        root_comment = PublicCropDiscussionComment.objects.create(topic=topic, body='Root content', created_by=self.user)
        reply = PublicCropDiscussionComment.objects.create(topic=topic, parent=root_comment, body='Reply content', created_by=self.user)
        moderator = User.objects.create_user(username='discussion-root-moderator', password='testpass')
        grant_public_library_moderator_access(moderator)
        self.client.force_authenticate(moderator)

        response = self.client.delete(f'/openfarmplanner/api/public-crops/{public_crop.id}/discussion-comments/{root_comment.id}/')

        root_comment.refresh_from_db()
        reply.refresh_from_db()
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertIsNotNone(root_comment.deleted_at)
        self.assertEqual(root_comment.body, '')
        self.assertEqual(reply.parent_id, root_comment.id)
        list_response = self.client.get(f'/openfarmplanner/api/public-crops/{public_crop.id}/discussion-topics/{topic.id}/comments/')
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        by_id = {comment['id']: comment for comment in list_response.data}
        self.assertEqual(by_id[root_comment.id]['deletion_kind'], 'moderator')
        self.assertEqual(by_id[reply.id]['parent'], root_comment.id)

    def test_unauthenticated_user_cannot_edit_public_crop(self):
        public_crop = PublicCrop.objects.create(name='Tomato', variety='Roma', status='published', created_by=self.user)
        self.client.force_authenticate(user=None)

        response = self.client.patch(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/',
            {'notes': 'Anonymous edit'},
            format='json',
        )

        self.assertIn(response.status_code, {status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN})
        public_crop.refresh_from_db()
        self.assertEqual(public_crop.notes, '')

    def test_authenticated_user_can_edit_foreign_public_crop_and_version_is_recorded(self):
        other_user = User.objects.create_user(username='foreign-author', email='foreign@example.com', password='testpass', is_active=True)
        public_crop = PublicCrop.objects.create(
            name='Tomato',
            variety='Roma',
            status='published',
            created_by=other_user,
            notes='Original notes',
            version=1,
        )

        response = self.client.patch(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/',
            {
                'base_version': 1,
                'notes': 'Community-improved notes',
                'growth_duration_days': 68,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        public_crop.refresh_from_db()
        self.assertEqual(public_crop.notes, 'Community-improved notes')
        self.assertEqual(public_crop.growth_duration_days, 68)
        self.assertEqual(public_crop.version, 2)
        revisions = list(PublicCropRevision.objects.filter(public_crop=public_crop).order_by('version'))
        self.assertEqual([revision.version for revision in revisions], [1, 2])
        self.assertEqual(revisions[0].snapshot['notes'], 'Original notes')
        self.assertEqual(revisions[1].created_by, self.user)
        self.assertIn(
            {'field': 'notes', 'old_value': 'Original notes', 'new_value': 'Community-improved notes'},
            revisions[1].changed_fields,
        )

    def test_public_crop_direct_edit_rejects_name_changes(self):
        """`name` (the crop) stays fixed after publication; only `variety` may be corrected."""
        public_crop = PublicCrop.objects.create(
            name='Tomato',
            variety='Roma',
            status='published',
            created_by=self.user,
            notes='Original notes',
            version=1,
        )

        response = self.client.patch(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/',
            {
                'base_version': 1,
                'name': 'Cherry tomato',
                'notes': 'Edited notes',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        public_crop.refresh_from_db()
        self.assertEqual(public_crop.name, 'Tomato')
        self.assertEqual(public_crop.variety, 'Roma')
        self.assertEqual(public_crop.notes, 'Original notes')

    def test_public_crop_direct_edit_allows_admin_variety_rename(self):
        self.user.is_staff = True
        self.user.save(update_fields=['is_staff'])
        public_crop = PublicCrop.objects.create(
            name='Tomato',
            variety='Roma',
            status='published',
            created_by=self.user,
            version=1,
        )

        response = self.client.patch(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/',
            {'base_version': 1, 'variety': 'Roma VF'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['variety'], 'Roma VF')
        public_crop.refresh_from_db()
        self.assertEqual(public_crop.variety, 'Roma VF')
        self.assertEqual(public_crop.variety_normalized, 'roma vf')
        self.assertEqual(public_crop.version, 2)
        revision = PublicCropRevision.objects.get(public_crop=public_crop, version=2)
        self.assertIn(
            {'field': 'variety', 'old_value': 'Roma', 'new_value': 'Roma VF'},
            revision.changed_fields,
        )

    def test_public_crop_direct_edit_rejects_non_admin_variety_rename(self):
        public_crop = PublicCrop.objects.create(
            name='Tomato', variety='Roma', status='published', created_by=self.user, version=1,
        )

        response = self.client.patch(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/',
            {'base_version': 1, 'variety': 'Roma VF'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['code'], 'public_crop_identity_admin_required')
        public_crop.refresh_from_db()
        self.assertEqual(public_crop.variety, 'Roma')
        self.assertEqual(public_crop.version, 1)

    def test_public_crop_direct_edit_rejects_variety_rename_that_collides_with_existing_entry(self):
        self.user.is_staff = True
        self.user.save(update_fields=['is_staff'])
        tomato_species = CropSpecies.objects.create(name='Tomato')
        PublicCrop.objects.create(
            name='Tomato', variety='San Marzano', status='published', created_by=self.user,
            crop_species=tomato_species,
        )
        public_crop = PublicCrop.objects.create(
            name='Tomato', variety='Roma', status='published', created_by=self.user,
            crop_species=tomato_species, version=1,
        )

        response = self.client.patch(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/',
            {'base_version': 1, 'variety': 'San Marzano'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['code'], 'public_crop_variety_conflict')
        public_crop.refresh_from_db()
        self.assertEqual(public_crop.variety, 'Roma')
        self.assertEqual(public_crop.version, 1)

    def test_public_crop_versions_endpoint_returns_author_time_and_diff(self):
        public_crop = PublicCrop.objects.create(
            name='Tomato',
            variety='Roma',
            status='published',
            created_by=self.user,
            notes='Original notes',
            version=1,
        )
        self.client.patch(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/',
            {'base_version': 1, 'notes': 'Updated notes'},
            format='json',
        )

        response = self.client.get(f'/openfarmplanner/api/public-crops/{public_crop.id}/versions/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data[0]['version'], 2)
        self.assertIsNotNone(response.data[0]['created_at'])
        self.assertEqual(response.data[0]['changed_fields'][0]['field'], 'notes')
        self.assertEqual(response.data[0]['changed_fields'][0]['old_value'], 'Original notes')
        self.assertEqual(response.data[0]['changed_fields'][0]['new_value'], 'Updated notes')

    def test_revert_creates_new_version_without_deleting_history(self):
        public_crop = PublicCrop.objects.create(
            name='Tomato',
            variety='Roma',
            status='published',
            created_by=self.user,
            notes='Version 1 notes',
            version=1,
        )
        edit_response = self.client.patch(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/',
            {'base_version': 1, 'notes': 'Version 2 notes'},
            format='json',
        )
        self.assertEqual(edit_response.status_code, status.HTTP_200_OK)

        revert_response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/revert/',
            {'version': 1, 'base_version': 2},
            format='json',
        )

        self.assertEqual(revert_response.status_code, status.HTTP_200_OK)
        public_crop.refresh_from_db()
        self.assertEqual(public_crop.notes, 'Version 1 notes')
        self.assertEqual(public_crop.version, 3)
        revisions = PublicCropRevision.objects.filter(public_crop=public_crop).order_by('version')
        self.assertEqual(revisions.count(), 3)
        self.assertEqual(revisions.last().action, PublicCropRevision.ACTION_RESTORED)
        self.assertEqual(revisions.last().restored_from_version, 1)

    def test_non_admin_cannot_restore_a_different_variety_identity(self):
        public_crop = PublicCrop.objects.create(
            name='Tomato', variety='Roma VF', status='published', created_by=self.user, version=2,
        )
        PublicCropRevision.objects.create(
            public_crop=public_crop,
            version=1,
            action=PublicCropRevision.ACTION_CREATED,
            snapshot={'variety': 'Roma'},
        )
        PublicCropRevision.objects.create(
            public_crop=public_crop,
            version=2,
            action=PublicCropRevision.ACTION_UPDATED,
            snapshot={'variety': 'Roma VF'},
        )

        response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/revert/',
            {'version': 1, 'base_version': 2},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['code'], 'public_crop_identity_admin_required')
        public_crop.refresh_from_db()
        self.assertEqual(public_crop.variety, 'Roma VF')
        self.assertEqual(public_crop.version, 2)

    def test_public_crop_edit_and_revert_do_not_mutate_imported_project_crop(self):
        public_crop = PublicCrop.objects.create(
            name='Bean',
            variety='Neckargold',
            status='published',
            created_by=self.user,
            notes='Public v1',
            growth_duration_days=55,
        )
        import_response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')
        imported = Crop.objects.get(id=import_response.data['crop']['id'])

        self.client.patch(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/',
            {'base_version': 1, 'notes': 'Public v2', 'growth_duration_days': 60},
            format='json',
        )
        self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/revert/',
            {'version': 1, 'base_version': 2},
            format='json',
        )

        imported.refresh_from_db()
        public_crop.refresh_from_db()
        self.assertEqual(public_crop.notes, 'Public v1')
        self.assertEqual(imported.notes, 'Public v1')
        self.assertEqual(imported.growth_duration_days, 55)
        self.assertEqual(imported.source_public_crop, public_crop)

    def test_authenticated_user_can_create_change_proposal_for_allowed_fields(self):
        public_crop = PublicCrop.objects.create(name='Tomato', variety='Roma', status='published', created_by=self.user)

        response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/change-proposals/',
            {
                'summary': 'Add clearer cultivation notes',
                'proposed_data': {'notes': 'Prefers warm protected conditions.'},
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        proposal = PublicCropChangeProposal.objects.get()
        self.assertEqual(proposal.status, PublicCropChangeProposal.STATUS_PENDING)
        self.assertEqual(proposal.proposed_by, self.user)
        self.assertEqual(proposal.proposed_data['notes'], 'Prefers warm protected conditions.')

    def test_guest_demo_user_cannot_create_change_proposal(self):
        public_crop = PublicCrop.objects.create(name='Lettuce', variety='Bijella', status='published', created_by=self.user)
        demo_session = create_guest_demo_session()
        self.client.force_authenticate(user=demo_session.user)

        response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/change-proposals/',
            {'summary': 'Demo proposal', 'proposed_data': {'notes': 'Demo edit'}},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['code'], 'guest_demo_restricted')
        self.assertFalse(PublicCropChangeProposal.objects.filter(public_crop=public_crop).exists())

    def test_change_proposal_rejects_unsupported_fields(self):
        public_crop = PublicCrop.objects.create(name='Tomato', variety='Roma', status='published', created_by=self.user)

        response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/change-proposals/',
            {
                'summary': 'Rename entry',
                'proposed_data': {'name': 'Cherry tomato'},
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(PublicCropChangeProposal.objects.count(), 0)

    def test_change_proposal_rejects_invalid_field_values(self):
        public_crop = PublicCrop.objects.create(
            name='Tomato', variety='Roma', status='published', created_by=self.user,
        )

        response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/change-proposals/',
            {
                'summary': 'Malformed values',
                'proposed_data': {
                    'growth_duration_days': {'not': 'a number'},
                    'seed_packages': [{'size_value': -1, 'size_unit': 'bucket'}],
                },
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(PublicCropChangeProposal.objects.exists())

    def test_change_proposal_accepts_valid_seed_package_values(self):
        public_crop = PublicCrop.objects.create(
            name='Tomato', variety='Roma', status='published', created_by=self.user,
        )

        response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/change-proposals/',
            {
                'summary': 'Add package evidence',
                'proposed_data': {
                    'seed_packages': [{
                        'size_value': 25.0,
                        'size_unit': 'g',
                        'evidence_text': 'Supplier catalogue',
                    }],
                },
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.data)
        proposal = PublicCropChangeProposal.objects.get()
        moderator = User.objects.create_user(
            username='seed-package-proposal-moderator', password='testpass', is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        self.client.force_authenticate(user=moderator)

        approval = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/change-proposals/{proposal.id}/approve/',
            {},
            format='json',
        )

        self.assertEqual(approval.status_code, status.HTTP_200_OK, approval.data)
        public_crop.refresh_from_db()
        self.assertEqual(public_crop.seed_packages[0]['size_value'], 25.0)

    def test_change_proposal_approval_revalidates_legacy_payload(self):
        moderator = User.objects.create_user(
            username='legacy-proposal-moderator', password='testpass', is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        public_crop = PublicCrop.objects.create(
            name='Tomato', variety='Roma', status='published', created_by=self.user,
            growth_duration_days=60,
        )
        proposal = PublicCropChangeProposal.objects.create(
            public_crop=public_crop,
            proposed_by=self.user,
            summary='Legacy malformed proposal',
            proposed_data={'growth_duration_days': {'not': 'a number'}},
        )
        self.client.force_authenticate(user=moderator)

        response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/change-proposals/{proposal.id}/approve/',
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        proposal.refresh_from_db()
        public_crop.refresh_from_db()
        self.assertEqual(proposal.status, PublicCropChangeProposal.STATUS_PENDING)
        self.assertEqual(public_crop.growth_duration_days, 60)

    def test_only_moderator_can_approve_change_proposal_and_public_crop_version_increments(self):
        moderator = User.objects.create_user(
            username='proposal-moderator',
            email='proposal-moderator@example.com',
            password='testpass',
            is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        public_crop = PublicCrop.objects.create(
            name='Tomato',
            variety='Roma',
            status='published',
            created_by=self.user,
            notes='Old notes',
            version=1,
        )
        proposal = PublicCropChangeProposal.objects.create(
            public_crop=public_crop,
            proposed_by=self.user,
            summary='Improve notes',
            proposed_data={'notes': 'Improved notes', 'growth_duration_days': 65},
        )

        forbidden_response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/change-proposals/{proposal.id}/approve/',
            {},
            format='json',
        )
        self.client.force_authenticate(user=moderator)
        approved_response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/change-proposals/{proposal.id}/approve/',
            {'review_note': 'Looks plausible.'},
            format='json',
        )

        self.assertEqual(forbidden_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(approved_response.status_code, status.HTTP_200_OK)
        public_crop.refresh_from_db()
        proposal.refresh_from_db()
        self.assertEqual(public_crop.notes, 'Improved notes')
        self.assertEqual(public_crop.growth_duration_days, 65)
        self.assertEqual(public_crop.version, 2)
        self.assertEqual(proposal.status, PublicCropChangeProposal.STATUS_APPROVED)
        self.assertEqual(proposal.reviewed_by, moderator)

    def test_moderator_can_reject_change_proposal_without_changing_public_crop(self):
        moderator = User.objects.create_user(
            username='proposal-reject-moderator',
            email='proposal-reject-moderator@example.com',
            password='testpass',
            is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        public_crop = PublicCrop.objects.create(
            name='Tomato',
            variety='Roma',
            status='published',
            created_by=self.user,
            notes='Original notes',
        )
        proposal = PublicCropChangeProposal.objects.create(
            public_crop=public_crop,
            proposed_by=self.user,
            summary='Change notes',
            proposed_data={'notes': 'Rejected notes'},
        )
        self.client.force_authenticate(user=moderator)

        response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/change-proposals/{proposal.id}/reject/',
            {'review_note': 'Needs sources.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        public_crop.refresh_from_db()
        proposal.refresh_from_db()
        self.assertEqual(public_crop.notes, 'Original notes')
        self.assertEqual(proposal.status, PublicCropChangeProposal.STATUS_REJECTED)
        self.assertEqual(proposal.review_note, 'Needs sources.')

    def test_import_requires_project_membership_header(self):
        public_crop = PublicCrop.objects.create(name='Kale', variety='Nero', status='published', created_by=self.user)
        del self.client.defaults['HTTP_X_PROJECT_ID']

        response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_contributor_can_remove_own_public_crop_without_changing_imported_project_copy(self):
        public_crop = PublicCrop.objects.create(
            name='Bean',
            variety='Canadian Wonder',
            status=PublicCrop.STATUS_PUBLISHED,
            created_by=self.user,
            growth_duration_days=70,
            harvest_duration_days=30,
        )
        import_response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/import/', {}, format='json')
        imported = Crop.objects.get(id=import_response.data['crop']['id'])

        response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/remove/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        public_crop.refresh_from_db()
        imported.refresh_from_db()
        self.assertEqual(public_crop.status, PublicCrop.STATUS_WITHDRAWN)
        self.assertEqual(imported.name, 'Bean')
        self.assertEqual(imported.source_public_crop, public_crop)
        self.assertTrue(PublicCropStatusEvent.objects.filter(
            public_crop=public_crop,
            from_status=PublicCrop.STATUS_PUBLISHED,
            to_status=PublicCrop.STATUS_WITHDRAWN,
            created_by=self.user,
        ).exists())

        list_response = self.client.get('/openfarmplanner/api/public-crops/')
        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertEqual(list_response.data['results'], [])

    def test_non_contributor_without_moderation_rights_cannot_remove_public_crop(self):
        other_user = User.objects.create_user(
            username='other-contributor',
            email='other-contributor@example.com',
            password='testpass',
            is_active=True,
        )
        public_crop = PublicCrop.objects.create(
            name='Bean',
            variety='Canadian Wonder',
            status=PublicCrop.STATUS_PUBLISHED,
            created_by=other_user,
        )

        response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/remove/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        public_crop.refresh_from_db()
        self.assertEqual(public_crop.status, PublicCrop.STATUS_PUBLISHED)

    def test_contributor_can_republish_a_crop_removed_from_the_library(self):
        public_crop = PublicCrop.objects.create(
            name='Lettuce',
            variety='Bijella',
            status=PublicCrop.STATUS_PUBLISHED,
            crop_species=self.species,
            original_language_code='en',
            created_by=self.user,
            source_project=self.project,
            source_project_crop=self.crop,
        )
        remove_response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/remove/', {}, format='json')
        self.assertEqual(remove_response.status_code, status.HTTP_200_OK)

        response = self.publish_current_crop()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['operation'], 'updated')
        self.assertEqual(response.data['public_crop']['id'], public_crop.id)
        public_crop.refresh_from_db()
        self.assertEqual(public_crop.status, PublicCrop.STATUS_PUBLISHED)
        self.assertEqual(public_crop.version, 2)

    def test_admin_can_remove_public_crop_with_reason(self):
        moderator = User.objects.create_user(
            username='moderator',
            email='moderator@example.com',
            password='testpass',
            is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        self.client.force_authenticate(user=moderator)
        public_crop = PublicCrop.objects.create(
            name='Tomato',
            variety='Roma',
            status=PublicCrop.STATUS_PUBLISHED,
            created_by=self.user,
        )

        response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/remove/',
            {'reason': PublicCrop.REMOVAL_REASON_DUPLICATE},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        public_crop.refresh_from_db()
        self.assertEqual(public_crop.status, PublicCrop.STATUS_REMOVED)
        self.assertEqual(public_crop.removal_reason, PublicCrop.REMOVAL_REASON_DUPLICATE)
        self.assertTrue(PublicCropStatusEvent.objects.filter(
            public_crop=public_crop,
            to_status=PublicCrop.STATUS_REMOVED,
            reason=PublicCrop.REMOVAL_REASON_DUPLICATE,
            created_by=moderator,
        ).exists())

    def test_moderator_can_restore_a_removed_public_crop(self):
        moderator = User.objects.create_user(
            username='restore-moderator',
            email='restore-moderator@example.com',
            password='testpass',
            is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        public_crop = PublicCrop.objects.create(
            name='Tomato',
            variety='Roma',
            status=PublicCrop.STATUS_REMOVED,
            removal_reason=PublicCrop.REMOVAL_REASON_DUPLICATE,
            created_by=self.user,
        )
        self.client.force_authenticate(user=moderator)

        response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/restore/',
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        public_crop.refresh_from_db()
        self.assertEqual(public_crop.status, PublicCrop.STATUS_PUBLISHED)
        self.assertEqual(public_crop.removal_reason, '')
        self.assertTrue(PublicCropStatusEvent.objects.filter(
            public_crop=public_crop,
            from_status=PublicCrop.STATUS_REMOVED,
            to_status=PublicCrop.STATUS_PUBLISHED,
            created_by=moderator,
        ).exists())

    def test_non_moderator_cannot_restore_a_removed_public_crop(self):
        public_crop = PublicCrop.objects.create(
            name='Tomato',
            variety='Roma',
            status=PublicCrop.STATUS_REMOVED,
            removal_reason=PublicCrop.REMOVAL_REASON_DUPLICATE,
            created_by=self.user,
        )

        response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/restore/',
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        public_crop.refresh_from_db()
        self.assertEqual(public_crop.status, PublicCrop.STATUS_REMOVED)

    def test_removed_public_crops_are_hidden_from_the_default_list(self):
        moderator = User.objects.create_user(
            username='list-restore-moderator',
            email='list-restore-moderator@example.com',
            password='testpass',
            is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        PublicCrop.objects.create(
            name='Tomato',
            variety='Roma',
            status=PublicCrop.STATUS_REMOVED,
            created_by=self.user,
        )
        self.client.force_authenticate(user=moderator)

        default_response = self.client.get('/openfarmplanner/api/public-crops/')
        self.assertEqual(default_response.status_code, status.HTTP_200_OK)
        self.assertEqual(default_response.data['results'], [])

        removed_response = self.client.get('/openfarmplanner/api/public-crops/?status=removed')
        self.assertEqual(removed_response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(removed_response.data['results']), 1)

    def test_non_moderator_cannot_list_removed_public_crops(self):
        PublicCrop.objects.create(
            name='Tomato',
            variety='Roma',
            status=PublicCrop.STATUS_REMOVED,
            created_by=self.user,
        )

        response = self.client.get('/openfarmplanner/api/public-crops/?status=removed')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['results'], [])

    def test_staff_crop_list_exposes_linked_public_crop_id_for_moderation(self):
        moderator = User.objects.create_user(
            username='list-moderator',
            email='list-moderator@example.com',
            password='testpass',
            is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        ProjectMembership.objects.create(user=moderator, project=self.project, role='admin')
        public_crop = PublicCrop.objects.create(
            name='Lettuce',
            variety='Bijella',
            status=PublicCrop.STATUS_PUBLISHED,
            created_by=self.user,
            source_project=self.project,
            source_project_crop=self.crop,
        )
        self.crop.source_public_crop = public_crop
        self.crop.source_public_version = public_crop.version
        self.crop.save(update_fields=['source_public_crop', 'source_public_version'])
        self.client.force_authenticate(user=moderator)

        response = self.client.get('/openfarmplanner/api/crops/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['results'][0]['owned_public_crop_id'], public_crop.id)
        self.assertEqual(response.data['results'][0]['owned_public_crop_role'], 'moderator')

    def test_contributor_crop_list_reports_the_contributor_role_for_their_public_entry(self):
        public_crop = PublicCrop.objects.create(
            name='Lettuce',
            variety='Bijella',
            status=PublicCrop.STATUS_PUBLISHED,
            published_at=datetime(2026, 3, 10, 12, 0, tzinfo=datetime_timezone.utc),
            created_by=self.user,
            source_project=self.project,
            source_project_crop=self.crop,
        )

        response = self.client.get('/openfarmplanner/api/crops/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['results'][0]['owned_public_crop_id'], public_crop.id)
        self.assertEqual(response.data['results'][0]['owned_public_crop_role'], 'contributor')

    def test_contributor_crop_list_ignores_withdrawn_or_removed_public_entries(self):
        for public_status in (PublicCrop.STATUS_WITHDRAWN, PublicCrop.STATUS_REMOVED):
            with self.subTest(public_status=public_status):
                PublicCrop.objects.filter(source_project_crop=self.crop).delete()
                PublicCrop.objects.create(
                    name='Lettuce',
                    variety='Bijella',
                    status=public_status,
                    published_at=datetime(2026, 3, 10, 12, 0, tzinfo=datetime_timezone.utc),
                    created_by=self.user,
                    source_project=self.project,
                    source_project_crop=self.crop,
                )

                response = self.client.get('/openfarmplanner/api/crops/')

                self.assertEqual(response.status_code, status.HTTP_200_OK)
                self.assertIsNone(response.data['results'][0]['owned_public_crop_id'])
                self.assertIsNone(response.data['results'][0]['owned_public_crop_role'])

    def test_crop_list_reports_no_public_library_role_without_a_linked_entry(self):
        response = self.client.get('/openfarmplanner/api/crops/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data['results'][0]['owned_public_crop_id'])
        self.assertIsNone(response.data['results'][0]['owned_public_crop_role'])

    def test_moderator_removing_their_own_public_crop_withdraws_it_without_a_reason(self):
        moderator = User.objects.create_user(
            username='self-moderator',
            email='self-moderator@example.com',
            password='testpass',
            is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        self.client.force_authenticate(user=moderator)
        public_crop = PublicCrop.objects.create(
            name='Tomato',
            variety='Roma',
            status=PublicCrop.STATUS_PUBLISHED,
            created_by=moderator,
        )

        response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/remove/',
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        public_crop.refresh_from_db()
        self.assertEqual(public_crop.status, PublicCrop.STATUS_WITHDRAWN)
        self.assertEqual(public_crop.removal_reason, '')

    def test_moderator_removing_a_foreign_public_crop_requires_a_reason(self):
        public_crop = PublicCrop.objects.create(
            name='Tomato',
            variety='Roma',
            status=PublicCrop.STATUS_PUBLISHED,
            created_by=self.user,
        )

        moderator = User.objects.create_user(
            username='moderator-missing-reason',
            email='moderator-missing@example.com',
            password='testpass',
            is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        self.client.force_authenticate(user=moderator)
        missing_reason_response = self.client.post(
            f'/openfarmplanner/api/public-crops/{public_crop.id}/remove/',
            {},
            format='json',
        )
        self.assertEqual(missing_reason_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(missing_reason_response.data['code'], 'removal_reason_required')

    def test_hard_delete_is_blocked_when_public_crop_has_imports_or_project_provenance(self):
        moderator = User.objects.create_user(
            username='delete-moderator',
            email='delete-moderator@example.com',
            password='testpass',
            is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        self.client.force_authenticate(user=moderator)
        public_crop = PublicCrop.objects.create(
            name='Bean',
            variety='Canadian Wonder',
            status=PublicCrop.STATUS_PUBLISHED,
            created_by=self.user,
            source_project=self.project,
            source_project_crop=self.crop,
        )
        Crop.objects.create(
            name='Bean',
            variety='Canadian Wonder',
            project=self.project,
            source_public_crop=public_crop,
            source_public_version=1,
            origin_type=Crop.ORIGIN_IMPORTED,
        )

        response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/hard-delete/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(PublicCrop.objects.filter(id=public_crop.id).exists())

    def test_admin_can_hard_delete_orphan_public_crop(self):
        moderator = User.objects.create_user(
            username='orphan-delete-moderator',
            email='orphan-delete-moderator@example.com',
            password='testpass',
            is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        self.client.force_authenticate(user=moderator)
        public_crop = PublicCrop.objects.create(
            name='Orphan',
            variety='Test',
            status=PublicCrop.STATUS_REMOVED,
            created_by=None,
        )

        response = self.client.post(f'/openfarmplanner/api/public-crops/{public_crop.id}/hard-delete/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(PublicCrop.objects.filter(id=public_crop.id).exists())

    def test_default_destroy_route_is_blocked_for_non_moderators(self):
        public_crop = PublicCrop.objects.create(
            name='Radish',
            variety='Cherry Belle',
            status=PublicCrop.STATUS_PUBLISHED,
            created_by=None,
        )

        response = self.client.delete(f'/openfarmplanner/api/public-crops/{public_crop.id}/')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(PublicCrop.objects.filter(id=public_crop.id).exists())

    def test_default_destroy_route_enforces_provenance_safety_for_moderators(self):
        moderator = User.objects.create_user(
            username='destroy-route-moderator',
            email='destroy-route-moderator@example.com',
            password='testpass',
            is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        self.client.force_authenticate(user=moderator)
        public_crop = PublicCrop.objects.create(
            name='Bean',
            variety='Canadian Wonder',
            status=PublicCrop.STATUS_PUBLISHED,
            created_by=self.user,
            source_project=self.project,
            source_project_crop=self.crop,
        )
        Crop.objects.create(
            name='Bean',
            variety='Canadian Wonder',
            project=self.project,
            source_public_crop=public_crop,
            source_public_version=1,
            origin_type=Crop.ORIGIN_IMPORTED,
        )

        response = self.client.delete(f'/openfarmplanner/api/public-crops/{public_crop.id}/')

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(PublicCrop.objects.filter(id=public_crop.id).exists())

    def test_default_destroy_route_permanently_deletes_orphan_crop_for_moderators(self):
        moderator = User.objects.create_user(
            username='destroy-route-orphan-moderator',
            email='destroy-route-orphan-moderator@example.com',
            password='testpass',
            is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        self.client.force_authenticate(user=moderator)
        public_crop = PublicCrop.objects.create(
            name='Orphan',
            variety='DestroyRoute',
            status=PublicCrop.STATUS_PUBLISHED,
            created_by=None,
        )

        response = self.client.delete(f'/openfarmplanner/api/public-crops/{public_crop.id}/')

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(PublicCrop.objects.filter(id=public_crop.id).exists())


class PublicCropPendingSpeciesApiTest(DRFAPITestCase):
    """Entries published under a not-yet-reviewed species stay read-only.

    Publishing under a proposed species is deliberately allowed (the variety
    goes live provisionally), but every action that treats the species as
    settled reference data waits for the moderator's decision.
    """

    def setUp(self):
        self.user = User.objects.create_user(
            username='pending-species-user', email='pending-species@example.com', password='testpass', is_active=True,
        )
        self.project = Project.objects.create(name='Pending Project', slug='pending-project')
        ProjectMembership.objects.create(user=self.user, project=self.project, role='admin')
        self.client.force_authenticate(user=self.user)
        self.client.defaults['HTTP_X_PROJECT_ID'] = str(self.project.id)
        self.pending_species = CropSpecies.objects.create(
            name='Tree onion', status=CropSpecies.STATUS_PROPOSED, proposed_by=self.user,
        )
        self.pending_entry = PublicCrop.objects.create(
            name='Tree onion',
            variety='Egyptian',
            status=PublicCrop.STATUS_PUBLISHED,
            crop_species=self.pending_species,
            created_by=self.user,
        )

    def test_serializer_exposes_the_pending_species_status(self):
        response = self.client.get(f'/openfarmplanner/api/public-crops/{self.pending_entry.id}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['crop_species_status'], CropSpecies.STATUS_PROPOSED)

    def test_import_is_blocked_while_the_species_awaits_moderation(self):
        response = self.client.post(f'/openfarmplanner/api/public-crops/{self.pending_entry.id}/import/')

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['code'], 'crop_species_pending')
        self.assertFalse(Crop.objects.filter(project=self.project).exists())

    def test_starting_a_discussion_is_blocked_while_the_species_awaits_moderation(self):
        response = self.client.post(
            f'/openfarmplanner/api/public-crops/{self.pending_entry.id}/discussion-topics/',
            {'title': 'Too early', 'body': 'Should not be possible yet.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['code'], 'crop_species_pending')
        self.assertFalse(PublicCropDiscussionTopic.objects.exists())

    def test_commenting_is_blocked_while_the_species_awaits_moderation(self):
        topic = PublicCropDiscussionTopic.objects.create(
            public_crop=self.pending_entry, title='Existing', created_by=self.user,
        )

        response = self.client.post(
            f'/openfarmplanner/api/public-crops/{self.pending_entry.id}/discussion-topics/{topic.id}/comments/',
            {'body': 'Should not be possible yet.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['code'], 'crop_species_pending')
        self.assertFalse(PublicCropDiscussionComment.objects.exists())

    def test_everything_unblocks_once_the_species_is_approved(self):
        self.pending_species.status = CropSpecies.STATUS_PUBLISHED
        self.pending_species.save(update_fields=['status'])

        import_response = self.client.post(f'/openfarmplanner/api/public-crops/{self.pending_entry.id}/import/')
        topic_response = self.client.post(
            f'/openfarmplanner/api/public-crops/{self.pending_entry.id}/discussion-topics/',
            {'title': 'Now allowed', 'body': 'Approved species.'},
            format='json',
        )

        self.assertEqual(import_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(topic_response.status_code, status.HTTP_201_CREATED)

    def test_crop_detail_reports_its_own_entry_as_pending(self):
        imported = Crop.objects.create(
            name='Tree onion',
            variety='Egyptian',
            project=self.project,
            source_public_crop=self.pending_entry,
            source_public_version=1,
            origin_type=Crop.ORIGIN_IMPORTED,
        )

        response = self.client.get(f'/openfarmplanner/api/crops/{imported.id}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['public_crop_species_pending'])

    def test_crop_detail_keeps_the_local_name_for_a_pending_species(self):
        imported = Crop.objects.create(
            name='t',
            variety='Egyptian',
            crop_species=self.pending_species,
            project=self.project,
            source_public_crop=self.pending_entry,
            source_public_version=1,
            origin_type=Crop.ORIGIN_IMPORTED,
        )

        response = self.client.get(f'/openfarmplanner/api/crops/{imported.id}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['name'], 't')
        self.assertEqual(response.data['crop_display_name'], 't')
        self.assertEqual(response.data['crop_display_language_code'], '')
        self.assertTrue(response.data['public_crop_species_pending'])

    def test_crop_detail_keeps_the_local_name_for_a_rejected_species(self):
        """A rejected species keeps the proposer's free-text name, which may be
        an unrelated placeholder, so the crop's own name must still win."""
        rejected_species = CropSpecies.objects.create(
            name='PublishCopy 1787901718647',
            status=CropSpecies.STATUS_REJECTED,
            proposed_by=self.user,
        )
        crop = Crop.objects.create(
            name='test',
            variety='sorte',
            crop_species=rejected_species,
            project=self.project,
        )

        response = self.client.get(f'/openfarmplanner/api/crops/{crop.id}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['crop_display_name'], 'test')
        self.assertEqual(response.data['crop_display_language_code'], '')

    def test_crop_detail_reports_no_pending_state_for_a_published_species(self):
        published_species = CropSpecies.objects.create(name='Lettuce', status=CropSpecies.STATUS_PUBLISHED)
        published_entry = PublicCrop.objects.create(
            name='Lettuce', variety='Bijella', status=PublicCrop.STATUS_PUBLISHED,
            crop_species=published_species, created_by=self.user,
        )
        imported = Crop.objects.create(
            name='Lettuce',
            variety='Bijella',
            project=self.project,
            source_public_crop=published_entry,
            source_public_version=1,
            origin_type=Crop.ORIGIN_IMPORTED,
        )

        response = self.client.get(f'/openfarmplanner/api/crops/{imported.id}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data['public_crop_species_pending'])


class UnsupportedPublicCropFieldsErrorTest(DRFAPITestCase):
    """The unsupported-fields rejection must name only the rejected fields.

    It used to be a bare ``ValueError`` echoed back with ``str(error)``, which
    meant any unrelated ``ValueError`` raised further down — including one from
    a library, whose text is not ours to expose — would have been returned to
    the caller verbatim (CodeQL: information exposure through an exception).
    """

    def test_rejected_field_names_are_reported(self):
        from farm.services.public_crops import UnsupportedPublicCropFieldsError

        error = UnsupportedPublicCropFieldsError(['bogus_field', 'other_field'])

        self.assertEqual(error.code, 'unsupported_public_crop_fields')
        self.assertEqual(error.fields, ['bogus_field', 'other_field'])
        self.assertEqual(error.detail, 'Unsupported public crop fields: bogus_field, other_field')

    def test_the_service_raises_the_dedicated_error_not_a_bare_value_error(self):
        from farm.services.public_crops import (
            UnsupportedPublicCropFieldsError,
            update_public_crop_directly,
        )

        public_crop = PublicCrop.objects.create(
            name='Guarded', variety='Alpha', status=PublicCrop.STATUS_PUBLISHED
        )
        user = User.objects.create_user(
            username='editor-guard', email='editor-guard@example.com', password='pw', is_active=True
        )

        with self.assertRaises(UnsupportedPublicCropFieldsError) as caught:
            update_public_crop_directly(
                public_crop=public_crop, user=user, data={'not_editable': 'x'}
            )

        self.assertEqual(caught.exception.fields, ['not_editable'])

    def test_an_unrelated_value_error_is_no_longer_echoed_to_the_caller(self):
        """The whole point of the narrowing: a foreign ValueError must not leak."""
        from unittest.mock import patch

        public_crop = PublicCrop.objects.create(
            name='Leaky', variety='Beta', status=PublicCrop.STATUS_PUBLISHED
        )
        user = User.objects.create_user(
            username='editor-leak', email='editor-leak@example.com', password='pw', is_active=True
        )
        self.client.force_authenticate(user=user)

        secret = 'invalid literal for int() with base 10: /srv/internal/secret/path'
        with patch(
            'farm.crops.views.public.update_public_crop_directly',
            side_effect=ValueError(secret),
        ):
            with self.assertRaises(ValueError):
                self.client.patch(
                    f'/openfarmplanner/api/public-crops/{public_crop.id}/',
                    {'notes': 'x'},
                    format='json',
                )
