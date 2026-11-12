import { invalidSpecificPropertyKeys } from './specificProperties';
import { GERMINATION_NUMBER_FIELDS } from './germination';
/**
 * Validation logic for CropForm.
 *
 * Exports a pure function for validating a draft crop object.
 */
import type { Crop, SeedRateUnitConstraints } from '../api/types';
import type { TFunction } from 'i18next';
import { seedRateValueViolatesConstraint } from './seedRateConstraints';
import { isTimingWindowComplete } from './timingWindows';

export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
}

export type CropValidationMode = 'live' | 'submit';

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().replace(',', '.');
    if (!normalized) {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const hasValue = (value: unknown): boolean => (
  value !== null && value !== undefined && value !== ''
);

const hasUnit = (value: unknown): boolean => (
  value !== null && value !== undefined && value !== ''
);

const validateSeedRateFields = (
  draft: Partial<Crop>,
  errors: Record<string, string>,
  t: TFunction,
  mode: CropValidationMode,
  valueField: 'seed_rate_direct_value' | 'seed_rate_pre_cultivation_value',
  unitField: 'seed_rate_direct_unit' | 'seed_rate_pre_cultivation_unit',
  seedRateUnitConstraints?: Partial<SeedRateUnitConstraints> | null,
): void => {
  const value = draft[valueField];
  const unit = draft[unitField];
  const valueIsPresent = hasValue(value);
  const unitIsPresent = hasUnit(unit);

  if (!valueIsPresent) {
    return;
  }

  if (valueIsPresent && Number(value) <= 0) {
    errors[valueField] = t('form.seedRateValueRequired');
  }
  if (seedRateValueViolatesConstraint(value, unit, seedRateUnitConstraints)) {
    errors[valueField] = t('form.seedRateValueWholeNumberRequired');
  }

  if (mode !== 'submit') {
    return;
  }

  if (valueIsPresent && !unitIsPresent) {
    errors[unitField] = t('form.seedRateUnitRequired');
  }
};

/**
 * Validates a draft crop object for the form.
 *
 * @param draft - Partial crop object (form state)
 * @param t - Translation function
 * @returns ValidationResult with errors keyed by field
 */
export function validateCrop(
  draft: Partial<Crop>,
  t: TFunction,
  mode: CropValidationMode = 'submit',
  requireVariety: boolean = true,
  seedRateUnitConstraints?: Partial<SeedRateUnitConstraints> | null,
): ValidationResult {
  const errors: Record<string, string> = {};

  const cultivationTypes = draft.cultivation_types ?? (draft.cultivation_type ? [draft.cultivation_type] : []);
  const hasDirect = cultivationTypes.includes('direct_sowing');
  const hasPreCultivation = cultivationTypes.includes('pre_cultivation');

  if (hasDirect) {
    validateSeedRateFields(
      draft,
      errors,
      t,
      mode,
      'seed_rate_direct_value',
      'seed_rate_direct_unit',
      seedRateUnitConstraints,
    );
  }

  if (hasPreCultivation) {
    validateSeedRateFields(
      draft,
      errors,
      t,
      mode,
      'seed_rate_pre_cultivation_value',
      'seed_rate_pre_cultivation_unit',
      seedRateUnitConstraints,
    );
  }

  // Required fields: name always; variety only when the form is for a
  // variety-level entry (a crop-level entry is intentionally variety-less).
  if (mode === 'submit') {
    if (!draft.name) {
      errors.name = t('form.nameRequired');
    }
    if (requireVariety && !draft.variety) {
      errors.variety = t('form.varietyRequired');
    }
  }
  // Optional numeric fields with explicit error keys
  if (draft.growth_duration_days !== undefined && draft.growth_duration_days !== null && (typeof draft.growth_duration_days !== 'string' || draft.growth_duration_days !== '')) {
    const numValue = toNumber(draft.growth_duration_days);
    if (numValue !== null && numValue < 0) {
      errors.growth_duration_days = t('form.growthDurationDaysError');
    }
  }
  if (draft.harvest_duration_days !== undefined && draft.harvest_duration_days !== null && (typeof draft.harvest_duration_days !== 'string' || draft.harvest_duration_days !== '')) {
    const numValue = toNumber(draft.harvest_duration_days);
    if (numValue !== null && numValue < 0) {
      errors.harvest_duration_days = t('form.harvestDurationDaysError');
    }
  }
  if (draft.propagation_duration_days !== undefined && draft.propagation_duration_days !== null && (typeof draft.propagation_duration_days !== 'string' || draft.propagation_duration_days !== '')) {
    const numValue = toNumber(draft.propagation_duration_days);
    if (numValue !== null && numValue < 0) {
      errors.propagation_duration_days = t('form.propagationDurationDaysError');
    }
  }

  for (const field of GERMINATION_NUMBER_FIELDS) {
    const value = draft[field];
    if (value != null && (!Number.isFinite(value) || value < (field.includes('days') ? 0 : -273.15) || (field.includes('days') && !Number.isInteger(value)))) {
      errors[field] = t('germination.invalidNumber');
    }
  }
  for (const [lower, upper] of [
    ['germination_temperature_optimal_min_c', 'germination_temperature_optimal_max_c'],
    ['germination_days_min', 'germination_days_max'],
    ['stratification_days_min', 'stratification_days_max'],
    ['stratification_temperature_min_c', 'stratification_temperature_max_c'],
  ] as const) {
    if (draft[lower] != null && draft[upper] != null && draft[lower] > draft[upper]) errors[upper] = t('germination.invalidRange');
  }
  if (draft.sowing_depth_cm != null && draft.sowing_depth_max_cm != null && draft.sowing_depth_cm > draft.sowing_depth_max_cm) {
    errors.sowing_depth_max_cm = t('form.sowingDepthRangeError');
  }

  for (const key of invalidSpecificPropertyKeys(draft.specific_property_profile, draft.specific_properties)) {
    errors[`specific_properties.${key}`] = t('specificProperties.invalidValue');
  }

  // Optional numeric fields validation
  const numericFields = [
    'expected_yield',
    'distance_within_row_cm',
    'row_spacing_cm',
    'sowing_depth_cm',
    'sowing_depth_max_cm',
    'sowing_calculation_safety_percent',
    'sowing_calculation_safety_percent_direct',
    'sowing_calculation_safety_percent_pre_cultivation',
    'thousand_kernel_weight_g',
    'package_size_g',
  ];
  numericFields.forEach(field => {
    const value = draft[field as keyof Crop];
    if (value !== undefined && value !== null && value !== '') {
      const numValue = toNumber(value);
      if (numValue !== null && numValue < 0) {
        errors[field] = t(`form.${field}Error`, { defaultValue: t('form.growthDurationDaysError') });
      }
    }
  });

  if (draft.thousand_kernel_weight_g !== undefined && draft.thousand_kernel_weight_g !== null && Number(draft.thousand_kernel_weight_g) <= 0) {
    errors.thousand_kernel_weight_g = t('form.thousandKernelWeightError');
  }

  // A started window needs both ends; it never saves half-filled.
  if (mode === 'submit') {
    (draft.timing_windows ?? []).forEach((window, index) => {
      if (!isTimingWindowComplete(window)) {
        errors[`timing_windows.${index}`] = t('timingWindows.incomplete');
      }
    });
  }

  // Display color validation
  if (draft.display_color && !/^#[0-9A-Fa-f]{6}$/.test(draft.display_color)) {
    errors.display_color = t('form.displayColorError');
  }

  // If expected_yield is set, the yield unit must also be selected.
  if (
    mode === 'submit' &&
    draft.expected_yield !== undefined &&
    draft.expected_yield !== null &&
    !draft.harvest_method
  ) {
    errors.harvest_method = t('form.yieldUnitRequired');
  }

  if (
    mode === 'submit' &&
    (draft.seeding_requirement === undefined || draft.seeding_requirement === null) &&
    draft.seeding_requirement_type
  ) {
    errors.seeding_requirement = t('form.seedingRequirementValueRequired');
  }
  if (
    mode === 'submit' &&
    draft.seeding_requirement !== undefined &&
    draft.seeding_requirement !== null &&
    !draft.seeding_requirement_type
  ) {
    errors.seeding_requirement_type = t('form.seedingRequirementTypeRequired');
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
  };
}
