import { useId, useMemo, useState } from 'react';
import { Box, Button, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel, Typography } from '@mui/material';
import { visuallyHidden } from '@mui/utils';
import type { YieldComparisonCropRate, YieldComparisonCropYield, YieldComparisonSeason } from '../api/types';
import { useTranslation } from '../i18n';
import { formatSeasonPeriod } from '../seasons/formatSeasonDate';
import { formatLocalizedNumber } from '../utils/numberLocalization';
import type { YieldComparisonCropGroup } from './yieldComparisonFilters';

type SortKey = 'crop' | 'trend' | number;
type SortOrder = 'asc' | 'desc';
interface CropRow extends YieldComparisonCropYield { label: string; }

const cropColumn = { position: 'sticky', left: 0, zIndex: 1, bgcolor: 'background.paper' };
const rateOptions = { maximumFractionDigits: 6 };

function sortValue(row: CropRow, key: 'trend' | number): number | null {
  const value = key === 'trend' ? row.trend?.change : row.rates.find(rate => rate.season_id === key)?.value;
  return value == null ? null : Number(value);
}

function sortedCrops(rows: CropRow[], key: SortKey, order: SortOrder, locale: string) {
  const byName = (a: CropRow, b: CropRow) => a.label.localeCompare(b.label, locale);
  const sign = order === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === 'crop') return sign * byName(a, b);
    const left = sortValue(a, key);
    const right = sortValue(b, key);
    if (left === null || right === null) return Number(left === null) - Number(right === null) || byName(a, b);
    return (left - right) * sign || byName(a, b);
  });
}

function RateCell({ rate, locale }: { rate: YieldComparisonCropRate; locale: string }) {
  const { t } = useTranslation('yieldOverview');
  if (rate.value === null) {
    const label = rate.status === 'unassigned' ? t('cropYields.unassigned')
      : t(rate.status === 'unavailable' ? 'summary.areaUnavailable' : 'comparison.notRecorded');
    return <><Box component="span" aria-hidden>–</Box>
      <Typography component="span" variant="caption" color="text.secondary"
        sx={rate.status === 'missing' ? visuallyHidden : { display: 'block' }}>{label}</Typography></>;
  }
  const quantity = formatLocalizedNumber(rate.below_resolution ? 0.000001 : Number(rate.value), locale, rateOptions);
  const text = `${rate.below_resolution ? '< ' : ''}${quantity} kg/m²`;
  return <>
    {rate.status === 'estimated' ? t('comparison.estimated', { value: text }) : text}
    {rate.partial && <Typography component="div" variant="caption" color="text.secondary">
      {t('comparison.partialValue')}
    </Typography>}
  </>;
}

export function YieldCropMatrix({ crops, seasons, groups, locale, onOpen }: {
  crops: YieldComparisonCropYield[];
  seasons: YieldComparisonSeason[];
  groups: YieldComparisonCropGroup[];
  locale: string;
  onOpen: (crop: CropRow) => void;
}) {
  const { t } = useTranslation('yieldOverview');
  const titleId = useId();
  const [sort, setSort] = useState<{ key: SortKey; order: SortOrder }>({ key: 'crop', order: 'asc' });
  const rows = useMemo(() => {
    const names = new Map(groups.map(group => [group.key, group.name]));
    return sortedCrops(crops.map(row => ({ ...row, label: names.get(row.key) ?? row.name })), sort.key, sort.order, locale);
  }, [crops, groups, locale, sort]);
  const labels = new Map(seasons.map(season => [season.id, season.label]));
  const sortHeader = (key: SortKey, label: string, ariaLabel = label) => <TableCell key={key} scope="col"
    sortDirection={sort.key === key ? sort.order : false} sx={key === 'crop' ? { ...cropColumn, zIndex: 2 } : undefined}>
    <TableSortLabel active={sort.key === key} direction={sort.key === key ? sort.order : 'desc'} aria-label={ariaLabel}
      onClick={() => setSort(current => ({ key, order: current.key === key && current.order === 'desc' ? 'asc' : 'desc' }))}>
      {label}
    </TableSortLabel>
  </TableCell>;

  if (rows.length === 0) return null;
  return <Paper variant="outlined" sx={{ minWidth: 0 }}>
    <Box sx={{ px: 1.5, pt: 1.25, pb: 0.5 }}>
      <Typography id={titleId} component="h2" variant="subtitle1" sx={{ fontWeight: 600 }}>
        {t('cropYields.title')}
      </Typography>
    </Box>
    <TableContainer tabIndex={0} role="region" aria-labelledby={titleId}>
      <Table size="small" aria-labelledby={titleId} sx={{
        minWidth: `${19 + seasons.length * 6.5}rem`, tableLayout: 'fixed',
        '& .MuiTableCell-root': { px: 1.5, minWidth: 0, verticalAlign: 'top' },
      }}>
        <colgroup><col style={{ width: '9rem' }} />
          {seasons.map(season => <col key={season.id} />)}
          <col style={{ width: '10rem' }} />
        </colgroup>
        <TableHead><TableRow>
          {sortHeader('crop', t('filters.crop'))}
          {seasons.map(season => sortHeader(season.id, season.label,
            `${season.label} (${formatSeasonPeriod(season.start_date, season.end_date, locale)})`))}
          {sortHeader('trend', t('cropYields.trend'))}
        </TableRow></TableHead>
        <TableBody>{rows.map(row => <TableRow key={row.key}>
          <TableCell component="th" scope="row" sx={{ ...cropColumn, py: 0 }}>
            <Button size="small" onClick={() => onOpen(row)} aria-haspopup="dialog"
              sx={{ px: 0, minHeight: 44, minWidth: 0, textAlign: 'start', justifyContent: 'start' }}>
              {row.label}
            </Button>
          </TableCell>
          {row.rates.map(rate => <TableCell key={rate.season_id}><RateCell rate={rate} locale={locale} /></TableCell>)}
          <TableCell>{row.trend === null ? <><Box component="span" aria-hidden>–</Box>
            <Box component="span" sx={visuallyHidden}>{t('cropYields.noTrend')}</Box></> : <>
            {formatLocalizedNumber(Number(row.trend.change), locale, {
              style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero',
            })}
            <Typography component="div" variant="caption" color="text.secondary">
              {labels.get(row.trend.from_season_id)} → {labels.get(row.trend.to_season_id)}
            </Typography>
          </>}</TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </TableContainer>
  </Paper>;
}
