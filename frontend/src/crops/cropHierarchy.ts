import type { Crop, PublicCrop } from '../api/types';

export type CropHierarchyItemKind = 'species' | 'variety';

export interface CropHierarchySource {
  id?: number;
  name: string;
  variety?: string | null;
  crop_species?: number | null;
  crop_species_name?: string | null;
  display_name?: string | null;
  crop_display_name?: string | null;
}

export interface CropHierarchyItem<TCrop extends CropHierarchySource> {
  id: string;
  parentId: string | null;
  kind: CropHierarchyItemKind;
  label: string;
  secondary: string;
  crop: TCrop | null;
  hasGeneralEntry: boolean;
  speciesKey: string;
  varietyCount: number;
}

const normalizeKey = (value: string | undefined | null): string => (
  (value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('de')
);

export const getCropSpeciesLabel = (crop: CropHierarchySource): string => (
  crop.crop_display_name
  || crop.display_name
  || crop.crop_species_name
  || crop.name
);

export const getCropSpeciesKey = (crop: CropHierarchySource): string => (
  crop.crop_species ? `species:${crop.crop_species}` : `name:${normalizeKey(getCropSpeciesLabel(crop))}`
);

export function buildCropHierarchy<TCrop extends CropHierarchySource>(
  crops: readonly TCrop[],
): CropHierarchyItem<TCrop>[] {
  const groups = new Map<string, TCrop[]>();

  crops.forEach((crop) => {
    const key = getCropSpeciesKey(crop);
    const group = groups.get(key);
    if (group) {
      group.push(crop);
    } else {
      groups.set(key, [crop]);
    }
  });

  return Array.from(groups.entries())
    .flatMap(([speciesKey, group]) => {
      const speciesCrop = group.find((crop) => !(crop.variety || '').trim()) ?? null;
      const speciesId = `species:${speciesKey}`;
      // Label falls back to group[0] purely for display text — but the node's `crop`
      // (its selection/edit identity) must stay null when there's no dedicated
      // general entry, or group[0] ends up rendered twice: once as a fake species
      // entry and once as its own variety row. Row rendering already treats
      // `crop: null` as "nothing to select here" (disabled={!crop}).
      const speciesLabel = getCropSpeciesLabel(speciesCrop ?? group[0]);
      const varietyCrops = group.filter((crop) => Boolean(crop.variety?.trim()));
      const extraGeneralCrops = group.filter((crop) => crop !== speciesCrop && !crop.variety?.trim());
      const speciesNode: CropHierarchyItem<TCrop> = {
        id: speciesId,
        parentId: null,
        kind: 'species',
        label: speciesLabel,
        secondary: '',
        crop: speciesCrop,
        hasGeneralEntry: Boolean(speciesCrop),
        speciesKey,
        varietyCount: varietyCrops.length,
      };

      const varietyNodes = varietyCrops
        .map((crop) => ({
          id: `crop:${crop.id ?? `${speciesKey}:${crop.variety ?? crop.name}`}`,
          parentId: speciesId,
          kind: 'variety' as const,
          label: (crop.variety || '').trim() || getCropSpeciesLabel(crop),
          secondary: '',
          crop,
          hasGeneralEntry: true,
          speciesKey,
          varietyCount: 0,
        }));

      return [speciesNode, ...extraGeneralCrops.map((crop) => ({
        ...speciesNode, id: `crop:${crop.id}`, label: getCropSpeciesLabel(crop), crop,
        varietyCount: 0,
      })), ...varietyNodes];
    });
}

/**
 * Adds back the general ("no variety") crop of every group the matches
 * belong to, so a filter that only hit Sorten still carries their Kultur.
 *
 * Searching for a variety name filters the general Kultur row out, which left
 * `buildCropHierarchy` with a species node that has no `crop` of its own:
 * clicking the Kultur in the tree then selected its first Sorte instead of
 * showing the Kultur's own data, and the search dropdown showed a variety row
 * without the Kultur it belongs to. The group's own header is context for the
 * matches, not a match itself, so it does not count towards "no results".
 */
export function withGroupGeneralCrops<TCrop extends CropHierarchySource>(
  matches: readonly TCrop[],
  allCrops: readonly TCrop[],
): TCrop[] {
  if (matches.length === 0) {
    return [...matches];
  }
  const matchedKeys = new Set<string>();
  const keysWithGeneralCrop = new Set<string>();
  matches.forEach((crop) => {
    const key = getCropSpeciesKey(crop);
    matchedKeys.add(key);
    if (!(crop.variety || '').trim()) {
      keysWithGeneralCrop.add(key);
    }
  });

  const missingGeneralCrops: TCrop[] = [];
  allCrops.forEach((crop) => {
    if ((crop.variety || '').trim()) {
      return;
    }
    const key = getCropSpeciesKey(crop);
    if (!matchedKeys.has(key) || keysWithGeneralCrop.has(key)) {
      return;
    }
    // Guards against a second varietyless row for the same group, which the UI
    // does not create but the data model allows.
    keysWithGeneralCrop.add(key);
    missingGeneralCrops.push(crop);
  });

  return missingGeneralCrops.length === 0
    ? [...matches]
    : [...matches, ...missingGeneralCrops];
}

/**
 * Widens per-Kultur matches to whole groups: a group counts as a hit as soon
 * as its Kultur name or any one of its Sorten matched, and it is then shown
 * with *all* of its Sorten rather than only the matching ones.
 *
 * Searching a Sorte name is a way of finding its Kultur, so hiding that
 * Kultur's remaining Sorten would answer a narrower question than the one the
 * user asked. `allCrops` is the set the other (non-search) filters already
 * left over, so a group is never widened past those filters.
 */
export function withGroupSiblingCrops<TCrop extends CropHierarchySource>(
  matches: readonly TCrop[],
  allCrops: readonly TCrop[],
): TCrop[] {
  if (matches.length === 0) {
    return [...matches];
  }
  const matchedKeys = new Set(matches.map((crop) => getCropSpeciesKey(crop)));
  return allCrops.filter((crop) => matchedKeys.has(getCropSpeciesKey(crop)));
}

/**
 * The first variety under a species node that has no dedicated varietyless
 * entry of its own (`hasGeneralEntry: false` on the species node — see
 * buildCropHierarchy). Such a species row has nothing to select directly, so
 * callers use this as the fallback target: select this variety (and expand
 * the group) instead of leaving the row inert/disabled.
 */
export function getFirstVarietyItem<TCrop extends CropHierarchySource>(
  items: readonly CropHierarchyItem<TCrop>[],
  speciesNodeId: string,
): CropHierarchyItem<TCrop> | null {
  return items.find((item) => item.parentId === speciesNodeId && item.crop !== null) ?? null;
}

export function findSpeciesCrop<TCrop extends CropHierarchySource>(
  crop: TCrop | null | undefined,
  crops: readonly TCrop[],
): TCrop | null {
  if (!crop?.variety) {
    return null;
  }
  const speciesKey = getCropSpeciesKey(crop);
  return crops.find((candidate) => (
    getCropSpeciesKey(candidate) === speciesKey
    && !(candidate.variety || '').trim()
  )) ?? null;
}

export type ProjectCropHierarchyItem = CropHierarchyItem<Crop>;
export type PublicCropHierarchyItem = CropHierarchyItem<PublicCrop>;
