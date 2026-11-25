import { useCallback, useEffect, useState } from 'react';
import { plantingPlanAPI, taskAPI } from '../../api/api';
import type { Task } from '../../api/types';
import { linkTasksToBeds } from './bedTaskUrgency';

const NO_BED_TASKS: ReadonlyMap<number, readonly Task[]> = new Map();

export function useBedTasks(
  area: 'bed' | 'location', areaId: number | null, seasonId: number | undefined,
) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    byBed: ReadonlyMap<number, readonly Task[]>;
    failed: boolean;
  } | null>(null);
  const key = areaId === null || seasonId === undefined ? null : `${area}:${areaId}:${seasonId}:${attempt}`;
  const refresh = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    if (key === null || areaId === null) return;
    const request = new AbortController();
    const { signal } = request;
    void Promise.all([plantingPlanAPI.listForArea(area, areaId, signal), taskAPI.listAll(signal)])
      .then(([plans, tasks]) => {
        if (!signal.aborted) setResult({ key, byBed: linkTasksToBeds(tasks.results, plans.results), failed: false });
      }).catch(() => {
        if (!signal.aborted) setResult({ key, byBed: NO_BED_TASKS, failed: true });
      });
    return () => request.abort();
  }, [area, areaId, key]);

  useEffect(() => {
    if (areaId === null || seasonId === undefined) return;
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [areaId, seasonId, refresh]);

  const current = result?.key === key ? result : null;
  return {
    tasksByBed: current?.byBed ?? NO_BED_TASKS,
    loading: key !== null && current === null,
    failed: current?.failed ?? false,
    refresh,
  };
}
