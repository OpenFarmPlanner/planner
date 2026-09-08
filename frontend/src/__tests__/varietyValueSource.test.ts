import { describe, it, expect } from 'vitest';
import {
  areCropValuesEqual,
  buildVarietyInheritanceBaseline,
  getEffectiveCropValue,
  getVarietyOwnValueSource,
  isEmptyCropValue,
  stripValuesMatchingBaseline,
} from '../crops/varietyValueSource';
import type { Crop } from '../api/types';

describe('isEmptyCropValue', () => {
  it('treats null, undefined, empty string and empty arrays as empty', () => {
    expect(isEmptyCropValue(null)).toBe(true);
    expect(isEmptyCropValue(undefined)).toBe(true);
    expect(isEmptyCropValue('')).toBe(true);
    expect(isEmptyCropValue([])).toBe(true);
  });

  it('treats 0, false and non-empty values as not empty', () => {
    expect(isEmptyCropValue(0)).toBe(false);
    expect(isEmptyCropValue(false)).toBe(false);
    expect(isEmptyCropValue('a')).toBe(false);
    expect(isEmptyCropValue(['x'])).toBe(false);
  });
});

describe('areCropValuesEqual', () => {
  it('treats different empty representations as equal', () => {
    expect(areCropValuesEqual(null, undefined)).toBe(true);
    expect(areCropValuesEqual('', [])).toBe(true);
  });

  it('compares numbers within floating point epsilon', () => {
    expect(areCropValuesEqual(1.1, 1.1)).toBe(true);
    expect(areCropValuesEqual(1, 2)).toBe(false);
  });

  it('compares arrays and objects structurally', () => {
    expect(areCropValuesEqual(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(areCropValuesEqual(['a', 'b'], ['b', 'a'])).toBe(false);
  });

  it('compares strings and other scalars by identity', () => {
    expect(areCropValuesEqual('low', 'low')).toBe(true);
    expect(areCropValuesEqual('low', 'high')).toBe(false);
  });
});

describe('getEffectiveCropValue', () => {
  it('preserves an explicit null effective value instead of exposing stale raw data', () => {
    const crop: Partial<Crop> = {
      nutrient_demand: 'high',
      effective_values: { nutrient_demand: null },
    };

    expect(getEffectiveCropValue(crop, 'nutrient_demand')).toBeNull();
  });

  it('falls back to the raw value for payloads without an effective field', () => {
    const crop: Partial<Crop> = { growth_duration_days: 42 };

    expect(getEffectiveCropValue(crop, 'growth_duration_days')).toBe(42);
  });
});

describe('getVarietyOwnValueSource', () => {
  const speciesCrop: Partial<Crop> = {
    id: 1,
    name: 'Karotte',
    variety: '',
    row_spacing_cm: 30,
    nutrient_demand: 'medium',
  };

  it('returns null when the crop has no variety', () => {
    const crop: Partial<Crop> = { name: 'Karotte', variety: '', row_spacing_cm: 40 };
    expect(getVarietyOwnValueSource(crop, speciesCrop, 'row_spacing_cm')).toBeNull();
  });

  it('returns null when there is no species crop to compare against', () => {
    const crop: Partial<Crop> = { name: 'Karotte', variety: 'Nantaise', row_spacing_cm: 40 };
    expect(getVarietyOwnValueSource(crop, null, 'row_spacing_cm')).toBeNull();
  });

  it('returns null when the variety value is empty (falls back to the crop value)', () => {
    const crop: Partial<Crop> = { name: 'Karotte', variety: 'Nantaise', row_spacing_cm: undefined };
    expect(getVarietyOwnValueSource(crop, speciesCrop, 'row_spacing_cm')).toBeNull();
  });

  it('returns null when the variety value matches the crop value', () => {
    const crop: Partial<Crop> = { name: 'Karotte', variety: 'Nantaise', row_spacing_cm: 30 };
    expect(getVarietyOwnValueSource(crop, speciesCrop, 'row_spacing_cm')).toBeNull();
  });

  it('returns "ownValue" when the variety overrides the crop value', () => {
    const crop: Partial<Crop> = { name: 'Karotte', variety: 'Nantaise', row_spacing_cm: 40 };
    expect(getVarietyOwnValueSource(crop, speciesCrop, 'row_spacing_cm')).toBe('ownValue');
  });
});

describe('buildVarietyInheritanceBaseline', () => {
  it('copies only inheritable fields the crop actually has a value for', () => {
    const cropCrop: Crop = {
      id: 1,
      name: 'Karotte',
      variety: '',
      row_spacing_cm: 30,
      crop_family: 'Doldenblütler',
      notes: 'internal crop notes',
      display_color: '#ff0000',
    };

    const baseline = buildVarietyInheritanceBaseline(cropCrop);

    expect(baseline).toEqual({ row_spacing_cm: 30, crop_family: 'Doldenblütler' });
    // Identity/free-text/per-variety fields are never copied, even though set.
    expect(baseline).not.toHaveProperty('notes');
    expect(baseline).not.toHaveProperty('display_color');
    expect(baseline).not.toHaveProperty('name');
    expect(baseline).not.toHaveProperty('variety');
  });

  it('omits fields the crop itself leaves empty', () => {
    const cropCrop: Crop = { id: 1, name: 'Karotte', variety: '' };
    expect(buildVarietyInheritanceBaseline(cropCrop)).toEqual({});
  });
});

describe('stripValuesMatchingBaseline', () => {
  const emptyValueFor = (): undefined => undefined;

  it('clears a field that still matches the baseline', () => {
    const draft = { name: 'Karotte', variety: 'Nantaise', row_spacing_cm: 30 };
    const baseline = { row_spacing_cm: 30 };

    const result = stripValuesMatchingBaseline(draft, baseline, emptyValueFor);
    expect(result.row_spacing_cm).toBeUndefined();
    expect(result.name).toBe('Karotte');
  });

  it('keeps a field the user changed away from the baseline', () => {
    const draft = { name: 'Karotte', variety: 'Nantaise', row_spacing_cm: 40 };
    const baseline = { row_spacing_cm: 30 };

    const result = stripValuesMatchingBaseline(draft, baseline, emptyValueFor);
    expect(result.row_spacing_cm).toBe(40);
  });

  it('leaves fields not present in the baseline untouched', () => {
    const draft = { name: 'Karotte', variety: 'Nantaise', thousand_kernel_weight_g: 3.2 };
    const baseline = { row_spacing_cm: 30 };

    const result = stripValuesMatchingBaseline(draft, baseline, emptyValueFor);
    expect(result.thousand_kernel_weight_g).toBe(3.2);
  });
});
