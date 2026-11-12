import { useId, useRef, useState, type FormEvent } from 'react';
import { Alert, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Button, Typography, useMediaQuery, useTheme } from '@mui/material';

import { cropCompanionAPI } from '../api/api';
import type { Crop } from '../api/types';
import { ConfirmationDialog } from '../components/feedback/ConfirmationDialog';
import { useTranslation } from '../i18n';
import { formRowsToReplaceItems } from './companions';
import { getCropDisplayName } from './cropDisplay';
import { CompanionsSection } from './sections/CompanionsSection';
import { useCompanionFormRows } from './useCompanionFormRows';

/** Edits only a project's existing Kultur; library proposals keep their own save flow. */
export function CropCompanionEditor({ crop, crops, onClose, onSaved }: {
  crop: Crop;
  crops: Crop[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation(['crops', 'common']);
  const titleId = useId();
  const fullscreen = useMediaQuery(useTheme().breakpoints.down('md'));
  const [retry, setRetry] = useState(0);
  const state = useCompanionFormRows({ variant: 'project', crop, crops, isKulturForm: true, reloadKey: retry });
  const cropName = state.kulturName || getCropDisplayName(crop);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [discard, setDiscard] = useState(false);
  const lock = useRef(false);
  const validOwner = crop.id !== undefined && !(crop.variety || '').trim();
  const close = () => {
    if (lock.current) return;
    if (state.dirty) setDiscard(true);
    else onClose();
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current || !validOwner || crop.id === undefined || !state.loaded || state.failed || !state.dirty || !state.validate()) return;
    lock.current = true;
    setBusy(true);
    setFailed(false);
    try {
      await cropCompanionAPI.replace(crop.id, formRowsToReplaceItems(state.rows));
      await onSaved();
      onClose();
    } catch {
      setFailed(true);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  return <>
    <Dialog open fullWidth maxWidth="md" fullScreen={fullscreen} aria-labelledby={titleId}
      onClose={(_event, reason) => { if (reason !== 'backdropClick') close(); }}
      slotProps={{ paper: { component: 'form', onSubmit: save } }}>
      <DialogTitle id={titleId}>{t('crops:companions.editTitle')}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>{cropName}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('crops:companions.sharedHint', { name: cropName })}
        </Typography>
        {!state.loaded ? <CircularProgress size={20} aria-label={t('common:messages.loading')} /> : null}
        {failed ? <Alert severity="error" sx={{ mb: 1 }}>{t('crops:companions.editorSaveError')}</Alert> : null}
        <CompanionsSection state={state} disabled={busy || !state.loaded || state.failed || !validOwner} compact hideTitle
          onRetry={() => setRetry(value => value + 1)} />
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={busy}>{t('common:actions.cancel')}</Button>
        <Button type="submit" variant="contained" disabled={busy || !validOwner || !state.loaded || state.failed || !state.dirty}>
          {t('common:actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
    <ConfirmationDialog open={discard} title={t('crops:form.discardChangesTitle')}
      message={t('crops:form.discardChangesMessage')} cancelLabel={t('crops:form.discardCancel')}
      confirmLabel={t('crops:form.discardConfirm')} onCancel={() => setDiscard(false)} onConfirm={onClose} />
  </>;
}
