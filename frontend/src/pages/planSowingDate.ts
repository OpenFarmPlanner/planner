import type { Crop, PlantingPlan } from '../api/types';
import { getEffectiveCropValue } from '../crops/varietyValueSource';
import { addUtcDays, formatIsoDate, parseIsoDate } from '../utils/isoDate';

export const PRE_CULTIVATION = 'pre_cultivation';
export const DIRECT_SOWING = 'direct_sowing';
export const PURCHASED_TRANSPLANT = 'purchased_transplant';

type PlanCultivationFields = Pick<
  PlantingPlan,
  'cultivation_type' | 'crop_cultivation_type' | 'crop_cultivation_types'
>;

type PlanPropagationFields = PlanCultivationFields
  & Pick<PlantingPlan, 'crop_propagation_duration_days'>;

type PlanScheduleFields = PlanPropagationFields & Pick<PlantingPlan, 'planting_date'>;

/**
 * `planting_date` is typed as an ISO string, but a DataGrid row mid-edit can
 * briefly hold the `Date` object its own `type: 'date'` column works with
 * instead (the same hazard `toIsoDateString`/`toGridDateValue` exist for in
 * `components/data-grid/dateEditCellUtils.ts`) — this re-derives a column
 * for every row on each render, including rows not currently being edited,
 * so it has to tolerate that rather than only the grid's own date column.
 */
function normalizePlantingDate(value: PlantingPlan['planting_date'] | Date): string | null {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return formatIsoDate(value);
  }
  return value;
}

export interface PlanSowingSchedule {
  isPreCultivation: boolean;
  /** Planted from bought-in young plants: no own Anzucht and no sowing date. */
  isPurchasedTransplant: boolean;
  /** Effective propagation duration in days, or null when not resolvable. */
  propagationDurationDays: number | null;
  /**
   * ISO date the crop must be sown. Equal to `planting_date` for direct
   * sowing. Null for bought-in plants, and when the plan uses Anzucht but no
   * effective propagation duration can be resolved for the crop.
   */
  sowingDate: string | null;
}

/**
 * A Sorte inherits any timing/cultivation field it does not set from its
 * general Kultur via `effective_values`; the plan row already carries the
 * same resolved values as a fallback for crops that can no longer be
 * resolved (e.g. deleted).
 */
function resolveIsPreCultivation(plan: PlanCultivationFields, crop: Crop | undefined): boolean {
  const cropCultivationType = getEffectiveCropValue(crop, 'cultivation_type')
    || plan.crop_cultivation_type || '';
  const cropCultivationTypes = getEffectiveCropValue(crop, 'cultivation_types')
    || plan.crop_cultivation_types || [];
  return plan.cultivation_type === PRE_CULTIVATION
    || (!plan.cultivation_type && (
      cropCultivationType === PRE_CULTIVATION
      || cropCultivationTypes.includes(PRE_CULTIVATION)
    ));
}

function resolvePropagationDurationDays(
  plan: PlanPropagationFields,
  crop: Crop | undefined,
): number | null {
  return getEffectiveCropValue(crop, 'propagation_duration_days')
    ?? plan.crop_propagation_duration_days
    ?? null;
}

export interface PlanPropagationInfo {
  isPreCultivation: boolean;
  isPurchasedTransplant: boolean;
  propagationDurationDays: number | null;
}

const isPurchasedTransplantPlan = (plan: PlanCultivationFields): boolean => (
  plan.cultivation_type === PURCHASED_TRANSPLANT
);

/**
 * Whether a plan uses Anzucht and its effective propagation duration,
 * without requiring a planting date. Used to decide whether a sowing-date
 * input can be computed at all (independent of whether a planting date has
 * been entered yet).
 */
export function getPlanPropagationInfo(
  plan: PlanPropagationFields,
  crop: Crop | undefined,
): PlanPropagationInfo {
  const isPurchasedTransplant = isPurchasedTransplantPlan(plan);
  const isPreCultivation = resolveIsPreCultivation(plan, crop);
  if (!isPreCultivation) {
    return { isPreCultivation: false, isPurchasedTransplant, propagationDurationDays: null };
  }
  return {
    isPreCultivation: true,
    isPurchasedTransplant: false,
    propagationDurationDays: resolvePropagationDurationDays(plan, crop),
  };
}

/**
 * Resolves whether a plan is grown via Anzucht and, if so, its sowing date
 * (planting date minus the crop's effective propagation duration). Bought-in
 * plants have neither Anzucht nor a sowing date. Returns null when the plan
 * has no planting date yet (nothing to anchor on).
 */
export function getPlanSowingSchedule(
  plan: PlanScheduleFields,
  crop: Crop | undefined,
): PlanSowingSchedule | null {
  const plantingDateIso = normalizePlantingDate(plan.planting_date);
  if (!plantingDateIso) {
    return null;
  }

  if (isPurchasedTransplantPlan(plan)) {
    return { isPreCultivation: false, isPurchasedTransplant: true, propagationDurationDays: null, sowingDate: null };
  }

  const isPreCultivation = resolveIsPreCultivation(plan, crop);
  if (!isPreCultivation) {
    return { isPreCultivation: false, isPurchasedTransplant: false, propagationDurationDays: null, sowingDate: plantingDateIso };
  }

  const propagationDurationDays = resolvePropagationDurationDays(plan, crop);
  if (!propagationDurationDays || propagationDurationDays <= 0) {
    return { isPreCultivation: true, isPurchasedTransplant: false, propagationDurationDays: null, sowingDate: null };
  }

  const plantingDate = parseIsoDate(plantingDateIso);
  if (!plantingDate) {
    return { isPreCultivation: true, isPurchasedTransplant: false, propagationDurationDays, sowingDate: null };
  }

  const sowingDate = formatIsoDate(addUtcDays(plantingDate, -propagationDurationDays));
  return { isPreCultivation: true, isPurchasedTransplant: false, propagationDurationDays, sowingDate };
}

/**
 * Inverse of `getPlanSowingSchedule`'s sowing date: given a sowing date the
 * user just entered, resolves the planting date to store. Identity for
 * direct sowing. Returns the sowing date unchanged if the plan uses Anzucht
 * but has no resolvable propagation duration (the sowing-date cell is not
 * editable in that case, so this should not normally be reached).
 */
export function getPlantingDateFromSowingDate(
  sowingDateIso: string,
  plan: PlanPropagationFields,
  crop: Crop | undefined,
): string {
  if (!resolveIsPreCultivation(plan, crop)) {
    return sowingDateIso;
  }

  const propagationDurationDays = resolvePropagationDurationDays(plan, crop);
  if (!propagationDurationDays || propagationDurationDays <= 0) {
    return sowingDateIso;
  }

  const sowingDate = parseIsoDate(sowingDateIso);
  if (!sowingDate) {
    return sowingDateIso;
  }

  return formatIsoDate(addUtcDays(sowingDate, propagationDurationDays));
}
