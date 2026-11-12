import type { Crop, CropSpecies } from '../api/types';
import { fetchAllPaginated } from '../api/api';
import { buildSheetData, downloadSpreadsheet, type SpreadsheetExportFormat } from './spreadsheetExport';
import { CROP_COLUMNS } from './spreadsheetColumns';
import { emptyTimingWindow } from './timingWindows';

type TemplateT = (key: string, options?: Record<string, unknown>) => string;
type TemplateSpecies = Pick<CropSpecies, 'name' | 'display_name' | 'specific_property_profile'>;

const TEMPLATE_FILENAME_STEM = 'kulturen_vorlage';

/** Examples share the export schema; coverage tests require a value in every column. */
const buildTemplateCrops = (t: TemplateT, potatoSpecies: TemplateSpecies): Crop[] => [
  {
    name: t('import.template.speciesName'), variety: '',
    botanical_name: 'Solanum lycopersicum', crop_family: 'Solanaceae',
    nutrient_demand: 'high',
    cultivation_type: 'pre_cultivation', cultivation_types: ['pre_cultivation'],
    tags: [t('import.template.sampleTag')],
    growth_duration_days: 75, harvest_duration_days: 60, propagation_duration_days: 45,
    germination_temperature_optimal_min_c: 20, germination_temperature_optimal_max_c: 25,
    germination_temperature_min_c: 12, germination_days_min: 7, germination_days_max: 14,
    germination_temperature_requirement: 'none', germination_light_requirement: 'dark', germination_types: ['dark'],
    germination_pretreatment: t('import.template.pretreatment'),
    light_requirement: 'full_sun', water_requirement: 'high', life_cycle: 'annual', winter_hardiness: 'not_hardy',
    pests_diseases: t('import.template.pestsDiseases'),
    harvest_method: 'per_plant', expected_yield: 4,
    distance_within_row_cm: 50, row_spacing_cm: 80, sowing_depth_cm: 0.5, sowing_depth_max_cm: 1,
    thousand_kernel_weight_g: 3,
    seed_rate_pre_cultivation_value: 1, seed_rate_pre_cultivation_unit: 'seeds_per_plant',
    sowing_calculation_safety_percent_pre_cultivation: 20, sowing_calculation_safety_percent: 20,
    display_color: '#dc2626', notes: t('import.template.sampleNote'),
    timing_windows: [
      { ...emptyTimingWindow('pre_cultivation', 'decade'), start_month: 2, start_decade: 'mid', end_month: 3, end_decade: 'late' },
      { ...emptyTimingWindow('planting', 'iso_week'), start_week: 19, end_week: 22 },
    ],
  },
  {
    name: t('import.template.directSownName'), variety: t('import.template.varietyName'),
    seed_supplier: t('import.template.supplierName'),
    botanical_name: 'Daucus carota', crop_family: 'Apiaceae', seed_type: 'open_pollinated', nutrient_demand: 'medium',
    cultivation_type: 'direct_sowing', cultivation_types: ['direct_sowing'],
    growth_duration_days: 100, harvest_duration_days: 28,
    germination_temperature_requirement: 'none', germination_light_requirement: 'none', germination_types: [],
    harvest_method: 'per_sqm', expected_yield: 3.8,
    distance_within_row_cm: 4, row_spacing_cm: 25, sowing_depth_cm: 1, sowing_depth_max_cm: 1.5,
    seed_rate_direct_value: 0.7, seed_rate_direct_unit: 'g_per_m2', sowing_calculation_safety_percent_direct: 12,
    display_color: '#ea580c', notes: t('import.template.sampleNote'),
    timing_windows: [
      { ...emptyTimingWindow('direct_sowing', 'decade'), start_month: 3, start_decade: 'early', end_month: 6, end_decade: 'late' },
      { ...emptyTimingWindow('direct_sowing', 'iso_week'), start_week: 30, end_week: 30 },
    ],
  },
  {
    name: potatoSpecies.display_name || potatoSpecies.name, variety: '', botanical_name: 'Solanum tuberosum', crop_family: 'Solanaceae',
    specific_property_profile: 'solanum_tuberosum', specific_properties: { cooking_type: 'waxy', maturity_group: 'early' },
    cultivation_type: 'pre_cultivation', cultivation_types: ['pre_cultivation'],
    growth_duration_days: 90, propagation_duration_days: 56,
    germination_temperature_optimal_min_c: 18, germination_temperature_optimal_max_c: 24,
    germination_days_min: 14, germination_days_max: 28,
    germination_temperature_requirement: 'cold_stratification', germination_light_requirement: 'light', germination_types: ['cold', 'light'],
    stratification_days_min: 28, stratification_days_max: 56,
    stratification_temperature_min_c: 3, stratification_temperature_max_c: 5,
    life_cycle: 'perennial', notes: `${t('import.template.sampleNote')} ${t('import.template.potatoSeedNote')}`,
  },
] as Crop[];

export const buildCropImportTemplateRows = (t: TemplateT, species: readonly TemplateSpecies[]) => {
  const potatoSpecies = species.find(item => item.specific_property_profile === 'solanum_tuberosum');
  if (!potatoSpecies || !(potatoSpecies.display_name || potatoSpecies.name)) {
    throw new Error('The template crop species is unavailable.');
  }
  const crops = buildTemplateCrops(t, potatoSpecies);
  const rows = buildSheetData(crops, t);
  const columnIndex = (key: string) => CROP_COLUMNS.findIndex((column) => column.key === key);
  rows[1][columnIndex('pre_cultivation_windows')] = '02b-03c';
  rows[1][columnIndex('planting_windows')] = 'KW19-22';
  rows[2][columnIndex('direct_sowing_windows')] = '03a-06c; W30';
  rows[1][columnIndex('good_companions')] = t('import.template.goodNeighbours');
  rows[1][columnIndex('bad_companions')] = t('import.template.badNeighbours');
  // Show valid negative answers in deprecated flag columns without inventing
  // a frost requirement for a crop that does not have one.
  for (const [index, crop] of crops.entries()) {
    for (const kind of ['cold', 'frost', 'light', 'dark'] as const) {
      rows[index + 1][columnIndex(`germination_${kind}`)] = t(`detail.boolean.${crop.germination_types?.includes(kind) ? 'yes' : 'no'}`);
    }
  }
  return rows;
};

export const downloadCropImportTemplate = async (t: TemplateT, format: SpreadsheetExportFormat = 'ods'): Promise<void> => {
  const catalog = await fetchAllPaginated<CropSpecies>('/crop-species/');
  downloadSpreadsheet(buildCropImportTemplateRows(t, catalog.results), format, `${TEMPLATE_FILENAME_STEM}.${format}`);
};
