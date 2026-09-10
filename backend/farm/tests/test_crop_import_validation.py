"""Unit tests for crop-import unit handling, conversion, and plausibility."""

from decimal import Decimal

from django.test import TestCase

from farm.models import Crop, Project, Supplier
from farm.services.crop_import.analysis import (
    ACTION_BLOCKED,
    ACTION_CREATE,
    analyze_import_payload,
)
from farm.services.crop_import.field_specs import SEED_RATE_UNIT_VALUES
from farm.services.crop_import.units import (
    CONFIDENCE_CONVERTED,
    CONFIDENCE_EXACT,
    CONFIDENCE_INVALID,
    CONFIDENCE_NEEDS_CLARIFICATION,
    ParsedAmount,
    convert_plain_number,
    convert_to_canonical_length,
    normalize_seed_rate_unit_input,
    parse_raw_amount,
)


class ImportAnalysisTestCase(TestCase):
    """Base with one project and small helpers for reading a preview."""

    def setUp(self):
        self.project = Project.objects.create(name='Analysis Project', slug='analysis-project')

    def analyze(self, *items):
        """Analyze the given rows against the test project."""
        return analyze_import_payload(list(items), project=self.project)

    def field_of(self, preview, index, field_name):
        """Return one field entry from a preview row."""
        for entry in preview['items'][index]['fields']:
            if entry['field'] == field_name:
                return entry
        raise AssertionError(f'{field_name} not present in row {index}')

    def error_codes(self, preview, index):
        """Return the error codes of one preview row."""
        return {error['code'] for error in preview['items'][index]['errors']}

    def warning_codes(self, preview, index):
        """Return the warning codes of one preview row."""
        return {warning['code'] for warning in preview['items'][index]['warnings']}


class LengthUnitConversionTests(ImportAnalysisTestCase):
    """Distances must always end up in metres, and never be guessed."""

    def test_centimeter_key_is_converted_to_metres(self):
        preview = self.analyze({'name': 'Brokkoli', 'row_spacing_cm': 50})
        entry = self.field_of(preview, 0, 'row_spacing_m')

        self.assertEqual(entry['source_value'], 50)
        self.assertEqual(entry['source_unit'], 'cm')
        self.assertEqual(entry['api_value'], 0.5)
        self.assertEqual(entry['api_unit'], 'm')
        self.assertEqual(entry['confidence'], CONFIDENCE_CONVERTED)
        self.assertEqual(entry['errors'], [])

    def test_metre_key_is_taken_as_is(self):
        preview = self.analyze({'name': 'Brokkoli', 'row_spacing_m': 0.5})
        entry = self.field_of(preview, 0, 'row_spacing_m')

        self.assertEqual(entry['api_value'], 0.5)
        self.assertEqual(entry['confidence'], CONFIDENCE_EXACT)

    def test_millimetre_key_is_converted(self):
        preview = self.analyze({'name': 'Brokkoli', 'sowing_depth_mm': 20})
        entry = self.field_of(preview, 0, 'sowing_depth_m')

        self.assertEqual(entry['api_value'], 0.02)
        self.assertEqual(entry['confidence'], CONFIDENCE_CONVERTED)

    def test_inline_unit_in_a_string_is_honoured(self):
        preview = self.analyze({'name': 'Brokkoli', 'row_spacing': '50 cm'})
        entry = self.field_of(preview, 0, 'row_spacing_m')

        self.assertEqual(entry['source_unit'], 'cm')
        self.assertEqual(entry['api_value'], 0.5)

    def test_german_decimal_comma_is_accepted(self):
        preview = self.analyze({'name': 'Brokkoli', 'row_spacing': '0,5 m'})
        self.assertEqual(self.field_of(preview, 0, 'row_spacing_m')['api_value'], 0.5)

    def test_value_object_with_unit_is_accepted(self):
        preview = self.analyze({'name': 'Brokkoli', 'row_spacing': {'value': 45, 'unit': 'cm'}})
        self.assertEqual(self.field_of(preview, 0, 'row_spacing_m')['api_value'], 0.45)

    def test_inline_unit_overrides_the_key_unit(self):
        # The key says centimetres, the value says metres. The explicit value
        # wins; guessing the other way round would silently inflate the number.
        preview = self.analyze({'name': 'Brokkoli', 'row_spacing_cm': '0.5 m'})
        entry = self.field_of(preview, 0, 'row_spacing_m')

        self.assertEqual(entry['source_unit'], 'm')
        self.assertEqual(entry['api_value'], 0.5)

    def test_bare_number_without_a_unit_needs_clarification(self):
        preview = self.analyze({'name': 'Karotte', 'row_spacing': 30})
        entry = self.field_of(preview, 0, 'row_spacing_m')

        self.assertIsNone(entry['api_value'])
        self.assertEqual(entry['confidence'], CONFIDENCE_NEEDS_CLARIFICATION)
        self.assertIn('unit_missing', {error['code'] for error in entry['errors']})
        self.assertEqual(preview['items'][0]['action'], ACTION_BLOCKED)

    def test_unknown_unit_is_rejected_and_not_converted(self):
        preview = self.analyze({'name': 'Brokkoli', 'row_spacing': '20 furlongs'})
        entry = self.field_of(preview, 0, 'row_spacing_m')

        self.assertIsNone(entry['api_value'])
        self.assertEqual(entry['confidence'], CONFIDENCE_INVALID)
        self.assertIn('unit_unknown', {error['code'] for error in entry['errors']})

    def test_non_numeric_value_is_rejected(self):
        preview = self.analyze({'name': 'Brokkoli', 'row_spacing_cm': 'wide'})
        entry = self.field_of(preview, 0, 'row_spacing_m')

        self.assertIn('not_a_number', {error['code'] for error in entry['errors']})


class NumericPlausibilityTests(ImportAnalysisTestCase):
    """Impossible values are rejected; merely unusual ones only warn."""

    def test_metres_instead_of_centimetres_is_rejected(self):
        preview = self.analyze({'name': 'Salat', 'row_spacing_m': 30})
        entry = self.field_of(preview, 0, 'row_spacing_m')

        self.assertIn('above_hard_max', {error['code'] for error in entry['errors']})
        self.assertEqual(preview['items'][0]['action'], ACTION_BLOCKED)

    def test_the_same_number_in_centimetres_is_accepted(self):
        preview = self.analyze({'name': 'Salat', 'row_spacing_cm': 30})
        entry = self.field_of(preview, 0, 'row_spacing_m')

        self.assertEqual(entry['api_value'], 0.3)
        self.assertEqual(entry['errors'], [])
        self.assertEqual(entry['warnings'], [])

    def test_negative_distance_is_rejected(self):
        preview = self.analyze({'name': 'Salat', 'row_spacing_cm': -10})
        self.assertIn(
            'below_hard_min',
            {error['code'] for error in self.field_of(preview, 0, 'row_spacing_m')['errors']},
        )

    def test_zero_row_spacing_is_rejected(self):
        preview = self.analyze({'name': 'Salat', 'row_spacing_cm': 0})
        self.assertIn(
            'below_hard_min',
            {error['code'] for error in self.field_of(preview, 0, 'row_spacing_m')['errors']},
        )

    def test_unusually_small_distance_only_warns(self):
        preview = self.analyze({'name': 'Salat', 'row_spacing_cm': 0.5})
        entry = self.field_of(preview, 0, 'row_spacing_m')

        self.assertEqual(entry['errors'], [])
        self.assertIn('below_warn_min', {warning['code'] for warning in entry['warnings']})
        self.assertEqual(preview['items'][0]['action'], ACTION_CREATE)

    def test_unusually_large_distance_only_warns(self):
        preview = self.analyze({'name': 'Kuerbis', 'row_spacing_m': 2.5})
        entry = self.field_of(preview, 0, 'row_spacing_m')

        self.assertEqual(entry['errors'], [])
        self.assertIn('above_warn_max', {warning['code'] for warning in entry['warnings']})

    def test_negative_growth_duration_is_rejected(self):
        preview = self.analyze({'name': 'Salat', 'growth_duration_days': -5})
        self.assertIn(
            'below_hard_min',
            {
                error['code']
                for error in self.field_of(preview, 0, 'growth_duration_days')['errors']
            },
        )

    def test_absurd_growth_duration_is_rejected(self):
        preview = self.analyze({'name': 'Salat', 'growth_duration_days': 5000})
        self.assertIn(
            'above_hard_max',
            {
                error['code']
                for error in self.field_of(preview, 0, 'growth_duration_days')['errors']
            },
        )

    def test_fractional_day_count_is_rejected(self):
        preview = self.analyze({'name': 'Salat', 'growth_duration_days': 12.5})
        self.assertIn(
            'not_a_number',
            {
                error['code']
                for error in self.field_of(preview, 0, 'growth_duration_days')['errors']
            },
        )

    def test_safety_percent_above_hundred_is_rejected(self):
        preview = self.analyze({'name': 'Salat', 'sowing_calculation_safety_percent_direct': 150})
        self.assertIn(
            'above_hard_max',
            {
                error['code']
                for error in self.field_of(
                    preview, 0, 'sowing_calculation_safety_percent_direct'
                )['errors']
            },
        )

    def test_zero_thousand_kernel_weight_is_rejected(self):
        preview = self.analyze({'name': 'Salat', 'thousand_kernel_weight_g': 0})
        self.assertIn(
            'below_hard_min',
            {
                error['code']
                for error in self.field_of(preview, 0, 'thousand_kernel_weight_g')['errors']
            },
        )


class SeedRateCouplingTests(ImportAnalysisTestCase):
    """A seed rate and its unit are only meaningful together."""

    def test_value_without_unit_is_blocked(self):
        preview = self.analyze({'name': 'Karotte', 'seed_rate_direct_value': 5})
        entry = self.field_of(preview, 0, 'seed_rate_direct_value')

        self.assertIn('missing_companion', {error['code'] for error in entry['errors']})
        self.assertEqual(entry['confidence'], CONFIDENCE_NEEDS_CLARIFICATION)
        self.assertEqual(preview['items'][0]['action'], ACTION_BLOCKED)

    def test_unit_without_value_is_blocked(self):
        preview = self.analyze({'name': 'Karotte', 'seed_rate_direct_unit': 'g_per_m2'})
        entry = self.field_of(preview, 0, 'seed_rate_direct_unit')

        self.assertIn('missing_companion', {error['code'] for error in entry['errors']})
        self.assertEqual(preview['items'][0]['action'], ACTION_BLOCKED)

    def test_matching_value_and_unit_are_accepted(self):
        preview = self.analyze({
            'name': 'Karotte',
            'cultivation_types': ['direct_sowing'],
            'seed_rate_direct_value': 1.5,
            'seed_rate_direct_unit': 'g_per_m2',
        })

        self.assertEqual(preview['items'][0]['action'], ACTION_CREATE)
        self.assertEqual(preview['items'][0]['errors'], [])

    def test_seeds_per_plant_requires_whole_number_value(self):
        preview = self.analyze({
            'name': 'Aubergine',
            'cultivation_types': ['pre_cultivation'],
            'seed_rate_pre_cultivation_value': 1.1,
            'seed_rate_pre_cultivation_unit': 'seeds_per_plant',
        })
        entry = self.field_of(preview, 0, 'seed_rate_pre_cultivation_value')

        self.assertIn('whole_number_required', {error['code'] for error in entry['errors']})
        self.assertEqual(preview['items'][0]['action'], ACTION_BLOCKED)

    def test_unknown_seed_rate_unit_is_rejected(self):
        preview = self.analyze({
            'name': 'Karotte',
            'seed_rate_direct_value': 5,
            'seed_rate_direct_unit': 'buckets_per_acre',
        })
        entry = self.field_of(preview, 0, 'seed_rate_direct_unit')

        self.assertIn('unit_unknown', {error['code'] for error in entry['errors']})

    def test_seed_rate_unit_synonym_is_normalized_to_the_canonical_value(self):
        preview = self.analyze({
            'name': 'Karotte',
            'cultivation_types': ['direct_sowing'],
            'seed_rate_direct_value': 1.5,
            'seed_rate_direct_unit': 'g/m²',
        })
        entry = self.field_of(preview, 0, 'seed_rate_direct_unit')

        self.assertEqual(entry['api_value'], 'g_per_m2')
        self.assertEqual(entry['confidence'], CONFIDENCE_CONVERTED)

    def test_seed_rate_far_outside_the_usual_band_warns(self):
        preview = self.analyze({
            'name': 'Karotte',
            'cultivation_types': ['direct_sowing'],
            'seed_rate_direct_value': 900,
            'seed_rate_direct_unit': 'g_per_m2',
        })
        entry = self.field_of(preview, 0, 'seed_rate_direct_value')

        self.assertEqual(entry['errors'], [])
        self.assertIn('above_warn_max', {warning['code'] for warning in entry['warnings']})

    def test_seed_rate_for_an_unused_cultivation_type_warns(self):
        preview = self.analyze({
            'name': 'Karotte',
            'cultivation_types': ['pre_cultivation'],
            'seed_rate_direct_value': 1.5,
            'seed_rate_direct_unit': 'g_per_m2',
        })

        self.assertIn('seed_rate_without_cultivation_type', self.warning_codes(preview, 0))


class EnumAndTextValidationTests(ImportAnalysisTestCase):
    """Enums normalize to the project's vocabulary; unknown values are refused."""

    def test_german_cultivation_type_is_normalized(self):
        preview = self.analyze({'name': 'Salat', 'cultivation_types': ['Anzucht']})
        entry = self.field_of(preview, 0, 'cultivation_types')

        self.assertEqual(entry['api_value'], ['pre_cultivation'])
        self.assertEqual(entry['errors'], [])

    def test_unknown_cultivation_type_is_rejected(self):
        preview = self.analyze({'name': 'Salat', 'cultivation_types': ['hydroponic']})
        self.assertIn(
            'enum_unknown',
            {error['code'] for error in self.field_of(preview, 0, 'cultivation_types')['errors']},
        )

    def test_german_nutrient_demand_is_normalized(self):
        preview = self.analyze({'name': 'Salat', 'nutrient_demand': 'hoch'})
        self.assertEqual(self.field_of(preview, 0, 'nutrient_demand')['api_value'], 'high')

    def test_unknown_nutrient_demand_is_rejected(self):
        preview = self.analyze({'name': 'Salat', 'nutrient_demand': 'enormous'})
        self.assertIn(
            'enum_unknown',
            {error['code'] for error in self.field_of(preview, 0, 'nutrient_demand')['errors']},
        )

    def test_invalid_display_color_is_rejected(self):
        preview = self.analyze({'name': 'Salat', 'display_color': 'green'})
        self.assertIn(
            'invalid_color',
            {error['code'] for error in self.field_of(preview, 0, 'display_color')['errors']},
        )

    def test_overlong_name_is_rejected_rather_than_truncated(self):
        preview = self.analyze({'name': 'x' * 300})
        self.assertIn(
            'too_long', {error['code'] for error in self.field_of(preview, 0, 'name')['errors']}
        )

    def test_missing_name_blocks_the_row(self):
        preview = self.analyze({'variety': 'Calabrese', 'row_spacing_cm': 50})
        self.assertIn('missing_name', self.error_codes(preview, 0))
        self.assertEqual(preview['items'][0]['action'], ACTION_BLOCKED)

    def test_non_object_row_is_blocked(self):
        preview = self.analyze('Brokkoli')
        self.assertEqual(preview['items'][0]['action'], ACTION_BLOCKED)


class UnknownFieldTests(ImportAnalysisTestCase):
    """Order-form columns must not be folded into crop master data."""

    def test_unknown_keys_are_reported_and_ignored(self):
        preview = self.analyze({
            'name': 'Brokkoli',
            'article_no': 'BR-1234',
            'package_size': '25 g',
            'price_eur': 4.9,
            'order_quantity': 3,
        })
        row = preview['items'][0]

        ignored_keys = {entry['key'] for entry in row['ignored_fields']}
        self.assertEqual(
            ignored_keys, {'article_no', 'package_size', 'price_eur', 'order_quantity'}
        )
        self.assertTrue(all(entry['code'] == 'unknown_field' for entry in row['ignored_fields']))

        written_fields = {entry['field'] for entry in row['fields']}
        self.assertEqual(written_fields, {'name'})

    def test_product_name_is_not_used_as_a_variety(self):
        preview = self.analyze({'name': 'Brokkoli', 'product_name': 'Brokkoli Calabrese 25g'})
        row = preview['items'][0]

        self.assertNotIn('variety', {entry['field'] for entry in row['fields']})
        self.assertEqual(row['identity']['variety'], '')

    def test_two_keys_for_the_same_field_are_not_merged(self):
        preview = self.analyze({'name': 'Brokkoli', 'row_spacing_cm': 50, 'row_spacing_m': 0.4})
        row = preview['items'][0]

        self.assertEqual(len([e for e in row['fields'] if e['field'] == 'row_spacing_m']), 1)
        self.assertIn('duplicate_key', {entry['code'] for entry in row['ignored_fields']})


class MatchingAndDuplicateTests(ImportAnalysisTestCase):
    """Matching mirrors the database uniqueness rule and stays project-scoped."""

    def test_existing_crop_is_matched_and_marked_as_update(self):
        Crop.objects.create(name='Brokkoli', variety='Calabrese', project=self.project)
        preview = self.analyze({'name': 'Brokkoli', 'variety': 'Calabrese', 'row_spacing_cm': 50})
        row = preview['items'][0]

        self.assertEqual(row['action'], 'update')
        self.assertIsNotNone(row['matched_crop_id'])
        self.assertEqual(row['matched_by'], 'name_variety_supplier')

    def test_identical_data_is_skipped_rather_than_rewritten(self):
        Crop.objects.create(
            name='Brokkoli', variety='Calabrese', project=self.project, row_spacing_m=0.5
        )
        preview = self.analyze({'name': 'Brokkoli', 'variety': 'Calabrese', 'row_spacing_cm': 50})

        self.assertEqual(preview['items'][0]['action'], 'skip')

    def test_preview_reports_the_currently_stored_value(self):
        Crop.objects.create(
            name='Brokkoli', variety='Calabrese', project=self.project, row_spacing_m=0.4
        )
        preview = self.analyze({'name': 'Brokkoli', 'variety': 'Calabrese', 'row_spacing_cm': 50})
        entry = self.field_of(preview, 0, 'row_spacing_m')

        self.assertEqual(entry['current_value'], 0.4)
        self.assertEqual(entry['api_value'], 0.5)
        self.assertTrue(entry['changes_existing'])

    def test_crops_of_other_projects_are_never_matched(self):
        other_project = Project.objects.create(name='Other', slug='other-project')
        Crop.objects.create(name='Brokkoli', variety='Calabrese', project=other_project)

        preview = self.analyze({'name': 'Brokkoli', 'variety': 'Calabrese'})

        self.assertEqual(preview['items'][0]['action'], ACTION_CREATE)
        self.assertIsNone(preview['items'][0]['matched_crop_id'])

    def test_supplier_specific_crop_is_not_matched_without_a_supplier(self):
        supplier = Supplier.objects.create(
            name='Bingenheimer', homepage_url='https://bingenheimer.example', project=self.project
        )
        Crop.objects.create(
            name='Brokkoli', variety='Calabrese', project=self.project, supplier=supplier
        )

        preview = self.analyze({'name': 'Brokkoli', 'variety': 'Calabrese'})
        self.assertEqual(preview['items'][0]['action'], ACTION_CREATE)

    def test_supplier_name_matches_the_supplier_specific_crop(self):
        supplier = Supplier.objects.create(
            name='Bingenheimer', homepage_url='https://bingenheimer.example', project=self.project
        )
        existing = Crop.objects.create(
            name='Brokkoli', variety='Calabrese', project=self.project, supplier=supplier
        )

        preview = self.analyze({
            'name': 'Brokkoli',
            'variety': 'Calabrese',
            'supplier_name': 'Bingenheimer',
            'row_spacing_cm': 50,
        })

        self.assertEqual(preview['items'][0]['matched_crop_id'], existing.id)

    def test_two_rows_for_the_same_crop_block_the_second(self):
        preview = self.analyze(
            {'name': 'Brokkoli', 'variety': 'Calabrese', 'row_spacing_cm': 50},
            {'name': 'Brokkoli', 'variety': 'Calabrese', 'row_spacing_cm': 60},
        )

        self.assertEqual(preview['items'][0]['action'], ACTION_CREATE)
        self.assertEqual(preview['items'][1]['action'], ACTION_BLOCKED)
        self.assertIn('duplicate_in_payload', self.error_codes(preview, 1))


class PreviewSummaryTests(ImportAnalysisTestCase):
    """The summary must let a caller decide without walking every row."""

    def test_summary_counts_each_action(self):
        Crop.objects.create(name='Bestand', project=self.project, row_spacing_m=0.5)
        preview = self.analyze(
            {'name': 'Neu'},
            {'name': 'Bestand', 'row_spacing_cm': 50},
            {'name': 'Geaendert', 'row_spacing_m': 30},
        )

        self.assertEqual(preview['summary']['total'], 3)
        self.assertEqual(preview['summary']['create'], 1)
        self.assertEqual(preview['summary']['skip'], 1)
        self.assertEqual(preview['summary']['blocked'], 1)
        self.assertTrue(preview['has_errors'])

    def test_warnings_are_surfaced_at_the_top_level(self):
        preview = self.analyze({'name': 'Kuerbis', 'row_spacing_m': 2.5})

        self.assertTrue(preview['has_warnings'])
        self.assertFalse(preview['has_errors'])
        self.assertGreaterEqual(preview['summary']['warnings'], 1)


class ParseRawAmountTests(TestCase):
    """Direct tests for the value/unit splitter behind the import preview."""

    def test_reads_a_bare_number_with_the_unit_the_key_implies(self):
        parsed = parse_raw_amount(50, 'cm')
        self.assertEqual((parsed.number, parsed.unit), (Decimal('50'), 'cm'))
        self.assertFalse(parsed.unit_was_explicit)

    def test_reads_a_bare_number_with_no_unit_at_all(self):
        parsed = parse_raw_amount(50, None)
        self.assertEqual((parsed.number, parsed.unit), (Decimal('50'), None))

    def test_rejects_a_boolean_rather_than_reading_it_as_one_or_zero(self):
        # bool is a subclass of int, so it has to be excluded before the numeric
        # branch — otherwise True would silently import as 1.
        for value in (True, False):
            with self.subTest(value=value):
                self.assertEqual(parse_raw_amount(value, 'cm').error, 'not_a_number')

    def test_rejects_a_type_it_has_no_rule_for(self):
        for value in (None, [50], (50,), object()):
            with self.subTest(value=value):
                self.assertEqual(parse_raw_amount(value, 'cm').error, 'not_a_number')

    def test_reads_an_inline_unit_out_of_a_string(self):
        parsed = parse_raw_amount('50 cm', None)
        self.assertEqual((parsed.number, parsed.unit), (Decimal('50'), 'cm'))
        self.assertTrue(parsed.unit_was_explicit)

    def test_accepts_a_string_with_no_space_before_the_unit(self):
        parsed = parse_raw_amount('12.5cm', None)
        self.assertEqual((parsed.number, parsed.unit), (Decimal('12.5'), 'cm'))

    def test_reads_a_german_decimal_comma(self):
        self.assertEqual(parse_raw_amount('12,5 cm', None).number, Decimal('12.5'))

    def test_reads_a_signed_number(self):
        self.assertEqual(parse_raw_amount('-3 cm', None).number, Decimal('-3'))
        self.assertEqual(parse_raw_amount('+3 cm', None).number, Decimal('3'))

    def test_a_unit_in_the_string_beats_the_one_the_key_implies(self):
        # The payload said centimetres; the key only guessed metres.
        parsed = parse_raw_amount('50 cm', 'm')
        self.assertEqual(parsed.unit, 'cm')
        self.assertTrue(parsed.unit_was_explicit)

    def test_a_bare_numeric_string_falls_back_to_the_implied_unit(self):
        parsed = parse_raw_amount('50', 'cm')
        self.assertEqual(parsed.unit, 'cm')
        self.assertFalse(parsed.unit_was_explicit)

    def test_rejects_a_string_that_is_not_a_number(self):
        for value in ('', '  ', 'fifty', '50 cm 60', '1.2.3'):
            with self.subTest(value=value):
                self.assertEqual(parse_raw_amount(value, 'cm').error, 'not_a_number')

    def test_a_unit_spelled_with_an_umlaut_is_reported_as_not_a_number(self):
        # The unit group is `[a-zA-Z_²/µ]*`, which admits ² and µ but no accented
        # letters — so "5 stück" fails the pattern outright and comes back as
        # 'not_a_number' rather than 'unit_unknown'. The number is plainly there,
        # so the diagnostic points the importing user at the wrong half of the
        # value. Recorded as current behaviour.
        parsed = parse_raw_amount('5 stück', None)
        self.assertEqual(parsed.error, 'not_a_number')
        self.assertIsNone(parsed.number)

    def test_a_unit_written_with_the_superscript_two_or_micro_sign_does_parse(self):
        self.assertEqual(parse_raw_amount('5 cm²', None).unit, 'cm²')
        self.assertEqual(parse_raw_amount('5 µm', None).unit, 'µm')

    def test_reads_the_mapping_shape(self):
        parsed = parse_raw_amount({'value': 50, 'unit': 'cm'}, None)
        self.assertEqual((parsed.number, parsed.unit), (Decimal('50'), 'cm'))
        self.assertTrue(parsed.unit_was_explicit)

    def test_a_mapping_unit_beats_the_one_the_key_implies(self):
        self.assertEqual(parse_raw_amount({'value': 50, 'unit': 'cm'}, 'm').unit, 'cm')

    def test_a_mapping_keeps_the_implied_unit_when_it_names_none(self):
        for unit in (None, '', '   '):
            with self.subTest(unit=unit):
                parsed = parse_raw_amount({'value': 50, 'unit': unit}, 'cm')
                self.assertEqual(parsed.unit, 'cm')
                self.assertFalse(parsed.unit_was_explicit)

    def test_a_mapping_reports_the_inner_value_error_rather_than_its_unit(self):
        # A good unit must not make a bad number look importable.
        parsed = parse_raw_amount({'value': 'fifty', 'unit': 'cm'}, None)
        self.assertEqual(parsed.error, 'not_a_number')
        self.assertIsNone(parsed.number)

    def test_a_mapping_without_a_value_member_is_not_a_number(self):
        self.assertEqual(parse_raw_amount({'unit': 'cm'}, None).error, 'not_a_number')

    def test_a_mapping_strips_whitespace_around_its_unit(self):
        self.assertEqual(parse_raw_amount({'value': 1, 'unit': ' cm '}, None).unit, 'cm')

    def test_a_nested_mapping_value_is_parsed_by_the_same_rules(self):
        parsed = parse_raw_amount({'value': '50 mm'}, 'cm')
        self.assertEqual((parsed.number, parsed.unit), (Decimal('50'), 'mm'))


class ConvertToCanonicalLengthTests(TestCase):
    """Direct tests for the length conversion behind the import preview."""

    def convert(self, raw_value, implied_unit=None):
        return convert_to_canonical_length(parse_raw_amount(raw_value, implied_unit))

    def test_metres_pass_through_as_exact(self):
        result = self.convert('2 m')
        self.assertEqual((result.value, result.canonical_unit), (Decimal('2'), 'm'))
        self.assertEqual(result.confidence, CONFIDENCE_EXACT)

    def test_centimetres_are_converted_and_marked_as_such(self):
        result = self.convert('50 cm')
        self.assertEqual(result.value, Decimal('0.50'))
        self.assertEqual(result.confidence, CONFIDENCE_CONVERTED)

    def test_millimetres_convert_too(self):
        self.assertEqual(self.convert('500 mm').value, Decimal('0.500'))

    def test_accepts_the_spelled_out_and_german_unit_names(self):
        for text in ('2 meter', '2 metre', '2 meters'):
            with self.subTest(text=text):
                self.assertEqual(self.convert(text).value, Decimal('2'))
        self.assertEqual(self.convert('50 zentimeter').value, Decimal('0.50'))

    def test_matches_a_unit_regardless_of_case_or_padding(self):
        self.assertEqual(self.convert({'value': 50, 'unit': ' CM '}).value, Decimal('0.50'))

    def test_reports_the_normalized_unit_it_actually_used(self):
        self.assertEqual(self.convert('50 CM').source_unit, 'cm')

    def test_asks_rather_than_guessing_when_no_unit_is_stated_anywhere(self):
        # This is the module's whole reason for existing: 30 must never be
        # read as 30 m just because the field is a length.
        result = self.convert(30)
        self.assertEqual(result.confidence, CONFIDENCE_NEEDS_CLARIFICATION)
        self.assertEqual(result.error, 'unit_missing')
        self.assertIsNone(result.value)

    def test_rejects_a_unit_it_was_never_taught(self):
        result = self.convert('2 furlong')
        self.assertEqual(result.confidence, CONFIDENCE_INVALID)
        self.assertEqual(result.error, 'unit_unknown')

    def test_passes_a_parse_error_through_as_invalid(self):
        result = self.convert('fifty')
        self.assertEqual(result.confidence, CONFIDENCE_INVALID)
        self.assertEqual(result.error, 'not_a_number')

    def test_strips_a_unit_that_reaches_it_unpadded(self):
        # Every path through parse_raw_amount strips the unit already, so this
        # exercises convert_to_canonical_length's own contract rather than a
        # value the parser can produce.
        result = convert_to_canonical_length(ParsedAmount(Decimal('2'), ' M ', True))
        self.assertEqual(result.value, Decimal('2'))
        self.assertEqual(result.source_unit, 'm')

    def test_accepts_a_non_finite_number_as_a_converted_length(self):
        # Python's json.loads accepts the bare NaN and Infinity literals, so a
        # payload can carry one. Decimal(str(nan)) is a valid Decimal, and
        # nothing downstream rejects it: the preview reports 'converted' with no
        # error for a value that is not a measurement at all. Recorded as
        # current behaviour — for a module whose stated rule is never to guess,
        # this is the one input it accepts without complaint.
        for raw in (float('nan'), float('inf')):
            with self.subTest(raw=raw):
                result = self.convert(raw, implied_unit='m')
                self.assertIsNone(result.error)
                self.assertEqual(result.confidence, CONFIDENCE_EXACT)
                self.assertFalse(result.value.is_finite())

    def test_still_names_metres_as_the_canonical_unit_when_it_fails(self):
        # The preview column header is built from this, so it has to be right
        # even for a row that could not be converted.
        self.assertEqual(self.convert('fifty').canonical_unit, 'm')


class ConvertPlainNumberTests(TestCase):
    """Direct tests for fixed-unit fields (days, percent, grams)."""

    def convert(self, raw_value, expected_unit, implied_unit=None):
        return convert_plain_number(parse_raw_amount(raw_value, implied_unit), expected_unit)

    def test_accepts_a_bare_number_for_a_fixed_unit_field(self):
        result = self.convert(30, 'days')
        self.assertEqual((result.value, result.canonical_unit), (Decimal('30'), 'days'))
        self.assertEqual(result.confidence, CONFIDENCE_EXACT)

    def test_accepts_a_unit_that_agrees_with_the_field(self):
        self.assertEqual(self.convert('30 days', 'days').value, Decimal('30'))

    def test_accepts_the_german_and_abbreviated_spellings(self):
        for text in ('30 tage', '30 Tag', '30 d', '30 DAYS'):
            with self.subTest(text=text):
                self.assertEqual(self.convert(text, 'days').confidence, CONFIDENCE_EXACT)

    def test_accepts_the_percent_and_gram_synonyms(self):
        self.assertEqual(self.convert('5 prozent', 'percent').value, Decimal('5'))
        self.assertEqual(self.convert({'value': 5, 'unit': '%'}, 'percent').value, Decimal('5'))
        self.assertEqual(self.convert('5 gramm', 'g').value, Decimal('5'))
        self.assertEqual(self.convert('5 kilogramm', 'kg').value, Decimal('5'))

    def test_rejects_a_unit_that_contradicts_the_field(self):
        # These fields have exactly one legal unit, so a stated "cm" on a
        # days field is a mistake in the file, not something to convert.
        result = self.convert('30 cm', 'days')
        self.assertEqual((result.confidence, result.error), (CONFIDENCE_INVALID, 'unit_unknown'))

    def test_falls_back_to_the_unit_itself_for_a_field_with_no_synonyms(self):
        self.assertEqual(self.convert('5 stk', 'stk').value, Decimal('5'))
        self.assertEqual(self.convert('5 kg', 'stk').error, 'unit_unknown')

    def test_ignores_a_unit_that_was_only_implied_by_the_key(self):
        # An implied unit is the importer's own guess, so it is never held
        # against the row the way an explicitly stated one is.
        result = self.convert(30, 'days', implied_unit='cm')
        self.assertEqual(result.confidence, CONFIDENCE_EXACT)

    def test_accepts_any_stated_unit_for_a_unitless_field(self):
        # With no expected unit there is nothing to disagree with.
        self.assertEqual(self.convert('30 anything', None).confidence, CONFIDENCE_EXACT)

    def test_names_the_field_unit_when_the_value_stated_none(self):
        self.assertEqual(self.convert(30, 'days').source_unit, 'days')

    def test_passes_a_parse_error_through_as_invalid(self):
        result = self.convert('thirty', 'days')
        self.assertEqual((result.confidence, result.error), (CONFIDENCE_INVALID, 'not_a_number'))
        self.assertEqual(result.canonical_unit, 'days')


class NormalizeSeedRateUnitInputTests(TestCase):
    """Direct tests for the seed-rate unit vocabulary mapping."""

    def test_passes_a_canonical_unit_through(self):
        self.assertEqual(normalize_seed_rate_unit_input('g_per_m2'), ('g_per_m2', None))

    def test_translates_a_synonym_spelling(self):
        canonical, error = normalize_seed_rate_unit_input('g/m²')
        self.assertIsNone(error)
        self.assertEqual(canonical, 'g_per_m2')

    def test_ignores_surrounding_whitespace(self):
        self.assertEqual(normalize_seed_rate_unit_input('  g_per_m2  ')[0], 'g_per_m2')

    def test_reports_a_missing_unit_separately_from_an_unknown_one(self):
        # The preview shows different guidance for the two, so they must not
        # collapse into one code.
        for raw in (None, '', '   ', '-'):
            with self.subTest(raw=raw):
                self.assertEqual(normalize_seed_rate_unit_input(raw), (None, 'unit_missing'))

    def test_rejects_a_unit_outside_the_project_vocabulary(self):
        for raw in ('kg_per_hectare', 'cm', 'seeds'):
            with self.subTest(raw=raw):
                self.assertEqual(normalize_seed_rate_unit_input(raw), (None, 'unit_unknown'))

    def test_stringifies_a_non_string_before_matching(self):
        self.assertEqual(normalize_seed_rate_unit_input(5), (None, 'unit_unknown'))

    def test_every_spelling_it_accepts_lands_inside_the_project_vocabulary(self):
        # The `not in SEED_RATE_UNIT_VALUES` half of the guard is redundant
        # today: normalize_seed_rate_unit's own mapping only ever produces the
        # five canonical units. It is a reasonable defence, since the mapping
        # and the vocabulary live in different modules and could drift apart.
        for spelling in ('g/m²', 'g_per_lfm', 'seeds_per_plant', 'Samen pro Pflanze'):
            with self.subTest(spelling=spelling):
                canonical, error = normalize_seed_rate_unit_input(spelling)
                if error is None:
                    self.assertIn(canonical, SEED_RATE_UNIT_VALUES)
