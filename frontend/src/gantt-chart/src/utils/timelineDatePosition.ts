import { add, endOfMonth, endOfQuarter, endOfYear, startOfMonth, startOfQuarter, startOfYear, type Duration } from 'date-fns';
import { addUtcDays } from '../../../utils/isoDate';
import { ViewMode } from '../types/enums';

const durations: Record<Exclude<ViewMode, typeof ViewMode.MINUTE>, Duration> = {
  [ViewMode.HOUR]: { hours: 1 },
  [ViewMode.DAY]: { days: 1 },
  [ViewMode.WEEK]: { weeks: 1 },
  [ViewMode.MONTH]: { months: 1 },
  [ViewMode.QUARTER]: { months: 3 },
  [ViewMode.YEAR]: { years: 1 },
};

const DAY_MS = 86_400_000;

export function toLocalCalendarDate(date: Date): Date {
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Inclusive date-only bounds of the first and last rendered calendar columns. */
export function getCalendarAxisBounds(start: Date, end: Date, mode: ViewMode): { start: Date; end: Date } {
  if (mode === ViewMode.WEEK) {
    // Week columns are anchored to the first calendar date, not an ISO weekday.
    const wholeWeeks = Math.floor((end.getTime() - start.getTime()) / (DAY_MS * 7));
    return { start, end: addUtcDays(start, wholeWeeks * 7 + 6) };
  }

  const columnBounds = {
    [ViewMode.MONTH]: [startOfMonth, endOfMonth],
    [ViewMode.QUARTER]: [startOfQuarter, endOfQuarter],
    [ViewMode.YEAR]: [startOfYear, endOfYear],
  } as const;
  if (mode !== ViewMode.MONTH && mode !== ViewMode.QUARTER && mode !== ViewMode.YEAR) {
    return { start, end };
  }
  const [floor, ceiling] = columnBounds[mode];
  const toUtcDate = (date: Date) => new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  return {
    start: toUtcDate(floor(toLocalCalendarDate(start))),
    end: toUtcDate(ceiling(toLocalCalendarDate(end))),
  };
}

export interface TimelineDateScale {
  positionDate: (date: Date, includeLastDay?: boolean) => number;
  dateAt: (position: number, includeLastDay?: boolean) => Date;
}

/** Map date-only UTC values to the calendar days printed on the rendered columns. */
export function createTimelineDateScale(
  units: readonly Date[], mode: ViewMode, unitWidth: number, minuteStep: number,
): TimelineDateScale | null {
  const last = units.at(-1);
  if (!last || unitWidth <= 0) return null;
  const elapsedTime = mode === ViewMode.MINUTE || mode === ViewMode.HOUR;
  const time = (date: Date): number => elapsedTime ? date.getTime() : Date.UTC(
    date.getFullYear(), date.getMonth(), date.getDate(),
  );
  const next = add(last, mode === ViewMode.MINUTE ? { minutes: minuteStep } : durations[mode]);
  const boundaries = [...units.map(time), time(next)];

  const positionDate = (date: Date, includeLastDay = false): number => {
    const requested = date.getTime() + (!elapsedTime && includeLastDay ? DAY_MS : 0);
    if (requested <= boundaries[0]) return 0;
    if (requested >= boundaries[units.length]) return units.length * unitWidth;
    let first = 0;
    let end = units.length;
    while (end - first > 1) {
      const midpoint = Math.floor((first + end) / 2);
      if (boundaries[midpoint] <= requested) first = midpoint;
      else end = midpoint;
    }
    const fraction = (requested - boundaries[first]) / (boundaries[end] - boundaries[first]);
    return (first + fraction) * unitWidth;
  };
  const dateAt = (position: number, includeLastDay = false): Date => {
    const bounded = Math.max(0, Math.min(position / unitWidth, units.length));
    const first = Math.min(Math.floor(bounded), units.length - 1);
    const time = boundaries[first] + (bounded - first) * (boundaries[first + 1] - boundaries[first]);
    return new Date(elapsedTime ? time : (Math.round(time / DAY_MS) - Number(includeLastDay)) * DAY_MS);
  };
  return { positionDate, dateAt };
}
