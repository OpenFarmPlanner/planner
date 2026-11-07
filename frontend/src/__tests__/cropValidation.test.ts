import { describe, it, expect } from 'vitest';
import { validateCrop } from '../crops/validation';

const t = (key: string) => key;
const seedRateUnitConstraints = {
  g_per_m2: { value_type: 'number' as const, step: 0.001, minimum: 0.001 },
  g_per_lfm: { value_type: 'number' as const, step: 0.001, minimum: 0.001 },
  seeds_per_m2: { value_type: 'number' as const, step: 0.001, minimum: 0.001 },
  seeds_per_lfm: { value_type: 'number' as const, step: 0.001, minimum: 0.001 },
  seeds_per_plant: { value_type: 'integer' as const, step: 1, minimum: 1 },
};

describe('validateCrop', () => {
  it('returns required field errors for missing mandatory values', () => {
    const result = validateCrop({}, t);

    expect(result.isValid).toBe(false);
    expect(result.errors.name).toBe('form.nameRequired');
    expect(result.errors.variety).toBe('form.varietyRequired');
    expect(result.errors.supplier).toBeUndefined();
    expect(result.errors.growth_duration_days).toBeUndefined();
    expect(result.errors.harvest_duration_days).toBeUndefined();
    expect(result.errors.propagation_duration_days).toBeUndefined();
  });

  it('does not require variety for a crop-level entry when requireVariety is false', () => {
    const result = validateCrop({ name: 'Karotte' }, t, 'submit', false);

    expect(result.isValid).toBe(true);
    expect(result.errors.variety).toBeUndefined();
  });

  it('still requires name even when requireVariety is false', () => {
    const result = validateCrop({}, t, 'submit', false);

    expect(result.isValid).toBe(false);
    expect(result.errors.name).toBe('form.nameRequired');
    expect(result.errors.variety).toBeUndefined();
  });

  it('validates seed rate value/unit dependencies and positive amount', () => {
    const missingUnit = validateCrop(
      { name: 'Karotte', variety: 'Nantaise', supplier: { id: 1, name: 'Test' } as unknown, cultivation_types: ['direct_sowing'], growth_duration_days: 10, harvest_duration_days: 5, propagation_duration_days: 2, seed_rate_direct_value: 1 },
      t
    );
    expect(missingUnit.errors.seed_rate_direct_unit).toBe('form.seedRateUnitRequired');

    const nonPositive = validateCrop(
      { name: 'Karotte', variety: 'Nantaise', supplier: { id: 1, name: 'Test' } as unknown, cultivation_types: ['direct_sowing'], growth_duration_days: 10, harvest_duration_days: 5, propagation_duration_days: 2, seed_rate_direct_value: 0, seed_rate_direct_unit: 'g_per_m2' },
      t
    );
    expect(nonPositive.errors.seed_rate_direct_value).toBe('form.seedRateValueRequired');
    
  });

  it('allows clearing seed rate amount while keeping unit and safety values', () => {
    const result = validateCrop(
      {
        name: 'Karotte',
        variety: 'Nantaise',
        cultivation_types: ['direct_sowing', 'pre_cultivation'],
        seed_rate_direct_value: null,
        seed_rate_direct_unit: 'g_per_m2',
        sowing_calculation_safety_percent_direct: 10,
        seed_rate_pre_cultivation_value: null,
        seed_rate_pre_cultivation_unit: 'g_per_m2',
        sowing_calculation_safety_percent_pre_cultivation: 10,
        thousand_kernel_weight_g: 3.5,
      },
      t
    );

    expect(result.errors.seed_rate_direct_value).toBeUndefined();
    expect(result.errors.seed_rate_direct_unit).toBeUndefined();
    expect(result.errors.seed_rate_pre_cultivation_value).toBeUndefined();
    expect(result.errors.seed_rate_pre_cultivation_unit).toBeUndefined();
  });

  it('accepts small seed rate values with three decimal places', () => {
    const result = validateCrop(
      {
        name: 'Karotte',
        variety: 'Nantaise',
        cultivation_types: ['direct_sowing', 'pre_cultivation'],
        seed_rate_direct_value: 0.014,
        seed_rate_direct_unit: 'g_per_m2',
        seed_rate_pre_cultivation_value: 0.125,
        seed_rate_pre_cultivation_unit: 'g_per_m2',
      },
      t
    );

    expect(result.errors.seed_rate_direct_value).toBeUndefined();
    expect(result.errors.seed_rate_pre_cultivation_value).toBeUndefined();
  });

  it('rejects fractional seed rate values when the selected unit requires whole numbers', () => {
    const result = validateCrop(
      {
        name: 'Aubergine',
        variety: 'Nala',
        cultivation_types: ['pre_cultivation'],
        seed_rate_pre_cultivation_value: 1.1,
        seed_rate_pre_cultivation_unit: 'seeds_per_plant',
      },
      t,
      'submit',
      true,
      seedRateUnitConstraints,
    );

    expect(result.errors.seed_rate_pre_cultivation_value).toBe('form.seedRateValueWholeNumberRequired');
  });

  it('keeps empty seed rate partner fields neutral during live validation', () => {
    const emptyAmountWithUnit = validateCrop(
      {
        name: 'Karotte',
        variety: 'Nantaise',
        cultivation_types: ['direct_sowing'],
        seed_rate_direct_unit: 'g_per_m2',
      },
      t,
      'live'
    );
    expect(emptyAmountWithUnit.errors.seed_rate_direct_value).toBeUndefined();

    const amountWithoutUnit = validateCrop(
      {
        name: 'Karotte',
        variety: 'Nantaise',
        cultivation_types: ['direct_sowing'],
        seed_rate_direct_value: 3,
      },
      t,
      'live'
    );
    expect(amountWithoutUnit.errors.seed_rate_direct_unit).toBeUndefined();

    const nonPositive = validateCrop(
      {
        name: 'Karotte',
        variety: 'Nantaise',
        cultivation_types: ['direct_sowing'],
        seed_rate_direct_value: 0,
      },
      t,
      'live'
    );
    expect(nonPositive.errors.seed_rate_direct_value).toBe('form.seedRateValueRequired');
  });

  it('accepts direct sowing without propagation duration', () => {
    const result = validateCrop(
      {
        name: 'Radies',
        variety: 'Saxa',
        supplier: { id: 1, name: 'Test' } as unknown,
        cultivation_type: 'direct_sowing',
        growth_duration_days: 20,
        harvest_duration_days: 10,
      },
      t
    );

    expect(result.errors.propagation_duration_days).toBeUndefined();
  });

  it('does not require hidden method fields', () => {
    const result = validateCrop(
      {
        name: 'Spinat',
        variety: 'Matador',
        supplier: { id: 1, name: 'Test' } as unknown,
        cultivation_types: ['direct_sowing'],
        seed_rate_pre_cultivation_unit: 'g_per_m2',
      },
      t
    );

    expect(result.errors.seed_rate_pre_cultivation_value).toBeUndefined();
  });

  it('rejects negative numeric values including string inputs', () => {
    const result = validateCrop(
      {
        name: 'Tomate',
        variety: 'Harzfeuer',
        supplier: { id: 1, name: 'Test' } as unknown,
        cultivation_type: 'pre_cultivation',
        growth_duration_days: '-1' as never,
        harvest_duration_days: -2,
        propagation_duration_days: '-3' as never,
        expected_yield: '-4' as never,
        distance_within_row_cm: -5,
        row_spacing_cm: '-6' as never,
        sowing_depth_cm: -7,
        sowing_calculation_safety_percent: '-8' as never,
      },
      t
    );

    expect(result.errors.growth_duration_days).toBe('form.growthDurationDaysError');
    expect(result.errors.harvest_duration_days).toBe('form.harvestDurationDaysError');
    expect(result.errors.propagation_duration_days).toBe('form.propagationDurationDaysError');
    expect(result.errors.expected_yield).toBe('form.expected_yieldError');
    expect(result.errors.distance_within_row_cm).toBe('form.distance_within_row_cmError');
    expect(result.errors.row_spacing_cm).toBe('form.row_spacing_cmError');
    expect(result.errors.sowing_depth_cm).toBe('form.sowing_depth_cmError');
    expect(result.errors.sowing_calculation_safety_percent).toBe('form.sowing_calculation_safety_percentError');
  });

  it('validates display color format and yield unit dependency', () => {
    const invalidColor = validateCrop(
      {
        name: 'Salat',
        variety: 'Lollo Rosso',
        supplier: { id: 1, name: 'Test' } as unknown,
        cultivation_type: 'pre_cultivation',
        growth_duration_days: 15,
        harvest_duration_days: 8,
        propagation_duration_days: 4,
        display_color: '#12ZZ00',
      },
      t
    );
    expect(invalidColor.errors.display_color).toBe('form.displayColorError');

    const requiresMethod = validateCrop(
      {
        name: 'Salat',
        variety: 'Lollo Rosso',
        supplier: { id: 1, name: 'Test' } as unknown,
        cultivation_type: 'pre_cultivation',
        growth_duration_days: 15,
        harvest_duration_days: 8,
        propagation_duration_days: 4,
        expected_yield: 2,
      },
      t
    );
    expect(requiresMethod.errors.harvest_method).toBe('form.yieldUnitRequired');

    const withMethod = validateCrop(
      {
        name: 'Salat',
        variety: 'Lollo Rosso',
        supplier: { id: 1, name: 'Test' } as unknown,
        cultivation_type: 'pre_cultivation',
        growth_duration_days: 15,
        harvest_duration_days: 8,
        propagation_duration_days: 4,
        expected_yield: 2,
        harvest_method: 'per_sqm',
        display_color: '#12aa00',
      },
      t
    );
    expect(withMethod.isValid).toBe(true);
    expect(withMethod.errors).toEqual({});
  });

  it('accepts string numeric values when non-negative', () => {
    const result = validateCrop(
      {
        name: 'Fenchel',
        variety: 'Fino',
        supplier: { id: 1, name: 'Test' } as unknown,
        cultivation_type: 'pre_cultivation',
        growth_duration_days: '12' as never,
        harvest_duration_days: '7' as never,
        propagation_duration_days: '3' as never,
      },
      t
    );

    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual({});
  });


  it('accepts existing seed package sizes provided as strings (including comma decimals)', () => {
    const result = validateCrop(
      {
        name: 'Möhre',
        variety: 'Rodelika',
        supplier: { id: 1, name: 'Test' } as unknown,
        seed_packages: [
          { size_value: '0.2', size_unit: 'g' } as unknown,
          { size_value: '4,6', size_unit: 'g' } as unknown,
        ],
      },
      t
    );

    expect(result.errors['seed_packages.0.size_value']).toBeUndefined();
    expect(result.errors['seed_packages.1.size_value']).toBeUndefined();
  });


});

describe('sowing depth range', () => {
  it('rejects a lower bound above the upper bound and accepts one depth', () => {
    const base = { name: 'Möhre', cultivation_type: 'direct_sowing' as const };
    expect(validateCrop({ ...base, sowing_depth_cm: 3, sowing_depth_max_cm: 2 }, t).errors.sowing_depth_max_cm)
      .toBe('form.sowingDepthRangeError');
    expect(validateCrop({ ...base, sowing_depth_cm: 2, sowing_depth_max_cm: 2 }, t).errors.sowing_depth_max_cm)
      .toBeUndefined();
    expect(validateCrop({ ...base, sowing_depth_cm: 2, sowing_depth_max_cm: null }, t).errors.sowing_depth_max_cm)
      .toBeUndefined();
  });
});
