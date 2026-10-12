import { useEffect, useMemo, useState } from 'react';

import { plantFamilyAPI } from '../api/api';
import type { PlantFamily } from '../api/types';
import { useTranslation } from '../i18n';
import { FALLBACK_LANGUAGE, normalizeLanguageTag } from '../i18n/languages';

/**
 * The curated plant-family list (`/plant-families/`). It is global and small,
 * so one request per page load serves every form, filter and detail view;
 * a failed request is forgotten so the next caller retries.
 */
let plantFamiliesRequest: Promise<PlantFamily[]> | null = null;

export function loadPlantFamilies(): Promise<PlantFamily[]> {
  if (!plantFamiliesRequest) {
    plantFamiliesRequest = Promise.resolve()
      .then(() => plantFamilyAPI.list())
      .then((response) => response.data)
      .catch((error: unknown) => {
        plantFamiliesRequest = null;
        throw error;
      });
  }
  return plantFamiliesRequest;
}

/**
 * Whether `value` has the shape of a botanical family key ("Brassicaceae").
 * Lets stored UI state from before the plant-family list (free text such as
 * "Kreuzblütler" in a persisted filter) be dropped instead of matching nothing.
 */
export function isBotanicalFamilyKey(value: string | null | undefined): boolean {
  return /^[A-Z][a-z]+aceae$/.test(value ?? '');
}

/** Test hook: forget the cached list. */
export function resetPlantFamiliesCache(): void {
  plantFamiliesRequest = null;
}

/** The family's name in `language`, falling back to English, then the botanical name. */
export function getPlantFamilyName(family: PlantFamily, language: string | null | undefined): string {
  const languageCode = normalizeLanguageTag(language) ?? FALLBACK_LANGUAGE;
  return family.translations?.[languageCode]
    || family.translations?.[FALLBACK_LANGUAGE]
    || family.display_name
    || family.botanical_name;
}

export interface PlantFamilyCatalog {
  /** Every family, sorted by its name in the UI language. */
  families: PlantFamily[];
  loaded: boolean;
  getFamily: (botanicalName: string | null | undefined) => PlantFamily | undefined;
  /** Localized name for a botanical-name key; the key itself while unknown, '' when unset. */
  getName: (botanicalName: string | null | undefined) => string;
  /** The family's default rotation break, or null. */
  getDefaultBreakYears: (botanicalName: string | null | undefined) => number | null;
}

export function buildPlantFamilyCatalog(
  families: PlantFamily[],
  language: string | null | undefined,
  loaded = true,
): PlantFamilyCatalog {
  const byKey = new Map(families.map((family) => [family.botanical_name, family]));
  const getName = (botanicalName: string | null | undefined): string => {
    if (!botanicalName) return '';
    const family = byKey.get(botanicalName);
    return family ? getPlantFamilyName(family, language) : botanicalName;
  };
  const sorted = [...families].sort((left, right) => (
    getPlantFamilyName(left, language).localeCompare(getPlantFamilyName(right, language), language ?? undefined)
  ));
  return {
    families: sorted,
    loaded,
    getFamily: (botanicalName) => (botanicalName ? byKey.get(botanicalName) : undefined),
    getName,
    getDefaultBreakYears: (botanicalName) => (
      botanicalName ? byKey.get(botanicalName)?.default_rotation_break_years ?? null : null
    ),
  };
}

/** The plant-family list in the current UI language; empty until it has loaded. */
export function usePlantFamilies(): PlantFamilyCatalog {
  const { i18n } = useTranslation();
  const language = i18n?.resolvedLanguage ?? i18n?.language;
  const [families, setFamilies] = useState<PlantFamily[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadPlantFamilies()
      .then((result) => {
        if (cancelled) return;
        setFamilies(Array.isArray(result) ? result : []);
        setLoaded(true);
      })
      .catch((error: unknown) => {
        console.error('Error loading plant families:', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => buildPlantFamilyCatalog(families, language, loaded), [families, language, loaded]);
}

/** Filter options for the given family keys: botanical-name value, localized label, sorted by label. */
export function buildPlantFamilyFilterOptions(
  familyKeys: readonly string[],
  catalog: Pick<PlantFamilyCatalog, 'getName'>,
  language: string | null | undefined,
): Array<{ value: string; label: string }> {
  return familyKeys
    .map((family) => ({ value: family, label: catalog.getName(family) }))
    .sort((left, right) => left.label.localeCompare(right.label, language ?? undefined));
}

/**
 * The rotation break a crop rotation check uses: the crop's own (effective)
 * `rotation_break_years`, otherwise its family's default, otherwise null.
 * Counts calendar years without the family on the same bed in between, so a
 * family grown last in year Y may return from year Y + break + 1. Mirrors
 * `resolve_effective_rotation_break_years` in the backend.
 */
export function resolveEffectiveRotationBreakYears(
  ownBreakYears: number | null | undefined,
  familyKey: string | null | undefined,
  catalog: Pick<PlantFamilyCatalog, 'getDefaultBreakYears'>,
): number | null {
  if (ownBreakYears !== null && ownBreakYears !== undefined) {
    return ownBreakYears;
  }
  return catalog.getDefaultBreakYears(familyKey);
}
