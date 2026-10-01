import { useEffect, useState } from 'react';

import { cropSpeciesAPI } from '../api/api';
import type { CropSpecies } from '../api/types';

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_PAGE_SIZE = 20;

export interface CropSpeciesSearchResult {
  /** Results for exactly the current query; empty while that query is still pending. */
  results: CropSpecies[];
  /** True from the moment the query changes until its results (or failure) arrive. */
  loading: boolean;
  /**
   * True once a search for the current query has settled (success, failure,
   * or an empty query) — mirrors `useCropSpeciesOptions`'s `loaded` so
   * callers can tell "no results yet" from "still searching".
   */
  settled: boolean;
}

interface SettledSearch {
  query: string;
  results: CropSpecies[];
}

/**
 * Debounced, typo-tolerant server search for the "Offizielle Kulturart"
 * field (`CropSpeciesViewSet.list`'s ranked ``q`` search — official name,
 * then synonym, then similarity; see `crops.services.search_crop_species`
 * and docs/crop-library-architecture.md).
 *
 * Unlike `useCropSpeciesOptions` (which loads the whole species catalogue
 * once for client-side filtering, used by the moderators' "Kulturart
 * korrigieren" relink dialog), this fetches only the current query's top
 * matches — the publishing wizard's species field is the one place that
 * needs server-ranked fuzzy results instead of a fixed local list.
 *
 * Results of a previous query are never returned for the current one: a
 * stale list, swapped for the fresh one while the user is clicking an
 * option, moved a different option under the pointer and the click selected
 * nothing. Until the current query has settled the hook reports `loading`
 * with no results instead.
 */
export function useCropSpeciesSearch(query: string, enabled: boolean): CropSpeciesSearchResult {
  const [settledSearch, setSettledSearch] = useState<SettledSearch | null>(null);
  const trimmedQuery = query.trim();
  const active = enabled && Boolean(trimmedQuery);

  useEffect(() => {
    if (!active) return undefined;

    let cancelled = false;
    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => {
      cropSpeciesAPI.list({ q: trimmedQuery, page_size: SEARCH_PAGE_SIZE }, abortController.signal)
        .then((response) => {
          if (!cancelled) setSettledSearch({ query: trimmedQuery, results: response.data.results });
        })
        .catch(() => {
          if (!cancelled) setSettledSearch({ query: trimmedQuery, results: [] });
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [active, trimmedQuery]);

  if (!active) {
    return { results: [], loading: false, settled: true };
  }
  const settled = settledSearch?.query === trimmedQuery;
  return {
    results: settled ? settledSearch.results : [],
    loading: !settled,
    settled,
  };
}
