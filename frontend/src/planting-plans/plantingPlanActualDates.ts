import type { TFunction } from 'i18next';
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
  plannedDates?: string[];
}

type ActivityDatePlan = PlantingPlanActualDates & Pick<PlantingPlan,
  'cultivation_type' | 'crop_cultivation_type' | 'crop_cultivation_types' | 'crop_propagation_duration_days'
  | 'planting_date' | 'planned_sowing_date' | 'planned_propagation_start_date'
  | 'harvest_date' | 'harvest_end_date' | 'seasonal_harvest'>;

function harvestComparison(plan: ActivityDatePlan, activity: 'harvestStart' | 'harvestEnd'): PlantingPlanDateComparison {
  const isStart = activity === 'harvestStart';
  const harvest = plan.seasonal_harvest;
  if (harvest) {
    const plannedDates = harvest.periods.map(period => isStart ? period.start_date : period.end_date);
    return {
      activity,
      planned: plannedDates[0] ?? null,
      plannedDates,
      actual: isStart ? harvest.actual_start_date : harvest.actual_end_date,
    };
  }
  return {
    activity,
    planned: toIsoDateString(isStart ? plan.harvest_date : plan.harvest_end_date),
    actual: plan[ACTUAL_DATE_FIELDS[activity]] ?? null,
  };
}

export function getPlanActivityDates(plan: ActivityDatePlan, crop?: Crop): PlantingPlanDateComparison[] {
  const schedule = getPlanSowingSchedule(plan, crop);
  const propagation = getPlanPropagationInfo(plan, crop);
  const planned = {
    propagation: propagation.isPreCultivation ? schedule?.sowingDate : null,
    sowing: propagation.isPreCultivation ? plan.planned_sowing_date : schedule?.sowingDate,
    transplanting: propagation.isPreCultivation || propagation.isPurchasedTransplant
      ? plan.planting_date : null,
  };

  return (Object.keys(ACTUAL_DATE_FIELDS) as PlantingPlanActivity[]).map(activity => (
    activity === 'harvestStart' || activity === 'harvestEnd'
      ? harvestComparison(plan, activity)
      : {
        activity,
        planned: toIsoDateString(planned[activity]),
        actual: plan[ACTUAL_DATE_FIELDS[activity]] ?? null,
      }
  ));
}

export function getPlanColumnDates(
  plan: PlantingPlan,
  field: PlantingPlanDateColumn,
  crop?: Crop,
): PlantingPlanDateComparison {
  if (field === 'harvest_date') {
    return harvestComparison(plan, 'harvestStart');
  }
  if (field === 'harvest_end_date') {
    return harvestComparison(plan, 'harvestEnd');
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

export function displayedPlanDates(dates: PlantingPlanDateComparison, mode: PlantingPlanDateMode): string[] {
  if (dates.plannedDates && (mode === 'planned' || (mode === 'combined' && !dates.actual))) {
    return dates.plannedDates;
  }
  const date = displayedPlanDate(dates, mode);
  return date ? [date] : [];
}

export function planDateDeviation(dates: PlantingPlanDateComparison): number | null {
  if ((dates.plannedDates?.length ?? 0) > 1) return null;
  const plan = parseIsoDate(dates.planned);
  const actual = parseIsoDate(dates.actual);
  return plan && actual ? (actual.getTime() - plan.getTime()) / 86_400_000 : null;
}

export function planDateDeviationLabel(dates: PlantingPlanDateComparison, t: TFunction): string | undefined {
  const deviation = planDateDeviation(dates);
  if (deviation === null) return undefined;
  if (deviation === 0) return t('plantingPlans:actualDates.same');
  return deviation < 0
    ? t('plantingPlans:actualDates.early', { count: -deviation })
    : t('plantingPlans:actualDates.late', { count: deviation });
}
