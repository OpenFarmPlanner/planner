import type { Crop } from '../api/types';
import type { TFunction } from 'i18next';
import { hasAnyDetailValue } from './cropDetailFieldVisibility';

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
export type GerminationDetailField = typeof GERMINATION_NUMBER_FIELDS[number]
  | 'germination_temperature_requirement' | 'germination_light_requirement' | 'germination_pretreatment';

type GerminationRow = {
  field: GerminationDetailField;
  upper?: GerminationDetailField;
  label: string;
  unit?: 'celsius' | 'days';
  stratification?: boolean;
};

const germinationRows: readonly GerminationRow[] = [
  { field: 'germination_temperature_optimal_min_c', upper: 'germination_temperature_optimal_max_c',
    label: 'germination.detail.optimalTemperature', unit: 'celsius' },
  { field: 'germination_temperature_min_c', label: 'germination.detail.minimumTemperature', unit: 'celsius' },
  { field: 'germination_days_min', upper: 'germination_days_max', label: 'germination.detail.days', unit: 'days' },
  { field: 'germination_temperature_requirement', label: 'germination.fields.germination_temperature_requirement' },
  { field: 'stratification_days_min', upper: 'stratification_days_max',
    label: 'germination.detail.stratificationDays', unit: 'days', stratification: true },
  { field: 'stratification_temperature_min_c', upper: 'stratification_temperature_max_c',
    label: 'germination.detail.stratificationTemperature', unit: 'celsius', stratification: true },
  { field: 'germination_light_requirement', label: 'germination.fields.germination_light_requirement' },
  { field: 'germination_pretreatment', label: 'germination.fields.germination_pretreatment' },
];

export function getGerminationDetailRows(
  value: (field: GerminationDetailField) => unknown,
  showEmptyRanges: boolean,
) {
  const stratification = requiresStratification(value('germination_temperature_requirement'));
  return germinationRows.flatMap(row => {
    if (row.stratification && !stratification) return [];
    const lower = value(row.field);
    const upper = row.upper ? value(row.upper) : lower;
    return hasAnyDetailValue(lower, upper) || (showEmptyRanges && row.upper) ? [{ row, lower, upper }] : [];
  });
}

export function requiresStratification(requirement: unknown): boolean {
  return requirement === 'cold_stratification' || requirement === 'frost_treatment';
}

export function hasLegacyGerminationConflict(crop: Partial<Crop>): boolean {
  const flags = crop.germination_types ?? [];
  return (!crop.germination_temperature_requirement && flags.includes('cold') && flags.includes('frost'))
    || (!crop.germination_light_requirement && flags.includes('light') && flags.includes('dark'));
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
    return new Intl.NumberFormat(locale).format(value);
  }
  return String(value);
}

export function propagationShorterThanGermination(crop: Partial<Crop>): boolean {
  return (crop.cultivation_types?.length ? crop.cultivation_types.includes('pre_cultivation') : crop.cultivation_type === 'pre_cultivation')
    && crop.propagation_duration_days != null && crop.germination_days_max != null
    && crop.propagation_duration_days < crop.germination_days_max;
}
