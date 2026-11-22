import type { YieldComparisonFilterOptions, YieldComparisonFilters } from '../api/types';
import { getCropSpeciesKey, getCropSpeciesLabel } from '../crops/cropHierarchy';
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
    const species = { name: crop.culture, crop_display_name: crop.culture_label, crop_species: crop.crop_species };
    const key = getCropSpeciesKey(species);
    const name = getCropSpeciesLabel(species);
    const group = groups.get(key) ?? { key, name, cropIds: [], terms: [] };
    group.cropIds.push(crop.id);
    group.terms.push(...[crop.name, crop.culture, ...crop.search_names].map(normalizeSearchText));
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name, locale));
}
