import i18n from '../i18n/config';
import { SUPPORTED_LANGUAGES } from '../i18n/languages';
import type { Crop, CropTimingWindow } from '../api/types';
import { emptyTimingWindow, formatTimingWindows } from '../crops/timingWindows';
import { buildSheetData } from '../crops/spreadsheetExport';
import { buildCropImportTemplateRows } from '../crops/importTemplate';
import { CROP_COLUMNS } from '../crops/spreadsheetColumns';
import { buildSpreadsheetFile, parseSpreadsheetRows } from '../crops/spreadsheetFile';
import { parseSpreadsheetFile } from '../crops/spreadsheetImport';

// Uses the real translations (unlike spreadsheetImport.test.ts, which mocks
// i18next) because the bug class is "the export writes a localized label the
// import does not know".

const csvFile = (csv: string): File => new File([csv], 'kulturen_export.csv', { type: 'text/csv' });

const TEMPLATE_SPECIES = [{ name: 'Kartoffel', specific_property_profile: 'solanum_tuberosum' }];

const ENUM_CROPS = [
  {
    name: 'Tomate',
    life_cycle: 'annual',
    germination_temperature_requirement: 'cold_stratification',
    germination_light_requirement: 'light',
    seed_type: 'open_pollinated',
    nutrient_demand: 'high',
    cultivation_types: ['pre_cultivation', 'direct_sowing'],
    harvest_method: 'per_plant',
    seed_rate_pre_cultivation_value: 1.2,
    seed_rate_pre_cultivation_unit: 'seeds_per_plant',
  },
  {
    name: 'Karotte',
    life_cycle: 'biennial',
    germination_temperature_requirement: 'frost_treatment',
    germination_light_requirement: 'dark',
    seed_type: 'f1_hybrid',
    nutrient_demand: 'medium',
    cultivation_types: ['direct_sowing'],
    harvest_method: 'per_sqm',
    seed_rate_direct_value: 0.7,
    seed_rate_direct_unit: 'g_per_m2',
  },
  {
    name: 'Erbse',
    germination_temperature_requirement: 'none',
    germination_light_requirement: 'none',
    nutrient_demand: 'low',
    seed_rate_direct_value: 30,
    seed_rate_direct_unit: 'seeds_per_lfm',
  },
  { name: 'Phacelia', seed_rate_direct_value: 2, seed_rate_direct_unit: 'g_per_lfm' },
  { name: 'Spinat', seed_rate_direct_value: 300, seed_rate_direct_unit: 'seeds_per_m2' },
  { name: 'Rhabarber', life_cycle: 'perennial', standing_time_years: 6 },
] as unknown as Crop[];

const ENUM_KEYS = [
  'life_cycle',
  'germination_temperature_requirement',
  'germination_light_requirement',
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

  describe('multi-value cells', () => {
    const multiValueCrop = {
      id: 1,
      name: 'Kohl',
      cultivation_types: ['direct_sowing', 'pre_cultivation'],
      tags: ['Kräuter', 'Blumen'],
      timing_windows: [
        { ...emptyTimingWindow('direct_sowing', 'decade'), start_month: 3, start_decade: 'mid', end_month: 4, end_decade: 'mid' },
        { ...emptyTimingWindow('direct_sowing', 'iso_week'), start_week: 20, end_week: 24 },
      ],
    } as unknown as Crop;
    const companions = {
      good: [
        { name: 'Tomate', reason: 'other' as const, note: 'Schutz vor Schädlingen' },
        { name: 'Gurke', reason: 'other' as const, note: 'Quelle 2025, S. 3' },
        { name: 'Basilikum', reason: 'other' as const, note: '' },
      ],
      bad: [
        { name: 'Kartoffel', reason: 'other' as const, note: '' },
        { name: 'Fenchel', reason: 'other' as const, note: '' },
      ],
    };
    const column = (key: string) => CROP_COLUMNS.findIndex((col) => col.key === key);

    it('separates the values of every multi-value cell with "; "', () => {
      const [, row] = buildSheetData([multiValueCrop], i18n.getFixedT('de', 'crops'), new Map([[1, companions]]), 'de');

      expect(row[column('cultivation_types')]).toBe('Direktsaat; Pflanzung');
      expect(row[column('tags')]).toBe('Kräuter; Blumen');
      expect(row[column('direct_sowing_windows')]).toBe('Mitte März bis Mitte April; KW 20 bis 24');
      expect(row[column('good_companions')]).toBe('Tomate | Schutz vor Schädlingen; Gurke | Quelle 2025, S. 3; Basilikum');
      expect(row[column('bad_companions')]).toBe('Kartoffel; Fenchel');
    });

    it.each(['csv', 'xlsx', 'ods'] as const)('reads the canonical export back unchanged from %s', async (format) => {
      await i18n.changeLanguage('de');
      const t = i18n.getFixedT('de', 'crops');
      const data = buildSpreadsheetFile(buildSheetData([multiValueCrop], t, new Map([[1, companions]]), 'de'), format);

      const result = await parseSpreadsheetFile(new File([data as BlobPart], `kulturen.${format}`));

      expect(result.warnings).toEqual([]);
      expect(result.entries[0]).toMatchObject({
        cultivation_types: ['direct_sowing', 'pre_cultivation'],
        tags: ['Kräuter', 'Blumen'],
        direct_sowing_windows: 'Mitte März bis Mitte April; KW 20 bis 24',
        good_companions: companions.good,
        bad_companions: companions.bad,
      });
    });

    it.each(['csv', 'xlsx', 'ods'] as const)('reads canonical and legacy cultivation-type separators from %s', async (format) => {
      await i18n.changeLanguage('de');
      const rows = [['Name', 'Anbauart'], ['Kohl', 'Direktsaat; Pflanzung'], ['Rübe', 'Direktsaat, Pflanzung'], ['Mais', 'Direktsaat\nPflanzung']];
      const data = buildSpreadsheetFile(rows, format);

      const result = await parseSpreadsheetFile(new File([data as BlobPart], `kulturen.${format}`));

      expect(result.warnings).toEqual([]);
      expect(result.entries.map((entry) => entry.cultivation_types)).toEqual(
        Array.from({ length: 3 }, () => ['direct_sowing', 'pre_cultivation']),
      );
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
    specific_property_profile: 'solanum_tuberosum',
    specific_properties: { cooking_type: 'waxy', maturity_group: 'early' },
    germination_temperature_requirement: 'cold_stratification',
    germination_light_requirement: 'light',
    stratification_days_min: 14,
    stratification_days_max: 28,
    stratification_temperature_min_c: -5.5,
    stratification_temperature_max_c: 5,
    germination_types: ['cold', 'frost', 'light', 'dark'],
    germination_pretreatment: 'Chill four weeks.',
    light_requirement: 'partial_shade',
    water_requirement: 'high',
    life_cycle: 'perennial',
    standing_time_years: 4,
    annual_harvest_window: '12-15/02-29',
    first_harvest_delay_years: 0,
    winter_hardiness: 'with_protection',
    pests_diseases: 'Carrot fly; cover with netting.',
    plant_health: { entries: [{ name: 'Synthetic explicit entry' }] },
    seed_type: 'f1_hybrid',
    harvest_method: 'per_plant',
    expected_yield: 4.2,
    default_harvest_unit: 'bunch',
    average_harvest_piece_weight_g: 110.5,
    average_harvest_bunch_weight_g: 200.75,
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

  // The sheet holds neighbour names only; reason and note stay in the project
  // (the import is additive) and travel in the JSON export.
  const COMPANIONS = {
    good: [
      { name: 'Basilikum', reason: 'pest_control', note: '' },
      { name: 'Tagetes', reason: 'other', note: 'lockt Schnecken ab' },
    ],
    bad: [
      { name: 'Kartoffel', reason: 'shared_pests_diseases', note: 'Kraut- und Braunfäule' },
      { name: 'Aubergine', reason: 'shared_pests_diseases', note: '' },
    ],
  } as const;
  const COMPANIONS_BY_CROP = new Map([[1, {
    good: [...COMPANIONS.good],
    bad: [...COMPANIONS.bad],
  }]]);
  const cellItems = (items: readonly { name: string; note: string }[]) => items.map(({ name, note }) => ({ name, reason: 'other', note }));

  const EXPECTED_IMPORT: Record<string, unknown> = {
    ...(FULL_CROP as unknown as Record<string, unknown>),
    light_requirement: ['partial_shade'],
    plant_health: JSON.stringify(FULL_CROP.plant_health?.entries),
    ...windowCells(i18n.getFixedT('de', 'crops')),
    supplier_name: 'Bingenheimer Saatgut',
    'specific_properties.cooking_type': 'waxy',
    'specific_properties.maturity_group': 'early',
    germination_temperature_optimal: '18–25',
    germination_days: '7–14',
    sowing_depth: '0.5–1',
    germination_cold: true, germination_frost: true, germination_light: true, germination_dark: true,
    good_companions: cellItems(COMPANIONS.good),
    bad_companions: cellItems(COMPANIONS.bad),
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

  it('uses the database display name for the typed sample and refuses a missing profile', () => {
    const t = i18n.getFixedT('fr', 'crops');
    const rows = buildCropImportTemplateRows(t, [{ ...TEMPLATE_SPECIES[0], display_name: 'Database potato label' }]);
    expect(rows[3][0]).toBe('Database potato label');
    expect(() => buildCropImportTemplateRows(t, [])).toThrow('The template crop species is unavailable.');
  });

  it.each(SUPPORTED_LANGUAGES.map(({ code }) => code))('fills every template column with a valid example and keeps ODS/XLSX identical (%s)', (language) => {
    const rows = buildCropImportTemplateRows(i18n.getFixedT(language, 'crops'), TEMPLATE_SPECIES);
    expect(rows[0]).toHaveLength(CROP_COLUMNS.length);
    for (const [index, column] of CROP_COLUMNS.entries()) {
      expect(rows.slice(1).some(row => row[index] !== null && row[index] !== undefined && row[index] !== ''), column.key).toBe(true);
    }
    const read = (format: 'ods' | 'xlsx') => {
      const data = buildSpreadsheetFile(rows, format) as Uint8Array;
      return parseSpreadsheetRows(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), format)
        .map(row => rows[0].map((_, index) => row[index] === '' ? null : row[index] ?? null));
    };
    const expected = rows.map(row => row.map(cell => cell === '' ? null : cell));
    expect(read('ods')).toEqual(expected);
    expect(read('xlsx')).toEqual(expected);
  });

  it('reports the removed header instead of accepting a timing-window cell', async () => {
    const result = await parseSpreadsheetFile(csvFile('Name,AUSSAAT   FREILAND\nTemplate crop,März bis Mai\n'));
    expect(result.entries).toEqual([{ name: 'Template crop' }]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('AUSSAAT   FREILAND');
  });

  it.each(SUPPORTED_LANGUAGES.flatMap(({ code }) => (['csv', 'ods', 'xlsx'] as const).map(format => [code, format] as const)))('imports its own %s template without warnings (%s)', async (language, format) => {
    await i18n.changeLanguage(language);
    const rows = buildCropImportTemplateRows(i18n.getFixedT(language, 'crops'), TEMPLATE_SPECIES);
    const data = buildSpreadsheetFile(rows, format);
    const result = await parseSpreadsheetFile(new File([data as BlobPart], `template.${format}`));

    expect(result.warnings).toEqual([]);
    expect(result.skippedRows).toBe(0);
    expect(result.entries).toHaveLength(4);
    expect(result.entries[0]).toMatchObject({
      nutrient_demand: 'high', cultivation_types: ['pre_cultivation'], seed_rate_pre_cultivation_unit: 'seeds_per_plant',
    });
    expect(result.entries[1]).toMatchObject({ variety: 'Nantes 2', supplier_name: expect.any(String), cultivation_types: ['direct_sowing'], seed_rate_direct_unit: 'g_per_m2' });
    expect(result.entries[0]?.good_companions).toHaveLength(2);
    expect(result.entries[0]?.bad_companions).toHaveLength(2);
    expect(result.entries[2]).toMatchObject({ germination_temperature_requirement: 'cold_stratification', stratification_days_min: 28, stratification_temperature_max_c: 5 });
    expect(result.entries[3]).toMatchObject({
      life_cycle: 'perennial', standing_time_years: 6,
      annual_harvest_window: '04-15/06-24', first_harvest_delay_years: 1,
    });
    for (const entry of result.entries) expect(entry.notes).toContain(i18n.t('crops:import.template.sampleNote'));
  });
});

describe('germination spreadsheet round trip', () => {
  it.each(SUPPORTED_LANGUAGES.flatMap(({ code }) => ['csv', 'xlsx', 'ods'].map(format => [code, format] as const)))(
    'preserves explicit health identities, escaped names and separate notes in %s %s', async (language, format) => {
      const crop = { name: 'Synthetic structured-health crop', plant_health: { entries: [
        { name: 'Name; with, delimiters and "quotes"' },
        { name: 'Official snapshot', catalogue_identity: '00000000-0000-4000-8000-000000000001' },
      ] }, pests_diseases: 'Early sowing protects against carrot fly. Repels aphids.' } as Crop;
      const data = buildSpreadsheetFile(buildSheetData([crop], i18n.getFixedT(language, 'crops')), format as 'csv' | 'xlsx' | 'ods');
      const file = new File([data as BlobPart], `synthetic-health.${format}`);
      const parsed = await parseSpreadsheetFile(file);
      expect(parsed.warnings).toEqual([]);
      expect(JSON.parse(parsed.entries[0].plant_health as string)).toEqual(crop.plant_health?.entries);
      expect(parsed.entries[0].pests_diseases).toBe(crop.pests_diseases);
    },
  );

  it('keeps a legacy free-text health header as notes with no inferred selections', async () => {
    const parsed = await parseSpreadsheetFile(csvFile('Name;Schädlinge und Krankheiten\nSynthetic;"Early sowing protects against carrot fly; repels aphids"'));
    expect(parsed.entries[0]).toEqual({ name: 'Synthetic', pests_diseases: 'Early sowing protects against carrot fly; repels aphids' });
  });

  it('accepts a historical one-choice light column', async () => {
    const parsed = await parseSpreadsheetFile(csvFile('Name;Lichtbedarf\nSynthetic;Halbschattig'));
    expect(parsed.entries[0]).toMatchObject({ light_requirement: ['partial_shade'] });
  });

  it.each(SUPPORTED_LANGUAGES.flatMap(({ code }) => (['csv', 'xlsx', 'ods'] as const).map(format => [code, format] as const)))(
    'preserves site, life cycle and plant health in %s %s', async (language, format) => {
    const original = i18n.language;
    try {
      const crop = { name: 'Site crop', light_requirement: ['partial_shade', 'shade'], water_requirement: 'low',
        life_cycle: 'perennial', winter_hardiness: 'not_hardy', pests_diseases: 'Slugs' } as Crop;
      const data = buildSpreadsheetFile(buildSheetData([crop], i18n.getFixedT(language, 'crops')), format);
      await i18n.changeLanguage('en');
      const parsed = await parseSpreadsheetFile(new File([data as BlobPart], `site.${format}`));
      expect(parsed.warnings).toEqual([]);
      expect(parsed.entries[0]).toMatchObject({
        light_requirement: ['partial_shade', 'shade'], water_requirement: 'low', life_cycle: 'perennial',
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
