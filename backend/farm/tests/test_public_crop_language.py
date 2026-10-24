"""Cross-language duplicate detection and description translations.

The core rule: "Tomate + Moneymaker" and "Tomato + Moneymaker" are the same
crop. Duplicate detection must recognise that through the language-independent
species, not through whichever localized name a user happened to type. The
same holds for a variety's trade names: "Poire jaune" is "Gelbe Birne".
"""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import override_settings
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

from accounts.data_export import build_personal_data_export
from accounts.guest_demo import create_guest_demo_session
from crops.models import CropSpecies, CropSpeciesTranslation
from crops.services import find_exact_crop_match
from farm.crops.views.public import PublicCropViewSet
from farm.models import (
    Crop,
    ProjectApiToken,
    PublicCrop,
    PublicCropChangeProposal,
    PublicCropReport,
    PublicCropTradeName,
    PublicCropTradeNameEvent,
    PublicCropTranslation,
)
from farm.services.crop_display import resolve_crop_display_name
from farm.services.public_crop_trade_names import find_trade_name_conflict
from farm.services.public_crops import (
    PublicCropIdentityConflictError,
    detect_public_crop_duplicates,
    normalize_language_code,
    replace_public_crop_translations,
    sync_original_language_translation,
    update_public_crop_directly,
)
from farm.tests.api_base import ProjectApiTestCase
from notifications.models import Notification


class CrossLanguageDuplicateDetectionTest(ProjectApiTestCase):
    def setUp(self):
        super().setUp()
        self.species = CropSpecies.objects.get(name_normalized='tomate')
        for language_code, common_name in (('de', 'Tomate'), ('en', 'Tomato')):
            CropSpeciesTranslation.objects.update_or_create(
                species=self.species,
                language_code=language_code,
                defaults={'common_name': common_name},
            )
        self.published = PublicCrop.objects.create(
            name='Tomate',
            variety='Moneymaker',
            status=PublicCrop.STATUS_PUBLISHED,
            crop_species=self.species,
            original_language_code='de',
            version=1,
            created_by=self.user,
        )

    def _crop(self, **overrides) -> Crop:
        defaults = {
            'name': 'Tomate',
            'variety': 'Moneymaker',
            'growth_duration_days': 60,
            'harvest_duration_days': 20,
            'project': self.project,
        }
        defaults.update(overrides)
        return Crop.objects.create(**defaults)

    def test_the_english_name_of_the_same_species_is_detected_as_a_duplicate(self):
        candidate = self._crop(name='Tomato', crop_species=self.species)

        duplicates = detect_public_crop_duplicates(candidate)

        self.assertEqual([item.id for item in duplicates], [self.published.id])

    def test_the_german_name_of_the_same_species_is_detected_as_a_duplicate(self):
        candidate = self._crop(name='Tomate', crop_species=self.species)

        self.assertEqual(
            [item.id for item in detect_public_crop_duplicates(candidate)],
            [self.published.id],
        )

    def test_resolves_the_species_from_the_name_when_none_is_linked(self):
        # No crop_species on the crop: the English name must still resolve
        # to the shared species and find the German entry.
        candidate = self._crop(name='Tomato')

        self.assertEqual(
            [item.id for item in detect_public_crop_duplicates(candidate)],
            [self.published.id],
        )

    def test_a_different_variety_of_the_same_species_is_not_a_duplicate(self):
        candidate = self._crop(name='Tomato', variety='Ochsenherz', crop_species=self.species)

        self.assertEqual(detect_public_crop_duplicates(candidate), [])

    def test_variety_comparison_ignores_casing_and_surrounding_whitespace(self):
        for variety in ('moneymaker', '  Moneymaker  ', 'MONEYMAKER', 'Money  maker'):
            candidate = self._crop(name='Tomato', variety=variety, crop_species=self.species)
            expected = [] if variety == 'Money  maker' else [self.published.id]
            self.assertEqual(
                [item.id for item in detect_public_crop_duplicates(candidate)],
                expected,
                variety,
            )

    def test_normalization_never_rewrites_the_stored_variety_name(self):
        candidate = self._crop(
            name='Tomato', variety='  Moneymaker  ', crop_species=self.species,
        )

        detect_public_crop_duplicates(candidate)
        candidate.refresh_from_db()
        self.published.refresh_from_db()

        self.assertEqual(candidate.variety, '  Moneymaker  ')
        self.assertEqual(self.published.variety, 'Moneymaker')

    def test_a_different_species_is_not_a_duplicate(self):
        carrot = CropSpecies.objects.get(name_normalized='karotte')
        candidate = self._crop(name='Karotte', crop_species=carrot)

        self.assertEqual(detect_public_crop_duplicates(candidate), [])

    def test_a_supplier_difference_no_longer_separates_entries(self):
        # Supplier is private, farm-specific data and is not part of the
        # public identity, so a differing supplier alone must not prevent
        # this from being flagged as a duplicate of the same species+variety.
        candidate = self._crop(
            name='Tomato', crop_species=self.species, seed_supplier='Anderer Lieferant',
        )

        self.assertEqual(
            [item.id for item in detect_public_crop_duplicates(candidate)],
            [self.published.id],
        )

    def test_legacy_entries_without_a_species_are_still_matched_by_name(self):
        legacy = PublicCrop.objects.create(
            name='Pastinake',
            variety='Halblange',
            status=PublicCrop.STATUS_PUBLISHED,
            version=1,
            created_by=self.user,
        )
        candidate = self._crop(name='Pastinake', variety='Halblange')

        self.assertIn(legacy.id, [item.id for item in detect_public_crop_duplicates(candidate)])


class VarietyTradeNameTest(ProjectApiTestCase):
    """Trade names: display without fallback, search, and identity lookups.

    See docs/rfc-variety-trade-names.md.
    """

    def setUp(self):
        super().setUp()
        self.species = CropSpecies.objects.get(name_normalized='tomate')
        for language_code, common_name in (('de', 'Tomate'), ('en', 'Tomato'), ('fr', 'Tomate')):
            CropSpeciesTranslation.objects.update_or_create(
                species=self.species,
                language_code=language_code,
                defaults={'common_name': common_name},
            )
        self.gelbe_birne = self._entry('Gelbe Birne')
        self.poire_jaune = PublicCropTradeName.objects.create(
            public_crop=self.gelbe_birne, language_code='fr', name='Poire jaune',
            source_url='https://example.com/poire-jaune',
        )
        PublicCropTradeName.objects.create(
            public_crop=self.gelbe_birne, language_code='en', name='Yellow Pear',
        )

    def _entry(self, variety: str, **overrides) -> PublicCrop:
        defaults = {
            'name': 'Tomate',
            'variety': variety,
            'status': PublicCrop.STATUS_PUBLISHED,
            'crop_species': self.species,
            'original_language_code': 'de',
            'version': 1,
            'created_by': self.user,
        }
        defaults.update(overrides)
        return PublicCrop.objects.create(**defaults)

    def _crop(self, variety: str) -> Crop:
        return Crop.objects.create(
            name='Tomate', variety=variety, crop_species=self.species,
            growth_duration_days=60, harvest_duration_days=20, project=self.project,
        )

    def _get(self, url: str):
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def test_trade_name_is_stored_normalized_for_search(self):
        trade_name = PublicCropTradeName.objects.create(
            public_crop=self._entry('Ochsenherz'), language_code=' FR ', name='  Cœur  de bœuf ',
        )

        self.assertEqual(trade_name.language_code, 'fr')
        self.assertEqual(trade_name.name, 'Cœur de bœuf')
        self.assertEqual(trade_name.name_normalized, 'coeur de boeuf')

    def test_display_uses_the_trade_name_of_the_request_language_then_the_original(self):
        self.assertEqual(self.gelbe_birne.variety_display('fr'), 'Poire jaune (Gelbe Birne)')
        self.assertEqual(self.gelbe_birne.variety_trade_name('fr'), 'Poire jaune')

    def test_display_never_falls_back_to_another_languages_trade_name(self):
        # Spanish has no trade name: the original alone, not "Yellow Pear".
        self.assertEqual(self.gelbe_birne.variety_display('es'), 'Gelbe Birne')
        self.assertIsNone(self.gelbe_birne.variety_trade_name('es'))
        self.assertEqual(self.gelbe_birne.variety_display('de'), 'Gelbe Birne')

    def test_api_serves_resolved_and_raw_trade_names(self):
        for url in (
            f'/openfarmplanner/api/public-crops/{self.gelbe_birne.id}/?language=fr',
            f'/openfarmplanner/api/crop-library/{self.gelbe_birne.id}/?language=fr',
        ):
            with self.subTest(url=url):
                data = self._get(url)
                self.assertEqual(data['variety'], 'Gelbe Birne')
                self.assertEqual(data['variety_trade_name'], 'Poire jaune')
                self.assertEqual(data['variety_display'], 'Poire jaune (Gelbe Birne)')
                self.assertEqual(data['trade_names'], {
                    'en': {'name': 'Yellow Pear', 'source_url': ''},
                    'fr': {'name': 'Poire jaune', 'source_url': 'https://example.com/poire-jaune'},
                })

    def test_api_serves_the_original_alone_without_a_trade_name(self):
        data = self._get(f'/openfarmplanner/api/public-crops/{self.gelbe_birne.id}/?language=es')

        self.assertIsNone(data['variety_trade_name'])
        self.assertEqual(data['variety_display'], 'Gelbe Birne')

    def test_search_finds_trade_names_of_every_language(self):
        for query in ('Poire jaune', 'yellow pear', 'Gelbe Birne'):
            for url in ('/openfarmplanner/api/public-crops/', '/openfarmplanner/api/crop-library/'):
                with self.subTest(query=query, url=url):
                    data = self._get(f'{url}?q={query}&language=de')
                    self.assertEqual([row['id'] for row in data['results']], [self.gelbe_birne.id])

    def test_search_folds_diacritics_and_ligatures_of_trade_names(self):
        entry = self._entry('Ochsenherz')
        for language_code, name in (('fr', 'Cœur de bœuf'), ('es', 'Corazón de buey')):
            PublicCropTradeName.objects.create(
                public_crop=entry, language_code=language_code, name=name,
            )

        for query in ('coeur de boeuf', 'corazon'):
            with self.subTest(query=query):
                data = self._get(f'/openfarmplanner/api/public-crops/?variety={query}')
                self.assertEqual([row['id'] for row in data['results']], [entry.id])

    def test_publishing_a_trade_name_finds_the_original_entry(self):
        duplicates = detect_public_crop_duplicates(self._crop('Poire jaune'))

        self.assertEqual([item.id for item in duplicates], [self.gelbe_birne.id])
        self.assertEqual(
            duplicates[0].matched_trade_name, {'language_code': 'fr', 'name': 'Poire jaune'},
        )

    def test_publishing_the_original_name_reports_no_trade_name_match(self):
        duplicates = detect_public_crop_duplicates(self._crop('gelbe birne'))

        self.assertEqual([item.id for item in duplicates], [self.gelbe_birne.id])
        self.assertIsNone(duplicates[0].matched_trade_name)

    def test_exact_match_resolves_a_trade_name_to_the_entry(self):
        self.assertEqual(
            find_exact_crop_match(name='Tomato', variety='Yellow Pear'), self.gelbe_birne,
        )

        data = self._get(
            '/openfarmplanner/api/public-crops/match/?name=Tomate&variety=Poire%20jaune',
        )
        self.assertEqual(data['crop']['id'], self.gelbe_birne.id)
        self.assertEqual(
            data['crop']['matched_trade_name'], {'language_code': 'fr', 'name': 'Poire jaune'},
        )

    def test_trade_name_conflicts_with_another_entrys_original_or_trade_name(self):
        separate = self._entry('Poire jaune')
        other = self._entry('Ochsenherz')

        self.assertEqual(find_trade_name_conflict(other, 'POIRE JAUNE'), separate)
        self.assertEqual(find_trade_name_conflict(other, 'Yellow Pear'), self.gelbe_birne)
        self.assertIsNone(find_trade_name_conflict(other, 'Cœur de bœuf'))

    def test_trade_names_of_another_species_do_not_conflict(self):
        other_species = CropSpecies.objects.exclude(pk=self.species.pk).first()
        other = self._entry('Ochsenherz', name='Paprika', crop_species=other_species)

        self.assertIsNone(find_trade_name_conflict(other, 'Yellow Pear'))

    def test_renaming_a_variety_onto_another_entrys_trade_name_is_a_conflict(self):
        other = self._entry('Ochsenherz')
        admin = get_user_model().objects.create_user(
            username='trade-admin', email='trade-admin@example.com', password='pw', is_staff=True,
        )

        with self.assertRaises(PublicCropIdentityConflictError):
            update_public_crop_directly(
                public_crop=other, user=admin, data={'variety': 'Yellow Pear'},
            )

    def test_renaming_onto_its_own_trade_name_drops_it_and_records_why(self):
        update_public_crop_directly(
            public_crop=self.gelbe_birne,
            user=self.user,
            data={'variety': 'Poire jaune'},
            allow_variety_rename=True,
        )

        self.assertEqual(
            sorted(self.gelbe_birne.trade_names.values_list('language_code', flat=True)), ['en'],
        )
        event = PublicCropTradeNameEvent.objects.get(public_crop=self.gelbe_birne)
        self.assertEqual(
            (event.action, event.language_code, event.old_name, event.created_by),
            (PublicCropTradeNameEvent.ACTION_REMOVED, 'fr', 'Poire jaune', self.user),
        )

    def test_a_species_level_entry_never_shows_a_trade_name(self):
        general = self._entry('')
        PublicCropTradeName.objects.create(public_crop=general, language_code='fr', name='Tomate')

        self.assertEqual(general.variety_display('fr'), '')


class VarietyTradeNameEditingApiTest(ProjectApiTestCase):
    """Phase 2: unmoderated editing with history, revert, reports and throttling."""

    def setUp(self):
        super().setUp()
        cache.clear()
        self.species = CropSpecies.objects.get(name_normalized='tomate')
        self.entry = PublicCrop.objects.create(
            name='Tomate', variety='Gelbe Birne', status=PublicCrop.STATUS_PUBLISHED,
            crop_species=self.species, original_language_code='de', version=3,
            created_by=self.user,
        )
        self.url = f'/openfarmplanner/api/public-crops/{self.entry.id}/trade-names/'
        self.moderator = get_user_model().objects.create_user(
            username='trade-moderator', email='trade-moderator@example.com',
            password='pw', is_staff=True,
        )

    def _put(self, trade_names, **extra):
        return self.client.put(self.url, {'trade_names': trade_names, **extra}, format='json')

    def _set_fr(self, name='Poire jaune'):
        response = self._put({'fr': {'name': name, 'source_url': 'https://example.com/poire'}})
        self.assertEqual(response.status_code, 200, response.data)
        return response

    def test_any_signed_in_user_sets_a_trade_name_live_and_it_is_recorded(self):
        # The fixture user is a brand-new account: no moderation queue (D4).
        response = self._set_fr()

        self.assertEqual(response.data, {
            'variety': 'Gelbe Birne',
            'trade_names': {'fr': {'name': 'Poire jaune', 'source_url': 'https://example.com/poire'}},
        })
        trade_name = PublicCropTradeName.objects.get(public_crop=self.entry)
        self.assertEqual((trade_name.created_by, trade_name.updated_by), (self.user, self.user))
        event = PublicCropTradeNameEvent.objects.get(public_crop=self.entry)
        self.assertEqual(
            (event.action, event.language_code, event.old_name, event.new_name, event.created_by),
            (PublicCropTradeNameEvent.ACTION_SET, 'fr', '', 'Poire jaune', self.user),
        )
        self.assertFalse(PublicCropChangeProposal.objects.exists())

    def test_trade_name_edits_never_bump_the_entry_version(self):
        self._set_fr()

        self.entry.refresh_from_db()
        self.assertEqual(self.entry.version, 3)

    def test_omitted_languages_stay_and_null_removes_one(self):
        self._set_fr()
        self._put({'en': {'name': 'Yellow Pear'}})

        response = self._put({'en': None})

        self.assertEqual(list(response.data['trade_names']), ['fr'])
        removal = PublicCropTradeNameEvent.objects.filter(public_crop=self.entry).first()
        self.assertEqual(
            (removal.action, removal.language_code, removal.old_name),
            (PublicCropTradeNameEvent.ACTION_REMOVED, 'en', 'Yellow Pear'),
        )

    def test_an_unchanged_value_records_no_event(self):
        self._set_fr()
        self._set_fr()

        self.assertEqual(PublicCropTradeNameEvent.objects.filter(public_crop=self.entry).count(), 1)

    def test_a_trade_name_equal_to_the_original_is_rejected(self):
        response = self._put({'de': {'name': 'gelbe  BIRNE'}})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'], 'trade_name_equals_original')

    def test_a_species_level_entry_rejects_trade_names(self):
        general = PublicCrop.objects.create(
            name='Tomate', variety='', status=PublicCrop.STATUS_PUBLISHED,
            crop_species=self.species,
        )

        response = self.client.put(
            f'/openfarmplanner/api/public-crops/{general.id}/trade-names/',
            {'trade_names': {'fr': {'name': 'Tomate'}}}, format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['code'], 'trade_name_general_entry')

    def test_a_name_identifying_another_entry_is_a_conflict_and_nothing_is_saved(self):
        other = PublicCrop.objects.create(
            name='Tomate', variety='Poire jaune', status=PublicCrop.STATUS_PUBLISHED,
            crop_species=self.species,
        )

        response = self._put({'en': {'name': 'Yellow Pear'}, 'fr': {'name': 'Poire Jaune'}})

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['code'], 'trade_name_conflict')
        self.assertEqual(response.data['conflicting_public_crop_id'], other.id)
        self.assertFalse(PublicCropTradeName.objects.exists())
        self.assertFalse(PublicCropTradeNameEvent.objects.exists())

    def test_expected_names_guard_against_overwriting_a_concurrent_edit(self):
        self._set_fr()

        stale = self._put({'fr': {'name': 'Poire jaune longue'}}, expected={'fr': None})
        fresh = self._put({'fr': {'name': 'Poire jaune longue'}}, expected={'fr': 'Poire jaune'})

        self.assertEqual(stale.status_code, 409)
        self.assertEqual(
            (stale.data['code'], stale.data['current_name']),
            ('trade_name_edit_conflict', 'Poire jaune'),
        )
        self.assertEqual(fresh.status_code, 200, fresh.data)

    def test_invalid_language_codes_and_source_links_are_rejected(self):
        for payload in (
            {'xx': {'name': 'Nome'}},
            {'fr': {'name': 'Poire jaune', 'source_url': 'ftp://example.com/x'}},
            {'fr': {'name': 'Poire jaune', 'source_url': 'javascript:alert(1)'}},
        ):
            with self.subTest(payload=payload):
                self.assertEqual(self._put(payload).status_code, 400)

    def test_history_lists_events_with_pseudonymous_authors(self):
        self._set_fr()
        self._set_fr('Poire jaune longue')

        response = self.client.get(f'{self.url}history/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [row['new_name'] for row in response.data], ['Poire jaune longue', 'Poire jaune'],
        )
        self.assertEqual(response.data[0]['created_by_label'], '')
        self.assertEqual(response.data[0]['created_by_anonymous_number'], 1)
        self.assertNotIn('created_by', response.data[0])

    def test_revert_restores_the_replaced_value_as_a_new_event(self):
        self._set_fr()
        self._set_fr('Spam')
        vandalism = PublicCropTradeNameEvent.objects.filter(public_crop=self.entry).first()
        self.client.force_authenticate(self.moderator)

        response = self.client.post(f'{self.url}history/{vandalism.id}/revert/')

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['trade_names']['fr']['name'], 'Poire jaune')
        revert = PublicCropTradeNameEvent.objects.filter(public_crop=self.entry).first()
        self.assertEqual(
            (revert.action, revert.reverted_event_id, revert.created_by),
            (PublicCropTradeNameEvent.ACTION_REVERTED, vandalism.id, self.moderator),
        )

    def test_reverting_the_first_entry_removes_the_name(self):
        self._set_fr()
        creation = PublicCropTradeNameEvent.objects.get(public_crop=self.entry)

        response = self.client.post(f'{self.url}history/{creation.id}/revert/')

        self.assertEqual(response.data['trade_names'], {})

    def test_reverting_an_unknown_event_is_not_found(self):
        response = self.client.post(f'{self.url}history/999999/revert/')

        self.assertEqual(response.status_code, 404)

    def test_report_notifies_moderators_once_and_updates_on_repeat(self):
        self._set_fr()
        report_url = f'/openfarmplanner/api/public-crops/{self.entry.id}/reports/'

        first = self.client.post(
            report_url, {'language_code': 'fr', 'reason': 'self_translated'}, format='json',
        )
        again = self.client.post(
            report_url,
            {'language_code': 'fr', 'reason': 'spam', 'note': 'Still wrong'},
            format='json',
        )

        self.assertEqual((first.status_code, again.status_code), (201, 200))
        report = PublicCropReport.objects.get()
        self.assertEqual(
            (report.reported_name, report.reason, report.note, report.reported_by),
            ('Poire jaune', 'spam', 'Still wrong', self.user),
        )
        notification = Notification.objects.get(recipient=self.moderator)
        self.assertEqual(
            notification.notification_type, Notification.TYPE_PUBLIC_CROP_TRADE_NAME_REPORTED,
        )
        self.assertEqual(notification.context['name'], 'Poire jaune')
        self.assertFalse(Notification.objects.filter(recipient=self.user).exists())

    def test_reporting_a_language_without_a_trade_name_is_not_found(self):
        response = self.client.post(
            f'/openfarmplanner/api/public-crops/{self.entry.id}/reports/',
            {'language_code': 'es', 'reason': 'other'}, format='json',
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.data['code'], 'trade_name_not_found')

    def test_only_moderators_see_and_resolve_reports(self):
        self._set_fr()
        report, _ = PublicCropReport.objects.get_or_create(
            public_crop=self.entry, language_code='fr', reason='spam',
            reported_name='Poire jaune', reported_by=self.user,
        )
        list_url = '/openfarmplanner/api/public-crops/reports/'
        resolve_url = f'{list_url}{report.id}/resolve/'

        self.assertEqual(self.client.get(list_url).status_code, 403)
        denied = self.client.post(resolve_url, {'status': 'dismissed'}, format='json')
        self.assertEqual(denied.status_code, 403)

        self.client.force_authenticate(self.moderator)
        listing = self.client.get(list_url)
        resolved = self.client.post(
            resolve_url, {'status': 'dismissed', 'note': 'Correct'}, format='json',
        )

        self.assertEqual([row['id'] for row in listing.data['results']], [report.id])
        self.assertEqual(listing.data['results'][0]['current_name'], 'Poire jaune')
        self.assertEqual(resolved.status_code, 200, resolved.data)
        self.assertEqual(resolved.data['status'], 'dismissed')
        self.assertEqual(self.client.get(list_url).data['results'], [])
        self.assertEqual(
            self.client.post(resolve_url, {'status': 'resolved'}, format='json').data['code'],
            'report_not_open',
        )

    def test_guest_demo_users_cannot_edit_or_report(self):
        self._set_fr()
        self.client.force_authenticate(create_guest_demo_session().user)

        edit = self._put({'es': {'name': 'Pera amarilla'}})
        report = self.client.post(
            f'/openfarmplanner/api/public-crops/{self.entry.id}/reports/',
            {'language_code': 'fr', 'reason': 'spam'}, format='json',
        )

        self.assertEqual((edit.status_code, report.status_code), (403, 403))
        self.assertEqual(edit.data['code'], 'guest_demo_restricted')

    def test_project_api_tokens_cannot_write_trade_names(self):
        _token, raw_token = ProjectApiToken.create_token(
            user=self.user, project=self.project, name='Agent', scope=ProjectApiToken.SCOPE_WRITE,
        )
        token_client = APIClient()
        token_client.credentials(HTTP_AUTHORIZATION=f'Bearer {raw_token}')

        response = token_client.put(
            self.url, {'trade_names': {'fr': {'name': 'Poire jaune'}}}, format='json',
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(PublicCropTradeName.objects.exists())

    @override_settings(
        CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}},
    )
    def test_trade_name_writes_are_rate_limited_per_user(self):
        rates = {'public_crop_trade_name_write': '2/hour', 'public_crop_report': '20/hour'}
        with (
            patch.object(ScopedRateThrottle, 'THROTTLE_RATES', rates),
            patch.object(PublicCropViewSet, 'throttle_classes', [ScopedRateThrottle]),
        ):
            statuses = [
                self._put({'fr': {'name': name}}).status_code
                for name in ('Poire jaune', 'Poire jaune 2', 'Poire jaune 3')
            ]
            read = self.client.get(self.url).status_code

        self.assertEqual(statuses, [200, 200, 429])
        self.assertEqual(read, 200)

    def test_personal_data_export_contains_own_changes_and_reports(self):
        self._set_fr()
        PublicCropReport.objects.create(
            public_crop=self.entry, language_code='fr', reason='spam', reported_by=self.user,
            resolved_by=self.moderator,
        )

        export = build_personal_data_export(self.user)

        self.assertEqual(
            [row['new_name'] for row in export['public_library_trade_name_changes']],
            ['Poire jaune'],
        )
        self.assertEqual(len(export['public_library_reports']), 1)
        self.assertNotIn('resolved_by_id', export['public_library_reports'][0])


class PublicCropTranslationTest(ProjectApiTestCase):
    def setUp(self):
        super().setUp()
        self.public_crop = PublicCrop.objects.create(
            name='Tomate',
            variety='Moneymaker',
            notes='Robuste Freilandsorte.',
            status=PublicCrop.STATUS_PUBLISHED,
            original_language_code='de',
            version=1,
            created_by=self.user,
        )

    def test_a_language_may_appear_only_once_per_entry(self):
        from django.db import IntegrityError, transaction

        PublicCropTranslation.objects.create(
            public_crop=self.public_crop, language_code='de', description='Erste',
        )

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                PublicCropTranslation.objects.create(
                    public_crop=self.public_crop, language_code='de', description='Zweite',
                )

    def test_publishing_mirrors_the_description_into_the_original_language(self):
        sync_original_language_translation(self.public_crop)

        self.assertEqual(
            self.public_crop.descriptions_by_language(),
            {'de': 'Robuste Freilandsorte.'},
        )

    def test_localized_description_falls_back_and_reports_the_language(self):
        sync_original_language_translation(self.public_crop)

        self.assertEqual(
            self.public_crop.localized_description('en'),
            ('Robuste Freilandsorte.', 'de'),
        )

    def test_adding_english_leaves_german_untouched(self):
        sync_original_language_translation(self.public_crop)

        replace_public_crop_translations(
            public_crop=self.public_crop,
            user=self.user,
            descriptions={'en': 'Robust outdoor variety.'},
        )

        self.assertEqual(
            self.public_crop.descriptions_by_language(),
            {'de': 'Robuste Freilandsorte.', 'en': 'Robust outdoor variety.'},
        )

    def test_editing_the_original_language_keeps_notes_in_step(self):
        sync_original_language_translation(self.public_crop)

        replace_public_crop_translations(
            public_crop=self.public_crop,
            user=self.user,
            descriptions={'de': 'Überarbeitete Beschreibung.'},
        )
        self.public_crop.refresh_from_db()

        self.assertEqual(self.public_crop.notes, 'Überarbeitete Beschreibung.')

    def test_restoring_an_old_version_also_restores_its_description(self):
        """A rollback must not leave the rolled-back text on display.

        `notes` and the original-language translation are two copies of the
        same text; restoring only one of them would make the entry render the
        version that was just undone.
        """
        from farm.services.public_crops import (
            restore_public_crop_version,
            update_public_crop_directly,
        )

        sync_original_language_translation(self.public_crop)
        update_public_crop_directly(
            public_crop=self.public_crop,
            user=self.user,
            data={'notes': 'Bearbeitete Beschreibung.'},
        )
        self.assertEqual(
            self.public_crop.descriptions_by_language(),
            {'de': 'Bearbeitete Beschreibung.'},
        )

        restored = restore_public_crop_version(
            public_crop=self.public_crop, user=self.user, version=1,
        )

        self.assertEqual(restored.notes, 'Robuste Freilandsorte.')
        self.assertEqual(
            restored.descriptions_by_language(),
            {'de': 'Robuste Freilandsorte.'},
        )
        self.assertEqual(
            restored.localized_description('de'),
            ('Robuste Freilandsorte.', 'de'),
        )

    def test_unsupported_language_codes_are_ignored_not_stored(self):
        sync_original_language_translation(self.public_crop)

        replace_public_crop_translations(
            public_crop=self.public_crop,
            user=self.user,
            descriptions={'it': 'Varietà robusta.'},
        )

        self.assertNotIn('it', self.public_crop.descriptions_by_language())

    def test_the_variety_name_is_never_part_of_the_translated_content(self):
        sync_original_language_translation(self.public_crop)

        self.assertEqual(self.public_crop.display_name('en')[0], 'Tomate')
        self.assertEqual(self.public_crop.variety, 'Moneymaker')

    def test_public_crop_display_name_uses_active_project_region(self):
        species = CropSpecies.objects.get(name_normalized='tomate')
        translation, _ = CropSpeciesTranslation.objects.update_or_create(
            species=species,
            language_code='de',
            defaults={'common_name': 'Tomate'},
        )
        translation.regional_names = {'austria': 'Paradeiser'}
        translation.save()
        self.project.region = 'austria'
        self.project.save(update_fields=['region'])
        self.public_crop.crop_species = species
        self.public_crop.save(update_fields=['crop_species'])

        response = self.client.get(
            f'/openfarmplanner/api/public-crops/{self.public_crop.id}/',
            {'language': 'de'},
            HTTP_X_PROJECT_ID=str(self.project.id),
        )

        self.assertEqual(response.data['display_name'], 'Paradeiser')
        self.assertEqual(response.data['crop_species_name'], 'Paradeiser')


class ProjectCropDisplayNameTest(ProjectApiTestCase):
    """`resolve_crop_display_name` decides which name a project crop shows.

    The status gate is the part worth guarding: only a published species has
    moderator-approved translations, so an unpublished one must never override
    the name the project itself typed.
    """

    def setUp(self):
        super().setUp()
        self.species = CropSpecies.objects.get(name_normalized='tomate')
        for language_code, common_name in (('de', 'Tomate'), ('en', 'Tomato')):
            CropSpeciesTranslation.objects.update_or_create(
                species=self.species,
                language_code=language_code,
                defaults={'common_name': common_name},
            )
        self.crop = Crop.objects.create(name='Hauskultur', project=self.project)

    def _link(self, status_value: str) -> None:
        self.species.status = status_value
        self.species.save(update_fields=['status'])
        self.crop.crop_species = self.species
        self.crop.save(update_fields=['crop_species'])

    def test_uses_the_species_translation_for_the_requested_language(self):
        self._link(CropSpecies.STATUS_PUBLISHED)

        self.assertEqual(resolve_crop_display_name(self.crop, 'de'), ('Tomate', 'de'))
        self.assertEqual(resolve_crop_display_name(self.crop, 'en'), ('Tomato', 'en'))

    def test_reports_the_language_actually_served_when_falling_back(self):
        self._link(CropSpecies.STATUS_PUBLISHED)
        CropSpeciesTranslation.objects.filter(species=self.species, language_code='de').delete()

        self.assertEqual(resolve_crop_display_name(self.crop, 'de'), ('Tomato', 'en'))

    def test_prefers_the_regional_name_when_one_is_requested(self):
        self._link(CropSpecies.STATUS_PUBLISHED)
        translation = CropSpeciesTranslation.objects.get(species=self.species, language_code='de')
        translation.regional_names = {'austria': 'Paradeiser'}
        translation.save(update_fields=['regional_names'])

        self.assertEqual(
            resolve_crop_display_name(self.crop, 'de', region='austria'), ('Paradeiser', 'de'),
        )

    def test_keeps_the_crops_own_name_when_no_species_is_linked(self):
        self.assertIsNone(self.crop.crop_species)

        self.assertEqual(resolve_crop_display_name(self.crop, 'de'), ('Hauskultur', ''))

    def test_keeps_the_crops_own_name_for_a_still_proposed_species(self):
        """A proposal has no approved translations yet, so its name is not
        authoritative — the empty language code tells callers that."""
        self._link(CropSpecies.STATUS_PROPOSED)

        self.assertEqual(resolve_crop_display_name(self.crop, 'de'), ('Hauskultur', ''))

    def test_keeps_the_crops_own_name_for_a_rejected_species(self):
        """A rejected species keeps whatever free text the proposer typed, which
        can be an unrelated placeholder."""
        self._link(CropSpecies.STATUS_REJECTED)

        self.assertEqual(resolve_crop_display_name(self.crop, 'de'), ('Hauskultur', ''))

    def test_an_empty_language_code_still_resolves_to_a_real_name(self):
        self._link(CropSpecies.STATUS_PUBLISHED)

        display_name, _ = resolve_crop_display_name(self.crop, '')

        self.assertIn(display_name, {'Tomate', 'Tomato'})


class LanguageCodeNormalizationTest(ProjectApiTestCase):
    def test_accepts_supported_codes_and_rejects_the_rest(self):
        self.assertEqual(normalize_language_code('de'), 'de')
        self.assertEqual(normalize_language_code('EN'), 'en')
        self.assertEqual(normalize_language_code('de-AT'), 'de')
        self.assertEqual(normalize_language_code('fr'), 'fr')
        self.assertEqual(normalize_language_code('es-419'), 'es')
        self.assertEqual(normalize_language_code('it'), '')
        self.assertEqual(normalize_language_code(None), '')
