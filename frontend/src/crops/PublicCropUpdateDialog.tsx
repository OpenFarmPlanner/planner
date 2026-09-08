/**
 * The pending public-library update diff/apply dialog for a linked project crop.
 *
 * It is opened from the badge-row library action when the library is ahead of
 * the local copy (`CropLibraryActionButton`, state "pullUpdate", or the
 * "Update abgelehnt" chip after a decision). The dialog offers three outcomes:
 * applying the update, declining it for exactly this public version
 * ("Ablehnen", which changes nothing locally and retires the "Kultur
 * aktualisieren" button until the public entry changes again), and closing
 * without deciding ("Abbrechen", which stores nothing at all).
 */

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { useTranslation } from '../i18n';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';
import type { Crop, PublicCropUpdateFieldChange } from '../api/types';
import {
  formatPublicCropValue,
  getPublicCropComparisonFieldLabel,
} from '../crop-library/components/publicCropLibrary/formatters';
import type { PublicCropUpdateController } from './usePublicCropUpdate';

interface PublicCropUpdateDialogProps {
  crop: Crop;
  controller: PublicCropUpdateController;
}

const DIFF_ROW_SX = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', sm: 'minmax(8rem, 0.8fr) 1fr 1fr' },
  gap: { xs: 0.5, sm: 1.5 },
  px: 2,
  py: 1,
  borderTop: '1px solid',
  borderColor: 'divider',
} as const;

export function PublicCropUpdateDialog({ crop, controller }: PublicCropUpdateDialogProps) {
  const { t } = useTranslation(['crops', 'common']);
  const {
    update,
    isApplying,
    isRejecting,
    closeDiff,
    applyUpdate,
    rejectUpdate,
  } = controller;

  const changes: PublicCropUpdateFieldChange[] = update?.changes ?? [];
  const varietyChange = changes.find((change) => change.field === 'variety');
  const otherChanges = changes.filter((change) => change.field !== 'variety');
  const isBusy = isApplying || isRejecting;

  return (
    <Dialog open={update !== null} onClose={closeDiff} maxWidth="sm" fullWidth>
      <DialogTitle>{t('library.publicUpdate.dialogTitle')}</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
          {t('library.publicUpdate.dialogDescription', {
            name: update?.public_crop_name ?? crop.name,
          })}
        </Typography>

        {update?.is_rejected ? (
          <Alert severity="info" sx={{ mb: 2 }} data-testid="crop-public-update-rejected-hint">
            {t('library.publicUpdate.rejectedHint')}
          </Alert>
        ) : null}

        {varietyChange ? (
          <Alert severity="info" sx={{ mb: 2 }} data-testid="crop-public-update-variety-change">
            {t('library.importConflictDialog.varietyRenamed', {
              from: formatPublicCropValue('variety', varietyChange.local_value, t),
              to: formatPublicCropValue('variety', varietyChange.public_value, t),
            })}
          </Alert>
        ) : null}

        {otherChanges.length ? (
          <Box
            aria-label={t('library.publicUpdate.changesAriaLabel')}
            sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}
          >
            <Box sx={{ ...DIFF_ROW_SX, borderTop: 'none', bgcolor: 'action.hover' }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }} />
              <Typography variant="caption" color="text.secondary">
                {t('library.publicUpdate.localValue')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('library.publicUpdate.publicValue')}
              </Typography>
            </Box>
            <Box component="dl" sx={{ m: 0 }}>
              {otherChanges.map((change) => (
                <Box key={change.field} sx={DIFF_ROW_SX}>
                  <Typography component="dt" variant="body2" sx={{ fontWeight: 600 }}>
                    {getPublicCropComparisonFieldLabel(change.field, t)}
                  </Typography>
                  <Typography component="dd" variant="body2" sx={{ m: 0, color: 'text.secondary' }}>
                    {formatPublicCropValue(change.field, change.local_value, t)}
                  </Typography>
                  <Typography component="dd" variant="body2" sx={{ m: 0 }}>
                    {formatPublicCropValue(change.field, change.public_value, t)}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        ) : null}

        {update?.has_local_changes ? (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {t('library.importConflictDialog.updateWarning')}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, pt: 1, flexWrap: 'wrap', gap: 1 }}>
        {/* autoFocus on cancel so a reflexive Enter never overwrites the local copy. */}
        <DisabledActionTooltip title={isBusy ? t('common:disabledReasons.busy') : ''}>
          <Button autoFocus variant="outlined" onClick={closeDiff} disabled={isBusy}>
            {t('common:actions.cancel')}
          </Button>
        </DisabledActionTooltip>
        <DisabledActionTooltip
          title={isBusy
            ? t('common:disabledReasons.busy')
            : update?.is_rejected
              ? t('disabledReasons.alreadyRejected')
              : ''}
        >
          <Button
            variant="outlined"
            color="inherit"
            onClick={rejectUpdate}
            disabled={isBusy || update?.is_rejected}
            startIcon={isRejecting ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {isRejecting ? t('library.publicUpdate.rejecting') : t('library.publicUpdate.reject')}
          </Button>
        </DisabledActionTooltip>
        <DisabledActionTooltip title={isBusy ? t('common:disabledReasons.busy') : ''}>
          <Button
            variant="contained"
            color={update?.has_local_changes ? 'error' : 'primary'}
            onClick={applyUpdate}
            disabled={isBusy}
            startIcon={isApplying ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {isApplying ? t('library.publicUpdate.applying') : t('library.publicUpdate.apply')}
          </Button>
        </DisabledActionTooltip>
      </DialogActions>
    </Dialog>
  );
}
