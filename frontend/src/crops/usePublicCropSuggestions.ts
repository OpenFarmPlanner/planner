import { useEffect, useMemo, useRef, useState } from 'react';

import { publicCropAPI } from '../api/api';
import type { PublicCrop } from '../api/types';
import { useCropSpeciesSearch } from './useCropSpeciesSearch';
import { normalizeCropSpeciesSearchValue } from './cropSpeciesMatching';
import {
  dedupePublicCropsBySpecies,
  dedupePublicCropVarieties,
} from './publicCropNameSuggestions';
import type { PublicCropSpeciesOption } from './publicCropNameSuggestions';

const PUBLIC_CROP_SEARCH_DEBOUNCE_MS = 250;

interface UsePublicCropSuggestionsOptions {
  /** Only a project crop form suggests library entries; the library's own does not. */
  enabled: boolean;
  /** What the Name autocomplete is searching for, controlled by the form. */
  searchTerm: string;
  /** The Name field's current text, matched against the loaded species. */
  nameText: string | undefined;
}

interface PublicCropSuggestions {
  /** Unique crop species, never "Species · Variety" pairs. */
  nameOptions: PublicCropSpeciesOption[];
  nameOptionsLoading: boolean;
  /** The species the typed Name matches exactly, however it got there. */
  matchedNameOption: PublicCropSpeciesOption | undefined;
  /** Every library entry of the matched species, for prefill lookups. */
  varietyPublicCrops: PublicCrop[];
  varietyOptions: string[];
  varietyOptionsLoading: boolean;
  /**
   * Which species `varietyPublicCrops` belongs to. A pending prefill compares
   * against this so it can tell "not loaded yet" from "loaded, no match".
   */
  loadedVarietySpeciesId: number | null;
}

/**
 * Public crop library suggestions for the crop form's Name and Variety fields.
 *
 * The Variety field only gets suggestions once the Name text matches an
 * existing species exactly, so the two loads are chained: search → species
 * options → matched species → that species' entries.
 */
export function usePublicCropSuggestions({
  enabled,
  searchTerm,
  nameText,
}: UsePublicCropSuggestionsOptions): PublicCropSuggestions {
  const officialSearch = useCropSpeciesSearch(searchTerm, enabled);
  const [publicCropOptions, setPublicCropOptions] = useState<PublicCrop[]>([]);
  const [nameOptionsLoading, setNameOptionsLoading] = useState(false);
  const [matchedCropSpeciesId, setMatchedCropSpeciesId] = useState<number | null>(null);
  const [varietyPublicCrops, setVarietyPublicCrops] = useState<PublicCrop[]>([]);
  const [loadedVarietySpeciesId, setLoadedVarietySpeciesId] = useState<number | null>(null);
  const [varietyOptionsLoading, setVarietyOptionsLoading] = useState(false);
  const searchSequenceRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      queueMicrotask(() => {
        setPublicCropOptions([]);
        setNameOptionsLoading(false);
      });
      return undefined;
    }

    const trimmedSearchTerm = searchTerm.trim();
    const currentSequence = searchSequenceRef.current + 1;
    searchSequenceRef.current = currentSequence;

    if (!trimmedSearchTerm) {
      queueMicrotask(() => {
        setPublicCropOptions([]);
        setNameOptionsLoading(false);
      });
      return undefined;
    }

    queueMicrotask(() => setNameOptionsLoading(true));
    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => {
      publicCropAPI.list({ q: trimmedSearchTerm }, abortController.signal)
        .then((response) => {
          if (searchSequenceRef.current !== currentSequence) {
            return;
          }
          setPublicCropOptions(response.data.results);
        })
        .catch(() => {
          if (searchSequenceRef.current === currentSequence && !abortController.signal.aborted) {
            setPublicCropOptions([]);
          }
        })
        .finally(() => {
          if (searchSequenceRef.current === currentSequence) {
            setNameOptionsLoading(false);
          }
        });
    }, PUBLIC_CROP_SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [enabled, searchTerm]);

  // "Name" suggestions must be unique crop species, never "Species · Variety"
  // combinations — the Variety field covers the sorte-specific part.
  const nameOptions = useMemo(
    () => {
      const options = dedupePublicCropsBySpecies(publicCropOptions, searchTerm);
      for (const species of officialSearch.results) {
        const existing = options.find((option) => option.cropSpeciesId === species.id);
        if (existing) {
          existing.specific_property_profile = species.specific_property_profile;
          continue;
        }
        options.push({
          key: species.id, cropSpeciesId: species.id,
          canonicalName: species.display_name || species.name,
          name: species.display_name || species.name, matchedAlias: null,
          searchNames: species.search_names ?? [species.name],
          specific_property_profile: species.specific_property_profile,
        });
      }
      return options;
    },
    [officialSearch.results, publicCropOptions, searchTerm],
  );

  // The library entry the typed Name text matches exactly, regardless of how
  // it got there (dropdown pick or free text). Used both to fetch Variety
  // suggestions below and to offer an explicit "apply values" hint when the
  // match wasn't picked from the dropdown.
  const matchedNameOption = useMemo(() => {
    const normalizedName = normalizeCropSpeciesSearchValue(nameText);
    return normalizedName
      ? nameOptions.find((option) => (
        option.searchNames.some((name) => normalizeCropSpeciesSearchValue(name) === normalizedName)
      ))
      : undefined;
  }, [nameText, nameOptions]);

  useEffect(() => {
    if (!enabled) {
      queueMicrotask(() => setMatchedCropSpeciesId(null));
      return;
    }
    queueMicrotask(() => setMatchedCropSpeciesId(matchedNameOption?.cropSpeciesId ?? null));
  }, [enabled, matchedNameOption]);

  useEffect(() => {
    if (!enabled || matchedCropSpeciesId === null) {
      queueMicrotask(() => {
        setVarietyPublicCrops([]);
        setLoadedVarietySpeciesId(null);
        setVarietyOptionsLoading(false);
      });
      return undefined;
    }

    let cancelled = false;
    const abortController = new AbortController();
    queueMicrotask(() => setVarietyOptionsLoading(true));
    publicCropAPI.list({ crop_species: matchedCropSpeciesId }, abortController.signal)
      .then((response) => {
        if (cancelled) return;
        setVarietyPublicCrops(response.data.results);
        setLoadedVarietySpeciesId(matchedCropSpeciesId);
      })
      .catch(() => {
        if (cancelled || abortController.signal.aborted) return;
        setVarietyPublicCrops([]);
        // Still mark the species as resolved so a pending prefill falls back
        // to "crop_species linked only" instead of waiting forever.
        setLoadedVarietySpeciesId(matchedCropSpeciesId);
      })
      .finally(() => {
        if (!cancelled) setVarietyOptionsLoading(false);
      });

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [enabled, matchedCropSpeciesId]);

  const varietyOptions = useMemo(() => dedupePublicCropVarieties(varietyPublicCrops), [varietyPublicCrops]);

  return {
    nameOptions,
    nameOptionsLoading: nameOptionsLoading || officialSearch.loading,
    matchedNameOption,
    varietyPublicCrops,
    varietyOptions,
    varietyOptionsLoading,
    loadedVarietySpeciesId,
  };
}
