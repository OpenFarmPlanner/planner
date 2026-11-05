import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography, useMediaQuery, useTheme } from '@mui/material';
import { cropTaskTemplateAPI } from '../api/api';
import type { CropTaskTemplate, CropTaskTemplateWrite, TaskReferenceEvent } from '../api/types';
import { useTranslation } from '../i18n';
import { ConfirmationDialog } from '../components/feedback/ConfirmationDialog';
import LoadRetryButton from '../components/LoadRetryButton';
import { formGridSx, formGridFieldSx, formGridFullRowSx } from '../components/forms/formLayout';

const EVENTS: TaskReferenceEvent[] = ['propagation_start', 'sowing', 'planting', 'harvest_start', 'harvest_end'];

export function CropTaskTemplatesSection({ cropId }: { cropId: number }) {
  const { t } = useTranslation(['crops', 'dashboard', 'common']);
  const [rows, setRows] = useState<CropTaskTemplate[]>([]);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState<CropTaskTemplate | null | undefined>();
  const [deleting, setDeleting] = useState<CropTaskTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setFailed(false);
    cropTaskTemplateAPI.list(cropId).then((response) => {
      if (!cancelled) { setRows(response.results); setLoaded(true); }
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [cropId, retry]);
  const remove = async () => {
    if (!deleting || lock.current) return;
    lock.current = true;
    setBusy(true);
    setDeleteError(false);
    try {
      await cropTaskTemplateAPI.delete(deleting.id);
      setRows((previous) => previous.filter((row) => row.id !== deleting.id));
      setDeleting(null);
    } catch { setDeleteError(true); }
    finally { lock.current = false; setBusy(false); }
  };
  return <Box sx={{ mb: 3 }}>
    <Stack direction="row" sx={{ flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1 }}>
      <Typography variant="h6">{t('crops:taskTemplates.title')}</Typography>
      <Button onClick={() => setEditing(null)}>{t('crops:taskTemplates.add')}</Button>
    </Stack>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t('crops:taskTemplates.hint')}</Typography>
    {failed && <Alert severity="error" action={<LoadRetryButton onClick={() => setRetry((value) => value + 1)} />}>{t('crops:taskTemplates.loadError')}</Alert>}
    {loaded && rows.length === 0 && <Typography>{t('crops:taskTemplates.empty')}</Typography>}
    {loaded && rows.map((row) => <Box key={row.id} sx={{ py: 1, borderBottom: 1, borderColor: 'divider', overflowWrap: 'anywhere' }}>
      <Typography sx={{ fontWeight: 600 }}>{row.title}</Typography>
      {row.description && <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{row.description}</Typography>}
      <Typography variant="body2" color="text.secondary">{t(`dashboard:events.${row.reference_event}`)} · {t('crops:taskTemplates.offsetValue', { days: row.day_offset })}</Typography>
      <Button onClick={() => setEditing(row)} aria-label={t('crops:taskTemplates.editNamed', { title: row.title })}>{t('common:actions.edit')}</Button>
      <Button color="error" onClick={() => { setDeleteError(false); setDeleting(row); }} aria-label={t('crops:taskTemplates.deleteNamed', { title: row.title })}>{t('common:actions.delete')}</Button>
    </Box>)}
    {editing !== undefined && <TemplateEditor key={editing?.id ?? 'new'} template={editing} cropId={cropId}
      onClose={() => setEditing(undefined)} onSaved={(saved) => {
        setRows((previous) => editing ? previous.map((row) => row.id === saved.id ? saved : row) : [...previous, saved]);
        setEditing(undefined);
      }} />}
    <ConfirmationDialog open={Boolean(deleting)} title={t('crops:taskTemplates.delete')}
      message={<>{t('crops:taskTemplates.deleteConfirm', { title: deleting?.title })}{deleteError && <Alert severity="error">{t('crops:taskTemplates.saveError')}</Alert>}</>}
      messageTypographyProps={{ component: 'div' }} cancelLabel={t('common:actions.cancel')} confirmLabel={t('common:actions.delete')}
      onCancel={() => { if (!busy) setDeleting(null); }} onConfirm={() => { void remove(); }}
      cancelButtonProps={{ disabled: busy }} confirmButtonProps={{ disabled: busy, color: 'error' }} />
  </Box>;
}

function TemplateEditor({ template, cropId, onClose, onSaved }: {
  template: CropTaskTemplate | null; cropId: number; onClose: () => void; onSaved: (saved: CropTaskTemplate) => void;
}) {
  const { t } = useTranslation(['crops', 'dashboard', 'common']);
  const [draft, setDraft] = useState<CropTaskTemplateWrite>(template ?? {
    crop: cropId, title: '', description: '', reference_event: 'planting', day_offset: 0,
  });
  const [offset, setOffset] = useState(String(draft.day_offset));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const lock = useRef(false);
  const titleId = useId();
  const fullscreen = useMediaQuery(useTheme().breakpoints.down('md'));
  const validOffset = offset.trim() !== '' && Number.isInteger(Number(offset)) && Math.abs(Number(offset)) <= 3650;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current || !draft.title.trim() || !validOffset) return;
    lock.current = true; setBusy(true); setFailed(false);
    try {
      const payload = { ...draft, title: draft.title.trim(), day_offset: Number(offset) };
      const response = template ? await cropTaskTemplateAPI.update(template.id, payload) : await cropTaskTemplateAPI.create(payload);
      onSaved(response.data);
    } catch { setFailed(true); }
    finally { lock.current = false; setBusy(false); }
  };
  const close = () => { if (!lock.current) onClose(); };
  return <Dialog open onClose={close} fullWidth maxWidth="sm" fullScreen={fullscreen} aria-labelledby={titleId}
    slotProps={{ paper: { component: 'form', onSubmit: save } }}>
    <DialogTitle id={titleId}>{t(template ? 'crops:taskTemplates.edit' : 'crops:taskTemplates.add')}</DialogTitle>
    <DialogContent dividers>
      {failed && <Alert severity="error">{t('crops:taskTemplates.saveError')}</Alert>}
      <Box sx={formGridSx}>
        <TextField autoFocus required label={t('dashboard:form.title')} value={draft.title} disabled={busy} sx={formGridFullRowSx}
          slotProps={{ htmlInput: { maxLength: 200 } }} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
        <TextField multiline minRows={2} label={t('dashboard:form.description')} value={draft.description} disabled={busy} sx={formGridFullRowSx}
          onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
        <TextField select label={t('crops:taskTemplates.reference')} value={draft.reference_event} disabled={busy} sx={formGridFieldSx}
          onChange={(event) => setDraft({ ...draft, reference_event: event.target.value as TaskReferenceEvent })}>
          {EVENTS.map((event) => <MenuItem key={event} value={event}>{t(`dashboard:events.${event}`)}</MenuItem>)}
        </TextField>
        <TextField type="number" required label={t('crops:taskTemplates.offset')} value={offset} disabled={busy} sx={formGridFieldSx}
          helperText={t('crops:taskTemplates.offsetHint')} error={!validOffset} slotProps={{ htmlInput: { min: -3650, max: 3650, step: 1 } }}
          onChange={(event) => setOffset(event.target.value)} />
      </Box>
    </DialogContent>
    <DialogActions><Button disabled={busy} onClick={close}>{t('common:actions.cancel')}</Button>
      <Button type="submit" variant="contained" disabled={busy || !draft.title.trim() || !validOffset}>{t('common:actions.save')}</Button></DialogActions>
  </Dialog>;
}
