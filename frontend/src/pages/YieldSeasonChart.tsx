import { useId, useState } from 'react';
import { Box, ButtonBase, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import type { YieldComparisonSeason } from '../api/types';
import { AppTooltip } from '../components/AppTooltip';
import { formatHarvestQuantity } from '../harvests/harvestDisplay';
import { useTranslation } from '../i18n';
import { formatSeasonPeriod } from '../seasons/formatSeasonDate';
import { formatLocalizedNumber } from '../utils/numberLocalization';
import { yieldChartScale, yieldChartSeries, yieldChartUnits, type YieldChartSeries, type YieldChartUnit } from './yieldSeasonChartData';

const plotHeight = 112;
const styles = {
  forecast: { border: '1px solid', borderColor: 'primary.main', bgcolor: 'action.selected' },
  recorded: { border: '1px solid', borderColor: 'primary.main', bgcolor: 'primary.main' },
  partial: {
    backgroundImage: 'repeating-linear-gradient(135deg, transparent 0 3px, currentColor 3px 4px)',
    color: 'text.secondary',
  },
};

function ChartBar({ series, scale }: { series: YieldChartSeries; scale: number }) {
  const value = Number(series.value);
  if (series.value === null || value === 0) {
    return <Typography component="span" variant="caption" color="text.secondary"
      sx={{ width: '30%', textAlign: 'center', fontWeight: series.partial ? 700 : undefined }}>
      {series.value === null ? '–' : '0'}
    </Typography>;
  }
  return <Box component="span" sx={{
    ...styles[series.kind], ...(series.partial && {
      ...styles.partial, color: series.kind === 'recorded' ? 'primary.contrastText' : 'text.secondary',
    }),
    boxSizing: 'border-box', width: '30%', maxWidth: 26, minHeight: 2,
    height: `${100 * value / scale}%`, borderRadius: 0.5,
  }} />;
}

function SeasonChartGroup({ row, series, scale, unit, locale }: {
  row: YieldComparisonSeason;
  series: YieldChartSeries[];
  scale: number;
  unit: YieldChartUnit;
  locale: string;
}) {
  const { t } = useTranslation('yieldOverview');
  const { t: harvest } = useTranslation('harvests');
  const [preview, setPreview] = useState<'closed' | 'open' | 'dismissed'>('closed');
  const period = formatSeasonPeriod(row.start_date, row.end_date, locale);
  const descriptions = series.map(item => {
    const value = item.value === null
      ? t(item.kind === 'forecast' ? 'comparison.noForecast' : 'comparison.notRecorded')
      : formatHarvestQuantity(item.value, unit, locale, harvest);
    const qualifier = item.value !== null && item.partial ? t('comparison.partialValue') : '';
    return [t(`comparison.${item.kind}`), value, qualifier].filter(Boolean).join(' · ');
  });
  const estimate = unit === 'kg' && row.recorded.estimated_kg !== null
    ? harvest('estimatedWeight', { quantity: formatHarvestQuantity(row.recorded.estimated_kg, 'kg', locale, harvest) }) : null;
  const excluded = row.excluded_unassigned_records
    ? t('comparison.excludedUnassigned', { count: row.excluded_unassigned_records }) : null;
  const restorePreview = () => setPreview(current => current === 'dismissed' ? 'closed' : current);
  return <Stack sx={{ minWidth: 0, gap: 0.75 }}>
    <AppTooltip open={preview === 'open'} describeChild enterTouchDelay={350}
      onOpen={() => setPreview(current => current === 'dismissed' ? current : 'open')}
      onClose={() => setPreview(current => current === 'dismissed' ? current : 'closed')}
      title={<Stack spacing={0.25}>
        <Typography variant="subtitle2">{row.label}</Typography>
        <Typography variant="caption">{period}</Typography>
        {descriptions.map(line => <Typography key={line} variant="caption">{line}</Typography>)}
        {estimate && <Typography variant="caption">{estimate}</Typography>}
        {excluded && <Typography variant="caption">{excluded}</Typography>}
      </Stack>}>
      <ButtonBase aria-label={t('comparison.chartValues', { season: row.label, period })}
        onClick={() => setPreview('open')} onMouseLeave={restorePreview} onBlur={restorePreview}
        onKeyDown={event => { if (event.key === 'Escape') setPreview('dismissed'); }}
        sx={{
          height: plotHeight, width: '100%', gap: 0.75, alignItems: 'end', borderRadius: 0.5,
          '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
        }}>
        {series.map(item => <ChartBar key={item.kind} series={item} scale={scale} />)}
      </ButtonBase>
    </AppTooltip>
    <Typography variant="caption" align="center" sx={{ fontWeight: 600 }}>{row.label}</Typography>
  </Stack>;
}

function ChartLegend({ unit, series }: { unit: YieldChartUnit; series: YieldChartSeries[][] }) {
  const { t } = useTranslation('yieldOverview');
  const bars = series.flat();
  const markers = [
    ...(unit === 'kg' ? [{ label: t('comparison.forecast'), sx: styles.forecast }] : []),
    { label: t('comparison.recorded'), sx: styles.recorded },
    ...(bars.some(item => item.value !== null && item.partial)
      ? [{ label: t('comparison.partialValue'), sx: { ...styles.partial, border: '1px solid', borderColor: 'divider' } }] : []),
  ];
  return <Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: 'wrap' }}>
    {markers.map(({ label, sx }) => <Stack key={label} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <Box aria-hidden sx={{ ...sx, width: 13, height: 10, borderRadius: 0.5, flexShrink: 0 }} />
      <Typography variant="caption">{label}</Typography>
    </Stack>)}
    {bars.some(item => item.value === null) && <Typography variant="caption">{t('comparison.missingMark')}</Typography>}
    {unit !== 'kg' && <Typography variant="caption" color="text.secondary">{t('comparison.forecastMassOnly')}</Typography>}
  </Stack>;
}

export function YieldSeasonChart({ seasons, locale, preferredUnit, onUnitChange }: {
  seasons: YieldComparisonSeason[];
  locale: string;
  preferredUnit: YieldChartUnit;
  onUnitChange: (unit: YieldChartUnit) => void;
}) {
  const { t } = useTranslation('yieldOverview');
  const { t: harvest } = useTranslation('harvests');
  const headingId = useId();
  const units = yieldChartUnits(seasons);
  const unit = units.includes(preferredUnit) ? preferredUnit : units[0];
  const series = unit === undefined ? [] : seasons.map(row => yieldChartSeries(row, unit));
  const scale = yieldChartScale(series);
  const ticks = [scale, scale / 2, 0];
  return <Paper component="figure" variant="outlined" aria-labelledby={headingId} sx={{ p: { xs: 1.5, sm: 2 }, m: 0 }}>
    <Stack spacing={1.25}>
      <Stack component="figcaption" direction="row" spacing={1} useFlexGap
        sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <Typography id={headingId} component="h2" variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t('comparison.chartTitle')}
        </Typography>
        {units.length > 1 && <TextField select size="small" label={harvest('unit')} value={unit}
          onChange={event => onUnitChange(event.target.value as YieldChartUnit)} sx={{ minWidth: '8rem' }}>
          {units.map(option => <MenuItem key={option} value={option}>{harvest(`units.${option}`)}</MenuItem>)}
        </TextField>}
      </Stack>
      {unit === undefined ? <Typography variant="body2" color="text.secondary">{t('comparison.chartEmpty')}</Typography> : <>
        <ChartLegend unit={unit} series={series} />
        <Typography variant="caption" color="text.secondary">
          {t('comparison.axis', { unit: unit === 'kg' ? 'kg' : harvest(`units.${unit}`) })}
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', columnGap: 1, alignItems: 'start' }}>
          <Stack aria-hidden sx={{ height: plotHeight, justifyContent: 'space-between', alignItems: 'end' }}>
            {ticks.map(tick => <Typography key={tick} variant="caption" color="text.secondary" sx={{ lineHeight: 1 }}>
              {formatLocalizedNumber(tick, locale, { maximumFractionDigits: 6 })}
            </Typography>)}
          </Stack>
          <Box sx={{ overflowX: 'auto' }}>
            <Box sx={{
              display: 'grid', gridTemplateColumns: `repeat(${seasons.length}, minmax(5rem, 1fr))`,
              position: 'relative', width: '100%', minWidth: `${seasons.length * 5}rem`,
            }}>
              <Stack aria-hidden sx={{
                position: 'absolute', inset: '0 0 auto', height: plotHeight, justifyContent: 'space-between', pointerEvents: 'none',
              }}>
                {ticks.map(tick => <Box key={tick} sx={{ borderTop: '1px solid', borderColor: 'divider' }} />)}
              </Stack>
              {seasons.map((row, index) => <SeasonChartGroup key={row.id} row={row} series={series[index]}
                scale={scale} unit={unit} locale={locale} />)}
            </Box>
          </Box>
        </Box>
      </>}
    </Stack>
  </Paper>;
}
