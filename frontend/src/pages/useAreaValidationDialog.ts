import { useCallback, useEffect, useRef, useState } from "react";

import type { SuccessionLimit } from "../api/types";

/**
 * State and timer lifecycle for the planting-plan area-validation dialog.
 *
 * Extracted from PlantingPlans.tsx. Owns the dialog's visible state, the
 * "suppress the next save cycle" flag used to avoid re-triggering validation
 * right after the dialog closes, and the close-suppression timer. The two
 * refs are returned so the page's save-guard and commit handler can read/reset
 * them, matching the original inline behavior.
 */

// After the dialog closes we briefly suppress the follow-up save so closing it
// does not immediately re-open validation for the same edit cycle.
const AREA_VALIDATION_CLOSE_SUPPRESSION_MS = 250;

export interface AreaValidationDialogState {
  rowId: number;
  requestedArea: number;
  availableArea: number;
  bedArea: number;
  occupiedArea: number;
  cropId?: number;
  plantsCount?: number | null;
  mode: "bedLimit" | "remainingLimit" | "noRemainingArea";
  /** When a follow-up may take over the bed; named in the remaining-area modes. */
  successionLimit?: SuccessionLimit | null;
}

export interface UseAreaValidationDialogResult {
  areaValidationDialog: AreaValidationDialogState | null;
  setAreaValidationDialog: React.Dispatch<React.SetStateAction<AreaValidationDialogState | null>>;
  areaValidationDialogRef: React.MutableRefObject<AreaValidationDialogState | null>;
  suppressAreaValidationSaveRef: React.MutableRefObject<boolean>;
  clearAreaValidationCloseTimer: () => void;
  openAreaValidationDialog: (dialog: AreaValidationDialogState) => void;
  closeAreaValidationDialog: () => void;
}

export function useAreaValidationDialog(): UseAreaValidationDialogResult {
  const [areaValidationDialog, setAreaValidationDialog] = useState<AreaValidationDialogState | null>(null);
  const areaValidationDialogRef = useRef<AreaValidationDialogState | null>(null);
  const suppressAreaValidationSaveRef = useRef(false);
  const areaValidationCloseTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  const clearAreaValidationCloseTimer = useCallback((): void => {
    if (areaValidationCloseTimerRef.current === null) {
      return;
    }
    window.clearTimeout(areaValidationCloseTimerRef.current);
    areaValidationCloseTimerRef.current = null;
  }, []);

  const suppressAreaValidationSaveCycle = useCallback((): void => {
    suppressAreaValidationSaveRef.current = true;
    clearAreaValidationCloseTimer();
    areaValidationCloseTimerRef.current = window.setTimeout(() => {
      suppressAreaValidationSaveRef.current = false;
      areaValidationCloseTimerRef.current = null;
    }, AREA_VALIDATION_CLOSE_SUPPRESSION_MS);
  }, [clearAreaValidationCloseTimer]);

  const openAreaValidationDialog = useCallback((dialog: AreaValidationDialogState): void => {
    clearAreaValidationCloseTimer();
    suppressAreaValidationSaveRef.current = false;
    areaValidationDialogRef.current = dialog;
    setAreaValidationDialog(dialog);
  }, [clearAreaValidationCloseTimer]);

  const closeAreaValidationDialog = useCallback((): void => {
    areaValidationDialogRef.current = null;
    suppressAreaValidationSaveCycle();
    setAreaValidationDialog(null);
  }, [suppressAreaValidationSaveCycle]);

  useEffect(() => () => {
    clearAreaValidationCloseTimer();
  }, [clearAreaValidationCloseTimer]);

  return {
    areaValidationDialog,
    setAreaValidationDialog,
    areaValidationDialogRef,
    suppressAreaValidationSaveRef,
    clearAreaValidationCloseTimer,
    openAreaValidationDialog,
    closeAreaValidationDialog,
  };
}
