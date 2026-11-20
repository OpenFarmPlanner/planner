import { useEffect, useId, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
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
    useActualDates?: boolean,
  ) => Promise<{ copied_count: number; target_planting_plan_count: number }>;
}

type PreviewState = { targetId: number; version: number } & (
  | { data: SeasonCopyPreview }
  | { error: unknown }
);

const DEFAULT_ROTATION_MODE: SeasonCopyRotationMode = 'without_bed';

export function SeasonCopyDataDialog({ open, targetSeason, onClose, onConfirm }: SeasonCopyDataDialogProps) {
  const { t } = useTranslation(['navigation', 'common']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [source, setSource] = useState<{ targetId: number; id: number; label: string } | null>(null);
  const [dateBasis, setDateBasis] = useState<{
    useActualDates: boolean; version: number; source?: { targetId: number; id: number };
  }>({ useActualDates: false, version: 0 });
  const [rotationMode, setRotationMode] = useState<SeasonCopyRotationMode>(DEFAULT_ROTATION_MODE);
  const dateBasisHelpId = useId();
  const targetSeasonId = targetSeason?.id ?? null;
  useEffect(() => {
    if (!open || targetSeasonId === null) {
      return undefined;
    }
    let cancelled = false;
    const sourceId = dateBasis.source?.targetId === targetSeasonId ? dateBasis.source.id : undefined;
    seasonAPI.copyPreview(targetSeasonId, sourceId, dateBasis.useActualDates)
      .then((response) => {
        if (!cancelled) {
          setSource({
            targetId: targetSeasonId, id: response.data.source_season_id,
            label: response.data.source_season_label,
          });
          setPreviewState({ targetId: targetSeasonId, version: dateBasis.version, data: response.data });
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setPreviewState({ targetId: targetSeasonId, version: dateBasis.version, error: requestError });
          if (extractApiErrorCode(requestError) === 'season_copy_no_preceding_source') setSource(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, targetSeasonId, dateBasis]);

  const result = previewState?.targetId === targetSeasonId && previewState.version === dateBasis.version
    ? previewState : null;
  const preview = result && 'data' in result ? result.data : null;
  const previewFailure = result && 'error' in result ? result : null;
  const previewErrorCode = extractApiErrorCode(previewFailure?.error);
  const noPrecedingSource = previewErrorCode === 'season_copy_no_preceding_source';
  const sourceChanged = previewErrorCode === 'source_season_not_found' || previewErrorCode === 'season_copy_source_not_preceding';
  const sourceForTarget = source?.targetId === targetSeasonId ? source : null;
  const sourceLabel = sourceForTarget?.label;
  const hasRotationFindings = Boolean(preview && (preview.conflict_count > 0 || preview.hint_count > 0));

  const refreshPreview = (useActualDates: boolean) => {
    setError(null);
    setDateBasis(current => ({
      useActualDates, version: current.version + 1, source: sourceForTarget ?? undefined,
    }));
  };

  const handleClose = () => {
    setPreviewState(null);
    setSource(null);
    setDateBasis({ useActualDates: false, version: 0 });
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
      const result = await onConfirm(
        targetSeason.id, preview.source_season_id,
        preview.conflict_count > 0 ? rotationMode : undefined,
        dateBasis.useActualDates,
      );
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
        setPreviewState({ targetId: targetSeason.id, version: dateBasis.version, error: confirmError });
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
        <Stack component="dl" spacing={0.5} sx={{ mt: 0, mb: 2, overflowWrap: 'anywhere' }}>
          {sourceLabel && (
            <>
              <Typography component="dt" variant="subtitle2">{t('navigation:seasonSwitcher.copyDialog.sourceLabel')}</Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0 }}>{sourceLabel}</Typography>
            </>
          )}
          <Typography component="dt" variant="subtitle2">{t('navigation:seasonSwitcher.copyDialog.targetLabel')}</Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0 }}>{targetSeason.label}</Typography>
        </Stack>

        {sourceLabel && (
          <Stack sx={{ mb: 2 }}>
            <FormControlLabel
              sx={{ m: 0, alignItems: 'flex-start', '& .MuiFormControlLabel-label': { pt: 1 } }}
              control={<Checkbox checked={dateBasis.useActualDates} disabled={submitting || sourceChanged}
                onChange={(_, checked) => refreshPreview(checked)}
                slotProps={{ input: { 'aria-describedby': dateBasisHelpId } }} />}
              label={t('navigation:seasonSwitcher.copyDialog.useActualDates')}
            />
            <Typography id={dateBasisHelpId} variant="body2" color="text.secondary" sx={{ pl: 5 }}>
              {t('navigation:seasonSwitcher.copyDialog.useActualDatesHelp')}
            </Typography>
          </Stack>
        )}

        {!result && <Typography role="status" variant="body2">{t('common:messages.loading')}</Typography>}
        {previewFailure && (
          <Alert severity={noPrecedingSource ? 'info' : 'error'} action={!noPrecedingSource && !sourceChanged && (
            <Button color="inherit" onClick={() => refreshPreview(dateBasis.useActualDates)}>{t('common:runtime.retryAction')}</Button>
          )}>
            {previewErrorCode === 'source_season_not_found'
              ? t('navigation:seasonSwitcher.copyDialog.sourceChanged')
              : extractApiErrorMessage(previewFailure.error, t, t('navigation:seasonSwitcher.copyDialog.previewError'))}
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
              total: preview.total + targetSeason.planting_plan_count,
            })}
          </Typography>
        ) : null}

        {preview && preview.skipped_count > 0 && (
          <Typography variant="body2" color="warning.dark" sx={{ mt: 0.5 }}>
            {t('navigation:seasonSwitcher.copyDialog.skippedPlans', { count: preview.skipped_count })}
          </Typography>
        )}

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
            : !result ? t('common:messages.loading') : ''}
        >
          <Button onClick={() => void handleConfirm()} variant="contained" disabled={submitting || !preview}>
            {t('navigation:seasonSwitcher.copyDialog.confirm')}
          </Button>
        </DisabledActionTooltip>
      </DialogActions>
    </Dialog>
  );
}
