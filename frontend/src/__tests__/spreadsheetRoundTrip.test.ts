import i18n from '../i18n/config';
import { SUPPORTED_LANGUAGES } from '../i18n/languages';
import type { Crop, CropTimingWindow } from '../api/types';
import { emptyTimingWindow, formatTimingWindows } from '../crops/timingWindows';
import { buildSheetData } from '../crops/spreadsheetExport';
import { buildCropImportTemplateRows } from '../crops/importTemplate';
import { CROP_COLUMNS } from '../crops/spreadsheetColumns';
import { buildSpreadsheetFile } from '../crops/spreadsheetFile';
import { parseSpreadsheetFile } from '../crops/spreadsheetImport';

// Uses the real translations (unlike spreadsheetImport.test.ts, which mocks
// i18next) because the bug class is "the export writes a localized label the
// import does not know".

const csvFile = (csv: string): File => new File([csv], 'kulturen_export.csv', { type: 'text/csv' });

const ENUM_CROPS = [
  {
    name: 'Tomate',
    seed_type: 'open_pollinated',
    nutrient_demand: 'high',
    cultivation_types: ['pre_cultivation', 'direct_sowing'],
    harvest_method: 'per_plant',
    seed_rate_pre_cultivation_value: 1.2,
    seed_rate_pre_cultivation_unit: 'seeds_per_plant',
  },
  {
    name: 'Karotte',
    seed_type: 'f1_hybrid',
    nutrient_demand: 'medium',
    cultivation_types: ['direct_sowing'],
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
  'seed_type',
  'nutrient_demand',
  'cultivation_types',
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

  it.each(languagePairs)('exports windows canonically in %s and reads them back while the UI is in %s', async (exportLanguage, importLanguage) => {
    const exportT = i18n.getFixedT(exportLanguage, 'crops');
    const windows = [
      { ...emptyTimingWindow('pre_cultivation', 'decade'), start_month: 2, start_decade: 'mid', end_month: 3, end_decade: 'late' },
      { ...emptyTimingWindow('direct_sowing', 'decade'), start_month: 3, start_decade: 'early', end_month: 5, end_decade: 'late' },
      { ...emptyTimingWindow('direct_sowing', 'iso_week'), start_week: 30, end_week: 30 },
      { ...emptyTimingWindow('planting', 'iso_week'), start_week: 44, end_week: 8 },
    ] as CropTimingWindow[];
    const csv = buildSpreadsheetFile(buildSheetData([{ name: 'Kohl', timing_windows: windows } as Crop], exportT), 'csv') as string;
    await i18n.changeLanguage(importLanguage);

    const result = await parseSpreadsheetFile(csvFile(csv));

    expect(result.warnings).toEqual([]);
    expect(result.entries[0]).toMatchObject({
      pre_cultivation_windows: formatTimingWindows(windows.slice(0, 1), exportT),
      direct_sowing_windows: formatTimingWindows(windows.slice(1, 3), exportT),
      planting_windows: formatTimingWindows(windows.slice(3), exportT),
    });
  });

  it("reads a user's own Latin-name column (\"Lateinische Bezeichnung\")", async () => {
    await i18n.changeLanguage('de');
    const csv = 'Name;Sorte;Lateinische Bezeichnung\nMangold;Glatter Silber;Beta vulgaris var. flavescens';

    const result = await parseSpreadsheetFile(csvFile(csv));

    expect(result.warnings).toEqual([]);
    expect(result.entries[0]).toMatchObject({ name: 'Mangold', botanical_name: 'Beta vulgaris var. flavescens' });
  });

  it('reads a "Tags" column with several tags in one cell', async () => {
    await i18n.changeLanguage('de');
    const csv = 'Name;Sorte;Tags\nKamille;Bodegold;"Kräuter, Blumen"\nRoggen;;"• Getreide\nGründünger"';

    const result = await parseSpreadsheetFile(csvFile(csv));

    expect(result.warnings).toEqual([]);
    expect(result.entries[0]).toMatchObject({ name: 'Kamille', tags: ['Kräuter', 'Blumen'] });
    // The list marker is dropped by the backend's normalization, not here.
    expect(result.entries[1]).toMatchObject({ name: 'Roggen', tags: ['• Getreide', 'Gründünger'] });
  });

  it('still reads the former "Gruppe" column as tags (deprecated alias)', async () => {
    await i18n.changeLanguage('de');

    const result = await parseSpreadsheetFile(csvFile('Name;Gruppe\nKamille;Kräuter'));

    expect(result.warnings).toEqual([]);
    expect(result.entries[0]).toMatchObject({ name: 'Kamille', tags: ['Kräuter'] });
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
      { nutrient_demand: 'high', cultivation_types: ['pre_cultivation'], harvest_method: 'per_sqm' },
      { nutrient_demand: 'medium', cultivation_types: ['direct_sowing'], harvest_method: 'per_sqm', seed_rate_direct_unit: 'g_per_m2' },
      { nutrient_demand: 'low', cultivation_types: ['direct_sowing'], seed_rate_direct_unit: 'g_per_m2' },
      {
        nutrient_demand: 'high',
        cultivation_types: ['pre_cultivation'],
        harvest_method: 'per_plant',
        seed_rate_direct_unit: 'seeds_per_plant',
        seed_rate_pre_cultivation_unit: 'seeds_per_plant',
      },
    ]);
  });

  // A crop with a value in every exported column. A column added to
  // CROP_COLUMNS without a value here fails the coverage check below, so a new
  // column cannot silently skip the round trip.
  const FULL_CROP = {
    id: 1,
    name: 'Tomate',
    variety: 'Roma',
    supplier: { id: 7, name: 'Bingenheimer Saatgut' },
    seed_supplier: 'Bingenheimer Saatgut',
    botanical_name: 'Solanum lycopersicum var. cerasiforme',
    tags: ['Gemüse', 'Mehrjährig'],
    crop_family: 'Solanaceae',
    nutrient_demand: 'high',
    cultivation_type: 'pre_cultivation',
    cultivation_types: ['pre_cultivation', 'direct_sowing'],
    growth_duration_days: 72,
    harvest_duration_days: 50,
    propagation_duration_days: 45,
    germination_temperature_optimal_min_c: 18,
    germination_temperature_optimal_max_c: 25,
    germination_temperature_min_c: 5,
    germination_days_min: 7,
    germination_days_max: 14,
    germination_types: ['cold', 'frost', 'light', 'dark'],
    germination_pretreatment: 'Chill four weeks.',
    light_requirement: 'partial_shade',
    water_requirement: 'high',
    life_cycle: 'biennial',
    winter_hardiness: 'with_protection',
    pests_diseases: 'Carrot fly; cover with netting.',
    seed_type: 'f1_hybrid',
    harvest_method: 'per_plant',
    expected_yield: 4.2,
    distance_within_row_cm: 45,
    row_spacing_cm: 70,
    sowing_depth_cm: 0.5,
    sowing_depth_max_cm: 1,
    thousand_kernel_weight_g: 3.2,
    sowing_calculation_safety_percent: 15,
    seed_rate_direct_value: 0.25,
    seed_rate_direct_unit: 'g_per_m2',
    sowing_calculation_safety_percent_direct: 10,
    seed_rate_pre_cultivation_value: 2,
    seed_rate_pre_cultivation_unit: 'seeds_per_plant',
    sowing_calculation_safety_percent_pre_cultivation: 20,
    display_color: '#d64192',
    notes: 'Stäben, ausgeizen; "Freiland", spät',
    timing_windows: [
      { ...emptyTimingWindow('pre_cultivation', 'decade'), start_month: 2, start_decade: 'mid', end_month: 3, end_decade: 'late' },
      { ...emptyTimingWindow('direct_sowing', 'decade'), start_month: 4, start_decade: 'early', end_month: 4, end_decade: 'late' },
      { ...emptyTimingWindow('planting', 'iso_week'), start_week: 19, end_week: 21 },
      { ...emptyTimingWindow('planting', 'iso_week'), start_week: 50, end_week: 2 },
    ],
  } as unknown as Crop;

  // The window columns hold the canonical text in the export's language.
  const windowCells = (t: ReturnType<typeof i18n.getFixedT>): Record<string, string> => Object.fromEntries(
    (['pre_cultivation', 'direct_sowing', 'planting'] as const).map((kind) => [
      `${kind}_windows`,
      formatTimingWindows((FULL_CROP.timing_windows ?? []).filter((window) => window.kind === kind), t),
    ]),
  );

  // Neighbours with and without a reason and a note, so the reason label is
  // read back in every language.
  const COMPANIONS = {
    good: [
      { name: 'Basilikum', reason: 'pest_control', note: '' },
      { name: 'Tagetes', reason: 'other', note: 'lockt Schnecken ab' },
    ],
    bad: [
      { name: 'Kartoffel, Aubergine', reason: 'shared_pests_diseases', note: 'Kraut- und Braunfäule' },
    ],
  } as const;
  const COMPANIONS_BY_CROP = new Map([[1, {
    good: [...COMPANIONS.good],
    bad: [...COMPANIONS.bad],
  }]]);

  const EXPECTED_IMPORT: Record<string, unknown> = {
    ...(FULL_CROP as unknown as Record<string, unknown>),
    ...windowCells(i18n.getFixedT('de', 'crops')),
    supplier_name: 'Bingenheimer Saatgut',
    germination_temperature_optimal: '18–25',
    germination_days: '7–14',
    sowing_depth: '0.5–1',
    germination_cold: true, germination_frost: true, germination_light: true, germination_dark: true,
    good_companions: COMPANIONS.good,
    // "Kartoffel, Aubergine" names two neighbours that share the reason.
    bad_companions: [
      { name: 'Kartoffel', reason: 'shared_pests_diseases', note: 'Kraut- und Braunfäule' },
      { name: 'Aubergine', reason: 'shared_pests_diseases', note: 'Kraut- und Braunfäule' },
    ],
  };

  it('has a test value for every exported column', () => {
    const missing = CROP_COLUMNS.map((column) => column.key).filter((key) => EXPECTED_IMPORT[key] === undefined);
    expect(missing).toEqual([]);
  });

  it.each(SUPPORTED_LANGUAGES.map(({ code }) => code))('reads back every column unchanged (%s)', async (language) => {
    await i18n.changeLanguage(language);
    const sheet = buildSheetData([FULL_CROP], i18n.getFixedT(language, 'crops'), COMPANIONS_BY_CROP);
    const csv = buildSpreadsheetFile(sheet, 'csv') as string;

    const result = await parseSpreadsheetFile(csvFile(csv));

    expect(result.warnings).toEqual([]);
    const [entry] = result.entries;
    const roundTripped = Object.fromEntries(CROP_COLUMNS.map(({ key }) => [key, entry?.[key]]));
    const expectedImport = { ...EXPECTED_IMPORT, ...windowCells(i18n.getFixedT(language, 'crops')) };
    const expected = Object.fromEntries(CROP_COLUMNS.map(({ key }) => [key, expectedImport[key]]));
    expect(roundTripped).toEqual(expected);
  });

  it.each(SUPPORTED_LANGUAGES.map(({ code }) => code))('imports its own template without warnings (%s)', async (language) => {
    await i18n.changeLanguage(language);
    const csv = buildSpreadsheetFile(buildCropImportTemplateRows(i18n.getFixedT(language, 'crops')), 'csv') as string;

    const result = await parseSpreadsheetFile(csvFile(csv));

    expect(result.warnings).toEqual([]);
    expect(result.skippedRows).toBe(0);
    expect(result.entries).toHaveLength(3);
    expect(result.entries[0]).toMatchObject({
      nutrient_demand: 'high', cultivation_types: ['pre_cultivation'], seed_rate_pre_cultivation_unit: 'seeds_per_plant',
    });
    expect(result.entries[1]).toMatchObject({ variety: 'Roma', supplier_name: expect.any(String) });
    expect(result.entries[2]).toMatchObject({ cultivation_types: ['direct_sowing'], seed_rate_direct_unit: 'g_per_m2' });
  });
});

describe('germination spreadsheet round trip', () => {
  it.each(['de', 'en', 'fr', 'es'])('preserves site, life cycle and plant health in %s', async (language) => {
    const original = i18n.language;
    try {
      const crop = { name: 'Site crop', light_requirement: 'shade', water_requirement: 'low',
        life_cycle: 'perennial', winter_hardiness: 'not_hardy', pests_diseases: 'Slugs' } as Crop;
      const csv = buildSpreadsheetFile(buildSheetData([crop], i18n.getFixedT(language, 'crops')), 'csv') as string;
      await i18n.changeLanguage('en');
      const parsed = await parseSpreadsheetFile(csvFile(csv));
      expect(parsed.warnings).toEqual([]);
      expect(parsed.entries[0]).toMatchObject({
        light_requirement: 'shade', water_requirement: 'low', life_cycle: 'perennial',
        winter_hardiness: 'not_hardy', pests_diseases: 'Slugs',
      });
    } finally {
      await i18n.changeLanguage(original);
    }
  });

  it.each(['de', 'en', 'fr', 'es'])('preserves numeric fields, types and pre-treatment in %s', async (language) => {
    const original = i18n.language;
    try {
      const crop = { name: 'Germination crop', germination_temperature_optimal_min_c: 18,
        germination_temperature_optimal_max_c: 25, germination_temperature_min_c: 5,
        germination_days_min: 7, germination_days_max: 14, germination_types: ['cold', 'light'],
        germination_pretreatment: 'Chill four weeks.' } as Crop;
      const csv = buildSpreadsheetFile(buildSheetData([crop], i18n.getFixedT(language, 'crops')), 'csv') as string;
      await i18n.changeLanguage('en');
      const parsed = await parseSpreadsheetFile(csvFile(csv));
      expect(parsed.warnings).toEqual([]);
      expect(parsed.entries[0]).toMatchObject(crop);
      expect(parsed.entries[0]).toMatchObject({ germination_days: '7–14', germination_temperature_optimal: '18–25', germination_cold: true, germination_light: true });
    } finally {
      await i18n.changeLanguage(original);
    }
  });

  it('recognizes catalogue range and individual requirement aliases', async () => {
    const parsed = await parseSpreadsheetFile(csvFile('Name;Keim-temperatur (°C);Keim-dauer (Tage);Mindestkeimtemperatur;Kaltkeimer;Lichtkeimer\nTest;18-25;7;5;ja;ja'));
    expect(parsed.warnings).toEqual([]);
    expect(parsed.entries[0]).toMatchObject({ germination_temperature_optimal: '18-25', germination_days: '7', germination_temperature_min_c: 5, germination_cold: true, germination_light: true });
  });
});
