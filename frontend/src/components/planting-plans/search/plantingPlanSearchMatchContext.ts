import { createContext, useContext } from 'react';

import type { PlantingPlanMatch } from '../../../pages/plantingPlanSearch';

const NO_MATCHES: ReadonlyMap<number, PlantingPlanMatch> = new Map();

/** Per-plan search match details (synonym and notes hits), keyed by plan id. */
export const PlantingPlanSearchMatchContext = createContext<ReadonlyMap<number, PlantingPlanMatch>>(NO_MATCHES);

export function usePlantingPlanSearchMatch(planId: number): PlantingPlanMatch | undefined {
  return useContext(PlantingPlanSearchMatchContext).get(planId);
}
