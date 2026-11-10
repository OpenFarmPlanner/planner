import { useCallback, useEffect, useRef, useState } from 'react';
import { HIGHLIGHT_FLASH_DURATION_MS } from '../components/feedback/highlightFlashStyles';

interface PinnedPlan {
  id: number;
  /** The sort the list had when the plan was created; another sort drops the pin. */
  sortKey: string;
}

/**
 * The planting plan just created in the mobile list: it is listed first and
 * flashes briefly. The pin does not expire on a timer (the card never jumps
 * away under the user); it ends with the next sort change or page reload.
 */
export function useCreatedPlanPin(sortKey: string): {
  pinnedPlanId: number | null;
  flashingPlanId: number | null;
  pinCreatedPlan: (planId: number) => void;
} {
  const [pinnedPlan, setPinnedPlan] = useState<PinnedPlan | null>(null);
  const [flashingPlanId, setFlashingPlanId] = useState<number | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  // Re-sorting is the explicit "put it where it belongs" signal.
  let activePin = pinnedPlan;
  if (pinnedPlan && pinnedPlan.sortKey !== sortKey) {
    activePin = null;
    setPinnedPlan(null);
  }

  useEffect(() => () => {
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
  }, []);

  const pinCreatedPlan = useCallback((planId: number): void => {
    setPinnedPlan({ id: planId, sortKey });
    setFlashingPlanId(planId);
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => {
      setFlashingPlanId(null);
      flashTimerRef.current = null;
    }, HIGHLIGHT_FLASH_DURATION_MS);
  }, [sortKey]);

  return { pinnedPlanId: activePin?.id ?? null, flashingPlanId, pinCreatedPlan };
}

/**
 * `sortedRows` with the pinned plan moved to the front. The plan is taken
 * from `allRows` when the search or filters would hide it, so a plan the user
 * just saved never stays invisible; the filters themselves are not changed.
 */
export function withPinnedRowFirst<Row extends { id: number }>(
  sortedRows: Row[],
  allRows: Row[],
  pinnedId: number | null,
): Row[] {
  if (pinnedId === null) return sortedRows;
  const pinnedRow = sortedRows.find((row) => row.id === pinnedId) ?? allRows.find((row) => row.id === pinnedId);
  if (!pinnedRow) return sortedRows;
  return [pinnedRow, ...sortedRows.filter((row) => row.id !== pinnedId)];
}
