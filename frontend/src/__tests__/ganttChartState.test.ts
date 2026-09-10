import { describe, expect, it } from 'vitest';
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
  GANTT_UNIT_WIDTH_BY_VIEW_MODE,
  addTimelinePeriod,
  addTimelinePeriodLarge,
  dispatchSyntheticMouseEvent,
  getDatePosition,
  getGanttUnitWidth,
  getPrimaryTouch,
  getReferenceDateFromScroll,
  getTimelineScrollLeftForDate,
  isTimelineViewMode,
  storeCalendarMode,
  storeTimelineViewMode,
  toSyntheticMousePoint,
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

const SEASON_START = new Date(2026, 0, 1);
const SEASON_END = new Date(2026, 11, 31);

describe('getGanttUnitWidth', () => {
  it('gives each view mode its own column width', () => {
    expect(getGanttUnitWidth(ViewMode.DAY)).toBe(50);
    expect(getGanttUnitWidth(ViewMode.WEEK)).toBe(80);
    expect(getGanttUnitWidth(ViewMode.MONTH)).toBe(150);
    expect(getGanttUnitWidth(ViewMode.QUARTER)).toBe(180);
    expect(getGanttUnitWidth(ViewMode.YEAR)).toBe(200);
  });

  it('falls back to the month width for a mode with no entry', () => {
    // The table is typed as complete, so only a value from outside the enum can
    // reach the fallback — which is exactly what a persisted or URL-supplied
    // mode can be.
    expect(getGanttUnitWidth('fortnight' as ViewMode))
      .toBe(GANTT_UNIT_WIDTH_BY_VIEW_MODE[ViewMode.MONTH]);
  });
});

describe('isTimelineViewMode', () => {
  it('accepts the modes the header offers', () => {
    expect(isTimelineViewMode('month')).toBe(true);
    expect(isTimelineViewMode(ViewMode.QUARTER)).toBe(true);
  });

  it('rejects the finer modes the library has but the header does not offer', () => {
    // MINUTE and HOUR are real ViewMode values, so a plain "is this in the
    // enum" check would accept them. The guard restricts to the five the
    // calendar header actually offers.
    expect(isTimelineViewMode(ViewMode.MINUTE)).toBe(false);
    expect(isTimelineViewMode(ViewMode.HOUR)).toBe(false);
  });

  it('is case-sensitive, so a differently spelled stored value is rejected', () => {
    expect(isTimelineViewMode('Month')).toBe(false);
  });

  it('rejects anything else, including a missing value', () => {
    expect(isTimelineViewMode('Fortnight')).toBe(false);
    expect(isTimelineViewMode(null)).toBe(false);
    expect(isTimelineViewMode('')).toBe(false);
  });
});

describe('storeCalendarMode / storeTimelineViewMode', () => {
  it('stores the calendar mode under its URL spelling, not the internal one', () => {
    // Writing 'occupancy' here would not read back through
    // getCalendarModeFromViewParam, which expects the 'field' spelling.
    storeCalendarMode('k1', 'occupancy');
    expect(window.localStorage.getItem('k1')).toBe('field');
    expect(getStoredCalendarMode('k1')).toBe('occupancy');
  });

  it('round-trips the seedlings mode too', () => {
    storeCalendarMode('k2', 'seedlings');
    expect(getStoredCalendarMode('k2')).toBe('seedlings');
  });

  it('stores a timeline view mode verbatim', () => {
    storeTimelineViewMode('k3', ViewMode.WEEK);
    expect(isTimelineViewMode(window.localStorage.getItem('k3'))).toBe(true);
    expect(window.localStorage.getItem('k3')).toBe(ViewMode.WEEK);
  });
});

describe('getDatePosition', () => {
  it('centres a day within its own column rather than at its left edge', () => {
    // Day columns are narrow enough that a marker on the boundary reads as
    // belonging to the previous day.
    expect(getDatePosition(new Date(2026, 0, 1), ViewMode.DAY, SEASON_START)).toBe(25);
    expect(getDatePosition(new Date(2026, 0, 3), ViewMode.DAY, SEASON_START)).toBe(125);
  });

  it('places a week proportionally, without centring', () => {
    expect(getDatePosition(new Date(2026, 0, 8), ViewMode.WEEK, SEASON_START)).toBe(80);
    // A date part-way through the week lands part-way across the column.
    expect(getDatePosition(new Date(2026, 0, 4), ViewMode.WEEK, SEASON_START))
      .toBeCloseTo((80 * 3) / 7, 5);
  });

  it('never places a week before the season start, even for an earlier date', () => {
    // The week branch floors the day count at zero; a bar starting before the
    // season would otherwise be drawn at a negative offset.
    expect(getDatePosition(new Date(2025, 11, 1), ViewMode.WEEK, SEASON_START)).toBe(0);
  });

  it('does floor a day before the season start into negative territory', () => {
    // Unlike the week branch, the day branch has no clamp. Recorded as the
    // current behaviour, not endorsed: the two branches disagree.
    expect(getDatePosition(new Date(2025, 11, 31), ViewMode.DAY, SEASON_START)).toBe(-25);
  });

  it('spreads a month across its own length, so the same day-of-month differs', () => {
    // 15 March of 31 days versus 15 February of 28 — the fraction is computed
    // against the month's real length, not a fixed 30.
    const march = getDatePosition(new Date(2026, 2, 15), ViewMode.MONTH, SEASON_START);
    const february = getDatePosition(new Date(2026, 1, 15), ViewMode.MONTH, SEASON_START);
    expect(march).toBeCloseTo((2 + 14 / 31) * 150, 5);
    expect(february).toBeCloseTo((1 + 14 / 28) * 150, 5);
    expect(march - february).not.toBeCloseTo(150, 5);
  });

  it('positions a quarter by its index plus the month inside it', () => {
    expect(getDatePosition(new Date(2026, 0, 1), ViewMode.QUARTER, SEASON_START)).toBe(0);
    expect(getDatePosition(new Date(2026, 4, 1), ViewMode.QUARTER, SEASON_START))
      .toBeCloseTo((1 + 1 / 3) * 180, 5);
  });

  it('positions a year by the year plus the month fraction', () => {
    expect(getDatePosition(new Date(2027, 6, 1), ViewMode.YEAR, SEASON_START))
      .toBeCloseTo((1 + 6 / 12) * 200, 5);
  });

  it('returns zero for a mode it does not handle', () => {
    expect(getDatePosition(new Date(2026, 5, 1), ViewMode.HOUR, SEASON_START)).toBe(0);
  });

  it('ignores the time of day on the season start', () => {
    // The start is normalised to midnight, so a start recorded mid-afternoon
    // must not shift every bar by a fraction of a day.
    const afternoonStart = new Date(2026, 0, 1, 15, 30);
    expect(getDatePosition(new Date(2026, 0, 3), ViewMode.DAY, afternoonStart))
      .toBe(getDatePosition(new Date(2026, 0, 3), ViewMode.DAY, SEASON_START));
  });
});

describe('getReferenceDateFromScroll', () => {
  const at = (scrollLeft: number, mode: ViewMode, containerWidth = 1000, leftColumn = 200) =>
    getReferenceDateFromScroll(scrollLeft, containerWidth, mode, SEASON_START, SEASON_END, leftColumn);

  it('reads the centre of the timeline viewport, not its left edge', () => {
    // Viewport is 1000-200=800 wide, so an unscrolled view centres 400px in —
    // eight day-columns.
    expect(at(0, ViewMode.DAY).getDate()).toBe(9);
  });

  it('excludes the left column from the viewport width', () => {
    // A wider sidebar leaves less timeline, so the centre lands earlier.
    expect(at(0, ViewMode.DAY, 1000, 600).getDate()).toBe(5);
  });

  it('advances by whole weeks', () => {
    const date = at(80 * 4 - 400, ViewMode.WEEK);
    expect(date.getDate()).toBe(29);
    expect(date.getMonth()).toBe(0);
  });

  it('snaps to the first of the month', () => {
    const date = at(150 * 3 - 400, ViewMode.MONTH);
    expect(date.getDate()).toBe(1);
    expect(date.getMonth()).toBe(3);
  });

  it('steps three months at a time in quarter mode', () => {
    const date = at(180 * 2 - 400, ViewMode.QUARTER);
    expect(date.getMonth()).toBe(6);
    expect(date.getDate()).toBe(1);
  });

  it('snaps to 1 January in year mode', () => {
    const date = getReferenceDateFromScroll(
      200 * 1 - 400, 1000, ViewMode.YEAR, SEASON_START, new Date(2030, 11, 31), 200,
    );
    expect(date.getFullYear()).toBe(2027);
    expect(date.getMonth()).toBe(0);
    expect(date.getDate()).toBe(1);
  });

  it('clamps a scroll past the season end back into the season', () => {
    expect(at(100_000, ViewMode.DAY).getTime()).toBe(SEASON_END.getTime());
  });

  it('never lets the sidebar make the viewport negative', () => {
    // A sidebar wider than the container gives a negative timeline width. Half
    // of it must not be *subtracted* from the scroll position, which is what an
    // unfloored width would do — the centre would resolve to an earlier date
    // the further right the user has scrolled.
    expect(at(1000, ViewMode.DAY, 100, 600).getDate()).toBe(21);
    expect(at(0, ViewMode.DAY, 100, 600).getTime()).toBe(SEASON_START.getTime());
  });

  it('the floor on the centre position is redundant against the clamp', () => {
    // `Math.max(0, ...)` on the centre cannot change the result: a negative
    // centre always resolves to a date at or before the season start, which
    // clampDate then pulls back to the start anyway. Removing it leaves every
    // test in this file green. Asserted as the equivalence it is rather than
    // dressed up as a behaviour the floor provides.
    expect(at(-10_000, ViewMode.DAY).getTime()).toBe(SEASON_START.getTime());
    expect(at(-10_000, ViewMode.MONTH).getTime()).toBe(SEASON_START.getTime());
    expect(at(-10_000, ViewMode.YEAR).getTime()).toBe(SEASON_START.getTime());
  });

  describe('with a season that does not start on the first of a month', () => {
    // SEASON_START is 1 January, which hides day-snapping entirely: setMonth
    // with and without an explicit day argument both land on the 1st.
    const MID_MONTH_START = new Date(2026, 2, 15);
    const LATE_END = new Date(2030, 11, 31);
    const from = (scrollLeft: number, mode: ViewMode) => getReferenceDateFromScroll(
      scrollLeft, 1000, mode, MID_MONTH_START, LATE_END, 200,
    );

    it('snaps to the first of the month, not the season start day', () => {
      const date = from(0, ViewMode.MONTH);
      expect(date.getMonth()).toBe(4);
      expect(date.getDate()).toBe(1);
    });

    it('snaps to 1 January, not to the season start day and month', () => {
      const date = from(0, ViewMode.YEAR);
      expect(date.getFullYear()).toBe(2028);
      expect(date.getMonth()).toBe(0);
      expect(date.getDate()).toBe(1);
    });
  });

  it('returns the season start for a mode it does not handle', () => {
    expect(at(5000, ViewMode.HOUR).getTime()).toBe(SEASON_START.getTime());
  });
});

describe('getTimelineScrollLeftForDate', () => {
  const container = (clientWidth: number, scrollWidth: number) => ({
    clientWidth, scrollWidth,
  } as HTMLElement);

  it('centres the date in the timeline viewport', () => {
    // 3 January sits at 125px; a 800px viewport centres it at 125-400, floored
    // to 0 — so pick a later date where the centring is visible.
    const scroll = getTimelineScrollLeftForDate(
      new Date(2026, 1, 1), ViewMode.DAY, SEASON_START, container(1000, 20_000), 200,
    );
    expect(scroll).toBe(31 * 50 + 25 - 400);
  });

  it('never scrolls to a negative position for an early date', () => {
    expect(getTimelineScrollLeftForDate(
      new Date(2026, 0, 1), ViewMode.DAY, SEASON_START, container(1000, 20_000), 200,
    )).toBe(0);
  });

  it('stops at the last scrollable pixel rather than past the end', () => {
    expect(getTimelineScrollLeftForDate(
      new Date(2026, 11, 31), ViewMode.DAY, SEASON_START, container(1000, 1500), 200,
    )).toBe(500);
  });

  it('cannot scroll at all when the content fits', () => {
    expect(getTimelineScrollLeftForDate(
      new Date(2026, 11, 31), ViewMode.DAY, SEASON_START, container(1000, 800), 200,
    )).toBe(0);
  });
});

describe('addTimelinePeriod', () => {
  it.each([
    [ViewMode.DAY, new Date(2026, 0, 10), new Date(2026, 0, 11)],
    [ViewMode.WEEK, new Date(2026, 0, 10), new Date(2026, 0, 17)],
    [ViewMode.MONTH, new Date(2026, 0, 10), new Date(2026, 1, 10)],
    [ViewMode.QUARTER, new Date(2026, 0, 10), new Date(2026, 3, 10)],
    [ViewMode.YEAR, new Date(2026, 0, 10), new Date(2027, 0, 10)],
  ])('steps forward one %s', (mode, from, expected) => {
    expect(addTimelinePeriod(from, mode, 1).getTime()).toBe(expected.getTime());
  });

  it('steps backwards by the same period', () => {
    expect(addTimelinePeriod(new Date(2026, 3, 10), ViewMode.QUARTER, -1).getTime())
      .toBe(new Date(2026, 0, 10).getTime());
  });

  it('leaves the original date untouched', () => {
    const original = new Date(2026, 0, 10);
    addTimelinePeriod(original, ViewMode.YEAR, 1);
    expect(original.getTime()).toBe(new Date(2026, 0, 10).getTime());
  });

  it('returns the same instant for a mode it does not handle', () => {
    const from = new Date(2026, 0, 10);
    expect(addTimelinePeriod(from, ViewMode.HOUR, 1).getTime()).toBe(from.getTime());
  });
});

describe('addTimelinePeriodLarge', () => {
  it.each([
    [ViewMode.DAY, new Date(2026, 0, 10), new Date(2026, 0, 17)],
    [ViewMode.WEEK, new Date(2026, 0, 10), new Date(2026, 1, 10)],
    [ViewMode.MONTH, new Date(2026, 0, 10), new Date(2027, 0, 10)],
    [ViewMode.QUARTER, new Date(2026, 0, 10), new Date(2027, 0, 10)],
    [ViewMode.YEAR, new Date(2026, 0, 10), new Date(2031, 0, 10)],
  ])('takes a larger step than the plain one in %s mode', (mode, from, expected) => {
    expect(addTimelinePeriodLarge(from, mode, 1).getTime()).toBe(expected.getTime());
    expect(addTimelinePeriodLarge(from, mode, 1).getTime())
      .not.toBe(addTimelinePeriod(from, mode, 1).getTime());
  });

  it('steps backwards by the same larger period', () => {
    expect(addTimelinePeriodLarge(new Date(2031, 0, 10), ViewMode.YEAR, -1).getTime())
      .toBe(new Date(2026, 0, 10).getTime());
  });

  it('returns the same instant for a mode it does not handle', () => {
    const from = new Date(2026, 0, 10);
    expect(addTimelinePeriodLarge(from, ViewMode.HOUR, 1).getTime()).toBe(from.getTime());
  });
});

describe('touch helpers', () => {
  const touch = (overrides: Partial<Touch> = {}) => ({
    clientX: 10, clientY: 20, screenX: 30, screenY: 40, identifier: 0, ...overrides,
  } as Touch);

  it('prefers an active touch over a finished one', () => {
    const event = {
      touches: [touch({ clientX: 1 })],
      changedTouches: [touch({ clientX: 2 })],
    } as unknown as TouchEvent;
    expect(getPrimaryTouch(event)?.clientX).toBe(1);
  });

  it('falls back to a changed touch, which is all a touchend has', () => {
    const event = {
      touches: [],
      changedTouches: [touch({ clientX: 2 })],
    } as unknown as TouchEvent;
    expect(getPrimaryTouch(event)?.clientX).toBe(2);
  });

  it('reports no touch rather than undefined when there is none', () => {
    const event = { touches: [], changedTouches: [] } as unknown as TouchEvent;
    expect(getPrimaryTouch(event)).toBeNull();
  });

  it('carries both client and screen coordinates across', () => {
    // The Gantt library reads screenX/screenY during a drag; dropping them
    // would make a touch drag jump.
    expect(toSyntheticMousePoint(touch())).toEqual({
      clientX: 10, clientY: 20, screenX: 30, screenY: 40,
    });
  });
});

describe('dispatchSyntheticMouseEvent', () => {
  const point = { clientX: 10, clientY: 20, screenX: 30, screenY: 40 };

  it('dispatches a bubbling, cancelable event carrying the coordinates', () => {
    const target = document.createElement('div');
    const seen: MouseEvent[] = [];
    document.body.appendChild(target);
    document.body.addEventListener('mousemove', (event) => seen.push(event as MouseEvent));

    dispatchSyntheticMouseEvent(target, 'mousemove', point);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ clientX: 10, clientY: 20, screenX: 30, screenY: 40 });
    expect(seen[0].cancelable).toBe(true);
    document.body.removeChild(target);
  });

  it('reports the button as held down for everything but mouseup', () => {
    // A drag handler that checks `buttons` would end the drag immediately if
    // mousemove claimed no button was pressed.
    const target = document.createElement('div');
    const seen: Record<string, number> = {};
    (['mousedown', 'mousemove', 'mouseup'] as const).forEach((type) => {
      target.addEventListener(type, (event) => {
        seen[type] = (event as MouseEvent).buttons;
      });
      dispatchSyntheticMouseEvent(target, type, point);
    });

    expect(seen).toEqual({ mousedown: 1, mousemove: 1, mouseup: 0 });
  });
});
