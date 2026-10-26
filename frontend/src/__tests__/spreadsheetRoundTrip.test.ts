import i18n from '../i18n/config';
import { SUPPORTED_LANGUAGES } from '../i18n/languages';
import type { Crop } from '../api/types';
import { buildSheetData } from '../crops/spreadsheetExport';
import { buildSpreadsheetFile } from '../crops/spreadsheetFile';
import { parseSpreadsheetFile } from '../crops/spreadsheetImport';

// Uses the real translations (unlike spreadsheetImport.test.ts, which mocks
// i18next) because the bug class is "the export writes a localized label the
// import does not know".

const csvFile = (csv: string): File => new File([csv], 'kulturen_export.csv', { type: 'text/csv' });

const ENUM_CROPS = [
  {
    name: 'Tomate',
    nutrient_demand: 'high',
    cultivation_type: 'pre_cultivation',
    harvest_method: 'per_plant',
    seed_rate_pre_cultivation_value: 1.2,
    seed_rate_pre_cultivation_unit: 'seeds_per_plant',
  },
  {
    name: 'Karotte',
    nutrient_demand: 'medium',
    cultivation_type: 'direct_sowing',
    harvest_method: 'per_sqm',
    seed_rate_direct_value: 0.7,
    seed_rate_direct_unit: 'g_per_m2',
  },
  {
    name: 'Erbse',
    nutrient_demand: 'low',
    seed_rate_direct_value: 30,
    seed_rate_direct_unit: 'seeds_per_lfm',
  },
  { name: 'Phacelia', seed_rate_direct_value: 2, seed_rate_direct_unit: 'g_per_lfm' },
  { name: 'Spinat', seed_rate_direct_value: 300, seed_rate_direct_unit: 'seeds_per_m2' },
] as unknown as Crop[];

const ENUM_KEYS = [
  'nutrient_demand',
  'cultivation_type',
  'harvest_method',
  'seed_rate_direct_unit',
  'seed_rate_pre_cultivation_unit',
] as const;

const pickEnums = (entry: Record<string, unknown>) =>
  Object.fromEntries(ENUM_KEYS.filter((key) => key in entry).map((key) => [key, entry[key]]));

describe('crop spreadsheet export → import round trip', () => {
  const originalLanguage = i18n.language;
  afterEach(async () => {
    await i18n.changeLanguage(originalLanguage);
  });

  const languagePairs = SUPPORTED_LANGUAGES.flatMap(({ code: exportLanguage }) =>
    SUPPORTED_LANGUAGES.map(({ code: importLanguage }) => [exportLanguage, importLanguage] as const));

  it.each(languagePairs)('reads back every enum exported in %s while the UI is in %s', async (exportLanguage, importLanguage) => {
    const sheet = buildSheetData(ENUM_CROPS, i18n.getFixedT(exportLanguage, 'crops'));
    const csv = buildSpreadsheetFile(sheet, 'csv') as string;
    await i18n.changeLanguage(importLanguage);

    const result = await parseSpreadsheetFile(csvFile(csv));

    expect(result.warnings).toEqual([]);
    expect(result.entries.map(pickEnums)).toEqual(
      ENUM_CROPS.map((crop) => pickEnums(crop as unknown as Record<string, unknown>)),
    );
  });

  it('imports a German export reported by a user (enum labels with spaced slashes)', async () => {
    await i18n.changeLanguage('de');
    const csv = [
      'Name,Sorte,Nährstoffbedarf,Anbauart,Ertragseinheit,Direktsaat Menge,Direktsaat Einheit,Pflanzung Menge,Pflanzung Einheit',
      'Brokkoli,,Starkzehrer,Pflanzung,Pro m²,,,,',
      'Karotte,,Mittelzehrer,Direktsaat,Pro m²,0.7,g / m²,,',
      'Phacelia,,Schwachzehrer,Direktsaat,,1.2,g / m²,,',
      'Gurke,,Starkzehrer,Pflanzung,Pro Pflanze,2,Korn / Pflanze,1.2,Korn / Pflanze',
    ].join('\n');

    const result = await parseSpreadsheetFile(csvFile(csv));

    expect(result.entries.map(pickEnums)).toEqual([
      { nutrient_demand: 'high', cultivation_type: 'pre_cultivation', harvest_method: 'per_sqm' },
      { nutrient_demand: 'medium', cultivation_type: 'direct_sowing', harvest_method: 'per_sqm', seed_rate_direct_unit: 'g_per_m2' },
      { nutrient_demand: 'low', cultivation_type: 'direct_sowing', seed_rate_direct_unit: 'g_per_m2' },
      {
        nutrient_demand: 'high',
        cultivation_type: 'pre_cultivation',
        harvest_method: 'per_plant',
        seed_rate_direct_unit: 'seeds_per_plant',
        seed_rate_pre_cultivation_unit: 'seeds_per_plant',
      },
    ]);
  });
});
