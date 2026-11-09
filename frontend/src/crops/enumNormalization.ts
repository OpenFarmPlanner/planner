import type { Crop } from '../api/types';

const seedRateUnitMap: Record<string, Crop['seed_rate_unit']> = {
  g_per_m2: 'g_per_m2',
  'g/m²': 'g_per_m2',
  'g/m2': 'g_per_m2',
  'g per m²': 'g_per_m2',
  'g per m2': 'g_per_m2',
  'gramm pro quadratmeter': 'g_per_m2',
  'gramm pro m²': 'g_per_m2',
  'gramm pro m2': 'g_per_m2',
  'gramm je quadratmeter': 'g_per_m2',
  'gramm pro 100 quadratmeter': 'g_per_m2',
  'g pro 100 m²': 'g_per_m2',
  'g pro 100 m2': 'g_per_m2',
  g_per_lfm: 'g_per_lfm',
  'g/lfm': 'g_per_lfm',
  'g per lfm': 'g_per_lfm',
  'gramm pro laufmeter': 'g_per_lfm',
  'g per plant': 'seeds_per_plant',
  'seeds/m': 'seeds_per_lfm',
  'seeds per meter': 'seeds_per_lfm',
  'seeds per metre': 'seeds_per_lfm',
  'korn / lfm': 'seeds_per_lfm',
  seeds_per_lfm: 'seeds_per_lfm',
  seeds_per_m2: 'seeds_per_m2',
  'seeds/m²': 'seeds_per_m2',
  'seeds/m2': 'seeds_per_m2',
  'korn / m²': 'seeds_per_m2',
  'korn / m2': 'seeds_per_m2',
  seeds_per_plant: 'seeds_per_plant',
  pcs_per_plant: 'seeds_per_plant',
  'seeds per plant': 'seeds_per_plant',
  'korn / pflanze': 'seeds_per_plant',
};

export function normalizeSeedRateUnit(value: unknown): Crop['seed_rate_unit'] {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized || normalized === '-') return null;
  return seedRateUnitMap[normalized] ?? null;
}

export function normalizeHarvestMethod(value: unknown): Crop['harvest_method'] {
  if (value === null || value === undefined) return '';
  const normalized = String(value).trim().toLowerCase();
  const map: Record<string, Crop['harvest_method']> = {
    per_plant: 'per_plant',
    'per plant': 'per_plant',
    'pro pflanze': 'per_plant',
    per_sqm: 'per_sqm',
    'per sqm': 'per_sqm',
    'per m2': 'per_sqm',
    'pro m²': 'per_sqm',
  };
  return map[normalized] ?? '';
}

export function normalizeSeedType(value: unknown): Crop['seed_type'] {
  return value === 'open_pollinated' || value === 'f1_hybrid' ? value : '';
}

export function normalizeNutrientDemand(value: unknown): Crop['nutrient_demand'] {
  if (value === null || value === undefined) return '';
  const normalized = String(value).trim().toLowerCase();
  const map: Record<string, Crop['nutrient_demand']> = {
    low: 'low',
    niedrig: 'low',
    medium: 'medium',
    mittel: 'medium',
    high: 'high',
    hoch: 'high',
  };
  return map[normalized] ?? '';
}

export function normalizeCultivationType(value: unknown): Crop['cultivation_type'] {
  if (value === null || value === undefined) return '';
  const normalized = String(value).trim().toLowerCase();
  const map: Record<string, Crop['cultivation_type']> = {
    pre_cultivation: 'pre_cultivation',
    'pre cultivation': 'pre_cultivation',
    anzucht: 'pre_cultivation',
    direct_sowing: 'direct_sowing',
    'direct sowing': 'direct_sowing',
    direktsaat: 'direct_sowing',
  };
  return map[normalized] ?? '';
}

export function normalizeSeedingRequirementType(value: unknown): Crop['seeding_requirement_type'] {
  if (value === null || value === undefined) return '';
  const normalized = String(value).trim().toLowerCase();
  const map: Record<string, Crop['seeding_requirement_type']> = {
    per_sqm: 'per_sqm',
    'per sqm': 'per_sqm',
    'per m2': 'per_sqm',
    per_plant: 'per_plant',
    'per plant': 'per_plant',
    'pro pflanze': 'per_plant',
  };
  return map[normalized] ?? '';
}

export function normalizeSuggestedSeedPackages(value: unknown): Crop['seed_packages'] {
  if (!value || !Array.isArray(value)) return undefined;
  return value.map((pkg) => ({
    size_value: Math.round((Number(pkg.size_value) || 0) * 10) / 10,
    size_unit: pkg.size_unit === 'seeds' ? 'seeds' : 'g',
    evidence_text: pkg.evidence_text ?? '',
    last_seen_at: pkg.last_seen_at ?? null,
  }));
}
