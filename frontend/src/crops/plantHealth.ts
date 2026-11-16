import type { Crop, PlantHealthSelection, PlantHealthSelections } from '../api/types';

const cleanName = (name: string) => name.replace(/\s+/g, ' ').trim();
const localKey = (name: string) => cleanName(name).toLowerCase().replace(/ß/g, 'ss');

export function plantHealthKey(entry: PlantHealthSelection | string): string {
  if (typeof entry === 'string') return `local:${localKey(entry)}`;
  return entry.catalogue_identity ? `catalogue:${entry.catalogue_identity}` : `local:${localKey(entry.name)}`;
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
