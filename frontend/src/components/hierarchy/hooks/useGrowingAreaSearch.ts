import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Bed, Field, Location } from '../../../api/types';
import {
  EMPTY_GROWING_AREA_FILTERS,
  getActiveGrowingAreaFilterGroups,
  parseGrowingAreaFilters,
  searchGrowingAreas,
  withLocationSelection,
  type GrowingAreaFilterGroup,
  type GrowingAreaFilters,
  type GrowingAreaSearchResult,
} from '../utils/growingAreaSearch';

export const GROWING_AREA_SEARCH_DEBOUNCE_MS = 150;
const STORAGE_PREFIX = 'growingAreaSearch.';

interface StoredState {
  query: string;
  filters: GrowingAreaFilters;
}

// Kept for the browser tab's session (sessionStorage), so leaving the list
// for a location/parcel/bed detail page and coming back restores the search
// and filters. A new tab or a project switch starts empty.
function readStoredState(projectId: number | null): StoredState {
  if (projectId === null) return { query: '', filters: EMPTY_GROWING_AREA_FILTERS };
  try {
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${projectId}`);
    if (!raw) return { query: '', filters: EMPTY_GROWING_AREA_FILTERS };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      query: typeof parsed.query === 'string' ? parsed.query : '',
      filters: parseGrowingAreaFilters(parsed.filters),
    };
  } catch {
    return { query: '', filters: EMPTY_GROWING_AREA_FILTERS };
  }
}

function writeStoredState(projectId: number | null, state: StoredState): void {
  if (projectId === null) return;
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${projectId}`, JSON.stringify(state));
  } catch { /* Storage may be disabled. */ }
}

export interface GrowingAreaSearchControls extends GrowingAreaSearchResult {
  query: string;
  setQuery: (query: string) => void;
  clearSearch: () => void;
  filters: GrowingAreaFilters;
  setFilters: (filters: GrowingAreaFilters) => void;
  setLocationIds: (locationIds: number[]) => void;
  clearFilterGroup: (group: GrowingAreaFilterGroup) => void;
  resetFilters: () => void;
  activeFilterGroups: GrowingAreaFilterGroup[];
  hasFilters: boolean;
}

export function useGrowingAreaSearch(
  projectId: number | null,
  entities: { locations: Location[]; fields: Field[]; beds: Bed[] },
): GrowingAreaSearchControls {
  const [initialState] = useState(() => readStoredState(projectId));
  const [query, setQueryState] = useState(initialState.query);
  const [appliedQuery, setAppliedQuery] = useState(initialState.query);
  const [filters, setFilters] = useState<GrowingAreaFilters>(initialState.filters);

  // Typing is debounced; clearing applies at once (docs/search.md).
  useEffect(() => {
    if (query === appliedQuery) return undefined;
    const timeout = window.setTimeout(() => setAppliedQuery(query), GROWING_AREA_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [appliedQuery, query]);
  const setQuery = useCallback((nextQuery: string): void => {
    setQueryState(nextQuery);
    if (nextQuery.trim() === '') setAppliedQuery(nextQuery);
  }, []);

  useEffect(() => {
    writeStoredState(projectId, { query: appliedQuery, filters });
  }, [appliedQuery, filters, projectId]);

  const { locations, fields, beds } = entities;
  const result = useMemo(
    () => searchGrowingAreas({ locations, fields, beds }, appliedQuery, filters),
    [appliedQuery, beds, fields, filters, locations],
  );

  const clearSearch = useCallback((): void => {
    setQueryState('');
    setAppliedQuery('');
  }, []);
  const setLocationIds = useCallback((locationIds: number[]): void => {
    setFilters((current) => withLocationSelection(current, locationIds, fields));
  }, [fields]);
  const clearFilterGroup = useCallback((group: GrowingAreaFilterGroup): void => {
    setFilters((current) => ({ ...current, [group]: [] }));
  }, []);
  const resetFilters = useCallback((): void => setFilters(EMPTY_GROWING_AREA_FILTERS), []);
  const activeFilterGroups = useMemo(() => getActiveGrowingAreaFilterGroups(filters), [filters]);

  return {
    ...result,
    query,
    setQuery,
    clearSearch,
    filters,
    setFilters,
    setLocationIds,
    clearFilterGroup,
    resetFilters,
    activeFilterGroups,
    hasFilters: activeFilterGroups.length > 0,
  };
}
