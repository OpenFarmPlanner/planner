import { useEffect, useId, useRef, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, Stack, Typography,
} from '@mui/material';
import { cropAPI } from '../api/api';
import type { CropBulkDeletePreview, CropBulkDeleteRecord, CropBulkDeleteResult, CropBulkDeleteSample } from '../api/types';
import { CropAffectedList } from './CropAffectedList';
import { useTranslation } from '../i18n';
import type { CropDeletionTarget } from './useProjectCropSelection';

type BulkDeleteError = {
  response?: {
    status?: number;
    data?: { code?: string; blocked_count?: number; skipped_count?: number; failed_count?: number };
  };
};

type PreviewError = 'unavailable' | 'changed' | 'limit' | 'throttled' | 'writeFailed';

function previewError(error: unknown): PreviewError {
  const response = (error as BulkDeleteError)?.response;
  if (response?.data?.code === 'crop_bulk_delete_limit') return 'limit';
  if (response?.data?.code === 'crop_bulk_delete_write_failed') return 'writeFailed';
  if (response?.status === 429) return 'throttled';
  if (response?.status === 409) return 'changed';
  return 'unavailable';
}

function CropSamples({ samples, total }: { samples: CropBulkDeleteSample[]; total: number }) {
  const { t } = useTranslation('crops');
  if (!samples.length) return null;
  return (
    <>
      <Box component="ul" sx={{ pl: 3, my: 0.5, overflowWrap: 'anywhere' }}>
        {samples.map(crop => <li key={crop.id}>{crop.name}</li>)}
      </Box>
      {total > samples.length ? (
        <Typography variant="caption" color="text.secondary">
          {t('restoreDialog.preview.sample', { shown: samples.length, total })}
        </Typography>
      ) : null}
    </>
  );
}

function CropBulkImpact({ impact }: { impact: CropBulkDeletePreview }) {
  const { t } = useTranslation('crops');
  const retainedData = [
    ['packages', impact.seed_package_count],
    ['offers', impact.supplier_offer_count],
  ] as const;
  return (
    <>
      {impact.missing_count > 0 ? <Alert severity="warning">{t('bulkDelete.missing')}</Alert> : null}
      {impact.blockers.map(blocker => (
        <Alert key={blocker.code} severity="warning">
          {blocker.code === 'planting_plans'
            ? t('bulkDelete.plantingPlans', { count: impact.planting_plan_count })
            : t(`bulkDelete.blockers.${blocker.code}`)}
          {blocker.code !== 'varieties_required' ? (
            <CropSamples samples={blocker.samples} total={blocker.count} />
          ) : null}
        </Alert>
      ))}
      {impact.affected_records.length ? (
        <CropAffectedList records={impact.affected_records} label={t('bulkDelete.affectedList')} />
      ) : (
        <Typography variant="body2">{t('bulkDelete.empty')}</Typography>
      )}
      {retainedData.some(([, count]) => count > 0) ? (
        <Box>
          <Typography variant="body2">{t('bulkDelete.retainedData')}</Typography>
          <Box component="ul" sx={{ my: 0, pl: 2.5, typography: 'body2' }}>
            {retainedData.filter(([, count]) => count > 0).map(([key, count]) => (
              <li key={key}>{t(`bulkDelete.retained.${key}`, { count })}</li>
            ))}
          </Box>
        </Box>
      ) : null}
    </>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return <><dt>{label}</dt><dd>{value}</dd></>;
}

export function CropBulkDeletionDialog({ target, canRestoreFromHistory, onClose, onComplete }: {
  target: CropDeletionTarget;
  canRestoreFromHistory: boolean;
  onClose: () => void;
  onComplete: (result: CropBulkDeleteResult) => void;
}) {
  const { t } = useTranslation('crops');
  const titleId = useId();
  const [requestId] = useState(() => crypto.randomUUID());
  const [request, setRequest] = useState<{ deleteVarieties: boolean; required: CropBulkDeleteRecord[] }>({
    deleteVarieties: false, required: [],
  });
  const [preview, setPreview] = useState<CropBulkDeletePreview | null>(null);
  const [error, setError] = useState<PreviewError | null>(null);
  const [failureCounts, setFailureCounts] = useState<Pick<CropBulkDeleteResult,
    'blocked_count' | 'skipped_count' | 'failed_count'> | null>(null);
  const [unknownResult, setUnknownResult] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    cropAPI.bulkDeletePreview({ ...target, delete_varieties: request.deleteVarieties }, controller.signal)
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        if (!Array.isArray(data.affected_records) || !Array.isArray(data.required_varieties)
          || data.affected_records.length !== data.affected_count) {
          setError('unavailable');
          return;
        }
        if (request.deleteVarieties) {
          const selectedIds = new Set(target.crop_ids);
          const additional = data.affected_records.filter(record => !selectedIds.has(record.id));
          const consentedIds = new Set(request.required.map(record => record.id));
          if (additional.length !== consentedIds.size || additional.some(record => !consentedIds.has(record.id))) {
            setError('changed');
            return;
          }
        }
        setPreview(data);
      })
      .catch(error => { if (!controller.signal.aborted) setError(previewError(error)); });
    return () => controller.abort();
  }, [target, request]);

  const refresh = (deleteVarieties = false, required: CropBulkDeleteRecord[] = []) => {
    setPreview(null);
    setError(null);
    setFailureCounts(null);
    setUnknownResult(false);
    setRequest({ deleteVarieties, required });
  };
  const confirm = async () => {
    if (submitting.current || !preview?.token) return;
    submitting.current = true;
    setBusy(true);
    setUnknownResult(false);
    try {
      const { data } = await cropAPI.bulkDelete({
        ...target, delete_varieties: request.deleteVarieties, request_id: requestId,
        preview_token: preview.token, confirm_all: false,
      });
      onComplete(data);
    } catch (error) {
      const outcome = previewError(error);
      if (outcome === 'unavailable' || outcome === 'throttled') {
        // Retain this exact request ID and preview until its outcome can be read.
        setUnknownResult(true);
      } else {
        const details = (error as BulkDeleteError)?.response?.data;
        if (typeof details?.blocked_count === 'number'
          && typeof details.skipped_count === 'number' && typeof details.failed_count === 'number') {
          setFailureCounts({
            blocked_count: details.blocked_count,
            skipped_count: details.skipped_count,
            failed_count: details.failed_count,
          });
        }
        setPreview(null);
        setError(outcome);
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const cultures = preview?.general_count
    ? t('bulkDelete.cultures', { count: preview.general_count }) : '';
  const varieties = preview?.variety_count
    ? t('bulkDelete.varieties', { count: preview.variety_count }) : '';
  const scope = cultures && varieties ? t('bulkDelete.mixedScope', { cultures, varieties }) : cultures || varieties;
  const required = request.deleteVarieties ? request.required : preview?.required_varieties ?? request.required;
  const shouldRefresh = preview && !preview.token && (
    preview.missing_count > 0 || preview.blockers.some(blocker => blocker.code !== 'varieties_required')
  );

  return (
    <Dialog open fullWidth maxWidth="sm" aria-labelledby={titleId} onClose={busy ? undefined : onClose}>
      <DialogTitle id={titleId}>{scope ? t('bulkDelete.scopeQuestion', { scope }) : t('bulkDelete.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.25}>
          {error ? (
            <Box>
              <Alert severity="warning">{t(`bulkDelete.errors.${error}`)}</Alert>
              {failureCounts ? (
                <Box component="dl" sx={{ typography: 'body2', display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto', '& dd': { m: 0 } }}>
                  <Count label={t('bulkDelete.counts.blocked')} value={failureCounts.blocked_count} />
                  <Count label={t('bulkDelete.counts.skipped')} value={failureCounts.skipped_count} />
                  <Count label={t('bulkDelete.counts.failed')} value={failureCounts.failed_count} />
                </Box>
              ) : null}
              {error !== 'limit' ? (
                <Button onClick={() => error === 'changed' ? refresh() : refresh(request.deleteVarieties, required)}>
                  {t('restoreDialog.preview.refresh')}
                </Button>
              ) : null}
            </Box>
          ) : preview ? (
            <CropBulkImpact impact={preview} />
          ) : <Typography role="status" variant="body2">{t('restoreDialog.preview.loading')}</Typography>}
          {!error && required.length > 0 ? (
            <Box>
              <FormControlLabel
                label={t('bulkDelete.deleteVarieties')}
                control={<Checkbox checked={request.deleteVarieties} disabled={busy || unknownResult}
                  onChange={(_, checked) => refresh(checked, required)} />}
              />
              {!request.deleteVarieties ? (
                <CropAffectedList records={required} label={t('bulkDelete.requiredList')} />
              ) : null}
            </Box>
          ) : null}
          {shouldRefresh ? (
            <Button sx={{ alignSelf: 'flex-start' }} onClick={() => refresh(request.deleteVarieties, required)}>
              {t('restoreDialog.preview.refresh')}
            </Button>
          ) : null}
          {preview?.token && !unknownResult ? (
            <Typography variant="body2" color="text.secondary">
              {t(canRestoreFromHistory ? 'bulkDelete.recoveryHistory' : 'bulkDelete.recoveryUndo')}{' '}
              {t('bulkDelete.libraryNotice')}
            </Typography>
          ) : null}
          {unknownResult ? <Alert severity="warning">{t('bulkDelete.outcomeUnknown')}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', rowGap: 1 }}>
        <Button autoFocus variant="outlined" disabled={busy} onClick={onClose}>
          {t('restoreDialog.cancel')}
        </Button>
        <Button color="error" variant="contained"
          disabled={busy || !preview?.token} onClick={() => void confirm()}>
          {t(unknownResult ? 'bulkDelete.retry' : 'bulkDelete.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
