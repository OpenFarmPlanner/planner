import type { StagedPlantHealthMapping, VarietyParentPublicationDecision } from '../api/types';
import type { PublicCropSyncSubmitResult } from '../crops/publicCropSync';
import type { CropLinkCandidate } from '../crops/ExistingCropLinkDialog';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import axios from 'axios';
import { cropAPI, publicCropAPI } from '../api/api';
import type { Crop } from '../api/api';
import type { PublicCrop, PublishPublicCropDuplicateError } from '../api/types';
import { useTranslation } from '../i18n';
import { useAuth } from '../auth/useAuth';
import { extractApiErrorCode, extractApiErrorMessage } from '../api/errors';
import { dedupePublicCrops } from './publicCropUtils';
import { formatCropDisplayName } from '../crops/cropDisplay';
import { getPublicCropTitle } from '../crop-library/publicCropDisplay';
import type { PublishVarietySelection } from '../crops/publishVarieties';
import { describePublishChecksFailure, extractPublishChecks } from '../crops/publishChecks';
import { describeLibraryPinError } from '../crops/libraryFieldPin';
import { withProjectImportStatus } from '../crop-library/publicCropListMerge';

interface UsePublicCropLibraryConfig {
  shouldShowProjectRequiredState: boolean;
  selectedCrop: Crop | undefined;
  onImportSuccess: (crop: Crop) => Promise<void>;
  onPublicCropStatusChange?: () => Promise<void>;
  onClearForm: () => void;
  showSnackbar: (message: string, severity: 'success' | 'error' | 'info') => void;
}

const UNLINK_ERROR_CODES = ['crop_not_linked', 'crop_link_owned'];

export function usePublicCropLibrary({
  shouldShowProjectRequiredState,
  selectedCrop,
  onImportSuccess,
  onPublicCropStatusChange,
  onClearForm,
  showSnackbar,
}: UsePublicCropLibraryConfig) {
  const { t, i18n } = useTranslation(['crops', 'common']);
  const language = i18n.resolvedLanguage ?? i18n.language;
  const { refreshUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [varietyImport, setVarietyImport] = useState<PublicCrop | null>(null);
  const [importLink, setImportLink] = useState<{ publicCrop: PublicCrop; candidates: CropLinkCandidate[] } | null>(null);
  const [publicLibraryOpen, setPublicLibraryOpen] = useState(false);
  const [publicLibraryLoading, setPublicLibraryLoading] = useState(false);
  const [publicLibraryError, setPublicLibraryError] = useState<string | null>(null);
  const [publicCrops, setPublicCrops] = useState<PublicCrop[]>([]);
  const [publicLibraryImportingId, setPublicLibraryImportingId] = useState<number | null>(null);
  const [publicLibraryInitialSelectedId, setPublicLibraryInitialSelectedId] = useState<number | null>(null);
  const [publicLibraryInitialQuery, setPublicLibraryInitialQuery] = useState('');
  const [publishingCropId, setPublishingCropId] = useState<number | null>(null);
  const libraryRequestId = useRef(0);
  const importInFlight = useRef(false);
  const librarySearch = useRef<{ query: string; exactMatch?: { name: string; variety?: string } }>({ query: '' });

  const fetchPublicCrops = useCallback(async (
    query = '',
    exactMatch?: { name: string; variety?: string },
  ) => {
    const requestId = ++libraryRequestId.current;
    librarySearch.current = { query, exactMatch };
    try {
      setPublicLibraryLoading(true);
      setPublicLibraryError(null);
      const params = exactMatch
        ? { name: exactMatch.name, variety: exactMatch.variety || '' }
        : query ? { q: query } : undefined;
      const { results } = await publicCropAPI.listAll(params);
      if (requestId !== libraryRequestId.current) return;
      setPublicCrops(dedupePublicCrops(results));
    } catch (error) {
      if (requestId !== libraryRequestId.current) return;
      console.error('Error fetching public crops:', error);
      setPublicLibraryError(t('library.loadError'));
    } finally {
      if (requestId === libraryRequestId.current) setPublicLibraryLoading(false);
    }
  }, [t]);

  const handleOpenPublicLibrary = useCallback(async () => {
    setPublicLibraryInitialSelectedId(null);
    setPublicLibraryInitialQuery('');
    setPublicLibraryOpen(true);
    await fetchPublicCrops();
  }, [fetchPublicCrops]);

  const handleViewPublicLibraryMatch = useCallback(async (match: Pick<PublicCrop, 'id' | 'name' | 'variety'>) => {
    onClearForm();
    setPublicLibraryInitialSelectedId(match.id);
    setPublicLibraryInitialQuery(`${match.name} ${match.variety || ''}`.trim());
    setPublicLibraryOpen(true);
    await fetchPublicCrops('', { name: match.name, variety: match.variety });
  }, [fetchPublicCrops, onClearForm]);

  const markProjectImport = useCallback((publicCropId: number, crop: Crop) => {
    ++libraryRequestId.current;
    setPublicLibraryLoading(false);
    setPublicCrops(current => current.map(entry => entry.id === publicCropId
      ? withProjectImportStatus(entry, crop) : entry));
  }, []);

  const handleImportPublicCrop = async (publicCrop: PublicCrop, mode?: 'new', skipVarieties = false) => {
    if (!skipVarieties && !mode && !publicCrop.variety?.trim() && publicCrop.crop_species && !publicCrop.project_import_status) {
      setVarietyImport(publicCrop);
      return;
    }
    if (importInFlight.current) return;
    importInFlight.current = true;
    const name = getPublicCropTitle(publicCrop, language, t('library.translation.missingName'));
    const initialImport = !mode && !publicCrop.project_import_status;
    let expectedProjectId = 0;
    try {
      setPublicLibraryImportingId(publicCrop.id);
      setPublicLibraryError(null);
      if (initialImport) {
        expectedProjectId = Number(window.localStorage.getItem('activeProjectId'));
        if (!Number.isInteger(expectedProjectId) || expectedProjectId <= 0) {
          setPublicLibraryError(t('library.importProjectChanged'));
          return;
        }
        const preview = await publicCropAPI.importPreview(publicCrop.id);
        if (Number(window.localStorage.getItem('activeProjectId')) !== expectedProjectId) {
          setPublicLibraryError(t('library.importProjectChanged'));
          return;
        }
        if (preview.data.candidates.length) {
          setImportLink({ publicCrop, candidates: preview.data.candidates });
          return;
        }
      }
      const response = initialImport
        ? await publicCropAPI.importToProject(publicCrop.id, undefined, {
          linkToLibrary: true, baseVersion: publicCrop.version, expectedProjectId,
        })
        : await publicCropAPI.importToProject(publicCrop.id, mode);
      if (initialImport && Number(window.localStorage.getItem('activeProjectId')) !== expectedProjectId) {
        setPublicLibraryError(t('library.importProjectChanged'));
        return;
      }
      const importedCrop = response.data.crop;
      markProjectImport(publicCrop.id, importedCrop);
      await onImportSuccess(importedCrop);
      if (initialImport) {
        await fetchPublicCrops(librarySearch.current.query, librarySearch.current.exactMatch);
      }
      // Deliberately doesn't close the dialog (unlike a plain "select and
      // done" flow) — staying open lets the user import several crops from
      // the library in one sitting instead of reopening it each time. A
      // prior refactor silently reintroduced a close-on-import call here;
      // restored per the original intent (see git history) and the E2E
      // coverage in e2e/public-crop-library.spec.ts.
      if (response.data.operation === 'unchanged') {
        showSnackbar(t('library.importUnchanged', { name }), 'info');
      } else if (response.data.operation === 'updated') {
        showSnackbar(t('library.importUpdated', { name }), 'success');
      } else {
        showSnackbar(t('library.importSuccess', { name }), 'success');
      }
    } catch (error) {
      const code = extractApiErrorCode(error);
      if (code === 'public_crop_import_project_changed') {
        setPublicLibraryError(t('library.importProjectChanged'));
        return;
      }
      if (initialImport) {
        setPublicLibraryError(t((code === 'existing_crop_requires_link' || code === 'duplicate_general_crop')
          ? 'library.importMatchChanged' : 'library.importError'));
        return;
      }
      // This search-and-import flow doesn't offer the update/import-as-new
      // choice the Public Crop Library page's conflict dialog does — a 409
      // here just means "already imported with local changes", so point the
      // user at the place that can actually resolve it.
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        setPublicLibraryError(t('library.importConflictDialog.resolveElsewhere', { name }));
        return;
      }
      console.error('Error importing public crop:', error);
      setPublicLibraryError(extractApiErrorMessage(error, t, t('library.importError')));
    } finally {
      importInFlight.current = false;
      setPublicLibraryImportingId(null);
    }
  };

  const refreshPublicCropStatusContext = useCallback(async () => {
    await onPublicCropStatusChange?.();
    if (publicLibraryOpen) {
      await fetchPublicCrops();
    }
  }, [fetchPublicCrops, onPublicCropStatusChange, publicLibraryOpen]);

  // Publishes the Sorten the wizard offered alongside the Kultur. Runs after
  // the Kultur itself is in the library, because a Sorte is published under
  // the species entry the Kultur publication creates.
  //
  // The Kultur's own message is passed in rather than shown first: the
  // snackbar holds one message at a time, so a second call would replace the
  // confirmation the user has not read yet. Everything that happened is
  // reported in a single sentence instead.
  const describePublicSyncError = (error: unknown): string => {
    const code = extractApiErrorCode(error);
    if (code === 'crop_name_conflict') {
      return extractApiErrorMessage(error, t, t('library.sync.error'));
    }
    if (code === 'stale_public_crop_version') {
      return t('library.sync.staleError');
    }
    if (code === 'pending_proposal_limit_exceeded') {
      return t('library.sync.proposalLimitError');
    }
    return describeLibraryPinError(code, t) ?? t('library.sync.error');
  };

  const pushSyncFields = async (
    cropId: number,
    data: {
      publicCropId: number;
      baseVersion: number;
      pullFields: string[];
      pushFields: string[];
      pinFields?: string[];
      acceptedPublicLibraryTerms: boolean;
      healthMappings?: StagedPlantHealthMapping[];
      cropUpdatedAt?: string;
    },
  ) => {
    const response = await cropAPI.publicSync(cropId, {
      public_crop_id: data.publicCropId,
      ...(data.healthMappings?.length ? { plant_health_mappings: data.healthMappings, expected_updated_at: data.cropUpdatedAt } : {}),
      base_version: data.baseVersion,
      pull_fields: data.pullFields,
      push_fields: data.pushFields,
      ...(data.pinFields?.length ? { pin_fields: data.pinFields } : {}),
      ...(data.acceptedPublicLibraryTerms ? { accepted_public_library_terms: true } : {}),
    });
    if (data.acceptedPublicLibraryTerms) {
      await refreshUser();
    }
    return response.data;
  };

  const handleLinkPublicCrop = async (data: {
    acceptedPublicLibraryTerms: boolean;
    cropSpeciesId?: number;
    originalLanguageCode: string;
    publicCropId: number;
    baseVersion: number;
    cropUpdatedAt?: string;
    pullFields: string[];
    pinFields?: string[];
    pushFields: string[];
    varieties?: PublishVarietySelection[];
    healthMappings?: StagedPlantHealthMapping[];
  }): Promise<boolean> => {
    if (!selectedCrop?.id) {
      return false;
    }
    const name = formatCropDisplayName(selectedCrop);
    try {
      setPublishingCropId(selectedCrop.id);
      try {
        const linked = data.healthMappings?.length
          ? await cropAPI.linkPublicCrop(selectedCrop.id, data.publicCropId, data.pullFields, data.baseVersion, data.cropUpdatedAt, data.pinFields, undefined, data.healthMappings)
          : await cropAPI.linkPublicCrop(selectedCrop.id, data.publicCropId, data.pullFields, data.baseVersion, data.cropUpdatedAt, data.pinFields);
        await onImportSuccess(linked.data);
      } catch (error) {
        console.error('Error linking crop:', error);
        showSnackbar(extractApiErrorMessage(error, t, t('library.publishError')), 'error');
        return false;
      }
      showSnackbar(t('library.linkPublicCropSuccess', { name }), 'success');
      await refreshPublicCropStatusContext();
      return true;
    } finally {
      setPublishingCropId(null);
    }
  };

  // "Verknüpfung aufheben": the crop stops syncing with somebody else's entry.
  // `onError` receives the localized rejection so the confirmation dialog can
  // show it inline; without it the failure is a snackbar.
  const handleUnlinkPublicCrop = async (
    crop: Crop,
    onError?: (message: string) => void,
  ): Promise<boolean> => {
    if (!crop.id) {
      return false;
    }
    try {
      await cropAPI.unlinkPublicCrop(crop.id);
      showSnackbar(t('library.unlink.success'), 'success');
      await refreshPublicCropStatusContext();
      return true;
    } catch (error) {
      console.error('Error unlinking crop from the library:', error);
      const code = extractApiErrorCode(error);
      const message = t(code && UNLINK_ERROR_CODES.includes(code)
        ? `library.unlink.errors.${code}`
        : 'library.unlink.error');
      if (onError) {
        onError(message);
      } else {
        showSnackbar(message, 'error');
      }
      return false;
    }
  };

  // "Mit Kulturbibliothek abgleichen" for an already connected crop.
  const handleSyncPublicCrop = async (data: {
    acceptedPublicLibraryTerms: boolean;
    publicCropId: number;
    baseVersion: number;
    pullFields: string[];
    pushFields: string[];
    pinFields: string[];
    healthMappings?: StagedPlantHealthMapping[];
    cropUpdatedAt?: string;
  }): Promise<PublicCropSyncSubmitResult> => {
    if (!selectedCrop?.id) {
      return { success: false, error: t('library.sync.error') };
    }
    const name = formatCropDisplayName(selectedCrop);
    try {
      setPublishingCropId(selectedCrop.id);
      const result = await pushSyncFields(selectedCrop.id, data);
      showSnackbar(
        t(result.operation === 'pending_moderation' ? 'library.sync.pendingModeration' : 'library.sync.success', { name }),
        'success',
      );
      await refreshPublicCropStatusContext();
      return { success: true };
    } catch (error) {
      console.error('Error syncing crop with the library:', error);
      return {
        success: false, error: describePublicSyncError(error),
        code: extractApiErrorCode(error) ?? undefined,
      };
    } finally {
      setPublishingCropId(null);
    }
  };

  const handlePublishCurrentCrop = async (
    acceptedPublicLibraryTerms = false,
    publishingData?: {
      cropSpeciesId?: number;
      originalLanguageCode: string;
      publishAsGeneral?: boolean;
      varieties?: PublishVarietySelection[];
      varietyParent?: VarietyParentPublicationDecision;
      healthMappings?: StagedPlantHealthMapping[];
      cropUpdatedAt?: string;
      onError?: (message: string, code?: string) => void;
    },
  ): Promise<boolean> => {
    if (!selectedCrop?.id) return false;

    const reportError = (message: string, code?: string) => {
      if (publishingData?.onError) publishingData.onError(message, code);
      else showSnackbar(message, 'error');
    };
    try {
      setPublishingCropId(selectedCrop.id);
      const varieties = publishingData?.varieties ?? [];
      const healthMappings = [...new Map([
        ...(publishingData?.healthMappings ?? []), ...varieties.flatMap(variety => variety.healthMappings ?? []),
      ].map(mapping => [mapping.crop_id, mapping])).values()];
      const response = await cropAPI.publishPublic(selectedCrop.id, {
        accepted_public_library_terms: acceptedPublicLibraryTerms,
        ...(publishingData ? {
          crop_species_id: publishingData.cropSpeciesId,
          ...(healthMappings.length ? {
            plant_health_mappings: healthMappings,
            expected_updated_at: publishingData.cropUpdatedAt ?? selectedCrop.updated_at,
          } : {}),
          original_language_code: publishingData.originalLanguageCode,
          ...(publishingData.publishAsGeneral !== undefined ? { publish_as_general: publishingData.publishAsGeneral } : {}),
          ...(publishingData.varietyParent ? { variety_parent: publishingData.varietyParent } : {}),
          ...(varieties.length ? { varieties: varieties.map(variety => ({
            crop_id: variety.cropId,
            expected_updated_at: variety.cropUpdatedAt ?? '',
            public_crop_id: variety.publicCropId,
            ...(variety.baseVersion !== undefined ? { base_version: variety.baseVersion } : {}),
          })) } : {}),
        } : {}),
      });
      const publishMessageKeys = {
        updated: 'library.updateSuccess',
        pending_moderation: 'library.publishPendingModeration',
        created: 'library.publishSuccess',
      } as const;
      const messages = [t(publishMessageKeys[response.data.operation] ?? publishMessageKeys.created, {
        name: formatCropDisplayName(selectedCrop),
      })];
      const outcomes = response.data.varieties;
      if (outcomes?.published) messages.push(t('library.publishVarietiesSuccess', { count: outcomes.published }));
      if (outcomes?.linked) messages.push(t('library.publishVarietiesLinked', { count: outcomes.linked }));
      if (outcomes?.pending_moderation) messages.push(t('library.publishVarietiesPendingModeration', { count: outcomes.pending_moderation }));
      showSnackbar(messages.join(' '), 'success');
      if (acceptedPublicLibraryTerms) await refreshUser();
      await refreshPublicCropStatusContext();
      return true;
    } catch (error) {
      const code = extractApiErrorCode(error) ?? undefined;
      const errorData = axios.isAxiosError(error)
        ? error.response?.data as (PublishPublicCropDuplicateError & { variety?: string }) | undefined
        : undefined;
      const checks = extractPublishChecks(error);
      let message: string;
      if (code === 'duplicate_public_crop') {
        const duplicates = (errorData?.duplicates ?? [])
          .map((entry) => entry.variety ? `${entry.name} (${entry.variety})` : entry.name).join(', ');
        message = duplicates ? t('library.publishDuplicateErrorWithCandidates', { duplicates }) : t('library.publishDuplicateError');
      } else if (checks) {
        message = describePublishChecksFailure(checks, t);
      } else if (code === 'variety_parent_changed' || code === 'stale_public_crop_version') {
        message = t('library.publishWizard.parent.changed');
      } else if (
        code === 'linked_parent_species_mismatch' || code === 'linked_parent_entry_unavailable'
        || code === 'linked_parent_variety_required'
      ) {
        message = t('library.publishWizard.parent.unavailable');
      } else if (code === 'copublished_variety_changed') {
        message = t('library.publishWizard.varieties.changed');
      } else if (code === 'linked_variety_parent_species_conflict') {
        message = t('library.publishWizard.parent.linkedVarietiesConflict');
      } else {
        message = extractApiErrorMessage(error, t, t('library.publishError'));
      }
      reportError(errorData?.variety ? t('library.publishWizard.varieties.failure', { variety: errorData.variety, message }) : message, code);
      return false;
    } finally {
      setPublishingCropId(null);
    }
  };

  useEffect(() => {
    if (shouldShowProjectRequiredState || publicLibraryOpen) {
      return;
    }
    const searchParams = new URLSearchParams(location.search);
    if (searchParams.get('library') !== 'true') {
      return;
    }

    void handleOpenPublicLibrary();
    searchParams.delete('library');
    const nextSearch = searchParams.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
      },
      { replace: true },
    );
  }, [handleOpenPublicLibrary, location.pathname, location.search, navigate, publicLibraryOpen, shouldShowProjectRequiredState]);

  return {
    varietyImport,
    setVarietyImport,
    refreshPublicCrops: () => fetchPublicCrops(librarySearch.current.query, librarySearch.current.exactMatch),
    handleVarietyImportSuccess: async (result: import('../api/types').PublicCropSelectionImportResult) => {
      showSnackbar(t('library.varietyImport.success', { count: result.entries.filter(entry => entry.operation !== 'unchanged').length }), 'success');
      const response = await cropAPI.get(result.entries[0].crop_id);
      await onImportSuccess(response.data);
      await fetchPublicCrops(librarySearch.current.query, librarySearch.current.exactMatch);
      await refreshUser();
    },
    importLink,
    setImportLink,
    handleImportLinkSuccess: async (crop: Crop) => {
      if (importLink) {
        markProjectImport(importLink.publicCrop.id, crop);
      }
      setImportLink(null);
      await onImportSuccess(crop);
      await fetchPublicCrops(librarySearch.current.query, librarySearch.current.exactMatch);
      showSnackbar(t('library.importDecision.success'), 'success');
    },
    publicLibraryOpen,
    setPublicLibraryOpen,
    publicLibraryLoading,
    publicLibraryError,
    publicCrops,
    publicLibraryImportingId,
    publicLibraryInitialSelectedId,
    publicLibraryInitialQuery,
    publishingCropId,
    isUpdatingOwnPublicCrop: Boolean(selectedCrop?.owned_public_crop_id),
    fetchPublicCrops,
    handleOpenPublicLibrary,
    handleViewPublicLibraryMatch,
    handleImportPublicCrop,
    handlePublishCurrentCrop,
    handleLinkPublicCrop,
    handleSyncPublicCrop,
    handleUnlinkPublicCrop,
  };
}
