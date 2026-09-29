import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { tokenizeSearchQuery } from '../search/searchText';
import {
  clearSeasonSwitchState,
  peekSeasonSwitchState,
  registerSeasonSwitchState,
} from '../seasons/seasonSwitchState';
import {
  DEFAULT_PLANTING_PLAN_SORT,
  EMPTY_PLANTING_PLAN_FILTERS,
  PLANTING_PLAN_SORT_KEYS,
  clearPlantingPlanFilterGroup,
  comparePlantingPlanRecords,
  createPlantingPlanSearchRecord,
  derivePlantingPlanFilterOptions,
  getActivePlantingPlanFilterGroups,
  matchPlantingPlan,
  matchesPlantingPlanFilters,
  matchPlantingPlanSearch,
  withLocationSelection,
  type PlantingPlanFilterGroup,
  type PlantingPlanFilterOptions,
  type PlantingPlanFilters,
  type PlantingPlanMatch,
  type PlantingPlanSearchRecord,
  type PlantingPlanSearchRecordInput,
  type PlantingPlanSortKey,
} from './plantingPlanSearch';

export const PLANTING_PLAN_SEARCH_DEBOUNCE_MS = 150;
const SEASON_SWITCH_STATE_KEY = 'plantingPlanSearch';

interface SearchRow {
  id: number;
  isNew?: boolean;
}

interface SearchState {
  projectId: number | null;
  query: string;
  appliedQuery: string;
  filters: PlantingPlanFilters;
  sortKey: PlantingPlanSortKey;
}

interface SeasonSwitchSnapshot {
  query: string;
  filters: PlantingPlanFilters;
  sortKey: PlantingPlanSortKey;
}

const isNumberArray = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'number');
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');
const isMonthOrNull = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12);

const parseSnapshot = (value: unknown): SeasonSwitchSnapshot | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const { query, filters, sortKey } = value as Record<string, unknown>;
  const filterRecord = (filters ?? {}) as Record<string, unknown>;
  if (
    typeof query !== 'string'
    || !PLANTING_PLAN_SORT_KEYS.includes(sortKey as PlantingPlanSortKey)
    || !isNumberArray(filterRecord.locationIds)
    || !isNumberArray(filterRecord.fieldIds)
    || !isStringArray(filterRecord.cultivationTypes)
    || !isStringArray(filterRecord.cropKeys)
    || !isMonthOrNull(filterRecord.plantingMonthFrom)
    || !isMonthOrNull(filterRecord.plantingMonthTo)
  ) {
    return null;
  }
  return {
    query,
    sortKey: sortKey as PlantingPlanSortKey,
    filters: {
      locationIds: filterRecord.locationIds,
      fieldIds: filterRecord.fieldIds,
      cultivationTypes: filterRecord.cultivationTypes,
      cropKeys: filterRecord.cropKeys,
      plantingMonthFrom: filterRecord.plantingMonthFrom,
      plantingMonthTo: filterRecord.plantingMonthTo,
    },
  };
};

const createInitialState = (projectId: number | null): SearchState => {
  const snapshot = projectId === null
    ? null
    : parseSnapshot(peekSeasonSwitchState(projectId, SEASON_SWITCH_STATE_KEY));
  return {
    projectId,
    query: snapshot?.query ?? '',
    appliedQuery: snapshot?.query ?? '',
    filters: snapshot?.filters ?? EMPTY_PLANTING_PLAN_FILTERS,
    sortKey: snapshot?.sortKey ?? DEFAULT_PLANTING_PLAN_SORT,
  };
};

interface UsePlantingPlanSearchOptions<Row extends SearchRow> {
  /** Every persisted plan of the active season. */
  rows: readonly Row[];
  /** Resolves the display texts search and filters look at. */
  toRecordInput: (row: Row) => PlantingPlanSearchRecordInput;
  projectId: number | null;
}

/** The row-independent part of the search state, as the search UI needs it. */
export type PlantingPlanSearchControls = Omit<PlantingPlanSearchResult<SearchRow>, 'sortedRows' | 'isRowVisible'>;

export interface PlantingPlanSearchResult<Row extends SearchRow> {
  /** The raw input value; `terms` follow it after the debounce. */
  query: string;
  setQuery: (query: string) => void;
  /** Clears the search at once, without waiting for the debounce. */
  clearSearch: () => void;
  terms: readonly string[];
  filters: PlantingPlanFilters;
  setFilters: (filters: PlantingPlanFilters) => void;
  setLocationIds: (locationIds: number[]) => void;
  clearFilterGroup: (group: PlantingPlanFilterGroup) => void;
  resetFilters: () => void;
  sortKey: PlantingPlanSortKey;
  setSortKey: (sortKey: PlantingPlanSortKey) => void;
  activeFilterGroups: PlantingPlanFilterGroup[];
  hasSearch: boolean;
  hasFilters: boolean;
  isActive: boolean;
  options: PlantingPlanFilterOptions;
  /** Matching plans in `sortKey` order (the card list's order). */
  sortedRows: Row[];
  matchById: ReadonlyMap<number, PlantingPlanMatch>;
  noteMatchIds: ReadonlySet<number>;
  totalCount: number;
  shownCount: number;
  /** How many plans the search alone would match, ignoring the filters. */
  searchOnlyCount: number;
  /** The grid's row predicate; `undefined` while nothing is searched or filtered. */
  isRowVisible: ((row: Row) => boolean) | undefined;
}

/**
 * Search, filter and sort state of the planting-plan page. The desktop grid
 * and the mobile card list both read from this one hook, so there is exactly
 * one filter state and both views show the same plans for the same input.
 */
export function usePlantingPlanSearch<Row extends SearchRow>({
  rows,
  toRecordInput,
  projectId,
}: UsePlantingPlanSearchOptions<Row>): PlantingPlanSearchResult<Row> {
  const [state, setState] = useState<SearchState>(() => createInitialState(projectId));

  // A project switch starts from scratch; a season switch keeps the state
  // through `seasonSwitchState` (both reload the app today).
  let current = state;
  if (state.projectId !== projectId) {
    current = createInitialState(projectId);
    setState(current);
  }
  const { query, appliedQuery, filters, sortKey } = current;

  useEffect(() => {
    if (projectId !== null) {
      clearSeasonSwitchState(projectId, SEASON_SWITCH_STATE_KEY);
    }
  }, [projectId]);

  const snapshotRef = useRef<SeasonSwitchSnapshot>({ query, filters, sortKey });
  useEffect(() => {
    snapshotRef.current = { query, filters, sortKey };
  }, [filters, query, sortKey]);
  useEffect(
    () => registerSeasonSwitchState(SEASON_SWITCH_STATE_KEY, () => snapshotRef.current),
    [],
  );

  useEffect(() => {
    if (query === appliedQuery) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setState((previous) => ({ ...previous, appliedQuery: previous.query }));
    }, PLANTING_PLAN_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [appliedQuery, query]);

  const setQuery = useCallback((nextQuery: string): void => {
    setState((previous) => ({ ...previous, query: nextQuery }));
  }, []);
  const clearSearch = useCallback((): void => {
    setState((previous) => ({ ...previous, query: '', appliedQuery: '' }));
  }, []);
  const setFilters = useCallback((nextFilters: PlantingPlanFilters): void => {
    setState((previous) => ({ ...previous, filters: nextFilters }));
  }, []);
  const clearFilterGroup = useCallback((group: PlantingPlanFilterGroup): void => {
    setState((previous) => ({ ...previous, filters: clearPlantingPlanFilterGroup(previous.filters, group) }));
  }, []);
  const resetFilters = useCallback((): void => {
    setState((previous) => ({ ...previous, filters: EMPTY_PLANTING_PLAN_FILTERS }));
  }, []);
  const setSortKey = useCallback((nextSortKey: PlantingPlanSortKey): void => {
    setState((previous) => ({ ...previous, sortKey: nextSortKey }));
  }, []);

  const terms = useMemo(() => tokenizeSearchQuery(appliedQuery), [appliedQuery]);

  const records = useMemo(
    () => rows
      .filter((row) => !row.isNew)
      .map((row) => ({ row, record: createPlantingPlanSearchRecord(toRecordInput(row)) })),
    [rows, toRecordInput],
  );
  // The grid asks with its own row objects; they are normally the same ones
  // the card list holds, and either way go through the same match function.
  const recordByRow = useMemo(
    () => new Map<Row, PlantingPlanSearchRecord>(records.map(({ row, record }) => [row, record])),
    [records],
  );

  const fieldLocationById = useMemo(
    () => new Map(records.map(({ record }) => [record.fieldId ?? -1, record.locationId])),
    [records],
  );
  const setLocationIds = useCallback((locationIds: number[]): void => {
    setState((previous) => ({
      ...previous,
      filters: withLocationSelection(previous.filters, locationIds, fieldLocationById),
    }));
  }, [fieldLocationById]);

  const options = useMemo(
    () => derivePlantingPlanFilterOptions(records.map(({ record }) => record), filters.locationIds),
    [filters.locationIds, records],
  );

  const activeFilterGroups = useMemo(() => getActivePlantingPlanFilterGroups(filters), [filters]);
  const hasSearch = terms.length > 0;
  const hasFilters = activeFilterGroups.length > 0;
  const isActive = hasSearch || hasFilters;

  const { sortedRows, matchById, noteMatchIds, searchOnlyCount } = useMemo(() => {
    const matches = new Map<number, PlantingPlanMatch>();
    const noteMatches = new Set<number>();
    const matched: Array<{ row: Row; record: PlantingPlanSearchRecord }> = [];
    let searchOnly = 0;
    for (const entry of records) {
      const searchMatch = matchPlantingPlanSearch(entry.record, terms);
      if (searchMatch.matches) {
        searchOnly += 1;
      }
      if (!searchMatch.matches || !matchesPlantingPlanFilters(entry.record, filters)) {
        continue;
      }
      matches.set(entry.row.id, searchMatch);
      if (searchMatch.notesMatched) {
        noteMatches.add(entry.row.id);
      }
      matched.push(entry);
    }
    matched.sort((left, right) => comparePlantingPlanRecords(left.record, right.record, sortKey));
    return {
      sortedRows: matched.map(({ row }) => row),
      matchById: matches,
      noteMatchIds: noteMatches,
      searchOnlyCount: searchOnly,
    };
  }, [filters, records, sortKey, terms]);

  const isRowVisible = useMemo(() => {
    if (!isActive) {
      return undefined;
    }
    return (row: Row): boolean => {
      if (row.isNew) {
        return true;
      }
      const record = recordByRow.get(row) ?? createPlantingPlanSearchRecord(toRecordInput(row));
      return matchPlantingPlan(record, terms, filters).matches;
    };
  }, [filters, isActive, recordByRow, terms, toRecordInput]);

  return {
    query,
    setQuery,
    clearSearch,
    terms,
    filters,
    setFilters,
    setLocationIds,
    clearFilterGroup,
    resetFilters,
    sortKey,
    setSortKey,
    activeFilterGroups,
    hasSearch,
    hasFilters,
    isActive,
    options,
    sortedRows,
    matchById,
    noteMatchIds,
    totalCount: records.length,
    shownCount: sortedRows.length,
    searchOnlyCount,
    isRowVisible,
  };
}
