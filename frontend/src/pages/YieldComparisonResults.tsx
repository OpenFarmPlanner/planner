import { useState } from 'react';
import { Stack, Typography } from '@mui/material';
import type { YieldComparison } from '../api/types';
import { useTranslation } from '../i18n';
import { resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import { YieldComparisonSummaryPanel } from './YieldComparisonSummary';
import { YieldCropDrilldown, type LoadCropComparison } from './YieldCropDrilldown';
import { YieldCropMatrix } from './YieldCropMatrix';
import { YieldSeasonChart } from './YieldSeasonChart';
import { YieldSeasonDetails } from './YieldSeasonDetails';
import type { YieldComparisonCropGroup } from './yieldComparisonFilters';
import type { YieldChartUnit } from './yieldSeasonChartData';

export function YieldComparisonResults({ comparison, cropName, groups, loadCropComparison, preferredUnit, onChartUnitChange }: {
  comparison: YieldComparison;
  cropName: string;
  groups: YieldComparisonCropGroup[];
  loadCropComparison: LoadCropComparison;
  preferredUnit: YieldChartUnit;
  onChartUnitChange: (unit: YieldChartUnit) => void;
}) {
  const { t, i18n } = useTranslation('yieldOverview');
  const locale = resolveSeasonDateLocale(i18n);
  const { seasons } = comparison;
  const [crop, setCrop] = useState<{ label: string; crop_ids: number[] } | null>(null);
  if (seasons.length === 0) return <Typography>{t('comparison.noSeasons')}</Typography>;
  // The comparison API returns newest first for the season detail list.
  const chronologicalSeasons = [...seasons].reverse();

  return <Stack spacing={2} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
    <YieldComparisonSummaryPanel summary={comparison.summary} seasonCount={seasons.length} locale={locale} />
    <YieldSeasonChart seasons={chronologicalSeasons} locale={locale} preferredUnit={preferredUnit} onUnitChange={onChartUnitChange} />
    <YieldCropMatrix crops={comparison.crop_yields} seasons={chronologicalSeasons} groups={groups} locale={locale} onOpen={setCrop} />
    <YieldSeasonDetails comparison={comparison} cropName={cropName} />
    {crop && <YieldCropDrilldown crop={crop} load={loadCropComparison} onClose={() => setCrop(null)} />}
  </Stack>;
}
