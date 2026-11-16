import { useId, useRef, useState, type FormEvent } from 'react';
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Stack, TextField, useMediaQuery, useTheme } from '@mui/material';
import type { CropSpecies } from '../../api/types';
import { ConfirmationDialog } from '../../components/feedback/ConfirmationDialog';
import { CropSpeciesPicker } from '../../crops/CropSpeciesPicker';
import { useCropSpeciesSearch } from '../../crops/useCropSpeciesSearch';
import { useTranslation } from '../../i18n';
import { plantHealthAPI } from './api';
import { sourcePayload } from './drafts';
import { SourceFields } from './SourceFields';
import type { PlantHealthEntry, PlantHealthHost } from './types';

export function HostDialog({ entry, host, onClose, onSaved }: {
  entry: PlantHealthEntry; host?: PlantHealthHost; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation(['crops', 'common']);
  const id = useId();
  const fullscreen = useMediaQuery(useTheme().breakpoints.down('md'));
  const [query, setQuery] = useState('');
  const [species, setSpecies] = useState<CropSpecies | null>(null);
  const search = useCropSpeciesSearch(query, !host);
  const [variety, setVariety] = useState(host?.variety_name ?? '');
  const [qualification, setQualification] = useState(host?.qualification ?? '');
  const [confirmed, setConfirmed] = useState(host?.is_confirmed ?? false);
  const [sources, setSources] = useState(host?.sources.length ? host.sources : [{ url: '' }]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [discard, setDiscard] = useState(false);
  const lock = useRef(false);
  const [initial] = useState(() => JSON.stringify({ species, variety, qualification, confirmed, sources }));
  const dirty = JSON.stringify({ species, variety, qualification, confirmed, sources }) !== initial;
  const close = () => { if (!lock.current) { if (dirty) setDiscard(true); else onClose(); } };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    const sourceRows = sourcePayload(sources);
    const speciesId = host?.species ?? species?.id;
    if (!speciesId || !sourceRows?.length) { setFailed(true); return; }
    lock.current = true; setBusy(true); setFailed(false);
    try {
      await plantHealthAPI.saveHost({ entry: entry.id, species: speciesId, variety_name: variety.trim(),
        qualification: qualification.trim(), sources: sourceRows, is_confirmed: entry.has_specific_identity && confirmed }, host?.id);
      await onSaved(); onClose();
    } catch { setFailed(true); }
    finally { lock.current = false; setBusy(false); }
  };
  return <>
    <Dialog open fullWidth maxWidth="sm" fullScreen={fullscreen} aria-labelledby={id}
      onClose={(_event, reason) => { if (reason !== 'backdropClick') close(); }}
      >
      <Box component="form" noValidate onSubmit={save} sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      <DialogTitle id={id}>{t(`crops:plantHealthCatalogue.${host ? 'editHost' : 'addHost'}`)}</DialogTitle>
      <DialogContent dividers><Stack spacing={2}>
        <Alert severity="info">{t('crops:plantHealthCatalogue.hostDisclaimer')}</Alert>
        {failed ? <Alert severity="error">{t('crops:plantHealthCatalogue.hostError')}</Alert> : null}
        {host ? <TextField label={t('crops:plantHealthCatalogue.species')} value={host.species_name} fullWidth size="small" slotProps={{ input: { readOnly: true } }} /> :
          <CropSpeciesPicker species={species && !search.results.some(row => row.id === species.id) ? [species, ...search.results] : search.results}
            loading={search.loading} value={species} onChange={setSpecies} inputValue={query}
            onInputValueChange={(value, reason) => { setQuery(value); if (reason === 'input' || reason === 'clear') setSpecies(null); }}
            proposalName={null} onProposalNameChange={() => {}} serverSearched allowProposal={false} disabled={busy}
            required label={t('crops:plantHealthCatalogue.species')} />}
        <TextField label={t('crops:plantHealthCatalogue.variety')} value={variety} disabled={busy} fullWidth size="small"
          slotProps={{ htmlInput: { maxLength: 200 } }} onChange={event => setVariety(event.target.value)} />
        <TextField label={t('crops:plantHealthCatalogue.qualification')} value={qualification} disabled={busy} fullWidth multiline minRows={2} size="small"
          slotProps={{ htmlInput: { maxLength: 2000 } }} onChange={event => setQualification(event.target.value)} />
        <FormControlLabel control={<Checkbox checked={confirmed && entry.has_specific_identity} disabled={busy || !entry.has_specific_identity}
          onChange={(_, value) => setConfirmed(value)} />} label={t('crops:plantHealthCatalogue.confirmed')} />
        {!entry.has_specific_identity ? <Alert severity="info">{t('crops:plantHealthCatalogue.broadIdentityHint')}</Alert> : null}
        <SourceFields value={sources} onChange={setSources} disabled={busy} />
      </Stack></DialogContent>
      <DialogActions><Button disabled={busy} onClick={close}>{t('common:actions.cancel')}</Button>
        <Button type="submit" variant="contained" disabled={busy}>{t('common:actions.save')}</Button></DialogActions>
      </Box>
    </Dialog>
    <ConfirmationDialog open={discard} title={t('crops:form.discardChangesTitle')} message={t('crops:form.discardChangesMessage')}
      cancelLabel={t('crops:form.discardCancel')} confirmLabel={t('crops:form.discardConfirm')}
      onCancel={() => setDiscard(false)} onConfirm={onClose} />
  </>;
}
