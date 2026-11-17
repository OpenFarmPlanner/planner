import type { Crop, PlantHealthSelection, PlantHealthSelections } from '../api/types';
import type { PlantHealthEntry } from '../crop-library/plant-health/types';

const cleanName = (name: string) => name.replace(/\s+/g, ' ').trim();
const localKey = (name: string) => cleanName(name).toLowerCase().replace(/ß/g, 'ss');

export function plantHealthKey(entry: PlantHealthSelection | string): string {
  if (typeof entry === 'string') return `local:${localKey(entry)}`;
  return entry.catalogue_identity ? `catalogue:${entry.catalogue_identity}` : `local:${localKey(entry.name)}`;
}

export function plantHealthDisplayName(entry: PlantHealthSelection, selected: readonly PlantHealthSelection[], catalogue: ReadonlyMap<string, PlantHealthEntry>): string {
  const official = entry.catalogue_identity ? catalogue.get(entry.catalogue_identity) : undefined;
  const display = official?.display_name ?? entry.name;
  const ambiguous = entry.catalogue_identity && selected.some(other => other.catalogue_identity
    && other.catalogue_identity !== entry.catalogue_identity
    && (catalogue.get(other.catalogue_identity)?.display_name ?? other.name) === display);
  const detail = ambiguous ? official?.scientific_name || official?.name : undefined;
  return detail && detail !== display ? `${display} · ${detail}` : display;
}

/** A typed name remains local even when it equals an official display name. */
export function normalizePlantHealthSelections(
  values: readonly (PlantHealthSelection | string)[], known: readonly PlantHealthSelection[] = [],
): PlantHealthSelection[] {
  const spellings = new Map(known.filter(entry => !entry.catalogue_identity).map(entry => [localKey(entry.name), entry.name]));
  const unique = new Map<string, PlantHealthSelection>();
  for (const value of values) {
    const entry = typeof value === 'string' ? { name: value } : value;
    const name = cleanName(entry.name);
    if (!name) continue;
    const normalized = entry.catalogue_identity
      ? { name, catalogue_identity: entry.catalogue_identity }
      : { name: spellings.get(localKey(name)) ?? name };
    const key = plantHealthKey(normalized);
    if (!unique.has(key)) unique.set(key, normalized);
  }
  return [...unique.values()];
}

/** Same project crop collection as the ordinary private tag picker. */
export function collectLocalPlantHealth(crops: readonly Partial<Crop>[]): PlantHealthSelection[] {
  return normalizePlantHealthSelections(crops.flatMap(crop => crop.plant_health?.entries ?? [])
    .filter(entry => !entry.catalogue_identity)).sort((a, b) => a.name.localeCompare(b.name));
}

export function officialPlantHealth(value: PlantHealthSelections | null | undefined): PlantHealthSelections | null {
  if (value == null) return null;
  const entries = value.entries.filter(entry => entry.catalogue_identity);
  return { entries };
}

export function samePlantHealthIdentities(left: PlantHealthSelections | null | undefined, right: PlantHealthSelections | null | undefined): boolean {
  if (left == null || right == null) return left == null && right == null;
  const identities = (value: typeof left) => [...new Set(value?.entries.flatMap(entry => entry.catalogue_identity ? [entry.catalogue_identity] : []) ?? [])].sort().join(',');
  return identities(left) === identities(right);
}

export function mergeOfficialPlantHealth(local: PlantHealthSelections | null | undefined, incoming: PlantHealthSelections | null | undefined): PlantHealthSelections | null {
  const privateEntries = local?.entries.filter(entry => !entry.catalogue_identity) ?? [];
  if (incoming == null && !privateEntries.length) return null;
  return { entries: normalizePlantHealthSelections([
    ...privateEntries,
    ...(officialPlantHealth(incoming)?.entries ?? []),
  ]) };
}

/** Every chosen identity or exact project-local name must occur in the effective selection. */
export function matchesPlantHealthFilter(value: PlantHealthSelections | null | undefined, selected: readonly PlantHealthSelection[]): boolean {
  const keys = new Set(value?.entries.map(plantHealthKey) ?? []);
  return selected.every(entry => keys.has(plantHealthKey(entry)));
}

export function readPlantHealthFilter(value: unknown): PlantHealthSelection[] {
  if (!Array.isArray(value)) return [];
  const valid = value.filter((entry): entry is PlantHealthSelection => {
    if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 200) return false;
    return entry.catalogue_identity === undefined || (typeof entry.catalogue_identity === 'string'
      && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(entry.catalogue_identity));
  });
  return normalizePlantHealthSelections(valid.map(entry => ({ name: entry.name,
    ...(entry.catalogue_identity ? { catalogue_identity: entry.catalogue_identity.toLowerCase() } : {}),
  })));
}
