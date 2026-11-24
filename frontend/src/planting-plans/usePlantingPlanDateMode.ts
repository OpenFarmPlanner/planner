import { useState } from 'react';
import type { PlantingPlanDateMode } from './plantingPlanActualDates';

export const PLANTING_PLAN_DATE_MODES = ['planned', 'actual', 'combined'] as const satisfies readonly PlantingPlanDateMode[];

function readDateMode(key: string | null): PlantingPlanDateMode {
  try {
    const saved = key && localStorage.getItem(key);
    return PLANTING_PLAN_DATE_MODES.find(mode => mode === saved) ?? 'planned';
  } catch {
    return 'planned';
  }
}

export function usePlantingPlanDateMode(userId: number | null) {
  const key = userId == null ? null : `plantingPlans:dateMode:user:${userId}`;
  const [selection, setSelection] = useState(() => ({ key, mode: readDateMode(key) }));
  if (selection.key !== key) {
    setSelection({ key, mode: readDateMode(key) });
  }

  const selectMode = (mode: PlantingPlanDateMode) => {
    setSelection({ key, mode });
    if (key) {
      try {
        localStorage.setItem(key, mode);
      } catch {
        // The selection still works in this view when storage is unavailable.
      }
    }
  };

  return [selection.mode, selectMode] as const;
}
