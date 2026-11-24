import { MONTH_DAY_REFERENCE_YEAR, parseMonthDay } from '../utils/monthDay';

// Invalid text stays in the date field. Mark its endpoint in the form draft so
// the existing validation, dirty tracking and save paths all see the edit.
export const INVALID_HARVEST_DATE_DRAFT = '?';

export function splitAnnualHarvestWindow(value: string): [start: string, end: string] {
  const separator = value.indexOf('/');
  return separator < 0 ? [value, ''] : [value.slice(0, separator), value.slice(separator + 1)];
}

export function formatAnnualHarvestWindow(value: string, locale: string): string {
  const [start, end] = splitAnnualHarvestWindow(value);
  const startDate = parseMonthDay(start);
  const endDate = parseMonthDay(end);
  if (!startDate || !endDate) return value;
  const formatter = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const format = ([month, day]: [number, number]) => formatter.format(Date.UTC(MONTH_DAY_REFERENCE_YEAR, month - 1, day));
  return `${format(startDate)} – ${format(endDate)}`;
}
