import type { i18n as I18nInstance } from 'i18next';
import type { Season } from '../api/types';
import { toIsoDateString } from '../components/data-grid/dateEditCellUtils';
import { resolveLocaleFromLanguage } from '../utils/numberLocalization';

/** Formatting locale of the resolved UI language. */
export function resolveSeasonDateLocale(i18nInstance: I18nInstance): string {
  return resolveLocaleFromLanguage(i18nInstance.resolvedLanguage);
}

const dateFormatters = new Map<string | undefined, Intl.DateTimeFormat>();
const compactDateFormatters = new Map<string | undefined, Intl.DateTimeFormat>();

export function formatCalendarDate(date: Date, locale?: string, compact = false): string {
  if (Number.isNaN(date.getTime())) return date.toLocaleDateString(locale);
  const cache = compact ? compactDateFormatters : dateFormatters;
  let formatter = cache.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, compact ? { day: '2-digit', month: '2-digit', year: '2-digit' } : undefined);
    cache.set(locale, formatter);
  }
  return formatter.format(date);
}

export function formatSeasonDate(isoDate: string, locale: string, compact = false): string {
  return formatCalendarDate(new Date(`${isoDate}T00:00:00`), locale, compact);
}

export function formatSeasonPeriod(startDate: string, endDate: string, locale: string): string {
  return `${formatSeasonDate(startDate, locale)} – ${formatSeasonDate(endDate, locale)}`;
}

export function initialSeasonRecordDate(season: Season | null | undefined, planned?: string | null): string {
  const today = toIsoDateString(new Date())!;
  if (!season || (season.start_date <= today && today <= season.end_date)) return today;
  if (planned && season.start_date <= planned && planned <= season.end_date) return planned;
  return today < season.start_date ? season.start_date : season.end_date;
}

/** Mirrors `Season.computed_label` on the backend (see `farm/models/seasons.py`):
 * a four-digit year when start and end are in the same calendar year (including
 * a partial-year transition season), otherwise a "YY/YY" span. */
export function computeSeasonLabel(startDate: string, endDate: string): string {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (start.getFullYear() === end.getFullYear()) {
    return String(start.getFullYear());
  }
  const startYear = String(start.getFullYear() % 100).padStart(2, '0');
  const endYear = String(end.getFullYear() % 100).padStart(2, '0');
  return `${startYear}/${endYear}`;
}
