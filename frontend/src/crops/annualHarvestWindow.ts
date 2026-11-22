const DAYS_IN_LEAP_YEAR_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function parseMonthDay(value: string): [number, number] | null {
  if (value.length !== 5 || !/^[0-9]{2}-[0-9]{2}$/.test(value)) return null;
  const [month, day] = value.split('-').map(Number);
  return day >= 1 && day <= DAYS_IN_LEAP_YEAR_MONTH[month - 1] ? [month, day] : null;
}

export function isValidAnnualHarvestWindow(value: string): boolean {
  const [start = '', end = '', extra] = value.split('/');
  return extra === undefined && parseMonthDay(start) !== null && parseMonthDay(end) !== null;
}

export function formatAnnualHarvestWindow(value: string, locale: string): string {
  const [start = '', end = ''] = value.split('/');
  const startDate = parseMonthDay(start);
  const endDate = parseMonthDay(end);
  if (!startDate || !endDate) return value;
  const formatter = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const format = ([month, day]: [number, number]) => formatter.format(Date.UTC(2000, month - 1, day));
  return `${format(startDate)} – ${format(endDate)}`;
}
