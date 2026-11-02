import i18n from '../i18n/config';
import type { CropTimingWindow } from '../api/types';
import {
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
    kind: 'harvest',
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
