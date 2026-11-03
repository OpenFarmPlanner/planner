"""Timing windows: resolution, canonical text, parser, constraints, API, history, import, planning."""

import json
from datetime import date
from pathlib import Path

from django.db import IntegrityError, transaction
from django.test import SimpleTestCase, TestCase
from rest_framework import status

from crops.models import CropSpecies
from farm.models import Crop, CropTimingWindow, EntityRevision, PlantingPlan, Season
from farm.services.crop_import.timing_windows import (
    ERROR_AMBIGUOUS_SLASH,
    ERROR_DAY_DATES,
    ERROR_INVALID_WEEK,
    ERROR_MIXED_UNITS,
    ERROR_NOT_RECOGNIZED,
    ERROR_OPEN_END,
    TimingWindowParseError,
    parse_timing_window_cell,
)
from farm.services.timing_windows import (
    TimingWindow,
    format_window,
    format_windows,
    months_covered,
    resolve_window,
    window_contains,
)
from farm.tests.api_base import ProjectApiTestCase

FIXTURE_PATH = Path(__file__).resolve().parents[3] / 'tests' / 'fixtures' / 'timing_windows.json'
FIXTURE = json.loads(FIXTURE_PATH.read_text(encoding='utf-8'))
LANGUAGES = ('de', 'en', 'fr', 'es')
CROPS_URL = '/openfarmplanner/api/crops/'


def _window(data: dict, kind: str = 'direct_sowing') -> TimingWindow:
    return TimingWindow.from_dict({'kind': kind, **data})


def decade(start_month, start_decade, end_month, end_decade, kind='direct_sowing') -> TimingWindow:
    return TimingWindow.decade(kind, start_month, start_decade, end_month, end_decade)


def weeks(start, end, kind='direct_sowing') -> TimingWindow:
    return TimingWindow.weeks(kind, start, end)


class SharedFixtureTest(SimpleTestCase):
    """The cases the frontend's timingWindows.ts is tested against, too."""

    def test_canonical_text_in_every_language(self):
        for case in FIXTURE['format']:
            for language in LANGUAGES:
                with self.subTest(window=case['window'], language=language):
                    self.assertEqual(format_window(_window(case['window']), language), case['text'][language])

    def test_several_windows_are_joined_with_semicolons(self):
        for case in FIXTURE['formatList']:
            windows = [_window(window) for window in case['windows']]
            for language in LANGUAGES:
                self.assertEqual(format_windows(windows, language), case['text'][language])

    def test_resolution_to_date_ranges(self):
        for case in FIXTURE['resolve']:
            with self.subTest(window=case['window'], year=case['year']):
                expected = [(date.fromisoformat(start), date.fromisoformat(end)) for start, end in case['ranges']]
                self.assertEqual(resolve_window(_window(case['window']), case['year']), expected)

    def test_contains(self):
        for case in FIXTURE['contains']:
            with self.subTest(window=case['window'], day=case['date']):
                self.assertEqual(
                    window_contains(_window(case['window']), date.fromisoformat(case['date'])),
                    case['expected'],
                )

    def test_months_covered(self):
        for case in FIXTURE['months']:
            with self.subTest(windows=case['windows']):
                windows = [_window(window) for window in case['windows']]
                self.assertEqual(months_covered(windows, case['year']), case['months'])


class ResolutionTest(SimpleTestCase):
    def test_month_end_follows_the_real_calendar(self):
        self.assertEqual(resolve_window(decade(4, 'late', 4, 'late'), 2026), [(date(2026, 4, 21), date(2026, 4, 30))])
        self.assertEqual(resolve_window(decade(2, 'late', 2, 'late'), 2028), [(date(2028, 2, 21), date(2028, 2, 29))])
        self.assertEqual(resolve_window(decade(2, 'late', 2, 'late'), 2100), [(date(2100, 2, 21), date(2100, 2, 28))])

    def test_week_windows_run_monday_to_sunday(self):
        start, end = resolve_window(weeks(10, 14), 2026)[0]
        self.assertEqual((start.isoweekday(), end.isoweekday()), (1, 7))

    def test_a_week_window_across_new_year_covers_week_53(self):
        # 2026 has 53 ISO weeks; 31 Dec 2026 lies in week 53.
        self.assertEqual(date(2026, 12, 31).isocalendar().week, 53)
        self.assertTrue(window_contains(weeks(52, 1), date(2026, 12, 31)))
        self.assertFalse(window_contains(weeks(40, 52), date(2026, 12, 31)))

    def test_a_week_window_uses_the_iso_year_around_new_year(self):
        # 31 Dec 2025 is in week 1 of 2026.
        self.assertEqual(date(2025, 12, 31).isocalendar()[:2], (2026, 1))
        self.assertTrue(window_contains(weeks(1, 5), date(2025, 12, 31)))
        self.assertFalse(window_contains(weeks(2, 5), date(2025, 12, 31)))

    def test_start_equal_to_end_is_one_third_or_one_week(self):
        self.assertTrue(window_contains(decade(6, 'mid', 6, 'mid'), date(2026, 6, 15)))
        self.assertFalse(window_contains(decade(6, 'mid', 6, 'mid'), date(2026, 6, 21)))
        self.assertTrue(window_contains(weeks(20, 20), date.fromisocalendar(2026, 20, 3)))


class ParserTest(SimpleTestCase):
    def parse_one(self, text: str) -> TimingWindow:
        windows = parse_timing_window_cell('direct_sowing', text)
        self.assertEqual(len(windows), 1, text)
        return windows[0]

    def assert_rejected(self, text: str, code: str) -> None:
        with self.assertRaises(TimingWindowParseError) as context:
            parse_timing_window_cell('direct_sowing', text)
        self.assertEqual(context.exception.code, code, text)

    def test_round_trip_of_the_canonical_text_in_every_language(self):
        for case in FIXTURE['format']:
            expected = _window(case['window'])
            for language in LANGUAGES:
                with self.subTest(text=case['text'][language]):
                    self.assertEqual(self.parse_one(case['text'][language]), expected)
        for case in FIXTURE['formatList']:
            for language in LANGUAGES:
                parsed = parse_timing_window_cell('direct_sowing', case['text'][language])
                self.assertEqual(parsed, [_window(window) for window in case['windows']])

    def test_accepted_decade_forms(self):
        cases = {
            'Anfang März bis Ende April': decade(3, 'early', 4, 'late'),
            'anfang   MÄRZ  –  ende april': decade(3, 'early', 4, 'late'),
            'Anfang März — Mitte Mai': decade(3, 'early', 5, 'mid'),
            'Mitte März - Ende April': decade(3, 'mid', 4, 'late'),
            'Mitte März': decade(3, 'mid', 3, 'mid'),
            'März': decade(3, 'early', 3, 'late'),
            'März bis Mai': decade(3, 'early', 5, 'late'),
            'Mär - Mai': decade(3, 'early', 5, 'late'),
            'Mär. bis Mai': decade(3, 'early', 5, 'late'),
            'Mrz–Apr': decade(3, 'early', 4, 'late'),
            'Jänner bis Feber': decade(1, 'early', 2, 'late'),
            'Jän - Mär': decade(1, 'early', 3, 'late'),
            'März bis Mitte Mai': decade(3, 'early', 5, 'mid'),
            'Mitte März bis Mai': decade(3, 'mid', 5, 'late'),
            'Anfang bis Mitte März': decade(3, 'early', 3, 'mid'),
            'von März bis Mai': decade(3, 'early', 5, 'late'),
            'Nov bis Feb': decade(11, 'early', 2, 'late'),
            'early March to mid May': decade(3, 'early', 5, 'mid'),
            'Mar to Sept': decade(3, 'early', 9, 'late'),
            'from March to May': decade(3, 'early', 5, 'late'),
            'end of August': decade(8, 'late', 8, 'late'),
            'début mars à mi-mai': decade(3, 'early', 5, 'mid'),
            'de mars à mai': decade(3, 'early', 5, 'late'),
            'fin août': decade(8, 'late', 8, 'late'),
            'mi - avril': decade(4, 'mid', 4, 'mid'),
            "mars jusqu'à mai": decade(3, 'early', 5, 'late'),
            'principios de marzo a mediados de mayo': decade(3, 'early', 5, 'mid'),
            'de marzo hasta mayo': decade(3, 'early', 5, 'late'),
            'finales de agosto': decade(8, 'late', 8, 'late'),
            'dic - ene': decade(12, 'early', 1, 'late'),
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(self.parse_one(text), expected)

    def test_accepted_week_forms(self):
        cases = {
            'KW 10': weeks(10, 10),
            'KW10': weeks(10, 10),
            'kw 10 bis 14': weeks(10, 14),
            'KW 10 bis KW 14': weeks(10, 14),
            'KW10-14': weeks(10, 14),
            'CW 10': weeks(10, 10),
            'week 10 to 14': weeks(10, 14),
            'semaine 10': weeks(10, 10),
            'semaines 10 à 14': weeks(10, 14),
            'S10 - S14': weeks(10, 14),
            'semana 10 a 14': weeks(10, 14),
            'KW 44 bis 8': weeks(44, 8),
            'KW 52': weeks(52, 52),
            'KW 1': weeks(1, 1),
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(self.parse_one(text), expected)

    def test_several_windows_and_empty_cells(self):
        self.assertEqual(
            parse_timing_window_cell('planting', 'Mitte März bis Ende April;KW 30 ; '),
            [decade(3, 'mid', 4, 'late', kind='planting'), weeks(30, 30, kind='planting')],
        )
        self.assertEqual(parse_timing_window_cell('planting', '  '), [])
        self.assertEqual(parse_timing_window_cell('planting', None), [])

    def test_rejected_forms(self):
        cases = {
            'Frühjahr': ERROR_NOT_RECOGNIZED,
            'nach den Eisheiligen': ERROR_NOT_RECOGNIZED,
            'März, April': ERROR_NOT_RECOGNIZED,
            '10': ERROR_NOT_RECOGNIZED,
            'März bis 14': ERROR_NOT_RECOGNIZED,
            'ab März': ERROR_OPEN_END,
            'bis April': ERROR_OPEN_END,
            'März bis': ERROR_OPEN_END,
            'from March': ERROR_OPEN_END,
            'à partir de mars': ERROR_OPEN_END,
            'desde marzo': ERROR_OPEN_END,
            'März/April': ERROR_AMBIGUOUS_SLASH,
            'Mar / Apr': ERROR_AMBIGUOUS_SLASH,
            '15.03. bis 30.04.': ERROR_DAY_DATES,
            '15.3.': ERROR_DAY_DATES,
            '2026-03-15': ERROR_DAY_DATES,
            '15/03/2026': ERROR_DAY_DATES,
            '15. März': ERROR_DAY_DATES,
            'March 15 to April 30': ERROR_DAY_DATES,
            '1er mars': ERROR_DAY_DATES,
            'Anfang März bis KW 16': ERROR_MIXED_UNITS,
            'KW 10 bis Mai': ERROR_MIXED_UNITS,
            'KW 0': ERROR_INVALID_WEEK,
            'KW 53': ERROR_INVALID_WEEK,
            'KW 60': ERROR_INVALID_WEEK,
            'KW 50 bis 53': ERROR_INVALID_WEEK,
        }
        for text, code in cases.items():
            with self.subTest(text=text):
                self.assert_rejected(text, code)

    def test_one_bad_part_rejects_the_cell_and_names_that_part(self):
        with self.assertRaises(TimingWindowParseError) as context:
            parse_timing_window_cell('direct_sowing', 'März bis Mai; Frühjahr')
        self.assertEqual(context.exception.value, 'Frühjahr')


class TimingWindowConstraintTest(TestCase):
    def setUp(self):
        from farm.models import Project

        self.project = Project.objects.create(name='Constraint Project', slug='constraint-project')
        self.crop = Crop.objects.create(name='Möhre', project=self.project)

    def assert_rejected(self, **fields):
        with self.assertRaises(IntegrityError), transaction.atomic():
            CropTimingWindow.objects.create(crop=self.crop, kind=fields.pop('kind', 'planting'), **fields)

    def test_valid_rows_are_stored(self):
        CropTimingWindow.objects.create(
            crop=self.crop, kind='planting', unit='decade',
            start_month=11, start_decade=1, end_month=2, end_decade=3,
        )
        CropTimingWindow.objects.create(crop=self.crop, kind='planting', unit='iso_week', start_week=52, end_week=1)
        self.assertEqual(self.crop.timing_windows.count(), 2)

    def test_decade_windows_need_exactly_their_fields_in_range(self):
        self.assert_rejected(unit='decade', start_month=3, start_decade=1, end_month=4)
        self.assert_rejected(unit='decade', start_month=13, start_decade=1, end_month=4, end_decade=3)
        self.assert_rejected(unit='decade', start_month=3, start_decade=4, end_month=4, end_decade=3)
        self.assert_rejected(unit='decade', start_month=3, start_decade=1, end_month=4, end_decade=3, start_week=5)

    def test_week_windows_need_exactly_their_fields_in_range(self):
        self.assert_rejected(unit='iso_week', start_week=10)
        self.assert_rejected(unit='iso_week', start_week=0, end_week=10)
        self.assert_rejected(unit='iso_week', start_week=10, end_week=53)
        self.assert_rejected(unit='iso_week', start_week=10, end_week=12, start_month=3)

    def test_unknown_kind_or_unit_is_rejected(self):
        self.assert_rejected(kind='sowing', unit='iso_week', start_week=1, end_week=2)
        # Harvest windows were dropped: the harvest follows from planting and growth duration.
        self.assert_rejected(kind='harvest', unit='iso_week', start_week=1, end_week=2)
        self.assert_rejected(unit='day', start_week=1, end_week=2)


def api_window(kind='direct_sowing', unit='decade', **fields):
    window = {
        'kind': kind, 'unit': unit,
        'start_month': None, 'start_decade': None, 'end_month': None, 'end_decade': None,
        'start_week': None, 'end_week': None,
    }
    window.update(fields)
    return window


class TimingWindowApiTest(ProjectApiTestCase):
    def setUp(self):
        super().setUp()
        self.species = CropSpecies.objects.create(name='Daucus carota')
        self.general = Crop.objects.create(name='Karotte', project=self.project, crop_species=self.species)
        self.variety = Crop.objects.create(
            name='Karotte', variety='Nantaise', project=self.project, crop_species=self.species,
        )

    def put_windows(self, crop, windows):
        return self.client.patch(f'{CROPS_URL}{crop.id}/', {'timing_windows': windows}, format='json')

    def test_writing_replaces_the_whole_list_and_reads_it_back(self):
        march_to_may = api_window(start_month=3, start_decade='early', end_month=5, end_decade='late')
        response = self.put_windows(self.general, [
            march_to_may,
            api_window(kind='planting', unit='iso_week', start_week=28, end_week=40),
        ])
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(len(response.data['timing_windows']), 2)

        response = self.put_windows(self.general, [march_to_may])
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data['timing_windows'], [march_to_may])
        self.assertEqual(self.general.timing_windows.count(), 1)
        self.assertEqual(response.data['sowing_months'], [3, 4, 5])

    def test_incomplete_mixed_or_out_of_range_windows_are_rejected(self):
        invalid = [
            api_window(start_month=3, start_decade='early', end_month=None, end_decade='late'),
            api_window(start_month=3, start_decade='early', end_month=4, end_decade='late', start_week=3),
            api_window(unit='iso_week', start_week=10, end_week=53),
            api_window(unit='iso_week', start_week=10),
            api_window(start_month=3, start_decade='first', end_month=4, end_decade='late'),
        ]
        for window in invalid:
            with self.subTest(window=window):
                response = self.put_windows(self.general, [window])
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(self.general.timing_windows.count(), 0)

    def test_a_sorte_inherits_per_kind_and_live(self):
        self.put_windows(self.general, [
            api_window(start_month=3, start_decade='early', end_month=5, end_decade='late'),
            api_window(kind='planting', start_month=7, start_decade='mid', end_month=9, end_decade='late'),
        ])
        own_direct = api_window(unit='iso_week', start_week=12, end_week=16)
        response = self.put_windows(self.variety, [own_direct])
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data['timing_windows'], [own_direct])
        effective = response.data['effective_timing_windows']
        self.assertEqual(
            [(window['kind'], window['inherited']) for window in effective],
            [('direct_sowing', False), ('planting', True)],
        )

        # A change on the Kultur reaches the Sorte without a copy.
        self.put_windows(self.general, [api_window(kind='planting', unit='iso_week', start_week=30, end_week=35)])
        data = self.client.get(f'{CROPS_URL}{self.variety.id}/').data
        self.assertEqual(
            [(window['kind'], window['start_week'], window['inherited']) for window in data['effective_timing_windows']],
            [('direct_sowing', 12, False), ('planting', 30, True)],
        )

    def test_a_kultur_does_not_inherit_and_a_free_text_sorte_has_nothing_to_inherit(self):
        free_text = Crop.objects.create(name='Karotte', variety='Unbekannt', project=self.project)
        self.put_windows(self.general, [api_window(start_month=3, start_decade='early', end_month=5, end_decade='late')])
        data = self.client.get(f'{CROPS_URL}{free_text.id}/').data
        self.assertEqual(data['effective_timing_windows'], [])

    def test_windows_are_part_of_the_crop_history_and_restore(self):
        self.put_windows(self.general, [api_window(start_month=3, start_decade='early', end_month=5, end_decade='late')])
        revision = EntityRevision.objects.filter(
            entity_type='crop', object_id=self.general.id,
        ).order_by('-id').first()
        self.assertIn('timing_windows', revision.changed_fields)
        self.assertEqual(len(revision.snapshot['timing_windows']), 1)

        self.put_windows(self.general, [])
        self.assertEqual(self.general.timing_windows.count(), 0)
        response = self.client.post(
            f'{CROPS_URL}{self.general.id}/restore/', {'history_id': revision.id}, format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(self.general.timing_windows.count(), 1)

    def test_windows_never_count_as_a_library_divergence(self):
        self.general.is_modified_from_source = False
        self.general.save()
        self.put_windows(self.general, [api_window(unit='iso_week', start_week=10, end_week=12)])
        self.general.refresh_from_db()
        self.assertFalse(self.general.is_modified_from_source)


class TimingWindowImportTest(ProjectApiTestCase):
    def test_a_window_in_the_harvest_duration_column_is_reported(self):
        rows = [
            {'name': 'Kürbis', 'harvest_duration_days_text': 'Juli bis September'},
            {'name': 'Zucchini', 'harvest_duration_days_text': 'laufend'},
            {'name': 'Bohne', 'harvest_duration_days': 21},
        ]
        preview = self.preview([dict(row) for row in rows]).data['results']
        self.assertEqual(preview[0]['timing_window_issues'], [{
            'field': 'harvest_duration_days',
            'value': 'Juli bis September',
            'code': 'timing_window_harvest_not_imported',
            'message': preview[0]['timing_window_issues'][0]['message'],
        }])
        # Other text keeps the old behaviour: dropped without a message.
        self.assertNotIn('timing_window_issues', preview[1])
        self.assertNotIn('timing_window_issues', preview[2])

        response = self.apply([dict(row) for row in rows])
        self.assertEqual(response.data['created_count'], 3)
        self.assertEqual(
            [issue['code'] for issue in response.data['timing_window_issues']],
            ['timing_window_harvest_not_imported'],
        )
        self.assertIsNone(Crop.objects.get(name='Kürbis').harvest_duration_days)
        self.assertEqual(Crop.objects.get(name='Bohne').harvest_duration_days, 21)

    def preview(self, rows):
        return self.client.post(f'{CROPS_URL}import/preview/', rows, format='json')

    def apply(self, rows, confirm_updates=True):
        return self.client.post(
            f'{CROPS_URL}import/apply/', {'items': rows, 'confirm_updates': confirm_updates}, format='json',
        )

    def test_a_rejected_cell_is_reported_and_only_that_cell_is_dropped(self):
        row = {
            'name': 'Salat',
            'direct_sowing_windows': 'Anfang März bis Ende April; KW 30',
            'planting_windows': 'nach den Eisheiligen',
        }
        preview = self.preview([dict(row)])
        result = preview.data['results'][0]
        self.assertEqual(result['status'], 'create')
        self.assertEqual(result['timing_window_issues'], [{
            'field': 'planting_windows',
            'value': 'nach den Eisheiligen',
            'code': ERROR_NOT_RECOGNIZED,
            'message': result['timing_window_issues'][0]['message'],
        }])

        response = self.apply([dict(row)])
        self.assertEqual(response.data['created_count'], 1)
        self.assertEqual(response.data['timing_window_issues'][0]['index'], 0)
        crop = Crop.objects.get(name='Salat')
        self.assertEqual(
            [(window.kind, window.unit) for window in crop.timing_windows.order_by('position')],
            [('direct_sowing', 'decade'), ('direct_sowing', 'iso_week')],
        )

    def test_an_update_replaces_only_the_kinds_with_a_cell(self):
        CropTimingWindow.objects.create(
            crop=self.crop, kind='planting', unit='iso_week', start_week=28, end_week=30,
        )
        rows = [{'name': self.crop.name, 'direct_sowing_windows': 'März bis Mai'}]
        preview = self.preview([dict(rows[0])]).data['results'][0]
        self.assertEqual(preview['status'], 'update_candidate')
        window_diff = [change for change in preview['diff'] if change['field'] == 'direct_sowing_windows']
        self.assertEqual(len(window_diff), 1)
        self.assertEqual(window_diff[0]['current'], [])

        self.apply(rows)
        self.assertEqual(
            sorted(self.crop.timing_windows.values_list('kind', flat=True)),
            ['direct_sowing', 'planting'],
        )

    def test_export_text_imports_back_to_the_same_windows_in_every_language(self):
        windows = [
            decade(3, 'early', 4, 'late', kind='pre_cultivation'),
            decade(3, 'mid', 5, 'early', kind='direct_sowing'),
            weeks(19, 22, kind='planting'),
            decade(7, 'mid', 7, 'mid', kind='planting'),
            weeks(44, 8, kind='planting'),
        ]
        for language in LANGUAGES:
            with self.subTest(language=language):
                Crop.objects.filter(name=f'Kohl {language}').delete()
                row = {'name': f'Kohl {language}'}
                for kind in ('pre_cultivation', 'direct_sowing', 'planting'):
                    row[f'{kind}_windows'] = format_windows(
                        [window for window in windows if window.kind == kind], language,
                    )
                response = self.apply([row])
                self.assertNotIn('timing_window_issues', response.data)
                crop = Crop.objects.get(name=f'Kohl {language}')
                stored = [TimingWindow.from_model(row) for row in crop.timing_windows.order_by('kind', 'position')]
                self.assertEqual(
                    sorted(stored, key=lambda window: (window.kind, str(window.as_dict()))),
                    sorted(windows, key=lambda window: (window.kind, str(window.as_dict()))),
                )


class TimingWindowPlanningHintTest(ProjectApiTestCase):
    def setUp(self):
        super().setUp()
        self.season = Season.objects.create(
            project=self.project, start_date=date(2026, 1, 1), end_date=date(2026, 12, 31),
        )
        self.crop.growth_duration_days = 60
        self.crop.propagation_duration_days = 28
        self.crop.cultivation_types = ['pre_cultivation', 'direct_sowing']
        self.crop.save()

    def add_windows(self, *windows):
        self.crop.pending_timing_windows = list(windows)
        self.crop.save()

    def findings_for(self, cultivation_type, planting_date):
        plan = PlantingPlan.objects.create(
            project=self.project, season=self.season, crop=self.crop, bed=self.bed,
            planting_date=planting_date, cultivation_type=cultivation_type, area_usage_sqm=2,
        )
        data = self.client.get(f'/openfarmplanner/api/planting-plans/{plan.id}/').data
        return [(finding['kind'], finding['date']) for finding in data['timing_window_findings']]

    def test_no_windows_means_no_hint(self):
        self.assertEqual(self.findings_for('direct_sowing', date(2026, 8, 1)), [])

    def test_direct_sowing_checks_the_sowing_date(self):
        self.add_windows(decade(3, 'early', 5, 'late'))
        self.assertEqual(self.findings_for('direct_sowing', date(2026, 4, 1)), [])
        self.assertEqual(self.findings_for('direct_sowing', date(2026, 8, 1)), [('direct_sowing', '2026-08-01')])

    def test_own_propagation_checks_only_the_planting_date_when_there_are_planting_windows(self):
        self.add_windows(
            decade(3, 'early', 3, 'late', kind='pre_cultivation'),
            weeks(17, 19, kind='planting'),
        )
        # Planted 2026-04-29 (week 18): fine, although sown 2026-04-01, after the
        # Anzucht window; the Anzucht window is not checked at all.
        self.assertEqual(self.findings_for('pre_cultivation', date(2026, 4, 29)), [])
        # Planted 2026-06-01: one hint, for the planting date only.
        self.assertEqual(
            self.findings_for('pre_cultivation', date(2026, 6, 1)),
            [('planting', '2026-06-01')],
        )

    def test_own_propagation_checks_the_sowing_date_without_planting_windows(self):
        self.add_windows(decade(3, 'early', 3, 'late', kind='pre_cultivation'))
        # Planted 2026-04-15: sown 2026-03-18, inside the Anzucht window.
        self.assertEqual(self.findings_for('pre_cultivation', date(2026, 4, 15)), [])
        # Planted 2026-04-29: sown 2026-04-01, outside it.
        self.assertEqual(
            self.findings_for('pre_cultivation', date(2026, 4, 29)),
            [('pre_cultivation', '2026-04-01')],
        )

    def test_bought_in_plants_only_check_the_planting_date(self):
        self.add_windows(
            decade(3, 'early', 3, 'late', kind='pre_cultivation'),
            weeks(17, 19, kind='planting'),
        )
        self.assertEqual(self.findings_for('purchased_transplant', date(2026, 4, 29)), [])
        self.assertEqual(
            self.findings_for('purchased_transplant', date(2026, 6, 1)),
            [('planting', '2026-06-01')],
        )
        # Without Pflanzung windows bought-in plants get no hint, even with Anzucht windows.
        self.add_windows(decade(3, 'early', 3, 'late', kind='pre_cultivation'))
        self.assertEqual(self.findings_for('purchased_transplant', date(2026, 6, 1)), [])

    def test_the_harvest_start_is_never_checked(self):
        self.add_windows(decade(3, 'early', 5, 'late'))
        # 2026-05-01 + 60 days growth = harvest 2026-06-30, outside every window: no hint.
        self.assertEqual(self.findings_for('direct_sowing', date(2026, 5, 1)), [])

    def test_a_window_across_new_year_is_resolved_in_the_dates_year(self):
        self.add_windows(decade(11, 'early', 2, 'late', kind='direct_sowing'))
        self.assertEqual(self.findings_for('direct_sowing', date(2026, 1, 20)), [])
        self.assertEqual(self.findings_for('direct_sowing', date(2026, 11, 20)), [])
        self.assertEqual(self.findings_for('direct_sowing', date(2026, 3, 5)), [('direct_sowing', '2026-03-05')])

    def test_a_sorte_is_checked_against_its_inherited_windows(self):
        species = CropSpecies.objects.create(name='Lactuca sativa')
        self.crop.crop_species = species
        self.crop.save()
        variety = Crop.objects.create(
            name=self.crop.name, variety='Grün', project=self.project, crop_species=species,
        )
        self.add_windows(decade(3, 'early', 5, 'late'))
        plan = PlantingPlan.objects.create(
            project=self.project, season=self.season, crop=variety, bed=self.bed,
            planting_date=date(2026, 9, 1), cultivation_type='direct_sowing', area_usage_sqm=2,
        )
        data = self.client.get(f'/openfarmplanner/api/planting-plans/{plan.id}/').data
        self.assertEqual([finding['kind'] for finding in data['timing_window_findings']], ['direct_sowing'])

    def test_live_check_for_an_unsaved_plan(self):
        self.add_windows(decade(3, 'early', 5, 'late'))
        url = '/openfarmplanner/api/planting-plans/timing-window-check/'
        response = self.client.get(url, {
            'crop_id': self.crop.id, 'planting_date': '2026-08-01', 'cultivation_type': 'direct_sowing',
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(
            [(finding['kind'], finding['date']) for finding in response.data['timing_window_findings']],
            [('direct_sowing', '2026-08-01')],
        )
        self.assertEqual(self.client.get(url, {'crop_id': self.crop.id}).status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(
            self.client.get(url, {'crop_id': 999999, 'planting_date': '2026-08-01'}).status_code,
            status.HTTP_404_NOT_FOUND,
        )
