import { useEffect, useMemo, useState } from 'react';

import { plantingPlanAPI } from '../../../api/api';
import type {
  BedSuggestionsResponse,
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

export interface RotationInput {
  cropId: number | null;
  bedId: number | null;
  /** ISO date (YYYY-MM-DD) or null while the field is empty/invalid. */
  plantingDate: string | null;
  planId: number | null;
}

const buildBaseParams = (input: RotationInput): RotationQueryParams | null => {
  if (!input.cropId || !input.plantingDate) {
    return null;
  }
  return {
    crop_id: input.cropId,
    planting_date: input.plantingDate,
    ...(input.planId ? { exclude_plan_id: input.planId } : {}),
  };
};

export function useRotationCheck(input: RotationInput): RotationQueryResult<RotationCheckResponse> {
  const { cropId, bedId, plantingDate, planId } = input;
  const request = useMemo(() => {
    const base = buildBaseParams({ cropId, bedId, plantingDate, planId });
    return base && bedId ? { ...base, bed_id: bedId } : null;
  }, [bedId, cropId, planId, plantingDate]);
  return useDebouncedRotationQuery(request, fetchRotationCheck);
}

export function useBedSuggestions(
  input: RotationInput,
  enabled: boolean,
): RotationQueryResult<BedSuggestionsResponse> {
  const { cropId, plantingDate, planId } = input;
  const request = useMemo(
    () => (enabled ? buildBaseParams({ cropId, bedId: null, plantingDate, planId }) : null),
    [cropId, enabled, planId, plantingDate],
  );
  return useDebouncedRotationQuery(request, fetchBedSuggestions);
}
