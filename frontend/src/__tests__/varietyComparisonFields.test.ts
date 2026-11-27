import { describe, it, expect } from 'vitest';
import { getComparisonCellValue, getVaryingComparisonFields } from '../crops/varietyComparisonFields';
import type { Crop } from '../api/types';

const t = (key: string): string => key;
const cropCrop: Crop = { id: 99, name: 'Carrot', variety: '' };

describe('getVaryingComparisonFields', () => {
  it('returns no columns for fewer than two varieties', () => {
    const single: Crop = { id: 1, name: 'Carrot', variety: 'Nantes', row_spacing_cm: 30 };
    expect(getVaryingComparisonFields([single], cropCrop)).toEqual([]);
    expect(getVaryingComparisonFields([], cropCrop)).toEqual([]);
  });

  it('excludes a field when every variety agrees, including when all are empty', () => {
    const nantes: Crop = { id: 1, name: 'Carrot', variety: 'Nantes', row_spacing_cm: 30 };
    const bolero: Crop = { id: 2, name: 'Carrot', variety: 'Bolero', row_spacing_cm: 30 };
    const rodelika: Crop = { id: 3, name: 'Carrot', variety: 'Rodelika' };

    const fieldIds = getVaryingComparisonFields([nantes, bolero], cropCrop).map((field) => field.id);
    expect(fieldIds).not.toContain('rowSpacing');
    expect(getVaryingComparisonFields([nantes, rodelika], cropCrop).map((field) => field.id)).not.toContain('growthDurationDays');
  });

  it('excludes a field when varieties disagree on their own value but resolve to the same inherited crop value', () => {
    const cropWithSpacing: Crop = { ...cropCrop, row_spacing_cm: 30 };
    // Costata has an explicit own value equal to the crop's; the other
    // variety has no own value and therefore inherits the same crop value —
    // effectively identical, so the column should not appear.
    const costata: Crop = { id: 1, name: 'Zucchini', variety: 'Costata Romanesco', row_spacing_cm: 30 };
    const test: Crop = { id: 2, name: 'Zucchini', variety: 'test' };

    const fieldIds = getVaryingComparisonFields([costata, test], cropWithSpacing).map((field) => field.id);
    expect(fieldIds).not.toContain('rowSpacing');
  });

  it('includes a field when at least two varieties disagree, even if others are empty', () => {
    const nantes: Crop = { id: 1, name: 'Carrot', variety: 'Nantes', row_spacing_cm: 30 };
    const bolero: Crop = { id: 2, name: 'Carrot', variety: 'Bolero', row_spacing_cm: 40 };
    const rodelika: Crop = { id: 3, name: 'Carrot', variety: 'Rodelika' };

    const fieldIds = getVaryingComparisonFields([nantes, bolero, rodelika], cropCrop).map((field) => field.id);
    expect(fieldIds).toContain('rowSpacing');
  });

  it('includes a field when one variety has an explicit value equal to the crop, but the other overrides it', () => {
    const cropWithSpacing: Crop = { ...cropCrop, row_spacing_cm: 30 };
    const costata: Crop = { id: 1, name: 'Zucchini', variety: 'Costata Romanesco', row_spacing_cm: 30 };
    const test: Crop = { id: 2, name: 'Zucchini', variety: 'test', row_spacing_cm: 40 };

    const fieldIds = getVaryingComparisonFields([costata, test], cropWithSpacing).map((field) => field.id);
    expect(fieldIds).toContain('rowSpacing');
  });

  it('diffs array-valued fields (cultivation types) structurally', () => {
    const nantes: Crop = { id: 1, name: 'Carrot', variety: 'Nantes', cultivation_types: ['pre_cultivation'] };
    const bolero: Crop = { id: 2, name: 'Carrot', variety: 'Bolero', cultivation_types: ['direct_sowing'] };

    expect(getVaryingComparisonFields([nantes, bolero], cropCrop).map((field) => field.id)).toContain('cultivationType');
  });

});

describe('seedSafetyMargin (cultivation-type-dependent field)', () => {
  // Regression: Costata Romanesco has its own pre-cultivation-specific
  // safety value equal to the crop's; "test" has no own safety value at all
  // and inherits the crop's pre-cultivation value too — both are effectively
  // 20%, so the column must not appear, and neither cell may fall back to
  // the (irrelevant, still-empty/zero) general safety field.
  const cropWithPreCultivationSafety: Crop = {
    ...cropCrop,
    cultivation_types: ['pre_cultivation'],
    sowing_calculation_safety_percent_pre_cultivation: 20,
  };
  const costata: Crop = {
    id: 1,
    name: 'Zucchini',
    variety: 'Costata Romanesco',
    cultivation_types: ['pre_cultivation'],
    sowing_calculation_safety_percent_pre_cultivation: 20,
  };
  const testVariety: Crop = { id: 2, name: 'Zucchini', variety: 'test' };

  it('does not show a column when both varieties resolve to the same cultivation-type-specific value', () => {
    const fieldIds = getVaryingComparisonFields([costata, testVariety], cropWithPreCultivationSafety).map((field) => field.id);
    expect(fieldIds).not.toContain('seedSafetyMargin');
  });

  it('renders the cultivation-type-specific value for a variety with its own override', () => {
    const varyingCrop: Crop = { ...cropWithPreCultivationSafety, sowing_calculation_safety_percent_pre_cultivation: 15 };
    const [field] = getVaryingComparisonFields([costata, testVariety], varyingCrop);
    expect(getComparisonCellValue(costata, varyingCrop, field, t, 'de-DE')).toBe('20 detail.units.percent');
  });

  it('falls back to the crop\'s cultivation-type-specific value, not the unrelated general field, for a variety with no own value', () => {
    const varyingCrop: Crop = { ...cropWithPreCultivationSafety, sowing_calculation_safety_percent_pre_cultivation: 15 };
    const [field] = getVaryingComparisonFields([costata, testVariety], varyingCrop);
    expect(getComparisonCellValue(testVariety, varyingCrop, field, t, 'de-DE')).toBe('15 detail.units.percent');
  });

  it('uses the direct-sowing-specific value when that is the effective cultivation type', () => {
    const directCrop: Crop = {
      ...cropCrop,
      cultivation_types: ['direct_sowing'],
      sowing_calculation_safety_percent_direct: 12,
    };
    const direct: Crop = { id: 3, name: 'Karotte', variety: 'Nantaise', cultivation_types: ['direct_sowing'], sowing_calculation_safety_percent_direct: 8 };
    const inheriting: Crop = { id: 4, name: 'Karotte', variety: 'Rodelika' };

    const [field] = getVaryingComparisonFields([direct, inheriting], directCrop);
    expect(getComparisonCellValue(direct, directCrop, field, t, 'de-DE')).toBe('8 detail.units.percent');
    expect(getComparisonCellValue(inheriting, directCrop, field, t, 'de-DE')).toBe('12 detail.units.percent');
  });
});

describe('getComparisonCellValue', () => {
  const [rowSpacingField] = getVaryingComparisonFields([
    { id: 1, name: 'Carrot', variety: 'Nantes', row_spacing_cm: 30 },
    { id: 2, name: 'Carrot', variety: 'Bolero', row_spacing_cm: 40 },
  ], cropCrop);

  it('formats an expected yield using the inherited per-area unit', () => {
    const parent: Crop = { ...cropCrop, harvest_method: 'per_sqm', expected_yield: 11.3691 };
    const inherited: Crop = { id: 1, name: 'Carrot', variety: 'Nantes' };
    const small: Crop = { id: 2, name: 'Carrot', variety: 'Bolero', expected_yield: 0.004 };
    const [yieldField] = getVaryingComparisonFields([inherited, small], parent);
    expect(yieldField.id).toBe('expectedYield');
    expect(getComparisonCellValue(inherited, parent, yieldField, t, 'de-DE')).toBe('11,37 detail.units.kgPerSqm');
    expect(getComparisonCellValue(small, parent, yieldField, t, 'en-US')).toBe('< 0.01 detail.units.kgPerSqm');
  });

  it('renders an em-dash when the field is empty for that variety and the crop has no value either', () => {
    const variety: Crop = { id: 3, name: 'Carrot', variety: 'Rodelika' };
    expect(getComparisonCellValue(variety, cropCrop, rowSpacingField, t, 'de-DE')).toBe('—');
  });

  it('renders the formatted value when the field is set on the variety itself', () => {
    const variety: Crop = { id: 1, name: 'Carrot', variety: 'Nantes', row_spacing_cm: 30 };
    expect(getComparisonCellValue(variety, cropCrop, rowSpacingField, t, 'de-DE')).toBe('30 detail.units.centimeters');
  });

  it('falls back to the inherited crop value when the variety has no own value', () => {
    const variety: Crop = { id: 3, name: 'Carrot', variety: 'Rodelika' };
    const cropWithSpacing: Crop = { ...cropCrop, row_spacing_cm: 25 };
    expect(getComparisonCellValue(variety, cropWithSpacing, rowSpacingField, t, 'de-DE')).toBe('25 detail.units.centimeters');
  });
});
