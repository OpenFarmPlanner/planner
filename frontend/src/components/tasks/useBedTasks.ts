import { useCallback, useEffect, useMemo, useState } from 'react';
import { plantingPlanAPI, taskAPI } from '../../api/api';
import type { PlantingPlan, Task } from '../../api/types';
import { linkTasksToBeds, linkTasksToPlans } from './bedTaskUrgency';

type GrowingArea = 'bed' | 'location';
const NO_BED_TASKS: ReadonlyMap<number, readonly Task[]> = new Map();
const NO_PLANS: readonly PlantingPlan[] = [];

function useScopedRead<T>(
  scope: string | null, load: (signal: AbortSignal) => Promise<{ results: T[] }>,
) {
  const [attempt, setAttempt] = useState(0);
  const query = useMemo(() => scope === null ? null : { scope, attempt }, [scope, attempt]);
  const [result, setResult] = useState<{ query: NonNullable<typeof query>; rows: readonly T[] | null } | null>(null);
  const refresh = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    if (query === null) return;
    const request = new AbortController();
    const { signal } = request;
    void load(signal).then(({ results }) => {
      if (!signal.aborted) setResult({ query, rows: results });
    }).catch(() => {
      if (!signal.aborted) setResult({ query, rows: null });
    });
    return () => request.abort();
  }, [query, load]);

  useEffect(() => {
    if (scope === null) return;
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [scope, refresh]);

  const current = result?.query === query ? result : null;
  return {
    rows: current?.rows ?? null,
    loading: query !== null && current === null,
    failed: current?.rows === null,
    refresh,
  };
}

export function useAreaPlantingPlans(area: GrowingArea, areaId: number | null, seasonId?: number) {
  const load = useCallback((signal: AbortSignal) => plantingPlanAPI.listForArea(area, areaId!, signal), [area, areaId]);
  const scope = areaId === null || seasonId === undefined ? null : `${area}:${areaId}:${seasonId}`;
  const result = useScopedRead(scope, load);
  return { ...result, plans: result.rows ?? NO_PLANS };
}

export function useBedTasks(
  area: GrowingArea, areaId: number | null, seasonId: number | undefined,
  { sharedPlans, includeCancelled = false }: {
    sharedPlans?: ReturnType<typeof useAreaPlantingPlans>;
    includeCancelled?: boolean;
  } = {},
) {
  const internalPlans = useAreaPlantingPlans(area, sharedPlans ? null : areaId, seasonId);
  const plans = sharedPlans ?? internalPlans;
  const scope = areaId === null || seasonId === undefined ? null : `${area}:${areaId}:${seasonId}`;
  const taskRequest = useScopedRead(scope, taskAPI.listAll);
  const rows = taskRequest.rows;
  const tasksByBed = useMemo(() => rows && plans.rows ? linkTasksToBeds(rows, plans.rows, includeCancelled) : NO_BED_TASKS,
    [includeCancelled, plans.rows, rows]);
  const tasksByPlan = useMemo(() => rows ? linkTasksToPlans(rows, includeCancelled) : NO_BED_TASKS,
    [includeCancelled, rows]);
  return {
    tasksByBed,
    tasksByPlan,
    planTasksLoading: taskRequest.loading,
    planTasksFailed: taskRequest.failed,
    loading: scope !== null && (plans.loading || taskRequest.loading),
    failed: scope !== null && (plans.failed || taskRequest.failed),
    refresh: () => {
      if (plans.failed) plans.refresh();
      taskRequest.refresh();
    },
  };
}
