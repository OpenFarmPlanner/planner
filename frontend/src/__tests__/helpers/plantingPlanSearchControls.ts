import { vi } from 'vitest';
import {
  EMPTY_PLANTING_PLAN_FILTERS,
  type PlantingPlanFilterGroup,
  type PlantingPlanFilterOptions,
  type PlantingPlanFilters,
} from '../../pages/plantingPlanSearch';
import type { PlantingPlanSearchControls } from '../../pages/usePlantingPlanSearch';

/**
 * A stand-in for `usePlantingPlanSearch`'s return value, for the components
 * that read it. The hook itself is covered by `usePlantingPlanSearch.test.tsx`;
 * these are for the search bar, the chips row and anything else handed the
 * whole controls object, which is too wide to spell out per suite.
 */
export const plantingPlanFilterOptions: PlantingPlanFilterOptions = {
  locations: [
    { value: 10, label: 'Hof' },
    { value: 20, label: 'Garten' },
  ],
  fields: [
    { value: 100, label: 'Parzelle A', locationId: 10 },
    { value: 200, label: 'Parzelle B', locationId: 20 },
  ],
  cultivationTypes: [
    { value: 'direct_sowing', label: 'Direktsaat' },
    { value: 'pre_cultivation', label: 'Pflanzung' },
  ],
  crops: [
    { value: 'Karotte', label: 'Karotte' },
    { value: 'Tomate', label: 'Tomate' },
  ],
};

/**
 * Mirrors the hook's own derivation so a fixture cannot claim a filter is
 * active while leaving its value empty.
 */
export const activePlantingPlanFilterGroups = (
  filters: PlantingPlanFilters,
): PlantingPlanFilterGroup[] => {
  const groups: PlantingPlanFilterGroup[] = [];
  if (filters.locationIds.length) groups.push('location');
  if (filters.fieldIds.length) groups.push('field');
  if (filters.cultivationTypes.length) groups.push('cultivationType');
  if (filters.cropKeys.length) groups.push('crop');
  for (const field of ['plantingDate', 'harvestStartDate', 'harvestEndDate'] as const) {
    const range = filters.monthRanges[field];
    if (range.from !== null || range.to !== null) groups.push(field);
  }
  return groups;
};

export const plantingPlanSearchControls = (
  filters: PlantingPlanFilters,
  overrides: Partial<PlantingPlanSearchControls> = {},
): PlantingPlanSearchControls => {
  const groups = activePlantingPlanFilterGroups(filters);
  return {
    query: '',
    setQuery: vi.fn(),
    clearSearch: vi.fn(),
    terms: [],
    filters,
    setFilters: vi.fn(),
    setLocationIds: vi.fn(),
    clearFilterGroup: vi.fn(),
    resetFilters: vi.fn(),
    sortKey: 'plantingDateAsc',
    setSortKey: vi.fn(),
    activeFilterGroups: groups,
    hasSearch: false,
    hasFilters: groups.length > 0,
    isActive: groups.length > 0,
    options: plantingPlanFilterOptions,
    matchById: new Map(),
    noteMatchIds: new Set(),
    totalCount: 0,
    shownCount: 0,
    searchOnlyCount: 0,
    ...overrides,
  };
};

export const plantingPlanFilters = (
  partial: Partial<PlantingPlanFilters> = {},
): PlantingPlanFilters => ({
  ...EMPTY_PLANTING_PLAN_FILTERS,
  ...partial,
  monthRanges: { ...EMPTY_PLANTING_PLAN_FILTERS.monthRanges, ...(partial.monthRanges ?? {}) },
});
