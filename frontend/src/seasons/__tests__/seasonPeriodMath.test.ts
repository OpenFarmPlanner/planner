import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  analyzePeriodTransition,
  computeCustomSeasonEnd,
  computeFirstSeasonPeriod,
  computeManualSeasonEnd,
  computeNextPatternStartAfter,
} from '../seasonPeriodMath';

describe('seasonPeriodMath', () => {
  it.each([
    [2027, 1, '2027-01-01', '2027-12-31'],
    [2026, 10, '2026-10-01', '2027-09-30'],
    [2027, 3, '2027-03-01', '2028-02-29'],
    [4, 1, '0004-01-01', '0004-12-31'],
    [9998, 12, '9998-12-01', '9999-11-30'],
  ])('previews the regular period for year %s, month %s', (year, month, start_date, end_date) => {
    expect(computeFirstSeasonPeriod(year, month)).toEqual({ start_date, end_date });
  });

  it('finds the next pattern start strictly after a reference date', () => {
    expect(computeNextPatternStartAfter('2026-04-15', 1, 1)).toBe('2027-01-01');
    expect(computeNextPatternStartAfter('2026-09-01', 1, 9)).toBe('2027-09-01');
    expect(computeNextPatternStartAfter('2026-01-10', 1, 9)).toBe('2026-09-01');
  });

  it('clamps the pattern day to short months', () => {
    expect(computeNextPatternStartAfter('2025-01-01', 31, 2)).toBe('2025-02-28');
  });

  it('derives a custom season end as the day before the next pattern start', () => {
    expect(computeCustomSeasonEnd('2026-04-15', 1, 1)).toBe('2026-12-31');
    expect(computeCustomSeasonEnd('2025-04-01', 1, 9)).toBe('2025-08-31');
  });

  it('derives a manual season end at the close of the following full pattern period', () => {
    expect(computeManualSeasonEnd('2026-09-01', 1, 1)).toBe('2027-12-31');
    expect(computeManualSeasonEnd('2026-04-15', 1, 1)).toBe('2027-12-31');
    expect(computeManualSeasonEnd('2025-05-01', 1, 9)).toBe('2026-08-31');
  });

  it('classifies gaps, overlaps and seamless joins', () => {
    expect(analyzePeriodTransition('2026-08-31', '2026-09-01')).toBeNull();
    expect(analyzePeriodTransition('2026-08-31', '2026-10-01')).toEqual({
      kind: 'gap',
      start_date: '2026-09-01',
      end_date: '2026-09-30',
    });
    expect(analyzePeriodTransition('2026-08-31', '2026-06-01')).toEqual({
      kind: 'overlap',
      start_date: '2026-06-01',
      end_date: '2026-08-31',
    });
  });

  it('adds days across month boundaries', () => {
    expect(addDaysIso('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
  });
});
