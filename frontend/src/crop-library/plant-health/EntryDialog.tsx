import { useId, useRef, useState, type FormEvent } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, useMediaQuery, useTheme } from '@mui/material';
import { ConfirmationDialog } from '../../components/feedback/ConfirmationDialog';
import { useTranslation } from '../../i18n';
import { SUPPORTED_LANGUAGES } from '../../i18n/languages';
import { plantHealthAPI } from './api';
import { createNameDrafts, sourcePayload, translationPayload } from './drafts';
import { NameFields } from './NameFields';
import { SourceFields } from './SourceFields';
import { useDialogSaveFeedback } from './useDialogSaveFeedback';
import type { PlantHealthEntry, PlantHealthEntryWrite, PlantHealthKind } from './types';

export function EntryDialog({ entry, mode, onClose, onSaved }: {
  entry?: PlantHealthEntry; mode: 'create' | 'edit' | 'approve'; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation(['crops', 'common']);
  const id = useId();
  const fullscreen = useMediaQuery(useTheme().breakpoints.down('md'));
  const [kind, setKind] = useState<PlantHealthKind>(entry?.kind ?? 'group');
  const [scientificName, setScientificName] = useState(entry?.scientific_name ?? '');
  const [eppoCode, setEppoCode] = useState(entry?.eppo_code ?? '');
  const [sources, setSources] = useState(entry?.sources.length ? entry.sources : [{ url: '' }]);
  const [names, setNames] = useState(() => createNameDrafts(entry?.translations ?? []));
  const [busy, setBusy] = useState(false);
  const { failed, showFailure, clearFailure, contentRef, errorRef } = useDialogSaveFeedback();
  const [discard, setDiscard] = useState(false);
  const lock = useRef(false);
  const [initial] = useState(() => JSON.stringify({ kind, scientificName, eppoCode, sources, names }));
  const dirty = JSON.stringify({ kind, scientificName, eppoCode, sources, names }) !== initial;
  const publishing = mode === 'approve' || entry?.status === 'published';
  const specific = kind === 'pest' || kind === 'pathogen';
  const close = () => { if (!lock.current) { if (dirty) setDiscard(true); else onClose(); } };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    const translations = translationPayload(names);
    const sourceRows = sourcePayload(sources);
    const clearedExistingName = entry?.translations.some(row => !names[row.language_code]?.preferred_name.trim());
    if (clearedExistingName || !translations?.length || sourceRows === null || publishing && (
      translations.length !== SUPPORTED_LANGUAGES.length || !sourceRows.length || specific && !scientificName.trim()
    )) { showFailure(); return; }
    const payload: PlantHealthEntryWrite = { name: names.en.preferred_name.trim() || translations[0].preferred_name,
      kind, scientific_name: scientificName.trim(), eppo_code: specific ? eppoCode.trim() : '', sources: sourceRows, translations };
    lock.current = true; setBusy(true); clearFailure();
    try {
      if (mode === 'approve' && entry) await plantHealthAPI.approve(entry.id, payload);
      else if (entry) await plantHealthAPI.update(entry.id, payload);
      else await plantHealthAPI.create(payload);
      await onSaved(); onClose();
    } catch { showFailure(); }
    finally { lock.current = false; setBusy(false); }
  };
  return <>
    <Dialog open fullWidth maxWidth="md" fullScreen={fullscreen} aria-labelledby={id}
      onClose={(_event, reason) => { if (reason !== 'backdropClick') close(); }}
      >
      <Box component="form" noValidate onSubmit={save} sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <DialogTitle id={id}>{t(`crops:plantHealthCatalogue.${mode === 'approve' ? 'review' : mode === 'create' ? 'add' : 'edit'}`)}</DialogTitle>
      <DialogContent dividers ref={contentRef}>
        <Stack spacing={2}>
          {failed ? <Alert severity="error" ref={errorRef} tabIndex={-1} aria-atomic="true" aria-describedby={`${id}-guidance`}>
            {t('crops:plantHealthCatalogue.saveError')}
          </Alert> : null}
          <Alert severity="info" id={`${id}-guidance`}>{t(`crops:plantHealthCatalogue.${publishing ? 'approvalHint' : 'proposalHint'}`)}</Alert>
          <TextField select label={t('crops:plantHealthCatalogue.kind')} value={kind} disabled={busy} fullWidth size="small"
            onChange={event => setKind(event.target.value as PlantHealthKind)}>
            {(['pest', 'pathogen', 'disease', 'group'] as const).map(value =>
              <MenuItem key={value} value={value}>{t(`crops:plantHealthCatalogue.kinds.${value}`)}</MenuItem>)}
          </TextField>
          <TextField label={t('crops:plantHealthCatalogue.scientificName')} value={scientificName} required={Boolean(publishing && specific)}
            disabled={busy} fullWidth size="small" slotProps={{ htmlInput: { maxLength: 200 } }} onChange={event => {
              const next = event.target.value; setScientificName(next);
              setNames(previous => Object.fromEntries(Object.entries(previous).map(([code, row]) => [code,
                row.is_scientific_fallback ? { ...row, preferred_name: next.trim() } : row])) as typeof previous);
            }} />
          {specific ? <TextField label={t('crops:plantHealthCatalogue.eppoCode')} helperText={t('crops:plantHealthCatalogue.eppoHint')}
            value={eppoCode} disabled={busy} fullWidth size="small" slotProps={{ htmlInput: { maxLength: 6 } }}
            onChange={event => setEppoCode(event.target.value.toUpperCase())} /> : null}
          <NameFields value={names} scientificName={scientificName} onChange={setNames} disabled={busy} />
          <SourceFields value={sources} onChange={setSources} disabled={busy} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={close}>{t('common:actions.cancel')}</Button>
        <Button type="submit" variant="contained" disabled={busy}>{mode === 'approve' ? t('crops:plantHealthCatalogue.approve') : t('common:actions.save')}</Button>
      </DialogActions>
      </Box>
    </Dialog>
    <ConfirmationDialog open={discard} title={t('crops:form.discardChangesTitle')} message={t('crops:form.discardChangesMessage')}
      cancelLabel={t('crops:form.discardCancel')} confirmLabel={t('crops:form.discardConfirm')}
      onCancel={() => setDiscard(false)} onConfirm={onClose} />
  </>;
}
