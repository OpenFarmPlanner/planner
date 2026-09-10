"""Cross-language duplicate detection and description translations.

The core rule: "Tomate + Moneymaker" and "Tomato + Moneymaker" are the same
crop. Duplicate detection must recognise that through the language-independent
species, not through whichever localized name a user happened to type.
"""

from crops.models import CropSpecies, CropSpeciesTranslation
from farm.models import Crop, PublicCrop, PublicCropTranslation
from farm.services.crop_display import resolve_crop_display_name
from farm.services.public_crops import (
    detect_public_crop_duplicates,
    normalize_language_code,
    replace_public_crop_translations,
    sync_original_language_translation,
)
from farm.tests.api_base import ProjectApiTestCase


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
            descriptions={'fr': 'Variété robuste.'},
        )

        self.assertNotIn('fr', self.public_crop.descriptions_by_language())

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
        self.assertEqual(normalize_language_code('fr'), '')
        self.assertEqual(normalize_language_code(None), '')
