import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import { ParcelRotationCopyPreview, ParcelRotationCopyToggle } from './ParcelRotationCopyPreview';
import { SeasonCopyCheckbox, SeasonCopyPreviewSection } from './SeasonCopyPreviewSection';
import { SeasonCopyTotals } from './SeasonCopyTotals';

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
  /** Only sent with a requested rotation, where it decides which copies need rotated area. */
  rotationConflicts?: SeasonCopyRotationMode;
}

/** Same copies apart from the conflict treatment, so the detected conflicts still apply. */
function sameCopies(a: PreviewRequest, b: PreviewRequest | null) {
  return Boolean(b && a.target === b.target && a.source === b.source
    && a.useActualDates === b.useActualDates && a.rotateParcels === b.rotateParcels);
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
  const [rotationMode, setRotationMode] = useState<SeasonCopyRotationMode>('without_bed');
  const sourceInputId = useId();

  const availableSources = seasons.filter(season => isEarlierSource(season, targetSeason))
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
  const selectedSourceId = options.sourceId ?? availableSources[0]?.id;
  const source = seasons.find(season => season.id === selectedSourceId && isEarlierSource(season, targetSeason));
  const request = useMemo<PreviewRequest | null>(() => source ? ({
    target: targetSeason, source, useActualDates: options.useActualDates, rotateParcels: options.rotateParcels,
    rotationConflicts: options.rotateParcels === false ? undefined : rotationMode,
  }) : null, [source, targetSeason, options, rotationMode]);

  useEffect(() => {
    if (!request) {
      return undefined;
    }
    let cancelled = false;
    const response = seasonAPI.copyPreview(
      request.target.id, request.source.id, request.useActualDates, request.rotateParcels ?? true,
      request.rotationConflicts,
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
  // While a changed treatment reloads, its conflicts and choice stay in place.
  const findings = preview ?? (request && previewState && 'data' in previewState
    && sameCopies(request, previewState.request) ? previewState.data : null);
  const continuingCount = preview?.continuing_count ?? 0;
  const unconfiguredCount = preview?.unconfigured_perennial_count ?? 0;
  const previewFailure = result && 'error' in result ? result : null;
  const previewErrorCode = extractApiErrorCode(previewFailure?.error);
  const sourceChanged = (options.sourceId !== null && !source) || isStaleSourceError(previewErrorCode);
  const previewLoading = Boolean(request && !result);
  const parcelRotation = (preview ?? findings)?.parcel_rotation;
  const rotateParcels = Boolean(parcelRotation?.eligible && (options.rotateParcels ?? parcelRotation.enabled));
  const rotationPending = rotateParcels && !preview?.parcel_rotation?.fingerprint;
  const hasRotationFindings = Boolean(findings && (findings.conflict_count > 0 || findings.hint_count > 0));
  const conflicts = preview?.conflict_count ?? 0;
  const copyCount = preview && (rotationMode === 'skip' ? preview.conflict_free_count : preview.total);

  const refreshPreview = (sourceId: number, useActualDates: boolean, rotate = options.rotateParcels) => {
    setError(null);
    setOptions({ sourceId, useActualDates, rotateParcels: rotate });
  };

  const handleConfirm = async () => {
    if (!request || !preview || !copyCount || submittingRef.current || rotationPending) {
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const args = [
        request.target.id, request.source.id,
        conflicts > 0 ? rotationMode : undefined,
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
            onChange={(event) => refreshPreview(Number(event.target.value), options.useActualDates)}
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
          <Stack spacing={1} sx={{ mb: 2 }}>
            <SeasonCopyCheckbox label={t('navigation:seasonSwitcher.copyDialog.useActualDates')}
              help={t('navigation:seasonSwitcher.copyDialog.selectedSourceDatesHelp')}
              checked={options.useActualDates} disabled={submitting || sourceChanged}
              onChange={checked => refreshPreview(source.id, checked)} />
            <ParcelRotationCopyToggle report={parcelRotation} checked={rotateParcels}
              disabled={submitting} onChange={checked => refreshPreview(source.id, options.useActualDates, checked)} />
          </Stack>
        )}

        {availableSources.length === 0 && !sourceChanged && (
          <Alert severity="info">{t('navigation:seasonSwitcher.copyDialog.noEarlierSource')}</Alert>
        )}
        {sourceChanged && <Alert severity="error">{t('navigation:seasonSwitcher.copyDialog.earlierSourceUnavailable')}</Alert>}

        {source && !sourceChanged && (
          <SeasonCopyPreviewSection>
            {previewFailure && (
              <Alert severity="error" action={
                <Button color="inherit" onClick={() => refreshPreview(source.id, options.useActualDates)}>
                  {t('common:runtime.retryAction')}
                </Button>
              }>
                {extractApiErrorMessage(previewFailure.error, t, t('navigation:seasonSwitcher.copyDialog.previewError'))}
              </Alert>
            )}
            {preview && <ParcelRotationCopyPreview report={preview.parcel_rotation} checked={rotateParcels} />}
            {findings && hasRotationFindings ? (
              <SeasonCopyRotationSummary preview={findings} mode={rotationMode}
                parcelRotation={rotateParcels} disabled={submitting} onModeChange={setRotationMode} />
            ) : null}
            {previewLoading && <Typography role="status" variant="body2">{t('common:messages.loading')}</Typography>}
            {preview && copyCount !== null ? (
              <SeasonCopyTotals
                existing={targetSeason.planting_plan_count}
                added={copyCount}
                withoutBed={rotationMode === 'without_bed' ? conflicts : 0}
                skippedConflicts={rotationMode === 'skip' ? conflicts : 0}
              />
            ) : null}
            {preview && preview.skipped_count > 0 && (
              <Typography variant="body2" color="warning.dark">
                {t('navigation:seasonSwitcher.copyDialog.skippedPlans', { count: preview.skipped_count })}
              </Typography>
            )}
            {continuingCount > 0 && (
              <Typography variant="body2" color="text.secondary">
                {t('navigation:seasonSwitcher.copyDialog.continuingPlans', { count: continuingCount })}
              </Typography>
            )}
            {unconfiguredCount > 0 && (
              <Typography variant="body2" color="text.secondary">
                {t('navigation:seasonSwitcher.copyDialog.unconfiguredPerennials', { count: unconfiguredCount })}
              </Typography>
            )}
          </SeasonCopyPreviewSection>
        )}
        {error ? <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert> : null}
      </DialogContent>
      <DialogActions>
        <DisabledActionTooltip title={submitting ? t('common:disabledReasons.busy') : ''}>
          <Button onClick={onClose} disabled={submitting}>{t('common:actions.cancel')}</Button>
        </DisabledActionTooltip>
        <DisabledActionTooltip
          title={submitting
            ? t('common:disabledReasons.busy')
            : previewLoading ? t('common:messages.loading')
              : copyCount === 0 ? t('navigation:seasonSwitcher.copyDialog.nothingToCopy') : ''}
        >
          <Button onClick={() => void handleConfirm()} variant="contained"
            disabled={submitting || !preview || !copyCount || rotationPending}>
            {copyCount ? t('navigation:seasonSwitcher.copyDialog.confirmCount', { count: copyCount })
              : t('navigation:seasonSwitcher.copyDialog.confirm')}
          </Button>
        </DisabledActionTooltip>
      </DialogActions>
    </Dialog>
  );
}
