/**
 * Timing windows of a crop (Anzucht, Direktsaat, Pflanzung, Ernte): display
 * text and resolution to real dates for the crop form, the detail view's year
 * bar and the planting-plan hints. The backend's
 * `farm/services/timing_windows.py` is the source of truth (import, planning
 * check, sowing-month filter); `tests/fixtures/timing_windows.json` pins both
 * sides to the same results. Rules: docs/timing-windows.md.
 */
import type {
  Crop,
  CropTimingWindow,
  TimingWindowDecade,
  TimingWindowKind,
  TimingWindowUnit,
} from '../api/types';

export const TIMING_WINDOW_KINDS: readonly TimingWindowKind[] = [
  'pre_cultivation',
  'direct_sowing',
  'planting',
  'harvest',
];

export const TIMING_WINDOW_DECADES: readonly TimingWindowDecade[] = ['early', 'mid', 'late'];

export const MAX_ISO_WEEK = 52;

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;

const DECADE_FIRST_DAY: Record<TimingWindowDecade, number> = { early: 1, mid: 11, late: 21 };
const DECADE_INDEX: Record<TimingWindowDecade, number> = { early: 1, mid: 2, late: 3 };

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** An inclusive date range as ISO `YYYY-MM-DD` strings. */
export type IsoDateRange = [string, string];

export function emptyTimingWindow(kind: TimingWindowKind, unit: TimingWindowUnit): CropTimingWindow {
  return {
    kind,
    unit,
    start_month: null,
    start_decade: null,
    end_month: null,
    end_decade: null,
    start_week: null,
    end_week: null,
  };
}

/** Whether every field of the window's own unit is set (the form refuses to save otherwise). */
export function isTimingWindowComplete(window: CropTimingWindow): boolean {
  if (window.unit === 'iso_week') {
    return window.start_week !== null && window.end_week !== null;
  }
  return window.start_month !== null && window.start_decade !== null
    && window.end_month !== null && window.end_decade !== null;
}

/** Whether the start lies after the end, i.e. the window spans New Year. Incomplete windows never do. */
export function wrapsYearEnd(window: CropTimingWindow): boolean {
  if (!isTimingWindowComplete(window)) {
    return false;
  }
  if (window.unit === 'iso_week') {
    return (window.start_week as number) > (window.end_week as number);
  }
  const start = (window.start_month as number) * 10 + DECADE_INDEX[window.start_decade as TimingWindowDecade];
  const end = (window.end_month as number) * 10 + DECADE_INDEX[window.end_decade as TimingWindowDecade];
  return start > end;
}

// ---------------------------------------------------------------------------
// Resolution (UTC dates, so no time-zone shift changes a day)
// ---------------------------------------------------------------------------

const utcDate = (year: number, month: number, day: number): Date => new Date(Date.UTC(year, month - 1, day));

const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

const toIso = (date: Date): string => date.toISOString().slice(0, 10);

/** Monday of ISO week `week` of ISO year `year` (4 January always lies in week 1). */
function isoWeekMonday(year: number, week: number): Date {
  const januaryFourth = utcDate(year, 1, 4);
  const weekday = januaryFourth.getUTCDay() || 7;
  return utcDate(year, 1, 4 - weekday + 1 + (week - 1) * 7);
}

function startIn(window: CropTimingWindow, year: number): Date {
  if (window.unit === 'iso_week') {
    return isoWeekMonday(year, window.start_week as number);
  }
  return utcDate(year, window.start_month as number, DECADE_FIRST_DAY[window.start_decade as TimingWindowDecade]);
}

function endIn(window: CropTimingWindow, year: number): Date {
  if (window.unit === 'iso_week') {
    const monday = isoWeekMonday(year, window.end_week as number);
    return utcDate(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate() + 6);
  }
  const month = window.end_month as number;
  const decade = window.end_decade as TimingWindowDecade;
  const lastDay = decade === 'early' ? 10 : decade === 'mid' ? 20 : daysInMonth(year, month);
  return utcDate(year, month, lastDay);
}

/**
 * The date ranges the window stands for when checking a date in `year`: one
 * range, or two for a window across the year end (start in `year - 1` to end
 * in `year`, and start in `year` to end in `year + 1`). Empty when incomplete.
 */
export function resolveTimingWindow(window: CropTimingWindow, year: number): IsoDateRange[] {
  if (!isTimingWindowComplete(window)) {
    return [];
  }
  if (wrapsYearEnd(window)) {
    return [
      [toIso(startIn(window, year - 1)), toIso(endIn(window, year))],
      [toIso(startIn(window, year)), toIso(endIn(window, year + 1))],
    ];
  }
  return [[toIso(startIn(window, year)), toIso(endIn(window, year))]];
}

/** Whether the ISO date lies in the window, resolved in that date's year. */
export function timingWindowContains(window: CropTimingWindow, isoDate: string): boolean {
  const year = Number(isoDate.slice(0, 4));
  return resolveTimingWindow(window, year).some(([start, end]) => start <= isoDate && isoDate <= end);
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** Whether the window, resolved in `year`, shares a day with `month` (1-12) of `year`. */
export function timingWindowOverlapsMonth(window: CropTimingWindow, year: number, month: number): boolean {
  const monthStart = `${year}-${pad(month)}-01`;
  const monthEnd = `${year}-${pad(month)}-${pad(daysInMonth(year, month))}`;
  return resolveTimingWindow(window, year).some(([start, end]) => start <= monthEnd && end >= monthStart);
}

/** The months (1-12) of `year` any of the windows overlaps, ascending. */
export function monthsCoveredByTimingWindows(windows: readonly CropTimingWindow[], year: number): number[] {
  return Array.from({ length: 12 }, (_, index) => index + 1)
    .filter((month) => windows.some((window) => timingWindowOverlapsMonth(window, year, month)));
}

/**
 * The parts of the windows that fall into calendar year `year`, as fractions
 * of the year (0 = 1 January, 1 = end of 31 December), for the detail view's
 * year bar. A window across the year end yields its January and its December part.
 */
export function timingWindowYearSegments(
  windows: readonly CropTimingWindow[],
  year: number,
): Array<{ start: number; end: number }> {
  const yearStart = Date.UTC(year, 0, 1);
  const yearLength = Date.UTC(year + 1, 0, 1) - yearStart;
  const dayLength = 24 * 60 * 60 * 1000;
  const firstDay = `${year}-01-01`;
  const lastDay = `${year}-12-31`;
  const segments: Array<{ start: number; end: number }> = [];
  for (const window of windows) {
    for (const [start, end] of resolveTimingWindow(window, year)) {
      if (end < firstDay || start > lastDay) {
        continue;
      }
      const clippedStart = Date.parse(start < firstDay ? firstDay : start);
      const clippedEnd = Date.parse(end > lastDay ? lastDay : end) + dayLength;
      segments.push({
        start: (clippedStart - yearStart) / yearLength,
        end: (clippedEnd - yearStart) / yearLength,
      });
    }
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Canonical text
// ---------------------------------------------------------------------------

const monthName = (month: number, t: Translate): string => t(`common:months.${MONTH_KEYS[month - 1]}`);

/**
 * The canonical text of one window, e.g. "Anfang März bis Mitte Mai", "März",
 * "KW 10 bis 14". The same text the spreadsheet export writes and the import
 * reads back. Pass a translator that resolves `common:` and `crops:` keys.
 */
export function formatTimingWindow(window: CropTimingWindow, t: Translate): string {
  if (!isTimingWindowComplete(window)) {
    return '';
  }
  if (window.unit === 'iso_week') {
    if (window.start_week === window.end_week) {
      return t('crops:timingWindows.text.week', { week: window.start_week });
    }
    return t('crops:timingWindows.text.weekRange', { start: window.start_week, end: window.end_week });
  }
  const startMonth = monthName(window.start_month as number, t);
  const endMonth = monthName(window.end_month as number, t);
  if (window.start_decade === 'early' && window.end_decade === 'late') {
    if (window.start_month === window.end_month) {
      return startMonth;
    }
    return t('crops:timingWindows.text.range', { start: startMonth, end: endMonth });
  }
  const startText = t(`crops:timingWindows.text.decadeMonth.${window.start_decade}`, { month: startMonth });
  if (window.start_month === window.end_month && window.start_decade === window.end_decade) {
    return startText;
  }
  const endText = t(`crops:timingWindows.text.decadeMonth.${window.end_decade}`, { month: endMonth });
  return t('crops:timingWindows.text.range', { start: startText, end: endText });
}

/** Several windows of one kind, joined with "; ". */
export function formatTimingWindows(windows: readonly CropTimingWindow[], t: Translate): string {
  return windows
    .map((window) => formatTimingWindow(window, t))
    .filter((text) => text.length > 0)
    .join('; ');
}

/**
 * The crop list's "Aussaat möglich im Monat" filter: whether an effective
 * Anzucht or Direktsaat window overlaps the month ('1'-'12'; '' matches every
 * crop). The months come from the backend (`sowing_months`), which resolves
 * week windows in the current year.
 */
export function canBeSownInMonth(crop: Pick<Crop, 'sowing_months'>, month: string): boolean {
  if (!month) {
    return true;
  }
  return (crop.sowing_months ?? []).includes(Number(month));
}

export function windowsOfKind<TWindow extends CropTimingWindow>(
  windows: readonly TWindow[] | null | undefined,
  kind: TimingWindowKind,
): TWindow[] {
  return (windows ?? []).filter((window) => window.kind === kind);
}

/** The window fields the API accepts, without read-only extras such as `inherited`. */
export function toTimingWindowPayload(window: CropTimingWindow): CropTimingWindow {
  return {
    kind: window.kind,
    unit: window.unit,
    start_month: window.start_month,
    start_decade: window.start_decade,
    end_month: window.end_month,
    end_decade: window.end_decade,
    start_week: window.start_week,
    end_week: window.end_week,
  };
}
