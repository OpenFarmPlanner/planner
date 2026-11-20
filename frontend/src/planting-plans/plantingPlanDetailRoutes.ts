export const PLANTING_PLANS_PATH = '/app/planting-plans';

export function plantingPlanDetailPath(planId: number, tablePath = PLANTING_PLANS_PATH): string {
  return `${tablePath.replace(/\/$/, '')}/${planId}`;
}

export function plantingPlanIdFromPath(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
