import type { Crop } from '../api/types';
import { buildSheetData, downloadSpreadsheet, type SpreadsheetExportFormat } from './spreadsheetExport';
import { CROP_COLUMNS } from './spreadsheetColumns';
import { emptyTimingWindow } from './timingWindows';

type TemplateT = (key: string, options?: Record<string, unknown>) => string;

const TEMPLATE_FILENAME_STEM = 'kulturen_vorlage';

/**
 * Example rows for the import template: a species, one of its varieties
 * (which inherits what it leaves empty) and a direct-sown crop, so every
 * column shows a value the import accepts.
 */
const buildTemplateCrops = (t: TemplateT): Crop[] => [
  {
    name: t('import.template.speciesName'),
    variety: '',
    crop_family: 'Solanaceae',
    nutrient_demand: 'high',
    cultivation_type: 'pre_cultivation',
    cultivation_types: ['pre_cultivation'],
    growth_duration_days: 75,
    harvest_duration_days: 60,
    propagation_duration_days: 45,
    harvest_method: 'per_plant',
    expected_yield: 4,
    distance_within_row_cm: 50,
    row_spacing_cm: 80,
    sowing_depth_cm: 0.5,
    thousand_kernel_weight_g: 3,
    seed_rate_pre_cultivation_value: 1,
    seed_rate_pre_cultivation_unit: 'seeds_per_plant',
    sowing_calculation_safety_percent_pre_cultivation: 20,
    display_color: '#dc2626',
    timing_windows: [
      { ...emptyTimingWindow('pre_cultivation', 'decade'), start_month: 2, start_decade: 'mid', end_month: 3, end_decade: 'late' },
      { ...emptyTimingWindow('planting', 'iso_week'), start_week: 19, end_week: 22 },
    ],
  },
  {
    name: t('import.template.speciesName'),
    variety: t('import.template.varietyName'),
    seed_supplier: t('import.template.supplierName'),
    growth_duration_days: 72,
    expected_yield: 4.5,
  },
  {
    name: t('import.template.directSownName'),
    variety: '',
    crop_family: 'Apiaceae',
    nutrient_demand: 'medium',
    cultivation_type: 'direct_sowing',
    cultivation_types: ['direct_sowing'],
    growth_duration_days: 100,
    harvest_duration_days: 28,
    harvest_method: 'per_sqm',
    expected_yield: 3.8,
    distance_within_row_cm: 4,
    row_spacing_cm: 25,
    sowing_depth_cm: 1.5,
    seed_rate_direct_value: 0.7,
    seed_rate_direct_unit: 'g_per_m2',
    sowing_calculation_safety_percent_direct: 12,
    display_color: '#ea580c',
    timing_windows: [
      { ...emptyTimingWindow('direct_sowing', 'decade'), start_month: 3, start_decade: 'early', end_month: 6, end_decade: 'late' },
      { ...emptyTimingWindow('direct_sowing', 'iso_week'), start_week: 30, end_week: 30 },
    ],
  },
] as Crop[];

export const buildCropImportTemplateRows = (t: TemplateT) => {
  const rows = buildSheetData(buildTemplateCrops(t), t);
  const columnIndex = (key: string) => CROP_COLUMNS.findIndex((column) => column.key === key);
  rows[1][columnIndex('pre_cultivation_windows')] = '02b-03c';
  rows[1][columnIndex('planting_windows')] = 'KW19-22';
  rows[3][columnIndex('direct_sowing_windows')] = '03a-06c; W30';
  return rows;
};

export const downloadCropImportTemplate = (t: TemplateT, format: SpreadsheetExportFormat = 'ods'): void => {
  downloadSpreadsheet(buildCropImportTemplateRows(t), format, `${TEMPLATE_FILENAME_STEM}.${format}`);
};
