import { useId, type ReactNode } from 'react';
import { Box, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import type { YieldComparisonSummary } from '../api/types';
import { formatHarvestTotals } from '../harvests/harvestDisplay';
import { useTranslation } from '../i18n';
import { formatLocalizedNumber } from '../utils/numberLocalization';

function YieldMetric({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return <Paper variant="outlined" sx={{ minWidth: 0, px: 1.5, py: 1 }}>
    <Typography component="dt" variant="body2" color="text.secondary">{label}</Typography>
    <Typography component="dd" variant="subtitle1" sx={{ m: 0, fontWeight: 700, lineHeight: 1.4 }}>{value}</Typography>
    {children}
  </Paper>;
}

export function YieldComparisonSummaryPanel({ summary, seasonCount, locale }: {
  summary: YieldComparisonSummary;
  seasonCount: number;
  locale: string;
}) {
  const { t } = useTranslation('yieldOverview');
  const { t: harvest } = useTranslation('harvests');
  const coverageId = useId();
  const quantities = summary.recorded_quantities;
  const displayCount = (count: number) => formatLocalizedNumber(count, locale);
  const cropCoverage = t('summary.cropCoverage', {
    recorded: displayCount(summary.recorded_crop_count), total: displayCount(summary.crop_count),
  });
  const area = summary.planned_area_sqm === null ? t('summary.areaUnavailable')
    : `${formatLocalizedNumber(Number(summary.planned_area_sqm), locale, { maximumFractionDigits: 2 })} m²`;
  const recorded = quantities.length === 0 ? t('comparison.notRecorded') : formatHarvestTotals(quantities, locale, harvest);

  return <Stack spacing={1} sx={{ overflowWrap: 'anywhere' }}>
    <Box component="dl" sx={{
      display: 'grid', gap: 1, m: 0,
      gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(3, minmax(0, 1fr))' },
      '& > :last-child': {
        gridColumn: { xs: '1 / -1', sm: 'auto' }, display: { xs: 'flex', sm: 'block' },
        justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 0.5,
      },
    }}>
      <YieldMetric label={t('summary.plannedArea')} value={area}>
        <Typography component="dd" variant="caption" color="text.secondary" sx={{ m: 0 }}>
          {t('summary.areaScope', { count: seasonCount })}
        </Typography>
        {summary.plans_without_area_count > 0 && <Typography component="dd" variant="caption" sx={{ m: 0 }}>
          {t('summary.plansWithoutArea', { count: summary.plans_without_area_count })}
        </Typography>}
      </YieldMetric>
      <YieldMetric label={t('summary.recordedHarvest')} value={recorded}>
        {quantities.length > 0 && quantities.every(item => Number(item.quantity) === 0)
          && <Typography component="dd" variant="caption" color="text.secondary" sx={{ m: 0 }}>
            {t('comparison.zeroRecorded')}
          </Typography>}
        {summary.excluded_unassigned_records > 0 && <Typography component="dd" variant="caption" sx={{ m: 0 }}>
          {t('comparison.excludedUnassigned', { count: summary.excluded_unassigned_records })}
        </Typography>}
      </YieldMetric>
      <YieldMetric label={t('summary.recordedCrops')}
        value={summary.crop_count > 0 ? cropCoverage : t('summary.noCropsInScope')} />
    </Box>
    {summary.crop_count > 0 && <Paper component="section" variant="outlined" aria-labelledby={coverageId}
      sx={{ px: 1.5, py: 0.75, bgcolor: 'action.hover' }}>
      <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
        <Typography id={coverageId} component="h2" variant="subtitle2">{t('summary.dataCoverage')}</Typography>
        <LinearProgress role="meter" variant="determinate" aria-label={t('summary.recordedCrops')}
          aria-valuetext={cropCoverage} value={100 * summary.recorded_crop_count / summary.crop_count}
          sx={{ flex: '1 1 5rem', minWidth: 0, maxWidth: '12rem', borderRadius: 1 }} />
        <Typography variant="caption" color="text.secondary">{t('summary.coverageBasis')}</Typography>
      </Stack>
    </Paper>}
  </Stack>;
}
