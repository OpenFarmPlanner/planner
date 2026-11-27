/**
 * Storage key, persisted-filter shape, and pure value formatters for the
 * crop detail view. Extracted verbatim from crops/CropDetail.tsx.
 */

import { formatLocalizedNumber, getActiveFormattingLocale } from '../utils/numberLocalization';
import type { PlantHealthSelection } from '../api/types';

export const CROP_FILTERS_STORAGE_KEY = 'cropsDetailFiltersV1';
/** Pre-"Crop" spelling, still present in a tab opened before the rename. */
export const LEGACY_CROP_FILTERS_STORAGE_KEY = 'culturesDetailFiltersV1';
export const CROP_ORIGIN_FILTER_OPTIONS = ['manual', 'file_import', 'library_import', 'unknown'] as const;
export type CropOriginFilter = '' | typeof CROP_ORIGIN_FILTER_OPTIONS[number];

export interface PersistedCropFilters {
  searchQuery: string;
  selectedFamilyFilter: string;
  /** Every selected tag must match; an empty list does not restrict tags. */
  selectedTagFilter: string[];
  selectedPlantHealthFilter: PlantHealthSelection[];
  selectedCultivationFilter: string;
  selectedNutrientFilter: string;
  /** 'open_pollinated', 'f1_hybrid', 'unknown', or '' for all. */
  selectedSeedTypeFilter: string;
  selectedSupplierFilter: string;
  selectedOriginFilter?: CropOriginFilter;
  growthDaysMin: string;
  growthDaysMax: string;
  yieldMin: string;
  yieldMax: string;
  /** "Aussaat möglich im Monat": '1'-'12', or '' for any month. */
  sowingMonth: string;
}

/**
 * Formats a number with fallback for null/undefined values
 * Handles floating point precision issues by rounding to 2 decimal places
 */
export function formatNumber(
  value: number | null | undefined,
  t: (key: string) => string,
  locale = getActiveFormattingLocale(),
): string {
  if (value === null || value === undefined) {
    return t('noData');
  }
  
  // Round to 2 decimal places to avoid floating point precision issues
  const rounded = Math.round(value * 100) / 100;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(rounded);
}

export function formatSeedRateNumber(
  value: number | null | undefined,
  t: (key: string) => string,
  locale = getActiveFormattingLocale(),
): string {
  if (value === null || value === undefined) {
    return t('noData');
  }

  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(value);
}

/**
 * Formats a distance value (rounds to whole numbers since no one measures more precisely than 1cm)
 */
export function formatDistance(
  value: number | null | undefined,
  t: (key: string) => string,
  locale = getActiveFormattingLocale(),
  decimals = 0,
): string {
  if (value === null || value === undefined) {
    return t('noData');
  }

  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(rounded);
}

type RangeUnit = 'celsius' | 'centimeters' | 'days';
type RangeTranslation = (key: string, options?: { value?: string; count?: number }) => string;

/** The inputs are the effective bounds after any variety inheritance. */
export function formatCropDetailRange(
  lower: unknown,
  upper: unknown,
  unit: RangeUnit,
  t: RangeTranslation,
  locale: string,
): string {
  const from = typeof lower === 'number' && Number.isFinite(lower) ? lower : null;
  const to = typeof upper === 'number' && Number.isFinite(upper) ? upper : null;
  const number = from ?? to;
  if (number === null) return '—';

  const different = from !== null && to !== null && from !== to;
  const format = (value: number) => formatLocalizedNumber(value, locale, { maximumFractionDigits: 6 });
  const unitLabel = unit === 'celsius' ? '°C' : unit === 'centimeters' ? t('detail.units.centimeters')
    : t('detail.ranges.dayUnit', { count: different ? 2 : number });
  const value = `${different ? `${format(from)}–${format(to)}` : format(number)} ${unitLabel}`;
  if (from === null) return t('detail.ranges.upTo', { value });
  if (to === null) return t('detail.ranges.atLeast', { value });
  return value;
}

export function formatSeedUnitLabel(unit: string | null | undefined, t: (key: string) => string): string {
  if (unit === 'g_per_m2') return t('detail.seedUnits.gPerSqm');
  if (unit === 'g_per_lfm') return t('detail.seedUnits.gPerRunningMeter');
  if (unit === 'seeds_per_m2') return t('detail.seedUnits.seedsPerSqm');
  if (unit === 'seeds_per_lfm') return t('detail.seedUnits.seedsPerRunningMeter');
  if (unit === 'seeds_per_plant') return t('detail.seedUnits.seedsPerPlant');
  return unit ?? '';
}

export function formatPackageSizes(
  packageSizes: Array<{ size_value?: number | null; size_unit?: string | null }> | null | undefined,
  t: (key: string) => string,
  locale = getActiveFormattingLocale(),
): string {
  if (!Array.isArray(packageSizes) || packageSizes.length === 0) {
    return t('noData');
  }

  const normalized = packageSizes
    .filter((entry) => entry && typeof entry.size_value === 'number' && Number.isFinite(entry.size_value) && entry.size_value > 0)
    .map((entry) => `${formatNumber(entry.size_value ?? null, t, locale)} ${entry.size_unit === 'seeds' ? t('detail.packageUnits.seeds') : t('detail.packageUnits.grams')}`);

  if (normalized.length === 0) {
    return t('noData');
  }

  return normalized.join(', ');
}
