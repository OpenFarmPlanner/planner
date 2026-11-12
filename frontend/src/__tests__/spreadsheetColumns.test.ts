import i18n, { loadLanguages } from '../i18n/config';
import {
  CROP_COLUMNS,
  CULTIVATION_TYPE_EXPORT,
  CULTIVATION_TYPE_IMPORT,
  NUTRIENT_DEMAND_EXPORT,
  NUTRIENT_DEMAND_IMPORT,
  SEED_RATE_UNIT_EXPORT,
  SEED_RATE_UNIT_IMPORT,
  YIELD_UNIT_EXPORT,
  YIELD_UNIT_IMPORT,
  buildHeaderToKeyMap,
  normalizeHeaderForLookup,
  getLocalizedCropColumns,
} from '../crops/spreadsheetColumns';

const ENUM_PAIRS: Array<[string, Record<string, string>, Record<string, string>]> = [
  ['nutrient demand', NUTRIENT_DEMAND_EXPORT, NUTRIENT_DEMAND_IMPORT],
  ['cultivation type', CULTIVATION_TYPE_EXPORT, CULTIVATION_TYPE_IMPORT],
  ['yield unit', YIELD_UNIT_EXPORT, YIELD_UNIT_IMPORT],
  ['seed rate unit', SEED_RATE_UNIT_EXPORT, SEED_RATE_UNIT_IMPORT],
];

describe('spreadsheet enum round trip', () => {
  // The property that matters: exporting a crop and importing the file back
  // must return the value unchanged. Adding a value to one map and forgetting
  // the other is the way that silently breaks.
  it.each(ENUM_PAIRS)('%s survives export then import', (_label, exportMap, importMap) => {
    for (const [internalValue, exported] of Object.entries(exportMap)) {
      expect(importMap[normalizeHeaderForLookup(exported)]).toBe(internalValue);
    }
  });

  it.each(ENUM_PAIRS)('%s accepts its own internal values verbatim', (_label, exportMap, importMap) => {
    // A file produced by an older export, or hand-edited with raw values.
    for (const internalValue of Object.keys(exportMap)) {
      expect(importMap[normalizeHeaderForLookup(internalValue)]).toBe(internalValue);
    }
  });

  it.each(ENUM_PAIRS)('%s import keys are all normalised already', (_label, _exportMap, importMap) => {
    // A key that does not survive normalisation can never be matched, since
    // lookups always normalise first.
    for (const key of Object.keys(importMap)) {
      expect(normalizeHeaderForLookup(key)).toBe(key);
    }
  });

  it.each(ENUM_PAIRS)('%s import values are all reachable internal values', (_label, exportMap, importMap) => {
    const internalValues = new Set(Object.keys(exportMap));
    for (const mapped of Object.values(importMap)) {
      expect(internalValues).toContain(mapped);
    }
  });
});

describe('normalizeHeaderForLookup', () => {
  it('trims, lowercases and collapses runs of whitespace', () => {
    expect(normalizeHeaderForLookup('  Direct   Sowing \t')).toBe('direct sowing');
  });

  it('is idempotent', () => {
    const once = normalizeHeaderForLookup(' Seeds / Plant ');
    expect(normalizeHeaderForLookup(once)).toBe(once);
  });
});

describe('CROP_COLUMNS', () => {
  it('has no duplicate keys', () => {
    const keys = CROP_COLUMNS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every column a header key', () => {
    for (const column of CROP_COLUMNS) {
      expect(column.headerKey).toBeTruthy();
    }
  });

  it('has no alias that collides with a different column', () => {
    const seen = new Map<string, string>();
    for (const column of CROP_COLUMNS) {
      for (const alias of [column.headerKey, ...column.aliases]) {
        const normalized = normalizeHeaderForLookup(alias);
        const owner = seen.get(normalized);
        expect(owner === undefined || owner === column.key).toBe(true);
        seen.set(normalized, column.key);
      }
    }
  });
});

describe('buildHeaderToKeyMap', () => {
  it('maps every column header key to its column', () => {
    const map = buildHeaderToKeyMap();

    for (const column of CROP_COLUMNS) {
      expect(map.get(normalizeHeaderForLookup(column.headerKey))).toBe(column.key);
    }
  });

  it('maps every alias to its column', () => {
    const map = buildHeaderToKeyMap();

    for (const column of CROP_COLUMNS) {
      for (const alias of column.aliases) {
        expect(map.get(normalizeHeaderForLookup(alias))).toBe(column.key);
      }
    }
  });

  it('matches a header however it was cased or spaced in the file', () => {
    const map = buildHeaderToKeyMap();
    const [first] = CROP_COLUMNS;

    expect(map.get(normalizeHeaderForLookup(`  ${first.headerKey.toUpperCase()}  `)))
      .toBe(first.key);
  });

  it('adds the translated headers on top of the untranslated ones', () => {
    const translated = buildHeaderToKeyMap(((key: string) => `DE ${key}`) as never);
    const [first] = CROP_COLUMNS;

    expect(translated.get(normalizeHeaderForLookup(`DE ${first.headerKey}`))).toBe(first.key);
    // The raw keys still resolve, so a file exported before a translation
    // change keeps importing.
    expect(translated.get(normalizeHeaderForLookup(first.headerKey))).toBe(first.key);
  });
});

describe('seed-catalogue column names', () => {
  it.each([
    ['Vorkultur', 'pre_cultivation_windows'],
    ['Anzuchtzeitraum', 'pre_cultivation_windows'],
    ['Start indoors', 'pre_cultivation_windows'],
    ['Semis sous abri', 'pre_cultivation_windows'],
    ['Semillero', 'pre_cultivation_windows'],
    ['Direktsaatzeitraum', 'direct_sowing_windows'],
    ['Sow outdoors', 'direct_sowing_windows'],
    ['Semis en pleine terre', 'direct_sowing_windows'],
    ['Siembra al aire libre', 'direct_sowing_windows'],
    ['Auspflanzung', 'planting_windows'],
    ['Pflanzung Freiland', 'planting_windows'],
    ['Pflanzzeitraum', 'planting_windows'],
    ['Plant out', 'planting_windows'],
    ['Repiquage', 'planting_windows'],
    ['Trasplante', 'planting_windows'],
    ['Erntezeitraum', 'harvest_duration_days'],
  ])('reads "%s" as %s', (header, key) => {
    expect(buildHeaderToKeyMap().get(normalizeHeaderForLookup(header))).toBe(key);
  });

  it('has no harvest window column', () => {
    expect(CROP_COLUMNS.map((column) => column.key)).not.toContain('harvest_windows');
  });
});


describe('localized canonical spreadsheet headers', () => {
  beforeAll(async () => { await loadLanguages(); });

  it.each(['de', 'en', 'fr', 'es'])('maps every localized header without collisions and shares form labels (%s)', language => {
    const t = i18n.getFixedT(language, 'crops');
    const columns = getLocalizedCropColumns(t);
    const headers = columns.map(column => normalizeHeaderForLookup(column.header));
    expect(new Set(headers).size).toBe(columns.length);
    const map = buildHeaderToKeyMap(t);
    for (const column of columns) expect(map.get(normalizeHeaderForLookup(column.header))).toBe(column.key);
    const header = (key: string) => columns.find(column => column.key === key)?.header;
    expect(header('expected_yield')).toBe(t('form.expectedYield'));
    expect(header('propagation_duration_days')).toBe(t('germination.fields.propagation_duration_days'));
    expect(header('sowing_calculation_safety_percent')).toBe(t('form.sowingCalculationSafetyPercentLabel'));
    for (const [suffix, method] of [['direct', 'DirectSowing'], ['pre_cultivation', 'PreCultivation']]) {
      const context = t(`form.cultivationType${method}`);
      expect(header(`seed_rate_${suffix}_value`)).toBe(`${context}: ${t('form.seedAmountLabel')}`);
      expect(header(`seed_rate_${suffix}_unit`)).toBe(`${context}: ${t('form.seedUnitLabel')}`);
      expect(header(`sowing_calculation_safety_percent_${suffix}`)).toBe(`${context}: ${t('form.sowingCalculationSafetyPercentLabel')}`);
    }
    for (const kind of ['pre_cultivation', 'direct_sowing', 'planting']) {
      expect(header(`${kind}_windows`)).toBe(t(`timingWindows.kinds.${kind}`));
    }
  });

  it('rejects the removed Aussaat Freiland header in every UI language', () => {
    const map = buildHeaderToKeyMap(...['de', 'en', 'fr', 'es'].map(language => i18n.getFixedT(language, 'crops')));
    expect(map.has(normalizeHeaderForLookup('  AUSSAAT   FREILAND  '))).toBe(false);
    expect(map.get(normalizeHeaderForLookup('Direktsaatzeitraum'))).toBe('direct_sowing_windows');
    expect(map.get(normalizeHeaderForLookup('Direct sowing window'))).toBe('direct_sowing_windows');
  });
});
