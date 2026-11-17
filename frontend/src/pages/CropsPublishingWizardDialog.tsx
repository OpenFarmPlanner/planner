import type { PublicCropSyncSubmitResult } from '../crops/publicCropSync';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  type AutocompleteInputChangeReason,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  Link,
  Stack,
  Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router';
import { PublicLibraryTermsConsent } from '../crops/PublicLibraryTermsConsent';
import { AppTooltip } from '../components/AppTooltip';
import { cropSpeciesAPI, cropAPI, publicCropAPI, type Crop } from '../api/api';
import type {
  CropSpecies,
  StagedPlantHealthMapping,
  PublicCrop,
  PublicCropDuplicateCandidate,
  PublishBlockingReason,
  PublishPublicCropPreview,
} from '../api/types';
import { extractApiErrorMessage } from '../api/errors';
import { useTranslation } from '../i18n';
import { FALLBACK_LANGUAGE, normalizeLanguageTag } from '../i18n/languages';
import { PublicCropSyncPanel } from '../crops/PublicCropSyncPanel';
import { usePublicCropSyncPreview } from '../crops/usePublicCropSyncPreview';
import { DisabledActionTooltip } from '../components/DisabledActionTooltip';
import {
  buildPublishVarietyCandidates,
  getPublishableVarieties,
  type PublishVarietySelection,
} from '../crops/publishVarieties';
import { CropSpeciesPicker } from '../crops/CropSpeciesPicker';
import { PlantHealthPublicationPanel } from '../crops/PlantHealthPublicationPanel';
import { describePublishBlockingReasons } from '../crops/publishChecks';
import { useCropSpeciesSearch } from '../crops/useCropSpeciesSearch';
import {
  getCropSpeciesOptionLabel,
  getCropSpeciesResultLabel,
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
  projectCrops?: Crop[];
  termsAlreadyAccepted: boolean;
  publishing: boolean;
  onClose: () => void;
  onCropMapped?: (crop: Crop) => void;
  onPublish: (data: {
    acceptedPublicLibraryTerms: boolean;
    cropSpeciesId?: number;
    originalLanguageCode: string;
    publicCropId?: number | null;
    publishAsGeneral?: boolean;
    varieties?: PublishVarietySelection[];
    healthMappings?: StagedPlantHealthMapping[];
    cropUpdatedAt?: string;
  }) => void | Promise<boolean>;
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
    /** The entry version the per-field choice was made against. */
    baseVersion: number;
    cropUpdatedAt?: string;
    /** Fields that take the entry's value, applied together with the link. */
    pullFields: string[];
    pinFields?: string[];
    /** Legacy payload field; initial linking always sends an empty list. */
    pushFields: string[];
    varieties?: PublishVarietySelection[];
    healthMappings?: StagedPlantHealthMapping[];
  }) => Promise<boolean>;
  /**
   * Syncs an already linked crop with its entry ("Mit Kulturbibliothek
   * abgleichen"). Awaited like `onLinkPublicCrop`: on failure the dialog
   * stays open with its decisions; stale library versions reload the differences.
   */
  onSyncPublicCrop: (data: {
    acceptedPublicLibraryTerms: boolean;
    publicCropId: number;
    baseVersion: number;
    pullFields: string[];
    pushFields: string[];
    /** Fields kept locally ("Nur lokal"). */
    pinFields: string[];
    healthMappings?: StagedPlantHealthMapping[];
    cropUpdatedAt?: string;
  }) => Promise<PublicCropSyncSubmitResult>;
}

const EMPTY_REQUIRED_FIELDS: PublishPublicCropPreview['missing_required_fields'] = [];
const EMPTY_DUPLICATES: PublishPublicCropPreview['duplicates'] = [];
const EMPTY_VARIETIES: Crop[] = [];
const DETAILED_BLOCKING_REASONS: ReadonlySet<PublishBlockingReason> = new Set(['missing_required_fields', 'duplicates']);

const getPublicCropOptionLabel = (option: PublicCrop): string => {
  const name = option.display_name || option.crop_species_name || option.name;
  return option.variety ? `${name} · ${option.variety}` : name;
};

export function CropsPublishingWizardDialog({
  open,
  crop,
  varieties = EMPTY_VARIETIES,
  projectCrops = EMPTY_VARIETIES,
  termsAlreadyAccepted,
  publishing,
  onClose,
  onPublish,
  onLinkPublicCrop,
  onSyncPublicCrop,
}: CropsPublishingWizardDialogProps) {
  const { t, i18n } = useTranslation(['crops', 'common']);
  const originalLanguageCode = normalizeLanguageTag(i18n.resolvedLanguage ?? i18n.language) ?? FALLBACK_LANGUAGE;
  const [selectedSpecies, setSelectedSpecies] = useState<CropSpecies | null>(null);
  const [publicCropOptions, setPublicCropOptions] = useState<PublicCrop[]>([]);
  const [selectedPublicCrop, setSelectedPublicCrop] = useState<PublicCrop | null>(null);
  const [publicCropInput, setPublicCropInput] = useState('');
  const [manualSpeciesChoice, setManualSpeciesChoice] = useState(false);
  const [entryLookupKey, setEntryLookupKey] = useState('');
  const [entryLookupRetry, setEntryLookupRetry] = useState(0);
  const [acceptedLicense, setAcceptedLicense] = useState(false);
  const [validationResult, setValidationResult] = useState<PublishPublicCropPreview | null>(null);
  const [validationLoading, setValidationLoading] = useState(false);
  const [healthMappingBusy, setHealthMappingBusy] = useState(false);
  const [healthMappings, setHealthMappings] = useState<StagedPlantHealthMapping[]>([]);
  const [showLicenseConfirmation, setShowLicenseConfirmation] = useState(false);
  const [speciesInputValue, setSpeciesInputValue] = useState(crop?.name ?? '');
  // What the species field searches for. Follows the user's typing only:
  // picking an option writes its label into the field, and searching for
  // that label would replace the list the user just picked from.
  const [speciesSearchQuery, setSpeciesSearchQuery] = useState(crop?.name ?? '');
  const [proposedSpeciesName, setProposedSpeciesName] = useState<string | null>(null);
  // Set while the user picked "propose this as a new species" but nothing has
  // been sent yet — the dialog's main button submits it (see handlePublish).
  const [pendingSpeciesProposalName, setPendingSpeciesProposalName] = useState<string | null>(null);
  const [proposingSpecies, setProposingSpecies] = useState(false);
  const [proposeSpeciesError, setProposeSpeciesError] = useState('');
  const [generalNoticeDismissed, setGeneralNoticeDismissed] = useState(false);
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
  const [syncSubmitting, setSyncSubmitting] = useState(false);
  const [syncError, setSyncError] = useState('');
  const ownedPublicCropId = crop?.owned_public_crop_id ?? null;
  // A crop connected to an entry (its own, or one it was imported from or
  // linked to) is not published again: the wizard becomes the field-by-field
  // sync with that entry ("Mit Kulturbibliothek abgleichen").
  const linkedPublicCropId = ownedPublicCropId ?? crop?.source_public_crop ?? null;
  const isSyncFlow = Boolean(linkedPublicCropId);
  const {
    results: speciesSearchResults,
    loading: speciesLoading,
    hasMore: speciesSearchHasMore,
  } = useCropSpeciesSearch(speciesSearchQuery, open && !isSyncFlow);
  // A species the user just proposed is `status=proposed`, so a non-moderator's
  // own search never finds it again (the search endpoint only surfaces
  // published species to non-moderators) — this keeps it selectable for the
  // rest of this publish attempt anyway, mirroring the old full-list picker's
  // `addSpecies`. Reset whenever the dialog reopens.
  const [proposedSpeciesOverride, setProposedSpeciesOverride] = useState<CropSpecies | null>(null);
  const species = useMemo(() => {
    if (!proposedSpeciesOverride) return speciesSearchResults;
    return speciesSearchResults.some((item) => item.id === proposedSpeciesOverride.id)
      ? speciesSearchResults
      : [proposedSpeciesOverride, ...speciesSearchResults];
  }, [proposedSpeciesOverride, speciesSearchResults]);
  const isCropLevelPublish = !crop?.variety?.trim();
  const publishableVarieties = useMemo(() => getPublishableVarieties(varieties), [varieties]);
  const automaticSpecies = useMemo(() => {
    if (manualSpeciesChoice || selectedSpecies || speciesLoading || isSyncFlow) return null;
    const assigned = speciesSearchResults.find((item) => item.id === crop?.crop_species && item.status === 'published');
    if (assigned) return assigned;
    if (speciesSearchHasMore || crop?.crop_species) return null;
    const name = normalizeCropSpeciesSearchValue(crop?.name);
    const matches = speciesSearchResults.filter((item) => item.status === 'published'
      && getCropSpeciesSearchNames(item).some((alias) => normalizeCropSpeciesSearchValue(alias) === name));
    return matches.length === 1 ? matches[0] : null;
  }, [crop?.crop_species, crop?.name, isSyncFlow, manualSpeciesChoice, selectedSpecies,
    speciesLoading, speciesSearchHasMore, speciesSearchResults]);
  const lookupSpecies = selectedSpecies ?? automaticSpecies;
  const entryRequestKey = JSON.stringify([crop?.id, crop?.updated_at, lookupSpecies?.id, crop?.variety, entryLookupRetry]);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setAcceptedLicense(false);
      setHealthMappings([]);
      setShowLicenseConfirmation(false);
      // Only a unique existing entry can bypass the picker. New publications
      // still require an explicit species choice and final confirmation.
      setSelectedSpecies(null);
      setManualSpeciesChoice(false);
      setEntryLookupKey('');
      setProposedSpeciesOverride(null);
      setSpeciesInputValue(crop?.name ?? '');
      setSpeciesSearchQuery(crop?.name ?? '');
      // Unless earlier health mappings need attention, focus opens the
      // picker with results for the crop's own name.
      setProposedSpeciesName(null);
      setPendingSpeciesProposalName(null);
      setProposeSpeciesError('');
      setGeneralNoticeDismissed(false);
      setValidationResult(null);
      setPublicCropInput(crop?.name ?? '');
      setSelectedPublicCrop(null);
      setDeselectedVarietyIds(new Set());
      setVarietyLookupSettled(false);
      setVarietyLookupFailed(false);
      setShowLinkConfirmation(false);
      setLinkConfirmLoadingId(null);
      setLinkConfirmError('');
      setLinkConfirmSubmitting(false);
      setSyncSubmitting(false);
      setSyncError('');
    });
  }, [crop?.id, crop?.name, crop?.variety, open]);

  useEffect(() => {
    if (!open || !linkedPublicCropId) return;
    let cancelled = false;
    publicCropAPI.get(linkedPublicCropId)
      .then((response) => {
        if (cancelled) return;
        setSelectedPublicCrop(response.data);
        setPublicCropInput(getPublicCropOptionLabel(response.data));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [linkedPublicCropId, open]);

  const mappingSourceId = crop?.plant_health == null && crop?.general_crop ? crop.general_crop : crop?.id;
  const currentHealthMappings = useMemo(() => healthMappings.filter(item => item.crop_id === mappingSourceId), [healthMappings, mappingSourceId]);
  const updateHealthMapping = useCallback((mapping: StagedPlantHealthMapping) => {
    setHealthMappings(previous => [...previous.filter(item => item.crop_id !== mapping.crop_id), ...(mapping.mappings.length ? [mapping] : [])]);
    setValidationResult(null);
  }, []);

  const syncPreview = usePublicCropSyncPreview(
    crop?.id,
    isSyncFlow ? linkedPublicCropId : selectedPublicCrop?.id,
    open && (isSyncFlow || (showLinkConfirmation && Boolean(selectedPublicCrop))),
    true,
    currentHealthMappings,
    crop?.updated_at,
  );

  useEffect(() => {
    // A crop-level publish has no variety field of its own, but its Sorten
    // still need the species' public entries to spot name conflicts.
    if (isSyncFlow) return undefined;
    if (!open) return undefined;
    const searchTerm = lookupSpecies?.name.trim() || crop?.name.trim() || '';
    if (!searchTerm) {
      queueMicrotask(() => setPublicCropOptions([]));
      return undefined;
    }
    // A species switch invalidates the previous species' entries, so the
    // Sorten must not be matched against them while the new list is loading.
    queueMicrotask(() => {
      setVarietyLookupSettled(false);
      setVarietyLookupFailed(false);
      setPublicCropOptions([]);
    });

    let cancelled = false;
    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => {
      const loadEntries = async () => {
        const entries: PublicCrop[] = [];
        for (let page = 1; ; page += 1) {
          const response = await publicCropAPI.list({
            ...(lookupSpecies || crop?.crop_species
              ? { crop_species: lookupSpecies?.id ?? crop?.crop_species ?? undefined }
              : { q: searchTerm }),
            page_size: 200,
            ...(page > 1 ? { page } : {}),
          }, abortController.signal);
          if (cancelled) return [];
          entries.push(...response.data.results);
          if (!response.data.next) return entries;
        }
      };
      loadEntries()
        .then((entries) => {
          if (cancelled) return;
          const filtered = entries.filter((entry) => (
            !lookupSpecies || entry.crop_species === lookupSpecies.id
          ));
          setPublicCropOptions(filtered);
          setVarietyLookupSettled(true);
          setEntryLookupKey(entryRequestKey);
          const variety = normalizeCropSpeciesSearchValue(crop?.variety);
          const matches = lookupSpecies ? filtered.filter((entry) => entry.status === 'published'
            && normalizeCropSpeciesSearchValue(entry.variety) === variety) : [];
          setSelectedPublicCrop(matches.length === 1 ? matches[0] : null);
        })
        .catch(() => {
          if (cancelled || abortController.signal.aborted) return;
          setPublicCropOptions([]);
          setVarietyLookupSettled(true);
          setVarietyLookupFailed(true);
          setSelectedPublicCrop(null);
          setEntryLookupKey(entryRequestKey);
        });
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [crop?.name, crop?.crop_species, crop?.variety, isSyncFlow, open, lookupSpecies, entryRequestKey]);

  useEffect(() => {
    if (!open || !automaticSpecies || !selectedPublicCrop || entryLookupKey !== entryRequestKey) return;
    queueMicrotask(() => {
      setManualSpeciesChoice(true);
      setSelectedSpecies(automaticSpecies);
      setSpeciesInputValue(getCropSpeciesResultLabel(automaticSpecies, originalLanguageCode).label);
      setShowLinkConfirmation(true);
    });
  }, [automaticSpecies, entryLookupKey, entryRequestKey, open, originalLanguageCode, selectedPublicCrop]);

  const entryLookupPending = Boolean(selectedSpecies) && entryLookupKey !== entryRequestKey;
  const entryLookupBlocked = Boolean(selectedSpecies) && (entryLookupPending || varietyLookupFailed);

  const missingRequiredFields = validationResult?.missing_required_fields ?? EMPTY_REQUIRED_FIELDS;
  const duplicates = validationResult?.duplicates ?? EMPTY_DUPLICATES;
  const licenseAccepted = termsAlreadyAccepted || acceptedLicense;
  const hasVisibleValidationIssues = missingRequiredFields.length > 0 || duplicates.length > 0;
  const isBlockedByValidation = !selectedPublicCrop
    && validationResult !== null
    && !validationResult.can_publish;
  // Missing fields and duplicates have their own detailed alerts below; any
  // other reason (e.g. a species rejected meanwhile) still has to be named.
  const otherBlockingMessages = useMemo(() => (
    isBlockedByValidation && validationResult
      ? describePublishBlockingReasons(
        validationResult,
        t,
        (validationResult.blocking_reasons ?? []).filter((reason) => !DETAILED_BLOCKING_REASONS.has(reason)),
      )
      : []
  ), [isBlockedByValidation, t, validationResult]);
  const varietyCandidates = useMemo(
    () => buildPublishVarietyCandidates(publishableVarieties, publicCropOptions),
    [publicCropOptions, publishableVarieties],
  );
  // Co-publishing Sorten belongs to the initial publication of a Kultur; a
  // sync with an already connected entry keeps its existing scope.
  const showVarietySelection = !isSyncFlow && varietyCandidates.length > 0;
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
          ...(healthMappings.some(mapping => mapping.crop_id === candidate.cropId) ? {
            healthMappings: healthMappings.filter(mapping => mapping.crop_id === candidate.cropId),
            cropUpdatedAt: candidate.crop.updated_at,
          } : {}),
        }))
      : []),
    [deselectedVarietyIds, showVarietySelection, varietyCandidates, healthMappings],
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
  const isProposingNewSpecies = Boolean(pendingSpeciesProposalName);
  const shouldShowProposedSpeciesNotice = Boolean(proposedSpeciesName) && !validationLoading && !isBlockedByValidation;

  const resetValidationResult = useCallback(() => {
    setValidationResult(null);
  }, []);

  const handleSpeciesChange = useCallback((value: CropSpecies | null) => {
    setManualSpeciesChoice(true);
    setSelectedSpecies(value);
    setEntryLookupRetry((retry) => retry + 1);
    setSelectedPublicCrop(null);
    setProposedSpeciesName(null);
    resetValidationResult();
  }, [resetValidationResult]);

  // Only entering propose mode resets the wizard's species-derived state:
  // the picker also reports `null` on every keystroke, which must not keep
  // wiping the validation result while the user is still typing.
  const handleSpeciesProposalNameChange = useCallback((name: string | null) => {
    setManualSpeciesChoice(true);
    setPendingSpeciesProposalName(name);
    if (!name) return;
    setSelectedSpecies(null);
    setSelectedPublicCrop(null);
    setProposedSpeciesName(null);
    resetValidationResult();
  }, [resetValidationResult]);

  const handleSpeciesInputChange = useCallback((value: string, reason?: AutocompleteInputChangeReason) => {
    if (reason === 'reset' && !value && !selectedSpecies) return;
    setProposeSpeciesError('');
    setSpeciesInputValue(value);
    if (reason === 'input' || reason === 'clear') {
      setManualSpeciesChoice(true);
      setSpeciesSearchQuery(value);
    }
  }, [selectedSpecies]);

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
      setProposedSpeciesOverride(created);
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
  }, [originalLanguageCode, resetValidationResult, t]);

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
        ...(currentHealthMappings.length ? { plant_health_mappings: currentHealthMappings, expected_updated_at: crop.updated_at } : {}),
      });
      setValidationResult(response.data);
      return response.data;
    } catch (error) {
      console.error('Error checking publishing readiness:', error);
      return null;
    } finally {
      setValidationLoading(false);
    }
  }, [crop, isCropLevelPublish, originalLanguageCode, currentHealthMappings]);

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
    setManualSpeciesChoice(true);
    if (validationResult?.duplicates.length) setSelectedPublicCrop(null);
    setLinkConfirmError('');
    setShowLicenseConfirmation(false);
  }, [validationResult]);

  const { selection: syncSelection } = syncPreview;
  const syncPreviewLoaded = syncPreview.preview !== null;

  const handleConfirmLink = useCallback(async () => {
    if (!crop?.id || !selectedPublicCrop || !syncPreview.preview) return;
    setLinkConfirmError('');
    setLinkConfirmSubmitting(true);
    const cropSpeciesIdForRefresh = selectedPublicCrop.crop_species ?? selectedSpecies?.id;
    try {
      const success = await onLinkPublicCrop({
        acceptedPublicLibraryTerms: false,
        cropSpeciesId: selectedPublicCrop.crop_species ?? undefined,
        originalLanguageCode,
        publicCropId: selectedPublicCrop.id,
        baseVersion: syncPreview.preview.public_version,
        cropUpdatedAt: syncPreview.preview.crop_updated_at,
        pullFields: syncPreview.preview.changes.filter((change) => syncPreview.choices[change.field] !== 'mine' && syncPreview.choices[change.field] !== 'local').map((change) => change.field),
        pushFields: [],
        pinFields: syncPreview.selection.pinFields,
        varieties: [],
        ...(currentHealthMappings.length ? { healthMappings: currentHealthMappings } : {}),
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
  }, [crop, onLinkPublicCrop, originalLanguageCode, runPublishPreview,
    selectedPublicCrop, selectedSpecies, syncPreview.preview, syncPreview.choices, syncPreview.selection.pinFields, currentHealthMappings]);

  const handleConfirmSync = useCallback(async () => {
    if (!crop?.id || !linkedPublicCropId || !syncPreview.preview) return;
    const needsLicense = syncSelection.pushFields.length > 0 && !termsAlreadyAccepted;
    if (needsLicense && (!showLicenseConfirmation || !acceptedLicense)) {
      setShowLicenseConfirmation(true);
      return;
    }
    setSyncSubmitting(true);
    setSyncError('');
    try {
      const result = await onSyncPublicCrop({
        acceptedPublicLibraryTerms: needsLicense && acceptedLicense,
        publicCropId: linkedPublicCropId,
        baseVersion: syncPreview.preview.public_version,
        pullFields: syncSelection.pullFields,
        pushFields: syncSelection.pushFields,
        pinFields: syncSelection.pinFields,
        ...(currentHealthMappings.length ? { healthMappings: currentHealthMappings, cropUpdatedAt: crop.updated_at } : {}),
      });
      if (!result.success) {
        setSyncError(result.error);
        if (result.code === 'stale_public_crop_version') syncPreview.reload();
      }
    } finally {
      setSyncSubmitting(false);
    }
  }, [
    acceptedLicense,
    crop,
    linkedPublicCropId,
    onSyncPublicCrop,
    showLicenseConfirmation,
    syncPreview,
    syncSelection,
    currentHealthMappings,
    termsAlreadyAccepted,
  ]);

  const handlePublish = useCallback(async () => {
    if (!crop?.id) return;
    if (selectedPublicCrop) {
      setShowLinkConfirmation(true);
      return;
    }
    // The species proposal is submitted here rather than when the dropdown
    // entry was picked, so "Kulturart vorschlagen" is one deliberate action
    // that both files the proposal and publishes the variety under it.
    let proposedSpecies: CropSpecies | null = null;
    if (pendingSpeciesProposalName) {
      proposedSpecies = await handleProposeSpecies(pendingSpeciesProposalName);
      if (!proposedSpecies) {
        speciesInputRef.current?.focus();
        return;
      }
    }
    const cropSpeciesId = proposedSpecies?.id ?? selectedSpecies?.id;
    if (!cropSpeciesId) {
      speciesInputRef.current?.focus();
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

    const success = await onPublish({
      acceptedPublicLibraryTerms: !termsAlreadyAccepted && acceptedLicense,
      cropSpeciesId,
      originalLanguageCode,
      varieties: selectedVarieties,
      ...(currentHealthMappings.length ? { healthMappings: currentHealthMappings, cropUpdatedAt: crop.updated_at } : {}),
      ...(isCropLevelPublish ? { publishAsGeneral: true } : {}),
    });
    if (success === false) setSyncError(t('library.publishError'));
  }, [
    acceptedLicense,
    crop,
    t,
    currentHealthMappings,
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
  ]);

  const syncPanel = (
    <PublicCropSyncPanel
      changes={syncPreview.preview?.changes.map((change) => isSyncFlow ? change : { ...change, pushable: true }) ?? null}
      choices={syncPreview.choices}
      onChoicesChange={syncPreview.setChoices}
      requiresModeration={Boolean(syncPreview.preview?.requires_moderation)}
      loadError={syncPreview.loadError}
      disabled={linkConfirmSubmitting || syncSubmitting || publishing}
      allowLocal
      keepMineLocally={!isSyncFlow}
    />
  );

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
    <PublicLibraryTermsConsent checked={acceptedLicense} onChange={setAcceptedLicense} />
  ) : null;

  const healthMappingCrops = crop ? [crop, ...varieties.filter(variety => selectedVarieties.some(item => item.cropId === variety.id)
    && !(variety.plant_health == null && variety.general_crop === crop.id))] : [];
  const hasOpenHealthMappings = healthMappingCrops.some(item => (
    (item.plant_health ?? item.effective_values?.plant_health)?.entries.some(entry => !entry.catalogue_identity)
  ));
  const healthMappingPanel = open && crop ? <>
    {healthMappingCrops.map(item => (
      <PlantHealthPublicationPanel key={item.id} crop={item}
        inheritedSource={projectCrops.find(source => source.id === item.general_crop)}
        onNavigate={onClose}
        disabled={healthMappingBusy || publishing || syncSubmitting || linkConfirmSubmitting}
        onBusyChange={setHealthMappingBusy}
        drafts={healthMappings} onChange={updateHealthMapping} />
    ))}
  </> : null;

  if (showLinkConfirmation && selectedPublicCrop) {
    return (
      <Dialog open={open} onClose={linkConfirmSubmitting || publishing || healthMappingBusy ? undefined : onClose} maxWidth="sm" fullWidth>
        <DialogTitle>{t('library.linkExisting.title')}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.25} sx={{ pt: 0.5 }}>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                {t('library.publishWizard.linkConfirm.heading')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {t('library.publishWizard.linkConfirm.description', {
                  local: crop?.name ?? '',
                  public: getPublicCropOptionLabel(selectedPublicCrop),
                })}
              </Typography>
            </Box>

            {healthMappingPanel}
            {syncPanel}

            <Alert severity="info">{t('library.linkExisting.inheritance')}</Alert>


            {linkConfirmError ? <Alert severity="error">{linkConfirmError}</Alert> : null}

          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={handleCancelLinkConfirmation} variant="outlined" disabled={linkConfirmSubmitting || publishing || healthMappingBusy}>
            {t('library.publishWizard.linkConfirm.back')}
          </Button>
          <Button onClick={onClose} variant="outlined" disabled={linkConfirmSubmitting || publishing || healthMappingBusy}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={() => void handleConfirmLink()}
            variant="contained"
            disabled={
              linkConfirmSubmitting
              || healthMappingBusy
              || publishing
              || !syncPreviewLoaded
              || (showLicenseConfirmation && !termsAlreadyAccepted && !acceptedLicense)
            }
          >
            {linkConfirmSubmitting || publishing
              ? t('library.publishing')
              : t('library.linkExisting.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    );
  }

  if (isSyncFlow) {
    const hasNoDifferences = syncPreview.preview !== null && syncPreview.preview.changes.length === 0;
    const syncDisabledReason = syncSubmitting || healthMappingBusy
      ? t('common:disabledReasons.busy')
      : hasNoDifferences && !currentHealthMappings.length
        ? t('library.sync.noChanges')
        : !syncPreviewLoaded
          ? t('library.sync.loading')
          : showLicenseConfirmation && !termsAlreadyAccepted && !acceptedLicense
            ? t('library.sync.acceptLicenseFirst')
            : '';
    return (
      <Dialog open={open} onClose={publishing || syncSubmitting || healthMappingBusy ? undefined : onClose} maxWidth="sm" fullWidth>
        <DialogTitle>{t('library.sync.dialogTitle')}</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2.25} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {t('library.sync.intro', {
                name: selectedPublicCrop ? getPublicCropOptionLabel(selectedPublicCrop) : publicCropInput,
              })}
            </Typography>

            {syncError ? <Alert severity="error">{syncError}</Alert> : null}
            {healthMappingPanel}
            {syncPanel}

            {licenseBox}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2, flexWrap: 'wrap', gap: 1 }}>
          <Button onClick={onClose} variant="outlined" disabled={publishing || syncSubmitting || healthMappingBusy}>{t('common:actions.cancel')}</Button>
          <DisabledActionTooltip title={syncDisabledReason}>
            <Button
              onClick={() => void handleConfirmSync()}
              variant="contained"
              disabled={Boolean(syncDisabledReason)}
            >
              {syncSubmitting ? t('library.sync.submitting') : t('library.sync.submit')}
            </Button>
          </DisabledActionTooltip>
        </DialogActions>
      </Dialog>
    );
  }

  const checkingAutomaticLink = !manualSpeciesChoice
    && (speciesLoading || (automaticSpecies && entryLookupKey !== entryRequestKey));
  if (checkingAutomaticLink) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>{t('library.publishWizard.title')}</DialogTitle>
        <DialogContent dividers>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }} role="status">
            <CircularProgress size={24} />
            <Typography>{t('common:messages.loading')}</Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} variant="outlined">{t('common:actions.cancel')}</Button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onClose={publishing || syncSubmitting || healthMappingBusy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('library.publishWizard.title')}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.25} sx={{ pt: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            {t('library.publishWizard.intro', { name: crop?.name ?? '' })}
          </Typography>

          {syncError ? <Alert severity="error">{syncError}</Alert> : null}
          {healthMappingPanel}
          <Stack spacing={2}>
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
              localCropName={crop?.name}
              errorText={proposeSpeciesError}
              inputRef={speciesInputRef}
              required
              serverSearched
              autoFocus={!hasOpenHealthMappings}
            />

            {varietySelectionBox}

            {selectedSpecies && varietyLookupFailed ? (
              <Alert severity="error" action={
                <Button color="inherit" onClick={() => setEntryLookupRetry((value) => value + 1)}>
                  {t('common:runtime.retryAction')}
                </Button>
              }>{t('library.publishWizard.entryLookupFailed')}</Alert>
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

          {validationResult?.unpublishable_companion_count ? (
            <Alert severity="info" data-testid="publish-unpublishable-companions">
              {t('companions.publishSkipped', { count: validationResult.unpublishable_companion_count })}
            </Alert>
          ) : null}
          {validationResult?.unpublishable_plant_health_count ? <Alert severity="info">
            {t('plantHealth.publishSkipped', { number: validationResult.unpublishable_plant_health_count })}
          </Alert> : null}

          {otherBlockingMessages.map((message) => (
            <Alert key={message} severity="warning">{message}</Alert>
          ))}

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
        <Button onClick={onClose} variant="outlined" disabled={publishing || syncSubmitting || healthMappingBusy}>{t('common:actions.cancel')}</Button>
        <AppTooltip
          title={isBlockedByValidation ? t('library.publishWizard.resolveBlockingIssuesTooltip') : ''}
          disableHoverListener={!isBlockedByValidation}
        >
          <span>
          <Button
            onClick={() => void handlePublish()}
            variant="contained"
            disabled={
              (!selectedSpecies && !isProposingNewSpecies)
              || publishing
              || validationLoading
              || healthMappingBusy
              || proposingSpecies
              || varietyConflictsPending
              || entryLookupBlocked
              || isBlockedByValidation
              || (showLicenseConfirmation && !termsAlreadyAccepted && !acceptedLicense)
            }
          >
            {publishing || validationLoading || proposingSpecies
              ? t('library.publishing')
              : isBlockedByValidation
                ? t('library.publishWizard.resolveBlockingIssues')
                : isProposingNewSpecies
                    ? t('library.publishWizard.proposeSpeciesSubmit')
                    : selectedPublicCrop
                      ? t('library.publishWizard.continueToComparison')
                      : t('library.publishWizard.publishNow')}
          </Button>
          </span>
        </AppTooltip>
      </DialogActions>
    </Dialog>
  );
}
