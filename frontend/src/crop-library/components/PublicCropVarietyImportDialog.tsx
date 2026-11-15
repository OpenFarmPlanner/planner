import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, Typography } from '@mui/material';
import { publicCropAPI } from '../../api/api';
import type { PublicCrop, PublicCropImportDecision, PublicCropSelectionImportResult } from '../../api/types';
import { extractApiErrorCode } from '../../api/errors';
import { useTranslation } from '../../i18n';
import { ExistingCropLinkDialog, type CropLinkCandidate } from '../../crops/ExistingCropLinkDialog';
import { getPublicCropTitle } from '../publicCropDisplay';
import { loadVarietyImportPreviews } from '../importVarietyPreviews';

const MAX_SELECTED_VARIETIES = 500;

type Comparison = { entry: PublicCrop; candidates: CropLinkCandidate[]; remaining: PublicCrop[]; decisions: PublicCropImportDecision[]; consent: boolean; previews: Map<number, CropLinkCandidate[]> };

export function PublicCropVarietyImportDialog({ parent, onClose, onComplete, onWithoutVarieties, termsAlreadyAccepted = false }: {
  parent: PublicCrop;
  onClose: () => void;
  onComplete: (result: PublicCropSelectionImportResult) => Promise<void>;
  onWithoutVarieties: () => void;
  termsAlreadyAccepted?: boolean;
}) {
  const { t, i18n } = useTranslation(['crops', 'common']);
  const [projectId] = useState(() => Number(localStorage.getItem('activeProjectId')));
  const [entries, setEntries] = useState<PublicCrop[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [progress, setProgress] = useState(0);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const emptyCallback = useRef(onWithoutVarieties);
  useEffect(() => { emptyCallback.current = onWithoutVarieties; }, [onWithoutVarieties]);
  useEffect(() => {
    let cancelled = false;
    if (!parent.crop_species) return;
    publicCropAPI.listAll({ crop_species: parent.crop_species }).then(({ results }) => {
      if (cancelled) return;
      const varieties = results.filter(entry => Boolean(entry.variety?.trim()));
      if (!varieties.length) {
        emptyCallback.current();
        return;
      }
      // Use the fresh parent snapshot as well as every variety, independent of browser filters.
      setEntries([results.find(entry => entry.id === parent.id) ?? parent, ...varieties]);
      setSelected(new Set(varieties.filter(entry => !entry.project_import_status).map(entry => entry.id)));
    }).catch(() => { if (!cancelled) setError(t('library.loadError')); });
    return () => { cancelled = true; };
  }, [parent, t]);
  const eligible = entries?.slice(1).filter(entry => !entry.project_import_status) ?? [];
  const parentLinked = Boolean(entries?.[0].project_import_status);
  const describeError = (failure: unknown) => {
    const code = extractApiErrorCode(failure);
    return t(code === 'public_crop_import_project_changed' ? 'library.importProjectChanged'
      : code === 'crop_name_conflict' ? 'form.cropNameConflict'
        : 'library.varietyImport.failed');
  };
  const checkProject = () => {
    if (!mounted.current) throw new Error('Import selection closed');
    if (Number(localStorage.getItem('activeProjectId')) !== projectId || !Number.isInteger(projectId) || projectId <= 0) {
      throw new Error('Active project changed');
    }
  };
  const advance = async (remaining: PublicCrop[], decisions: PublicCropImportDecision[], consent: boolean,
    previews: Map<number, CropLinkCandidate[]>): Promise<void> => {
    checkProject();
    for (let index = 0; index < remaining.length; index += 1) {
      const entry = remaining[index];
      setProgress(decisions.length + 1);
      const candidates = previews.get(entry.id) ?? [];
      if (candidates.length) {
        setComparison({ entry, candidates, remaining: remaining.slice(index + 1), decisions, consent, previews });
        return;
      }
      decisions = [...decisions, { public_crop_id: entry.id, base_version: entry.version, link_to_library: true }];
    }
    checkProject();
    const result = await publicCropAPI.importSelection(parent.id, {
      expected_project_id: projectId, decisions, accepted_public_library_terms: consent,
    });
    // The commit succeeded. A later refresh failure must not invite another import.
    setComparison(null);
    try { await onComplete(result.data); }
    catch (failure) { console.error('Error refreshing completed variety import:', failure); }
    finally { if (mounted.current) onClose(); }
  };
  const run = async (remaining: PublicCrop[], decisions: PublicCropImportDecision[] = [], consent = false,
    preparedPreviews?: Map<number, CropLinkCandidate[]>) => {
    if (inFlight.current || selected.size > MAX_SELECTED_VARIETIES) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setProgress(1);
    try {
      const previews = preparedPreviews ?? await loadVarietyImportPreviews(remaining, checkProject, setProgress);
      await advance(remaining, decisions, consent, previews);
    }
    catch (failure) {
      if (!mounted.current) return;
      setComparison(null);
      setError(Number(localStorage.getItem('activeProjectId')) !== projectId
        ? t('library.importProjectChanged') : describeError(failure));
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  if (comparison) return <ExistingCropLinkDialog key={comparison.entry.id}
    publicCrop={comparison.entry} candidates={comparison.candidates}
    termsAlreadyAccepted={termsAlreadyAccepted || comparison.consent} onClose={onClose} onLinked={() => undefined}
    decisionProgress={t('library.varietyImport.reviewProgress', { current: comparison.decisions.length + 1, total: 1 + selected.size })}
    onDecision={(decision, consent) => { setComparison(null); void run(comparison.remaining, [...comparison.decisions, decision], comparison.consent || consent, comparison.previews); }} />;
  if (!entries && !error) return null;
  return <Dialog open fullWidth maxWidth="sm" onClose={busy ? undefined : onClose} aria-labelledby="variety-import-title">
    <DialogTitle id="variety-import-title">{t('library.varietyImport.title')}</DialogTitle>
    <DialogContent dividers>
      <Stack spacing={2}>
        <Typography variant="subtitle2">{getPublicCropTitle(parent, i18n.resolvedLanguage ?? i18n.language, t('library.translation.missingName'))}</Typography>
        <Typography>{t(parentLinked ? 'library.varietyImport.parentLinked' : 'library.varietyImport.parentIncluded')}</Typography>
        <Typography variant="body2" color="text.secondary">{t('library.varietyImport.atomicHelp')}</Typography>
        {eligible.length > MAX_SELECTED_VARIETIES ? <Alert severity={selected.size > MAX_SELECTED_VARIETIES ? 'warning' : 'info'}>
          {t('library.varietyImport.selectionLimit', { limit: MAX_SELECTED_VARIETIES })}
        </Alert> : null}
        {entries ? <>
          <FormControlLabel label={t('library.varietyImport.selectAll', { count: eligible.length })}
            control={<Checkbox disabled={busy || !eligible.length} checked={eligible.length > 0 && selected.size === eligible.length}
              indeterminate={selected.size > 0 && selected.size < eligible.length}
              onChange={(_, checked) => setSelected(new Set(checked ? eligible.map(entry => entry.id) : []))} />} />
          <Stack spacing={0.5}>
            {entries.slice(1).map(entry => <FormControlLabel key={entry.id}
              label={<>{entry.variety}{entry.project_import_status ? ` · ${t('library.linkExisting.alreadyLinked')}` : ''}</>}
              control={<Checkbox disabled={busy || Boolean(entry.project_import_status)} checked={Boolean(entry.project_import_status) || selected.has(entry.id)}
                onChange={(_, checked) => setSelected(current => { const next = new Set(current); if (checked) next.add(entry.id); else next.delete(entry.id); return next; })} />} />)}
          </Stack>
        </> : null}
        {busy ? <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }} role="status"><CircularProgress size={20} /><Typography>{t('library.varietyImport.reviewProgress', { current: progress, total: 1 + selected.size })}</Typography></Stack> : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
      </Stack>
    </DialogContent>
    <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
      <Button disabled={busy} onClick={onClose}>{t('common:actions.cancel')}</Button>
      <Button variant="contained" disabled={busy || !entries || selected.size > MAX_SELECTED_VARIETIES || (parentLinked && !selected.size)}
        onClick={() => { if (entries) void run(entries.filter((entry, index) => index === 0 || selected.has(entry.id))); }}>
        {t(parentLinked ? 'library.varietyImport.importVarieties' : selected.size ? 'library.varietyImport.importWithVarieties' : 'library.varietyImport.importParent', { count: selected.size })}
      </Button>
    </DialogActions>
  </Dialog>;
}
