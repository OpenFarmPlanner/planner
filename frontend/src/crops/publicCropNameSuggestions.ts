import type { PublicCrop } from '../api/types';
import {
  findMatchedCropSpeciesAlias,
  formatCropSpeciesMatchLabel,
  getPublicCropSpeciesSearchNames,
} from './cropSpeciesMatching';

export const normalizeIdentityValue = (value: string | undefined | null): string => (
  (value || '').trim().toLowerCase().replace(/\s+/g, ' ')
);

// Manual QA sessions occasionally publish throwaway entries directly to the
// public library (e.g. "Tomato · QA DE zweisprachig 1785241..."). Those rows
// are real, already-published data (not fixtures), so they are filtered out
// of suggestion sources here rather than deleted from the database.
const TEST_ENTRY_PATTERN = /\bqa\b|\btest\b/i;

export const isLikelyTestPublicCropEntry = (crop: Pick<PublicCrop, 'name' | 'variety'>): boolean => (
  TEST_ENTRY_PATTERN.test(crop.name) || TEST_ENTRY_PATTERN.test(crop.variety || '')
);

export interface PublicCropSpeciesOption {
  /** `crop_species` id when known, otherwise the normalized name (legacy entries without a species link). */
  key: number | string;
  cropSpeciesId: number | null;
  specific_property_profile?: string;
  canonicalName: string;
  name: string;
  matchedAlias: string | null;
  searchNames: string[];
}

/**
 * Unique crop-species-level name suggestions derived from public crop
 * search results, e.g. for a "Name" field that must not show variety
 * combinations ("Tomato · Roma"). Grouped by `crop_species` id where
 * available, falling back to the normalized display name for legacy entries
 * without a species link.
 */
export const dedupePublicCropsBySpecies = (
  crops: PublicCrop[],
  searchValue = '',
): PublicCropSpeciesOption[] => {
  const byKey = new Map<number | string, PublicCropSpeciesOption>();

  for (const crop of crops) {
    if (isLikelyTestPublicCropEntry(crop)) {
      continue;
    }
    const canonicalName = crop.crop_species != null
      ? crop.crop_species_canonical_name || crop.display_name || crop.crop_species_name || crop.name || ''
      : crop.name || crop.display_name || crop.crop_species_name || '';
    const searchNames = getPublicCropSpeciesSearchNames(crop);
    const matchedAlias = findMatchedCropSpeciesAlias(searchValue, canonicalName, searchNames);
    const name = formatCropSpeciesMatchLabel(canonicalName, matchedAlias);
    const key = crop.crop_species ?? normalizeIdentityValue(canonicalName);
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        cropSpeciesId: crop.crop_species ?? null,
        specific_property_profile: crop.specific_property_profile,
        canonicalName,
        name,
        matchedAlias,
        searchNames,
      });
    }
  }

  return Array.from(byKey.values());
};

/**
 * Unique, non-empty variety names for a single crop species, filtered of
 * likely QA/test entries.
 */
export const dedupePublicCropVarieties = (crops: PublicCrop[]): string[] => {
  const varieties = new Set<string>();
  for (const crop of crops) {
    const variety = (crop.variety || '').trim();
    if (!variety || isLikelyTestPublicCropEntry(crop)) {
      continue;
    }
    varieties.add(variety);
  }
  return Array.from(varieties);
};
