import { useEffect, useId, useRef, useState } from 'react';
import {
  Alert, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import { publicCropAPI } from '../../api/api';
import { extractApiErrorCode } from '../../api/errors';
import type {
  PublicCrop, PublicCropBatchImportRequest, PublicCropBatchImportResult,
  PublicCropSelectionImportResult,
} from '../../api/types';
import { ExistingCropLinkDialog } from '../../crops/ExistingCropLinkDialog';
import { useTranslation } from '../../i18n';
import {
  BatchImportLimitError, buildBatchImportPlan, loadBatchImportPreview,
  type BatchImportChoice, type BatchImportPreview, type BatchImportRow,
} from '../batchImport';
import { getPublicCropTitle } from '../publicCropDisplay';

type EntryResult = PublicCropSelectionImportResult['entries'][number]['operation'] | 'skipped' | 'excluded';
type ImportError = 'project' | 'preview' | 'limit' | 'request' | 'receipt';

export function PublicCropBatchImportDialog({ open, projectId, initialParents, onClose, onComplete, onRequestStarted }: {
  open: boolean;
  projectId: number;
  initialParents: PublicCrop[];
  onClose: (state: 'cancelled' | 'finished' | 'pending') => void;
  onComplete: (result: PublicCropBatchImportResult) => Promise<void>;
  onRequestStarted: () => void;
}) {
  const { t, i18n } = useTranslation(['crops', 'common']);
  const titleId = useId();
  const [parents, setParents] = useState(initialParents);
  const [includeVarieties, setIncludeVarieties] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState<BatchImportPreview | null>(null);
  const [checkingCount, setCheckingCount] = useState(0);
  const [choices, setChoices] = useState<Map<number, BatchImportChoice>>(() => new Map());
  const [skipDefaults, setSkipDefaults] = useState(false);
  const [comparison, setComparison] = useState<BatchImportRow | null>(null);
  const [returnFocusId, setReturnFocusId] = useState<number | null>(null);
  const [error, setError] = useState<ImportError | null>(null);
  const [applying, setApplying] = useState(false);
  const [requestStarted, setRequestStarted] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);
  const [results, setResults] = useState<Map<number, EntryResult>>(() => new Map());
  const [failedParents, setFailedParents] = useState<PublicCrop[]>([]);
  const applyInFlight = useRef(false);
  const pendingRequest = useRef<PublicCropBatchImportRequest | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const checkProject = () => {
      if (cancelled || Number(localStorage.getItem('activeProjectId')) !== projectId) {
        throw new Error('Batch preview no longer belongs to the active project');
      }
    };
    void loadBatchImportPreview(parents, includeVarieties, checkProject, setCheckingCount)
      .then(data => { if (!cancelled) setPreview(data); })
      .catch(failure => {
        if (cancelled) return;
        setError(Number(localStorage.getItem('activeProjectId')) !== projectId ? 'project'
          : failure instanceof BatchImportLimitError ? 'limit' : 'preview');
      });
    return () => { cancelled = true; };
  }, [attempt, includeVarieties, parents, projectId]);

  const title = (crop: PublicCrop) => getPublicCropTitle(crop, i18n.resolvedLanguage ?? i18n.language, t('library.translation.missingName'));
  const plan = preview && buildBatchImportPlan(preview, choices, skipDefaults);
  const totalVarieties = preview?.groups.reduce((total, group) => total + group.length - 1, 0) ?? 0;
  const appliedCount = [...results.values()].filter(value => value === 'created' || value === 'copied').length;
  const linkedCount = [...results.values()].filter(value => value === 'linked').length;
  const skippedCount = [...results.values()].filter(value => value === 'unchanged' || value === 'skipped').length;
  const excludedCount = [...results.values()].filter(value => value === 'excluded').length;

  const resetPreview = () => {
    setPreview(null);
    setError(null);
    setCheckingCount(0);
  };

  const apply = async () => {
    if (applyInFlight.current || !plan || (!plan.ready && !pendingRequest.current)) return;
    if (Number(localStorage.getItem('activeProjectId')) !== projectId) {
      setError('project');
      return;
    }
    const { groups, skipped, rows } = plan;
    applyInFlight.current = true;
    setApplying(true);
    setError(null);
    try {
      let result: PublicCropBatchImportResult = { groups: [] };
      if (groups.length) {
        pendingRequest.current ??= { expected_project_id: projectId, request_id: crypto.randomUUID(), groups };
        setRequestStarted(true);
        onRequestStarted();
        result = (await publicCropAPI.importBatch(pendingRequest.current)).data;
      }
      if (!mounted.current) return;
      pendingRequest.current = null;
      setRequestStarted(false);
      setResults(current => {
        const updated = new Map(current);
        skipped.forEach(id => updated.set(id, 'skipped'));
        for (const row of rows.flat()) {
          if (row.status === 'needsReview') updated.set(row.crop.id, 'excluded');
        }
        for (const group of result.groups) {
          if ('entries' in group) for (const entry of group.entries) updated.set(entry.public_crop_id, entry.operation);
        }
        return updated;
      });
      const failed = new Set(result.groups.flatMap(group => 'error_code' in group ? [group.parent_id] : []));
      setFailedParents(parents.filter(parent => failed.has(parent.id)));
      setResultOpen(true);
      if (Number(localStorage.getItem('activeProjectId')) === projectId && result.groups.length) {
        // The server has confirmed the result. Refresh failures cannot repeat the import.
        void onComplete(result).catch(failure => console.error('Error refreshing the crop library:', failure));
      }
    } catch (failure) {
      if (!mounted.current) return;
      const code = extractApiErrorCode(failure);
      setError(code === 'public_crop_import_project_changed' ? 'project'
        : code === 'crop_import_operation_unavailable' ? 'receipt' : 'request');
    } finally {
      applyInFlight.current = false;
      if (mounted.current) setApplying(false);
    }
  };

  const retryFailed = () => {
    resetPreview();
    setChoices(current => new Map([...current].map(([id, value]) => [id, value === null ? null : 'reviewAgain'])));
    setParents(failedParents);
    setResultOpen(false);
  };

  const rememberChoice = (id: number, choice: BatchImportChoice) => {
    setChoices(current => new Map(current).set(id, choice));
  };

  if (comparison) return <ExistingCropLinkDialog key={comparison.crop.id} publicCrop={comparison.crop}
    candidates={comparison.candidates} allowSharing={false}
    batchReview={{
      decision: comparison.decision,
      onSkip: () => { rememberChoice(comparison.crop.id, null); setComparison(null); },
    }}
    onClose={() => setComparison(null)} onLinked={() => undefined}
    onDecision={decision => { rememberChoice(comparison.crop.id, decision); setComparison(null); }} />;

  const close = () => onClose(requestStarted && error === 'request' ? 'pending'
    : resultOpen || results.size > 0 || requestStarted ? 'finished' : 'cancelled');
  return <Dialog open={open} fullWidth maxWidth="sm" onClose={applying ? undefined : close} aria-labelledby={titleId}>
    <DialogTitle id={titleId}>{t(resultOpen ? 'library.batchImport.results' : 'library.batchImport.confirmTitle', { count: parents.length })}</DialogTitle>
    <DialogContent dividers>
      <Stack spacing={1}>
        {resultOpen ? <>
          <Box role="status">
            <Stack component="ul" spacing={0.5} sx={{ m: 0, pl: 2.5 }}>
              <Typography component="li">{t('library.batchImport.importedCount', { count: appliedCount })}</Typography>
              <Typography component="li">{t('library.batchImport.linkedCount', { count: linkedCount })}</Typography>
              <Typography component="li">{t('library.batchImport.skippedCount', { count: skippedCount })}</Typography>
              {excludedCount > 0 && <Typography component="li">{t('library.batchImport.excludedCount', { count: excludedCount })}</Typography>}
              <Typography component="li">{t('library.batchImport.failedCount', { count: failedParents.length })}</Typography>
            </Stack>
          </Box>
          {failedParents.length > 0 && <Alert severity="warning" sx={{ overflowWrap: 'anywhere' }}>
            {t('library.batchImport.failedGroups', { names: failedParents.map(title).join(', ') })}
          </Alert>}
        </> : <>
          <Stack direction="row" useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', columnGap: 1 }}>
            <FormControlLabel label={t('library.batchImport.includeVarieties')} control={<Checkbox checked={includeVarieties}
              disabled={applying || requestStarted} onChange={(_, checked) => {
                resetPreview(); setIncludeVarieties(checked);
              }} />} />
            {includeVarieties && preview && !requestStarted && (
              <Typography variant="body2" color="text.secondary">{t('library.batchImport.varieties', { count: totalVarieties })}</Typography>
            )}
          </Stack>
          {!preview && !error && <Stack role="status" direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <CircularProgress size={20} /><Typography>{t('library.batchImport.checking', { count: checkingCount })}</Typography>
          </Stack>}
          {applying && <Stack role="status" direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <CircularProgress size={20} /><Typography>{t('library.importing')}</Typography>
          </Stack>}
          {preview && plan && !applying && !requestStarted && <>
            {preview.unavailable.length > 0 && <Alert severity="warning">
              {t('library.batchImport.unavailable', { names: preview.unavailable.map(title).join(', ') })}
            </Alert>}
            <Stack direction="row" useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
              <TextField select size="small" label={t('library.batchImport.batchDefault')}
                value={skipDefaults ? 'skip' : 'link'} onChange={event => setSkipDefaults(event.target.value === 'skip')}
                sx={{ minWidth: 180, maxWidth: '100%' }}>
                <MenuItem value="link">{t('library.batchImport.link')}</MenuItem>
                <MenuItem value="skip">{t('library.batchImport.skip')}</MenuItem>
              </TextField>
              <Typography role="status" variant="body2" color="text.secondary">
                {t('library.batchImport.readyCount', { count: plan.ready })}{' · '}
                {t('library.batchImport.needsReviewCount', { count: plan.needsReview })}{' · '}
                {t('library.batchImport.skippedCount', { count: plan.skipped.length })}
              </Typography>
            </Stack>
            {plan.needsReview > 0 && <Typography variant="body2" color="text.secondary">
              {t('library.batchImport.unresolvedExcluded')}
            </Typography>}
            <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }} role="list">
              {plan.rows.flat().map(row => {
                const name = title(row.crop);
                const linked = row.status === 'alreadyLinked' || row.status === 'linkedUpdate';
                const status = row.parentBlocked
                  ? t(row.status === 'needsReview' ? 'library.batchImport.parentNeedsReview' : 'library.batchImport.parentSkipped')
                  : row.status === 'ready'
                    ? t(row.decision?.link_to_library ? 'library.batchImport.link' : 'library.importDecision.copy')
                    : t(`library.batchImport.rowStatus.${row.status}`);
                return <Stack key={row.crop.id} component="li" direction="row" useFlexGap sx={{
                  alignItems: 'center', flexWrap: 'wrap', gap: 0.5, py: 0.5, pl: row.crop.variety ? 2 : 0,
                  borderTop: '1px solid', borderColor: 'divider',
                }}>
                  <Box sx={{ flex: '1 1 9rem', minWidth: 0, overflowWrap: 'anywhere' }}>
                    <Typography variant="body2">{name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {status}
                      {Boolean(row.differences) && <> {' · '}{t('library.batchImport.differenceCount', { count: row.differences })}</>}
                    </Typography>
                  </Box>
                  {!linked && !row.parentBlocked && <Button size="small"
                    aria-label={t('library.batchImport.reviewNamed', { name })}
                    autoFocus={returnFocusId === row.crop.id}
                    onClick={() => { setReturnFocusId(row.crop.id); setComparison(row); }}>
                    {t('library.batchImport.review')}
                  </Button>}
                </Stack>;
              })}
            </Box>
          </>}
          {error && <Alert severity="error">{t(error === 'project' ? 'library.importProjectChanged' : `library.batchImport.errors.${error}`)}</Alert>}
        </>}
      </Stack>
    </DialogContent>
    <DialogActions sx={{ flexWrap: 'wrap' }}>
      <Button disabled={applying} onClick={close}>{t(resultOpen || requestStarted ? 'common:actions.close' : 'common:actions.cancel')}</Button>
      {resultOpen ? (failedParents.length > 0 && <Button variant="contained" onClick={retryFailed}>{t('library.batchImport.retryFailed')}</Button>)
        : error === 'preview' ? <Button variant="contained" onClick={() => { resetPreview(); setAttempt(value => value + 1); }}>
          {t('common:runtime.retryAction')}
        </Button> : error === 'request' ? <Button variant="contained" onClick={() => void apply()}>{t('common:runtime.retryAction')}</Button>
          : <Button variant="contained" disabled={applying || !plan?.ready || Boolean(error)} onClick={() => void apply()}>
            {t('library.batchImport.import')}
          </Button>}
    </DialogActions>
  </Dialog>;
}
