import { describe, expect, it } from 'vitest';

import { widthForHeaderTitles } from '../components/data-grid/columnHeaderWidth';
import i18n from '../i18n/config';

const DATE_OPTIONS = { baseWidth: 142, allowance: 38, maxWidth: 200 } as const;
const DATE_KEYS = ['sowingDate', 'plantingDate', 'harvestStartDate', 'harvestEndDate'] as const;

function dateWidths(language: string): number[] {
  const t = i18n.getFixedT(language, 'plantingPlans');
  return DATE_KEYS.map((key) => widthForHeaderTitles([t(`columns.${key}`)], DATE_OPTIONS));
}

describe('widthForHeaderTitles', () => {
  it('keeps the base width when the title fits', () => {
    expect(widthForHeaderTitles(['Pflanztermin'], DATE_OPTIONS)).toBe(142);
  });

  it('widens for a longer title, up to the maximum', () => {
    expect(widthForHeaderTitles(['Date de plantation'], DATE_OPTIONS)).toBe(182);
    expect(widthForHeaderTitles(['x'.repeat(40)], DATE_OPTIONS)).toBe(200);
  });

  it('uses the longest of several titles', () => {
    expect(widthForHeaderTitles(['Longitud (m)', 'Anchura (m)'], { baseWidth: 130, allowance: 50, maxWidth: 170 }))
      .toBe(146);
  });

  it.each(['de', 'en'])('leaves every planting-plan date column at its base width in %s', (language) => {
    expect(dateWidths(language)).toEqual([142, 142, 142, 142]);
  });

  it.each(['fr', 'es'])('widens the planting-plan date columns whose %s title needs it', (language) => {
    const widths = dateWidths(language);
    expect(Math.max(...widths)).toBeGreaterThan(142);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(142);
  });
});
