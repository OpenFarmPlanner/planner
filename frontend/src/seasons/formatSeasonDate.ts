import type { i18n as I18nInstance } from 'i18next';
import { resolveLocaleFromLanguage } from '../utils/numberLocalization';

/** Formatting locale of the resolved UI language (`de-DE`, `en-US`, `fr-FR`, `es-ES`). */
export function resolveSeasonDateLocale(i18nInstance: I18nInstance): string {
  return resolveLocaleFromLanguage(i18nInstance.resolvedLanguage);
}

export function formatSeasonDate(isoDate: string, locale: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString(locale);
}

export function formatSeasonPeriod(startDate: string, endDate: string, locale: string): string {
  return `${formatSeasonDate(startDate, locale)} – ${formatSeasonDate(endDate, locale)}`;
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
