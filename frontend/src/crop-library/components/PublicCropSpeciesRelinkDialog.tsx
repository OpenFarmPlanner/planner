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
import {
  getCropSpeciesOptionLabel,
  getInitialSpeciesApprovalTranslations,
  REQUIRED_SPECIES_LANGUAGES,
  type SpeciesApprovalTranslations,
} from '../../crops/cropSpeciesMatching';
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
  duplicate_crop_species: 'library.relinkSpecies.duplicateSpeciesError',
  // Belt-and-braces: the variety field is already disabled for a
  // non-admin, so this should not normally fire from this dialog.
  public_crop_identity_admin_required: 'library.relinkSpecies.varietyAdminOnly',
};

const getApiErrorCode = (error: unknown): string | undefined => (
  axios.isAxiosError(error)
    ? (error.response?.data as { code?: string } | undefined)?.code
    : undefined
);

const languageCodeOf = (i18nLanguage: string): string => (i18nLanguage || 'de').split('-')[0];

/**
 * Moderators' "Kulturart korrigieren" dialog for a published Sorte.
 *
 * Corrects a `crop_species` mapping, optionally together with the `variety`
 * label — splitting a too-general species (e.g. "Gurke") into more specific
 * ones usually means each Sorte's variety needs relabelling in the same step,
 * not just moving it. The entry's `name` stays locked, and the species it is
 * moved off of stays available for whatever else legitimately maps to it.
 *
 * The picker is the same one the publishing wizard uses, including its
 * "propose a new species" affordance, plus (moderator-only, via
 * `useCropSpeciesOptions`'s `includeProposed`) every species someone already
 * proposed. Either way, a target species that is still `proposed` is
 * self-approved right here rather than parked behind a manual detour through
 * the moderation queue: a moderator who can open this dialog already has
 * approval authority, so submitting collects the same two required
 * translations the moderation queue's own approval dialog asks for, approves
 * the species, and relinks in one step.
 */
export function PublicCropSpeciesRelinkDialog({
  open,
  crop,
  onClose,
  onRelinked,
  varietyEditable,
}: PublicCropSpeciesRelinkDialogProps) {
  const { t, i18n } = useTranslation(['crops', 'common']);
  const { species, loading: speciesLoading, addSpecies } = useCropSpeciesOptions(open, true);
  const [selectedSpecies, setSelectedSpecies] = useState<CropSpecies | null>(null);
  const [speciesInputValue, setSpeciesInputValue] = useState('');
  const [proposalName, setProposalName] = useState<string | null>(null);
  const [varietyDraft, setVarietyDraft] = useState('');
  const [approvalTranslations, setApprovalTranslations] = useState<SpeciesApprovalTranslations>({ de: '', en: '' });
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
    setApprovalTranslations({ de: '', en: '' });
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
    // A pending species picked straight from the list needs the same
    // approval translations a freshly typed one does; existing ones are
    // preselected so the moderator only fills in what is actually missing.
    setApprovalTranslations(
      value?.status === 'proposed'
        ? getInitialSpeciesApprovalTranslations(value, value.name, languageCodeOf(i18n.language))
        : { de: '', en: '' },
    );
  }, [i18n.language]);

  const handleProposalNameChange = useCallback((name: string | null) => {
    setProposalName(name);
    if (!name) return;
    setSelectedSpecies(null);
    setErrorText('');
    setApprovalTranslations(getInitialSpeciesApprovalTranslations(null, name, languageCodeOf(i18n.language)));
  }, [i18n.language]);

  const handleInputValueChange = useCallback((value: string) => {
    setSpeciesInputValue(value);
  }, []);

  const handleVarietyChange = useCallback((value: string) => {
    setVarietyDraft(value);
    setErrorText('');
  }, []);

  const handleApprovalTranslationChange = useCallback((languageCode: 'de' | 'en', value: string) => {
    setApprovalTranslations((previous) => ({ ...previous, [languageCode]: value }));
    setErrorText('');
  }, []);

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!crop) return;
    setSubmitting(true);
    setErrorText('');
    // Approving a still-pending species is the step most likely to fail on
    // its own (a name that collides with an already-published species, a
    // translation left blank) — after it succeeds, the retry must reuse the
    // now-published species instead of proposing a duplicate.
    let approvalAttempted = false;
    try {
      let target = selectedSpecies;
      if (!target && proposalName?.trim()) {
        // Routed through the existing "Kulturart vorschlagen" endpoint so this
        // never becomes a second way to create a species.
        const proposal = await cropSpeciesAPI.propose(proposalName.trim(), languageCodeOf(i18n.language));
        target = proposal.data;
        addSpecies(target);
        setSelectedSpecies(target);
        setProposalName(null);
        setSpeciesInputValue(getCropSpeciesOptionLabel(target));
      }
      if (!target) return;
      if (target.status === 'proposed') {
        approvalAttempted = true;
        const approved = await cropSpeciesAPI.approve(
          target.id,
          '',
          REQUIRED_SPECIES_LANGUAGES.map((languageCode) => ({
            language_code: languageCode,
            common_name: approvalTranslations[languageCode].trim(),
          })),
        );
        target = approved.data;
        addSpecies(target);
        setSelectedSpecies(target);
        setSpeciesInputValue(getCropSpeciesOptionLabel(target));
        // Approval itself succeeded — a relink failure past this point is not
        // an approval failure, and must not be reported as one.
        approvalAttempted = false;
      }
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
        ?? (approvalAttempted ? 'library.relinkSpecies.approvalFailedError' : 'library.relinkSpecies.error'),
      ));
    } finally {
      setSubmitting(false);
    }
  }, [
    addSpecies, approvalTranslations, crop, i18n.language, onRelinked, proposalName,
    selectedSpecies, t, varietyDraft, varietyEditable,
  ]);

  const isProposing = Boolean(proposalName?.trim()) && !selectedSpecies;
  const needsApproval = isProposing || selectedSpecies?.status === 'proposed';
  const approvalTranslationsComplete = Boolean(approvalTranslations.de.trim() && approvalTranslations.en.trim());

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
          {needsApproval ? (
            <>
              <Typography variant="body2" color="text.secondary">
                {isProposing
                  ? t('library.relinkSpecies.proposalHint', { name: proposalName?.trim() ?? '' })
                  : t('library.relinkSpecies.pendingSpeciesHint', {
                    name: selectedSpecies ? getCropSpeciesOptionLabel(selectedSpecies) : '',
                  })}
              </Typography>
              <TextField
                label={t('library.moderation.species.germanName')}
                value={approvalTranslations.de}
                required
                fullWidth
                disabled={submitting}
                onChange={(event) => handleApprovalTranslationChange('de', event.target.value)}
              />
              <TextField
                label={t('library.moderation.species.englishName')}
                value={approvalTranslations.en}
                required
                fullWidth
                disabled={submitting}
                onChange={(event) => handleApprovalTranslationChange('en', event.target.value)}
              />
            </>
          ) : null}
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
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button variant="outlined" onClick={onClose} disabled={submitting}>
          {t('common:actions.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={() => void handleSubmit()}
          disabled={
            submitting
            || (!selectedSpecies && !isProposing)
            || (needsApproval && !approvalTranslationsComplete)
          }
        >
          {submitting
            ? t('library.relinkSpecies.saving')
            : isProposing
              ? t('library.relinkSpecies.submitProposal')
              : needsApproval
                ? t('library.relinkSpecies.submitApproval')
                : t('library.relinkSpecies.submit')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
