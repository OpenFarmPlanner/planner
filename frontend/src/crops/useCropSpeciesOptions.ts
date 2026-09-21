import { useCallback, useEffect, useState } from 'react';

import { cropSpeciesAPI } from '../api/api';
import type { CropSpecies } from '../api/types';

export interface CropSpeciesOptions {
  species: CropSpecies[];
  loading: boolean;
  /**
   * True once a fetch has delivered the list. Callers that seed a default
   * selection need this rather than `!loading`: loading only flips on in a
   * microtask, so an empty-and-not-yet-loading list is indistinguishable from
   * a genuinely empty one.
   */
  loaded: boolean;
  /** Makes a freshly proposed species selectable without reloading the list. */
  addSpecies: (species: CropSpecies) => void;
}

/**
 * The official crop species list behind `CropSpeciesPicker`.
 *
 * The picker is a client-side-filtered Autocomplete over the full reference
 * list, not a server-searched one — it needs every published species in one
 * page, not just the API's default page_size (100), or species sorted past
 * that cutoff silently become unselectable.
 */
export function useCropSpeciesOptions(enabled: boolean): CropSpeciesOptions {
  const [species, setSpecies] = useState<CropSpecies[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    cropSpeciesAPI.list({ page_size: 1000 })
      .then((response) => {
        if (cancelled) return;
        setSpecies(response.data.results);
        setLoaded(true);
      })
      .catch((error) => {
        console.error('Error loading crop species:', error);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const addSpecies = useCallback((created: CropSpecies) => {
    setSpecies((previous) => [...previous, created]);
  }, []);

  return { species, loading, loaded, addSpecies };
}
