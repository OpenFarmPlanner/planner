import { useEffect, useState } from 'react';

import { cropSpeciesAPI } from '../api/api';
import type { CropSpecies } from '../api/types';

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_PAGE_SIZE = 20;

export interface CropSpeciesSearchResult {
  results: CropSpecies[];
  loading: boolean;
  /**
   * True once a search for the current query has settled (success, failure,
   * or an empty query) — mirrors `useCropSpeciesOptions`'s `loaded` so
   * callers can tell "no results yet" from "still searching".
   */
  settled: boolean;
}

/**
 * Debounced, typo-tolerant server search for the "Offizielle Kulturart"
 * field (`CropSpeciesViewSet.list`'s ranked ``q`` search — exact match,
 * then prefix/alias, then similarity; see `crops.services.search_crop_species`
 * and docs/crop-library-architecture.md).
 *
 * Unlike `useCropSpeciesOptions` (which loads the whole species catalogue
 * once for client-side filtering, used by the moderators' "Kulturart
 * korrigieren" relink dialog), this fetches only the current query's top
 * matches — the publishing wizard's species field is the one place that
 * needs server-ranked fuzzy results instead of a fixed local list.
 */
export function useCropSpeciesSearch(query: string, enabled: boolean): CropSpeciesSearchResult {
  const [results, setResults] = useState<CropSpecies[]>([]);
  const [loading, setLoading] = useState(false);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (!enabled || !trimmedQuery) {
      queueMicrotask(() => {
        setResults([]);
        setSettled(true);
        setLoading(false);
      });
      return undefined;
    }

    queueMicrotask(() => setSettled(false));
    let cancelled = false;
    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setLoading(true);
      cropSpeciesAPI.list({ q: trimmedQuery, page_size: SEARCH_PAGE_SIZE }, abortController.signal)
        .then((response) => {
          if (cancelled) return;
          setResults(response.data.results);
          setSettled(true);
        })
        .catch(() => {
          if (cancelled || abortController.signal.aborted) return;
          setResults([]);
          setSettled(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [enabled, query]);

  return { results, loading, settled };
}
