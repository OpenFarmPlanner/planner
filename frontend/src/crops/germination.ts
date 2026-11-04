import type { Crop } from '../api/types';
import type { TFunction } from 'i18next';

export const GERMINATION_TYPES = ['cold', 'frost', 'light', 'dark'] as const;
export const GERMINATION_NUMBER_FIELDS = [
  'germination_temperature_optimal_min_c', 'germination_temperature_optimal_max_c',
  'germination_temperature_min_c', 'germination_days_min', 'germination_days_max',
] as const;
export const GERMINATION_FIELDS = [...GERMINATION_NUMBER_FIELDS, 'germination_types', 'germination_pretreatment'] as const;

export function formatGerminationValue(field: string, value: unknown, t: TFunction, locale: string): string {
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return t('noData');
  if (field === 'germination_types' && Array.isArray(value)) {
    return value.filter((kind) => GERMINATION_TYPES.includes(kind)).map((kind) => t(`germination.types.${kind}`)).join(', ');
  }
  if (typeof value === 'number') return new Intl.NumberFormat(locale).format(value);
  return String(value);
}

export function propagationShorterThanGermination(crop: Partial<Crop>): boolean {
  return (crop.cultivation_types?.length ? crop.cultivation_types.includes('pre_cultivation') : crop.cultivation_type === 'pre_cultivation')
    && crop.propagation_duration_days != null && crop.germination_days_max != null
    && crop.propagation_duration_days < crop.germination_days_max;
}
