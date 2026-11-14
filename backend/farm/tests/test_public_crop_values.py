import subprocess
import sys
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from uuid import UUID

from django.test import TestCase

from farm.services import public_crop_values, public_crops


class PublicCropValuesTest(TestCase):
    def test_legacy_facade_preserves_function_imports(self) -> None:
        self.assertIs(public_crops._json_safe, public_crop_values.json_safe)
        self.assertIs(
            public_crops._comparable_copy_fields, public_crop_values.comparable_copy_fields,
        )
        self.assertIs(public_crops._same_snapshot_value, public_crop_values.same_snapshot_value)

    def test_snapshot_encoding_preserves_django_json_types_without_mutation(self) -> None:
        value = {
            'decimal': Decimal('1.20'), 'date': date(2026, 11, 14),
            'timestamp': datetime(2026, 11, 14, tzinfo=UTC),
            'id': UUID('f943c8de-65a2-4af0-91f3-f0b02ac38008'),
            'nested': {'empty': [], 'value': None},
        }
        snapshot = public_crop_values.json_safe(value)
        self.assertEqual(snapshot, {
            'decimal': '1.20', 'date': '2026-11-14', 'timestamp': '2026-11-14T00:00:00Z',
            'id': 'f943c8de-65a2-4af0-91f3-f0b02ac38008',
            'nested': {'empty': [], 'value': None},
        })
        snapshot['nested']['empty'].append('changed')
        self.assertEqual(value['nested']['empty'], [])

    def test_seed_unit_comparison_does_not_modify_write_payload(self) -> None:
        payload = {
            'seed_rate_value': None, 'seed_rate_by_cultivation': {}, 'seed_rate_unit': 'g_m2',
        }
        self.assertIsNone(public_crop_values.comparable_copy_fields(payload)['seed_rate_unit'])
        self.assertEqual(payload['seed_rate_unit'], 'g_m2')
        for change in ({'seed_rate_value': 0}, {'seed_rate_by_cultivation': {'direct_sowing': 2}}):
            actual = {**payload, **change}
            self.assertIs(public_crop_values.comparable_copy_fields(actual), actual)

    def test_empty_snapshot_spellings_and_nonempty_values_keep_existing_equality(self) -> None:
        for left in (None, '', [], {}):
            for right in (None, '', [], {}):
                self.assertTrue(public_crop_values.same_snapshot_value(left, right))
        self.assertFalse(public_crop_values.same_snapshot_value(0, None))
        self.assertFalse(public_crop_values.same_snapshot_value(False, ''))
        self.assertFalse(public_crop_values.same_snapshot_value([1], []))
        self.assertTrue(public_crop_values.same_snapshot_value({'a': 1}, {'a': 1}))

    def test_neutral_helpers_import_without_loading_domain_models(self) -> None:
        result = subprocess.run(
            [sys.executable, '-c', (
                'import sys; import accounts.public_identity; '
                'import farm.services.public_crop_values; '
                'assert not any(name.endswith(".models") for name in sys.modules '
                'if name.split(".")[0] in {"farm", "crops", "accounts", "notifications"})'
            )],
            cwd=Path(__file__).resolve().parents[2], capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
