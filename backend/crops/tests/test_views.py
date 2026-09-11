from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase as DRFAPITestCase

from accounts.guest_demo import create_guest_demo_session
from accounts.models import UserProjectSettings
from crops.models import CropSpecies, CropSpeciesTranslation, PublicLibraryModeratorRequest
from crops.permissions import grant_public_library_moderator_access
from farm.models import PublicCrop
from notifications.models import Notification

User = get_user_model()


class CropViewSetTest(DRFAPITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='crops-user', email='crops@example.com', password='testpass', is_active=True,
        )
        self.published = PublicCrop.objects.create(
            name='Lettuce', variety='Bijella', status=PublicCrop.STATUS_PUBLISHED,
            version=1, created_by=self.user,
        )
        self.draft = PublicCrop.objects.create(
            name='Carrot', variety='Nantes', status='draft', version=1, created_by=self.user,
        )

    @staticmethod
    def species_approval_payload(
        *, german_name: str = 'Baumzwiebel', english_name: str = 'Tree onion', review_note: str = '',
    ) -> dict:
        return {
            'review_note': review_note,
            'translations': [
                {'language_code': 'de', 'common_name': german_name},
                {'language_code': 'en', 'common_name': english_name},
            ],
        }

    def test_requires_authentication(self):
        response = self.client.get('/openfarmplanner/api/crop-library/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_lists_only_published_crops(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get('/openfarmplanner/api/crop-library/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        names = [item['name'] for item in response.data['results']]
        self.assertIn('Lettuce', names)
        self.assertNotIn('Carrot', names)

    def test_filters_by_free_text_query(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get('/openfarmplanner/api/crop-library/', {'q': 'lett'})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 1)
        self.assertEqual(response.data['results'][0]['name'], 'Lettuce')

    def test_retrieves_a_single_published_crop(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(f'/openfarmplanner/api/crop-library/{self.published.id}/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['name'], 'Lettuce')
        self.assertEqual(response.data['variety'], 'Bijella')
        # Provenance fields are project-scoped and must not leak into the
        # crop-library-facing serializer.
        self.assertNotIn('source_project', response.data)
        self.assertNotIn('source_project_crop', response.data)

    def test_retrieving_an_unpublished_crop_404s(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get(f'/openfarmplanner/api/crop-library/{self.draft.id}/')

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_retrieving_crop_under_rejected_species_404s(self):
        rejected_species = CropSpecies.objects.create(
            name='Rejected bean', status=CropSpecies.STATUS_REJECTED,
        )
        rejected_crop = PublicCrop.objects.create(
            name='Rejected bean', variety='Test', status=PublicCrop.STATUS_PUBLISHED,
            version=1, created_by=self.user, crop_species=rejected_species,
        )
        self.client.force_authenticate(user=self.user)

        response = self.client.get(f'/openfarmplanner/api/crop-library/{rejected_crop.id}/')

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_match_finds_an_exact_normalized_match(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get('/openfarmplanner/api/crop-library/match/', {'name': 'lettuce', 'variety': 'bijella'})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['exists'])
        self.assertEqual(response.data['crop']['id'], self.published.id)

    def test_match_reports_no_match(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.get('/openfarmplanner/api/crop-library/match/', {'name': 'Kohlrabi', 'variety': 'Superschmelz'})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data['exists'])
        self.assertIsNone(response.data['crop'])

    def test_write_methods_are_not_allowed(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.post('/openfarmplanner/api/crop-library/', {'name': 'X', 'variety': 'Y'})

        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    def test_lists_official_crop_species(self):
        CropSpecies.objects.create(name='Draft species', status=CropSpecies.STATUS_PROPOSED)
        self.client.force_authenticate(user=self.user)

        response = self.client.get('/openfarmplanner/api/crop-species/', {'q': 'tom'})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        names = [item['name'] for item in response.data['results']]
        self.assertEqual(names, ['Tomate'])
        self.assertNotIn('Draft species', names)

    def test_species_search_finds_plural_english_bean_query(self):
        self.client.force_authenticate(user=self.user)

        response = self.client.get('/openfarmplanner/api/crop-species/', {'q': 'beans'})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        names = {item['name'] for item in response.data['results']}
        self.assertNotIn('Bohne', names)
        self.assertIn('Ackerbohne', names)
        self.assertIn('Buschbohne', names)
        self.assertIn('Stangenbohne', names)

    def test_species_search_finds_regional_alias(self):
        """A regional name resolves to the canonical species instead of nothing."""
        self.client.force_authenticate(user=self.user)

        for query, expected_name in (
            ('Erdapfel', 'Kartoffel'),
            ('Karfiol', 'Karfiol'),
            ('Blumenkohl', 'Karfiol'),
            ('Porree', 'Lauch'),
            ('Paradeiser', 'Tomate'),
            ('Vogerlsalat', 'Feldsalat'),
        ):
            with self.subTest(query=query):
                response = self.client.get('/openfarmplanner/api/crop-species/', {'q': query})

                self.assertEqual(response.status_code, status.HTTP_200_OK)
                names = {item['name'] for item in response.data['results']}
                self.assertIn(expected_name, names)
                self.assertNotIn(query, names - {expected_name})

    def test_ambiguous_alias_offers_every_candidate_species(self):
        """Peperoni and Fisolen name several crops; the search must not pick one."""
        self.client.force_authenticate(user=self.user)

        pepper_response = self.client.get('/openfarmplanner/api/crop-species/', {'q': 'Peperoni'})
        bean_response = self.client.get('/openfarmplanner/api/crop-species/', {'q': 'Fisolen'})

        pepper_names = {item['name'] for item in pepper_response.data['results']}
        bean_names = {item['name'] for item in bean_response.data['results']}
        self.assertIn('Paprika', pepper_names)
        self.assertIn('Chili', pepper_names)
        self.assertIn('Pfefferoni', pepper_names)
        self.assertIn('Buschbohne', bean_names)
        self.assertIn('Stangenbohne', bean_names)
        self.assertIn('Grüne Bohne', bean_names)

    def test_functionally_distinct_crops_stay_separate_species(self):
        """Own species, not aliases: they differ in cultivation and harvest."""
        self.client.force_authenticate(user=self.user)

        response = self.client.get('/openfarmplanner/api/crop-species/', {'page_size': 1000})

        names = {item['name'] for item in response.data['results']}
        self.assertIn('Pfefferoni', names)
        self.assertIn('Puntarelle', names)
        self.assertIn('Radicchio', names)
        self.assertIn('Schnittkohl', names)
        self.assertIn('Zuckererbse', names)

    def test_alias_search_exposes_the_matched_name_to_the_ui(self):
        """`search_names` is what lets the picker label a hit "Kartoffel (Erdapfel)"."""
        self.client.force_authenticate(user=self.user)

        response = self.client.get('/openfarmplanner/api/crop-species/', {'q': 'Erdapfel'})

        potato = next(
            item for item in response.data['results'] if item['name'] == 'Kartoffel'
        )
        self.assertIn('Erdapfel', potato['search_names'])

    def test_species_search_uses_concrete_green_manure_species(self):
        self.client.force_authenticate(user=self.user)

        generic_response = self.client.get('/openfarmplanner/api/crop-species/', {'q': 'Gründüngung'})
        concrete_response = self.client.get('/openfarmplanner/api/crop-species/', {'q': 'Phacelia'})

        self.assertEqual(generic_response.status_code, status.HTTP_200_OK)
        self.assertEqual(concrete_response.status_code, status.HTTP_200_OK)
        self.assertNotIn('Gründüngung', [item['name'] for item in generic_response.data['results']])
        self.assertIn('Phacelia', [item['name'] for item in concrete_response.data['results']])

    def test_species_create_stores_a_proposal(self):
        self.client.force_authenticate(user=self.user)

        response = self.client.post(
            '/openfarmplanner/api/crop-species/',
            {'name': 'Tree onion', 'translations': [{'language_code': 'en', 'common_name': 'Tree onion'}]},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['status'], CropSpecies.STATUS_PROPOSED)
        proposal = CropSpecies.objects.get(name='Tree onion')
        self.assertEqual(proposal.proposed_by, self.user)
        self.assertTrue(proposal.translations.filter(language_code='en', common_name='Tree onion').exists())

    def test_species_create_notifies_public_library_moderators(self):
        staff_moderator = User.objects.create_user(
            username='staff-moderator', email='staff-moderator@example.com', password='testpass',
            is_active=True, is_staff=True,
        )
        group_moderator = User.objects.create_user(
            username='group-moderator', email='group-moderator@example.com',
            password='testpass', is_active=True,
        )
        grant_public_library_moderator_access(group_moderator)
        self.client.force_authenticate(user=self.user)

        response = self.client.post('/openfarmplanner/api/crop-species/', {'name': 'Tree onion'})

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        proposal = CropSpecies.objects.get(name='Tree onion')
        for recipient in (staff_moderator, group_moderator):
            notification = Notification.objects.get(recipient=recipient)
            self.assertEqual(
                notification.notification_type,
                Notification.TYPE_CROP_SPECIES_PROPOSAL_SUBMITTED,
            )
            self.assertEqual(notification.context, {'name': 'Tree onion'})
            self.assertEqual(
                notification.target_type,
                Notification.TARGET_PUBLIC_LIBRARY_MODERATION,
            )
            self.assertEqual(notification.target_id, proposal.id)
        # The proposer themselves is not a moderator here and gets nothing yet.
        self.assertFalse(Notification.objects.filter(recipient=self.user).exists())

    def test_species_create_does_not_notify_the_proposer_even_when_they_are_a_moderator(self):
        proposing_moderator = User.objects.create_user(
            username='proposing-moderator', email='proposing-moderator@example.com',
            password='testpass', is_active=True,
        )
        grant_public_library_moderator_access(proposing_moderator)
        other_moderator = User.objects.create_user(
            username='other-moderator', email='other-moderator@example.com',
            password='testpass', is_active=True,
        )
        grant_public_library_moderator_access(other_moderator)
        self.client.force_authenticate(user=proposing_moderator)

        response = self.client.post('/openfarmplanner/api/crop-species/', {'name': 'Self-proposed onion'})

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertFalse(Notification.objects.filter(recipient=proposing_moderator).exists())
        self.assertTrue(Notification.objects.filter(recipient=other_moderator).exists())

    def test_guest_demo_user_cannot_create_species_proposal(self):
        demo_session = create_guest_demo_session()
        self.client.force_authenticate(user=demo_session.user)

        response = self.client.post('/openfarmplanner/api/crop-species/', {'name': 'Demo species'})

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['code'], 'guest_demo_restricted')
        self.assertFalse(CropSpecies.objects.filter(name='Demo species').exists())

    def test_normal_user_cannot_list_or_review_species_proposals(self):
        proposal = CropSpecies.objects.create(name='Tree onion', status=CropSpecies.STATUS_PROPOSED, proposed_by=self.user)
        self.client.force_authenticate(user=self.user)

        list_response = self.client.get('/openfarmplanner/api/crop-species/', {'include_proposed': 'true'})
        status_filter_response = self.client.get('/openfarmplanner/api/crop-species/', {'status': CropSpecies.STATUS_PROPOSED})
        approve_response = self.client.post(f'/openfarmplanner/api/crop-species/{proposal.id}/approve/', {}, format='json')

        self.assertEqual(list_response.status_code, status.HTTP_200_OK)
        self.assertNotIn('Tree onion', [item['name'] for item in list_response.data['results']])
        self.assertNotIn('Tree onion', [item['name'] for item in status_filter_response.data['results']])
        self.assertEqual(approve_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_moderator_can_approve_species_proposal(self):
        moderator = User.objects.create_user(
            username='species-moderator',
            email='species-moderator@example.com',
            password='testpass',
            is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        proposal = CropSpecies.objects.create(name='Tree onion', status=CropSpecies.STATUS_PROPOSED, proposed_by=self.user)
        self.client.force_authenticate(user=moderator)

        response = self.client.post(
            f'/openfarmplanner/api/crop-species/{proposal.id}/approve/',
            self.species_approval_payload(review_note='Good addition.'),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        proposal.refresh_from_db()
        self.assertEqual(proposal.status, CropSpecies.STATUS_PUBLISHED)
        self.assertEqual(proposal.name, 'Tree onion')
        self.assertEqual(
            proposal.translations_by_language(),
            {'de': 'Baumzwiebel', 'en': 'Tree onion'},
        )
        self.assertEqual(proposal.reviewed_by, moderator)
        self.assertEqual(proposal.review_note, 'Good addition.')
        notification = Notification.objects.get(recipient=self.user)
        self.assertEqual(notification.notification_type, Notification.TYPE_CROP_SPECIES_PROPOSAL_ACCEPTED)
        self.assertEqual(notification.context, {'name': 'Tree onion'})
        # No published variety of the proposer under this species yet, so the
        # notification points at the species itself.
        self.assertEqual(notification.target_type, Notification.TARGET_CROP_SPECIES)
        self.assertEqual(notification.target_id, proposal.id)
        self.assertFalse(notification.is_read)

    def test_species_approval_notification_uses_proposers_ui_language(self):
        UserProjectSettings.objects.create(user=self.user, ui_language='de')
        moderator = User.objects.create_user(
            username='species-notification-moderator',
            email='species-notification-moderator@example.com',
            password='testpass',
            is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        proposal = CropSpecies.objects.create(name='Tree onion', status=CropSpecies.STATUS_PROPOSED, proposed_by=self.user)
        self.client.force_authenticate(user=moderator)

        response = self.client.post(
            f'/openfarmplanner/api/crop-species/{proposal.id}/approve/',
            self.species_approval_payload(german_name='Baumzwiebel', english_name='Tree onion'),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        proposal.refresh_from_db()
        self.assertEqual(proposal.name, 'Tree onion')
        notification = Notification.objects.get(recipient=self.user)
        self.assertEqual(notification.context, {'name': 'Baumzwiebel'})

    def test_approving_a_proposal_links_the_notification_to_the_proposers_variety(self):
        moderator = User.objects.create_user(
            username='species-link-moderator',
            email='species-link-moderator@example.com',
            password='testpass',
            is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        proposal = CropSpecies.objects.create(name='Tree onion', status=CropSpecies.STATUS_PROPOSED, proposed_by=self.user)
        published_variety = PublicCrop.objects.create(
            name='Tree onion', variety='Egyptian', status=PublicCrop.STATUS_PUBLISHED,
            version=1, created_by=self.user, crop_species=proposal,
        )
        self.client.force_authenticate(user=moderator)

        self.client.post(
            f'/openfarmplanner/api/crop-species/{proposal.id}/approve/',
            self.species_approval_payload(),
            format='json',
        )

        notification = Notification.objects.get(recipient=self.user)
        self.assertEqual(notification.target_type, Notification.TARGET_PUBLIC_CROP)
        self.assertEqual(notification.target_id, published_variety.id)

    def test_reviewing_a_species_nobody_proposed_creates_no_notification(self):
        moderator = User.objects.create_user(
            username='species-seed-moderator',
            email='species-seed-moderator@example.com',
            password='testpass',
            is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        proposal = CropSpecies.objects.create(name='Seeded species', status=CropSpecies.STATUS_PROPOSED)
        self.client.force_authenticate(user=moderator)

        response = self.client.post(
            f'/openfarmplanner/api/crop-species/{proposal.id}/approve/',
            self.species_approval_payload(german_name='Saat-Art', english_name='Seeded species'),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(Notification.objects.count(), 0)

    def test_moderator_cannot_approve_species_without_required_translations(self):
        moderator = User.objects.create_user(
            username='species-translation-moderator',
            email='species-translation-moderator@example.com',
            password='testpass',
            is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        proposal = CropSpecies.objects.create(name='Tree onion', status=CropSpecies.STATUS_PROPOSED, proposed_by=self.user)
        self.client.force_authenticate(user=moderator)

        response = self.client.post(
            f'/openfarmplanner/api/crop-species/{proposal.id}/approve/',
            {'translations': [{'language_code': 'en', 'common_name': 'Tree onion'}]},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['code'], 'missing_required_translations')
        self.assertEqual(response.data['detail'], 'Required crop species translations are missing.')
        self.assertEqual(response.data['missing_languages'], ['de'])
        proposal.refresh_from_db()
        self.assertEqual(proposal.status, CropSpecies.STATUS_PROPOSED)

    def test_moderator_cannot_approve_duplicate_species_identity(self):
        moderator = User.objects.create_user(
            username='species-duplicate-moderator',
            email='species-duplicate-moderator@example.com',
            password='testpass',
            is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        existing = CropSpecies.objects.create(name='Tree onion', status=CropSpecies.STATUS_PUBLISHED)
        CropSpeciesTranslation.objects.create(
            species=existing, language_code='de', common_name='Baumzwiebel',
        )
        CropSpeciesTranslation.objects.create(
            species=existing, language_code='en', common_name='Tree onion',
        )
        proposal = CropSpecies.objects.create(
            name='Egyptian onion', status=CropSpecies.STATUS_PROPOSED, proposed_by=self.user,
        )
        self.client.force_authenticate(user=moderator)

        response = self.client.post(
            f'/openfarmplanner/api/crop-species/{proposal.id}/approve/',
            self.species_approval_payload(),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['code'], 'duplicate_crop_species')
        self.assertEqual(response.data['detail'], 'A published crop species with this name already exists.')
        self.assertEqual(response.data['duplicate'], {'id': existing.id, 'name': existing.name})
        proposal.refresh_from_db()
        self.assertEqual(proposal.status, CropSpecies.STATUS_PROPOSED)

    def test_moderator_can_reject_species_proposal(self):
        moderator = User.objects.create_user(
            username='species-reject-moderator',
            email='species-reject-moderator@example.com',
            password='testpass',
            is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        proposal = CropSpecies.objects.create(name='Tree onion', status=CropSpecies.STATUS_PROPOSED, proposed_by=self.user)
        self.client.force_authenticate(user=moderator)

        response = self.client.post(f'/openfarmplanner/api/crop-species/{proposal.id}/reject/', {'review_note': 'Duplicate common name.'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        proposal.refresh_from_db()
        self.assertEqual(proposal.status, CropSpecies.STATUS_REJECTED)
        self.assertEqual(proposal.review_note, 'Duplicate common name.')
        notification = Notification.objects.get(recipient=self.user)
        self.assertEqual(notification.notification_type, Notification.TYPE_CROP_SPECIES_PROPOSAL_REJECTED)
        self.assertEqual(notification.context, {'name': 'Tree onion'})

    def test_rejecting_a_proposal_removes_entries_already_published_under_it(self):
        moderator = User.objects.create_user(
            username='species-cleanup-moderator',
            email='species-cleanup-moderator@example.com',
            password='testpass',
            is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        proposal = CropSpecies.objects.create(
            name='Karotsdasdas', status=CropSpecies.STATUS_PROPOSED, proposed_by=self.user,
        )
        general_entry = PublicCrop.objects.create(
            name='Karotte', variety='', status=PublicCrop.STATUS_PUBLISHED,
            version=1, created_by=self.user, crop_species=proposal,
        )
        variety_entry = PublicCrop.objects.create(
            name='Karotte', variety='Solveig', status=PublicCrop.STATUS_PUBLISHED,
            version=1, created_by=self.user, crop_species=proposal,
        )
        self.client.force_authenticate(user=moderator)

        response = self.client.post(f'/openfarmplanner/api/crop-species/{proposal.id}/reject/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        general_entry.refresh_from_db()
        variety_entry.refresh_from_db()
        for entry in (general_entry, variety_entry):
            self.assertEqual(entry.status, PublicCrop.STATUS_REMOVED)
            self.assertEqual(entry.removal_reason, PublicCrop.REMOVAL_REASON_SPECIES_REJECTED)
            self.assertEqual(entry.status_changed_by, moderator)
        # The species itself is unaffected beyond its own status; its name is
        # left as-is for the moderation log/history, only the entries move.
        proposal.refresh_from_db()
        self.assertEqual(proposal.status, CropSpecies.STATUS_REJECTED)

    def test_rejecting_a_proposal_leaves_other_statuses_under_it_untouched(self):
        moderator = User.objects.create_user(
            username='species-cleanup-moderator-2',
            email='species-cleanup-moderator-2@example.com',
            password='testpass',
            is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        proposal = CropSpecies.objects.create(
            name='Karotsdasdas 2', status=CropSpecies.STATUS_PROPOSED, proposed_by=self.user,
        )
        withdrawn_entry = PublicCrop.objects.create(
            name='Karotte', variety='Withdrawn already', status=PublicCrop.STATUS_WITHDRAWN,
            version=1, created_by=self.user, crop_species=proposal,
        )
        self.client.force_authenticate(user=moderator)

        response = self.client.post(f'/openfarmplanner/api/crop-species/{proposal.id}/reject/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        withdrawn_entry.refresh_from_db()
        self.assertEqual(withdrawn_entry.status, PublicCrop.STATUS_WITHDRAWN)
        self.assertEqual(withdrawn_entry.removal_reason, '')

    def test_rejecting_a_proposal_notifies_other_contributors_of_removed_entries(self):
        """A collaborator who published under someone else's pending species
        must learn their own entry was pulled, not just the proposer."""
        moderator = User.objects.create_user(
            username='species-cleanup-moderator-3',
            email='species-cleanup-moderator-3@example.com',
            password='testpass',
            is_active=True,
        )
        collaborator = User.objects.create_user(
            username='species-cleanup-collaborator',
            email='species-cleanup-collaborator@example.com',
            password='testpass',
            is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        proposal = CropSpecies.objects.create(
            name='Karotsdasdas 3', status=CropSpecies.STATUS_PROPOSED, proposed_by=self.user,
        )
        collaborator_entry = PublicCrop.objects.create(
            name='Karotte', variety='Collaborator', status=PublicCrop.STATUS_PUBLISHED,
            version=1, created_by=collaborator, crop_species=proposal,
        )
        self.client.force_authenticate(user=moderator)

        response = self.client.post(f'/openfarmplanner/api/crop-species/{proposal.id}/reject/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        collaborator_entry.refresh_from_db()
        self.assertEqual(collaborator_entry.status, PublicCrop.STATUS_REMOVED)
        collaborator_notification = Notification.objects.get(
            recipient=collaborator, notification_type=Notification.TYPE_PUBLIC_CROP_REMOVED,
        )
        self.assertEqual(collaborator_notification.target_id, collaborator_entry.id)
        # The proposer already gets the species-level notification and must
        # not also receive a redundant per-entry one.
        self.assertFalse(
            Notification.objects.filter(
                recipient=self.user, notification_type=Notification.TYPE_PUBLIC_CROP_REMOVED,
            ).exists(),
        )

    def test_rejecting_own_proposal_as_moderator_still_records_the_real_reason(self):
        """A moderator who proposed and self-published under their own proposal,
        then rejects it, must still get a moderation-tracked removal, not a
        self-reversible withdrawal that loses the reason."""
        moderator = User.objects.create_user(
            username='species-self-reject-moderator',
            email='species-self-reject-moderator@example.com',
            password='testpass',
            is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        proposal = CropSpecies.objects.create(
            name='Karotsdasdas 4', status=CropSpecies.STATUS_PROPOSED, proposed_by=moderator,
        )
        own_entry = PublicCrop.objects.create(
            name='Karotte', variety='Self-published', status=PublicCrop.STATUS_PUBLISHED,
            version=1, created_by=moderator, crop_species=proposal,
        )
        self.client.force_authenticate(user=moderator)

        response = self.client.post(f'/openfarmplanner/api/crop-species/{proposal.id}/reject/', {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        own_entry.refresh_from_db()
        self.assertEqual(own_entry.status, PublicCrop.STATUS_REMOVED)
        self.assertEqual(own_entry.removal_reason, PublicCrop.REMOVAL_REASON_SPECIES_REJECTED)

    def test_normal_user_cannot_edit_or_delete_published_species(self):
        species = CropSpecies.objects.create(name='Purple Sprouting Broccoli', status=CropSpecies.STATUS_PUBLISHED)
        self.client.force_authenticate(user=self.user)

        update_response = self.client.patch(f'/openfarmplanner/api/crop-species/{species.id}/', {'name': 'Hacked'}, format='json')
        delete_response = self.client.delete(f'/openfarmplanner/api/crop-species/{species.id}/')

        self.assertEqual(update_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(delete_response.status_code, status.HTTP_403_FORBIDDEN)
        species.refresh_from_db()
        self.assertEqual(species.name, 'Purple Sprouting Broccoli')

    def test_moderator_can_edit_and_delete_published_species(self):
        moderator = User.objects.create_user(
            username='species-edit-moderator',
            email='species-edit-moderator@example.com',
            password='testpass',
            is_active=True,
        )
        grant_public_library_moderator_access(moderator)
        species = CropSpecies.objects.create(name='Purple Sprouting Broccoli', status=CropSpecies.STATUS_PUBLISHED)
        self.client.force_authenticate(user=moderator)

        update_response = self.client.patch(f'/openfarmplanner/api/crop-species/{species.id}/', {'name': 'Purple Sprouting Broccoli (renamed)'}, format='json')
        self.assertEqual(update_response.status_code, status.HTTP_200_OK)
        species.refresh_from_db()
        self.assertEqual(species.name, 'Purple Sprouting Broccoli (renamed)')

        delete_response = self.client.delete(f'/openfarmplanner/api/crop-species/{species.id}/')
        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(CropSpecies.objects.filter(id=species.id).exists())

    def test_user_can_request_moderator_access_once(self):
        self.client.force_authenticate(user=self.user)

        response = self.client.post('/openfarmplanner/api/public-library/moderator-requests/', {'motivation': 'I can help.'}, format='json')
        duplicate_response = self.client.post('/openfarmplanner/api/public-library/moderator-requests/', {'motivation': 'Still can help.'}, format='json')
        mine_response = self.client.get('/openfarmplanner/api/public-library/moderator-requests/mine/')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(duplicate_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(mine_response.data['is_moderator'])
        self.assertEqual(mine_response.data['request']['status'], PublicLibraryModeratorRequest.STATUS_PENDING)

    def test_guest_demo_user_cannot_request_moderator_access(self):
        demo_session = create_guest_demo_session()
        self.client.force_authenticate(user=demo_session.user)

        response = self.client.post(
            '/openfarmplanner/api/public-library/moderator-requests/',
            {'motivation': 'Demo request'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['code'], 'guest_demo_restricted')
        self.assertFalse(PublicLibraryModeratorRequest.objects.filter(user=demo_session.user).exists())

    def test_moderator_request_create_notifies_admins_only(self):
        admin = User.objects.create_user(
            username='request-admin', email='request-admin@example.com', password='testpass',
            is_active=True, is_staff=True,
        )
        plain_moderator = User.objects.create_user(
            username='plain-moderator', email='plain-moderator@example.com',
            password='testpass', is_active=True,
        )
        grant_public_library_moderator_access(plain_moderator)
        self.user.first_name = 'Ada'
        self.user.last_name = 'Lovelace'
        self.user.save()
        self.client.force_authenticate(user=self.user)

        response = self.client.post(
            '/openfarmplanner/api/public-library/moderator-requests/',
            {'motivation': 'I can help.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        moderator_request = PublicLibraryModeratorRequest.objects.get(user=self.user)
        notification = Notification.objects.get(recipient=admin)
        self.assertEqual(
            notification.notification_type,
            Notification.TYPE_MODERATOR_REQUEST_SUBMITTED,
        )
        self.assertEqual(notification.context, {'name': 'Ada Lovelace'})
        self.assertEqual(notification.target_type, Notification.TARGET_PUBLIC_LIBRARY_MODERATION)
        self.assertEqual(notification.target_id, moderator_request.id)
        # A moderator without admin rights reviews species, not access requests.
        self.assertFalse(Notification.objects.filter(recipient=plain_moderator).exists())

    def test_admin_can_approve_moderator_request_without_staff_rights_for_user(self):
        admin = User.objects.create_user(
            username='admin',
            email='admin@example.com',
            password='testpass',
            is_active=True,
            is_staff=True,
        )
        moderator_request = PublicLibraryModeratorRequest.objects.create(
            user=self.user, motivation='I can help.',
        )
        self.client.force_authenticate(user=admin)

        response = self.client.post(
            f'/openfarmplanner/api/public-library/moderator-requests/{moderator_request.id}/approve/',
            {'review_note': 'Welcome.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        moderator_request.refresh_from_db()
        self.user.refresh_from_db()
        self.assertEqual(moderator_request.status, PublicLibraryModeratorRequest.STATUS_APPROVED)
        self.assertTrue(self.user.has_perm('crops.moderate_crop_species'))
        self.assertFalse(self.user.is_staff)


class CropLibraryQueryCountTest(DRFAPITestCase):
    """Query-count regressions for the crop-library list endpoints.

    Both lists resolve a localized species name per row, so a missing prefetch
    turns into one query per result. The counts below must stay constant no
    matter how many rows the page holds — see
    `farm/tests/test_api_query_counts.py` for the same guard on the project
    API.
    """

    ROW_COUNT = 4

    def setUp(self):
        self.user = User.objects.create_user(
            username='crop-query-user', email='crop-query@example.com',
            password='testpass', is_active=True,
        )
        self.client.force_authenticate(user=self.user)
        for index in range(self.ROW_COUNT):
            species = CropSpecies.objects.create(name=f'Query count species {index}')
            CropSpeciesTranslation.objects.create(
                species=species, language_code='de', common_name=f'Art {index}',
            )
            CropSpeciesTranslation.objects.create(
                species=species, language_code='en', common_name=f'Species {index}',
            )
            PublicCrop.objects.create(
                name=f'Query count crop {index}', variety='Sorte', crop_species=species,
                status=PublicCrop.STATUS_PUBLISHED, version=1, created_by=self.user,
            )

    def test_crop_species_list_query_count(self):
        """`translations`, `display_name` and `display_language_code` all read
        the same prefetched translation rows."""
        with self.assertNumQueries(8):
            response = self.client.get('/openfarmplanner/api/crop-species/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(response.data['results']), self.ROW_COUNT)

    def test_crops_list_query_count(self):
        """Published crops resolve a species name, a description and a
        contributor label per row."""
        with self.assertNumQueries(7):
            response = self.client.get('/openfarmplanner/api/crop-library/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(response.data['results']), self.ROW_COUNT)

    def test_moderator_requests_list_query_count(self):
        moderator = User.objects.create_user(
            username='crop-query-admin', email='crop-query-admin@example.com',
            password='testpass', is_active=True, is_staff=True,
        )
        for index in range(self.ROW_COUNT):
            requester = User.objects.create_user(
                username=f'crop-query-requester-{index}',
                email=f'crop-query-requester-{index}@example.com',
                password='testpass',
                is_active=True,
            )
            PublicLibraryModeratorRequest.objects.create(user=requester, motivation='I can help.')
        self.client.force_authenticate(user=moderator)

        with self.assertNumQueries(4):
            response = self.client.get('/openfarmplanner/api/public-library/moderator-requests/')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), self.ROW_COUNT)
