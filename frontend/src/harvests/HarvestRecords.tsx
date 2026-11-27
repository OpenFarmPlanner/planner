import { useEffect, useId, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, List, ListItem, Menu, MenuItem, Stack, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { harvestAPI } from '../api/api';
import type { HarvestRecord, HarvestTotals, PlanActualHarvest } from '../api/types';
import LoadRetryButton from '../components/LoadRetryButton';
import { useTranslation } from '../i18n';
import { formatSeasonDate, resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import { formatLocalizedNumber } from '../utils/numberLocalization';
import { HarvestDialog, type HarvestPlanContext } from './HarvestDialog';
import { formatHarvestQuantity, formatHarvestTotals, formatYieldPerAreaValue } from './harvestDisplay';

interface HarvestRecordsProps {
  scope: string;
  initialDate: string;
  plan?: HarvestPlanContext;
  planId?: number;
  planTotals?: PlanActualHarvest | null;
  recordSeasonId?: number;
  onChanged?: () => void;
}

type LoadResult = { rows: HarvestRecord[]; totals?: HarvestTotals; scope: string } | { error: true; scope: string };

export function HarvestRecords({ scope, initialDate, plan, planId, planTotals, recordSeasonId, onChanged }: HarvestRecordsProps) {
  const { t, i18n } = useTranslation(['harvests', 'common']);
  const locale = resolveSeasonDateLocale(i18n);
  const deleteTitle = useId();
  const [result, setResult] = useState<LoadResult>();
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<HarvestRecord | 'new' | null>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; record: HarvestRecord } | null>(null);
  const [deleting, setDeleting] = useState<HarvestRecord | null>(null);
  const [deleteError, setDeleteError] = useState(false);
  const [saving, setSaving] = useState(false);
  const resultKey = `${scope}:${revision}`;
  const visibleResult = result?.scope === resultKey ? result : undefined;
  const rows = visibleResult && 'rows' in visibleResult ? visibleResult.rows : undefined;
  const totals = visibleResult && 'totals' in visibleResult ? visibleResult.totals : undefined;
  const forPlan = planId !== undefined;

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      harvestAPI.list(planId, controller.signal, recordSeasonId),
      planId === undefined ? harvestAPI.summary(controller.signal) : undefined,
    ]).then(([records, summary]) => {
      if (!controller.signal.aborted) setResult({ rows: records.results, totals: summary?.data, scope: resultKey });
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ error: true, scope: resultKey });
    });
    return () => controller.abort();
  }, [planId, recordSeasonId, resultKey]);

  const refresh = () => {
    setRevision(value => value + 1);
    onChanged?.();
  };
  const remove = async () => {
    if (!deleting || saving) return;
    setSaving(true);
    setDeleteError(false);
    try {
      await harvestAPI.delete(deleting.id);
      setDeleting(null);
      refresh();
    } catch {
      setDeleteError(true);
    } finally {
      setSaving(false);
    }
  };

  const quantity = (value: string, unit: HarvestRecord['unit'] = 'kg') => (
    formatHarvestQuantity(value, unit, locale, t)
  );
  const totalsText = totals?.quantities.length ? formatHarvestTotals(totals.quantities, locale, t) : '';

  return (
    <Stack spacing={1.5}>
      {(!forPlan || plan) && <Button variant={rows?.length ? 'outlined' : 'contained'} startIcon={<AddIcon />}
        sx={{ alignSelf: 'flex-start' }} onClick={() => setEditor('new')}>{t('add')}</Button>}
      {totalsText && <Box>
        <Typography variant="subtitle2">{t('overviewTotal', { quantity: totalsText })}</Typography>
        {totals?.estimated_kg && <Typography variant="body2" color="text.secondary">{t('estimatedWeight', { quantity: quantity(totals.estimated_kg) })}</Typography>}
      </Box>}
      {planTotals && <Stack spacing={0.25}>
        <Typography variant="subtitle2">{t('planTotal', {
          quantity: formatHarvestTotals(planTotals.quantities, locale, t),
        })}</Typography>
        {planTotals.measured_kg && planTotals.estimated_kg && <Typography variant="body2" color="text.secondary">
          {t('measuredWeight', { quantity: quantity(planTotals.measured_kg) })}
        </Typography>}
        {planTotals.estimated_kg && <Typography variant="body2" color="text.secondary">
          {t('estimatedWeight', { quantity: quantity(planTotals.estimated_kg) })}
        </Typography>}
        {planTotals.actual_kg_per_sqm && <Typography variant="body2">
          {t(planTotals.estimated_kg ? 'estimatedYieldPerPlanArea' : 'yieldPerPlanArea', {
            value: formatYieldPerAreaValue(planTotals.actual_kg_per_sqm, locale),
          })}
        </Typography>}
        {planTotals.forecast_kg && planTotals.forecast_percentage && <Typography variant="body2">
          {t(planTotals.estimated_kg ? 'estimatedForecastComparison' : 'forecastComparison', {
            forecast: quantity(planTotals.forecast_kg),
            percent: formatLocalizedNumber(Number(planTotals.forecast_percentage) / 100, locale, { style: 'percent', maximumFractionDigits: 1 }),
          })}
        </Typography>}
      </Stack>}
      {!visibleResult && <CircularProgress size={24} aria-label={t('loading')} />}
      {visibleResult && 'error' in visibleResult && <Alert severity="error" action={<LoadRetryButton onClick={refresh} />}>
        {t('errors.load')}
      </Alert>}
      {rows?.length === 0 && <Typography color="text.secondary">{t(forPlan ? 'emptyPlan' : 'emptyOverview')}</Typography>}
      {!!rows?.length && <List disablePadding aria-label={t('title')}>
        {rows.map(row => {
          const allocation = forPlan ? row.allocations.find(item => item.planting_plan === planId) : undefined;
          const estimate = row.estimated_kg && allocation
            ? String(Number(allocation.quantity) * Number(row.grams_per_unit) / 1000) : row.estimated_kg;
          return (
            <ListItem key={row.id} divider disableGutters sx={{ gap: 1, alignItems: 'flex-start', py: 1.25 }}>
              <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                <Typography variant="body2" color="text.secondary">{formatSeasonDate(row.date, locale)}</Typography>
                <Typography variant="subtitle2">{row.crop_label}</Typography>
                <Typography variant="body2">{allocation
                  ? t('planShare', { assigned: quantity(allocation.quantity, row.unit), total: quantity(row.quantity, row.unit) })
                  : quantity(row.quantity, row.unit)}</Typography>
                {!forPlan && <Typography variant="body2" color="text.secondary">
                  {row.allocations.length ? t('assignedPlans', { count: row.allocations.length }) : t('unassigned')}
                </Typography>}
                {estimate && <Typography variant="body2" color="text.secondary">
                  {t('estimatedWeight', { quantity: quantity(estimate) })}
                </Typography>}
                {allocation?.kilograms_per_harvested_sqm && <Typography variant="body2" color="text.secondary">
                  {t(row.estimated_kg ? 'estimatedYieldPerHarvestedArea' : 'yieldPerHarvestedArea', {
                    value: formatYieldPerAreaValue(allocation.kilograms_per_harvested_sqm, locale),
                  })}
                </Typography>}
                {row.note && <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{row.note}</Typography>}
              </Stack>
              <IconButton aria-label={t('actionsFor', { crop: row.crop_label, date: formatSeasonDate(row.date, locale) })}
                aria-haspopup="menu" aria-expanded={menu?.record.id === row.id}
                onClick={event => setMenu({ anchor: event.currentTarget, record: row })} sx={{ width: 44, height: 44 }}>
                <MoreVertIcon />
              </IconButton>
            </ListItem>
          );
        })}
      </List>}
      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => { if (menu) setEditor(menu.record); setMenu(null); }}>{t('edit')}</MenuItem>
        <MenuItem onClick={() => { if (menu) setDeleting(menu.record); setDeleteError(false); setMenu(null); }}>{t('delete')}</MenuItem>
      </Menu>
      {editor && <HarvestDialog record={editor === 'new' ? undefined : editor} plan={plan} initialDate={initialDate}
        onClose={() => setEditor(null)} onSaved={() => { setEditor(null); refresh(); }} />}
      <Dialog open={!!deleting} onClose={saving ? undefined : () => setDeleting(null)} aria-labelledby={deleteTitle}>
        <DialogTitle id={deleteTitle}>{t('delete')}</DialogTitle>
        <DialogContent>
          {deleting && <Typography>{t('confirmDelete', { crop: deleting.crop_label, date: formatSeasonDate(deleting.date, locale) })}</Typography>}
          {deleteError && <Alert severity="error" sx={{ mt: 1 }}>{t('errors.delete')}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)} disabled={saving}>{t('common:actions.cancel')}</Button>
          <Button color="error" onClick={() => { void remove(); }} disabled={saving}>{t('common:actions.delete')}</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
