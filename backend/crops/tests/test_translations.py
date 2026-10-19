"""Multilingual crop library: model, API, search and duplicate detection.

The rule these tests protect: a German and an English name of the same crop
are two translations of *one* language-independent species, never two species.
"""

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.db import IntegrityError, connection, transaction
from django.test.utils import CaptureQueriesContext
from rest_framework import status
from rest_framework.test import APITestCase as DRFAPITestCase

from crops.models import CropSpecies, CropSpeciesTranslation
from crops.services import find_exact_crop_match, find_species_by_common_name, list_published_crops
from farm.models import PublicCrop, PublicCropTranslation

User = get_user_model()


def create_tomato_species() -> CropSpecies:
    """The seeded "Tomate / Tomato" species, with both translations present.

    The seed + backfill migrations already create it, so this reuses that row
    rather than inserting a parallel species — which is exactly the thing the
    whole feature exists to prevent.
    """
    species = CropSpecies.objects.get(name_normalized='tomate')
    for language_code, common_name in (('de', 'Tomate'), ('en', 'Tomato')):
        CropSpeciesTranslation.objects.update_or_create(
            species=species,
            language_code=language_code,
            defaults={'common_name': common_name},
        )
    return species


class CropSpeciesTranslationModelTest(DRFAPITestCase):
    def test_one_species_carries_several_language_versions(self):
        species = create_tomato_species()

        self.assertEqual(species.translations.count(), 2)
        self.assertEqual(
            species.translations_by_language(),
            {'de': 'Tomate', 'en': 'Tomato'},
        )

    def test_a_language_may_appear_only_once_per_species(self):
        species = create_tomato_species()

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                CropSpeciesTranslation.objects.create(
                    species=species, language_code='de', common_name='Paradeiser',
                )

    def test_the_same_language_may_be_reused_across_species(self):
        create_tomato_species()
        carrot = CropSpecies.objects.get(name_normalized='karotte')
        CropSpeciesTranslation.objects.update_or_create(
            species=carrot, language_code='de', defaults={'common_name': 'Karotte'},
        )

        self.assertEqual(
            CropSpeciesTranslation.objects.filter(language_code='de', species=carrot).count(),
            1,
        )

    def test_names_are_normalized_for_matching_without_changing_the_stored_text(self):
        species = CropSpecies.objects.create(name='Testart Normalisierung')
        translation = CropSpeciesTranslation.objects.create(
            species=species, language_code='en', common_name='  Sweet   Pepper  ',
        )
        translation.refresh_from_db()

        # Whitespace is collapsed for storage, but casing is preserved.
        self.assertEqual(translation.common_name, 'Sweet Pepper')
        self.assertEqual(translation.common_name_normalized, 'sweet pepper')

    def test_localized_name_uses_the_requested_language(self):
        species = create_tomato_species()

        self.assertEqual(species.localized_name('de'), ('Tomate', 'de'))
        self.assertEqual(species.localized_name('en'), ('Tomato', 'en'))

    def test_localized_name_uses_regional_override_for_requested_language(self):
        species = create_tomato_species()
        translation = species.translations.get(language_code='de')
        translation.regional_names = {'austria': 'Paradeiser'}
        translation.synonyms = ['Paradeis']
        translation.save()

        self.assertEqual(species.localized_name('de', 'austria'), ('Paradeiser', 'de'))
        self.assertEqual(species.localized_name('de', 'germany'), ('Tomate', 'de'))
        self.assertEqual(species.localized_name('en', 'austria'), ('Tomato', 'en'))
        self.assertIn('\nparadeiser\n', translation.search_text_normalized)
        self.assertIn('\nparadeis\n', translation.search_text_normalized)

    def test_localized_name_falls_back_and_reports_the_language_used(self):
        species = CropSpecies.objects.create(name='Testart Fallback')
        CropSpeciesTranslation.objects.create(
            species=species, language_code='en', common_name='Tomato',
        )

        # German is requested but only English exists: serve English and say so.
        self.assertEqual(species.localized_name('de'), ('Tomato', 'en'))

    def test_localized_name_never_returns_an_empty_label(self):
        species = CropSpecies.objects.create(name='Testart ohne Übersetzung')

        text, used = species.localized_name('de')
        self.assertEqual(text, 'Testart ohne Übersetzung')
        # No real translation exists, so no language is claimed.
        self.assertEqual(used, '')


class CropSpeciesApiTest(DRFAPITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='species-user', email='species@example.com',
            password='testpass', is_active=True,
        )
        self.client.force_authenticate(user=self.user)
        self.species = create_tomato_species()

    def _get_species(self, **params):
        params.setdefault('q', 'tom')
        response = self.client.get('/openfarmplanner/api/crop-species/', params)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data['results'] if isinstance(response.data, dict) else response.data
        return next(item for item in results if item['id'] == self.species.id)

    def test_serves_the_german_name_for_a_german_request(self):
        self.assertEqual(self._get_species(language='de')['display_name'], 'Tomate')

    def test_serves_the_english_name_for_an_english_request(self):
        self.assertEqual(self._get_species(language='en')['display_name'], 'Tomato')

    def test_exposes_every_translation_for_editorial_use(self):
        payload = self._get_species(language='de')

        translations = {
            item['language_code']: item['common_name'] for item in payload['translations']
        }
        self.assertEqual(translations, {'de': 'Tomate', 'en': 'Tomato'})

    def test_exposes_species_metadata_for_reference_lists(self):
        self.species.scientific_name = 'Solanum lycopersicum'
        self.species.family = 'Solanaceae'
        self.species.categories = ['vegetable']
        self.species.save(update_fields=['scientific_name', 'family', 'categories'])

        payload = self._get_species(language='de')

        self.assertEqual(payload['scientific_name'], 'Solanum lycopersicum')
        self.assertEqual(payload['family'], 'Solanaceae')
        self.assertEqual(payload['categories'], ['vegetable'])

    def test_moderator_updates_clean_species_categories(self):
        self.user.user_permissions.add(Permission.objects.get(codename='moderate_crop_species'))

        response = self.client.patch(
            f'/openfarmplanner/api/crop-species/{self.species.id}/',
            {'categories': [' Vegetable ', 'vegetable', 'Herb']},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['categories'], ['vegetable', 'herb'])

    def test_reports_which_language_was_served_so_the_ui_can_flag_fallbacks(self):
        only_english = CropSpecies.objects.create(name='Testart Nur Englisch')
        CropSpeciesTranslation.objects.create(
            species=only_english, language_code='en', common_name='Salsify',
        )

        response = self.client.get(
            '/openfarmplanner/api/crop-species/',
            {'language': 'de', 'q': 'Salsify'},
        )
        results = response.data['results'] if isinstance(response.data, dict) else response.data
        payload = next(item for item in results if item['id'] == only_english.id)

        self.assertEqual(payload['display_name'], 'Salsify')
        self.assertEqual(payload['display_language_code'], 'en')

    def test_french_and_spanish_requests_get_the_english_name_and_report_it(self):
        species = CropSpecies.objects.create(name='Testart Fallback')
        CropSpeciesTranslation.objects.create(species=species, language_code='de', common_name='Haferwurzel')
        CropSpeciesTranslation.objects.create(species=species, language_code='en', common_name='Salsify')

        for language in ('fr', 'es'):
            with self.subTest(language=language):
                response = self.client.get(
                    '/openfarmplanner/api/crop-species/',
                    {'language': language, 'q': 'Salsify'},
                )
                results = response.data['results'] if isinstance(response.data, dict) else response.data
                payload = next(item for item in results if item['id'] == species.id)

                self.assertEqual(payload['display_name'], 'Salsify')
                self.assertEqual(payload['display_language_code'], 'en')

    def test_a_french_translation_is_served_once_it_exists(self):
        species = CropSpecies.objects.create(name='Testart Franzoesisch')
        CropSpeciesTranslation.objects.create(species=species, language_code='en', common_name='Salsify')
        CropSpeciesTranslation.objects.create(species=species, language_code='fr', common_name='Salsifis')

        response = self.client.get(
            '/openfarmplanner/api/crop-species/',
            {'q': 'Salsify'},
            HTTP_ACCEPT_LANGUAGE='fr-FR,fr;q=0.9',
        )
        results = response.data['results'] if isinstance(response.data, dict) else response.data
        payload = next(item for item in results if item['id'] == species.id)

        self.assertEqual(payload['display_name'], 'Salsifis')
        self.assertEqual(payload['display_language_code'], 'fr')

    def test_an_unsupported_language_parameter_falls_back_instead_of_failing(self):
        response = self.client.get('/openfarmplanner/api/crop-species/', {'language': 'it'})

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_honours_the_accept_language_header_when_no_parameter_is_given(self):
        response = self.client.get(
            '/openfarmplanner/api/crop-species/',
            {'q': 'tom'},
            HTTP_ACCEPT_LANGUAGE='de-AT,de;q=0.9',
        )
        results = response.data['results'] if isinstance(response.data, dict) else response.data
        payload = next(item for item in results if item['id'] == self.species.id)

        self.assertEqual(payload['display_name'], 'Tomate')

    def test_finds_a_species_by_a_name_in_any_language(self):
        response = self.client.get('/openfarmplanner/api/crop-species/', {'q': 'Tomate'})
        results = response.data['results'] if isinstance(response.data, dict) else response.data
        self.assertIn(self.species.id, [item['id'] for item in results])

    def test_finds_a_species_by_regional_name(self):
        translation = self.species.translations.get(language_code='de')
        translation.regional_names = {'austria': 'Paradeiser'}
        translation.synonyms = ['Paradeis']
        translation.save()

        response = self.client.get('/openfarmplanner/api/crop-species/', {'q': 'Paradeiser'})
        results = response.data['results'] if isinstance(response.data, dict) else response.data
        self.assertIn(self.species.id, [item['id'] for item in results])

    def test_exposes_search_names_for_alias_transparency(self):
        self.species.scientific_name = 'Solanum lycopersicum'
        self.species.save(update_fields=['scientific_name'])
        translation = self.species.translations.get(language_code='de')
        translation.regional_names = {'austria': 'Paradeiser'}
        translation.synonyms = ['Paradeis']
        translation.save()

        payload = self._get_species(q='Paradeis')

        self.assertIn('Tomate', payload['search_names'])
        self.assertIn('Solanum lycopersicum', payload['search_names'])
        self.assertIn('Paradeiser', payload['search_names'])
        self.assertIn('Paradeis', payload['search_names'])

    def test_finds_a_species_by_scientific_name(self):
        self.species.scientific_name = 'Solanum lycopersicum'
        self.species.save(update_fields=['scientific_name'])

        response = self.client.get(
            '/openfarmplanner/api/crop-species/',
            {'q': 'Solanum lycopersicum'},
        )
        results = response.data['results'] if isinstance(response.data, dict) else response.data

        self.assertIn(self.species.id, [item['id'] for item in results])

    def test_rejects_a_proposal_that_duplicates_another_languages_name(self):
        # "Tomato" is already the English name of the Tomate species: proposing
        # it must not create a second, parallel species.
        response = self.client.post('/openfarmplanner/api/crop-species/', {'name': 'Tomato'})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(CropSpecies.objects.filter(name='Tomato').count(), 0)

    def test_rejects_a_proposal_that_duplicates_a_regional_name(self):
        translation = self.species.translations.get(language_code='de')
        translation.regional_names = {'austria': 'Paradeiser'}
        translation.save()

        response = self.client.post('/openfarmplanner/api/crop-species/', {'name': 'Paradeiser'})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(CropSpecies.objects.filter(name='Paradeiser').count(), 0)

    def test_typo_in_regional_name_proposal_surfaces_a_similar_match_hint(self):
        translation = self.species.translations.get(language_code='de')
        translation.regional_names = {'austria': 'Paradeiser'}
        translation.save()

        response = self.client.post('/openfarmplanner/api/crop-species/', {'name': 'Paradeisser'})

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['similar_species'][0]['id'], self.species.id)
        self.assertEqual(response.data['similar_species'][0]['match_type'], 'similar')

    def test_creates_translations_supplied_with_a_proposal(self):
        response = self.client.post(
            '/openfarmplanner/api/crop-species/',
            {
                'name': 'Testart Vorschlag',
                'translations': [
                    {'language_code': 'de', 'common_name': 'Pastinake'},
                    {'language_code': 'en', 'common_name': 'Parsnip'},
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        species = CropSpecies.objects.get(name='Testart Vorschlag')
        self.assertEqual(species.translations_by_language(), {'de': 'Pastinake', 'en': 'Parsnip'})

    def test_accepts_french_and_spanish_translations_with_a_proposal(self):
        response = self.client.post(
            '/openfarmplanner/api/crop-species/',
            {
                'name': 'Testart Vierisprachig',
                'translations': [
                    {'language_code': 'de', 'common_name': 'Pastinake'},
                    {'language_code': 'en', 'common_name': 'Parsnip'},
                    {'language_code': 'fr', 'common_name': 'Panais'},
                    {'language_code': 'es', 'common_name': 'Chirivía'},
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        species = CropSpecies.objects.get(name='Testart Vierisprachig')
        self.assertEqual(
            species.translations_by_language(),
            {'de': 'Pastinake', 'en': 'Parsnip', 'fr': 'Panais', 'es': 'Chirivía'},
        )

    def test_rejects_an_unsupported_translation_language(self):
        response = self.client.post(
            '/openfarmplanner/api/crop-species/',
            {
                'name': 'Testart Unbekannte Sprache',
                'translations': [{'language_code': 'it', 'common_name': 'Pastinaca'}],
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class CropSearchTest(DRFAPITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='search-user', email='search@example.com', password='testpass', is_active=True,
        )
        self.client.force_authenticate(user=self.user)
        self.species = create_tomato_species()
        self.crop = PublicCrop.objects.create(
            name='Tomate',
            variety='Moneymaker',
            status=PublicCrop.STATUS_PUBLISHED,
            crop_species=self.species,
            original_language_code='de',
            version=1,
            created_by=self.user,
        )

    def test_finds_a_german_crop_by_its_english_species_name(self):
        results = list_published_crops(query='Tomato')

        self.assertIn(self.crop.id, [item.id for item in results])

    def test_finds_a_crop_by_its_german_species_name(self):
        results = list_published_crops(query='Tomate')

        self.assertIn(self.crop.id, [item.id for item in results])

    def test_matches_the_variety_name_verbatim_in_any_language(self):
        matches = [item.id for item in list_published_crops(variety='moneymaker')]
        self.assertIn(self.crop.id, matches)

    def test_returns_each_crop_once_even_when_several_translations_match(self):
        results = list(list_published_crops(query='Tom'))

        self.assertEqual(len([item for item in results if item.id == self.crop.id]), 1)

    def test_public_crop_endpoint_searches_across_languages_too(self):
        response = self.client.get('/openfarmplanner/api/public-crops/', {'q': 'Tomato'})
        results = response.data['results'] if isinstance(response.data, dict) else response.data

        self.assertIn(self.crop.id, [item['id'] for item in results])

    def test_public_crop_endpoint_searches_species_scientific_name(self):
        self.species.scientific_name = 'Solanum lycopersicum'
        self.species.save(update_fields=['scientific_name'])

        response = self.client.get(
            '/openfarmplanner/api/public-crops/',
            {'q': 'Solanum lycopersicum'},
        )
        results = response.data['results'] if isinstance(response.data, dict) else response.data

        self.assertIn(self.crop.id, [item['id'] for item in results])

    def test_public_crop_endpoint_uses_fuzzy_species_terms(self):
        for query in ('Tomaten', 'Paradeiser'):
            with self.subTest(query=query):
                response = self.client.get('/openfarmplanner/api/public-crops/', {'q': query})
                results = (
                    response.data['results'] if isinstance(response.data, dict) else response.data
                )

                self.assertIn(self.crop.id, [item['id'] for item in results])

    def test_public_crop_endpoint_searches_regional_names(self):
        translation = self.species.translations.get(language_code='de')
        translation.regional_names = {'austria': 'Paradeiser'}
        translation.synonyms = ['Paradeis']
        translation.save()

        response = self.client.get('/openfarmplanner/api/public-crops/', {'q': 'Paradeiser'})
        results = response.data['results'] if isinstance(response.data, dict) else response.data
        payload = next(item for item in results if item['id'] == self.crop.id)

        self.assertIn(self.crop.id, [item['id'] for item in results])
        self.assertIn('Paradeiser', payload['crop_species_search_names'])
        self.assertIn('Paradeis', payload['crop_species_search_names'])

    def test_species_endpoint_uses_fuzzy_species_terms(self):
        for query in ('Tomaten', 'Paradeiser'):
            with self.subTest(query=query):
                response = self.client.get('/openfarmplanner/api/crop-species/', {'q': query})
                results = (
                    response.data['results'] if isinstance(response.data, dict) else response.data
                )

                self.assertIn(self.species.id, [item['id'] for item in results])

    def test_search_does_not_scale_queries_with_the_number_of_results(self):
        """Cross-language search must stay O(1) in queries, not O(rows).

        Asserted as "same query count for 1 row and for 15" rather than a
        magic number, so unrelated query-count changes elsewhere do not make
        this test lie about what it is guarding.
        """
        def search_query_count() -> int:
            with CaptureQueriesContext(connection) as captured:
                response = self.client.get('/openfarmplanner/api/crop-library/', {'q': 'Tomato'})
                self.assertEqual(response.status_code, status.HTTP_200_OK)
            return len(captured)

        # Warm up first: the very first request also loads session/auth rows
        # that are then cached, which has nothing to do with result count.
        search_query_count()
        baseline = search_query_count()

        for index in range(14):
            PublicCrop.objects.create(
                name='Tomate',
                variety=f'Sorte {index}',
                status=PublicCrop.STATUS_PUBLISHED,
                crop_species=self.species,
                original_language_code='de',
                version=1,
                created_by=self.user,
            )

        self.assertEqual(search_query_count(), baseline)


class CropApiLocalizationTest(DRFAPITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='crop-lang-user', email='croplang@example.com',
            password='testpass', is_active=True,
        )
        self.client.force_authenticate(user=self.user)
        self.species = create_tomato_species()
        self.crop = PublicCrop.objects.create(
            name='Tomate',
            variety='Moneymaker',
            notes='Robuste Freilandsorte.',
            status=PublicCrop.STATUS_PUBLISHED,
            crop_species=self.species,
            original_language_code='de',
            version=1,
            created_by=self.user,
        )
        PublicCropTranslation.objects.create(
            public_crop=self.crop, language_code='de', description='Robuste Freilandsorte.',
        )

    def _get_crop(self, **params):
        response = self.client.get(f'/openfarmplanner/api/public-crops/{self.crop.id}/', params)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data

    def test_serves_german_names_and_descriptions_for_a_german_request(self):
        payload = self._get_crop(language='de')

        self.assertEqual(payload['display_name'], 'Tomate')
        self.assertEqual(payload['description'], 'Robuste Freilandsorte.')
        self.assertEqual(payload['description_language_code'], 'de')

    def test_serves_the_english_species_name_for_an_english_request(self):
        payload = self._get_crop(language='en')

        self.assertEqual(payload['display_name'], 'Tomato')

    def test_never_translates_the_variety_name(self):
        self.assertEqual(self._get_crop(language='de')['variety'], 'Moneymaker')
        self.assertEqual(self._get_crop(language='en')['variety'], 'Moneymaker')

    def test_falls_back_to_the_other_language_and_reports_it(self):
        payload = self._get_crop(language='en')

        self.assertEqual(payload['description'], 'Robuste Freilandsorte.')
        self.assertEqual(payload['description_language_code'], 'de')

    def test_empty_description_reports_no_language(self):
        self.crop.notes = ''
        self.crop.save(update_fields=['notes'])
        self.crop.translations.all().delete()

        payload = self._get_crop(language='en')

        self.assertEqual(payload['description'], '')
        self.assertIsNone(payload['description_language_code'])

    def test_endpoints_agree_on_the_resolved_language(self):
        detail = self._get_crop(language='en')
        response = self.client.get('/openfarmplanner/api/crop-library/', {'language': 'en'})
        results = response.data['results'] if isinstance(response.data, dict) else response.data
        listed = next(item for item in results if item['id'] == self.crop.id)

        self.assertEqual(detail['display_name'], listed['display_name'])
        self.assertEqual(detail['description'], listed['description'])

    def test_translations_endpoint_returns_every_language(self):
        PublicCropTranslation.objects.create(
            public_crop=self.crop, language_code='en', description='Robust outdoor variety.',
        )

        response = self.client.get(
            f'/openfarmplanner/api/public-crops/{self.crop.id}/translations/',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data['translations'],
            {'de': 'Robuste Freilandsorte.', 'en': 'Robust outdoor variety.'},
        )

    def test_translations_endpoint_upserts_a_language_without_touching_the_others(self):
        response = self.client.put(
            f'/openfarmplanner/api/public-crops/{self.crop.id}/translations/',
            {'translations': {'en': 'Robust outdoor variety.'}},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            response.data['translations'],
            {'de': 'Robuste Freilandsorte.', 'en': 'Robust outdoor variety.'},
        )

    def test_translations_endpoint_accepts_french_and_spanish(self):
        response = self.client.put(
            f'/openfarmplanner/api/public-crops/{self.crop.id}/translations/',
            {'translations': {'fr': 'Variété robuste.', 'es': 'Variedad robusta.'}},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['translations']['fr'], 'Variété robuste.')
        self.assertEqual(response.data['translations']['es'], 'Variedad robusta.')
        self.assertEqual(response.data['translations']['de'], 'Robuste Freilandsorte.')

    def test_translations_endpoint_rejects_an_unsupported_language(self):
        response = self.client.put(
            f'/openfarmplanner/api/public-crops/{self.crop.id}/translations/',
            {'translations': {'it': 'Varietà robusta.'}},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_at_least_one_language_version_must_remain(self):
        from farm.services.public_crops import (
            PublicCropStatusTransitionError,
            replace_public_crop_translations,
        )

        with self.assertRaises(PublicCropStatusTransitionError):
            replace_public_crop_translations(
                public_crop=self.crop, user=self.user, descriptions={'de': ''},
            )

        self.assertTrue(
            PublicCropTranslation.objects.filter(
                public_crop=self.crop, language_code='de',
            ).exists(),
        )

    def test_translations_endpoint_reports_the_last_language_as_a_client_error(self):
        response = self.client.put(
            f'/openfarmplanner/api/public-crops/{self.crop.id}/translations/',
            {'translations': {'de': ''}},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['code'], 'translation_required')
        self.assertTrue(
            PublicCropTranslation.objects.filter(
                public_crop=self.crop, language_code='de',
            ).exists(),
        )


class CrossLanguageMatchingTest(DRFAPITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='match-user', email='match@example.com', password='testpass', is_active=True,
        )
        self.species = create_tomato_species()
        self.crop = PublicCrop.objects.create(
            name='Tomate',
            variety='Moneymaker',
            status=PublicCrop.STATUS_PUBLISHED,
            crop_species=self.species,
            original_language_code='de',
            version=1,
            created_by=self.user,
        )

    def test_resolves_a_species_from_a_name_in_any_language(self):
        self.assertEqual(find_species_by_common_name('Tomate'), self.species)
        self.assertEqual(find_species_by_common_name('Tomato'), self.species)
        self.assertEqual(find_species_by_common_name('  tomato  '), self.species)

    def test_returns_no_species_for_an_unknown_name(self):
        self.assertIsNone(find_species_by_common_name('Nicht vorhanden'))
        self.assertIsNone(find_species_by_common_name(''))

    def test_matches_the_same_crop_from_either_language(self):
        self.assertEqual(find_exact_crop_match(name='Tomate', variety='Moneymaker'), self.crop)
        self.assertEqual(find_exact_crop_match(name='Tomato', variety='Moneymaker'), self.crop)

    def test_normalizes_variety_casing_and_spacing_when_matching(self):
        for variety in ('moneymaker', '  Moneymaker  ', 'MONEYMAKER'):
            self.assertEqual(
                find_exact_crop_match(name='Tomato', variety=variety), self.crop, variety,
            )

    def test_a_different_variety_is_not_a_match(self):
        self.assertIsNone(find_exact_crop_match(name='Tomato', variety='Ochsenherz'))

    def test_stored_names_are_never_rewritten_by_matching(self):
        find_exact_crop_match(name='tomato', variety='  moneymaker ')
        self.crop.refresh_from_db()

        self.assertEqual(self.crop.name, 'Tomate')
        self.assertEqual(self.crop.variety, 'Moneymaker')
