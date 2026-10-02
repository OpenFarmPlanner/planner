import { useCallback, useEffect, useRef, useState } from 'react';
import { type AutocompleteInputChangeReason, Alert, Box, CircularProgress, Stack } from '@mui/material';

import { cropAPI, cropSpeciesAPI } from '../api/api';
import type { Crop, CropSpecies } from '../api/types';
import { extractApiErrorMessage } from '../api/errors';
import { ConfirmationDialog } from '../components/feedback/ConfirmationDialog';
import { useTranslation } from '../i18n';
import { formatCropDisplayName } from './cropDisplay';
import { CropSpeciesPicker } from './CropSpeciesPicker';
import { getCropSpeciesOptionLabel } from './cropSpeciesMatching';
import { needsCropSpeciesSelection } from './publishChecks';
import { useCropSpeciesSearch } from './useCropSpeciesSearch';

interface RepublishPublicCropDialogProps {
  open: boolean;
  crop: Crop | undefined;
  originalLanguageCode: string;
  publishAsGeneral: boolean;
  onCancel: () => void;
  /** `cropSpeciesId` is set only when the user had to choose a species here. */
  onConfirm: (data: { cropSpeciesId?: number }) => void;
}

type CheckState = 'checking' | 'ready' | 'speciesRequired' | 'failed';

/**
 * Confirms "Wieder veröffentlichen" for the contributor's own withdrawn entry.
 *
 * The crop's own species link is normally reused, but it can be missing or
 * point at a species moderation has since rejected. The dialog asks the
 * backend first and, in that case, requires "Offizielle Kulturart" before the
 * confirm button is enabled instead of letting the publish fail server-side.
 */
export function RepublishPublicCropDialog({
  open,
  crop,
  originalLanguageCode,
  publishAsGeneral,
  onCancel,
  onConfirm,
}: RepublishPublicCropDialogProps) {
  const { t } = useTranslation(['crops', 'common']);
  const [checkState, setCheckState] = useState<CheckState>('checking');
  const [selectedSpecies, setSelectedSpecies] = useState<CropSpecies | null>(null);
  const [speciesInputValue, setSpeciesInputValue] = useState('');
  const [speciesSearchQuery, setSpeciesSearchQuery] = useState('');
  const [proposalName, setProposalName] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);
  const [proposeError, setProposeError] = useState('');
  // The picker only mounts once the pre-check asks for it, and MUI then resets
  // the input to the (empty) selection's label — which would wipe the crop-name
  // prefill the search starts from. That one empty reset is skipped.
  const skipMountResetRef = useRef(false);
  const cropId = crop?.id;
  const cropName = crop?.name ?? '';
  const speciesRequired = checkState === 'speciesRequired';
  const { results: speciesOptions, loading: speciesLoading } = useCropSpeciesSearch(
    speciesSearchQuery,
    open && speciesRequired,
  );

  useEffect(() => {
    if (!open || !cropId) return undefined;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setCheckState('checking');
      setSelectedSpecies(null);
      setSpeciesInputValue(cropName);
      setSpeciesSearchQuery(cropName);
      setProposalName(null);
      setProposeError('');
    });
    cropAPI.publishPreview(cropId, {
      original_language_code: originalLanguageCode,
      ...(publishAsGeneral ? { publish_as_general: true } : {}),
    })
      .then((response) => {
        if (cancelled) return;
        const speciesNeeded = needsCropSpeciesSelection(response.data);
        skipMountResetRef.current = speciesNeeded;
        setCheckState(speciesNeeded ? 'speciesRequired' : 'ready');
      })
      .catch(() => {
        // The publish itself still validates and explains any rejection, so
        // a failed pre-check must not block the user.
        if (!cancelled) setCheckState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [cropId, cropName, open, originalLanguageCode, publishAsGeneral]);

  const handleSpeciesInputChange = useCallback((value: string, reason?: AutocompleteInputChangeReason) => {
    const isMountReset = skipMountResetRef.current && reason === 'reset' && !value;
    skipMountResetRef.current = false;
    if (isMountReset) return;
    setProposeError('');
    setSpeciesInputValue(value);
    if (reason === 'input' || reason === 'clear') {
      setSpeciesSearchQuery(value);
    }
  }, []);

  const handleSpeciesChange = useCallback((value: CropSpecies | null) => {
    setSelectedSpecies(value);
  }, []);

  const handleProposalNameChange = useCallback((name: string | null) => {
    setProposalName(name);
    if (name) setSelectedSpecies(null);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!speciesRequired) {
      onConfirm({});
      return;
    }
    if (selectedSpecies) {
      onConfirm({ cropSpeciesId: selectedSpecies.id });
      return;
    }
    if (!proposalName) return;
    // Same as the publishing wizard: the proposal is filed only now, so
    // cancelling the dialog never leaves a stray proposal behind.
    setProposing(true);
    setProposeError('');
    try {
      const response = await cropSpeciesAPI.propose(proposalName.trim(), originalLanguageCode);
      setSpeciesInputValue(getCropSpeciesOptionLabel(response.data));
      onConfirm({ cropSpeciesId: response.data.id });
    } catch (error) {
      setProposeError(extractApiErrorMessage(error, t, t('library.publishWizard.proposeSpeciesError')));
    } finally {
      setProposing(false);
    }
  }, [onConfirm, originalLanguageCode, proposalName, selectedSpecies, speciesRequired, t]);

  const confirmDisabled = checkState === 'checking'
    || proposing
    || (speciesRequired && !selectedSpecies && !proposalName);

  return (
    <ConfirmationDialog
      open={open}
      title={t('library.republish.title')}
      maxWidth="sm"
      fullWidth
      messageTypographyProps={{ component: 'div' }}
      message={(
        <Stack spacing={2}>
          <Box component="span">
            {t('library.republish.message', { name: crop ? formatCropDisplayName(crop) : '' })}
          </Box>
          {checkState === 'checking' ? (
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <CircularProgress size={24} aria-label={t('common:messages.loading')} />
            </Box>
          ) : null}
          {checkState === 'failed' ? (
            <Alert severity="warning">{t('library.republish.checkError')}</Alert>
          ) : null}
          {speciesRequired ? (
            <Stack spacing={2} data-testid="republish-species-required">
              <Alert severity="info">{t('library.republish.speciesRequired')}</Alert>
              <CropSpeciesPicker
                species={speciesOptions}
                loading={speciesLoading}
                value={selectedSpecies}
                onChange={handleSpeciesChange}
                inputValue={speciesInputValue}
                onInputValueChange={handleSpeciesInputChange}
                proposalName={proposalName}
                onProposalNameChange={handleProposalNameChange}
                proposing={proposing}
                localCropName={crop?.name}
                errorText={proposeError}
                required
                serverSearched
              />
            </Stack>
          ) : null}
        </Stack>
      )}
      cancelLabel={t('common:actions.cancel')}
      confirmLabel={t('library.republish.confirm')}
      onCancel={onCancel}
      onConfirm={() => void handleConfirm()}
      actionsSx={{ px: 3, pb: 2.5, pt: 1 }}
      cancelButtonProps={{ variant: 'outlined' }}
      confirmButtonProps={{ variant: 'contained', color: 'primary', disabled: confirmDisabled }}
    />
  );
}
