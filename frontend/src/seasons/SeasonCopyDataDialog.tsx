import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
} from '@mui/material';
import type { Season } from '../api/types';
import { useTranslation } from '../i18n';
import { extractApiErrorMessage } from '../api/errors';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';

interface SeasonCopyDataDialogProps {
  open: boolean;
  targetSeason: Season | null;
  seasons: Season[];
  onClose: () => void;
  onConfirm: (targetSeasonId: number, sourceSeasonId: number) => Promise<{ copied_count: number; target_planting_plan_count: number }>;
}

export function SeasonCopyDataDialog({ open, targetSeason, seasons, onClose, onConfirm }: SeasonCopyDataDialogProps) {
  const { t } = useTranslation(['navigation', 'common']);
  const [sourceSeasonId, setSourceSeasonId] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceOptions = useMemo(
    () => seasons.filter((season) => season.id !== targetSeason?.id),
    [seasons, targetSeason],
  );

  const sourceSeason = sourceOptions.find((season) => season.id === sourceSeasonId) ?? null;

  const handleClose = () => {
    setSourceSeasonId('');
    setError(null);
    onClose();
  };

  const handleConfirm = async () => {
    if (!targetSeason || sourceSeasonId === '') {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(targetSeason.id, sourceSeasonId);
      handleClose();
    } catch (confirmError) {
      setError(extractApiErrorMessage(confirmError, t, t('navigation:seasonSwitcher.copyDialog.error')));
    } finally {
      setSubmitting(false);
    }
  };

  if (!targetSeason) {
    return null;
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('navigation:seasonSwitcher.copyDialog.title')}</DialogTitle>
      <DialogContent>
        <FormControl fullWidth sx={{ mt: 1, mb: 2 }}>
          <InputLabel id="season-copy-source-label">{t('navigation:seasonSwitcher.copyDialog.sourceLabel')}</InputLabel>
          <Select
            labelId="season-copy-source-label"
            label={t('navigation:seasonSwitcher.copyDialog.sourceLabel')}
            value={sourceSeasonId}
            onChange={(event) => setSourceSeasonId(Number(event.target.value))}
          >
            {sourceOptions.map((season) => (
              <MenuItem key={season.id} value={season.id}>{season.label}</MenuItem>
            ))}
          </Select>
        </FormControl>

        {targetSeason.planting_plan_count > 0 && sourceSeason ? (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t('navigation:seasonSwitcher.copyDialog.warning', {
              target: targetSeason.label,
              count: targetSeason.planting_plan_count,
              source: sourceSeason.label,
            })}
          </Alert>
        ) : null}

        {sourceSeason ? (
          <Typography variant="body2" color="text.secondary">
            {t('navigation:seasonSwitcher.copyDialog.summary', {
              count: sourceSeason.planting_plan_count,
              source: sourceSeason.label,
              target: targetSeason.label,
              total: sourceSeason.planting_plan_count + targetSeason.planting_plan_count,
            })}
          </Typography>
        ) : null}

        {error ? <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert> : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={submitting}>{t('common:actions.cancel')}</Button>
        <DisabledActionTooltip
          title={sourceSeasonId === '' ? t('navigation:seasonSwitcher.copyDialog.confirmDisabledTooltip') : ''}
        >
          <Button onClick={() => void handleConfirm()} variant="contained" disabled={submitting || sourceSeasonId === ''}>
              {t('navigation:seasonSwitcher.copyDialog.confirm')}
          </Button>
        </DisabledActionTooltip>
      </DialogActions>
    </Dialog>
  );
}
