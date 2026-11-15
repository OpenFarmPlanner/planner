import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Pagination, Paper, Stack, TextField, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { ConfirmationDialog } from '../../components/feedback/ConfirmationDialog';
import { useTranslation } from '../../i18n';
import { showGlobalSnackbar } from '../../utils/globalSnackbar';
import { resolveLocaleFromLanguage } from '../../utils/numberLocalization';
import { plantHealthAPI } from './api';
import { EntryCard } from './EntryCard';
import { EntryDialog } from './EntryDialog';
import { HostDialog } from './HostDialog';
import type { PlantHealthEntry, PlantHealthHost, PlantHealthRevision, PlantHealthStatus } from './types';

const PAGE_SIZE = 20;
type ReviewTarget = { entry: PlantHealthEntry; action: 'reject' | 'archive' } | { entry: PlantHealthEntry; action: 'archiveHost'; host: PlantHealthHost };
export function PlantHealthCataloguePanel() {
  const { t, i18n } = useTranslation(['crops', 'common']);
  const titleId = useId();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<PlantHealthStatus | ''>('proposed');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<PlantHealthEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [writeFailed, setWriteFailed] = useState(false);
  const [editor, setEditor] = useState<{ entry?: PlantHealthEntry; mode: 'create' | 'edit' | 'approve' } | null>(null);
  const [hostEditor, setHostEditor] = useState<{ entry: PlantHealthEntry; host?: PlantHealthHost } | null>(null);
  const [review, setReview] = useState<ReviewTarget | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [actionFailed, setActionFailed] = useState(false);
  const [history, setHistory] = useState<PlantHealthRevision[] | null>(null);
  const sequence = useRef(0);
  const lock = useRef(false);
  const language = i18n.resolvedLanguage;
  const load = useCallback(async (signal?: AbortSignal) => {
    const current = ++sequence.current;
    setLoading(true); setFailed(false);
    try {
      const response = await plantHealthAPI.list({ q: query, status, include_proposed: true, page, page_size: PAGE_SIZE }, signal);
      if (current === sequence.current && !signal?.aborted) { setRows(response.data.results); setTotal(response.data.count); }
    } catch { if (current === sequence.current && !signal?.aborted) setFailed(true); }
    finally { if (current === sequence.current && !signal?.aborted) setLoading(false); }
  }, [query, status, page]);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => { void load(controller.signal); }, 250);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [load, language]);
  const saved = async () => { await load(); showGlobalSnackbar({ message: t('crops:plantHealthCatalogue.saved'), severity: 'success' }); };
  const startReview = (target: ReviewTarget) => { setReview(target); setReviewNote(''); setActionFailed(false); };
  const applyReview = async () => {
    if (!review || lock.current) return;
    lock.current = true; setBusy(true); setActionFailed(false);
    try {
      if (review.action === 'archiveHost') await plantHealthAPI.archiveHost(review.host.id);
      else await plantHealthAPI.review(review.entry.id, review.action, reviewNote);
      setReview(null); await saved();
    } catch { setActionFailed(true); }
    finally { lock.current = false; setBusy(false); }
  };
  const reopen = async (entry: PlantHealthEntry) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setWriteFailed(false);
    try { await plantHealthAPI.review(entry.id, 'reopen', ''); await saved(); }
    catch { setWriteFailed(true); }
    finally { lock.current = false; setBusy(false); }
  };
  const showHistory = async (entry: PlantHealthEntry) => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { const response = await plantHealthAPI.history(entry.id); setHistory(response.data); }
    catch { setFailed(true); }
    finally { lock.current = false; setBusy(false); }
  };
  return <Paper component="section" aria-labelledby={titleId} variant="outlined" sx={{ p: { xs: 1.5, sm: 2 }, minWidth: 0 }}>
    <Stack spacing={2}>
      <Typography component="h2" id={titleId} variant="h5" sx={{ overflowWrap: 'anywhere' }}>{t('crops:plantHealthCatalogue.title')}</Typography>
      <Typography variant="body2" color="text.secondary">{t('crops:plantHealthCatalogue.intro')}</Typography>
      <Button variant="outlined" startIcon={<AddIcon />} sx={{ alignSelf: 'flex-start' }} disabled={busy}
        onClick={() => setEditor({ mode: 'create' })}>{t('crops:plantHealthCatalogue.add')}</Button>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField label={t('crops:plantHealthCatalogue.search')} value={query} size="small" fullWidth
          onChange={event => { setQuery(event.target.value); setPage(1); setLoading(true); }} />
        <TextField select label={t('crops:plantHealthCatalogue.status')} value={status} size="small" sx={{ minWidth: { sm: 260 }, flexShrink: 0 }}
          onChange={event => { setStatus(event.target.value as PlantHealthStatus | ''); setPage(1); setLoading(true); }}>
          <MenuItem value="">{t('crops:plantHealthCatalogue.allStatuses')}</MenuItem>
          {(['proposed', 'published', 'rejected', 'archived'] as const).map(value => <MenuItem key={value} value={value}>{t(`crops:plantHealthCatalogue.statuses.${value}`)}</MenuItem>)}
        </TextField>
      </Stack>
      {writeFailed ? <Alert severity="error">{t('crops:plantHealthCatalogue.saveError')}</Alert> : null}
      {failed ? <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => { void load(); }}>{t('crops:plantHealthCatalogue.retry')}</Button>}>{t('crops:plantHealthCatalogue.loadError')}</Alert> : null}
      {loading ? <CircularProgress size={24} aria-label={t('common:messages.loading')} /> : failed ? null : rows.length === 0 ?
        <Typography color="text.secondary">{t('crops:plantHealthCatalogue.empty')}</Typography> : rows.map(entry => <EntryCard key={entry.id} entry={entry} disabled={busy}
          onEdit={() => setEditor({ entry, mode: 'edit' })} onReview={() => setEditor({ entry, mode: 'approve' })}
          onReject={() => startReview({ entry, action: 'reject' })} onArchive={() => startReview({ entry, action: 'archive' })}
          onReopen={() => { void reopen(entry); }} onHistory={() => { void showHistory(entry); }} onHost={host => setHostEditor({ entry, host })}
          onArchiveHost={host => startReview({ entry, action: 'archiveHost', host })} />)}
      {total > PAGE_SIZE ? <Pagination count={Math.ceil(total / PAGE_SIZE)} page={page} disabled={loading} size="small"
        onChange={(_, value) => { setPage(value); setLoading(true); }} /> : null}
    </Stack>
    {editor ? <EntryDialog {...editor} onClose={() => setEditor(null)} onSaved={saved} /> : null}
    {hostEditor ? <HostDialog {...hostEditor} onClose={() => setHostEditor(null)} onSaved={saved} /> : null}
    <ConfirmationDialog open={Boolean(review)} title={t(`crops:plantHealthCatalogue.${review?.action ?? 'archive'}`)}
      messageTypographyProps={{ component: 'div' }}
      message={<Stack spacing={1.5}>
        {actionFailed ? <Alert severity="error">{t('crops:plantHealthCatalogue.saveError')}</Alert> : null}
        <Typography component="span">{t(`crops:plantHealthCatalogue.${review?.action === 'reject' ? 'confirmReject' : 'confirmArchive'}`, { name: review?.entry.display_name ?? '' })}</Typography>
        {review?.action !== 'archiveHost' ? <TextField label={t('crops:plantHealthCatalogue.reviewNote')} value={reviewNote} multiline minRows={2} fullWidth disabled={busy}
          onChange={event => setReviewNote(event.target.value)} slotProps={{ htmlInput: { maxLength: 2000 } }} /> : null}
      </Stack>} cancelLabel={t('common:actions.cancel')} confirmLabel={t(`crops:plantHealthCatalogue.${review?.action ?? 'archive'}`)}
      onCancel={() => { if (!busy) setReview(null); }} onConfirm={() => { void applyReview(); }}
      confirmButtonProps={{ disabled: busy }} cancelButtonProps={{ disabled: busy }} />
    <Dialog open={history !== null} fullWidth maxWidth="sm" onClose={() => setHistory(null)}>
      <DialogTitle>{t('crops:plantHealthCatalogue.history')}</DialogTitle>
      <DialogContent dividers><Stack spacing={2}>{history?.map(row => <Stack key={row.id} spacing={0.5}>
        <Typography sx={{ fontWeight: 'bold' }}>{row.snapshot.name}</Typography>
        <Typography variant="body2">{t(`crops:plantHealthCatalogue.historyActions.${row.action}`, { defaultValue: t('crops:plantHealthCatalogue.historyActions.update') })}</Typography>
        <Typography variant="caption">{new Intl.DateTimeFormat(resolveLocaleFromLanguage(language), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(row.created_at))}</Typography>
        {row.snapshot.review_note ? <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.snapshot.review_note}</Typography> : null}
      </Stack>)}</Stack></DialogContent>
      <DialogActions><Button onClick={() => setHistory(null)}>{t('common:actions.close')}</Button></DialogActions>
    </Dialog>
  </Paper>;
}
