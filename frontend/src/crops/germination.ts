import type { Crop } from '../api/types';
import type { TFunction } from 'i18next';

export const GERMINATION_TYPES = ['cold', 'frost', 'light', 'dark'] as const;
export const TEMPERATURE_REQUIREMENTS = ['none', 'cold_stratification', 'frost_treatment'] as const;
export const GERMINATION_LIGHT_REQUIREMENTS = ['none', 'light', 'dark'] as const;
export const STRATIFICATION_FIELDS = [
  'stratification_days_min', 'stratification_days_max',
  'stratification_temperature_min_c', 'stratification_temperature_max_c',
] as const;
export const GERMINATION_NUMBER_FIELDS = [
  'germination_temperature_optimal_min_c', 'germination_temperature_optimal_max_c',
  'germination_temperature_min_c', 'germination_days_min', 'germination_days_max',
  ...STRATIFICATION_FIELDS,
] as const;
// Shared presentation order for the form and both project/library details.
export const GERMINATION_FIELDS = [
  'germination_temperature_optimal_min_c', 'germination_temperature_optimal_max_c',
  'germination_temperature_min_c', 'germination_days_min', 'germination_days_max',
  'germination_temperature_requirement', ...STRATIFICATION_FIELDS,
  'germination_light_requirement', 'propagation_duration_days', 'germination_pretreatment',
] as const;

export function requiresStratification(requirement: unknown): boolean {
  return requirement === 'cold_stratification' || requirement === 'frost_treatment';
}

export function hasLegacyGerminationConflict(crop: Partial<Crop>): boolean {
  const flags = crop.germination_types ?? [];
  return (!crop.germination_temperature_requirement && flags.includes('cold') && flags.includes('frost'))
    || (!crop.germination_light_requirement && flags.includes('light') && flags.includes('dark'));
}

export function germinationDetailFields(temperatureRequirement: unknown) {
  return GERMINATION_FIELDS.filter((field) => !field.startsWith('stratification_') || requiresStratification(temperatureRequirement));
}

export function formatGerminationValue(field: string, value: unknown, t: TFunction, locale: string): string {
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return t('noData');
  if (field === 'germination_types' && Array.isArray(value)) {
    return value.filter((kind) => GERMINATION_TYPES.includes(kind)).map((kind) => t(`germination.types.${kind}`)).join(', ');
  }
  if (field === 'germination_temperature_requirement' || field === 'germination_light_requirement') {
    return t(`germination.values.${field}.${value}`);
  }
  if (typeof value === 'number') {
    const formatted = new Intl.NumberFormat(locale).format(value);
    return field === 'propagation_duration_days' ? `${formatted} ${t('detail.units.days')}` : formatted;
  }
  return String(value);
}

export function propagationShorterThanGermination(crop: Partial<Crop>): boolean {
  return (crop.cultivation_types?.length ? crop.cultivation_types.includes('pre_cultivation') : crop.cultivation_type === 'pre_cultivation')
    && crop.propagation_duration_days != null && crop.germination_days_max != null
    && crop.propagation_duration_days < crop.germination_days_max;
}
