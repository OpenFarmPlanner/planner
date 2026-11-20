export const PLANTING_PLANS_PATH = '/app/planting-plans';

export function isPlantingPlanDetailPath(pathname: string): boolean {
  return /\/app\/(planting-plans|anbauplaene)\/\d+\/?$/.test(pathname);
}

export function plantingPlanDetailPath(planId: number, tablePath = PLANTING_PLANS_PATH): string {
  // Accept a path that already carries a plan id so a detail path is never nested.
  return `${tablePath.replace(/\/\d*$/, '')}/${planId}`;
}

export function plantingPlanIdFromPath(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
