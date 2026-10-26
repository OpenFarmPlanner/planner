import { useCallback } from 'react';

import type { HarvestOverlap } from '../../api/types';
import { useTranslation } from '../../i18n';
import { resolveLocaleFromLanguage } from '../../utils/numberLocalization';

/**
 * One line per affected plan: "Ernte endet spätestens am …" on the previous
 * crop, "Wird während der Erntephase von … gesetzt" on the follow-up crop
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
