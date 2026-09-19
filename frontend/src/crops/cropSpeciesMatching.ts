import type { CropSpecies, PublicCrop } from '../api/types';

export const normalizeCropSpeciesSearchValue = (value: string | undefined | null): string => (
  (value || '').split(/\s+/).filter(Boolean).join(' ').toLocaleLowerCase('de')
);

const boundedLevenshtein = (left: string, right: string, maxDistance: number): number => {
  if (Math.abs(left.length - right.length) > maxDistance) {
    return maxDistance + 1;
  }
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    let rowMin = current[0];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex] === right[rightIndex] ? 0 : 1;
      const value = Math.min(
        previous[rightIndex + 1] + 1,
        current[rightIndex] + 1,
        previous[rightIndex] + substitutionCost,
      );
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > maxDistance) {
      return maxDistance + 1;
    }
    previous = current;
  }
  return previous[right.length];
};

const isCloseCropSpeciesMatch = (query: string, candidate: string): boolean => {
  if (!query || !candidate) return false;
  if (candidate.includes(query) || query.includes(candidate)) return true;
  const maxDistance = Math.min(query.length, candidate.length) < 8 ? 1 : 2;
  return boundedLevenshtein(query, candidate, maxDistance) <= maxDistance;
};

const isWholeTermCropSpeciesMatch = (query: string, candidate: string): boolean => {
  if (!query || !candidate) return false;
  if (query === candidate) return true;
  if (candidate.includes(query) || query.includes(candidate)) return false;
  const maxDistance = Math.min(query.length, candidate.length) < 8 ? 1 : 2;
  return boundedLevenshtein(query, candidate, maxDistance) <= maxDistance;
};

const uniqueNames = (names: Array<string | undefined | null>): string[] => {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const normalizedName = (name || '').split(/\s+/).filter(Boolean).join(' ');
    const key = normalizedCropSpeciesNameKey(normalizedName);
    if (normalizedName && !seen.has(key)) {
      result.push(normalizedName);
      seen.add(key);
    }
  }
  return result;
};

const normalizedCropSpeciesNameKey = (value: string): string => (
  normalizeCropSpeciesSearchValue(value)
);

export const getCropSpeciesCanonicalName = (species: Pick<CropSpecies, 'name' | 'display_name'>): string => (
  species.name || species.display_name || ''
);

export const getCropSpeciesSearchNames = (species: CropSpecies): string[] => (
  uniqueNames([
    species.name,
    species.display_name,
    ...(species.search_names ?? []),
    ...(species.translations ?? []).flatMap((translation) => [
      translation.common_name,
      ...(translation.synonyms ?? []),
      ...Object.values(translation.regional_names ?? {}),
    ]),
  ])
);

export const getPublicCropSpeciesSearchNames = (crop: PublicCrop): string[] => (
  crop.crop_species != null
    ? uniqueNames([
      crop.crop_species_canonical_name,
      crop.crop_species_name,
      crop.display_name,
      ...(crop.crop_species_search_names ?? []),
      ...Object.values(crop.crop_species_translations ?? {}),
    ])
    : uniqueNames([crop.name])
);

export const findMatchedCropSpeciesAlias = (
  searchValue: string,
  canonicalName: string,
  searchNames: string[],
): string | null => {
  const normalizedSearch = normalizeCropSpeciesSearchValue(searchValue);
  if (!normalizedSearch) return null;
  const canonicalKey = normalizedCropSpeciesNameKey(canonicalName);
  for (const name of searchNames) {
    const nameKey = normalizedCropSpeciesNameKey(name);
    if (!nameKey || nameKey === canonicalKey) {
      continue;
    }
    if (nameKey.includes(normalizedSearch)) {
      return name;
    }
  }
  for (const name of searchNames) {
    const nameKey = normalizedCropSpeciesNameKey(name);
    if (!nameKey || nameKey === canonicalKey) {
      continue;
    }
    if (normalizedSearch.includes(nameKey)) {
      return name;
    }
  }
  return null;
};

export const formatCropSpeciesMatchLabel = (
  canonicalName: string,
  matchedAlias: string | null | undefined,
): string => (
  matchedAlias ? `${canonicalName} (${matchedAlias})` : canonicalName
);

export const hasStrongCropSpeciesIdentityMatch = (
  searchValue: string,
  options: Array<{ searchNames: string[] }>,
): boolean => {
  const normalizedSearch = normalizeCropSpeciesSearchValue(searchValue);
  if (!normalizedSearch) return false;
  return options.some((option) => (
    option.searchNames.some((name) => (
      isWholeTermCropSpeciesMatch(normalizedSearch, normalizedCropSpeciesNameKey(name))
    ))
  ));
};

export const isCropSpeciesSearchMatch = (searchValue: string, searchNames: string[]): boolean => {
  const normalizedSearch = normalizeCropSpeciesSearchValue(searchValue);
  if (!normalizedSearch) return false;
  return searchNames.some((name) => isCloseCropSpeciesMatch(normalizedSearch, normalizedCropSpeciesNameKey(name)));
};

/**
 * Species label for a picker option: the canonical name, plus the alias the
 * user's search actually matched when that alias is what made the option
 * appear (so a regional or synonym hit is never silent).
 */
export const getCropSpeciesOptionLabel = (
  option: CropSpecies,
  searchValue = '',
): string => {
  const canonicalName = getCropSpeciesCanonicalName(option);
  return formatCropSpeciesMatchLabel(
    canonicalName,
    findMatchedCropSpeciesAlias(searchValue, canonicalName, getCropSpeciesSearchNames(option)),
  );
};
