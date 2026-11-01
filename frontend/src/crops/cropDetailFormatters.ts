/**
 * Storage key, persisted-filter shape, and pure value formatters for the
 * crop detail view. Extracted verbatim from crops/CropDetail.tsx.
 */

import { getActiveFormattingLocale } from '../utils/numberLocalization';

export const CROP_FILTERS_STORAGE_KEY = 'cropsDetailFiltersV1';
/** Pre-"Crop" spelling, still present in a tab opened before the rename. */
export const LEGACY_CROP_FILTERS_STORAGE_KEY = 'culturesDetailFiltersV1';

export interface PersistedCropFilters {
  searchQuery: string;
  selectedFamilyFilter: string;
  /** A group name ("Gruppe"); '' for all. */
  selectedTagFilter: string;
  selectedCultivationFilter: string;
  selectedNutrientFilter: string;
  selectedSupplierFilter: string;
  growthDaysMin: string;
  growthDaysMax: string;
  yieldMin: string;
  yieldMax: string;
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
