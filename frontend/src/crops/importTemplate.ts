import type { Crop } from '../api/types';
import { buildSheetData, downloadSpreadsheet } from './spreadsheetExport';

type TemplateT = (key: string) => string;

const TEMPLATE_FILENAME = 'kulturen_vorlage.xlsx';

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
    notes: t('import.template.speciesNotes'),
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
  },
] as Crop[];

export const buildCropImportTemplateRows = (t: TemplateT) => buildSheetData(buildTemplateCrops(t), t);

export const downloadCropImportTemplate = (t: TemplateT): void => {
  downloadSpreadsheet(buildCropImportTemplateRows(t), 'xlsx', TEMPLATE_FILENAME);
};
