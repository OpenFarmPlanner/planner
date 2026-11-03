import i18n from '../i18n/config';
import type { CropTimingWindow } from '../api/types';
import {
  computedHarvestYearSegments,
  formatTimingWindow,
  formatTimingWindows,
  monthsCoveredByTimingWindows,
  resolveTimingWindow,
  timingWindowContains,
  timingWindowYearSegments,
  wrapsYearEnd,
} from '../crops/timingWindows';
// The cases the backend's farm/services/timing_windows.py is tested against, too.
import cases from '../../../tests/fixtures/timing_windows.json';

type FixtureWindow = Omit<CropTimingWindow, 'kind'>;
const LANGUAGES = ['de', 'en', 'fr', 'es'] as const;

const toWindow = (window: FixtureWindow): CropTimingWindow => ({ kind: 'direct_sowing', ...window } as CropTimingWindow);

describe('timing windows (shared fixture)', () => {
  it.each(LANGUAGES)('formats every window canonically in %s', (language) => {
    const t = i18n.getFixedT(language);
    for (const testCase of cases.format) {
      expect(formatTimingWindow(toWindow(testCase.window as FixtureWindow), t)).toBe(testCase.text[language]);
    }
    for (const testCase of cases.formatList) {
      expect(formatTimingWindows(testCase.windows.map((window) => toWindow(window as FixtureWindow)), t))
        .toBe(testCase.text[language]);
    }
  });

  it('resolves windows to the same date ranges as the backend', () => {
    for (const testCase of cases.resolve) {
      expect(resolveTimingWindow(toWindow(testCase.window as FixtureWindow), testCase.year)).toEqual(testCase.ranges);
    }
  });

  it('decides containment like the backend', () => {
    for (const testCase of cases.contains) {
      expect(timingWindowContains(toWindow(testCase.window as FixtureWindow), testCase.date)).toBe(testCase.expected);
    }
  });

  it('covers the same months as the backend', () => {
    for (const testCase of cases.months) {
      const windows = testCase.windows.map((window) => toWindow(window as FixtureWindow));
      expect(monthsCoveredByTimingWindows(windows, testCase.year)).toEqual(testCase.months);
    }
  });
});

describe('timing window helpers', () => {
  const decade = (startMonth: number, startDecade: 'early' | 'mid' | 'late', endMonth: number, endDecade: 'early' | 'mid' | 'late'): CropTimingWindow => ({
    kind: 'planting',
    unit: 'decade',
    start_month: startMonth,
    start_decade: startDecade,
    end_month: endMonth,
    end_decade: endDecade,
    start_week: null,
    end_week: null,
  });

  it('detects a window across the year end, but not an incomplete one', () => {
    expect(wrapsYearEnd(decade(11, 'early', 2, 'late'))).toBe(true);
    expect(wrapsYearEnd(decade(3, 'mid', 3, 'early'))).toBe(true);
    expect(wrapsYearEnd(decade(3, 'early', 3, 'early'))).toBe(false);
    expect(wrapsYearEnd({ ...decade(11, 'early', 2, 'late'), end_month: null })).toBe(false);
  });

  it('splits a window across the year end into its January and December part for the year bar', () => {
    const segments = timingWindowYearSegments([decade(11, 'early', 2, 'late')], 2026);
    expect(segments).toHaveLength(2);
    expect(segments[0].start).toBe(0);
    expect(segments[1].end).toBeCloseTo(1, 5);
    expect(segments[1].start).toBeCloseTo(304 / 365, 5);
  });

  it('formats nothing for an incomplete window', () => {
    expect(formatTimingWindow({ ...decade(3, 'early', 4, 'late'), end_decade: null }, i18n.getFixedT('de'))).toBe('');
  });
});

describe('computedHarvestYearSegments', () => {
  const YEAR = 2026;
  const DAYS = 365;
  const at = (isoDate: string): number => (Date.parse(isoDate) - Date.UTC(YEAR, 0, 1)) / (DAYS * 86_400_000);
  const after = (isoDate: string): number => at(isoDate) + 1 / DAYS;
  const expectSegments = (actual: Array<{ start: number; end: number }>, expected: Array<[number, number]>): void => {
    expect(actual).toHaveLength(expected.length);
    actual.forEach((segment, index) => {
      expect(segment.start).toBeCloseTo(expected[index][0], 9);
      expect(segment.end).toBeCloseTo(expected[index][1], 9);
    });
  };
  const decade = (kind: CropTimingWindow['kind'], startMonth: number, endMonth: number): CropTimingWindow => ({
    kind,
    unit: 'decade',
    start_month: startMonth,
    start_decade: 'early',
    end_month: endMonth,
    end_decade: 'late',
    start_week: null,
    end_week: null,
  });

  it('shifts a Direktsaat window by the growth duration and adds the harvest duration', () => {
    // 1 Mar + 60 = 30 Apr; 31 Mar + 60 + 14 = 13 Jun.
    expectSegments(computedHarvestYearSegments([decade('direct_sowing', 3, 3)], {
      growthDurationDays: 60, harvestDurationDays: 14, propagationDurationDays: null,
    }, YEAR), [[at('2026-04-30'), after('2026-06-13')]]);
  });

  it('shows only the harvest start without a harvest duration', () => {
    expectSegments(computedHarvestYearSegments([decade('planting', 5, 5)], {
      growthDurationDays: 30, harvestDurationDays: null, propagationDurationDays: null,
    }, YEAR), [[at('2026-05-31'), after('2026-06-30')]]);
  });

  it('uses Anzucht windows plus the propagation duration only without Pflanzung windows', () => {
    const durations = { growthDurationDays: 60, harvestDurationDays: 0, propagationDurationDays: 30 };
    // 1 Feb + 90 = 2 May; 28 Feb + 90 = 29 May.
    expectSegments(computedHarvestYearSegments([decade('pre_cultivation', 2, 2)], durations, YEAR), [[at('2026-05-02'), after('2026-05-29')]]);
    expectSegments(computedHarvestYearSegments([decade('pre_cultivation', 2, 2), decade('planting', 5, 5)], durations, YEAR), [[at('2026-06-30'), after('2026-07-30')]]);
  });

  it('has no lane without a growth duration', () => {
    expect(computedHarvestYearSegments([decade('direct_sowing', 3, 4)], {
      growthDurationDays: null, harvestDurationDays: 14, propagationDurationDays: null,
    }, YEAR)).toEqual([]);
  });

  it('shows a harvest reaching into this year from last autumn\'s sowing', () => {
    // Sown 1-31 Oct 2025, + 120 days = 29 Jan to 28 Feb 2026.
    const segments = computedHarvestYearSegments([decade('direct_sowing', 10, 10)], {
      growthDurationDays: 120, harvestDurationDays: 0, propagationDurationDays: null,
    }, YEAR);
    expectSegments(segments.slice(0, 1), [[at('2026-01-29'), after('2026-02-28')]]);
  });
});
