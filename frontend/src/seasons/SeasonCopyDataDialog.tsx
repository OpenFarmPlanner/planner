import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { seasonAPI } from '../api/api';
import type { Season, SeasonCopyPreview, SeasonCopyRotationMode } from '../api/types';
import { useTranslation } from '../i18n';
import { extractApiErrorCode, extractApiErrorMessage } from '../api/errors';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';
import { showGlobalSnackbar } from '../utils/globalSnackbar';
import { SeasonCopyRotationSummary } from './SeasonCopyRotationSummary';

interface SeasonCopyDataDialogProps {
  open: boolean;
  targetSeason: Season | null;
  onClose: () => void;
  onConfirm: (
    targetSeasonId: number,
    sourceSeasonId: number,
    rotationConflicts?: SeasonCopyRotationMode,
  ) => Promise<{ copied_count: number; target_planting_plan_count: number }>;
}

type PreviewState = { targetId: number } & (
  | { data: SeasonCopyPreview }
  | { error: unknown }
);

const DEFAULT_ROTATION_MODE: SeasonCopyRotationMode = 'without_bed';

export function SeasonCopyDataDialog({ open, targetSeason, onClose, onConfirm }: SeasonCopyDataDialogProps) {
  const { t } = useTranslation(['navigation', 'common']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [rotationMode, setRotationMode] = useState<SeasonCopyRotationMode>(DEFAULT_ROTATION_MODE);
  const targetSeasonId = targetSeason?.id ?? null;
  useEffect(() => {
    if (!open || targetSeasonId === null) {
      return undefined;
    }
    let cancelled = false;
    seasonAPI.copyPreview(targetSeasonId)
      .then((response) => {
        if (!cancelled) {
          setPreviewState({ targetId: targetSeasonId, data: response.data });
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setPreviewState({ targetId: targetSeasonId, error: requestError });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, targetSeasonId]);

  const result = previewState?.targetId === targetSeasonId ? previewState : null;
  const preview = result && 'data' in result ? result.data : null;
  const previewFailure = result && 'error' in result ? result : null;
  const noPrecedingSource = extractApiErrorCode(previewFailure?.error) === 'season_copy_no_preceding_source';
  const hasRotationFindings = Boolean(preview && (preview.conflict_count > 0 || preview.hint_count > 0));

  const handleClose = () => {
    setPreviewState(null);
    setError(null);
    setRotationMode(DEFAULT_ROTATION_MODE);
    onClose();
  };

  const handleConfirm = async () => {
    if (!targetSeason || !preview || submitting) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = preview.conflict_count > 0
        ? await onConfirm(targetSeason.id, preview.source_season_id, rotationMode)
        : await onConfirm(targetSeason.id, preview.source_season_id);
      showGlobalSnackbar({
        message: t(result.copied_count > 0 ? 'seasonSwitcher.copyDialog.success' : 'seasonSwitcher.copyDialog.noCopies', {
          target: targetSeason.label,
        }),
        severity: result.copied_count > 0 ? 'success' : 'info',
      });
      handleClose();
    } catch (confirmError) {
      const code = extractApiErrorCode(confirmError);
      if (code === 'season_copy_source_not_preceding' || code === 'source_season_not_found') {
        setPreviewState({ targetId: targetSeason.id, error: confirmError });
      } else {
        setError(extractApiErrorMessage(confirmError, t, t('navigation:seasonSwitcher.copyDialog.error')));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!targetSeason) {
    return null;
  }

  return (
    <Dialog open={open} onClose={submitting ? undefined : handleClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('navigation:seasonSwitcher.copyDialog.title')}</DialogTitle>
      <DialogContent>
        <Stack component="dl" spacing={0.5} sx={{ mt: 1, mb: 2, overflowWrap: 'anywhere' }}>
          {preview && (
            <>
              <Typography component="dt" variant="subtitle2">{t('navigation:seasonSwitcher.copyDialog.sourceLabel')}</Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0 }}>{preview.source_season_label}</Typography>
            </>
          )}
          <Typography component="dt" variant="subtitle2">{t('navigation:seasonSwitcher.copyDialog.targetLabel')}</Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0 }}>{targetSeason.label}</Typography>
        </Stack>

        {!result && <Typography role="status" variant="body2">{t('common:actions.loading')}</Typography>}
        {previewFailure && (
          <Alert severity={noPrecedingSource ? 'info' : 'error'}>
            {extractApiErrorMessage(previewFailure.error, t, t(
              extractApiErrorCode(previewFailure.error) === 'source_season_not_found'
                ? 'navigation:seasonSwitcher.copyDialog.sourceChanged' : 'navigation:seasonSwitcher.copyDialog.previewError',
            ))}
          </Alert>
        )}

        {targetSeason.planting_plan_count > 0 && preview ? (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t('navigation:seasonSwitcher.copyDialog.warning', {
              target: targetSeason.label,
              count: targetSeason.planting_plan_count,
              source: preview.source_season_label,
            })}
          </Alert>
        ) : null}

        {preview ? (
          <Typography variant="body2" color="text.secondary">
            {t('navigation:seasonSwitcher.copyDialog.summary', {
              count: preview.total,
              source: preview.source_season_label,
              target: targetSeason.label,
              total: preview.total + targetSeason.planting_plan_count,
            })}
          </Typography>
        ) : null}

        {preview && hasRotationFindings ? (
          <SeasonCopyRotationSummary preview={preview} mode={rotationMode} onModeChange={setRotationMode} />
        ) : null}

        {error ? <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert> : null}
      </DialogContent>
      <DialogActions>
        <DisabledActionTooltip title={submitting ? t('common:disabledReasons.busy') : ''}>
          <Button onClick={handleClose} disabled={submitting}>{t('common:actions.cancel')}</Button>
        </DisabledActionTooltip>
        <DisabledActionTooltip
          title={submitting
            ? t('common:disabledReasons.busy')
            : !result ? t('common:actions.loading') : ''}
        >
          <Button onClick={() => void handleConfirm()} variant="contained" disabled={submitting || !preview}>
            {t('navigation:seasonSwitcher.copyDialog.confirm')}
          </Button>
        </DisabledActionTooltip>
      </DialogActions>
    </Dialog>
  );
}
