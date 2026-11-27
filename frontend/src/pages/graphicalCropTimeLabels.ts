import type { TFunction } from 'i18next';
import { formatSeasonDate } from '../seasons/formatSeasonDate';
import type { BedCultivationPlan, CropReference } from './graphicalCultivation';

const monthFormatters = new Map<string, Intl.DateTimeFormat>();

export function formatCropTimelineMonths(dates: readonly string[], locale: string): string[] {
  let formatter = monthFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' });
    monthFormatters.set(locale, formatter);
  }
  return [...new Set(dates.map(date => formatter.format(new Date(date))))];
}

export function formatCropInterval(start: string, end: string, locale: string, t: TFunction, compact = false): string {
  const first = formatSeasonDate(start, locale, compact);
  return start === end ? first : t('graphical.display.range', {
    start: first, end: formatSeasonDate(end, locale, compact),
  });
}

export function formatCropReference(reference: CropReference, locale: string, t: TFunction, compact = false): string {
  if (reference.kind === 'season') return t('graphical.display.entireSeason');
  if (reference.kind === 'range') return formatCropInterval(reference.start, reference.end, locale, t, compact);
  return formatSeasonDate(reference.date, locale, compact);
}

export function formatCropOccupation(plan: BedCultivationPlan, locale: string, t: TFunction): string | null {
  if (plan.start && plan.end) return formatCropInterval(plan.start, plan.end, locale, t);
  if (plan.start) return t('graphical.display.occupationFrom', { date: formatSeasonDate(plan.start, locale) });
  if (plan.end) return t('graphical.display.occupationUntil', { date: formatSeasonDate(plan.end, locale) });
  return null;
}
