import { useCallback, useEffect, useState } from 'react';
import type { SetURLSearchParams } from 'react-router';

import { readWithLegacyKey, removeWithLegacyKey } from '../compat/legacyCropNames';
import {
  CROP_FILTERS_STORAGE_KEY,
  LEGACY_CROP_FILTERS_STORAGE_KEY,
  type PersistedCropFilters,
} from './cropDetailFormatters';
import { isBotanicalFamilyKey } from './plantFamilies';
import { normalizeCropTags } from './cropTags';

/** Every filter cleared — the state a fresh session and the reset buttons use. */
export const EMPTY_CROP_FILTERS: PersistedCropFilters = {
  searchQuery: '',
  selectedFamilyFilter: '',
  selectedTagFilter: [],
  selectedCultivationFilter: '',
  selectedNutrientFilter: '',
  selectedSeedTypeFilter: '',
  selectedSupplierFilter: '',
  growthDaysMin: '',
  growthDaysMax: '',
  yieldMin: '',
  yieldMax: '',
  sowingMonth: '',
};

function readStoredFilters(supplierIdFromQuery: string): PersistedCropFilters {
  const raw = readWithLegacyKey(
    window.sessionStorage,
    CROP_FILTERS_STORAGE_KEY,
    LEGACY_CROP_FILTERS_STORAGE_KEY,
  );
  if (!raw) {
    return { ...EMPTY_CROP_FILTERS, selectedSupplierFilter: supplierIdFromQuery };
  }

  try {
    const parsed = JSON.parse(raw) as Omit<PersistedCropFilters, 'selectedTagFilter'> & {
      selectedTagFilter?: unknown;
    };
    // Deprecated single-tag values remain readable until old sessions expire.
    const tags = parsed.selectedTagFilter;
    const selectedTags = Array.isArray(tags)
      ? tags.filter((tag): tag is string => typeof tag === 'string')
      : (typeof tags === 'string' ? [tags] : []);
    return {
      searchQuery: parsed.searchQuery ?? '',
      // A filter stored before the plant-family list held free text, not a key.
      selectedFamilyFilter: isBotanicalFamilyKey(parsed.selectedFamilyFilter) ? parsed.selectedFamilyFilter : '',
      selectedTagFilter: normalizeCropTags(selectedTags),
      selectedCultivationFilter: parsed.selectedCultivationFilter ?? '',
      selectedNutrientFilter: parsed.selectedNutrientFilter ?? '',
      selectedSeedTypeFilter: typeof parsed.selectedSeedTypeFilter === 'string' ? parsed.selectedSeedTypeFilter : '',
      selectedSupplierFilter: supplierIdFromQuery || parsed.selectedSupplierFilter || '',
      growthDaysMin: parsed.growthDaysMin ?? '',
      growthDaysMax: parsed.growthDaysMax ?? '',
      yieldMin: parsed.yieldMin ?? '',
      yieldMax: parsed.yieldMax ?? '',
      sowingMonth: typeof parsed.sowingMonth === 'string' ? parsed.sowingMonth : '',
    };
  } catch {
    removeWithLegacyKey(
      window.sessionStorage,
      CROP_FILTERS_STORAGE_KEY,
      LEGACY_CROP_FILTERS_STORAGE_KEY,
    );
    return { ...EMPTY_CROP_FILTERS, selectedSupplierFilter: supplierIdFromQuery };
  }
}

interface PersistedCropFiltersState {
  filters: PersistedCropFilters;
  updateFilter: <K extends keyof PersistedCropFilters>(key: K, value: PersistedCropFilters[K]) => void;
  resetFilters: () => void;
}

/**
 * The crop list's filters, kept in sessionStorage so they survive navigating
 * into a crop and back.
 *
 * A `?supplierId=` in the URL preselects the supplier filter and is then
 * consumed: arriving from a supplier's page should filter the list once, not
 * pin it there for the rest of the session.
 */
export function usePersistedCropFilters(
  searchParams: URLSearchParams,
  setSearchParams: SetURLSearchParams,
): PersistedCropFiltersState {
  const [filters, setFilters] = useState<PersistedCropFilters>(
    () => readStoredFilters(searchParams.get('supplierId') ?? ''),
  );

  const updateFilter = useCallback(<K extends keyof PersistedCropFilters>(
    key: K,
    value: PersistedCropFilters[K],
  ): void => {
    setFilters((previous) => ({ ...previous, [key]: value }));
  }, []);

  const resetFilters = useCallback((): void => {
    setFilters(EMPTY_CROP_FILTERS);
  }, []);

  useEffect(() => {
    window.sessionStorage.setItem(CROP_FILTERS_STORAGE_KEY, JSON.stringify(filters));
  }, [filters]);

  useEffect(() => {
    const supplierIdFromQuery = searchParams.get('supplierId');
    if (!supplierIdFromQuery) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setFilters((previous) => (
        previous.selectedSupplierFilter === supplierIdFromQuery
          ? previous
          : { ...previous, selectedSupplierFilter: supplierIdFromQuery }
      ));

      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.delete('supplierId');
      setSearchParams(nextSearchParams, { replace: true });
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [searchParams, setSearchParams]);

  return { filters, updateFilter, resetFilters };
}
