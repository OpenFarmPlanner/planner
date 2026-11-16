import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';

import type { CropHistoryEntry } from '../api/types';
import { getBatchSummary, isBatchGroupEntry } from '../pages/cropsHistoryUtils';
import type { TFunction } from 'i18next';

interface RestoreVersionDialogProps {
  /** The dialog is open while this is non-null. */
  entry: CropHistoryEntry | null;
  /** Fallback title when the entry has no display name (page supplies i18n). */
  getEntryTitle: (entry: CropHistoryEntry) => string;
  formatTimestamp: (value: string) => string;
  tCrops: TFunction<'crops'>;
  onClose: () => void;
  onConfirm: (historyId: number) => void;
  mode?: 'version' | 'batch';
}

/**
 * Presentational confirmation dialog for the project version history. A plain
 * revision entry offers "restore to this version"; a batch entry offers
 * "undo this action". State and the handlers live in RootLayout.tsx. The copy
 * is sourced from the crops namespace so every supported UI language stays aligned.
 */
export function RestoreVersionDialog({
  entry,
  getEntryTitle,
  formatTimestamp,
  tCrops,
  onClose,
  onConfirm,
  mode = 'version',
}: RestoreVersionDialogProps) {
  const isBatch = entry ? isBatchGroupEntry(entry) : false;

  return (
    <Dialog open={Boolean(entry)} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{tCrops(mode === 'batch' ? 'history.batch.undo' : 'restoreDialog.title')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 1.5 }}>
          {tCrops(mode === 'batch' ? 'restoreDialog.batchDescription' : 'restoreDialog.versionDescription')}
        </Typography>
        {entry ? (
          <Box sx={{ mb: 1.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {isBatch
                ? getBatchSummary(entry, tCrops)
                : (entry.object_display_name?.trim() || getEntryTitle(entry))}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {formatTimestamp(entry.history_date)}
            </Typography>
          </Box>
        ) : null}
        <Box
          sx={{
            borderRadius: 1.5,
            border: '1px solid',
            borderColor: 'success.light',
            bgcolor: (theme) => alpha(theme.palette.success.main, 0.08),
            px: 1.25,
            py: 1,
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {tCrops(mode === 'batch' ? 'restoreDialog.batchNotice' : 'restoreDialog.versionNotice')}
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button autoFocus variant="outlined" onClick={onClose}>{tCrops('restoreDialog.cancel')}</Button>
        <Button
          variant="contained"
          onClick={() => {
            if (!entry) {
              return;
            }
            onConfirm(mode === 'batch' ? entry.batch_id! : entry.history_id);
          }}
        >
          {tCrops(mode === 'batch' ? 'history.batch.undo' : 'restoreDialog.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
