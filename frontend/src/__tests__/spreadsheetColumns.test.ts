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
