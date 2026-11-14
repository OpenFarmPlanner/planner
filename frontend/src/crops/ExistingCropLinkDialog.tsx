import { useRef, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Radio, RadioGroup, Stack, TextField, Typography } from '@mui/material';
import { cropAPI, publicCropAPI, type Crop, type PublicCrop } from '../api/api';
import { useTranslation } from '../i18n';
import { PublicCropSyncPanel } from './PublicCropSyncPanel';
import { usePublicCropSyncPreview } from './usePublicCropSyncPreview';
import { getPublicCropTitle } from '../crop-library/publicCropDisplay';
import { extractApiErrorCode } from '../api/errors';
import { canKeepSyncFieldLocally, splitSyncChoices, type PublicCropSyncChoices } from './publicCropSync';
import { PublicLibraryTermsConsent } from './PublicLibraryTermsConsent';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';

export type CropLinkCandidate = Pick<Crop, 'id' | 'name' | 'variety' | 'source_public_crop'> & { species_match?: boolean };

export function ExistingCropLinkDialog({ publicCrop, candidates, onClose, onLinked, termsAlreadyAccepted = false, onTermsAccepted }: {
  publicCrop: PublicCrop;
  candidates: CropLinkCandidate[];
  onClose: () => void;
  onLinked: (crop: Crop) => void;
  termsAlreadyAccepted?: boolean;
  onTermsAccepted?: () => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation(['crops', 'common']);
  const canCreate = Boolean(publicCrop.variety?.trim() || !candidates.some(candidate => candidate.species_match));
  const onlyCandidate = candidates.length === 1 && candidates[0].species_match && !candidates[0].source_public_crop
    ? candidates[0].id : undefined;
  const [target, setTarget] = useState<number | 'new' | undefined>(candidates.length ? onlyCandidate : 'new');
  const [mode, setMode] = useState<'copy' | 'link'>(candidates.some(candidate => !candidate.source_public_crop) ? 'link' : 'copy');
  const [explicitShares, setExplicitShares] = useState<Set<string>>(new Set());
  const [shareSnapshot, setShareSnapshot] = useState('');
  const [acceptedLicense, setAcceptedLicense] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [projectId] = useState(() => Number(window.localStorage.getItem('activeProjectId')));
  const hasProject = Number.isInteger(projectId) && projectId > 0;
  const [failed, setFailed] = useState<'failed' | 'projectChanged' | null>(null);
  const targetId = typeof target === 'number' ? target : undefined;
  const preview = usePublicCropSyncPreview(targetId, publicCrop.id, Boolean(targetId), true);
  const snapshot = preview.preview ? `${targetId}:${preview.preview.public_version}:${preview.preview.crop_updated_at}` : '';
  const directSharingAllowed = !preview.preview?.requires_moderation;
  const changes = preview.preview?.changes.map(change => ({
    ...change, pushable: mode === 'copy' || (change.pushable && directSharingAllowed),
  })) ?? null;
  const choices = { ...preview.choices };
  for (const change of changes ?? []) {
    if (mode === 'copy') {
      if (choices[change.field] === 'local') choices[change.field] = 'mine';
    } else if (choices[change.field] === 'mine' && (shareSnapshot !== snapshot || !explicitShares.has(change.field) || !change.pushable)) {
      // Defaults and copy-only decisions retain private intent. Only a click
      // on the sharing column in this link decision may publish a value.
      choices[change.field] = canKeepSyncFieldLocally(change) ? 'local' : 'library';
    }
  }
  const updateChoices = (next: PublicCropSyncChoices) => {
    if (mode === 'link') {
      setShareSnapshot(snapshot);
      setExplicitShares(new Set((changes ?? []).filter(change => change.pushable && next[change.field] === 'mine').map(change => change.field)));
      preview.setChoices(next);
      return;
    }
    const updated = { ...preview.choices };
    for (const [field, choice] of Object.entries(next)) {
      if (choice !== choices[field]) updated[field] = choice;
    }
    preview.setChoices(updated);
  };
  const selection = splitSyncChoices(changes ?? [], choices, { allowLocal: mode === 'link' });
  const needsConsent = mode === 'link' && selection.pushFields.length > 0 && !termsAlreadyAccepted;
  const hasSelectable = candidates.some(candidate => !candidate.source_public_crop);
  const ready = target === 'new' ? canCreate && hasProject : Boolean(targetId && preview.preview);
  const confirm = async () => {
    if (!ready || (needsConsent && !acceptedLicense) || submittingRef.current) return;
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
          : await cropAPI.linkPublicCrop(targetId, publicCrop.id, selection.pullFields, preview.preview.public_version, preview.preview.crop_updated_at, selection.pinFields,
            { pushFields: selection.pushFields, acceptedPublicLibraryTerms: needsConsent && acceptedLicense });
        if (needsConsent && acceptedLicense) {
          void onTermsAccepted?.().catch(error => console.error('Error refreshing contribution consent:', error));
        }
        onLinked(response.data);
      }
    } catch (error) {
      setExplicitShares(new Set());
      setAcceptedLicense(false);
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
            disabled={submitting} onChange={event => { setTarget(event.target.value === 'new' ? 'new' : Number(event.target.value)); setExplicitShares(new Set()); setAcceptedLicense(false); setFailed(null); }}>
            {candidates.map(crop => <MenuItem key={crop.id} value={crop.id} disabled={Boolean(crop.source_public_crop)}>
              {crop.name}{crop.variety ? ` · ${crop.variety}` : ''}{crop.source_public_crop ? ` · ${t('library.linkExisting.alreadyLinked')}` : ''}
            </MenuItem>)}
            {canCreate ? <MenuItem value="new">{t('library.importConflictDialog.importAsNew')}</MenuItem> : null}
          </TextField> : null}
          {candidates.length && !hasSelectable ? <Alert severity="info">{t('library.importDecision.alreadyLinked')}</Alert> : null}
          <RadioGroup value={mode} aria-label={t('library.importDecision.mode')} onChange={event => { setMode(event.target.value as 'copy' | 'link'); setExplicitShares(new Set()); setAcceptedLicense(false); }}>
            <FormControlLabel disabled={submitting} value="link" control={<Radio />} label={t('library.importDecision.link')} />
            <FormControlLabel disabled={submitting} value="copy" control={<Radio />} label={t('library.importDecision.copy')} />
          </RadioGroup>
          <Alert severity="info">{t(mode === 'copy' ? 'library.importDecision.copyHelp' : 'library.importDecision.linkHelp')}</Alert>
          {targetId && mode === 'link' && !directSharingAllowed ? <Alert severity="info">{t('library.importDecision.shareUnavailable')}</Alert> : null}
          {targetId ? <PublicCropSyncPanel changes={changes}
            choices={choices} onChoicesChange={updateChoices} requiresModeration={false}
            keepMineLocally={mode === 'copy'} allowLocal={mode === 'link'} disabled={submitting} loadError={preview.loadError} /> : null}
          {needsConsent ? <PublicLibraryTermsConsent checked={acceptedLicense} onChange={setAcceptedLicense} disabled={submitting} /> : null}
          {target === 'new' && !hasProject ? <Alert severity="warning">{t('library.importDecision.projectChanged')}</Alert> : null}
          {failed ? <Alert severity="error">{t(`library.importDecision.${failed}`)}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button disabled={submitting} onClick={onClose}>{t('common:actions.cancel')}</Button>
        <DisabledActionTooltip title={submitting ? t('common:disabledReasons.busy')
          : needsConsent && !acceptedLicense ? t('library.sync.acceptLicenseFirst')
            : !ready ? t('library.importDecision.selectTarget') : ''}>
        <Button variant="contained" disabled={submitting || !ready || (needsConsent && !acceptedLicense)} onClick={() => void confirm()}>
          {t(mode === 'copy' ? 'library.importDecision.copy' : 'library.importDecision.link')}
        </Button>
        </DisabledActionTooltip>
      </DialogActions>
    </Dialog>
  );
}
