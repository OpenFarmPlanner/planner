import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AlertTitle,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
} from '@mui/material';
import axios from 'axios';
import type {
  Season,
  SeasonPeriodEditConflict,
  SeasonPeriodEditOverlapConflict,
  SeasonPeriodEditPlantingConflict,
} from '../api/types';
import { useTranslation } from '../i18n';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';
import { extractApiErrorMessage } from '../api/errors';
import { formatSeasonDate, formatSeasonPeriod, resolveSeasonDateLocale } from './formatSeasonDate';

interface SeasonPeriodEditDialogProps {
  open: boolean;
  season: Season | null;
  onClose: () => void;
  onConfirm: (seasonId: number, period: { start_date: string; end_date: string }) => Promise<void>;
}

function parsePeriodEditConflict(error: unknown): SeasonPeriodEditConflict | null {
  if (!axios.isAxiosError(error)) {
    return null;
  }
  const data = error.response?.data as Partial<SeasonPeriodEditConflict> & { code?: string | string[] } | undefined;
  const code = data ? (Array.isArray(data.code) ? data.code[0] : data.code) : undefined;
  if (!data || code !== 'season_period_edit_conflict') {
    return null;
  }
  return {
    code: 'season_period_edit_conflict',
    planting_plan_conflicts: Array.isArray(data.planting_plan_conflicts) ? data.planting_plan_conflicts : [],
    overlap_conflicts: Array.isArray(data.overlap_conflicts) ? data.overlap_conflicts : [],
  };
}

export function SeasonPeriodEditDialog({ open, season, onClose, onConfirm }: SeasonPeriodEditDialogProps) {
  const { t, i18n } = useTranslation(['navigation', 'common']);
  const locale = resolveSeasonDateLocale(i18n);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<SeasonPeriodEditConflict | null>(null);

  useEffect(() => {
    setStartDate(season?.start_date ?? '');
    setEndDate(season?.end_date ?? '');
    setError(null);
    setConflict(null);
  }, [season]);

  const rangeInvalid = Boolean(startDate && endDate && endDate <= startDate);
  const unchanged = Boolean(
    season && startDate === season.start_date && endDate === season.end_date,
  );

  const handleConfirm = async () => {
    if (!season || rangeInvalid || unchanged || !startDate || !endDate) {
      return;
    }
    setSubmitting(true);
    setError(null);
    setConflict(null);
    try {
      await onConfirm(season.id, { start_date: startDate, end_date: endDate });
      onClose();
    } catch (confirmError) {
      const parsed = parsePeriodEditConflict(confirmError);
      if (parsed) {
        setConflict(parsed);
      } else {
        setError(extractApiErrorMessage(
          confirmError, t, t('navigation:seasonSwitcher.periodEditDialog.error'),
        ));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const currentPeriod = useMemo(
    () => (season ? formatSeasonPeriod(season.start_date, season.end_date, locale) : ''),
    [season, locale],
  );

  if (!season) {
    return null;
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('navigation:seasonSwitcher.periodEditDialog.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField
            type="date"
            label={t('navigation:seasonSwitcher.periodEditDialog.startLabel')}
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            fullWidth
          />
          <TextField
            type="date"
            label={t('navigation:seasonSwitcher.periodEditDialog.endLabel')}
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            error={rangeInvalid}
            helperText={rangeInvalid
              ? t('navigation:seasonSwitcher.periodEditDialog.endBeforeStart')
              : t('navigation:seasonSwitcher.periodEditDialog.currentPeriod', { period: currentPeriod })}
            slotProps={{ inputLabel: { shrink: true } }}
            fullWidth
          />

          {conflict && conflict.planting_plan_conflicts.length > 0 ? (
            <Alert severity="warning">
              <AlertTitle>{t('navigation:seasonSwitcher.periodEditDialog.plantingConflictIntro')}</AlertTitle>
              <List dense disablePadding>
                {conflict.planting_plan_conflicts.map((item: SeasonPeriodEditPlantingConflict) => (
                  <ListItem key={item.id} disableGutters sx={{ py: 0 }}>
                    <ListItemText
                      primary={t('navigation:seasonSwitcher.periodEditDialog.plantingConflictItem', {
                        crop: item.crop
                          || t('navigation:seasonSwitcher.periodEditDialog.unknownCrop'),
                        date: formatSeasonDate(item.planting_date, locale),
                      })}
                    />
                  </ListItem>
                ))}
              </List>
            </Alert>
          ) : null}

          {conflict && conflict.overlap_conflicts.length > 0 ? (
            <Alert severity="warning">
              <AlertTitle>{t('navigation:seasonSwitcher.periodEditDialog.overlapConflictIntro')}</AlertTitle>
              <List dense disablePadding>
                {conflict.overlap_conflicts.map((item: SeasonPeriodEditOverlapConflict) => (
                  <ListItem key={item.season_id} disableGutters sx={{ py: 0 }}>
                    <ListItemText
                      primary={t('navigation:seasonSwitcher.periodEditDialog.overlapConflictItem', {
                        label: item.season_label,
                        period: formatSeasonPeriod(item.overlap_start_date, item.overlap_end_date, locale),
                      })}
                    />
                  </ListItem>
                ))}
              </List>
            </Alert>
          ) : null}

          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        {/* Blocking edit: default focus stays on Cancel so a reflexive Enter
            never saves — the user must click Save (or Tab onto it) explicitly. */}
        <DisabledActionTooltip title={submitting ? t('common:disabledReasons.busy') : ''}>
          <Button autoFocus onClick={onClose} disabled={submitting}>
            {t('common:actions.cancel')}
          </Button>
        </DisabledActionTooltip>
        <DisabledActionTooltip
          title={submitting
            ? t('common:disabledReasons.busy')
            : unchanged
              ? t('common:disabledReasons.noChanges')
              : rangeInvalid || !startDate || !endDate
                ? t('common:disabledReasons.invalidDateRange')
                : ''}
        >
          <Button
            onClick={() => void handleConfirm()}
            variant="contained"
            disabled={submitting || rangeInvalid || unchanged || !startDate || !endDate}
          >
            {t('navigation:seasonSwitcher.periodEditDialog.save')}
          </Button>
        </DisabledActionTooltip>
      </DialogActions>
    </Dialog>
  );
}
