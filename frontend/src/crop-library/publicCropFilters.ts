import type { PlantHealthSelection, PlantHealthSelections, PublicCrop } from '../api/types';
import { matchesSeedTypeFilter } from '../crops/seedType';
import { getCropSpeciesKey } from '../crops/cropHierarchy';
import { matchesPlantHealthFilter, normalizePlantHealthSelections } from '../crops/plantHealth';

export interface PublicCropFilterState {
  cropFamily: string;
  cultivationType: string;
  nutrientDemand: string;
  variety: string;
  seedType: string;
  growthDaysMin: string;
  growthDaysMax: string;
  yieldMin: string;
  yieldMax: string;
  plantHealth: PlantHealthSelection[];
}

export const EMPTY_PUBLIC_CROP_FILTERS: PublicCropFilterState = {
  cropFamily: '',
  cultivationType: '',
  nutrientDemand: '',
  variety: '',
  seedType: '',
  growthDaysMin: '',
  growthDaysMax: '',
  yieldMin: '',
  yieldMax: '',
  plantHealth: [],
};

export function countActivePublicCropFilters(filters: PublicCropFilterState): number {
  return Object.values(filters).filter(value => Array.isArray(value) ? value.length > 0 : Boolean(value)).length;
}

export interface PublicCropFilterOptions {
  cropFamilyOptions: string[];
  varietyOptions: string[];
  nutrientOptions: string[];
  plantHealthOptions: PlantHealthSelection[];
  plantHealthValues: ReadonlyMap<number, PlantHealthSelections | null>;
}

export function getPublicCropFilterOptions(crops: readonly PublicCrop[]): PublicCropFilterOptions {
  const general = new Map<string, PublicCrop>();
  for (const crop of crops) {
    const key = getCropSpeciesKey(crop);
    if (!(crop.variety || '').trim() && !general.has(key)) general.set(key, crop);
  }
  const plantHealthValues = new Map(crops.map(crop => [crop.id,
    crop.plant_health ?? ((crop.variety || '').trim() ? general.get(getCropSpeciesKey(crop))?.plant_health : null) ?? null,
  ]));
  return {
    plantHealthValues,
    plantHealthOptions: normalizePlantHealthSelections([...plantHealthValues.values()]
      .flatMap(value => value?.entries ?? []).filter(entry => entry.catalogue_identity)),
    cropFamilyOptions: Array.from(new Set(crops.map((entry) => entry.crop_family?.trim()).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)),
    varietyOptions: Array.from(new Set(crops.map((entry) => entry.variety?.trim()).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b)),
    nutrientOptions: Array.from(new Set(crops.map((entry) => entry.nutrient_demand || '').filter(Boolean))).sort((a, b) => a.localeCompare(b)),
  };
}

/** Whether a single public crop entry matches the given attribute filters (text search is handled separately by each caller). */
export function matchesPublicCropFilters(crop: PublicCrop, filters: PublicCropFilterState,
  plantHealthValues?: ReadonlyMap<number, PlantHealthSelections | null>): boolean {
  const parsedGrowthDaysMin = filters.growthDaysMin ? Number(filters.growthDaysMin) : null;
  const parsedGrowthDaysMax = filters.growthDaysMax ? Number(filters.growthDaysMax) : null;
  const parsedYieldMin = filters.yieldMin ? Number(filters.yieldMin) : null;
  const parsedYieldMax = filters.yieldMax ? Number(filters.yieldMax) : null;

  const familyMatches = !filters.cropFamily || (crop.crop_family || '') === filters.cropFamily;
  const varietyMatches = !filters.variety || (crop.variety || '') === filters.variety;
  const nutrientMatches = !filters.nutrientDemand || (crop.nutrient_demand || '') === filters.nutrientDemand;

  const cultivationValues = crop.cultivation_types && crop.cultivation_types.length > 0
    ? crop.cultivation_types
    : (crop.cultivation_type ? [crop.cultivation_type] : []);
  const cultivationMatches = (
    !filters.cultivationType
    || (filters.cultivationType === 'both'
      ? cultivationValues.includes('direct_sowing') && cultivationValues.includes('pre_cultivation')
      : cultivationValues.includes(filters.cultivationType as 'direct_sowing' | 'pre_cultivation'))
  );

  const growthValue = typeof crop.growth_duration_days === 'number' ? crop.growth_duration_days : null;
  const growthMatches = (
    (parsedGrowthDaysMin === null || (growthValue !== null && growthValue >= parsedGrowthDaysMin))
    && (parsedGrowthDaysMax === null || (growthValue !== null && growthValue <= parsedGrowthDaysMax))
  );

  const yieldValue = typeof crop.expected_yield === 'number' ? crop.expected_yield : null;
  const yieldMatches = (
    (parsedYieldMin === null || (yieldValue !== null && yieldValue >= parsedYieldMin))
    && (parsedYieldMax === null || (yieldValue !== null && yieldValue <= parsedYieldMax))
  );

  const seedTypeMatches = matchesSeedTypeFilter(crop, filters.seedType);

  const healthMatches = matchesPlantHealthFilter(plantHealthValues?.get(crop.id) ?? crop.plant_health, filters.plantHealth ?? []);
  return familyMatches && varietyMatches && seedTypeMatches && nutrientMatches && cultivationMatches && growthMatches && yieldMatches && healthMatches;
}
