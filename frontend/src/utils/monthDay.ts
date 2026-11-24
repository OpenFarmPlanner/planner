// A leap year lets a recurring date represent February 29 without storing a year.
export const MONTH_DAY_REFERENCE_YEAR = 2000;

export function daysInMonth(month: number): number {
  return new Date(Date.UTC(MONTH_DAY_REFERENCE_YEAR, month, 0)).getUTCDate();
}

export function parseMonthDay(value: string): [month: number, day: number] | null {
  if (value.length !== 5 || !/^[0-9]{2}-[0-9]{2}$/.test(value)) return null;
  const [month, day] = value.split('-').map(Number);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(month) ? [month, day] : null;
}

export function toMonthDay(month: number, day: number): string {
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function createMonthDayFormat(locale: string) {
  const format = new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit', timeZone: 'UTC' });
  const parts = format.formatToParts(Date.UTC(MONTH_DAY_REFERENCE_YEAR, 3, 1));
  const pattern = new RegExp(`^${parts.map((part, index) => {
    if (part.type === 'day' || part.type === 'month') return `(?<${part.type}>[0-9]{1,2})`;
    const literal = part.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return index === parts.length - 1 ? `(?:${literal})?` : literal;
  }).join('')}$`);

  return {
    example: parts.map(part => part.value).join(''),
    format: (month: number, day: number) => format.format(Date.UTC(MONTH_DAY_REFERENCE_YEAR, month - 1, day)),
    parse: (text: string): string | null => {
      if (!text.trim()) return '';
      const match = pattern.exec(text.trim());
      if (!match?.groups) return null;
      const value = toMonthDay(Number(match.groups.month), Number(match.groups.day));
      return parseMonthDay(value) ? value : null;
    },
  };
}
