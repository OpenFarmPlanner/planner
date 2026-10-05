import type { Crop, PlantingPlan } from '../api/types';
import { getEffectiveCropValue } from '../crops/varietyValueSource';
import { addUtcDays, formatIsoDate, parseIsoDate } from '../utils/isoDate';

export const PRE_CULTIVATION = 'pre_cultivation';
export const DIRECT_SOWING = 'direct_sowing';

type PlanCultivationFields = Pick<
  PlantingPlan,
  'cultivation_type' | 'crop_cultivation_type' | 'crop_cultivation_types'
>;

type PlanPropagationFields = PlanCultivationFields
  & Pick<PlantingPlan, 'crop_propagation_duration_days'>;

type PlanScheduleFields = PlanPropagationFields & Pick<PlantingPlan, 'planting_date'>;

export interface PlanSowingSchedule {
  isPreCultivation: boolean;
  /** Effective propagation duration in days, or null when not resolvable. */
  propagationDurationDays: number | null;
  /**
   * ISO date the crop must be sown. Equal to `planting_date` for direct
   * sowing. Null only when the plan uses Anzucht but no effective
   * propagation duration can be resolved for the crop.
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
  propagationDurationDays: number | null;
}

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
  const isPreCultivation = resolveIsPreCultivation(plan, crop);
  if (!isPreCultivation) {
    return { isPreCultivation: false, propagationDurationDays: null };
  }
  return { isPreCultivation: true, propagationDurationDays: resolvePropagationDurationDays(plan, crop) };
}

/**
 * Resolves whether a plan is grown via Anzucht and, if so, its sowing date
 * (planting date minus the crop's effective propagation duration). Returns
 * null when the plan has no planting date yet (nothing to anchor on).
 */
export function getPlanSowingSchedule(
  plan: PlanScheduleFields,
  crop: Crop | undefined,
): PlanSowingSchedule | null {
  if (!plan.planting_date) {
    return null;
  }

  const isPreCultivation = resolveIsPreCultivation(plan, crop);
  if (!isPreCultivation) {
    return { isPreCultivation: false, propagationDurationDays: null, sowingDate: plan.planting_date };
  }

  const propagationDurationDays = resolvePropagationDurationDays(plan, crop);
  if (!propagationDurationDays || propagationDurationDays <= 0) {
    return { isPreCultivation: true, propagationDurationDays: null, sowingDate: null };
  }

  const plantingDate = parseIsoDate(plan.planting_date);
  if (!plantingDate) {
    return { isPreCultivation: true, propagationDurationDays, sowingDate: null };
  }

  const sowingDate = formatIsoDate(addUtcDays(plantingDate, -propagationDurationDays));
  return { isPreCultivation: true, propagationDurationDays, sowingDate };
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
