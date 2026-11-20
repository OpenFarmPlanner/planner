export const parseGermanDateText = (text: string): Date | null => {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const [, day, month, year] = match.map(Number);
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
};

export const formatDateAsGerman = (value: Date | string | null | undefined): string => {
  const d = toGridDateValue(value);
  if (!d) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}.${d.getFullYear()}`;
};

export const toIsoDateString = (value: unknown): string | null => {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return null;
};

/**
 * Coerces anything a row can hold for a `type: 'date'` column into the `Date`
 * object MUI requires. Row state keeps dates as ISO strings (that is what the
 * API returns and what `mapToRow` stores), so every value entering the grid —
 * cell values via `valueGetter` and edit-state values alike — has to pass
 * through here. Unparseable input becomes `null` instead of an `Invalid Date`,
 * so a bad value renders as an empty cell rather than throwing.
 */
export const toGridDateValue = (value: unknown): Date | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const localDate = new Date(`${value}T00:00:00`);
      return Number.isNaN(localDate.getTime()) ? null : localDate;
    }
    const germanDate = parseGermanDateText(value);
    if (germanDate) {
      return germanDate;
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};
