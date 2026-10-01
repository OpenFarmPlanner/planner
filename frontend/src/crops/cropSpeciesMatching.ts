import type {
  CropSpecies,
  CropSpeciesMatchSource,
  CropSpeciesSearchMatch,
  PublicCrop,
} from '../api/types';
import { normalizeSearchText } from '../search/searchText';

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

export interface CropSpeciesResultLabel {
  label: string;
  /** True when no translation exists in `uiLanguageCode` and `label` falls back to another language. */
  usedFallbackLanguage: boolean;
}

/**
 * Official name of one hit in the "Offizielle Kulturart" results list.
 *
 * The canonical name in the current UI language (for German, the canonical
 * bundesdeutsche `common_name` — not a regional AT/CH override, unlike
 * `display_name`/`localized_name` elsewhere in the app, since a search result
 * should read the same regardless of the viewer's region). Never carries the
 * matched alias: why a hit matched is shown separately (see
 * `getCropSpeciesSearchMatch`). When the species has no translation at all in
 * the UI language, falls back to `display_name` with its source language
 * appended ("Beefsteak tomato · EN") so a foreign-language hit is never
 * passed off as a UI-language one. Mirrors the backend's
 * `crops.services.official_species_name`.
 */
export const getCropSpeciesResultLabel = (
  option: CropSpecies,
  uiLanguageCode: string,
): CropSpeciesResultLabel => {
  const baseLanguage = (uiLanguageCode || '').split('-')[0];
  const translation = option.translations?.find(
    (item) => item.language_code === baseLanguage && item.common_name,
  );
  if (translation) {
    return { label: translation.common_name, usedFallbackLanguage: false };
  }
  const fallbackName = option.display_name || getCropSpeciesCanonicalName(option);
  const fallbackLanguageCode = (option.display_language_code || '').toUpperCase();
  return {
    label: fallbackLanguageCode ? `${fallbackName} · ${fallbackLanguageCode}` : fallbackName,
    usedFallbackLanguage: true,
  };
};

/** Result order of the species search: official name, synonym, botanical name, similar name. */
export const CROP_SPECIES_MATCH_SOURCE_ORDER: readonly CropSpeciesMatchSource[] = [
  'name', 'synonym', 'botanical', 'fuzzy',
];

/**
 * Why `option` matches `searchValue`, with `officialName` being the name the
 * option is listed under; null when it does not match at all.
 *
 * Client-side counterpart of the server search's `search_match` (see
 * `crops.services.search_crop_species`), for the picker's client-filtered
 * mode. A hit on the official name wins over a synonym hit, which wins over a
 * scientific-name hit; a merely similar-looking name is `fuzzy`.
 */
export const getCropSpeciesSearchMatch = (
  option: CropSpecies,
  searchValue: string,
  officialName: string,
): CropSpeciesSearchMatch | null => {
  const query = normalizeSearchText(normalizeCropSpeciesSearchValue(searchValue));
  if (!query) return null;
  const officialKey = normalizeSearchText(officialName);
  const scientificKey = normalizeSearchText(option.scientific_name ?? '');
  if (officialKey.includes(query)) return { source: 'name', synonym: '' };

  const searchNames = getCropSpeciesSearchNames(option);
  const synonyms = searchNames
    .map((name) => ({ name, key: normalizeSearchText(name) }))
    .filter(({ key }) => key && key !== officialKey && key !== scientificKey);
  const synonym = synonyms.find(({ key }) => key === query) ?? synonyms.find(({ key }) => key.includes(query));
  if (synonym) return { source: 'synonym', synonym: synonym.name };
  if (scientificKey.includes(query)) return { source: 'botanical', synonym: '' };
  if (isCropSpeciesSearchMatch(searchValue, searchNames)) return { source: 'fuzzy', synonym: '' };
  return null;
};

/**
 * Both required common names for approving a species proposal — must mirror
 * the backend's `REQUIRED_PUBLIC_CROP_SPECIES_LANGUAGE_CODES`
 * (`config/languages.py`). Shared by the moderation queue's own approval
 * dialog and anywhere else a moderator can approve a species inline.
 */
export type RequiredSpeciesLanguage = 'de' | 'en';
export type SpeciesApprovalTranslations = Record<RequiredSpeciesLanguage, string>;
export const REQUIRED_SPECIES_LANGUAGES: RequiredSpeciesLanguage[] = ['de', 'en'];

/**
 * Seeds the two-language approval form: existing translations for a species
 * that already has some, or — for a name that was only just typed and has no
 * `CropSpecies` yet — the typed name under the current UI language, leaving
 * the other language blank so the moderator has to consciously fill it
 * rather than silently getting a duplicate of the same text.
 */
export const getInitialSpeciesApprovalTranslations = (
  species: Pick<CropSpecies, 'translations' | 'display_name' | 'display_language_code' | 'name'> | null,
  fallbackName: string,
  currentLanguageCode: string,
): SpeciesApprovalTranslations => {
  const translations: SpeciesApprovalTranslations = { de: '', en: '' };
  for (const translation of species?.translations ?? []) {
    if (translation.language_code === 'de' || translation.language_code === 'en') {
      translations[translation.language_code] = translation.common_name;
    }
  }
  if (translations.de || translations.en) {
    return translations;
  }
  const fallbackLanguage = species?.display_language_code === 'de' || species?.display_language_code === 'en'
    ? species.display_language_code
    : currentLanguageCode === 'de' ? 'de' : 'en';
  translations[fallbackLanguage] = species?.display_name || species?.name || fallbackName;
  return translations;
};
