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
  /**
   * Makes a freshly proposed species selectable without reloading the list —
   * or, for an id already in the list (e.g. one just approved), replaces it
   * in place so the option reflects its new status/name instead of leaving a
   * stale duplicate behind.
   */
  addSpecies: (species: CropSpecies) => void;
}

/**
 * The official crop species list behind `CropSpeciesPicker`.
 *
 * The picker is a client-side-filtered Autocomplete over the full reference
 * list, not a server-searched one — it needs every published species in one
 * page, not just the API's default page_size (100), or species sorted past
 * that cutoff silently become unselectable.
 *
 * @param includeProposed - Moderator-only surfaces (the species relink
 * dialog) also want a species someone already proposed selectable, instead
 * of only letting the moderator type the same name again and hit "already
 * proposed". Non-moderators never see proposed species here regardless (the
 * backend's `public_species_mapping_targets` enforces that), and a rejected
 * species is filtered out client-side — it is not a valid target either way.
 */
export function useCropSpeciesOptions(enabled: boolean, includeProposed = false): CropSpeciesOptions {
  const [species, setSpecies] = useState<CropSpecies[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setLoading(true);
    });
    cropSpeciesAPI.list({ page_size: 1000, ...(includeProposed ? { include_proposed: true } : {}) })
      .then((response) => {
        if (cancelled) return;
        setSpecies(response.data.results.filter((option) => option.status !== 'rejected'));
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
  }, [enabled, includeProposed]);

  const addSpecies = useCallback((created: CropSpecies) => {
    setSpecies((previous) => (
      previous.some((option) => option.id === created.id)
        ? previous.map((option) => (option.id === created.id ? created : option))
        : [...previous, created]
    ));
  }, []);

  return { species, loading, loaded, addSpecies };
}
