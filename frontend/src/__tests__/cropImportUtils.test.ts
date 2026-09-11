import { describe, expect, it } from 'vitest';
import { normalizeImportCropEntry, parseCropImportJson } from '../crops/importUtils';

describe('crop import utils', () => {
  it('parses new single-crop export envelope and maps supplierName', () => {
    const parsed = parseCropImportJson(JSON.stringify({
      schemaVersion: 1,
      exportedAt: '2026-02-24',
      type: 'crop',
      crop: {
        name: 'Tomate',
        variety: 'Roma',
        supplierName: 'Bingenheimer',
        growth_duration_days: 80,
        harvest_duration_days: 20,
      },
    }));

    expect(parsed.originalCount).toBe(1);
    expect(parsed.entries[0]).toMatchObject({
      name: 'Tomate',
      variety: 'Roma',
      supplier_name: 'Bingenheimer',
    });
    expect(parsed.entries[0]).not.toHaveProperty('supplierName');
  });

  it('supports legacy array format and converts meter fields to centimeters', () => {
    const entry = normalizeImportCropEntry({
      name: 'Bohne',
      variety: 'Faraday',
      seed_supplier: 'ReinSaat',
      distance_within_row_m: 0.3,
      row_spacing_m: 0.4,
      sowing_depth_m: 0.005,
    });

    expect(entry).toMatchObject({
      supplier_name: 'ReinSaat',
      distance_within_row_cm: 30,
      row_spacing_cm: 40,
      sowing_depth_cm: 0.5,
    });
    expect(entry).not.toHaveProperty('distance_within_row_m');
    expect(entry).not.toHaveProperty('row_spacing_m');
    expect(entry).not.toHaveProperty('sowing_depth_m');
  });
});

describe('normalizeImportCropEntry — supplier name', () => {
  it('prefers the camelCase export field over the snake_case one', () => {
    // `supplierName` is what the app's own export writes.
    expect(normalizeImportCropEntry({
      supplierName: 'Bingenheimer', supplier_name: 'Sativa',
    })).toMatchObject({ supplier_name: 'Bingenheimer' });
  });

  it('falls back to seed_supplier when no supplier name is given', () => {
    // Hand-built files and older exports use the model's own field name.
    expect(normalizeImportCropEntry({ seed_supplier: 'Sativa' }))
      .toMatchObject({ supplier_name: 'Sativa' });
  });

  it('keeps an existing supplier_name over seed_supplier', () => {
    expect(normalizeImportCropEntry({
      supplier_name: 'Bingenheimer', seed_supplier: 'Sativa',
    })).toMatchObject({ supplier_name: 'Bingenheimer' });
  });

  it('treats a blank supplier name as absent', () => {
    for (const blank of ['', '   ']) {
      expect(normalizeImportCropEntry({ supplier_name: blank, seed_supplier: 'Sativa' }))
        .toMatchObject({ supplier_name: 'Sativa' });
    }
  });

  it.each([
    ['a blank string', '  '],
    ['an empty string', ''],
    ['a number', 42],
    ['null', null],
  ])('ignores a camelCase supplier name that is %s', (_label, value) => {
    // Asserted without a seed_supplier to fall back on: with one present, the
    // fallback's own blank/type check would produce the same answer whether or
    // not this guard exists, so the two would mask each other.
    expect(normalizeImportCropEntry({ supplierName: value }))
      .not.toHaveProperty('supplier_name');
  });

  it('still falls back to seed_supplier when the camelCase name is unusable', () => {
    expect(normalizeImportCropEntry({ supplierName: '  ', seed_supplier: 'Sativa' }))
      .toMatchObject({ supplier_name: 'Sativa' });
    expect(normalizeImportCropEntry({ supplierName: 42, seed_supplier: 'Sativa' }))
      .toMatchObject({ supplier_name: 'Sativa' });
  });

  it('leaves seed_supplier in place, since the backend reads it too', () => {
    expect(normalizeImportCropEntry({ seed_supplier: 'Sativa' }))
      .toHaveProperty('seed_supplier', 'Sativa');
  });

  it('always drops the camelCase spelling', () => {
    expect(normalizeImportCropEntry({ supplierName: 'Bingenheimer' }))
      .not.toHaveProperty('supplierName');
  });
});

describe('normalizeImportCropEntry — metre to centimetre conversion', () => {
  it.each([
    ['distance_within_row', 0.3, 30],
    ['row_spacing', 0.45, 45],
    ['sowing_depth', 0.02, 2],
  ])('converts %s from metres to centimetres', (field, metres, centimetres) => {
    const result = normalizeImportCropEntry({ [`${field}_m`]: metres });
    expect(result[`${field}_cm`]).toBeCloseTo(centimetres, 6);
    // The metre field is the app's internal SI storage; leaving it alongside
    // the centimetre one would give the importer two sources of truth.
    expect(result).not.toHaveProperty(`${field}_m`);
  });

  it.each(['distance_within_row', 'row_spacing', 'sowing_depth'])(
    'keeps a %s centimetre value the file already carried',
    (field) => {
      // Each dimension has its own `=== undefined` guard, so all three need
      // covering — one alone leaves the other two free to overwrite.
      const result = normalizeImportCropEntry({
        [`${field}_cm`]: 50, [`${field}_m`]: 0.3,
      });
      expect(result[`${field}_cm`]).toBe(50);
    },
  );

  it('converts zero rather than treating it as missing', () => {
    // `undefined` is the "not given" marker here, so 0 has to survive.
    expect(normalizeImportCropEntry({ sowing_depth_m: 0 }))
      .toMatchObject({ sowing_depth_cm: 0 });
  });

  it.each([
    ['distance_within_row', 'a string', '0.3'],
    ['distance_within_row', 'null', null],
    ['row_spacing', 'a string', '0.3'],
    ['row_spacing', 'NaN', Number.NaN],
    ['sowing_depth', 'null', null],
    ['sowing_depth', 'NaN', Number.NaN],
  ])('does not invent a %s centimetre value from %s', (field, _label, value) => {
    // `not.toHaveProperty` is the point: writing the key with an undefined
    // value would still hand the importer a field it has to reason about.
    const result = normalizeImportCropEntry({ [`${field}_m`]: value });
    expect(result).not.toHaveProperty(`${field}_cm`);
  });

  it('drops the metre field even when it could not be converted', () => {
    expect(normalizeImportCropEntry({ row_spacing_m: 'nonsense' }))
      .not.toHaveProperty('row_spacing_m');
  });

  it('converts each dimension independently', () => {
    expect(normalizeImportCropEntry({
      distance_within_row_m: 0.3, row_spacing_m: 0.45, sowing_depth_m: 0.02,
    })).toMatchObject({
      distance_within_row_cm: 30, row_spacing_cm: 45, sowing_depth_cm: 2,
    });
  });
});

describe('normalizeImportCropEntry — envelope metadata', () => {
  it.each(['schemaVersion', 'exportedAt', 'type'])('drops %s', (field) => {
    // These describe the file, not the crop; sending them on would be rejected
    // by the API as unknown fields.
    expect(normalizeImportCropEntry({ name: 'Tomate', [field]: 'x' }))
      .not.toHaveProperty(field);
  });

  it('keeps every field it has no rule for', () => {
    expect(normalizeImportCropEntry({ name: 'Tomate', notes: 'Notiz', custom: 1 }))
      .toMatchObject({ name: 'Tomate', notes: 'Notiz', custom: 1 });
  });

  it('does not modify the entry the caller passed in', () => {
    const entry = { supplierName: 'Bingenheimer', row_spacing_m: 0.45 };
    normalizeImportCropEntry(entry);
    expect(entry).toEqual({ supplierName: 'Bingenheimer', row_spacing_m: 0.45 });
  });
});

describe('parseCropImportJson — accepted shapes', () => {
  it('accepts a bare array', () => {
    expect(parseCropImportJson('[{"name":"Tomate"}]').entries).toHaveLength(1);
  });

  it('accepts the multi-crop envelope', () => {
    const parsed = parseCropImportJson(JSON.stringify({
      type: 'crops', crops: [{ name: 'Tomate' }, { name: 'Bohne' }],
    }));
    expect(parsed.originalCount).toBe(2);
  });

  it('accepts an empty array as an empty import rather than an error', () => {
    expect(parseCropImportJson('[]')).toEqual({ entries: [], originalCount: 0 });
  });

  it('recovers from a trailing comma, which hand-edited files often carry', () => {
    expect(parseCropImportJson('[{"name":"Tomate"},]').entries).toHaveLength(1);
  });

  it('recovers from a trailing comma inside an object too', () => {
    expect(parseCropImportJson('[{"name":"Tomate",}]').entries).toHaveLength(1);
  });

  it('counts every item in the file, not only the usable ones', () => {
    // The preview tells the user how many rows were skipped, which needs the
    // original count rather than the filtered one.
    const parsed = parseCropImportJson('[{"name":"Tomate"}, 5, null, "text"]');
    expect(parsed.originalCount).toBe(4);
    expect(parsed.entries).toHaveLength(1);
  });

  it('treats a nested array item as an entry, since arrays are objects', () => {
    // `isRecord` only excludes null and non-objects, so an array slips through
    // and is normalized as if it were a crop. Recorded as current behaviour;
    // the resulting row has no name and is rejected downstream.
    const parsed = parseCropImportJson('[[]]');
    expect(parsed.entries).toHaveLength(1);
  });
});

describe('parseCropImportJson — rejected shapes', () => {
  it.each([
    ['an object with no recognised envelope', '{"name":"Tomate"}'],
    ['a crop envelope whose crop is not an object', '{"type":"crop","crop":"Tomate"}'],
    ['a crop object with no type declared', '{"crop":{"name":"Tomate"}}'],
    ['a crops array with no type declared', '{"crops":[{"name":"Tomate"}]}'],
    ['a crops envelope whose crops is not an array', '{"type":"crops","crops":{}}'],
    ['an envelope with an unknown type', '{"type":"seeds","crops":[]}'],
    ['a bare number', '5'],
    ['a bare string', '"Tomate"'],
    ['null', 'null'],
  ])('rejects %s', (_label, json) => {
    expect(() => parseCropImportJson(json)).toThrow('not_array');
  });

  it('throws a parse error, not not_array, for text that is not JSON', () => {
    // The two are distinguished upstream to give different guidance, so they
    // must not collapse into one.
    expect(() => parseCropImportJson('not json at all')).not.toThrow('not_array');
    expect(() => parseCropImportJson('not json at all')).toThrow();
  });

  it('throws for an empty file', () => {
    expect(() => parseCropImportJson('')).toThrow();
  });
});
