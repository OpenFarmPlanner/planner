import type { Crop, PlantingPlan, PlantingPlanActualDates } from '../api/types';
import { toIsoDateString } from '../components/data-grid/dateEditCellUtils';
import { getPlanPropagationInfo, getPlanSowingSchedule } from '../pages/planSowingDate';
import { parseIsoDate } from '../utils/isoDate';

export type PlantingPlanDateMode = 'planned' | 'actual' | 'combined';

export const ACTUAL_DATE_FIELDS = {
  propagation: 'actual_propagation_start_date',
  sowing: 'actual_sowing_date',
  transplanting: 'actual_transplanting_date',
  harvestStart: 'actual_harvest_start_date',
  harvestEnd: 'recorded_harvest_end_date',
} as const satisfies Record<string, keyof PlantingPlanActualDates>;

export type PlantingPlanActivity = keyof typeof ACTUAL_DATE_FIELDS;
export const PLANTING_PLAN_DATE_COLUMNS = ['sowing_date', 'planting_date', 'harvest_date', 'harvest_end_date'] as const;
export type PlantingPlanDateColumn = (typeof PLANTING_PLAN_DATE_COLUMNS)[number];

export interface PlantingPlanDateComparison {
  activity: PlantingPlanActivity;
  planned: string | null;
  actual: string | null;
}

export function getPlanActivityDates(plan: PlantingPlan, crop?: Crop): PlantingPlanDateComparison[] {
  const schedule = getPlanSowingSchedule(plan, crop);
  const propagation = getPlanPropagationInfo(plan, crop);
  const planned = {
    propagation: propagation.isPreCultivation ? schedule?.sowingDate : null,
    sowing: !propagation.isPreCultivation && !propagation.isPurchasedTransplant ? schedule?.sowingDate : null,
    transplanting: propagation.isPreCultivation || propagation.isPurchasedTransplant ? plan.planting_date : null,
    harvestStart: plan.harvest_date,
    harvestEnd: plan.harvest_end_date,
  };

  return (Object.keys(ACTUAL_DATE_FIELDS) as PlantingPlanActivity[]).map(activity => ({
    activity,
    planned: toIsoDateString(planned[activity]),
    actual: plan[ACTUAL_DATE_FIELDS[activity]] ?? null,
  }));
}

export function getPlanColumnDates(
  plan: PlantingPlan,
  field: PlantingPlanDateColumn,
  crop?: Crop,
): PlantingPlanDateComparison {
  if (field === 'harvest_date') {
    return { activity: 'harvestStart', planned: toIsoDateString(plan.harvest_date), actual: plan.actual_harvest_start_date ?? null };
  }
  if (field === 'harvest_end_date') {
    return { activity: 'harvestEnd', planned: toIsoDateString(plan.harvest_end_date), actual: plan.recorded_harvest_end_date ?? null };
  }

  const propagation = getPlanPropagationInfo(plan, crop);
  if (field === 'planting_date') {
    // This existing column also carries the planned bed start for direct sowing.
    const activity = propagation.isPreCultivation || propagation.isPurchasedTransplant ? 'transplanting' : 'sowing';
    return { activity, planned: toIsoDateString(plan.planting_date), actual: plan[ACTUAL_DATE_FIELDS[activity]] ?? null };
  }
  const activity = propagation.isPreCultivation ? 'propagation' : 'sowing';
  return {
    activity,
    planned: getPlanSowingSchedule(plan, crop)?.sowingDate ?? null,
    actual: plan[ACTUAL_DATE_FIELDS[activity]] ?? null,
  };
}

export function displayedPlanDate(dates: PlantingPlanDateComparison, mode: PlantingPlanDateMode): string | null {
  if (mode === 'planned') return dates.planned;
  if (mode === 'actual') return dates.actual;
  return dates.actual ?? dates.planned;
}

export function planDateDeviation(dates: PlantingPlanDateComparison): number | null {
  const plan = parseIsoDate(dates.planned);
  const actual = parseIsoDate(dates.actual);
  return plan && actual ? (actual.getTime() - plan.getTime()) / 86_400_000 : null;
}
