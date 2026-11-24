import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { plantingPlanAPI } from '../api/api';
import type { HarvestOverlap, PlantingPlan } from '../api/types';
import type { DataGridAPI } from '../components/data-grid';
import type { PlantingPlanRow } from '../pages/plantingPlansUtils';

interface OverlapScope {
  key: string;
  plans: Map<number, PlantingPlan>;
  overlaps: Map<number, HarvestOverlap[]>;
  pending: Map<number, AbortController>;
}

const emptyOverlaps: HarvestOverlap[] = [];
const occupancyFields = [
  'bed', 'crop', 'planting_date', 'harvest_date', 'harvest_end_date', 'clearing_date',
  'area_usage_sqm', 'cultivation_type', 'season',
] as const;

function occupancyChanged(previous: PlantingPlan | undefined, saved: PlantingPlan): boolean {
  return !previous || occupancyFields.some(field => previous[field] !== saved[field])
    || previous.seasonal_harvest?.occupancy_start_date !== saved.seasonal_harvest?.occupancy_start_date;
}

function sameOverlaps(previous: HarvestOverlap[], next: HarvestOverlap[]): boolean {
  return previous.length === next.length && previous.every((item, index) => {
    const other = next[index];
    return item.role === other.role && item.date === other.date
      && item.other_plan_id === other.other_plan_id && item.other_crop_label === other.other_crop_label;
  });
}

export function usePlantingPlanGridAPI(scopeKey: string) {
  const active = useRef<OverlapScope | null>(null);
  const [overrides, setOverrides] = useState<{ key: string; values: Map<number, HarvestOverlap[]> } | null>(null);
  const visibleOverrides = overrides?.key === scopeKey ? overrides.values : undefined;

  useLayoutEffect(() => {
    const scope: OverlapScope = { key: scopeKey, plans: new Map(), overlaps: new Map(), pending: new Map() };
    active.current = scope;
    return () => {
      active.current = null;
      scope.pending.forEach(controller => controller.abort());
    };
  }, [scopeKey]);

  const getRowHarvestOverlaps = useCallback((row: PlantingPlanRow) => {
    return row.isNew ? undefined : visibleOverrides?.get(row.id) ?? row.harvest_overlaps;
  }, [visibleOverrides]);

  const api = useMemo(() => {
    const getActiveScope = () => active.current?.key === scopeKey ? active.current : null;
    const applyOverlaps = (scope: OverlapScope, plans: PlantingPlan[]) => {
      const changed = new Map<number, HarvestOverlap[]>();
      for (const plan of plans) {
        if (typeof plan.id !== 'number') continue;
        const next = plan.harvest_overlaps ?? emptyOverlaps;
        if (!sameOverlaps(scope.overlaps.get(plan.id) ?? emptyOverlaps, next)) {
          scope.overlaps.set(plan.id, next);
          changed.set(plan.id, next);
        }
      }
      if (changed.size) {
        setOverrides(previous => ({
          key: scopeKey,
          values: new Map([...(previous?.key === scopeKey ? previous.values : []), ...changed]),
        }));
      }
    };

    const refreshBed = async (scope: OverlapScope, bed: number) => {
      scope.pending.get(bed)?.abort();
      const controller = new AbortController();
      scope.pending.set(bed, controller);
      try {
        const { results } = await plantingPlanAPI.listForArea('bed', bed, controller.signal);
        if (active.current !== scope || controller.signal.aborted) return;
        // A plan can move again while its old bed is being refreshed.
        applyOverlaps(scope, results.filter(plan => plan.id != null && scope.plans.get(plan.id)?.bed === bed));
      } catch (error) {
        if (!controller.signal.aborted) console.error('Error refreshing the bed’s harvest overlaps:', error);
      } finally {
        if (scope.pending.get(bed) === controller) scope.pending.delete(bed);
      }
    };

    const refreshAfterWrite = (scope: OverlapScope | null, id: number, saved?: PlantingPlan) => {
      if (!scope || active.current !== scope) return;
      const previous = scope.plans.get(id);
      if (saved) {
        scope.plans.set(id, saved);
        applyOverlaps(scope, [saved]);
        if (!occupancyChanged(previous, saved)) return;
      } else {
        scope.plans.delete(id);
        scope.overlaps.delete(id);
      }
      for (const bed of new Set([previous?.bed, saved?.bed])) {
        if (bed) void refreshBed(scope, bed);
      }
    };

    return {
      list: async () => {
        const scope = getActiveScope();
        const data = await plantingPlanAPI.listAll();
        if (scope && active.current === scope) {
          scope.pending.forEach(controller => controller.abort());
          scope.pending.clear();
          scope.plans.clear();
          scope.overlaps.clear();
          for (const plan of data.results) {
            if (typeof plan.id !== 'number') continue;
            scope.plans.set(plan.id, plan);
            if (plan.harvest_overlaps?.length) scope.overlaps.set(plan.id, plan.harvest_overlaps);
          }
          setOverrides(null);
        }
        return { data };
      },
      create: async (data: PlantingPlan) => {
        const scope = getActiveScope();
        const response = await plantingPlanAPI.create(data);
        if (response.data.id != null) refreshAfterWrite(scope, response.data.id, response.data);
        return response;
      },
      update: async (id: number, data: PlantingPlan) => {
        const scope = getActiveScope();
        const response = await plantingPlanAPI.update(id, data);
        refreshAfterWrite(scope, id, response.data);
        return response;
      },
      patch: async (id: number, data: Partial<PlantingPlan>) => {
        const scope = getActiveScope();
        const response = await plantingPlanAPI.patch(id, data);
        refreshAfterWrite(scope, id, response.data);
        return response;
      },
      delete: async (id: number) => {
        const scope = getActiveScope();
        await plantingPlanAPI.delete(id);
        refreshAfterWrite(scope, id);
      },
    } as unknown as DataGridAPI<PlantingPlanRow> & Pick<typeof plantingPlanAPI, 'patch'>;
  }, [scopeKey]);

  return { api, getRowHarvestOverlaps };
}
