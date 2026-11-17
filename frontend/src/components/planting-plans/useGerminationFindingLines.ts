import { useMemo } from 'react';

import type { PlantingPlan } from '../../api/types';
import { useTranslation } from '../../i18n';

export type GerminationFindings = PlantingPlan['germination_findings'];

/** One sentence per germination finding; the table and cards show them as date hints. */
export function useGerminationFindingLines(findings: GerminationFindings | null | undefined): string[] {
  const { t } = useTranslation('plantingPlans');
  return useMemo(
    () => (findings ?? []).map((finding) => t(`plantingPlans:germination.${finding.code}`)),
    [findings, t],
  );
}
