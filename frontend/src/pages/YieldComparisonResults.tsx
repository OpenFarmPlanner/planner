import { useId } from 'react';
import {
  Box, Link, Paper, Stack, Table, TableBody, TableCell, TableHead,
  TableRow, Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router';
import type { YieldComparison, YieldComparisonSeason } from '../api/types';
import { formatHarvestQuantity, formatHarvestTotals } from '../harvests/harvestDisplay';
import { useTranslation } from '../i18n';
import { formatCropLossExtent } from '../planting-plans/cropLossDisplay';
import { getPlanActivityDates, type PlantingPlanDateComparison } from '../planting-plans/plantingPlanActualDates';
import { PlanDateComparisonText } from '../planting-plans/PlantingPlanExecutionDates';
import { plantingPlanDetailPath } from '../planting-plans/plantingPlanDetailRoutes';
import { formatSeasonDate, formatSeasonPeriod, resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import { formatLocalizedNumber } from '../utils/numberLocalization';
import { YieldComparisonSummaryPanel } from './YieldComparisonSummary';
import { YieldSeasonChart } from './YieldSeasonChart';
import type { YieldChartUnit } from './yieldSeasonChartData';

const numericOptions = { maximumFractionDigits: 6 };
const number = (value: number | string, locale: string) => formatLocalizedNumber(Number(value), locale, numericOptions);
const perArea = (value: string, locale: string) => `${number(value, locale)} kg/m²`;

function SeasonObservations({ row, plans, locale }: {
  row: YieldComparisonSeason;
  plans: { id: number; bed_name: string; crop_label?: string; activities: PlantingPlanDateComparison[] }[];
  locale: string;
}) {
  const { t } = useTranslation('yieldOverview');
  const { t: planting } = useTranslation('plantingPlans');

  return <Stack spacing={2} sx={{ mt: 0.5, pb: 1 }}>
    {plans.length > 0 && <Box>
      <Typography component="h3" variant="subtitle2">{t('comparison.activityDates')}</Typography>
      {plans.map(plan => <Box key={plan.id} sx={{ pt: 1 }}>
        <Link component={RouterLink} to={plantingPlanDetailPath(plan.id)}
          sx={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>
          {[plan.crop_label, plan.bed_name].filter(Boolean).join(' · ') || t('comparison.openPlan')}
        </Link>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 8.5rem), 1fr))', gap: 1 }}>
          {plan.activities.map(dates => <PlanDateComparisonText key={dates.activity} dates={dates} />)}
        </Box>
      </Box>)}
    </Box>}
    {row.harvested_areas.length > 0 && <Box>
      <Typography component="h3" variant="subtitle2">{t('comparison.harvestedAreaYield')}</Typography>
      <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
        {row.harvested_areas.map(area => <Box component="li" key={area.id} sx={{ mb: 0.5 }}>
          {[
            formatSeasonDate(area.date, locale),
            area.bed_name,
            `${number(area.area_sqm, locale)} m²`,
            area.kg_per_sqm === null ? t('comparison.noMass') : area.estimated
              ? t('comparison.estimated', { value: perArea(area.kg_per_sqm, locale) })
              : perArea(area.kg_per_sqm, locale),
          ].filter(Boolean).join(' · ')}
        </Box>)}
      </Box>
    </Box>}
    {row.losses.length > 0 && <Box>
      <Typography component="h3" variant="subtitle2">{planting('cropLosses.title')}</Typography>
      <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
        {row.losses.map(loss => <Box component="li" key={loss.id} sx={{ mb: 0.5 }}>
          {[
            formatSeasonDate(loss.date, locale), loss.bed_name,
            planting(`cropLosses.types.${loss.loss_type}`),
            planting(`cropLosses.causes.${loss.cause}`),
            formatCropLossExtent(loss, locale, planting),
          ].filter(Boolean).join(' · ')}
        </Box>)}
      </Box>
    </Box>}
  </Stack>;
}

function SeasonSummary({ row, timing, locale }: {
  row: YieldComparisonSeason; timing: YieldComparison['crop_timing']; locale: string;
}) {
  const { t } = useTranslation(['yieldOverview', 'plantingPlans']);
  const { t: harvest } = useTranslation('harvests');
  const totals = row.recorded.quantities;
  const activityPlans = row.plan_dates.map(plan => ({
    id: plan.id, bed_name: plan.bed_name, crop_label: plan.crop_label,
    activities: getPlanActivityDates({ ...timing, ...plan }).filter(date => date.planned || date.actual),
  })).filter(plan => plan.activities.length > 0);
  const hasDetails = activityPlans.length > 0 || row.harvested_areas.length > 0 || row.losses.length > 0;
  const partial = row.losses.filter(loss => loss.loss_type === 'partial').length;
  const total = row.losses.length - partial;

  return <>
    <TableRow>
      <TableCell component="th" scope="row">
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.label}</Typography>
        <Typography component="div" variant="caption" color="text.secondary">
          {formatSeasonPeriod(row.start_date, row.end_date, locale)}
        </Typography>
      </TableCell>
      <TableCell>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {row.forecast_kg === null ? t('comparison.noForecast')
            : formatHarvestQuantity(row.forecast_kg, 'kg', locale, harvest)}
        </Typography>
        {row.forecast_plan_count < row.expected_plan_count && <Typography component="div" variant="caption">
          {t('comparison.forecastCoverage', { included: row.forecast_plan_count, total: row.expected_plan_count })}
        </Typography>}
        {row.forecast_kg_per_sqm !== null && <Typography component="div" variant="caption" color="text.secondary">
          {perArea(row.forecast_kg_per_sqm, locale)}
        </Typography>}
      </TableCell>
      <TableCell>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {totals.length === 0 ? t('comparison.notRecorded')
            : formatHarvestTotals(totals, locale, harvest)}
        </Typography>
        {totals.length > 0 && <Typography component="div" variant="caption" color="text.secondary">
          {t(totals.every(item => Number(item.quantity) === 0) ? 'comparison.zeroRecorded' : 'comparison.harvestRecorded')}
        </Typography>}
        {row.recorded.estimated_kg !== null && <Typography component="div" variant="caption">
          {t('comparison.estimated', { value: formatHarvestQuantity(row.recorded.estimated_kg, 'kg', locale, harvest) })}
        </Typography>}
        {row.unassigned.length > 0 && <Typography component="div" variant="caption">
          {t('comparison.unassigned', { value: formatHarvestTotals(row.unassigned, locale, harvest) })}
        </Typography>}
        {Boolean(row.excluded_unassigned_records) && <Typography component="div" variant="caption">
          {t('comparison.excludedUnassigned', { count: row.excluded_unassigned_records })}
        </Typography>}
        {totals.length > 0 && row.assigned_forecast_plan_count < row.expected_plan_count
          && <Typography component="div" variant="caption">
            {t('comparison.harvestCoverage', { included: row.assigned_forecast_plan_count, total: row.expected_plan_count })}
          </Typography>}
        {row.recorded_kg_per_plan_sqm !== null && <Typography component="div" variant="caption" color="text.secondary">
          {row.recorded_kg_per_plan_sqm_estimated
            ? t('comparison.estimated', { value: perArea(row.recorded_kg_per_plan_sqm, locale) })
            : perArea(row.recorded_kg_per_plan_sqm, locale)}
          {' · '}{t('comparison.assignedPlans', { count: row.assigned_plan_count })}
        </Typography>}
        {row.recorded_kg_per_plan_sqm === null && row.assigned_plan_count > 0 && <Typography component="div" variant="caption">
          {t('comparison.noAreaYield')}
        </Typography>}
        {row.losses.length > 0 && <Typography component="div" variant="caption">
          {[
            partial > 0 ? `${number(partial, locale)} × ${t('plantingPlans:cropLosses.types.partial')}` : '',
            total > 0 ? `${number(total, locale)} × ${t('plantingPlans:cropLosses.types.total')}` : '',
          ].filter(Boolean).join(' · ')}
        </Typography>}
      </TableCell>
    </TableRow>
    {hasDetails && <TableRow>
      <TableCell colSpan={3} sx={{ py: 0 }}>
        <Box component="details">
          <Box component="summary" aria-label={`${t('comparison.details')} · ${row.label}`}
            sx={{ cursor: 'pointer', minHeight: 44, alignContent: 'center' }}>
            {t('comparison.details')}
          </Box>
          <SeasonObservations row={row} plans={activityPlans} locale={locale} />
        </Box>
      </TableCell>
    </TableRow>}
  </>;
}

export function YieldComparisonResults({ comparison, cropName, preferredUnit, onChartUnitChange }: {
  comparison: YieldComparison;
  cropName: string;
  preferredUnit: YieldChartUnit;
  onChartUnitChange: (unit: YieldChartUnit) => void;
}) {
  const { t, i18n } = useTranslation('yieldOverview');
  const locale = resolveSeasonDateLocale(i18n);
  const { seasons, crop_timing: timing } = comparison;
  const tableId = useId();
  if (seasons.length === 0) return <Typography>{t('comparison.noSeasons')}</Typography>;

  return <Stack spacing={2} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
    <YieldComparisonSummaryPanel summary={comparison.summary} seasonCount={seasons.length} locale={locale} />
    <YieldSeasonChart seasons={seasons} locale={locale} preferredUnit={preferredUnit} onUnitChange={onChartUnitChange} />
    <Paper variant="outlined">
      <Box sx={{ px: { xs: 1.25, sm: 2 }, pt: 1.5, pb: 0.75 }}>
        <Typography id={tableId} component="h2" variant="subtitle1" sx={{ fontWeight: 600 }}>{cropName}</Typography>
        <Typography variant="body2" color="text.secondary">{t('comparison.tableScope')}</Typography>
      </Box>
      <Table size="small" aria-labelledby={tableId} sx={{
        tableLayout: 'fixed',
        '& .MuiTableCell-root': { px: { xs: 1, sm: 2 }, verticalAlign: 'top' },
      }}>
        <TableHead><TableRow>
          <TableCell scope="col" sx={{ width: { xs: '25%', sm: '24%' } }}>{t('comparison.season')}</TableCell>
          <TableCell scope="col" sx={{ width: { xs: '36%', sm: '33%' } }}>{t('comparison.forecast')}</TableCell>
          <TableCell scope="col">{t('comparison.recorded')}</TableCell>
        </TableRow></TableHead>
        <TableBody>
          {seasons.map(row => <SeasonSummary key={row.id} row={row} timing={timing} locale={locale} />)}
        </TableBody>
      </Table>
    </Paper>
  </Stack>;
}
