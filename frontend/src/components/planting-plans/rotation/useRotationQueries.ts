import { useEffect, useMemo, useState } from 'react';

import { plantingPlanAPI } from '../../../api/api';
import type {
  BedSuggestionsResponse,
  RemainingAreaResponse,
  RotationCheckResponse,
  RotationQueryParams,
} from '../../../api/types';

const ROTATION_QUERY_DEBOUNCE_MS = 250;

interface QueryState<T> {
  key: string | null;
  data: T | null;
  error: boolean;
}

export interface RotationQueryResult<T> {
  data: T | null;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Debounced GET for one rotation endpoint. A `null` request means "not enough
 * input yet"; results are keyed by request so a stale response never shows
 * for newer input.
 */
function useDebouncedRotationQuery<P extends object, T>(
  request: P | null,
  fetcher: (params: P) => Promise<{ data: T }>,
): RotationQueryResult<T> {
  const key = request ? JSON.stringify(request) : null;
  const [state, setState] = useState<QueryState<T>>({ key: null, data: null, error: false });

  useEffect(() => {
    if (!key) {
      return undefined;
    }
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      // Through a promise chain, so a synchronous throw ends as `isError`
      // rather than as an uncaught error in a timer.
      Promise.resolve()
        .then(() => fetcher(JSON.parse(key) as P))
        .then((response) => {
          if (!cancelled) {
            setState({ key, data: response.data, error: false });
          }
        })
        .catch(() => {
          if (!cancelled) {
            setState({ key, data: null, error: true });
          }
        });
    }, ROTATION_QUERY_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [fetcher, key]);

  return useMemo(() => {
    if (!key) {
      return { data: null, isLoading: false, isError: false };
    }
    const isCurrent = state.key === key;
    return {
      data: isCurrent ? state.data : null,
      isLoading: !isCurrent,
      isError: isCurrent && state.error,
    };
  }, [key, state]);
}

const fetchRotationCheck = (params: RotationQueryParams & { bed_id: number }) => plantingPlanAPI.rotationCheck(params);
const fetchBedSuggestions = (params: RotationQueryParams) => plantingPlanAPI.bedSuggestions(params);
const fetchRemainingArea = (params: Parameters<typeof plantingPlanAPI.remainingArea>[0]) => (
  plantingPlanAPI.remainingArea(params)
);

export interface RotationInput {
  cropId: number | null;
  bedId: number | null;
  /** ISO date (YYYY-MM-DD) or null while the field is empty/invalid. */
  plantingDate: string | null;
  planId: number | null;
  /**
   * ISO date the plan stops occupying the bed. Without it the backend derives
   * the end from the crop's timing, like a saved plan would.
   */
  endDate?: string | null;
  /** The plan's area in m²; without it the bed capacity is not checked. */
  areaSqm?: number | null;
}

const buildBaseParams = (
  cropId: number | null,
  plantingDate: string | null,
  planId: number | null,
  endDate: string | null | undefined,
): RotationQueryParams | null => {
  if (!cropId || !plantingDate) {
    return null;
  }
  return {
    crop_id: cropId,
    planting_date: plantingDate,
    ...(endDate ? { end_date: endDate } : {}),
    ...(planId ? { exclude_plan_id: planId } : {}),
  };
};

export function useRotationCheck(input: RotationInput): RotationQueryResult<RotationCheckResponse> {
  const { cropId, bedId, plantingDate, planId, endDate } = input;
  const request = useMemo(() => {
    const base = buildBaseParams(cropId, plantingDate, planId, endDate);
    return base && bedId ? { ...base, bed_id: bedId } : null;
  }, [bedId, cropId, endDate, planId, plantingDate]);
  return useDebouncedRotationQuery(request, fetchRotationCheck);
}

/**
 * Every bed of the project for the culture and period, with its rotation fit
 * and free area — the batch behind the bed options and the suggestions.
 */
export function useBedSuggestions(
  input: RotationInput,
  enabled: boolean,
): RotationQueryResult<BedSuggestionsResponse> {
  const { cropId, plantingDate, planId, endDate, areaSqm } = input;
  const request = useMemo(() => {
    const base = enabled ? buildBaseParams(cropId, plantingDate, planId, endDate) : null;
    return base && areaSqm && areaSqm > 0 ? { ...base, area_sqm: areaSqm } : base;
  }, [areaSqm, cropId, enabled, endDate, planId, plantingDate]);
  return useDebouncedRotationQuery(request, fetchBedSuggestions);
}

/**
 * The bed capacity of the plan as entered, live: its harvest overlaps with
 * other plans on the bed (docs/bed-occupancy.md). Needs crop, bed, planting
 * date and an area; the backend derives the harvest phase from the crop.
 */
export function useHarvestOverlapCheck(input: RotationInput): RotationQueryResult<RemainingAreaResponse> {
  const { cropId, bedId, plantingDate, planId, areaSqm } = input;
  const request = useMemo(() => {
    if (!cropId || !bedId || !plantingDate || !areaSqm || areaSqm <= 0) {
      return null;
    }
    return {
      bed_id: bedId,
      start_date: plantingDate,
      crop_id: cropId,
      area_sqm: areaSqm,
      ...(planId ? { exclude_plan_id: planId } : {}),
    };
  }, [areaSqm, bedId, cropId, planId, plantingDate]);
  return useDebouncedRotationQuery(request, fetchRemainingArea);
}
