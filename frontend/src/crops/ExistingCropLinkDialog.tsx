import { useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material';
import { cropAPI, type Crop, type PublicCrop } from '../api/api';
import { useTranslation } from '../i18n';
import { PublicCropSyncPanel } from './PublicCropSyncPanel';
import { usePublicCropSyncPreview } from './usePublicCropSyncPreview';

export type CropLinkCandidate = Pick<Crop, 'id' | 'name' | 'variety' | 'source_public_crop'> & { species_match?: boolean };

export function ExistingCropLinkDialog({ publicCrop, candidates, onClose, onLinked, onImportAsNew }: {
  publicCrop: PublicCrop;
  candidates: CropLinkCandidate[];
  onClose: () => void;
  onLinked: (crop: Crop) => void;
  onImportAsNew?: () => void;
}) {
  const { t } = useTranslation(['crops', 'common']);
  const [targetId, setTargetId] = useState<number | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [failed, setFailed] = useState(false);
  const preview = usePublicCropSyncPreview(targetId, publicCrop.id, Boolean(targetId));
  const confirm = async () => {
    if (!targetId || !preview.preview) return;
    setSubmitting(true);
    setFailed(false);
    try {
      const fields = preview.preview.changes.filter((change) => preview.choices[change.field] !== 'mine').map((change) => change.field);
      const response = await cropAPI.linkPublicCrop(targetId, publicCrop.id, fields, preview.preview.public_version, preview.preview.crop_updated_at);
      onLinked(response.data);
    } catch {
      setFailed(true);
      preview.reload();
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Dialog open maxWidth="sm" fullWidth onClose={submitting ? undefined : onClose}>
      <DialogTitle>{t('library.linkExisting.importTitle')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Alert severity="info">{t('library.linkExisting.inheritance')}</Alert>
          <TextField select fullWidth label={t('library.linkExisting.localTarget')} value={targetId ?? ''}
            disabled={submitting} onChange={(event) => { setTargetId(Number(event.target.value)); setFailed(false); }}>
            {candidates.map((crop) => <MenuItem key={crop.id} value={crop.id} disabled={Boolean(crop.source_public_crop)}>
              {crop.name}{crop.variety ? ` · ${crop.variety}` : ''}{crop.source_public_crop ? ` · ${t('library.linkExisting.alreadyLinked')}` : ''}
            </MenuItem>)}
          </TextField>
          {targetId ? <PublicCropSyncPanel changes={preview.preview?.changes.map((change) => ({ ...change, pushable: true })) ?? null}
            choices={preview.choices} onChoicesChange={preview.setChoices} requiresModeration={false}
            keepMineLocally disabled={submitting} loadError={preview.loadError} /> : null}
          {failed ? <Alert severity="error">{t('library.linkExisting.failed')}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button disabled={submitting} onClick={onClose}>{t('common:actions.cancel')}</Button>
        {onImportAsNew ? <Button disabled={submitting} onClick={onImportAsNew}>{t('library.importConflictDialog.importAsNew')}</Button> : null}
        <Button variant="contained" disabled={submitting || !targetId || !preview.preview} onClick={() => void confirm()}>
          {t('library.linkExisting.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
