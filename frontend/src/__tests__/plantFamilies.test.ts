import { describe, expect, it } from 'vitest';

import type { PlantFamily } from '../api/types';
import {
  buildPlantFamilyCatalog,
  buildPlantFamilyFilterOptions,
  getPlantFamilyName,
  isBotanicalFamilyKey,
  resolveEffectiveRotationBreakYears,
} from '../crops/plantFamilies';

const FAMILIES: PlantFamily[] = [
  {
    botanical_name: 'Solanaceae',
    display_name: 'Nachtschattengewächse',
    translations: { de: 'Nachtschattengewächse', en: 'Nightshade family' },
    default_rotation_break_years: 3,
  },
  {
    botanical_name: 'Brassicaceae',
    display_name: 'Kreuzblütler',
    translations: { de: 'Kreuzblütler', en: 'Cabbage family' },
    default_rotation_break_years: 4,
  },
  {
    botanical_name: 'Poaceae',
    display_name: 'Süßgräser',
    translations: { de: 'Süßgräser' },
    default_rotation_break_years: null,
  },
];

describe('plant family names', () => {
  it('uses the UI language, then English, then the server display name', () => {
    expect(getPlantFamilyName(FAMILIES[1], 'de-AT')).toBe('Kreuzblütler');
    expect(getPlantFamilyName(FAMILIES[1], 'en')).toBe('Cabbage family');
    expect(getPlantFamilyName(FAMILIES[2], 'en')).toBe('Süßgräser');
  });

  it('sorts the catalog by localized name and keeps an unknown key readable', () => {
    const catalog = buildPlantFamilyCatalog(FAMILIES, 'de');

    expect(catalog.families.map((family) => family.botanical_name)).toEqual([
      'Brassicaceae', 'Solanaceae', 'Poaceae',
    ]);
    expect(catalog.getName('Brassicaceae')).toBe('Kreuzblütler');
    expect(catalog.getName('Rosaceae')).toBe('Rosaceae');
    expect(catalog.getName(null)).toBe('');
  });

  it('builds filter options with botanical values and localized labels', () => {
    const catalog = buildPlantFamilyCatalog(FAMILIES, 'en');

    expect(buildPlantFamilyFilterOptions(['Solanaceae', 'Brassicaceae'], catalog, 'en')).toEqual([
      { value: 'Brassicaceae', label: 'Cabbage family' },
      { value: 'Solanaceae', label: 'Nightshade family' },
    ]);
  });
});

describe('resolveEffectiveRotationBreakYears', () => {
  const catalog = buildPlantFamilyCatalog(FAMILIES, 'de');

  it('prefers the own break, zero included', () => {
    expect(resolveEffectiveRotationBreakYears(6, 'Brassicaceae', catalog)).toBe(6);
    expect(resolveEffectiveRotationBreakYears(0, 'Brassicaceae', catalog)).toBe(0);
  });

  it('falls back to the family default, otherwise none', () => {
    expect(resolveEffectiveRotationBreakYears(null, 'Brassicaceae', catalog)).toBe(4);
    expect(resolveEffectiveRotationBreakYears(undefined, 'Poaceae', catalog)).toBeNull();
    expect(resolveEffectiveRotationBreakYears(null, null, catalog)).toBeNull();
  });
});

describe('isBotanicalFamilyKey', () => {
  it('accepts botanical family names only', () => {
    expect(isBotanicalFamilyKey('Brassicaceae')).toBe(true);
    expect(isBotanicalFamilyKey('Kreuzblütler')).toBe(false);
    expect(isBotanicalFamilyKey('brassicaceae')).toBe(false);
    expect(isBotanicalFamilyKey('')).toBe(false);
    expect(isBotanicalFamilyKey(undefined)).toBe(false);
  });
});
