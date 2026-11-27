/**
 * Client-side mirror of the season-period math in
 * `backend/farm/services/seasons.py` (`compute_next_pattern_start_after`,
 * `compute_custom_season_period`, `analyze_period_transition`).
 *
 * Used by the "create season" flow to preview an individual transition-season
 * period live as the user picks a start date, without a round-trip per
 * keystroke. The backend stays the source of truth for the periods that are
 * actually persisted; `seasonPeriodMath.test.ts` locks the parity.
 */

import type { SeasonPeriodRange, SeasonPeriodTransition } from '../api/types';

function toIsoDate(value: Date): string {
  const year = String(value.getFullYear()).padStart(4, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseIsoDate(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

function daysInMonth(year: number, month1: number): number {
  return new Date(year, month1, 0).getDate();
}

/** The pattern start day/month in `year`, clamped to the month length. */
function patternStartForYear(year: number, startDay: number, startMonth: number): Date {
  const day = Math.min(startDay, daysInMonth(year, startMonth));
  return new Date(year, startMonth - 1, day);
}

/** Earliest pattern start date strictly after `reference` (ISO date string). */
export function computeNextPatternStartAfter(
  reference: string,
  startDay: number,
  startMonth: number,
): string {
  const referenceDate = parseIsoDate(reference);
  let candidate = patternStartForYear(referenceDate.getFullYear(), startDay, startMonth);
  if (candidate.getTime() <= referenceDate.getTime()) {
    candidate = patternStartForYear(referenceDate.getFullYear() + 1, startDay, startMonth);
  }
  return toIsoDate(candidate);
}

/** End date (inclusive) for an individual season starting on `startDate`. */
export function computeCustomSeasonEnd(
  startDate: string,
  startDay: number,
  startMonth: number,
): string {
  const nextStart = parseIsoDate(computeNextPatternStartAfter(startDate, startDay, startMonth));
  nextStart.setDate(nextStart.getDate() - 1);
  return toIsoDate(nextStart);
}

/**
 * End date (inclusive) for a hand-picked manual start in the gap-decision flow.
 *
 * Mirrors `compute_manual_season_period`: the season runs from `startDate`
 * through the end of the following full pattern period, so it closes the gap
 * and then absorbs the next regular season (start 2026-09-01, pattern Jan 1 ->
 * end 2027-12-31).
 */
export function computeManualSeasonEnd(
  startDate: string,
  startDay: number,
  startMonth: number,
): string {
  const nextStart = parseIsoDate(computeNextPatternStartAfter(startDate, startDay, startMonth));
  const followupYear = nextStart.getFullYear() + 1;
  const month1 = nextStart.getMonth() + 1;
  const day = Math.min(nextStart.getDate(), daysInMonth(followupYear, month1));
  const end = new Date(followupYear, month1 - 1, day);
  end.setDate(end.getDate() - 1);
  return toIsoDate(end);
}

/** Add `days` to an ISO date string. */
export function addDaysIso(isoDate: string, days: number): string {
  const date = parseIsoDate(isoDate);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/** A regular first season lasts through the day before the next anniversary. */
export function computeFirstSeasonPeriod(year: number, month: number): SeasonPeriodRange {
  const firstDay = (startYear: number) => `${String(startYear).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
  return { start_date: firstDay(year), end_date: addDaysIso(firstDay(year + 1), -1) };
}

/**
 * Classify the join between `previousEnd` and `nextStart` (both ISO dates).
 * Returns `null` when seamless.
 */
export function analyzePeriodTransition(
  previousEnd: string,
  nextStart: string,
): SeasonPeriodTransition | null {
  const seam = addDaysIso(previousEnd, 1);
  if (nextStart === seam) {
    return null;
  }
  if (nextStart > seam) {
    return { kind: 'gap', start_date: seam, end_date: addDaysIso(nextStart, -1) };
  }
  return { kind: 'overlap', start_date: nextStart, end_date: previousEnd };
}
