import type { YieldComparisonFilterOptions, YieldComparisonFilters } from '../api/types';
import { normalizeSearchText } from '../search/searchText';

export const DEFAULT_YIELD_COMPARISON_FILTERS: YieldComparisonFilters = {
  cropKeys: [],
  locationId: null,
  fieldId: null,
  bedId: null,
  varietyId: null,
  seasonWindow: '3',
};

export interface YieldComparisonCropGroup {
  key: string;
  name: string;
  cropIds: number[];
  terms: string[];
}

export function groupYieldComparisonCrops(crops: YieldComparisonFilterOptions['crops'], locale: string) {
  const groups = new Map<string, YieldComparisonCropGroup>();
  for (const crop of crops) {
    const key = normalizeSearchText(crop.culture.trim());
    const group = groups.get(key) ?? { key, name: crop.culture_label || crop.culture, cropIds: [], terms: [] };
    group.cropIds.push(crop.id);
    group.terms.push(...[crop.name, crop.culture, ...crop.search_names].map(normalizeSearchText));
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name, locale));
}
