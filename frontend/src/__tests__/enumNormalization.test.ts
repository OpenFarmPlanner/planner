import {
  normalizeCultivationType,
  normalizeHarvestMethod,
  normalizeNutrientDemand,
  normalizeSeedRateUnit,
  normalizeSeedingRequirementType,
  normalizeSuggestedSeedPackages,
} from '../crops/enumNormalization';

describe('normalizeSeedRateUnit', () => {
  it('accepts the stored enum values unchanged', () => {
    for (const unit of ['g_per_m2', 'g_per_lfm', 'seeds_per_m2', 'seeds_per_lfm', 'seeds_per_plant'] as const) {
      expect(normalizeSeedRateUnit(unit)).toBe(unit);
    }
  });

  it('accepts written forms in German and English', () => {
    expect(normalizeSeedRateUnit('g/m²')).toBe('g_per_m2');
    expect(normalizeSeedRateUnit('Gramm pro Quadratmeter')).toBe('g_per_m2');
    expect(normalizeSeedRateUnit('Gramm pro Laufmeter')).toBe('g_per_lfm');
    expect(normalizeSeedRateUnit('seeds per plant')).toBe('seeds_per_plant');
    expect(normalizeSeedRateUnit('Korn / Pflanze')).toBe('seeds_per_plant');
  });

  it('ignores surrounding whitespace and case', () => {
    expect(normalizeSeedRateUnit('  G/M²  ')).toBe('g_per_m2');
  });

  it('is the only one of these that yields null rather than an empty string', () => {
    // seed_rate_unit is nullable on Crop; the other four are empty-string enums.
    expect(normalizeSeedRateUnit(null)).toBeNull();
    expect(normalizeSeedRateUnit(undefined)).toBeNull();
    expect(normalizeSeedRateUnit('')).toBeNull();
    expect(normalizeSeedRateUnit('etwas anderes')).toBeNull();
  });

  it('treats a dash as "not specified"', () => {
    // Pinned as observable behaviour. Note the explicit `=== '-'` clause in
    // the source is redundant: a dash is absent from the lookup table, so it
    // would fall through to null regardless.
    expect(normalizeSeedRateUnit('-')).toBeNull();
  });

  describe('two aliases that change the meaning of the value — see PR notes', () => {
    it('maps "g per plant" to a seed COUNT unit, because no mass-per-plant unit exists', () => {
      // There are exactly five units and none of them is g_per_plant, so a
      // mass per plant is recorded as a count per plant. Pinned as current
      // behaviour, not endorsed.
      expect(normalizeSeedRateUnit('g per plant')).toBe('seeds_per_plant');
    });

    it('maps "gramm pro 100 quadratmeter" to g/m² without dividing the value by 100', () => {
      // The unit label changes; nothing rescales the number that goes with it.
      expect(normalizeSeedRateUnit('gramm pro 100 quadratmeter')).toBe('g_per_m2');
      expect(normalizeSeedRateUnit('g pro 100 m²')).toBe('g_per_m2');
    });
  });
});

describe('the empty-string enums', () => {
  const cases = [
    ['harvest method', normalizeHarvestMethod, [['per plant', 'per_plant'], ['pro Pflanze', 'per_plant'], ['per m2', 'per_sqm']]],
    ['nutrient demand', normalizeNutrientDemand, [['low', 'low'], ['niedrig', 'low'], ['MITTEL', 'medium'], ['hoch', 'high']]],
    ['cultivation type', normalizeCultivationType, [['Anzucht', 'pre_cultivation'], ['direct sowing', 'direct_sowing'], ['Direktsaat', 'direct_sowing']]],
    ['seeding requirement type', normalizeSeedingRequirementType, [['per sqm', 'per_sqm'], ['pro Pflanze', 'per_plant']]],
  ] as const;

  it.each(cases)('%s maps its written forms', (_label, fn, pairs) => {
    for (const [input, expected] of pairs) {
      expect(fn(input)).toBe(expected);
    }
  });

  it.each(cases)('%s yields an empty string for anything it does not know', (_label, fn) => {
    expect(fn(null)).toBe('');
    expect(fn(undefined)).toBe('');
    expect(fn('')).toBe('');
    expect(fn('etwas anderes')).toBe('');
  });

  it.each(cases)('%s ignores surrounding whitespace and case', (_label, fn, pairs) => {
    const [input, expected] = pairs[0];
    expect(fn(`  ${input.toUpperCase()}  `)).toBe(expected);
  });
});

describe('normalizeSuggestedSeedPackages', () => {
  it('has nothing to normalise for a non-array', () => {
    expect(normalizeSuggestedSeedPackages(null)).toBeUndefined();
    expect(normalizeSuggestedSeedPackages(undefined)).toBeUndefined();
    expect(normalizeSuggestedSeedPackages('nope')).toBeUndefined();
    expect(normalizeSuggestedSeedPackages({})).toBeUndefined();
  });

  it('rounds the size to one decimal', () => {
    expect(normalizeSuggestedSeedPackages([{ size_value: 1.26 }])?.[0].size_value).toBe(1.3);
    expect(normalizeSuggestedSeedPackages([{ size_value: '2.44' }])?.[0].size_value).toBe(2.4);
  });

  it('falls back to zero for a size it cannot read', () => {
    expect(normalizeSuggestedSeedPackages([{ size_value: 'viele' }])?.[0].size_value).toBe(0);
    expect(normalizeSuggestedSeedPackages([{}])?.[0].size_value).toBe(0);
  });

  it('allows only seeds or grams, defaulting to grams', () => {
    expect(normalizeSuggestedSeedPackages([{ size_unit: 'seeds' }])?.[0].size_unit).toBe('seeds');
    expect(normalizeSuggestedSeedPackages([{ size_unit: 'g' }])?.[0].size_unit).toBe('g');
    expect(normalizeSuggestedSeedPackages([{ size_unit: 'kg' }])?.[0].size_unit).toBe('g');
    expect(normalizeSuggestedSeedPackages([{}])?.[0].size_unit).toBe('g');
  });

  it('keeps the evidence and last-seen fields, with defaults', () => {
    const [withValues] = normalizeSuggestedSeedPackages([
      { size_value: 1, evidence_text: 'Katalog 2026', last_seen_at: '2026-01-01' },
    ])!;
    expect(withValues.evidence_text).toBe('Katalog 2026');
    expect(withValues.last_seen_at).toBe('2026-01-01');

    const [withDefaults] = normalizeSuggestedSeedPackages([{ size_value: 1 }])!;
    expect(withDefaults.evidence_text).toBe('');
    expect(withDefaults.last_seen_at).toBeNull();
  });

  it('normalises every entry, not just the first', () => {
    const result = normalizeSuggestedSeedPackages([
      { size_value: 1.26, size_unit: 'kg' },
      { size_value: 'viele', size_unit: 'seeds' },
    ])!;

    expect(result.map((p) => [p.size_value, p.size_unit])).toEqual([[1.3, 'g'], [0, 'seeds']]);
  });
});
