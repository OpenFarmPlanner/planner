import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

import { cropSpeciesAPI, publicCropAPI } from '../../api/api';
import type { CropSpecies, PublicCrop, PublicCropSpeciesRelinkResponse } from '../../api/types';
import { CropSpeciesPicker } from '../../crops/CropSpeciesPicker';
import { getCropSpeciesOptionLabel } from '../../crops/cropSpeciesMatching';
import { useCropSpeciesOptions } from '../../crops/useCropSpeciesOptions';
import { useTranslation } from '../../i18n';

interface PublicCropSpeciesRelinkDialogProps {
  open: boolean;
  crop: PublicCrop | null;
  onClose: () => void;
  onRelinked: (result: PublicCropSpeciesRelinkResponse, speciesLabel: string) => void | Promise<void>;
  /**
   * Renaming a variety mutates a locked identity field, so it needs the same
   * admin gate the ordinary edit form uses (`public_crop_identity_admin_required`)
   * — a plain moderator can still relink the species alone. False disables the
   * variety field instead of hiding it, matching the edit form's own pattern.
   */
  varietyEditable: boolean;
}

/** Backend rejections that belong on the picker rather than in a snackbar. */
const INLINE_ERROR_KEYS: Record<string, string> = {
  public_crop_variety_conflict: 'library.relinkSpecies.conflictError',
  crop_species_unchanged: 'library.relinkSpecies.unchangedError',
  crop_species_rejected: 'library.relinkSpecies.rejectedError',
  // Belt-and-braces: the variety field is already disabled for a
  // non-admin, so this should not normally fire from this dialog.
  public_crop_identity_admin_required: 'library.relinkSpecies.varietyAdminOnly',
};

const getApiErrorCode = (error: unknown): string | undefined => (
  axios.isAxiosError(error)
    ? (error.response?.data as { code?: string } | undefined)?.code
    : undefined
);

/**
 * Moderators' "Kulturart korrigieren" dialog for a published Sorte.
 *
 * Corrects a `crop_species` mapping, optionally together with the `variety`
 * label — splitting a too-general species (e.g. "Gurke") into more specific
 * ones usually means each Sorte's variety needs relabelling in the same step,
 * not just moving it. The entry's `name` stays locked, and the species it is
 * moved off of stays available for whatever else legitimately maps to it. The
 * picker is the same one the publishing wizard uses, including its "propose a
 * new species" affordance — a target species that does not exist yet is filed
 * through that existing proposal flow, and the backend completes the
 * correction (species and variety together) once a moderator approves it.
 */
export function PublicCropSpeciesRelinkDialog({
  open,
  crop,
  onClose,
  onRelinked,
  varietyEditable,
}: PublicCropSpeciesRelinkDialogProps) {
  const { t, i18n } = useTranslation(['crops', 'common']);
  const { species, loading: speciesLoading, addSpecies } = useCropSpeciesOptions(open);
  const [selectedSpecies, setSelectedSpecies] = useState<CropSpecies | null>(null);
  const [speciesInputValue, setSpeciesInputValue] = useState('');
  const [proposalName, setProposalName] = useState<string | null>(null);
  const [varietyDraft, setVarietyDraft] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState('');
  // Guards the species-prefill effect below so it runs exactly once per open
  // session — a later `species` refresh must never clobber what the
  // moderator has since picked.
  const prefilledSpeciesRef = useRef(false);

  useEffect(() => {
    if (open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setSelectedSpecies(null);
    setSpeciesInputValue('');
    setProposalName(null);
    setErrorText('');
    /* eslint-enable react-hooks/set-state-in-effect */
    prefilledSpeciesRef.current = false;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVarietyDraft(crop?.variety ?? '');
  }, [open, crop]);

  useEffect(() => {
    if (!open || speciesLoading || prefilledSpeciesRef.current) return;
    prefilledSpeciesRef.current = true;
    // Preselected with the entry's current species: the moderator is
    // correcting *from* it, and leaving it as-is while only relabelling the
    // variety must not require re-picking it.
    const currentSpecies = species.find((option) => option.id === crop?.crop_species) ?? null;
    if (!currentSpecies) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setSelectedSpecies(currentSpecies);
    setSpeciesInputValue(getCropSpeciesOptionLabel(currentSpecies));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, speciesLoading, species, crop]);

  const currentSpeciesLabel = crop?.crop_species_name || t('library.relinkSpecies.noCurrentSpecies');

  const handleSpeciesChange = useCallback((value: CropSpecies | null) => {
    setSelectedSpecies(value);
    setErrorText('');
  }, []);

  const handleProposalNameChange = useCallback((name: string | null) => {
    setProposalName(name);
    if (!name) return;
    setSelectedSpecies(null);
    setErrorText('');
  }, []);

  const handleInputValueChange = useCallback((value: string) => {
    setSpeciesInputValue(value);
  }, []);

  const handleVarietyChange = useCallback((value: string) => {
    setVarietyDraft(value);
    setErrorText('');
  }, []);

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!crop) return;
    setSubmitting(true);
    setErrorText('');
    // Filing the proposal and relinking are two calls, and only the second can
    // fail on its own. When it does, the species proposal is already real, so
    // the retry must reuse it instead of filing a duplicate — it stays
    // selected, and the message says so rather than reading like nothing
    // happened.
    let proposalFiled = false;
    try {
      let target = selectedSpecies;
      if (!target && proposalName?.trim()) {
        // Routed through the existing "Kulturart vorschlagen" endpoint so this
        // never becomes a second way to create a species.
        const proposal = await cropSpeciesAPI.propose(
          proposalName.trim(),
          (i18n.language || 'de').split('-')[0],
        );
        target = proposal.data;
        proposalFiled = true;
        addSpecies(target);
        setSelectedSpecies(target);
        setProposalName(null);
        setSpeciesInputValue(getCropSpeciesOptionLabel(target));
      }
      if (!target) return;
      const response = await publicCropAPI.relinkSpecies(
        crop.id,
        target.id,
        varietyEditable ? { variety: varietyDraft.trim() } : undefined,
      );
      await onRelinked(response.data, getCropSpeciesOptionLabel(target));
    } catch (error) {
      const inlineKey = INLINE_ERROR_KEYS[getApiErrorCode(error) ?? ''];
      setErrorText(t(
        inlineKey
        ?? (proposalFiled ? 'library.relinkSpecies.proposalFiledError' : 'library.relinkSpecies.error'),
      ));
    } finally {
      setSubmitting(false);
    }
  }, [addSpecies, crop, i18n.language, onRelinked, proposalName, selectedSpecies, t, varietyDraft, varietyEditable]);

  const isProposing = Boolean(proposalName?.trim()) && !selectedSpecies;

  return (
    <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('library.relinkSpecies.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {t('library.relinkSpecies.description', { name: crop?.display_name || crop?.name || '' })}
          </Typography>
          <Typography variant="body2">
            {t('library.relinkSpecies.currentSpeciesLabel')}
            {': '}
            {currentSpeciesLabel}
          </Typography>
          <CropSpeciesPicker
            species={species}
            loading={speciesLoading}
            value={selectedSpecies}
            onChange={handleSpeciesChange}
            inputValue={speciesInputValue}
            onInputValueChange={handleInputValueChange}
            proposalName={proposalName}
            onProposalNameChange={handleProposalNameChange}
            proposing={submitting}
            required
          />
          <TextField
            label={t('form.variety')}
            placeholder={t('form.varietyPlaceholder')}
            value={varietyDraft}
            onChange={(event) => handleVarietyChange(event.target.value)}
            disabled={submitting || !varietyEditable}
            helperText={varietyEditable ? undefined : t('library.relinkSpecies.varietyAdminOnly')}
            fullWidth
          />
          {errorText ? <Alert severity="error">{errorText}</Alert> : null}
          {isProposing ? (
            <Typography variant="body2" color="text.secondary">
              {t('library.relinkSpecies.proposalHint', { name: proposalName?.trim() ?? '' })}
            </Typography>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button variant="outlined" onClick={onClose} disabled={submitting}>
          {t('common:actions.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={() => void handleSubmit()}
          disabled={submitting || (!selectedSpecies && !isProposing)}
        >
          {submitting
            ? t('library.relinkSpecies.saving')
            : isProposing
              ? t('library.relinkSpecies.submitProposal')
              : t('library.relinkSpecies.submit')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
