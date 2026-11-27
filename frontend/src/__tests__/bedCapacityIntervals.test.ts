import { describe, expect, it } from 'vitest';
import type { Bed, PlantingPlan } from '../api/types';
import { bedCapacityDayToDate, buildBedCapacityTimelines } from '../pages/bedCapacityIntervals';
import { formatDateToAPI, formatIsoDate, parseIsoDate } from '../utils/isoDate';
import { ViewMode } from '../gantt-chart/src/types/enums';
import { createTimelineDateScale, getCalendarAxisBounds, toLocalCalendarDate } from '../gantt-chart/src/utils/timelineDatePosition';

const bed = (id: number, area_sqm?: number): Bed => ({
  id, name: `Bed ${id}`, area_sqm, field: 1, location: 1, x: 0, y: 0,
});

describe('capacity band positioning', () => {
  it('keeps API calendar dates on the intended local day across daylight-saving changes', () => {
    const first = parseIsoDate('2026-03-29')!;
    const second = parseIsoDate('2026-03-30')!;
    const columns = [first, second].map(toLocalCalendarDate);
    expect(columns.map(formatDateToAPI)).toEqual(['2026-03-29', '2026-03-30']);
    const scale = createTimelineDateScale(columns, ViewMode.DAY, 100, 5)!;
    expect(scale.positionDate(second)).toBe(100);
    expect(scale.dateAt(100)).toEqual(second);
  });

  it.each([
    [ViewMode.DAY, new Date(2026, 2, 28), new Date(2026, 2, 29), new Date(2026, 2, 30)],
    [ViewMode.WEEK, new Date(2026, 2, 27), new Date(2026, 3, 3), new Date(2026, 3, 10)],
    [ViewMode.MONTH, new Date(2026, 1, 1), new Date(2026, 2, 1), new Date(2026, 3, 1)],
    [ViewMode.QUARTER, new Date(2026, 0, 1), new Date(2026, 3, 1), new Date(2026, 6, 1)],
    [ViewMode.YEAR, new Date(2026, 0, 1), new Date(2027, 0, 1), new Date(2028, 0, 1)],
  ] as const)('aligns with actual column boundaries in %s view', (mode, first, second, end) => {
    const scale = createTimelineDateScale([first, second], mode, 100, 5)!;
    const dates = [first, second, end].map(date => parseIsoDate(formatDateToAPI(date))!);
    expect(dates.map(date => scale.positionDate(date))).toEqual([0, 100, 200]);
    expect([0, 100, 200].map(position => scale.dateAt(position))).toEqual(dates);
  });

  it.each([
    [ViewMode.DAY, '2027-02-20', '2028-02-26'],
    [ViewMode.WEEK, '2027-02-20', '2028-03-03'],
    [ViewMode.MONTH, '2027-02-01', '2028-02-29'],
    [ViewMode.QUARTER, '2027-01-01', '2028-03-31'],
    [ViewMode.YEAR, '2027-01-01', '2028-12-31'],
  ] as const)('includes the full displayed calendar columns in %s view', (mode, first, last) => {
    const axis = getCalendarAxisBounds(parseIsoDate('2027-02-20')!, parseIsoDate('2028-02-26')!, mode);
    expect([formatIsoDate(axis.start), formatIsoDate(axis.end)]).toEqual([first, last]);
  });

  it('keeps a one-day change within a quarter instead of enlarging it into adjacent intervals', () => {
    const scale = createTimelineDateScale([new Date(2026, 0, 1)], ViewMode.QUARTER, 90, 5)!;
    expect(scale.positionDate(parseIsoDate('2026-01-02')!)).toBe(1);
    expect(scale.positionDate(parseIsoDate('2026-01-03')!)).toBe(2);
    expect(scale.dateAt(2)).toEqual(parseIsoDate('2026-01-03'));
    expect(scale.positionDate(parseIsoDate('2026-01-02')!, true)).toBe(2);
    expect(scale.dateAt(2, true)).toEqual(parseIsoDate('2026-01-02'));
  });
});

function plan(id: number, start: string | null, end: string | null, area?: number): PlantingPlan {
  return { id, bed: 1, crop: 1, planting_date: start, occupancy_end_date: end, area_usage_sqm: area };
}

function intervals(plans: PlantingPlan[], beds = [bed(1, 10)]) {
  return buildBedCapacityTimelines(beds, plans, '2026-03-25', '2026-04-30');
}

const days = (interval: { startDay: number; endDayExclusive: number }) =>
  [interval.startDay, interval.endDayExclusive - 1].map(day => formatIsoDate(bedCapacityDayToDate(day)));

describe('bed capacity intervals', () => {
  it('retains unknown bed capacity while an exact-count plan has pending positions', () => {
    const individual: PlantingPlan = {
      ...plan(1, '2026-03-26', '2026-03-27'), placement_mode: 'individual_bed',
      individual_count: 5, individual_positions: [],
    };
    expect(intervals([individual]).get(1)?.intervals.map(interval => [days(interval), interval.status, interval.freeArea])).toEqual([
      [['2026-03-25', '2026-03-25'], 'free', 10],
      [['2026-03-26', '2026-03-27'], 'unknown', null],
      [['2026-03-28', '2026-04-30'], 'free', 10],
    ]);
  });

  it('counts distinct plans once and changes capacity at inclusive boundaries', () => {
    const carrots = plan(1, '2026-03-28', '2026-04-09', 5);
    const lettuce = plan(2, '2026-04-04', '2026-04-12', 3);
    const result = intervals([carrots, { ...carrots }, lettuce], [bed(1, 10), bed(2, 10)]);
    expect(result.get(1)?.intervals.map(interval => [days(interval), interval.freeArea, interval.status])).toEqual([
      [['2026-03-25', '2026-03-27'], 10, 'free'],
      [['2026-03-28', '2026-04-03'], 5, 'partial'],
      [['2026-04-04', '2026-04-09'], 2, 'partial'],
      [['2026-04-10', '2026-04-12'], 7, 'partial'],
      [['2026-04-13', '2026-04-30'], 10, 'free'],
    ]);
    expect(result.get(2)?.intervals).toMatchObject([{ totalArea: 10, knownUsedArea: 0, freeArea: 10, status: 'free' }]);
  });

  it('counts a carried perennial through its clearing day rather than the harvest window', () => {
    const perennial = {
      ...plan(1, '2024-08-14', '2026-04-04', 5), carried_over: true, season: 5,
      clearing_date: '2026-04-04', harvest_date: '2025-05-01', harvest_end_date: '2025-07-01',
    };
    const result = intervals([perennial]).get(1)?.intervals ?? [];
    expect(result.map(interval => [days(interval), interval.freeArea])).toEqual([
      [['2026-03-25', '2026-04-04'], 5],
      [['2026-04-05', '2026-04-30'], 10],
    ]);
  });

  it('allocates a recurring perennial from its earlier recorded occupancy start', () => {
    const perennial = {
      ...plan(1, '2026-04-07', '2026-04-15', 10),
      seasonal_harvest: {
        occupancy_start_date: '2026-03-28', planting_recorded: true,
        periods: [{ start_date: '2026-04-02', end_date: '2026-04-05' }],
        actual_start_date: null, actual_end_date: null,
      },
    };
    const result = intervals([perennial]).get(1)?.intervals ?? [];
    expect(result.map(interval => [days(interval), interval.freeArea])).toEqual([
      [['2026-03-25', '2026-03-27'], 10],
      [['2026-03-28', '2026-04-15'], 0],
      [['2026-04-16', '2026-04-30'], 10],
    ]);
  });

  it('uses the same inclusive fallback for scheduled drafts without a recorded end', () => {
    const result = intervals([
      plan(1, '2026-03-27', null, 10),
      plan(2, null, null),
    ]).get(1)?.intervals ?? [];
    expect(result.map(interval => [days(interval), interval.status, interval.freeArea])).toEqual([
      [['2026-03-25', '2026-03-26'], 'free', 10],
      [['2026-03-27', '2026-03-27'], 'occupied', 0],
      [['2026-03-28', '2026-04-30'], 'free', 10],
    ]);
  });

  it('keeps reported over-allocation visible even when another usage is unknown', () => {
    const result = intervals([
      plan(1, '2026-03-25', '2026-04-30', 6),
      plan(2, '2026-03-26', '2026-03-28', 5),
      plan(3, '2026-03-27', '2026-03-29'),
    ], [bed(1, 10), bed(2)]).get(1)?.intervals ?? [];
    expect(result.map(({ status, freeArea, knownUsedArea, hasUnknownUsage }) =>
      [status, freeArea, knownUsedArea, hasUnknownUsage],
    )).toEqual([
      ['partial', 4, 6, false],
      ['overallocated', null, 11, false],
      ['overallocated', null, 11, true],
      ['unknown', null, 6, true],
      ['partial', 4, 6, false],
    ]);
    expect(intervals([], [bed(2)]).get(2)?.intervals).toMatchObject([
      { totalArea: null, freeArea: null, status: 'unknown' },
    ]);
  });

  it('uses stored area and exact decimal sums, with equal adjacent capacities merged', () => {
    const start = '2026-03-25';
    const end = '2026-04-30';
    const result = intervals([
      { ...plan(1, start, end, 0.1), plants_count: 300 },
      plan(2, start, '2026-04-08', 0.2),
      plan(3, '2026-04-09', end, 0.2),
    ], [bed(1, 0.3)]).get(1)?.intervals;
    expect(result).toMatchObject([{ totalArea: 0.3, knownUsedArea: 0.3, freeArea: 0, status: 'occupied' }]);
  });
});
