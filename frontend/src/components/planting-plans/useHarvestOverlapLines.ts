import { useCallback } from 'react';

import type { HarvestOverlap } from '../../api/types';
import { useTranslation } from '../../i18n';
import { resolveLocaleFromLanguage } from '../../utils/numberLocalization';

/**
 * One line per affected plan: "… folgt ab … auf diesem Beet" on the previous
 * crop, "Beginnt vor dem geplanten Ernteende von …" on the follow-up crop
 * (docs/bed-occupancy.md). These overlaps are allowed planning, so they are
 * infos, never warnings.
 */
export function useHarvestOverlapLines(overlaps: readonly HarvestOverlap[] | null | undefined): string[] {
  const { t, i18n } = useTranslation('plantingPlans');
  const locale = resolveLocaleFromLanguage(i18n.resolvedLanguage ?? i18n.language);
  const formatDate = useCallback(
    (iso: string): string => new Date(`${iso}T00:00:00`).toLocaleDateString(locale),
    [locale],
  );
  return (overlaps ?? []).map((overlap) => t(`plantingPlans:harvestOverlap.${overlap.role}`, {
    date: formatDate(overlap.date),
    crop: overlap.other_crop_label,
  }));
}

/** Overlaps in which this plan is the previous crop, i.e. its harvest has to end early. */
export function getPredecessorOverlaps(overlaps: readonly HarvestOverlap[] | null | undefined): HarvestOverlap[] {
  return (overlaps ?? []).filter((overlap) => overlap.role === 'predecessor');
}
