import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { seasonAPI } from '../api/api';
import type { ParcelRotationConfirmation, Season, SeasonCopyPreview, SeasonCopyRotationMode } from '../api/types';
import { useTranslation } from '../i18n';
import { extractApiErrorCode, extractApiErrorMessage } from '../api/errors';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';
import { showGlobalSnackbar } from '../utils/globalSnackbar';
import { SeasonCopyRotationSummary } from './SeasonCopyRotationSummary';
import { ParcelRotationCopyPreview } from './ParcelRotationCopyPreview';

interface SeasonCopyDataDialogProps {
  targetSeason: Season;
  seasons: readonly Season[];
  onClose: () => void;
  onConfirm: (
    targetSeasonId: number,
    sourceSeasonId: number,
    rotationConflicts?: SeasonCopyRotationMode,
    useActualDates?: boolean,
    parcelRotation?: ParcelRotationConfirmation,
  ) => Promise<{ copied_count: number; target_planting_plan_count: number }>;
}

interface PreviewRequest {
  target: Season;
  source: Season;
  useActualDates: boolean;
  rotateParcels?: boolean;
}

type PreviewState = { request: PreviewRequest } & (
  | { data: SeasonCopyPreview }
  | { error: unknown }
);

function isStaleSourceError(code: string | null | undefined) {
  return code === 'source_season_not_found' || code === 'season_copy_source_not_earlier'
    || code === 'same_source_and_target_season';
}

function isEarlierSource(season: Season, target: Season) {
  return season.project === target.project && season.id !== target.id && season.end_date < target.start_date;
}

export function SeasonCopyDataDialog({ targetSeason, seasons, onClose, onConfirm }: SeasonCopyDataDialogProps) {
  const { t } = useTranslation(['navigation', 'common', 'hierarchy']);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [options, setOptions] = useState<{
    sourceId: number | null; useActualDates: boolean; rotateParcels?: boolean;
  }>({ sourceId: null, useActualDates: false });
  const [selectedCropMode, setRotationMode] = useState<SeasonCopyRotationMode | null>(null);
  const sourceInputId = useId();
  const dateBasisHelpId = useId();

  const availableSources = seasons.filter(season => isEarlierSource(season, targetSeason))
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
  const selectedSourceId = options.sourceId ?? availableSources[0]?.id;
  const source = seasons.find(season => season.id === selectedSourceId && isEarlierSource(season, targetSeason));
  const request = useMemo<PreviewRequest | null>(() => source ? ({
    target: targetSeason, source, useActualDates: options.useActualDates, rotateParcels: options.rotateParcels,
  }) : null, [source, targetSeason, options]);

  useEffect(() => {
    if (!request) {
      return undefined;
    }
    let cancelled = false;
    const response = seasonAPI.copyPreview(
      request.target.id, request.source.id, request.useActualDates, request.rotateParcels ?? true,
    );
    response
      .then((response) => {
        if (response.data.source_season_id !== request.source.id) {
          throw new Error('The copy preview returned a different source season.');
        }
        if (!cancelled) {
          setPreviewState({ request, data: response.data });
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setPreviewState({ request, error: requestError });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  const result = previewState?.request === request ? previewState : null;
  const preview = result && 'data' in result ? result.data : null;
  const continuingCount = preview?.continuing_count ?? 0;
  const unconfiguredCount = preview?.unconfigured_perennial_count ?? 0;
  const previewFailure = result && 'error' in result ? result : null;
  const previewErrorCode = extractApiErrorCode(previewFailure?.error);
  const sourceChanged = (options.sourceId !== null && !source) || isStaleSourceError(previewErrorCode);
  const previewLoading = Boolean(request && !result);
  const parcelRotation = preview?.parcel_rotation;
  const rotateParcels = Boolean(parcelRotation?.eligible && (options.rotateParcels ?? parcelRotation.enabled));
  const rotationPending = rotateParcels && !parcelRotation?.fingerprint;
  const rotationEnabled = Boolean(parcelRotation?.enabled);
  const rotationMode = rotationEnabled && selectedCropMode !== 'skip'
    ? 'keep' : (selectedCropMode ?? 'without_bed');
  const excludedMoves = rotationMode === 'skip'
    ? preview?.items.filter(item => item.status === 'conflict').map(item => item.source_plan_id)
    : undefined;
  const hasRotationFindings = Boolean(preview && (preview.conflict_count > 0 || preview.hint_count > 0));
  const copyCount = preview && (rotationMode === 'skip' ? preview.conflict_free_count : preview.total);

  const refreshPreview = (sourceId: number, useActualDates: boolean, rotate = options.rotateParcels) => {
    setError(null);
    setOptions({ sourceId, useActualDates, rotateParcels: rotate });
  };

  const handleConfirm = async () => {
    if (!request || !preview || submittingRef.current || rotationPending) {
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const args = [
        request.target.id, request.source.id,
        preview.conflict_count > 0 ? rotationMode : undefined,
        request.useActualDates,
      ] as const;
      const result = rotateParcels && parcelRotation?.fingerprint
        ? await onConfirm(...args, { rotate_parcels: true, parcel_rotation_fingerprint: parcelRotation.fingerprint })
        : await onConfirm(...args);
      showGlobalSnackbar({
        message: t(result.copied_count > 0 ? 'seasonSwitcher.copyDialog.success' : 'seasonSwitcher.copyDialog.noCopies', {
          target: request.target.label,
        }),
        severity: result.copied_count > 0 ? 'success' : 'info',
      });
      onClose();
    } catch (confirmError) {
      const code = extractApiErrorCode(confirmError);
      if (isStaleSourceError(code)) {
        setPreviewState({ request, error: confirmError });
      } else if (code === 'parcel_rotation_preview_changed') {
        refreshPreview(request.source.id, request.useActualDates, rotateParcels);
        setError(t('hierarchy:parcelRotation.previewChanged'));
      } else {
        setError(extractApiErrorMessage(confirmError, t, t('navigation:seasonSwitcher.copyDialog.error')));
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onClose={submitting ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('navigation:seasonSwitcher.copyDialog.title')}</DialogTitle>
      <DialogContent>
        <Stack component="dl" spacing={0.5} sx={{ mt: 0, mb: 2, overflowWrap: 'anywhere' }}>
          <Typography component="dt" variant="subtitle2">{t('navigation:seasonSwitcher.copyDialog.targetLabel')}</Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0 }}>{targetSeason.label}</Typography>
        </Stack>

        {availableSources.length > 0 && (
          <TextField
            id={sourceInputId}
            select
            fullWidth
            size="small"
            label={t('navigation:seasonSwitcher.copyDialog.selectSource')}
            value={source?.id ?? ''}
            disabled={submitting}
            helperText={preview?.is_preceding_source === false && !parcelRotation?.mappings.length
              ? t('navigation:seasonSwitcher.copyDialog.parcelRotationUnavailable') : undefined}
            onChange={(event) => {
              setRotationMode(null);
              refreshPreview(Number(event.target.value), options.useActualDates);
            }}
            sx={{
              mb: 2,
              '& .MuiSelect-select.MuiSelect-outlined': {
                whiteSpace: 'normal', overflowWrap: 'anywhere', textOverflow: 'clip',
              },
            }}
          >
            {availableSources.map(season => (
              <MenuItem key={season.id} value={season.id} sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                {season.label}
              </MenuItem>
            ))}
          </TextField>
        )}

        {source && (
          <Stack sx={{ mb: 2 }}>
            <FormControlLabel
              sx={{ m: 0, alignItems: 'flex-start', '& .MuiFormControlLabel-label': { pt: 1 } }}
              control={<Checkbox checked={options.useActualDates} disabled={submitting || sourceChanged}
                onChange={(_, checked) => refreshPreview(source.id, checked)}
                slotProps={{ input: { 'aria-describedby': dateBasisHelpId } }} />}
              label={t('navigation:seasonSwitcher.copyDialog.useActualDates')}
            />
            <Typography id={dateBasisHelpId} variant="body2" color="text.secondary" sx={{ pl: 5 }}>
              {t('navigation:seasonSwitcher.copyDialog.selectedSourceDatesHelp')}
            </Typography>
          </Stack>
        )}

        {previewLoading && <Typography role="status" variant="body2">{t('common:messages.loading')}</Typography>}
        {source && <ParcelRotationCopyPreview report={parcelRotation} checked={rotateParcels}
          excludedMoves={excludedMoves}
          disabled={submitting} onChange={checked => {
            setRotationMode(null);
            refreshPreview(source.id, options.useActualDates, checked);
          }} />}
        {availableSources.length === 0 && !sourceChanged && (
          <Alert severity="info">{t('navigation:seasonSwitcher.copyDialog.noEarlierSource')}</Alert>
        )}
        {sourceChanged && <Alert severity="error">{t('navigation:seasonSwitcher.copyDialog.earlierSourceUnavailable')}</Alert>}
        {source && previewFailure && !sourceChanged && (
          <Alert severity="error" action={
            <Button color="inherit" onClick={() => refreshPreview(source.id, options.useActualDates)}>
              {t('common:runtime.retryAction')}
            </Button>
          }>
            {extractApiErrorMessage(previewFailure.error, t, t('navigation:seasonSwitcher.copyDialog.previewError'))}
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

        {copyCount !== null ? (
          <Typography variant="body2" color="text.secondary">
            {t('navigation:seasonSwitcher.copyDialog.summary', {
              count: copyCount,
              total: copyCount + targetSeason.planting_plan_count,
            })}
          </Typography>
        ) : null}

        {preview && preview.skipped_count > 0 && (
          <Typography variant="body2" color="warning.dark" sx={{ mt: 0.5 }}>
            {t('navigation:seasonSwitcher.copyDialog.skippedPlans', { count: preview.skipped_count })}
          </Typography>
        )}
        {continuingCount > 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {t('navigation:seasonSwitcher.copyDialog.continuingPlans', { count: continuingCount })}
          </Typography>
        )}
        {unconfiguredCount > 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('navigation:seasonSwitcher.copyDialog.unconfiguredPerennials', { count: unconfiguredCount })}
          </Typography>
        )}

        {preview && hasRotationFindings ? (
          <SeasonCopyRotationSummary preview={preview} mode={rotationMode}
            parcelRotation={rotationEnabled} onModeChange={setRotationMode} />
        ) : null}
        {error ? <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert> : null}
      </DialogContent>
      <DialogActions>
        <DisabledActionTooltip title={submitting ? t('common:disabledReasons.busy') : ''}>
          <Button onClick={onClose} disabled={submitting}>{t('common:actions.cancel')}</Button>
        </DisabledActionTooltip>
        <DisabledActionTooltip
          title={submitting
            ? t('common:disabledReasons.busy')
            : previewLoading ? t('common:messages.loading') : ''}
        >
          <Button onClick={() => void handleConfirm()} variant="contained"
            disabled={submitting || !preview || rotationPending}>
            {t('navigation:seasonSwitcher.copyDialog.confirm')}
          </Button>
        </DisabledActionTooltip>
      </DialogActions>
    </Dialog>
  );
}
