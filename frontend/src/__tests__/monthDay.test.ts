import { describe, expect, it } from 'vitest';
import { createMonthDayFormat } from '../utils/monthDay';

describe('yearless date formatting and input', () => {
  it.each([
    ['de-DE', '01.04.'], ['en-US', '04/01'], ['fr-FR', '01/04'], ['es-ES', '1/4'],
    ['it-IT', '01/04'], ['pt-PT', '01/04'], ['nl-NL', '01-04'],
  ])('round trips a date in %s', (locale, text) => {
    const format = createMonthDayFormat(locale);
    expect(format.example).toBe(text);
    expect(format.format(4, 1)).toBe(text);
    expect(format.parse(text)).toBe('04-01');
  });

  it('accepts single-digit typing, optional final punctuation and a leap day', () => {
    const format = createMonthDayFormat('de-DE');
    expect(format.parse('1.4')).toBe('04-01');
    expect(format.parse('29.2.')).toBe('02-29');
    expect(format.parse('31.04.')).toBeNull();
    expect(format.parse('01.04.2028')).toBeNull();
    expect(format.parse('29.')).toBeNull();
    expect(format.parse('')).toBe('');
  });
});
