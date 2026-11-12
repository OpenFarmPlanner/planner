import { describe, expect, it } from 'vitest';
import type { PublicCrop, Crop } from '../api/types';
import { buildPublicCropUpdatePayload, publicCropToCropFormData } from '../crops/publicCropFormAdapter';

const buildPublicCrop = (overrides: Partial<PublicCrop>): PublicCrop => ({
  id: 1,
  status: 'published',
  name: 'Möhre',
  version: 3,
  ...overrides,
});

const buildCropDraft = (overrides: Partial<Crop>): Crop => ({
  name: 'Möhre',
  ...overrides,
});

describe('publicCropToCropFormData', () => {
  it('preserves a legacy biennial value through editing another public field', () => {
    const form = publicCropToCropFormData(buildPublicCrop({ life_cycle: 'biennial', notes: 'Original' }));
    expect(form.life_cycle).toBe('biennial');
    const payload = buildPublicCropUpdatePayload({ ...form, notes: 'Updated' }, 3);
    expect(payload.life_cycle).toBe('biennial');
    expect(payload.notes).toBe('Updated');
  });

  it('carries the crop species into the form but never into the update payload', () => {
    const form = publicCropToCropFormData(buildPublicCrop({ crop_species: 42 }));

    expect(form.crop_species).toBe(42);
    expect(buildPublicCropUpdatePayload(form, 1)).not.toHaveProperty('crop_species');
  });

  it('converts meter fields to centimeters and normalizes the legacy seed rate', () => {
    const form = publicCropToCropFormData(buildPublicCrop({
      distance_within_row_m: 0.3,
      row_spacing_m: 0.4,
      sowing_depth_m: 0.02,
      cultivation_type: 'direct_sowing',
      seed_rate_value: 12,
      seed_rate_unit: 'g/m²',
    }));

    expect(form.distance_within_row_cm).toBe(30);
    expect(form.row_spacing_cm).toBe(40);
    expect(form.sowing_depth_cm).toBe(2);
    expect(form.seed_rate_unit).toBe('g_per_m2');
    expect(form.seed_rate_direct_value).toBe(12);
    expect(form.seed_rate_direct_unit).toBe('g_per_m2');
    expect(form.seed_rate_pre_cultivation_value).toBeNull();
  });

  it('prefers centimeter response aliases over converting meter fields', () => {
    const form = publicCropToCropFormData(buildPublicCrop({
      distance_within_row_m: 0.3,
      distance_within_row_cm: 31,
      row_spacing_m: 0.4,
      row_spacing_cm: 41,
      sowing_depth_m: 0.02,
      sowing_depth_cm: 3,
    }));

    expect(form.distance_within_row_cm).toBe(31);
    expect(form.row_spacing_cm).toBe(41);
    expect(form.sowing_depth_cm).toBe(3);
  });

  it('defaults cultivation types to pre_cultivation when none are set', () => {
    const form = publicCropToCropFormData(buildPublicCrop({}));

    expect(form.cultivation_types).toEqual(['pre_cultivation']);
    expect(form.cultivation_type).toBe('pre_cultivation');
  });

  it('prefers method-specific seed rates over the legacy fallback', () => {
    const form = publicCropToCropFormData(buildPublicCrop({
      cultivation_types: ['direct_sowing', 'pre_cultivation'],
      seed_rate_by_cultivation: {
        direct_sowing: { value: 5, unit: 'seeds_per_m2' },
        pre_cultivation: { value: 7, unit: 'seeds_per_plant' },
      },
    }));

    expect(form.seed_rate_direct_value).toBe(5);
    expect(form.seed_rate_direct_unit).toBe('seeds_per_m2');
    expect(form.seed_rate_pre_cultivation_value).toBe(7);
    expect(form.seed_rate_pre_cultivation_unit).toBe('seeds_per_plant');
  });

  it('carries the original-language notes into the public edit form', () => {
    const form = publicCropToCropFormData(buildPublicCrop({ notes: 'Some notes' }));

    expect(form.notes).toBe('Some notes');
  });

  it('prefers the original-language translation over the legacy notes copy', () => {
    const form = publicCropToCropFormData(buildPublicCrop({
      notes: 'Legacy notes',
      original_language_code: 'de',
      translations: {
        de: 'Original German notes',
        en: 'English notes',
      },
    }));

    expect(form.notes).toBe('Original German notes');
  });
});

describe('buildPublicCropUpdatePayload', () => {
  it('converts centimeter fields back to meters and stamps the base version', () => {
    const payload = buildPublicCropUpdatePayload(buildCropDraft({
      distance_within_row_cm: 30,
      row_spacing_cm: 40,
      sowing_depth_cm: 2,
    }), 4);

    expect(payload.base_version).toBe(4);
    expect(payload.notes).toBe('');
    expect(payload.distance_within_row_m).toBe(0.3);
    expect(payload.row_spacing_m).toBe(0.4);
    expect(payload.sowing_depth_m).toBe(0.02);
  });

  it('falls back to pre_cultivation when the draft has no cultivation type', () => {
    const payload = buildPublicCropUpdatePayload(buildCropDraft({}), 1);

    expect(payload.cultivation_types).toEqual(['pre_cultivation']);
  });

  it('drops invalid cultivation types from an explicit list', () => {
    const payload = buildPublicCropUpdatePayload(buildCropDraft({
      cultivation_types: ['direct_sowing', '' as Crop['cultivation_type']].filter(Boolean) as Crop['cultivation_types'],
    }), 1);

    expect(payload.cultivation_types).toEqual(['direct_sowing']);
  });

  it('keeps the farm-specific seed safety margin out of the public payload', () => {
    const payload = buildPublicCropUpdatePayload(buildCropDraft({
      sowing_calculation_safety_percent_direct: 10,
      sowing_calculation_safety_percent_pre_cultivation: 20,
      sowing_calculation_safety_percent: 30,
    }), 1);

    expect(payload).not.toHaveProperty('sowing_calculation_safety_percent');
  });

  it('falls back to the legacy seed rate when no method-specific values are set', () => {
    const payload = buildPublicCropUpdatePayload(buildCropDraft({
      seed_rate_value: 15,
      seed_rate_unit: 'g_per_m2',
      cultivation_types: ['direct_sowing'],
    }), 1);

    expect(payload.seed_rate_value).toBe(15);
    expect(payload.seed_rate_unit).toBe('g_per_m2');
    expect(payload.seed_rate_by_cultivation).toBeNull();
  });

  it('includes notes so public edits update the original-language description', () => {
    const payload = buildPublicCropUpdatePayload(buildCropDraft({
      notes: 'Updated original notes',
    }), 1);

    expect(payload.notes).toBe('Updated original notes');
  });

  it('publishes inherited values a Sorte takes from its general Kultur, not blanks', () => {
    const payload = buildPublicCropUpdatePayload(buildCropDraft({
      growth_duration_days: undefined,
      harvest_duration_days: undefined,
      inherited_fields: ['growth_duration_days', 'harvest_duration_days'],
      effective_values: { growth_duration_days: 55, harvest_duration_days: 25 },
    }), 1);

    expect(payload.growth_duration_days).toBe(55);
    expect(payload.harvest_duration_days).toBe(25);
  });

  it('keeps the Sorte\'s own value when it overrides the inherited one', () => {
    const payload = buildPublicCropUpdatePayload(buildCropDraft({
      growth_duration_days: 70,
      effective_values: { growth_duration_days: 55 },
    }), 1);

    expect(payload.growth_duration_days).toBe(70);
  });
});
