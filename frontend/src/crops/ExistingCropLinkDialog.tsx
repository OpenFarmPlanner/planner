import { useRef, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material';
import { cropAPI, publicCropAPI, type Crop, type PublicCrop } from '../api/api';
import { useTranslation } from '../i18n';
import { PublicCropSyncPanel } from './PublicCropSyncPanel';
import { usePublicCropSyncPreview } from './usePublicCropSyncPreview';
import { getPublicCropTitle } from '../crop-library/publicCropDisplay';
import { extractApiErrorCode } from '../api/errors';

export type CropLinkCandidate = Pick<Crop, 'id' | 'name' | 'variety' | 'source_public_crop'> & { species_match?: boolean };

export function ExistingCropLinkDialog({ publicCrop, candidates, onClose, onLinked }: {
  publicCrop: PublicCrop;
  candidates: CropLinkCandidate[];
  onClose: () => void;
  onLinked: (crop: Crop) => void;
}) {
  const { t, i18n } = useTranslation(['crops', 'common']);
  const canCreate = Boolean(publicCrop.variety?.trim() || !candidates.some(candidate => candidate.species_match));
  const onlyCandidate = candidates.length === 1 && candidates[0].species_match && !candidates[0].source_public_crop
    ? candidates[0].id : undefined;
  const [target, setTarget] = useState<number | 'new' | undefined>(candidates.length ? onlyCandidate : 'new');
  const [mode, setMode] = useState<'copy' | 'link'>('copy');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [projectId] = useState(() => Number(window.localStorage.getItem('activeProjectId')));
  const hasProject = Number.isInteger(projectId) && projectId > 0;
  const [failed, setFailed] = useState<'failed' | 'projectChanged' | null>(null);
  const targetId = typeof target === 'number' ? target : undefined;
  // Switching import methods keeps the same field decisions.
  const preview = usePublicCropSyncPreview(targetId, publicCrop.id, Boolean(targetId), true);
  const choices = { ...preview.choices };
  if (mode === 'copy') {
    for (const field of Object.keys(choices)) {
      if (choices[field] === 'local') choices[field] = 'mine';
    }
  }
  const hasSelectable = candidates.some(candidate => !candidate.source_public_crop);
  const ready = target === 'new' ? canCreate && hasProject : Boolean(targetId && preview.preview);
  const confirm = async () => {
    if (!ready || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setFailed(null);
    try {
      if (target === 'new') {
        const response = await publicCropAPI.importToProject(publicCrop.id, candidates.length ? 'new' : undefined, {
          linkToLibrary: mode === 'link', baseVersion: publicCrop.version, expectedProjectId: projectId,
        });
        onLinked(response.data.crop);
      } else if (targetId && preview.preview) {
        const fields = preview.preview.changes.filter(change => choices[change.field] !== 'mine'
          && choices[change.field] !== 'local').map(change => change.field);
        const response = mode === 'copy'
          ? await cropAPI.copyPublicCrop(targetId, publicCrop.id, fields, preview.preview.public_version, preview.preview.crop_updated_at)
          : await cropAPI.linkPublicCrop(targetId, publicCrop.id, fields, preview.preview.public_version, preview.preview.crop_updated_at, preview.selection.pinFields);
        onLinked(response.data);
      }
    } catch (error) {
      setFailed(extractApiErrorCode(error) === 'public_crop_import_project_changed' ? 'projectChanged' : 'failed');
      preview.reload();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };
  return (
    <Dialog open maxWidth="sm" fullWidth onClose={submitting ? undefined : onClose}>
      <DialogTitle>{t('library.importDecision.title')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="subtitle2">{getPublicCropTitle(publicCrop, i18n.resolvedLanguage ?? i18n.language, t('library.translation.missingName'))}</Typography>
          <Typography variant="body2">{t(candidates.length ? 'library.importDecision.existing' : 'library.importDecision.newCrop')}</Typography>
          {candidates.length ? <TextField select fullWidth label={t('library.linkExisting.localTarget')} value={target ?? ''}
            disabled={submitting} onChange={event => { setTarget(event.target.value === 'new' ? 'new' : Number(event.target.value)); setFailed(null); }}>
            {candidates.map(crop => <MenuItem key={crop.id} value={crop.id} disabled={Boolean(crop.source_public_crop)}>
              {crop.name}{crop.variety ? ` · ${crop.variety}` : ''}{crop.source_public_crop ? ` · ${t('library.linkExisting.alreadyLinked')}` : ''}
            </MenuItem>)}
            {canCreate ? <MenuItem value="new">{t('library.importConflictDialog.importAsNew')}</MenuItem> : null}
          </TextField> : null}
          {candidates.length && !hasSelectable ? <Alert severity="info">{t('library.importDecision.alreadyLinked')}</Alert> : null}
          <RadioGroup value={mode} aria-label={t('library.importDecision.mode')} onChange={event => setMode(event.target.value as 'copy' | 'link')}>
            <FormControlLabel disabled={submitting} value="copy" control={<Radio />} label={t('library.importDecision.copy')} />
            <FormControlLabel disabled={submitting} value="link" control={<Radio />} label={t('library.importDecision.link')} />
          </RadioGroup>
          <Alert severity="info">{t(mode === 'copy' ? 'library.importDecision.copyHelp' : 'library.importDecision.linkHelp')}</Alert>
          {targetId ? <PublicCropSyncPanel changes={preview.preview?.changes.map(change => ({ ...change, pushable: true })) ?? null}
            choices={choices} onChoicesChange={preview.setChoices} requiresModeration={false}
            keepMineLocally allowLocal={mode === 'link'} disabled={submitting} loadError={preview.loadError} /> : null}
          {target === 'new' && !hasProject ? <Alert severity="warning">{t('library.importDecision.projectChanged')}</Alert> : null}
          {failed ? <Alert severity="error">{t(`library.importDecision.${failed}`)}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button disabled={submitting} onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button variant="contained" disabled={submitting || !ready} onClick={() => void confirm()}>
          {t(mode === 'copy' ? 'library.importDecision.copy' : 'library.importDecision.link')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
