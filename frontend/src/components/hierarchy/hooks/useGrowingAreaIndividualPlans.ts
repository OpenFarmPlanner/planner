import { useEffect, useMemo, useState } from 'react';
import { plantingPlanAPI } from '../../../api/api';
import type { IndividualPlantPlanSummary } from '../../../api/types';

const EMPTY_PLANS: readonly IndividualPlantPlanSummary[] = [];

/** Only read the selected project's season while its list is visible. */
export function useGrowingAreaIndividualPlans(projectId: number | null, seasonId?: number) {
  const [retry, setRetry] = useState(0);
  const scope = useMemo(() => projectId && seasonId ? { projectId, seasonId, retry } : null, [projectId, seasonId, retry]);
  const [result, setResult] = useState<{ scope: NonNullable<typeof scope>; plans: IndividualPlantPlanSummary[] | null } | null>(null);

  useEffect(() => {
    if (!scope) return;
    const request = new AbortController();
    const { signal } = request;
    void plantingPlanAPI.listIndividualPlans(signal).then(({ results }) => {
      if (!signal.aborted) setResult({ scope, plans: results });
    }).catch(() => {
      if (!signal.aborted) setResult({ scope, plans: null });
    });
    return () => request.abort();
  }, [scope]);

  const plans = result?.scope === scope ? result.plans : undefined;
  return { plans: plans ?? EMPTY_PLANS, loading: scope !== null && plans === undefined,
    failed: plans === null, refresh: () => setRetry(previous => previous + 1) };
}
