import { useId } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { visuallyHidden } from '@mui/utils';

import type { CropHistoryEntry, ProjectRestoreImpact } from '../api/types';
import { getBatchSummary, isBatchGroupEntry } from '../pages/cropsHistoryUtils';
import type { TFunction } from 'i18next';
import type { RestorePreviewState } from './useProjectHistory';

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
  preview?: RestorePreviewState;
  busy?: boolean;
  onRefreshPreview?: () => void;
}

const impactActions = ['removed', 'restored', 'changed'] as const;

function RestoreImpactSummary({ impact, tCrops }: {
  impact: ProjectRestoreImpact[];
  tCrops: TFunction<'crops'>;
}) {
  const headingId = useId();
  return (
    <Box component="section" aria-labelledby={headingId} sx={{ my: 2 }}>
      <Typography component="h3" variant="subtitle2" id={headingId}>
        {tCrops('restoreDialog.preview.title')}
      </Typography>
      {impact.length === 0 ? (
        <Typography variant="body2">{tCrops('restoreDialog.preview.unchanged')}</Typography>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary">
            {tCrops('restoreDialog.preview.counting')}
          </Typography>
          <Box component="ul" role="list" sx={{ listStyle: 'none', p: 0, m: 0 }}>
            {impact.map((item) => {
              const category = tCrops(`restoreDialog.preview.categories.${item.category}`);
              return (
                <Box
                  component="li"
                  key={item.category}
                  sx={{ py: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {category}
                  </Typography>
                  <Box component="ul" role="list" sx={{
                    listStyle: 'none', p: 0, m: 0, display: { sm: 'flex' }, flexWrap: 'wrap', gap: 1.5,
                  }}>
                    {impactActions.map((action) => {
                      const { count, names } = item[action];
                      if (count === 0) return null;
                      const label = tCrops(`restoreDialog.preview.actions.${action}`, { count });
                      return (
                        <Box component="li" key={action} sx={{ typography: 'body2' }}>
                          {names.length > 0 ? (
                            <Box component="details">
                              <Box component="summary" aria-label={`${category}, ${label}`} sx={{ cursor: 'pointer' }}>
                                {label}
                              </Box>
                              <Box component="ul" sx={{ pl: 3, overflowWrap: 'anywhere' }}>
                                {names.map((name, index) => <li key={`${index}-${name}`}>{name}</li>)}
                              </Box>
                              {names.length < count ? (
                                <Typography variant="caption" color="text.secondary">
                                  {tCrops('restoreDialog.preview.sample', { shown: names.length, total: count })}
                                </Typography>
                              ) : null}
                            </Box>
                          ) : label}
                        </Box>
                      );
                    })}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </>
      )}
    </Box>
  );
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
  preview,
  busy = false,
  onRefreshPreview,
}: RestoreVersionDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const isBatch = entry ? isBatchGroupEntry(entry) : false;
  const displayName = entry?.is_automatic_backup ? null : entry?.object_display_name?.trim();
  const status = preview?.status ?? 'loading';
  const previewError = status !== 'ready' && status !== 'loading';

  return (
    <Dialog
      open={Boolean(entry)}
      onClose={busy ? undefined : onClose}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      fullWidth
      maxWidth={mode === 'version' ? 'sm' : 'xs'}
    >
      <DialogTitle id={titleId}>{tCrops(mode === 'batch' ? 'history.batch.undo' : 'restoreDialog.title')}</DialogTitle>
      <DialogContent>
        <Typography id={descriptionId} variant="body2" sx={{ mb: 1.5 }}>
          {tCrops(mode === 'batch' ? 'restoreDialog.batchDescription' : 'restoreDialog.versionDescription')}
        </Typography>
        {entry ? (
          <Box sx={{ mb: 1.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {isBatch
                ? getBatchSummary(entry, tCrops)
                : (displayName || getEntryTitle(entry))}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {formatTimestamp(entry.history_date)}
            </Typography>
          </Box>
        ) : null}
        {mode === 'version' ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {tCrops('restoreDialog.preview.scope')}
          </Typography>
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
        {mode === 'version' ? (
          <>
            <Box role="status" sx={visuallyHidden}>
              {busy ? tCrops('restoreDialog.preview.restoring') : (
                status === 'loading' ? tCrops('restoreDialog.preview.loading')
                  : status === 'ready' ? tCrops('restoreDialog.preview.title') : null
              )}
            </Box>
            {preview?.status === 'ready' ? (
              <RestoreImpactSummary impact={preview.data.impact} tCrops={tCrops} />
            ) : null}
            {status === 'loading' ? (
              <Typography aria-hidden variant="body2" sx={{ my: 2 }}>
                {tCrops('restoreDialog.preview.loading')}
              </Typography>
            ) : null}
            {previewError ? (
              <Box sx={{ my: 2 }}>
                <Alert severity={status === 'unavailable' ? 'error' : 'warning'}>
                  {tCrops(`restoreDialog.preview.${status}`)}
                </Alert>
                {status !== 'too_large' ? (
                  <Button onClick={onRefreshPreview} sx={{ mt: 0.5 }}>
                    {tCrops('restoreDialog.preview.refresh')}
                  </Button>
                ) : null}
              </Box>
            ) : null}
          </>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', rowGap: 1 }}>
        <Button autoFocus disabled={busy} variant="outlined" onClick={onClose}>{tCrops('restoreDialog.cancel')}</Button>
        <Button
          variant="contained"
          disabled={busy || (mode === 'version' && status !== 'ready')}
          onClick={() => {
            if (!entry) {
              return;
            }
            onConfirm(mode === 'batch' ? entry.batch_id! : entry.history_id);
          }}
        >
          {tCrops(mode === 'batch' ? 'history.batch.undo' : busy ? 'restoreDialog.preview.restoring' : 'restoreDialog.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
