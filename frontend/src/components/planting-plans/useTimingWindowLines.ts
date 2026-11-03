import { useMemo } from 'react';

import type { TimingWindowFinding, TimingWindowKind } from '../../api/types';
import { formatTimingWindows } from '../../crops/timingWindows';
import { useTranslation } from '../../i18n';

/** The table's date columns and the window kinds whose hint belongs in them. */
export const TIMING_WINDOW_KINDS_BY_DATE_FIELD: Record<string, readonly TimingWindowKind[]> = {
  sowing_date: ['pre_cultivation', 'direct_sowing'],
  planting_date: ['direct_sowing', 'planting'],
};

/** One sentence per finding: "Aussaattermin liegt außerhalb der Direktsaat-Zeiträume (März bis Mai)." */
export function useTimingWindowLines(
  findings: readonly TimingWindowFinding[] | null | undefined,
  kinds?: readonly TimingWindowKind[],
): string[] {
  const { t } = useTranslation(['plantingPlans', 'crops', 'common']);
  return useMemo(
    () => (findings ?? [])
      .filter((finding) => !kinds || kinds.includes(finding.kind))
      .map((finding) => t(`plantingPlans:timingWindow.${finding.kind}`, {
        windows: formatTimingWindows(finding.windows, t),
      })),
    [findings, kinds, t],
  );
}
