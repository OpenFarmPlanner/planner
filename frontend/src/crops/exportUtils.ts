import type { Crop } from '../api/types';
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
  nutrient_demand?: Crop['nutrient_demand'];
  cultivation_type?: Crop['cultivation_type'];
  cultivation_types?: Crop['cultivation_types'];
  growth_duration_days?: number;
  harvest_duration_days?: number;
  propagation_duration_days?: number;
  harvest_method?: Crop['harvest_method'];
  expected_yield?: number;
  distance_within_row_cm?: number;
  row_spacing_cm?: number;
  sowing_depth_cm?: number;
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

export const toPortableCrop = (crop: Crop): PortableCrop => {
  const portableCrop: PortableCrop = {
    name: crop.name,
    variety: crop.variety ?? '',
    supplierName: crop.supplier?.name ?? crop.seed_supplier ?? '',
    seed_supplier: crop.seed_supplier,
    notes: crop.notes,
    botanical_name: crop.botanical_name || undefined,
    crop_family: crop.crop_family ?? undefined,
    nutrient_demand: crop.nutrient_demand,
    cultivation_type: crop.cultivation_type,
    cultivation_types: primaryFirst(crop.cultivation_types, crop.cultivation_type),
    growth_duration_days: crop.growth_duration_days,
    harvest_duration_days: crop.harvest_duration_days,
    propagation_duration_days: crop.propagation_duration_days,
    harvest_method: crop.harvest_method,
    expected_yield: crop.expected_yield,
    distance_within_row_cm: crop.distance_within_row_cm,
    row_spacing_cm: crop.row_spacing_cm,
    sowing_depth_cm: crop.sowing_depth_cm,
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
  };

  return Object.fromEntries(Object.entries(portableCrop).filter(([, value]) => value !== undefined)) as PortableCrop;
};

export const buildSingleCropExport = (crop: Crop, date = new Date()): SingleCropExport => ({
  schemaVersion: 1,
  exportedAt: formatIsoDate(date),
  type: 'crop',
  crop: toPortableCrop(crop),
});

export const buildAllCropsExport = (crops: Crop[], date = new Date()): AllCropsExport => ({
  schemaVersion: 1,
  exportedAt: formatIsoDate(date),
  type: 'crops',
  crops: crops.map(toPortableCrop),
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
