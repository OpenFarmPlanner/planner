import { useEffect, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from '@mui/material';
import type { Season } from '../api/types';
import { useTranslation } from '../i18n';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';
import { extractApiErrorMessage } from '../api/errors';

interface SeasonRenameDialogProps {
  open: boolean;
  season: Season | null;
  onClose: () => void;
  onConfirm: (seasonId: number, customLabel: string) => Promise<void>;
}

export function SeasonRenameDialog({ open, season, onClose, onConfirm }: SeasonRenameDialogProps) {
  const { t } = useTranslation(['navigation', 'common']);
  const [customLabel, setCustomLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCustomLabel(season?.custom_label ?? '');
    setError(null);
  }, [season]);

  const handleConfirm = async () => {
    if (!season) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(season.id, customLabel.trim());
      onClose();
    } catch (confirmError) {
      setError(extractApiErrorMessage(confirmError, t, t('navigation:seasonSwitcher.copyDialog.error')));
    } finally {
      setSubmitting(false);
    }
  };

  if (!season) {
    return null;
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{t('navigation:seasonSwitcher.renameDialog.title')}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          fullWidth
          margin="dense"
          label={t('navigation:seasonSwitcher.renameDialog.label')}
          helperText={t('navigation:seasonSwitcher.renameDialog.helper', { computed: season.computed_label })}
          value={customLabel}
          onChange={(event) => setCustomLabel(event.target.value)}
        />
        {error ? <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert> : null}
      </DialogContent>
      <DialogActions>
        <DisabledActionTooltip title={submitting ? t('common:disabledReasons.busy') : ''}>
          <Button onClick={onClose} disabled={submitting}>{t('common:actions.cancel')}</Button>
        </DisabledActionTooltip>
        <DisabledActionTooltip title={submitting ? t('common:disabledReasons.busy') : ''}>
          <Button onClick={() => void handleConfirm()} variant="contained" disabled={submitting}>
            {t('navigation:seasonSwitcher.renameDialog.save')}
          </Button>
        </DisabledActionTooltip>
      </DialogActions>
    </Dialog>
  );
}
