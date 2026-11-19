"""Bounded examples of legacy companion validation with an in-memory resolver."""

from unittest.mock import Mock, patch

from django.test import SimpleTestCase
from rest_framework.exceptions import ValidationError

from farm.services import crop_companions
from farm.services.crop_companions import (
    LEGACY_COMPANION_LIMIT_CODE,
    TARGET_CROP,
    TARGET_TEXT,
    CompanionNameResolver,
    CompanionTarget,
    LegacyCompanionImportBudget,
    preview_row_companions,
    resolve_import_items,
)
from farm.services.crop_import.spreadsheet import _import_error_details


class LegacyCompanionLimitsTest(SimpleTestCase):
    def resolver(self, **limits: int) -> Mock:
        resolver = Mock(spec=CompanionNameResolver)
        resolver.legacy_import_budget = LegacyCompanionImportBudget(**limits)
        resolver.resolve.side_effect = lambda name, **kwargs: CompanionTarget(
            type=TARGET_CROP if name in {'Mint', 'Basil', 'Parsley'} else TARGET_TEXT,
        )
        return resolver

    def test_text_limit_is_checked_before_name_resolution(self) -> None:
        resolver = self.resolver()
        raw = [{'name': 'Mint – Summer observation', 'legacy': True}]
        with patch.object(crop_companions, 'MAX_LEGACY_COMPANION_LENGTH', 20):
            with self.assertRaises(ValidationError) as error:
                resolve_import_items(raw, resolver)
        details = _import_error_details(error.exception)
        self.assertEqual(details['error_code'], LEGACY_COMPANION_LIMIT_CODE)
        resolver.resolve.assert_not_called()

    def test_item_work_limit_applies_before_looking_up_either_entry(self) -> None:
        resolver = self.resolver()
        raw = [{'name': 'Mint – Summer; Basil – Spring', 'legacy': True}]
        with patch.object(crop_companions, 'MAX_LEGACY_COMPANION_ITEM_WORK', 5):
            with self.assertRaises(ValidationError):
                resolve_import_items(raw, resolver)
        resolver.resolve.assert_not_called()

    def test_batch_reserves_work_across_rows_and_kinds(self) -> None:
        resolver = self.resolver(work_remaining=6)
        row = {
            'good_companions': [{'name': 'Mint – Summer', 'legacy': True}],
            'bad_companions': [{'name': 'Basil – Spring', 'legacy': True}],
        }
        self.assertEqual(preview_row_companions(resolver, row), {'count': 2, 'unresolved': []})
        self.assertEqual(resolver.resolve.call_count, 6)

        with self.assertRaises(ValidationError):
            preview_row_companions(resolver, {
                'good_companions': [{'name': 'Parsley – Autumn', 'legacy': True}],
            })
        self.assertEqual(resolver.resolve.call_count, 6)
        self.assertEqual(preview_row_companions(resolver, {
            'good_companions': [{'name': 'Parsley'}],
        }), {'count': 1, 'unresolved': []})

    def test_text_budget_applies_to_all_legacy_entries_in_a_pass(self) -> None:
        resolver = self.resolver(text_remaining=20)
        mint = {'name': 'Mint – Summer', 'legacy': True}
        basil = {'name': 'Basil – Spring', 'legacy': True}
        self.assertEqual(resolve_import_items([mint], resolver)[0][0]['note'], 'Summer')
        previous_lookups = resolver.resolve.call_count
        with self.assertRaises(ValidationError):
            resolve_import_items([basil], resolver)
        self.assertEqual(resolver.resolve.call_count, previous_lookups)

    def test_standard_legacy_groups_keep_exact_notes_and_scale_with_group_size(self) -> None:
        for names in [('Mint',), ('Mint', 'Basil'), ('Mint', 'Basil', 'Parsley')]:
            with self.subTest(names=names):
                resolver = self.resolver()
                entries, warnings = resolve_import_items([{
                    'name': f'{", ".join(names)} – Source, page 2', 'legacy': True,
                    'notes': {'fr': 'Source française'},
                }], resolver)
                self.assertEqual(warnings, [])
                self.assertEqual([entry['name'] for entry in entries], list(names))
                self.assertEqual([entry['note'] for entry in entries], [
                    *([''] * (len(names) - 1)), 'Source, page 2',
                ])
                self.assertEqual(entries[-1]['notes'], {'fr': 'Source française'})
                self.assertEqual(resolver.resolve.call_count, 2 * len(names))
