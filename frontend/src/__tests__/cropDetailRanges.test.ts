import { describe, expect, it } from 'vitest';
import i18n from '../i18n';
import { formatCropDetailRange } from '../crops/cropDetailFormatters';
import { getGerminationDetailRows, type GerminationDetailField } from '../crops/germination';

const de = i18n.getFixedT('de', 'crops');

describe('crop detail ranges', () => {
  it.each([
    [20, 30, '20–30 °C'],
    [20, 20, '20 °C'],
    [20, null, 'ab 20 °C'],
    [undefined, 30, 'bis 30 °C'],
    [null, undefined, '—'],
    [0, 0, '0 °C'],
    [-5.5, 0, '-5,5–0 °C'],
  ])('formats %s and %s without inventing endpoints', (lower, upper, expected) => {
    expect(formatCropDetailRange(lower, upper, 'celsius', de, 'de-DE')).toBe(expected);
  });

  it('writes the unit once and uses singular days where applicable', () => {
    expect(formatCropDetailRange(5, 15, 'days', de, 'de-DE')).toBe('5–15 Tage');
    expect(formatCropDetailRange(1, null, 'days', de, 'de-DE')).toBe('ab 1 Tag');
    expect(formatCropDetailRange(0, 1, 'days', de, 'de-DE')).toBe('0–1 Tage');
  });

  it.each([
    ['de', 'ab 0 °C', 'bis 2,5 °C'],
    ['en', 'at least 0 °C', 'up to 2.5 °C'],
    ['es', 'desde 0 °C', 'hasta 2,5 °C'],
    ['fr', 'au moins 0 °C', 'jusqu’à 2,5 °C'],
    ['it', 'da 0 °C', 'fino a 2,5 °C'],
    ['nl', 'vanaf 0 °C', 'tot 2,5 °C'],
    ['pt', 'a partir de 0 °C', 'até 2,5 °C'],
  ])('localizes one-sided ranges in %s', (language, lower, upper) => {
    const t = i18n.getFixedT(language, 'crops');
    expect(formatCropDetailRange(0, null, 'celsius', t, language)).toBe(lower);
    expect(formatCropDetailRange(null, 2.5, 'celsius', t, language)).toBe(upper);
  });

  it('reveals only the applicable ranges in show-all mode', () => {
    const values: Partial<Record<GerminationDetailField, unknown>> = { germination_days_max: 0 };
    const read = (field: GerminationDetailField) => values[field];
    expect(getGerminationDetailRows(read, false).map(({ row }) => row.field)).toEqual(['germination_days_min']);
    expect(getGerminationDetailRows(read, true).map(({ row }) => row.field)).toEqual([
      'germination_temperature_optimal_min_c', 'germination_days_min',
    ]);
    values.germination_temperature_requirement = 'frost_treatment';
    expect(getGerminationDetailRows(read, true).map(({ row }) => row.field)).toEqual([
      'germination_temperature_optimal_min_c', 'germination_days_min', 'germination_temperature_requirement',
      'stratification_days_min', 'stratification_temperature_min_c',
    ]);
  });
});
