import { useState, useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import axios from 'axios';
import { cropAPI, publicCropAPI } from '../api/api';
import type { Crop } from '../api/api';
import type { PublicCrop, PublishPublicCropDuplicateError } from '../api/types';
import { useTranslation } from '../i18n';
import { useAuth } from '../auth/useAuth';
import { extractApiErrorMessage } from '../api/errors';
import { dedupePublicCrops } from './publicCropUtils';
import { formatCropDisplayName } from '../crops/cropDisplay';
import { getPublicCropTitle } from '../crop-library/publicCropDisplay';
import { publishSelectedVarieties, type PublishVarietySelection } from '../crops/publishVarieties';

interface UsePublicCropLibraryConfig {
  shouldShowProjectRequiredState: boolean;
  selectedCrop: Crop | undefined;
  onImportSuccess: (crop: Crop) => Promise<void>;
  onPublicCropStatusChange?: () => Promise<void>;
  onClearForm: () => void;
  showSnackbar: (message: string, severity: 'success' | 'error' | 'info') => void;
}

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

  const [publicLibraryOpen, setPublicLibraryOpen] = useState(false);
  const [publicLibraryLoading, setPublicLibraryLoading] = useState(false);
  const [publicLibraryError, setPublicLibraryError] = useState<string | null>(null);
  const [publicCrops, setPublicCrops] = useState<PublicCrop[]>([]);
  const [publicLibraryImportingId, setPublicLibraryImportingId] = useState<number | null>(null);
  const [publicLibraryInitialSelectedId, setPublicLibraryInitialSelectedId] = useState<number | null>(null);
  const [publicLibraryInitialQuery, setPublicLibraryInitialQuery] = useState('');
  const [publishingCropId, setPublishingCropId] = useState<number | null>(null);

  const fetchPublicCrops = useCallback(async (
    query = '',
    exactMatch?: { name: string; variety?: string },
  ) => {
    try {
      setPublicLibraryLoading(true);
      setPublicLibraryError(null);
      const params = exactMatch
        ? { name: exactMatch.name, variety: exactMatch.variety || '' }
        : query ? { q: query } : undefined;
      const response = await publicCropAPI.list(params);
      setPublicCrops(dedupePublicCrops(response.data.results));
    } catch (error) {
      console.error('Error fetching public crops:', error);
      setPublicLibraryError(t('library.loadError'));
    } finally {
      setPublicLibraryLoading(false);
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

  const handleImportPublicCrop = async (publicCrop: PublicCrop) => {
    const name = getPublicCropTitle(publicCrop, language, t('library.translation.missingName'));
    try {
      setPublicLibraryImportingId(publicCrop.id);
      const response = await publicCropAPI.importToProject(publicCrop.id);
      const importedCrop = response.data.crop;
      await onImportSuccess(importedCrop);
      setPublicLibraryOpen(false);
      if (response.data.operation === 'unchanged') {
        showSnackbar(t('library.importUnchanged', { name }), 'info');
      } else if (response.data.operation === 'updated') {
        showSnackbar(t('library.importUpdated', { name }), 'success');
      } else {
        showSnackbar(t('library.importSuccess', { name }), 'success');
      }
    } catch (error) {
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
  const publishCropVarieties = async (
    cropMessage: string,
    varieties: PublishVarietySelection[] | undefined,
    publishingData: { cropSpeciesId?: number; originalLanguageCode: string } | undefined,
    acceptedPublicLibraryTerms: boolean,
    cropSeverity: 'success' | 'error' = 'success',
  ): Promise<void> => {
    if (!varieties?.length || !publishingData) {
      showSnackbar(cropMessage, cropSeverity);
      return;
    }
    const result = await publishSelectedVarieties({
      varieties,
      cropSpeciesId: publishingData.cropSpeciesId,
      originalLanguageCode: publishingData.originalLanguageCode,
      acceptedPublicLibraryTerms,
    });
    const succeeded = result.published + result.linked;
    const messages = [cropMessage];
    if (succeeded > 0) {
      messages.push(t('library.publishVarietiesSuccess', { count: succeeded }));
    }
    if (result.alreadyPublic > 0) {
      messages.push(t('library.publishVarietiesAlreadyPublic', { count: result.alreadyPublic }));
    }
    if (result.pendingModeration > 0) {
      messages.push(t('library.publishVarietiesPendingModeration', { count: result.pendingModeration }));
    }
    if (result.failed > 0) {
      messages.push(t('library.publishVarietiesPartialError', { count: result.failed }));
    }
    showSnackbar(messages.join(' '), result.failed > 0 || cropSeverity === 'error' ? 'error' : 'success');
  };

  const describePublicSyncError = (error: unknown): string => {
    const code = axios.isAxiosError(error)
      ? (error.response?.data as { code?: string } | undefined)?.code
      : undefined;
    if (code === 'stale_public_crop_version') {
      return t('library.sync.staleError');
    }
    if (code === 'pending_proposal_limit_exceeded') {
      return t('library.sync.proposalLimitError');
    }
    return t('library.sync.error');
  };

  const pushSyncFields = async (
    cropId: number,
    data: {
      publicCropId: number;
      baseVersion: number;
      pullFields: string[];
      pushFields: string[];
      acceptedPublicLibraryTerms: boolean;
    },
  ) => {
    const response = await cropAPI.publicSync(cropId, {
      public_crop_id: data.publicCropId,
      base_version: data.baseVersion,
      pull_fields: data.pullFields,
      push_fields: data.pushFields,
      ...(data.acceptedPublicLibraryTerms ? { accepted_public_library_terms: true } : {}),
    });
    if (data.acceptedPublicLibraryTerms) {
      await refreshUser();
    }
    return response.data;
  };

  // Link confirmation: link + pulled values in one backend transaction, then
  // push the user's own values into the entry, then the Sorten. The link
  // cannot be undone, so a failed push keeps it: the crop then shows the
  // ordinary "Bibliothek aktualisieren" action to retry.
  const handleLinkPublicCrop = async (data: {
    acceptedPublicLibraryTerms: boolean;
    cropSpeciesId?: number;
    originalLanguageCode: string;
    publicCropId: number;
    baseVersion: number;
    pullFields: string[];
    pushFields: string[];
    varieties?: PublishVarietySelection[];
  }): Promise<boolean> => {
    if (!selectedCrop?.id) {
      return false;
    }
    const name = formatCropDisplayName(selectedCrop);
    try {
      setPublishingCropId(selectedCrop.id);
      try {
        await cropAPI.linkPublicCrop(selectedCrop.id, data.publicCropId, data.pullFields);
      } catch (error) {
        console.error('Error linking crop:', error);
        showSnackbar(extractApiErrorMessage(error, t, t('library.publishError')), 'error');
        return false;
      }
      let cropMessage = t('library.linkPublicCropSuccess', { name });
      let cropSeverity: 'success' | 'error' = 'success';
      if (data.pushFields.length > 0) {
        try {
          const result = await pushSyncFields(selectedCrop.id, { ...data, pullFields: [] });
          if (result.operation === 'pending_moderation') {
            cropMessage = t('library.sync.linkPendingModeration', { name });
          }
        } catch (error) {
          console.error('Error pushing values after linking:', error);
          cropMessage = t('library.sync.linkPushFailed', { name });
          cropSeverity = 'error';
        }
      }
      await publishCropVarieties(
        cropMessage,
        data.varieties,
        data,
        data.acceptedPublicLibraryTerms,
        cropSeverity,
      );
      await refreshPublicCropStatusContext();
      return true;
    } finally {
      setPublishingCropId(null);
    }
  };

  // "Mit Kulturbibliothek abgleichen" for an already connected crop.
  const handleSyncPublicCrop = async (data: {
    acceptedPublicLibraryTerms: boolean;
    publicCropId: number;
    baseVersion: number;
    pullFields: string[];
    pushFields: string[];
  }): Promise<boolean> => {
    if (!selectedCrop?.id) {
      return false;
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
      return true;
    } catch (error) {
      console.error('Error syncing crop with the library:', error);
      showSnackbar(describePublicSyncError(error), 'error');
      return false;
    } finally {
      setPublishingCropId(null);
    }
  };

  const handlePublishCurrentCrop = async (
    acceptedPublicLibraryTerms = false,
    publishingData?: {
      cropSpeciesId?: number;
      originalLanguageCode: string;
      publicCropId?: number | null;
      publishAsGeneral?: boolean;
      varieties?: PublishVarietySelection[];
    },
  ): Promise<boolean> => {
    if (!selectedCrop?.id) {
      return false;
    }

    try {
      setPublishingCropId(selectedCrop.id);
      if (publishingData?.publicCropId) {
        await cropAPI.linkPublicCrop(selectedCrop.id, publishingData.publicCropId);
        await publishCropVarieties(
          t('library.linkPublicCropSuccess', { name: formatCropDisplayName(selectedCrop) }),
          publishingData.varieties,
          publishingData,
          acceptedPublicLibraryTerms,
        );
        await refreshPublicCropStatusContext();
        return true;
      }
      const response = await cropAPI.publishPublic(selectedCrop.id, {
        accepted_public_library_terms: acceptedPublicLibraryTerms,
        ...(publishingData ? {
          crop_species_id: publishingData.cropSpeciesId,
          original_language_code: publishingData.originalLanguageCode,
          ...(publishingData.publishAsGeneral !== undefined ? { publish_as_general: publishingData.publishAsGeneral } : {}),
        } : {}),
      });
      const publishMessageKeys = {
        updated: 'library.updateSuccess',
        // Queued for moderation: the entry is not in the library yet, so the
        // message must not read as a completed publish.
        pending_moderation: 'library.publishPendingModeration',
        created: 'library.publishSuccess',
      } as const;
      const cropMessage = t(
        publishMessageKeys[response.data.operation] ?? publishMessageKeys.created,
        { name: formatCropDisplayName(selectedCrop) },
      );
      if (acceptedPublicLibraryTerms) {
        await refreshUser();
      }
      await publishCropVarieties(
        cropMessage,
        publishingData?.varieties,
        publishingData,
        acceptedPublicLibraryTerms,
      );
      await refreshPublicCropStatusContext();
      return true;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        const duplicateError = error.response.data as PublishPublicCropDuplicateError | undefined;
        const duplicateNames = (duplicateError?.duplicates || [])
          .map((entry) => entry.variety ? `${entry.name} (${entry.variety})` : entry.name)
          .join(', ');
        if (duplicateNames) {
          showSnackbar(t('library.publishDuplicateErrorWithCandidates', { duplicates: duplicateNames }), 'info');
        } else {
          showSnackbar(t('library.publishDuplicateError'), 'info');
        }
        return false;
      }
      console.error('Error publishing crop:', error);
      showSnackbar(extractApiErrorMessage(error, t, t('library.publishError')), 'error');
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
  };
}
