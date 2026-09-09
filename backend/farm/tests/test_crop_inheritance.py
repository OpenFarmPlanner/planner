"""Tests for the Sorte -> general Kultur value resolver."""

from decimal import Decimal

from django.test import TestCase

from crops.models import CropSpecies
from farm.models import Crop, Project
from farm.services.crop_inheritance import (
    CROP_INHERITABLE_FIELDS,
    build_effective_crop_values,
    build_general_crop_index,
    build_inherited_crop_values,
    clear_species_invariant_overrides,
    get_general_crop,
    is_unset_crop_value,
    resolve_crop_field,
)


class CropInheritanceTest(TestCase):
    """A Sorte falls back to the general Kultur of the same species and project."""

    def setUp(self):
        self.project = Project.objects.create(
            name='Inheritance Project', slug='inheritance-project',
        )
        self.other_project = Project.objects.create(name='Other Project', slug='other-project')
        self.species = CropSpecies.objects.create(name='Daucus carota')
        self.other_species = CropSpecies.objects.create(name='Beta vulgaris')
        self.general = Crop.objects.create(
            name='Karotte',
            variety='',
            project=self.project,
            crop_species=self.species,
            growth_duration_days=70,
            harvest_duration_days=21,
            propagation_duration_days=14,
            harvest_method='per_sqm',
            expected_yield=Decimal('3.50'),
            row_spacing_m=0.3,
            distance_within_row_m=0.05,
            sowing_depth_m=0.02,
            crop_family='Apiaceae',
            nutrient_demand='medium',
            rotation_break_years=4,
            thousand_kernel_weight_g=Decimal('1.20'),
            seed_rate_direct_value=2.0,
            seed_rate_direct_unit='g/m²',
            cultivation_types=['direct_sowing'],
            cultivation_type='direct_sowing',
        )

    def _variety(self, **kwargs) -> Crop:
        defaults = {
            'name': 'Karotte',
            'variety': 'Nantaise',
            'project': self.project,
            'crop_species': self.species,
        }
        defaults.update(kwargs)
        return Crop.objects.create(**defaults)

    def test_unset_detection_treats_zero_and_false_as_values(self):
        self.assertTrue(is_unset_crop_value(None))
        self.assertTrue(is_unset_crop_value(''))
        self.assertTrue(is_unset_crop_value('   '))
        self.assertTrue(is_unset_crop_value('-'))
        self.assertTrue(is_unset_crop_value([]))
        self.assertFalse(is_unset_crop_value(0))
        self.assertFalse(is_unset_crop_value(0.0))
        self.assertFalse(is_unset_crop_value(False))
        self.assertFalse(is_unset_crop_value(['direct_sowing']))

    def test_general_crop_is_found_for_a_linked_variety(self):
        variety = self._variety()
        self.assertEqual(get_general_crop(variety), self.general)

    def test_general_crop_of_the_kultur_itself_is_none(self):
        self.assertIsNone(get_general_crop(self.general))

    def test_free_text_variety_without_species_has_no_general_crop(self):
        variety = self._variety(crop_species=None)
        self.assertIsNone(get_general_crop(variety))
        self.assertIsNone(resolve_crop_field(variety, 'growth_duration_days'))

    def test_general_crop_from_another_project_is_ignored(self):
        variety = self._variety(project=self.other_project)
        self.assertIsNone(get_general_crop(variety))

    def test_general_crop_of_another_species_is_ignored(self):
        variety = self._variety(crop_species=self.other_species)
        self.assertIsNone(get_general_crop(variety))

    def test_soft_deleted_general_crop_is_ignored(self):
        from django.utils import timezone

        self.general.deleted_at = timezone.now()
        self.general.save(update_fields=['deleted_at'])
        variety = self._variety()
        self.assertIsNone(get_general_crop(variety))

    def test_unset_field_resolves_to_the_general_value(self):
        variety = self._variety()
        self.assertEqual(resolve_crop_field(variety, 'harvest_duration_days'), 21)
        self.assertEqual(resolve_crop_field(variety, 'row_spacing_m'), 0.3)
        self.assertEqual(resolve_crop_field(variety, 'crop_family'), 'Apiaceae')
        self.assertEqual(resolve_crop_field(variety, 'rotation_break_years'), 4)

    def test_own_field_wins_over_the_general_value(self):
        variety = self._variety(harvest_duration_days=7, expected_yield=Decimal('9.99'))
        self.assertEqual(resolve_crop_field(variety, 'harvest_duration_days'), 7)
        self.assertEqual(resolve_crop_field(variety, 'expected_yield'), Decimal('9.99'))

    def test_species_invariant_field_always_inherits_ignoring_a_raw_value(self):
        """``crop_family`` / ``nutrient_demand`` / ``rotation_break_years``
        describe the species: a leftover raw value on a linked Sorte is ignored
        entirely, the effective value is always the general Kultur's.
        """
        variety = self._variety(
            crop_family='Stale family',
            nutrient_demand='high',
            rotation_break_years=9,
        )
        self.assertEqual(resolve_crop_field(variety, 'crop_family'), 'Apiaceae')
        self.assertEqual(resolve_crop_field(variety, 'nutrient_demand'), 'medium')
        self.assertEqual(resolve_crop_field(variety, 'rotation_break_years'), 4)

        inherited = build_inherited_crop_values(variety)
        self.assertEqual(inherited['crop_family'], 'Apiaceae')
        self.assertEqual(inherited['nutrient_demand'], 'medium')
        self.assertEqual(inherited['rotation_break_years'], 4)

        effective = build_effective_crop_values(variety)
        self.assertEqual(effective['crop_family'], 'Apiaceae')
        self.assertEqual(effective['rotation_break_years'], 4)

    def test_species_invariant_field_is_empty_when_the_kultur_has_none(self):
        """A raw Sorte value is never the fallback for a species-invariant field."""
        self.general.crop_family = ''
        self.general.nutrient_demand = ''
        self.general.rotation_break_years = None
        self.general.save(update_fields=['crop_family', 'nutrient_demand', 'rotation_break_years'])
        variety = self._variety(crop_family='Stale family', rotation_break_years=9)
        self.assertIsNone(resolve_crop_field(variety, 'crop_family'))
        self.assertIsNone(resolve_crop_field(variety, 'rotation_break_years'))
        effective = build_effective_crop_values(variety)
        self.assertIsNone(effective['crop_family'])
        self.assertIsNone(effective['rotation_break_years'])
        self.assertNotIn('crop_family', build_inherited_crop_values(variety))

    def test_free_text_variety_keeps_its_own_species_invariant_values(self):
        """No ``crop_species`` -> nothing to inherit from -> the raw values stand."""
        variety = self._variety(
            crop_species=None, crop_family='Own family', rotation_break_years=2,
        )
        self.assertEqual(resolve_crop_field(variety, 'crop_family'), 'Own family')
        self.assertEqual(resolve_crop_field(variety, 'rotation_break_years'), 2)

    def test_zero_is_an_own_value_and_does_not_inherit(self):
        variety = self._variety(harvest_duration_days=0, sowing_calculation_safety_percent=0)
        self.assertEqual(resolve_crop_field(variety, 'harvest_duration_days'), 0)
        self.assertEqual(resolve_crop_field(variety, 'sowing_calculation_safety_percent'), 0)

    def test_unset_field_stays_unset_when_the_general_kultur_has_no_value_either(self):
        variety = self._variety()
        self.assertIsNone(resolve_crop_field(variety, 'seeding_requirement'))

    def test_non_inheritable_field_is_never_resolved(self):
        variety = self._variety(notes='')
        self.general.notes = 'General notes'
        self.general.save(update_fields=['notes'])
        self.assertEqual(resolve_crop_field(variety, 'notes'), '')

    def test_inherited_values_only_contain_fallback_fields(self):
        variety = self._variety(harvest_duration_days=7)
        inherited = build_inherited_crop_values(variety)
        self.assertNotIn('harvest_duration_days', inherited)
        self.assertEqual(inherited['growth_duration_days'], 70)
        self.assertEqual(inherited['seed_rate_direct_unit'], 'g/m²')
        self.assertNotIn('seeding_requirement', inherited)

    def test_inherited_values_are_empty_without_a_general_crop(self):
        self.assertEqual(build_inherited_crop_values(self._variety(crop_species=None)), {})
        self.assertEqual(build_inherited_crop_values(self.general), {})

    def test_effective_values_cover_every_inheritable_field(self):
        variety = self._variety(harvest_duration_days=7)
        effective = build_effective_crop_values(variety)
        self.assertEqual(set(effective), set(CROP_INHERITABLE_FIELDS))
        self.assertEqual(effective['harvest_duration_days'], 7)
        self.assertEqual(effective['growth_duration_days'], 70)
        self.assertIsNone(effective['seeding_requirement'])

    def test_index_resolves_without_a_query_per_crop(self):
        varieties = [self._variety(variety=f'Sorte {index}') for index in range(3)]
        with self.assertNumQueries(1):
            index = build_general_crop_index(self.project.id)
        with self.assertNumQueries(0):
            for variety in varieties:
                self.assertEqual(resolve_crop_field(variety, 'growth_duration_days', index), 70)

    def test_index_is_scoped_to_one_project(self):
        Crop.objects.create(
            name='Karotte', variety='', project=self.other_project,
            crop_species=self.species, growth_duration_days=99,
        )
        index = build_general_crop_index(self.project.id)
        self.assertEqual(index[self.species.id], self.general)

    def test_clear_species_invariant_overrides_resets_a_linked_variety(self):
        variety = self._variety(
            crop_family='Dead family', nutrient_demand='high', rotation_break_years=9,
            harvest_duration_days=7,
        )
        reset = clear_species_invariant_overrides(variety)
        self.assertEqual(set(reset), {'crop_family', 'nutrient_demand', 'rotation_break_years'})
        variety.refresh_from_db()
        self.assertEqual(variety.crop_family, '')
        self.assertEqual(variety.nutrient_demand, '')
        self.assertIsNone(variety.rotation_break_years)
        # non-invariant own values are untouched
        self.assertEqual(variety.harvest_duration_days, 7)

    def test_clear_species_invariant_overrides_is_a_noop_when_already_clean(self):
        variety = self._variety()
        with self.assertNumQueries(0):
            self.assertEqual(clear_species_invariant_overrides(variety), [])

    def test_clear_species_invariant_overrides_skips_free_text_varieties(self):
        variety = self._variety(crop_species=None, crop_family='Own family', rotation_break_years=2)
        self.assertEqual(clear_species_invariant_overrides(variety), [])
        variety.refresh_from_db()
        self.assertEqual(variety.crop_family, 'Own family')

    def test_linked_orphan_keeps_its_only_species_invariant_values(self):
        orphan_species = CropSpecies.objects.create(name='Daucus carota subsp. sativus')
        orphan = self._variety(
            crop_species=orphan_species,
            crop_family='Apiaceae',
            nutrient_demand='medium',
            rotation_break_years=3,
        )

        self.assertEqual(resolve_crop_field(orphan, 'crop_family'), 'Apiaceae')
        self.assertEqual(build_effective_crop_values(orphan)['crop_family'], 'Apiaceae')
        self.assertEqual(clear_species_invariant_overrides(orphan), [])
        orphan.refresh_from_db()
        self.assertEqual(orphan.crop_family, 'Apiaceae')

    def test_lookup_is_cached_on_the_instance(self):
        variety = self._variety()
        with self.assertNumQueries(1):
            get_general_crop(variety)
        with self.assertNumQueries(0):
            get_general_crop(variety)
