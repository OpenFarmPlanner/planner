import { useEffect, useId, useState } from 'react';
import {
  Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, List, ListItem, Menu, MenuItem, Stack, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import { cropLossAPI } from '../api/api';
import type { CropLoss } from '../api/types';
import LoadRetryButton from '../components/LoadRetryButton';
import { DetailSection } from '../components/layout/DetailPrimitives';
import { useTranslation } from '../i18n';
import { formatSeasonDate, resolveSeasonDateLocale } from '../seasons/formatSeasonDate';
import { formatLocalizedNumber } from '../utils/numberLocalization';
import { CropLossDialog } from './CropLossDialog';

interface CropLossesProps {
  planId: number;
  initialDate: string;
  onChanged: () => void;
}

type IncidentsResult = { revision: number; rows: CropLoss[] } | { revision: number; error: true };

export function CropLosses({ planId, initialDate, onChanged }: CropLossesProps) {
  const { t, i18n } = useTranslation(['plantingPlans', 'common']);
  const locale = resolveSeasonDateLocale(i18n);
  const deleteTitle = useId();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<IncidentsResult>();
  const [editor, setEditor] = useState<CropLoss | 'new' | null>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; incident: CropLoss } | null>(null);
  const [deleting, setDeleting] = useState<CropLoss | null>(null);
  const [deleteError, setDeleteError] = useState(false);
  const [saving, setSaving] = useState(false);
  const visible = result?.revision === revision ? result : undefined;
  const rows = visible && 'rows' in visible ? visible.rows : undefined;

  useEffect(() => {
    const controller = new AbortController();
    void cropLossAPI.listForPlan(planId, controller.signal).then(({ results }) => {
      if (!controller.signal.aborted) setResult({ revision, rows: results });
    }).catch(() => {
      if (!controller.signal.aborted) setResult({ revision, error: true });
    });
    return () => controller.abort();
  }, [planId, revision]);

  const refresh = () => setRevision(value => value + 1);
  const afterChange = () => {
    refresh();
    onChanged();
  };
  const remove = async () => {
    if (!deleting || saving) return;
    setSaving(true);
    setDeleteError(false);
    try {
      await cropLossAPI.delete(deleting.id);
      setDeleting(null);
      afterChange();
    } catch {
      setDeleteError(true);
    } finally {
      setSaving(false);
    }
  };

  const extentLabel = ({ extent_unit: unit, extent_value: value }: CropLoss) => {
    if (value === null || !unit) return '';
    const amount = Number(value);
    const formatted = formatLocalizedNumber(amount, locale, { maximumFractionDigits: 3 });
    if (unit === 'percent') return formatLocalizedNumber(amount / 100, locale, { style: 'percent', maximumFractionDigits: 3 });
    return unit === 'plants' ? t('cropLosses.extentPlants', { count: amount, value: formatted })
      : t('cropLosses.extentArea', { value: formatted });
  };

  return <DetailSection title={t('cropLosses.title')} outlined>
    <Stack spacing={1.25} sx={{ minWidth: 0 }}>
      <Button startIcon={<AddIcon />} sx={{ alignSelf: 'flex-start' }} onClick={() => setEditor('new')}>
        {t('cropLosses.add')}
      </Button>
      {!visible && <CircularProgress size={22} aria-label={t('cropLosses.loading')} />}
      {visible && 'error' in visible && <Alert severity="error" action={<LoadRetryButton onClick={refresh} />}>
        {t('cropLosses.errors.load')}
      </Alert>}
      {rows?.length === 0 && <Typography variant="body2" color="text.secondary">{t('cropLosses.empty')}</Typography>}
      {!!rows?.length && <List disablePadding aria-label={t('cropLosses.title')}>
        {rows.map(row => {
          const date = formatSeasonDate(row.date, locale);
          const cause = t(`cropLosses.causes.${row.cause}`);
          const extent = extentLabel(row);
          return <ListItem key={row.id} divider disableGutters sx={{ py: 0.75, gap: 1, alignItems: 'flex-start' }}>
            <Stack spacing={0.25} sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
              <Typography variant="subtitle2">{[t(`cropLosses.types.${row.loss_type}`), cause, extent].filter(Boolean).join(' · ')}</Typography>
              <Typography variant="body2" color="text.secondary">{date}</Typography>
              {row.note && <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{row.note}</Typography>}
            </Stack>
            <IconButton aria-label={t('cropLosses.actionsFor', { date, cause })} aria-haspopup="menu"
              aria-expanded={menu?.incident.id === row.id}
              onClick={event => setMenu({ anchor: event.currentTarget, incident: row })} sx={{ width: 44, height: 44 }}>
              <MoreVertIcon />
            </IconButton>
          </ListItem>;
        })}
      </List>}
    </Stack>
    <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
      <MenuItem onClick={() => { if (menu) setEditor(menu.incident); setMenu(null); }}>{t('cropLosses.edit')}</MenuItem>
      <MenuItem onClick={() => { if (menu) setDeleting(menu.incident); setDeleteError(false); setMenu(null); }}>
        {t('cropLosses.delete')}
      </MenuItem>
    </Menu>
    {editor && <CropLossDialog planId={planId} initialDate={initialDate} incident={editor === 'new' ? undefined : editor}
      onClose={() => setEditor(null)} onSaved={() => { setEditor(null); afterChange(); }} />}
    <Dialog open={!!deleting} onClose={saving ? undefined : () => setDeleting(null)} aria-labelledby={deleteTitle}>
      <DialogTitle id={deleteTitle}>{t('cropLosses.delete')}</DialogTitle>
      <DialogContent>
        {deleting && <Typography>{t('cropLosses.confirmDelete', { date: formatSeasonDate(deleting.date, locale) })}</Typography>}
        {deleteError && <Alert severity="error" sx={{ mt: 1 }}>{t('cropLosses.errors.delete')}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setDeleting(null)} disabled={saving}>{t('common:actions.cancel')}</Button>
        <Button color="error" onClick={() => { void remove(); }} disabled={saving}>{t('common:actions.delete')}</Button>
      </DialogActions>
    </Dialog>
  </DetailSection>;
}
