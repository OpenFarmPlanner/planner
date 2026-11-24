/**
 * Custom hook for managing hierarchical data fetching
 */

import { useState, useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from '../../../i18n';
import { locationAPI, fieldAPI, bedAPI, type Location, type Field, type Bed } from '../../../api/api';

type HierarchyEntity = {
  id?: number | null;
};

interface FetchDataOptions {
  showLoading?: boolean;
}

const hasTemporaryEntityId = (entity: HierarchyEntity): boolean =>
  typeof entity.id === 'number' && entity.id < 0;

const mergePersistedWithTemporaryEntities = <T extends HierarchyEntity>(
  persistedEntities: T[],
  currentEntities: T[],
): T[] => {
  const temporaryEntities = currentEntities.filter(hasTemporaryEntityId);
  return [...temporaryEntities, ...persistedEntities];
};

// Stable identities so consumers' memos do not see new arrays on every
// render while the hook is disabled.
const EMPTY_LOCATIONS: Location[] = [];
const EMPTY_FIELDS: Field[] = [];
const EMPTY_BEDS: Bed[] = [];

export interface HierarchyDataState {
  loading: boolean;
  hasLoaded: boolean;
  error: string;
  setError: Dispatch<SetStateAction<string>>;
  locations: Location[];
  setLocations: Dispatch<SetStateAction<Location[]>>;
  fields: Field[];
  setFields: Dispatch<SetStateAction<Field[]>>;
  beds: Bed[];
  setBeds: Dispatch<SetStateAction<Bed[]>>;
  fetchData: (options?: FetchDataOptions) => Promise<void>;
  /**
   * Increments only after a foreground fetch (initial load, or a caller
   * explicitly requesting `showLoading: true`) finishes applying its data —
   * unlike the silent `showLoading: false` background refetch after a
   * create/rename. Consumers that need to know "the table was freshly
   * (re)loaded" (e.g. to refresh a stable sort-order snapshot) should watch
   * this instead of `loading`/`hasLoaded`, which don't distinguish the two.
   */
  fetchGeneration: number;
}

export const BULK_BEDS_UNDONE_EVENT = 'ofp:bulk-beds-undone';

export function useHierarchyData(enabled = true): HierarchyDataState {
  const { t } = useTranslation('hierarchy');
  const [isFetching, setLoading] = useState<boolean>(enabled);
  const [hasFetched, setHasLoaded] = useState<boolean>(false);
  const [fetchError, setError] = useState<string>('');
  const [loadedLocations, setLocations] = useState<Location[]>([]);
  const [loadedFields, setFields] = useState<Field[]>([]);
  const [loadedBeds, setBeds] = useState<Bed[]>([]);

  // While disabled the hook fetches nothing, so it reports an empty, settled
  // result. Derived during render rather than pushed into state from the
  // effect below, which is what react-hooks/set-state-in-effect flags.
  const loading = enabled ? isFetching : false;
  const hasLoaded = enabled ? hasFetched : false;
  const error = enabled ? fetchError : '';
  const locations = enabled ? loadedLocations : EMPTY_LOCATIONS;
  const fields = enabled ? loadedFields : EMPTY_FIELDS;
  const beds = enabled ? loadedBeds : EMPTY_BEDS;
  const [fetchGeneration, setFetchGeneration] = useState(0);
  const latestFetchRequestRef = useRef(0);

  const fetchData = useCallback(async (options: FetchDataOptions = {}): Promise<void> => {
    if (!enabled) {
      return;
    }
    const { showLoading = true } = options;
    const fetchRequestId = latestFetchRequestRef.current + 1;
    latestFetchRequestRef.current = fetchRequestId;
    if (showLoading) {
      setLoading(true);
    }
    try {
      // listAll (not list) — list() is capped at the backend's default page
      // size (100), which silently truncated large projects (more than 100
      // fields or beds) to their first page, making the tail of the
      // hierarchy tree unreachable no matter how the table itself scrolled.
      const [locationsRes, fieldsRes, bedsRes] = await Promise.all([
        locationAPI.listAll(),
        fieldAPI.listAll(),
        bedAPI.listAll(),
      ]);

      if (fetchRequestId !== latestFetchRequestRef.current) {
        return;
      }
      
      const locs = locationsRes.results.filter(l => l.id !== undefined);
      const flds = fieldsRes.results.filter(f => f.id !== undefined);
      const bds = bedsRes.results.filter(b => b.id !== undefined);
      setLocations((currentLocations) =>
        mergePersistedWithTemporaryEntities(locs, currentLocations),
      );
      setFields((currentFields) =>
        mergePersistedWithTemporaryEntities(flds, currentFields),
      );
      setBeds((currentBeds) =>
        mergePersistedWithTemporaryEntities(bds, currentBeds),
      );
      setError('');
      if (showLoading) {
        setFetchGeneration((generation) => generation + 1);
      }
    } catch (err) {
      if (fetchRequestId !== latestFetchRequestRef.current) {
        return;
      }
      setError(t('errors.load'));
      console.error('Error fetching data:', err);
    } finally {
      if (fetchRequestId === latestFetchRequestRef.current) {
        setHasLoaded(true);
        setLoading(false);
      }
    }
  }, [enabled, t]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void fetchData();
    const refreshAfterUndo = () => { void fetchData({ showLoading: false }); };
    window.addEventListener(BULK_BEDS_UNDONE_EVENT, refreshAfterUndo);
    return () => window.removeEventListener(BULK_BEDS_UNDONE_EVENT, refreshAfterUndo);
  }, [enabled, fetchData]);

  return {
    loading,
    hasLoaded,
    error,
    setError,
    locations,
    setLocations,
    fields,
    beds,
    setBeds,
    setFields,
    fetchData,
    fetchGeneration,
  };
}
