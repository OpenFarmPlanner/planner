import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { DisabledActionTooltip } from '../../../components/DisabledActionTooltip';

export interface ImportConflictDialogProps {
  open: boolean;
  cropName: string;
  busy: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
  onCancel: () => void;
  onUpdate: () => void;
  onImportAsNew: () => void;
  /** Set when the library variety name differs from the local copy's current variety, so the rename is called out explicitly instead of blending into the generic warning. */
  varietyChange?: { from: string; to: string } | null;
}

/**
 * Shown when re-importing a public crop that's already linked to a
 * project crop with local edits — updating and importing-as-new are both
 * valid, mutually exclusive choices, so this offers explicit buttons for
 * each instead of a single confirm/cancel pair.
 */
export function ImportConflictDialog({
  open,
  cropName,
  busy,
  t,
  onCancel,
  onUpdate,
  onImportAsNew,
  varietyChange,
}: ImportConflictDialogProps) {
  return (
    <Dialog open={open} onClose={busy ? undefined : onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>{t('library.importConflictDialog.title')}</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
          {t('library.importConflictDialog.message', { name: cropName })}
        </Typography>
        {varietyChange ? (
          <Alert severity="info" sx={{ mb: 2 }}>
            {t('library.importConflictDialog.varietyRenamed', {
              from: varietyChange.from || t('library.page.notSpecified'),
              to: varietyChange.to || t('library.page.notSpecified'),
            })}
          </Alert>
        ) : null}
        <Alert severity="warning">
          {t('library.importConflictDialog.updateWarning')}
        </Alert>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1, flexWrap: 'wrap', gap: 1 }}>
        {/* autoFocus on cancel so a reflexive Enter never triggers the destructive "update" action below. */}
        <DisabledActionTooltip title={busy ? t('common:disabledReasons.busy') : ''}>
          <Button autoFocus variant="outlined" onClick={onCancel} disabled={busy}>
            {t('common:actions.cancel')}
          </Button>
        </DisabledActionTooltip>
        <DisabledActionTooltip title={busy ? t('common:disabledReasons.busy') : ''}>
          <Button variant="outlined" onClick={onImportAsNew} disabled={busy}>
            {t('library.importConflictDialog.importAsNew')}
          </Button>
        </DisabledActionTooltip>
        <DisabledActionTooltip title={busy ? t('common:disabledReasons.busy') : ''}>
          <Button variant="contained" color="error" onClick={onUpdate} disabled={busy}>
            {t('library.importConflictDialog.update')}
          </Button>
        </DisabledActionTooltip>
      </DialogActions>
    </Dialog>
  );
}
