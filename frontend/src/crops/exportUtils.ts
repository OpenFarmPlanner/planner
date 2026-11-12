import type { CompanionImportItem, Crop, CropTimingWindow } from '../api/types';
import { toTimingWindowPayload } from './timingWindows';
import type { CompanionItemsByKind } from './companions';
import { formatIsoDate } from '../utils/isoDate';

interface ExportEnvelopeBase {
  schemaVersion: 1;
  exportedAt: string;
}

export interface PortableCrop {
  name: string;
  variety: string;
  supplierName: string;
  seed_supplier?: string;
  notes?: string;
  botanical_name?: string;
  crop_family?: string;
  seed_type?: Crop['seed_type'];
  nutrient_demand?: Crop['nutrient_demand'];
  cultivation_type?: Crop['cultivation_type'];
  cultivation_types?: Crop['cultivation_types'];
  tags?: string[];
  growth_duration_days?: number;
  harvest_duration_days?: number;
  propagation_duration_days?: number;
  germination_temperature_optimal_min_c?: Crop['germination_temperature_optimal_min_c'];
  germination_temperature_optimal_max_c?: Crop['germination_temperature_optimal_max_c'];
  germination_temperature_min_c?: Crop['germination_temperature_min_c'];
  germination_days_min?: Crop['germination_days_min'];
  germination_days_max?: Crop['germination_days_max'];
  germination_temperature_requirement?: Crop['germination_temperature_requirement'];
  germination_light_requirement?: Crop['germination_light_requirement'];
  stratification_days_min?: Crop['stratification_days_min'];
  stratification_days_max?: Crop['stratification_days_max'];
  stratification_temperature_min_c?: Crop['stratification_temperature_min_c'];
  stratification_temperature_max_c?: Crop['stratification_temperature_max_c'];
  germination_types?: Crop['germination_types'];
  germination_pretreatment?: Crop['germination_pretreatment'];
  pests_diseases?: Crop['pests_diseases'];
  light_requirement?: Crop['light_requirement'];
  water_requirement?: Crop['water_requirement'];
  life_cycle?: Crop['life_cycle'];
  winter_hardiness?: Crop['winter_hardiness'];

  harvest_method?: Crop['harvest_method'];
  expected_yield?: number;
  distance_within_row_cm?: number;
  row_spacing_cm?: number;
  sowing_depth_cm?: number | null;
  sowing_depth_max_cm?: number | null;
  display_color?: string;
  seed_rate_value?: number | null;
  seed_rate_unit?: Crop['seed_rate_unit'];
  seed_rate_direct_value?: number | null;
  seed_rate_direct_unit?: Crop['seed_rate_direct_unit'];
  sowing_calculation_safety_percent_direct?: number | null;
  seed_rate_pre_cultivation_value?: number | null;
  seed_rate_pre_cultivation_unit?: Crop['seed_rate_pre_cultivation_unit'];
  sowing_calculation_safety_percent_pre_cultivation?: number | null;
  sowing_calculation_safety_percent?: number;
  thousand_kernel_weight_g?: number;
  package_size_g?: number;
  seeding_requirement?: number;
  seeding_requirement_type?: Crop['seeding_requirement_type'];
  /** The crop's own windows; a Sorte leaves out the kinds it inherits. */
  timing_windows?: CropTimingWindow[];
  /** Only on a Kultur (no variety); see docs/crop-companions.md. */
  good_companions?: CompanionImportItem[];
  bad_companions?: CompanionImportItem[];
}

export interface SingleCropExport extends ExportEnvelopeBase {
  type: 'crop';
  crop: PortableCrop;
}

export interface AllCropsExport extends ExportEnvelopeBase {
  type: 'crops';
  crops: PortableCrop[];
}

export const slugifyFilenamePart = (value: string): string => {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || 'unbekannt';
};

/**
 * The primary cultivation type first, so an importer that reads one value gets
 * it. Empty means "inherited" and is left out: the API rejects an empty list.
 */
const primaryFirst = (
  types: Crop['cultivation_types'],
  primary: Crop['cultivation_type'],
): Crop['cultivation_types'] => {
  if (!types?.length) return undefined;
  if (!primary || !types.includes(primary)) return types;
  return [primary, ...types.filter((type) => type !== primary)];
};

export const toPortableCrop = (crop: Crop, companions?: CompanionItemsByKind): PortableCrop => {
  const portableCrop: PortableCrop = {
    name: crop.name,
    variety: crop.variety ?? '',
    supplierName: crop.supplier?.name ?? crop.seed_supplier ?? '',
    seed_supplier: crop.seed_supplier,
    notes: crop.notes,
    botanical_name: crop.botanical_name || undefined,
    crop_family: crop.crop_family ?? undefined,
    seed_type: crop.seed_type,
    nutrient_demand: crop.nutrient_demand,
    cultivation_type: crop.cultivation_type,
    cultivation_types: primaryFirst(crop.cultivation_types, crop.cultivation_type),
    tags: crop.tags?.length ? crop.tags : undefined,
    growth_duration_days: crop.growth_duration_days,
    harvest_duration_days: crop.harvest_duration_days,
    propagation_duration_days: crop.propagation_duration_days,
    germination_temperature_optimal_min_c: crop.germination_temperature_optimal_min_c ?? undefined,
    germination_temperature_optimal_max_c: crop.germination_temperature_optimal_max_c ?? undefined,
    germination_temperature_min_c: crop.germination_temperature_min_c ?? undefined,
    germination_days_min: crop.germination_days_min ?? undefined,
    germination_days_max: crop.germination_days_max ?? undefined,
    germination_temperature_requirement: crop.germination_temperature_requirement ?? '',
    germination_light_requirement: crop.germination_light_requirement ?? '',
    stratification_days_min: crop.stratification_days_min ?? undefined,
    stratification_days_max: crop.stratification_days_max ?? undefined,
    stratification_temperature_min_c: crop.stratification_temperature_min_c ?? undefined,
    stratification_temperature_max_c: crop.stratification_temperature_max_c ?? undefined,
    germination_types: crop.germination_types ?? [],
    germination_pretreatment: crop.germination_pretreatment ?? '',
    pests_diseases: crop.pests_diseases ?? '',
    light_requirement: crop.light_requirement ?? '',
    water_requirement: crop.water_requirement ?? '',
    life_cycle: crop.life_cycle ?? '',
    winter_hardiness: crop.winter_hardiness ?? '',
    harvest_method: crop.harvest_method,
    expected_yield: crop.expected_yield,
    distance_within_row_cm: crop.distance_within_row_cm,
    row_spacing_cm: crop.row_spacing_cm,
    sowing_depth_cm: crop.sowing_depth_cm,
    sowing_depth_max_cm: crop.sowing_depth_max_cm,
    display_color: crop.display_color,
    seed_rate_value: crop.seed_rate_value,
    seed_rate_unit: crop.seed_rate_unit,
    seed_rate_direct_value: crop.seed_rate_direct_value,
    seed_rate_direct_unit: crop.seed_rate_direct_unit,
    sowing_calculation_safety_percent_direct: crop.sowing_calculation_safety_percent_direct,
    seed_rate_pre_cultivation_value: crop.seed_rate_pre_cultivation_value,
    seed_rate_pre_cultivation_unit: crop.seed_rate_pre_cultivation_unit,
    sowing_calculation_safety_percent_pre_cultivation: crop.sowing_calculation_safety_percent_pre_cultivation,
    sowing_calculation_safety_percent: crop.sowing_calculation_safety_percent,
    thousand_kernel_weight_g: crop.thousand_kernel_weight_g,
    package_size_g: crop.package_size_g,
    seeding_requirement: crop.seeding_requirement,
    seeding_requirement_type: crop.seeding_requirement_type,
    timing_windows: crop.timing_windows?.length ? crop.timing_windows.map(toTimingWindowPayload) : undefined,
    good_companions: companions?.good.length ? companions.good : undefined,
    bad_companions: companions?.bad.length ? companions.bad : undefined,
  };

  return Object.fromEntries(Object.entries(portableCrop).filter(([, value]) => value !== undefined)) as PortableCrop;
};

export const buildSingleCropExport = (
  crop: Crop,
  date = new Date(),
  companionsByCrop?: ReadonlyMap<number, CompanionItemsByKind>,
): SingleCropExport => ({
  schemaVersion: 1,
  exportedAt: formatIsoDate(date),
  type: 'crop',
  crop: toPortableCrop(crop, crop.id === undefined ? undefined : companionsByCrop?.get(crop.id)),
});

export const buildAllCropsExport = (
  crops: Crop[],
  date = new Date(),
  companionsByCrop?: ReadonlyMap<number, CompanionItemsByKind>,
): AllCropsExport => ({
  schemaVersion: 1,
  exportedAt: formatIsoDate(date),
  type: 'crops',
  crops: crops.map((crop) => toPortableCrop(crop, crop.id === undefined ? undefined : companionsByCrop?.get(crop.id))),
});

export const downloadJsonFile = (data: object, filename: string): void => {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  URL.revokeObjectURL(url);
};

export const buildSingleCropFilename = (crop: Crop, date = new Date()): string => {
  const name = slugifyFilenamePart(crop.name);
  const variety = slugifyFilenamePart(crop.variety ?? '');
  return `kultur_${name}_${variety}_${formatIsoDate(date)}.json`;
};

export const buildAllCropsFilename = (date = new Date()): string => `kulturen_export_${formatIsoDate(date)}.json`;
