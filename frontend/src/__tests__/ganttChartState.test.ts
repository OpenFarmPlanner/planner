import { ViewMode } from '../gantt-chart/src';
import {
  CALENDAR_VIEW_STORAGE_KEY,
  GANTT_LEFT_COLUMN_DESKTOP_MAX_WIDTH,
  GANTT_LEFT_COLUMN_DESKTOP_MIN_WIDTH,
  GANTT_LEFT_COLUMN_MOBILE_MAX_WIDTH,
  GANTT_LEFT_COLUMN_MOBILE_MIN_WIDTH,
  clampDate,
  clampGanttLeftColumnWidth,
  getCalendarModeFromViewParam,
  getCalendarViewStorageKey,
  getGanttStateStorageKey,
  getInitialTimelineReferenceDate,
  getStoredCalendarMode,
  getStoredGanttState,
  getStoredReferenceDate,
  getStoredTimelineViewModeFromState,
  getViewParamFromCalendarMode,
  isValidDate,
  storeGanttState,
} from '../pages/ganttChartState';

const KEY = 'openfarmplanner:gantt:1:state';

describe('clampGanttLeftColumnWidth', () => {
  it('keeps a width already inside the desktop limits, rounded', () => {
    expect(clampGanttLeftColumnWidth(240.4)).toBe(240);
  });

  it('clamps to the desktop limits', () => {
    expect(clampGanttLeftColumnWidth(0)).toBe(GANTT_LEFT_COLUMN_DESKTOP_MIN_WIDTH);
    expect(clampGanttLeftColumnWidth(9999)).toBe(GANTT_LEFT_COLUMN_DESKTOP_MAX_WIDTH);
  });

  it('uses the narrower mobile limits when asked', () => {
    expect(clampGanttLeftColumnWidth(0, true)).toBe(GANTT_LEFT_COLUMN_MOBILE_MIN_WIDTH);
    expect(clampGanttLeftColumnWidth(9999, true)).toBe(GANTT_LEFT_COLUMN_MOBILE_MAX_WIDTH);
  });

  it('would reject a desktop width on mobile, which is why they are separate', () => {
    expect(clampGanttLeftColumnWidth(GANTT_LEFT_COLUMN_DESKTOP_MAX_WIDTH, true))
      .toBe(GANTT_LEFT_COLUMN_MOBILE_MAX_WIDTH);
  });
});

describe('calendar mode <-> view param', () => {
  it('round-trips both modes', () => {
    for (const mode of ['occupancy', 'seedlings'] as const) {
      expect(getCalendarModeFromViewParam(getViewParamFromCalendarMode(mode))).toBe(mode);
    }
  });

  it('calls the occupancy view "field" in the URL', () => {
    expect(getViewParamFromCalendarMode('occupancy')).toBe('field');
  });

  it('falls back to occupancy for anything unrecognised', () => {
    expect(getCalendarModeFromViewParam(null)).toBe('occupancy');
    expect(getCalendarModeFromViewParam('nonsense')).toBe('occupancy');
  });
});

describe('storage keys', () => {
  it('namespaces per project so switching cannot inherit another project’s view', () => {
    expect(getCalendarViewStorageKey(1)).not.toBe(getCalendarViewStorageKey(2));
    expect(getGanttStateStorageKey(1)).not.toBe(getGanttStateStorageKey(2));
  });

  it('falls back to an unnamespaced key without a project', () => {
    expect(getCalendarViewStorageKey(null)).toBe(CALENDAR_VIEW_STORAGE_KEY);
  });

  it('has no gantt state key at all without a project', () => {
    expect(getGanttStateStorageKey(null)).toBeNull();
  });
});

describe('getStoredCalendarMode', () => {
  beforeEach(() => window.localStorage.clear());

  it('reads back a stored view param', () => {
    window.localStorage.setItem('k', 'seedlings');
    expect(getStoredCalendarMode('k')).toBe('seedlings');
  });

  it('returns null for an unrecognised value rather than guessing', () => {
    window.localStorage.setItem('k', 'nonsense');
    expect(getStoredCalendarMode('k')).toBeNull();
  });
});

describe('getStoredGanttState', () => {
  beforeEach(() => window.localStorage.clear());

  it('has nothing to read without a key', () => {
    expect(getStoredGanttState(null)).toBeNull();
  });

  it('survives unparsable JSON', () => {
    window.localStorage.setItem(KEY, '{oops');
    expect(getStoredGanttState(KEY)).toBeNull();
  });

  it('survives a non-object payload', () => {
    window.localStorage.setItem(KEY, '42');
    expect(getStoredGanttState(KEY)).toBeNull();
  });

  it('drops fields of the wrong type instead of trusting them', () => {
    window.localStorage.setItem(KEY, JSON.stringify({
      calendarMode: 'nonsense',
      timelineViewMode: 'nonsense',
      referenceDate: 5,
      rowScrollTop: 'a lot',
      leftColumnWidth: 'wide',
    }));

    expect(getStoredGanttState(KEY)).toEqual({
      calendarMode: undefined,
      timelineViewMode: undefined,
      referenceDate: undefined,
      rowScrollTop: undefined,
      leftColumnWidth: undefined,
      leftColumnWidthDesktop: undefined,
      leftColumnWidthMobile: undefined,
    });
  });

  it('rejects a non-finite scroll position', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ rowScrollTop: null }));
    expect(getStoredGanttState(KEY)?.rowScrollTop).toBeUndefined();
  });

  it('clamps a stored width that is out of range', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ leftColumnWidthDesktop: 9999 }));
    expect(getStoredGanttState(KEY)?.leftColumnWidthDesktop)
      .toBe(GANTT_LEFT_COLUMN_DESKTOP_MAX_WIDTH);
  });

  it('clamps the mobile width against the mobile limits, not the desktop ones', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ leftColumnWidthMobile: 9999 }));
    expect(getStoredGanttState(KEY)?.leftColumnWidthMobile)
      .toBe(GANTT_LEFT_COLUMN_MOBILE_MAX_WIDTH);
  });
});

describe('storeGanttState', () => {
  beforeEach(() => window.localStorage.clear());

  it('writes nothing without a key', () => {
    storeGanttState(null, { rowScrollTop: 10 });
    expect(window.localStorage.length).toBe(0);
  });

  it('merges into what is already stored rather than replacing it', () => {
    storeGanttState(KEY, { calendarMode: 'seedlings' });
    storeGanttState(KEY, { rowScrollTop: 120 });

    const stored = getStoredGanttState(KEY);
    expect(stored?.calendarMode).toBe('seedlings');
    expect(stored?.rowScrollTop).toBe(120);
  });
});

describe('dates', () => {
  const start = new Date('2026-01-01T00:00:00');
  const end = new Date('2026-12-31T00:00:00');

  it('recognises an invalid date', () => {
    expect(isValidDate(new Date('nonsense'))).toBe(false);
    expect(isValidDate(start)).toBe(true);
  });

  it('clamps to the season bounds', () => {
    expect(clampDate(new Date('2025-06-01T00:00:00'), start, end)).toEqual(start);
    expect(clampDate(new Date('2027-06-01T00:00:00'), start, end)).toEqual(end);
  });

  it('leaves a date inside the bounds alone', () => {
    const inside = new Date('2026-06-01T00:00:00');
    expect(clampDate(inside, start, end)).toEqual(inside);
  });

  it('ignores a stored reference date outside the season', () => {
    expect(getStoredReferenceDate({ referenceDate: '2020-01-01' }, start, end)).toBeNull();
  });

  it('ignores an unparsable stored reference date', () => {
    expect(getStoredReferenceDate({ referenceDate: 'nonsense' }, start, end)).toBeNull();
  });

  it('uses a stored reference date inside the season', () => {
    expect(getStoredReferenceDate({ referenceDate: '2026-06-01' }, start, end))
      .toEqual(new Date('2026-06-01T00:00:00'));
  });

  it('falls back to today, clamped into the season', () => {
    const initial = getInitialTimelineReferenceDate(null, start, end);
    expect(initial >= start && initial <= end).toBe(true);
  });

  it('only honours a stored view mode when a reference date came with it', () => {
    expect(getStoredTimelineViewModeFromState({ timelineViewMode: ViewMode.WEEK })).toBeNull();
    expect(getStoredTimelineViewModeFromState({
      referenceDate: '2026-06-01', timelineViewMode: ViewMode.WEEK,
    })).toBe(ViewMode.WEEK);
  });
});
