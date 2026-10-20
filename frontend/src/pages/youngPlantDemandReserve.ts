/**
 * The young-plant demand's reserve for losses is a per-viewer convenience:
 * the page remembers the last value this browser used for each project.
 */

/** Bought-in plants commonly fail at a few percent; the user can change it. */
export const DEFAULT_RESERVE_PERCENT = 10;
const RESERVE_STORAGE_KEY_PREFIX = 'ofp.youngPlantDemand.reservePercent.';

/** Per-viewer convenience: the last reserve this browser used for the project. */
export function readStoredReservePercent(projectId: number | null): number {
  if (projectId === null) {
    return DEFAULT_RESERVE_PERCENT;
  }
  try {
    const stored = window.localStorage.getItem(`${RESERVE_STORAGE_KEY_PREFIX}${projectId}`);
    const parsed = stored === null ? Number.NaN : Number(stored);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : DEFAULT_RESERVE_PERCENT;
  } catch {
    return DEFAULT_RESERVE_PERCENT;
  }
}

export function storeReservePercent(projectId: number | null, value: number): void {
  if (projectId === null) {
    return;
  }
  try {
    window.localStorage.setItem(`${RESERVE_STORAGE_KEY_PREFIX}${projectId}`, String(value));
  } catch {
    // Storage may be unavailable (private mode); the value then only lives for this visit.
  }
}

export const clampReservePercent = (value: number | null): number => (
  value === null ? 0 : Math.min(100, Math.max(0, value))
);
