import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormGroup,
  InputLabel,
  Link,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router';
import { AppTooltip } from '../components/AppTooltip';
import { cropSpeciesAPI, cropAPI, publicCropAPI, type Crop } from '../api/api';
import type { CropSpecies, PublicCrop, PublicCropDuplicateCandidate, PublishPublicCropPreview } from '../api/types';
import { extractApiErrorMessage } from '../api/errors';
import { useTranslation } from '../i18n';
import i18n from '../i18n/config';
import { getLanguageDisplayName } from '../i18n/languages';
import { buildPublicCropComparison } from './publicCropComparison';
import {
  buildPublishVarietyCandidates,
  getPublishableVarieties,
  type PublishVarietySelection,
} from '../crops/publishVarieties';
import { CropSpeciesPicker } from '../crops/CropSpeciesPicker';
import { useCropSpeciesOptions } from '../crops/useCropSpeciesOptions';
import {
  getCropSpeciesOptionLabel,
  getCropSpeciesSearchNames,
  normalizeCropSpeciesSearchValue,
} from '../crops/cropSpeciesMatching';

interface CropsPublishingWizardDialogProps {
  open: boolean;
  crop: Crop | undefined;
  /**
   * The project's Sorten belonging to `crop`'s Kultur group, offered for
   * co-publication. Empty for a Sorte publish — a Sorte has no Sorten of its
   * own — which keeps the dialog exactly as it was for those crops.
   */
  varieties?: Crop[];
  termsAlreadyAccepted: boolean;
  publishing: boolean;
  onClose: () => void;
  onPublish: (data: {
    acceptedPublicLibraryTerms: boolean;
    cropSpeciesId?: number;
    originalLanguageCode: string;
    publicCropId?: number | null;
    publishAsGeneral?: boolean;
    varieties?: PublishVarietySelection[];
  }) => void;
  /**
   * Confirms linking a general Kultur to a foreign duplicate candidate found
   * by the blocking duplicate check. Unlike `onPublish`, this is awaited: the
   * dialog stays open and shows the confirmation view again (with a refreshed
   * duplicate list) if the backend rejects the link, e.g. because the
   * candidate was withdrawn between preview and confirm.
   */
  onLinkPublicCrop: (data: {
    acceptedPublicLibraryTerms: boolean;
    cropSpeciesId?: number;
    originalLanguageCode: string;
    publicCropId: number;
    varieties?: PublishVarietySelection[];
  }) => Promise<boolean>;
}

const LANGUAGE_CODES = ['de', 'en'] as const;
const EMPTY_REQUIRED_FIELDS: PublishPublicCropPreview['missing_required_fields'] = [];
const EMPTY_DUPLICATES: PublishPublicCropPreview['duplicates'] = [];
const EMPTY_VARIETIES: Crop[] = [];

const getDefaultLanguageCode = (): string => {
  const language = (i18n.language || 'de').split('-')[0];
  return LANGUAGE_CODES.includes(language as (typeof LANGUAGE_CODES)[number]) ? language : 'de';
};

const findInitialSpecies = (items: CropSpecies[], crop: Crop | undefined): CropSpecies | null => {
  const cropSpeciesId = crop?.crop_species ?? null;
  if (cropSpeciesId) {
    return items.find((item) => item.id === cropSpeciesId) ?? null;
  }

  const normalizedCropName = normalizeCropSpeciesSearchValue(crop?.name);
  if (!normalizedCropName) {
    return null;
  }
  return items.find((item) => (
    getCropSpeciesSearchNames(item).some((name) => normalizeCropSpeciesSearchValue(name) === normalizedCropName)
  )) ?? null;
};

const getPublicCropOptionLabel = (option: PublicCrop): string => {
  const name = option.display_name || option.crop_species_name || option.name;
  return option.variety ? `${name} · ${option.variety}` : name;
};

// The "Existing variety" field is already scoped to the chosen species (it's
// right below that field), so repeating the species name in every option
// would just be noise — only the variety name itself is shown/typed there.
const getExistingVarietyOptionLabel = (option: PublicCrop): string => option.variety || getPublicCropOptionLabel(option);

export function CropsPublishingWizardDialog({
  open,
  crop,
  varieties = EMPTY_VARIETIES,
  termsAlreadyAccepted,
  publishing,
  onClose,
  onPublish,
  onLinkPublicCrop,
}: CropsPublishingWizardDialogProps) {
  const { t } = useTranslation(['crops', 'common']);
  const [selectedSpecies, setSelectedSpecies] = useState<CropSpecies | null>(null);
  const [publicCropOptions, setPublicCropOptions] = useState<PublicCrop[]>([]);
  const [publicCropLoading, setPublicCropLoading] = useState(false);
  const [selectedPublicCrop, setSelectedPublicCrop] = useState<PublicCrop | null>(null);
  const [publicCropInput, setPublicCropInput] = useState('');
  const [originalLanguageCode, setOriginalLanguageCode] = useState(getDefaultLanguageCode());
  const [acceptedLicense, setAcceptedLicense] = useState(false);
  const [validationResult, setValidationResult] = useState<PublishPublicCropPreview | null>(null);
  const [validationLoading, setValidationLoading] = useState(false);
  const [showLicenseConfirmation, setShowLicenseConfirmation] = useState(false);
  const [speciesInputValue, setSpeciesInputValue] = useState('');
  const [existingVarietyInputValue, setExistingVarietyInputValue] = useState('');
  const [proposedSpeciesName, setProposedSpeciesName] = useState<string | null>(null);
  // Set while the user picked "propose this as a new species" but nothing has
  // been sent yet — the dialog's main button submits it (see handlePublish).
  const [pendingSpeciesProposalName, setPendingSpeciesProposalName] = useState<string | null>(null);
  const [proposingSpecies, setProposingSpecies] = useState(false);
  const [proposeSpeciesError, setProposeSpeciesError] = useState('');
  const [generalNoticeDismissed, setGeneralNoticeDismissed] = useState(false);
  const [showLanguageOverride, setShowLanguageOverride] = useState(false);
  // Sorten are published along by default, so only the exceptions are tracked.
  const [deselectedVarietyIds, setDeselectedVarietyIds] = useState<Set<number>>(new Set());
  // Whether the public entries the Sorten are matched against have arrived.
  // Their absence is not the same as "no conflicts": a pending or failed
  // lookup would silently offer every Sorte as new.
  const [varietyLookupSettled, setVarietyLookupSettled] = useState(false);
  const [varietyLookupFailed, setVarietyLookupFailed] = useState(false);
  // Set once the user picks "Mit diesem Eintrag verknüpfen" on a blocking
  // duplicate candidate; switches the dialog into the link-confirmation view.
  const [showLinkConfirmation, setShowLinkConfirmation] = useState(false);
  const [linkConfirmLoadingId, setLinkConfirmLoadingId] = useState<number | null>(null);
  const [linkConfirmError, setLinkConfirmError] = useState('');
  // Whether the "Verknüpfen" submit itself is in flight, separate from
  // `publishing` (which the parent also uses for the ordinary publish flow).
  const [linkConfirmSubmitting, setLinkConfirmSubmitting] = useState(false);
  const speciesInputRef = useRef<HTMLInputElement | null>(null);
  const languageInputRef = useRef<HTMLInputElement | null>(null);
  // The initial species guess is applied once per opening: re-running it after
  // `addSpecies` would overwrite a species the user just proposed.
  const initialSpeciesAppliedRef = useRef(false);
  const ownedPublicCropId = crop?.owned_public_crop_id ?? null;
  const isOwnedPublicCropUpdate = Boolean(ownedPublicCropId);
  const {
    species,
    loading: speciesLoading,
    loaded: speciesLoaded,
    addSpecies,
  } = useCropSpeciesOptions(open && !isOwnedPublicCropUpdate);
  // When updating an already-linked public entry, whether the update targets
  // a general (varietyless) entry depends on the linked entry itself, not on
  // the local crop — the local crop may have no variety yet the public
  // entry it's linked to could be variety-specific, or vice versa.
  const isCropLevelPublish = isOwnedPublicCropUpdate
    ? Boolean(selectedPublicCrop) && !selectedPublicCrop?.variety?.trim()
    : !crop?.variety?.trim();
  const publishableVarieties = useMemo(() => getPublishableVarieties(varieties), [varieties]);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setAcceptedLicense(false);
      setShowLicenseConfirmation(false);
      // Prefilled with the local crop's own name so the field never starts
      // empty — the user can still overwrite it if no official species
      // matches, or if they want to propose a different one.
      setSpeciesInputValue(crop?.name ?? '');
      // Same idea for the variety field: pre-fill with the local variety's
      // own name. If a matching public entry is found once the search
      // results load (see the publicCropOptions effect), it's also
      // auto-selected there.
      setExistingVarietyInputValue(crop?.variety ?? '');
      setProposedSpeciesName(null);
      setPendingSpeciesProposalName(null);
      setProposeSpeciesError('');
      setGeneralNoticeDismissed(false);
      setShowLanguageOverride(false);
      setValidationResult(null);
      setOriginalLanguageCode(getDefaultLanguageCode());
      setPublicCropInput(crop?.name ?? '');
      setSelectedPublicCrop(null);
      setDeselectedVarietyIds(new Set());
      setVarietyLookupSettled(false);
      setVarietyLookupFailed(false);
      setShowLinkConfirmation(false);
      setLinkConfirmLoadingId(null);
      setLinkConfirmError('');
      setLinkConfirmSubmitting(false);
    });
  }, [crop?.name, crop?.variety, open]);

  useEffect(() => {
    const publicCropId = ownedPublicCropId ?? crop?.source_public_crop;
    if (!open || !publicCropId) return;
    let cancelled = false;
    publicCropAPI.get(publicCropId)
      .then((response) => {
        if (cancelled) return;
        setSelectedPublicCrop(response.data);
        setPublicCropInput(getPublicCropOptionLabel(response.data));
        if (ownedPublicCropId) {
          setOriginalLanguageCode(response.data.original_language_code || getDefaultLanguageCode());
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [crop?.source_public_crop, open, ownedPublicCropId]);

  useEffect(() => {
    // A crop-level publish has no variety field of its own, but its Sorten
    // still need the species' public entries to spot name conflicts.
    if (isOwnedPublicCropUpdate) return undefined;
    if (isCropLevelPublish && publishableVarieties.length === 0) return undefined;
    if (!open) return undefined;
    const searchTerm = selectedSpecies?.name.trim() || '';
    if (!searchTerm) {
      queueMicrotask(() => setPublicCropOptions([]));
      return undefined;
    }
    // A species switch invalidates the previous species' entries, so the
    // Sorten must not be matched against them while the new list is loading.
    queueMicrotask(() => {
      setVarietyLookupSettled(false);
      setVarietyLookupFailed(false);
    });

    let cancelled = false;
    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => {
      setPublicCropLoading(true);
      publicCropAPI.list({ q: searchTerm }, abortController.signal)
        .then((response) => {
          if (cancelled) return;
          const filtered = response.data.results.filter((entry) => (
            !selectedSpecies || entry.crop_species === selectedSpecies.id
          ));
          setPublicCropOptions(filtered);
          setVarietyLookupSettled(true);
          // If the local variety already has a matching public entry,
          // recognize it immediately instead of leaving the field empty —
          // mirrors the species field's own-name prefill above.
          const normalizedLocalVariety = normalizeCropSpeciesSearchValue(crop?.variety);
          const match = normalizedLocalVariety
            ? filtered.find((entry) => normalizeCropSpeciesSearchValue(entry.variety) === normalizedLocalVariety)
            : undefined;
          if (match) {
            setSelectedPublicCrop((prevSelected) => prevSelected ?? match);
            setExistingVarietyInputValue((prevInput) => (
              prevInput === (crop?.variety ?? '') ? getExistingVarietyOptionLabel(match) : prevInput
            ));
          }
        })
        .catch(() => {
          if (cancelled || abortController.signal.aborted) return;
          setPublicCropOptions([]);
          setVarietyLookupSettled(true);
          setVarietyLookupFailed(true);
        })
        .finally(() => {
          if (!cancelled) setPublicCropLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [crop?.variety, isOwnedPublicCropUpdate, isCropLevelPublish, open, publishableVarieties.length, selectedSpecies]);

  useEffect(() => {
    if (!open) {
      initialSpeciesAppliedRef.current = false;
    }
  }, [open]);

  useEffect(() => {
    if (!open || !speciesLoaded || initialSpeciesAppliedRef.current) return;
    initialSpeciesAppliedRef.current = true;
    setSelectedSpecies(findInitialSpecies(species, crop));
  }, [crop, open, species, speciesLoaded]);

  const missingRequiredFields = validationResult?.missing_required_fields ?? EMPTY_REQUIRED_FIELDS;
  const duplicates = validationResult?.duplicates ?? EMPTY_DUPLICATES;
  const licenseAccepted = termsAlreadyAccepted || acceptedLicense;
  const hasVisibleValidationIssues = missingRequiredFields.length > 0 || duplicates.length > 0;
  const isUpdatingOwnedPublicCrop = Boolean(
    selectedPublicCrop && selectedPublicCrop.id === ownedPublicCropId,
  );
  const comparison = useMemo(
    () => ((isUpdatingOwnedPublicCrop || showLinkConfirmation) && crop && selectedPublicCrop
      ? buildPublicCropComparison(crop, selectedPublicCrop, t, { publishAsGeneral: isCropLevelPublish })
      : null),
    [isUpdatingOwnedPublicCrop, showLinkConfirmation, crop, isCropLevelPublish, selectedPublicCrop, t],
  );
  const isBlockedByValidation = !isUpdatingOwnedPublicCrop
    && !selectedPublicCrop
    && validationResult !== null
    && !validationResult.can_publish;
  const existingVarietyOptions = publicCropOptions.filter((option) => (option.variety || '').trim());
  const varietyCandidates = useMemo(
    () => buildPublishVarietyCandidates(publishableVarieties, publicCropOptions),
    [publicCropOptions, publishableVarieties],
  );
  // Co-publishing Sorten belongs to the initial publication of a Kultur; an
  // update of an already-published entry keeps its existing scope.
  const showVarietySelection = !isOwnedPublicCropUpdate && varietyCandidates.length > 0;
  // Nothing may be published while the entries the Sorten are compared against
  // are still on their way — until then "no conflict" only means "not known yet".
  const varietyConflictsPending = showVarietySelection && Boolean(selectedSpecies) && !varietyLookupSettled;
  const selectedVarieties = useMemo<PublishVarietySelection[]>(
    () => (showVarietySelection
      ? varietyCandidates
        .filter((candidate) => !deselectedVarietyIds.has(candidate.cropId))
        .map((candidate) => ({
          cropId: candidate.cropId,
          publicCropId: candidate.existingPublicCrop?.id ?? null,
        }))
      : []),
    [deselectedVarietyIds, showVarietySelection, varietyCandidates],
  );
  const toggleVariety = useCallback((cropId: number) => {
    setDeselectedVarietyIds((previous) => {
      const next = new Set(previous);
      if (next.has(cropId)) {
        next.delete(cropId);
      } else {
        next.add(cropId);
      }
      return next;
    });
  }, []);
  const isProposingNewSpecies = Boolean(pendingSpeciesProposalName) && !isUpdatingOwnedPublicCrop;
  const shouldShowProposedSpeciesNotice = Boolean(proposedSpeciesName) && !validationLoading && !isBlockedByValidation;

  const resetValidationResult = useCallback(() => {
    setValidationResult(null);
  }, []);

  const handleSpeciesChange = useCallback((value: CropSpecies | null) => {
    setSelectedSpecies(value);
    setSelectedPublicCrop(null);
    setProposedSpeciesName(null);
    resetValidationResult();
  }, [resetValidationResult]);

  // Only entering propose mode resets the wizard's species-derived state:
  // the picker also reports `null` on every keystroke, which must not keep
  // wiping the validation result while the user is still typing.
  const handleSpeciesProposalNameChange = useCallback((name: string | null) => {
    setPendingSpeciesProposalName(name);
    if (!name) return;
    setSelectedSpecies(null);
    setSelectedPublicCrop(null);
    setProposedSpeciesName(null);
    resetValidationResult();
  }, [resetValidationResult]);

  const handleSpeciesInputChange = useCallback((value: string) => {
    setProposeSpeciesError('');
    setSpeciesInputValue(value);
  }, []);

  const handleProposeSpecies = useCallback(async (name: string): Promise<CropSpecies | null> => {
    const trimmedName = name.trim();
    if (!trimmedName) return null;
    setProposingSpecies(true);
    setProposeSpeciesError('');
    try {
      const response = await cropSpeciesAPI.propose(trimmedName, originalLanguageCode);
      const created = response.data;
      // Make the pending species immediately usable for this publish attempt
      // instead of leaving the user stuck until a moderator reviews it — the
      // backend accepts `proposed` species as a publish target (see
      // resolve_publishing_crop_species), and the variety becomes fully
      // official automatically once the species is approved.
      addSpecies(created);
      setSelectedSpecies(created);
      setSpeciesInputValue(getCropSpeciesOptionLabel(created));
      setSelectedPublicCrop(null);
      setPendingSpeciesProposalName(null);
      resetValidationResult();
      setProposedSpeciesName(getCropSpeciesOptionLabel(created));
      return created;
    } catch (error) {
      setProposeSpeciesError(extractApiErrorMessage(error, t, t('library.publishWizard.proposeSpeciesError')));
      return null;
    } finally {
      setProposingSpecies(false);
    }
  }, [addSpecies, originalLanguageCode, resetValidationResult, t]);

  // Shared with the link-confirmation flow's "back to warning" path, which
  // re-runs this after a rejected link so a withdrawn candidate disappears.
  const runPublishPreview = useCallback(async (
    cropSpeciesId: number,
  ): Promise<PublishPublicCropPreview | null> => {
    if (!crop?.id) return null;
    setValidationLoading(true);
    try {
      const response = await cropAPI.publishPreview(crop.id, {
        crop_species_id: cropSpeciesId,
        original_language_code: originalLanguageCode,
        ...(isCropLevelPublish ? { publish_as_general: true } : {}),
      });
      setValidationResult(response.data);
      return response.data;
    } catch (error) {
      console.error('Error checking publishing readiness:', error);
      return null;
    } finally {
      setValidationLoading(false);
    }
  }, [crop, isCropLevelPublish, originalLanguageCode]);

  const handleLinkDuplicate = useCallback(async (candidate: PublicCropDuplicateCandidate) => {
    setLinkConfirmError('');
    setLinkConfirmLoadingId(candidate.id);
    try {
      const response = await publicCropAPI.get(candidate.id);
      setSelectedPublicCrop(response.data);
      setShowLinkConfirmation(true);
    } catch (error) {
      setLinkConfirmError(extractApiErrorMessage(error, t, t('library.publishWizard.linkConfirm.loadError')));
    } finally {
      setLinkConfirmLoadingId(null);
    }
  }, [t]);

  const handleCancelLinkConfirmation = useCallback(() => {
    setShowLinkConfirmation(false);
    setSelectedPublicCrop(null);
    setLinkConfirmError('');
    setShowLicenseConfirmation(false);
  }, []);

  const handleConfirmLink = useCallback(async () => {
    if (!crop?.id || !selectedPublicCrop) return;
    // Linking needs no license acceptance, but a Sorte published along with
    // it does — without it the backend rejects every one of them with
    // `public_library_terms_required`.
    const publishesNewVarieties = selectedVarieties.some((variety) => !variety.publicCropId);
    const needsLicense = publishesNewVarieties && !termsAlreadyAccepted;
    if (needsLicense && (!showLicenseConfirmation || !acceptedLicense)) {
      setShowLicenseConfirmation(true);
      return;
    }
    setLinkConfirmError('');
    setLinkConfirmSubmitting(true);
    const cropSpeciesIdForRefresh = selectedPublicCrop.crop_species ?? selectedSpecies?.id;
    try {
      const success = await onLinkPublicCrop({
        acceptedPublicLibraryTerms: needsLicense && acceptedLicense,
        cropSpeciesId: selectedPublicCrop.crop_species ?? undefined,
        originalLanguageCode,
        publicCropId: selectedPublicCrop.id,
        varieties: selectedVarieties,
      });
      if (!success) {
        // The candidate may have been withdrawn between preview and confirm —
        // return to the warning view with a refreshed duplicate list.
        setShowLinkConfirmation(false);
        setSelectedPublicCrop(null);
        setShowLicenseConfirmation(false);
        if (cropSpeciesIdForRefresh) {
          void runPublishPreview(cropSpeciesIdForRefresh);
        }
      }
    } finally {
      setLinkConfirmSubmitting(false);
    }
  }, [
    acceptedLicense,
    crop,
    onLinkPublicCrop,
    originalLanguageCode,
    runPublishPreview,
    selectedPublicCrop,
    selectedSpecies,
    selectedVarieties,
    showLicenseConfirmation,
    termsAlreadyAccepted,
  ]);

  const handlePublish = useCallback(async () => {
    if (!crop?.id) return;
    if (selectedPublicCrop && !isUpdatingOwnedPublicCrop) {
      // Linking needs no license acceptance, but a Sorte published along with
      // it does — without it the backend rejects every one of them with
      // `public_library_terms_required`.
      const publishesNewVarieties = selectedVarieties.some((variety) => !variety.publicCropId);
      const needsLicense = publishesNewVarieties && !termsAlreadyAccepted;
      if (needsLicense && (!showLicenseConfirmation || !acceptedLicense)) {
        setShowLicenseConfirmation(true);
        return;
      }
      onPublish({
        acceptedPublicLibraryTerms: needsLicense && acceptedLicense,
        cropSpeciesId: selectedPublicCrop.crop_species ?? undefined,
        originalLanguageCode,
        publicCropId: selectedPublicCrop.id,
        varieties: selectedVarieties,
      });
      return;
    }
    // The species proposal is submitted here rather than when the dropdown
    // entry was picked, so "Kulturart vorschlagen" is one deliberate action
    // that both files the proposal and publishes the variety under it.
    let proposedSpecies: CropSpecies | null = null;
    if (pendingSpeciesProposalName && !isUpdatingOwnedPublicCrop) {
      proposedSpecies = await handleProposeSpecies(pendingSpeciesProposalName);
      if (!proposedSpecies) {
        speciesInputRef.current?.focus();
        return;
      }
    }
    const cropSpeciesId = isUpdatingOwnedPublicCrop
      ? selectedPublicCrop?.crop_species
      : proposedSpecies?.id ?? selectedSpecies?.id;
    if (!cropSpeciesId) {
      speciesInputRef.current?.focus();
      return;
    }
    if (!originalLanguageCode) {
      languageInputRef.current?.focus();
      return;
    }
    const previewResult = await runPublishPreview(cropSpeciesId);
    if (!previewResult?.can_publish) return;

    if (!termsAlreadyAccepted && !showLicenseConfirmation) {
      setShowLicenseConfirmation(true);
      return;
    }
    if (!licenseAccepted) {
      setShowLicenseConfirmation(true);
      return;
    }

    onPublish({
      acceptedPublicLibraryTerms: !termsAlreadyAccepted && acceptedLicense,
      cropSpeciesId,
      originalLanguageCode,
      varieties: selectedVarieties,
      ...(isCropLevelPublish ? { publishAsGeneral: true } : {}),
    });
  }, [
    acceptedLicense,
    crop,
    handleProposeSpecies,
    isCropLevelPublish,
    licenseAccepted,
    onPublish,
    originalLanguageCode,
    pendingSpeciesProposalName,
    runPublishPreview,
    selectedPublicCrop,
    selectedSpecies,
    selectedVarieties,
    showLicenseConfirmation,
    termsAlreadyAccepted,
    isUpdatingOwnedPublicCrop,
  ]);

  // Shared between the ordinary flow and the link-confirmation view — only
  // the comparison box's header and "no changes" wording differ, since the
  // confirmation view already carries its own heading and intro sentence.
  const comparisonBox = comparison ? (
    <Box
      aria-label={t('library.publishWizard.comparison.ariaLabel')}
      sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}
    >
      {showLinkConfirmation ? null : (
        <Box sx={{ px: 2, py: 1.5, bgcolor: 'action.hover' }}>
          <Typography variant="subtitle2">{t('library.publishWizard.comparison.title')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('library.publishWizard.comparison.description')}
          </Typography>
        </Box>
      )}
      {comparison.length ? (
        <Box component="dl" sx={{ m: 0 }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'minmax(8rem, 0.8fr) 1fr 1fr' },
              gap: { xs: 0.5, sm: 1.5 },
              px: 2,
              py: 1,
              borderTop: showLinkConfirmation ? 0 : '1px solid',
              borderColor: 'divider',
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }} />
            <Typography variant="caption" color="text.secondary">{t('library.publishWizard.comparison.publicValue')}</Typography>
            <Typography variant="caption" color="text.secondary">{t('library.publishWizard.comparison.privateValue')}</Typography>
          </Box>
          {comparison.map((change) => (
            <Box
              key={change.field}
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'minmax(8rem, 0.8fr) 1fr 1fr' },
                gap: { xs: 0.5, sm: 1.5 },
                px: 2,
                py: 1,
                borderTop: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Typography component="dt" variant="body2" sx={{ fontWeight: 600, }} >{change.label}</Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0, color: 'text.secondary' }}>{change.publicValue}</Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0 }}>{change.privateValue}</Typography>
            </Box>
          ))}
        </Box>
      ) : (
        <Alert severity="info" sx={{ borderRadius: 0 }}>
          {t(showLinkConfirmation ? 'library.publishWizard.linkConfirm.noChanges' : 'library.publishWizard.comparison.noChanges')}
        </Alert>
      )}
    </Box>
  ) : null;

  const varietySelectionBox = showVarietySelection ? (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, px: 2, py: 1.5 }}>
      <Typography variant="subtitle2">
        {t('library.publishWizard.varieties.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('library.publishWizard.varieties.description')}
      </Typography>
      {varietyConflictsPending ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 0.5 }}>
          <CircularProgress color="inherit" size={14} />
          <Typography variant="caption" color="text.secondary">
            {t('library.publishWizard.varieties.checking')}
          </Typography>
        </Stack>
      ) : null}
      {varietyLookupFailed ? (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {t('library.publishWizard.varieties.checkFailed')}
        </Alert>
      ) : null}
      <FormGroup sx={{ mt: 0.5 }}>
        {varietyCandidates.map((candidate) => (
          <FormControlLabel
            key={candidate.cropId}
            control={(
              <Checkbox
                size="small"
                checked={!deselectedVarietyIds.has(candidate.cropId)}
                onChange={() => toggleVariety(candidate.cropId)}
              />
            )}
            // The hint sits inside the label so it stays with its own Sorte
            // when it wraps to a second line on narrow screens, and so the
            // checkbox announces it too.
            label={(
              <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span>{candidate.label}</span>
                {candidate.existingPublicCrop ? (
                  <Typography variant="caption" color="text.secondary">
                    {t('library.publishWizard.varieties.alreadyPublic')}
                  </Typography>
                ) : null}
              </Stack>
            )}
          />
        ))}
      </FormGroup>
    </Box>
  ) : null;

  const licenseBox = showLicenseConfirmation && !termsAlreadyAccepted ? (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
      <FormControlLabel
        control={<Checkbox checked={acceptedLicense} onChange={(event) => setAcceptedLicense(event.target.checked)} />}
        label={t('library.publishConfirm.acceptLicense')}
      />
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {t('library.publishConfirm.linkPrefix')}
        <Link component={RouterLink} to="/datenschutz" target="_blank" rel="noopener">{t('library.publishConfirm.privacyLinkLabel')}</Link>
        {t('library.publishConfirm.linkMiddle')}
        <Link component={RouterLink} to="/nutzungsbedingungen" target="_blank" rel="noopener">{t('library.publishConfirm.termsLinkLabel')}</Link>
        {t('library.publishConfirm.linkSuffix')}
      </Typography>
    </Box>
  ) : null;

  if (showLinkConfirmation && selectedPublicCrop) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>{t('library.publishWizard.title')}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.25} sx={{ pt: 0.5 }}>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                {t('library.publishWizard.linkConfirm.heading')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {t('library.publishWizard.linkConfirm.description', {
                  localName: crop?.name ?? '',
                  publicName: getPublicCropOptionLabel(selectedPublicCrop),
                })}
              </Typography>
            </Box>

            {comparisonBox}

            <Alert severity="warning">{t('library.publishWizard.linkConfirm.irreversible')}</Alert>

            {varietySelectionBox}

            {linkConfirmError ? <Alert severity="error">{linkConfirmError}</Alert> : null}

            {licenseBox}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={handleCancelLinkConfirmation} variant="outlined">
            {t('library.publishWizard.linkConfirm.back')}
          </Button>
          <Button
            onClick={() => void handleConfirmLink()}
            variant="contained"
            disabled={
              linkConfirmSubmitting
              || publishing
              || (showLicenseConfirmation && !termsAlreadyAccepted && !acceptedLicense)
            }
          >
            {linkConfirmSubmitting || publishing
              ? t('library.publishing')
              : selectedVarieties.length > 0
                ? t('library.publishWizard.linkConfirm.submitWithVarieties')
                : t('library.publishWizard.linkConfirm.submit')}
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('library.publishWizard.title')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={isOwnedPublicCropUpdate ? 1.5 : 2.25} sx={{ pt: 0.5 }}>
          {isOwnedPublicCropUpdate ? (
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {t('library.publishWizard.updateHeading', {
                name: selectedPublicCrop ? getPublicCropOptionLabel(selectedPublicCrop) : publicCropInput,
              })}
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t(
                isCropLevelPublish
                  ? (showVarietySelection
                    ? 'library.publishWizard.introGeneralWithVarieties'
                    : 'library.publishWizard.introGeneral')
                  : 'library.publishWizard.intro',
                { name: crop?.name ?? '' },
              )}
            </Typography>
          )}

          <Stack spacing={2}>
            {isOwnedPublicCropUpdate ? null : (
              <>
                <CropSpeciesPicker
                  species={species}
                  loading={speciesLoading}
                  value={selectedSpecies}
                  onChange={handleSpeciesChange}
                  inputValue={speciesInputValue}
                  onInputValueChange={handleSpeciesInputChange}
                  proposalName={pendingSpeciesProposalName}
                  onProposalNameChange={handleSpeciesProposalNameChange}
                  proposing={proposingSpecies}
                  errorText={proposeSpeciesError}
                  inputRef={speciesInputRef}
                  required
                />

                {varietySelectionBox}

                {isCropLevelPublish ? null : (
                  <Autocomplete
                    options={existingVarietyOptions}
                    value={selectedPublicCrop}
                    inputValue={existingVarietyInputValue}
                    loading={publicCropLoading}
                    getOptionLabel={getExistingVarietyOptionLabel}
                    isOptionEqualToValue={(option, value) => option.id === value.id}
                    filterOptions={(options) => options}
                    onChange={(_, value) => {
                      setSelectedPublicCrop(value);
                      setExistingVarietyInputValue(value ? getExistingVarietyOptionLabel(value) : '');
                      resetValidationResult();
                    }}
                    onInputChange={(_, value, reason) => {
                      if (reason === 'reset') return;
                      setExistingVarietyInputValue(value);
                    }}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label={t('library.publishWizard.existingVarietyLabel')}
                        helperText={crop?.variety?.trim()
                          ? t('library.publishWizard.existingVarietyHelp')
                          : t('library.publishWizard.publicCropHelp')}
                        slotProps={{
                          ...params.slotProps,

                          input: {
                            ...params.slotProps.input,
                            endAdornment: (
                              <>
                                {publicCropLoading ? <CircularProgress color="inherit" size={20} /> : null}
                                {params.slotProps.input.endAdornment}
                              </>
                            ),
                          }
                        }}
                      />
                    )}
                  />
                )}
              </>
            )}

            {comparisonBox}

            {!isOwnedPublicCropUpdate ? (
              showLanguageOverride ? (
                <FormControl fullWidth>
                  <InputLabel id="publishing-original-language-label">{t('library.publishWizard.originalLanguageLabel')}</InputLabel>
                  <Select
                    labelId="publishing-original-language-label"
                    label={t('library.publishWizard.originalLanguageLabel')}
                    value={originalLanguageCode}
                    inputRef={languageInputRef}
                    onChange={(event) => {
                      setOriginalLanguageCode(event.target.value);
                      resetValidationResult();
                    }}
                  >
                    {LANGUAGE_CODES.map((code) => (
                      <MenuItem key={code} value={code}>{getLanguageDisplayName(code, i18n.resolvedLanguage ?? i18n.language)}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              ) : (
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", }} >
                  <Typography variant="body2" color="text.secondary">
                    {t('library.publishWizard.originalLanguageSummary', {
                      language: getLanguageDisplayName(originalLanguageCode, i18n.resolvedLanguage ?? i18n.language),
                    })}
                  </Typography>
                  <Button size="small" onClick={() => setShowLanguageOverride(true)}>
                    {t('library.publishWizard.changeLanguageLink')}
                  </Button>
                </Stack>
              )
            ) : null}
          </Stack>

          {shouldShowProposedSpeciesNotice ? (
            <Alert severity="success" onClose={() => setProposedSpeciesName(null)}>
              {t('library.publishWizard.proposedSpeciesNotice', { name: proposedSpeciesName })}
            </Alert>
          ) : null}

          {validationResult?.general_crop_notice && !generalNoticeDismissed ? (
            <Alert severity="info" onClose={() => setGeneralNoticeDismissed(true)}>
              {t(
                validationResult.general_crop_notice.is_stale
                  ? 'library.publishWizard.generalCropNoticeStale'
                  : 'library.publishWizard.generalCropNoticeIncomplete',
                { name: selectedSpecies?.name ?? '' },
              )}
              {' '}
              <Link
                component={RouterLink}
                to={`/app/crop-library?cropId=${validationResult.general_crop_notice.public_crop_id}`}
                target="_blank"
                rel="noopener"
              >
                {t('library.publishWizard.generalCropNoticeLink')}
              </Link>
            </Alert>
          ) : null}

          {hasVisibleValidationIssues ? (
            <Stack spacing={1}>
              {missingRequiredFields.length ? (
                <Alert severity="warning">
                  {t('library.publishWizard.requiredFieldsBlocking', {
                    fields: missingRequiredFields.map((item) => t(item.label_key)).join(', '),
                  })}
                </Alert>
              ) : null}
              {duplicates.length ? (
                <Alert severity="warning">
                  <Typography variant="body2">
                    {t('library.publishWizard.duplicateBlockingIntro')}
                  </Typography>
                  <Typography variant="body2" sx={{ mb: 0.5 }}>
                    {t('library.publishWizard.duplicateBlockingLinkHint')}
                  </Typography>
                  <Stack component="ul" sx={{ m: 0, pl: 2.5 }} spacing={0.5}>
                    {duplicates.map((item) => (
                      <Stack component="li" key={item.id} spacing={0.25} sx={{ display: 'list-item' }}>
                        <Typography variant="body2">
                          {item.variety ? `${item.name} (${item.variety})` : item.name}
                        </Typography>
                        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                          <Link component={RouterLink} to={`/app/crop-library?cropId=${item.id}`} target="_blank" rel="noopener">
                            {t('library.publishWizard.duplicateViewLink')}
                          </Link>
                          <Button
                            size="small"
                            onClick={() => void handleLinkDuplicate(item)}
                            disabled={linkConfirmLoadingId !== null}
                          >
                            {linkConfirmLoadingId === item.id
                              ? t('library.publishing')
                              : t('library.publishWizard.duplicateLinkAction')}
                          </Button>
                        </Stack>
                      </Stack>
                    ))}
                  </Stack>
                </Alert>
              ) : null}
              {linkConfirmError ? <Alert severity="error">{linkConfirmError}</Alert> : null}
            </Stack>
          ) : null}

          {licenseBox}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, flexWrap: 'wrap', gap: 1 }}>
        {/* Explains, right where the decision is made, that pressing the button
            files a proposal *and* publishes the variety provisionally. */}
        {isProposingNewSpecies ? (
          <Typography variant="body2" color="text.secondary" sx={{ flexBasis: '100%', mb: 0.5 }}>
            {t('library.publishWizard.proposeSpeciesPublishHint', { name: pendingSpeciesProposalName })}
          </Typography>
        ) : null}
        <Button onClick={onClose} variant="outlined">{t('common:actions.cancel')}</Button>
        <AppTooltip
          title={isBlockedByValidation ? t('library.publishWizard.resolveBlockingIssuesTooltip') : ''}
          disableHoverListener={!isBlockedByValidation}
        >
          <span>
          <Button
            onClick={() => void handlePublish()}
            variant="contained"
            disabled={
              (isUpdatingOwnedPublicCrop
                ? !selectedPublicCrop?.crop_species
                : !selectedSpecies && !isProposingNewSpecies)
              || !originalLanguageCode
              || publishing
              || validationLoading
              || proposingSpecies
              || varietyConflictsPending
              || isBlockedByValidation
              || (isUpdatingOwnedPublicCrop && comparison?.length === 0)
              || (showLicenseConfirmation && !termsAlreadyAccepted && !acceptedLicense)
            }
          >
            {publishing || validationLoading || proposingSpecies
              ? t('library.publishing')
              : isBlockedByValidation
                ? t('library.publishWizard.resolveBlockingIssues')
                : isUpdatingOwnedPublicCrop
                  ? t('library.publishWizard.updateExisting')
                  : isProposingNewSpecies
                    ? t('library.publishWizard.proposeSpeciesSubmit')
                    : selectedPublicCrop
                      ? t('library.publishWizard.linkExisting')
                      : t('library.publishWizard.publishNow')}
          </Button>
          </span>
        </AppTooltip>
      </DialogActions>
    </Dialog>
  );
}
