/**
 * Crops (Kulturen) page component.
 * 
 * Displays crop crop details with searchable dropdown.
 * Includes create and edit functionality for crops.
 * UI text is in German, code comments remain in English.
 * 
 * @returns The Crops page component
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router';
import { useTranslation } from '../i18n';
import PageContainer from '../components/layout/PageContainer';
import { bedAPI, cropAPI, fieldAPI, type Crop } from '../api/api';
import type { CropHistoryEntry } from '../api/types';
import { CropDetail } from '../crops/CropDetail';
import { CropForm, type FirstVarietyDraft } from '../crops/CropForm';
import { PublicCropLibraryDialog } from '../crop-library/components/PublicCropLibraryDialog';
import {
  Box,
  type SxProps,
  type Theme,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useCommandContextTag, useRegisterCommands, useRegisterCreateActions } from '../commands/useCommandContext';
import {
  type SnackbarState,
} from './cropsPageUtils';
import { createCropsCommandSpecs } from './cropsCommandSpecs';
import {
  buildCropSavePayload,
  buildGeneralCropDraftForFirstVariety,
} from './cropsSaveUtils';
import { type HistoryScope } from './cropsHistoryUtils';
import { useSelectedCropSync } from './useSelectedCropSync';
import { useAuth } from '../auth/useAuth';
import { usePublicCropLibrary } from './usePublicCropLibrary';
import { useCropDelete } from './useCropDelete';
import { useCropImportExport } from './useCropImportExport';
import { CropsImportDialog } from './CropsImportDialog';
import { CropsImportStartDialog } from './CropsImportStartDialog';
import { CropsExportDialog } from './CropsExportDialog';
import { CropsPublishingWizardDialog } from './CropsPublishingWizardDialog';
import { CropsHistoryDialog } from './CropsHistoryDialog';
import { AlertSnackbar } from '../components/feedback/AlertSnackbar';
import { ConfirmationDialog } from '../components/feedback/ConfirmationDialog';
import { useProjectRequirement } from '../hooks/useProjectRequirement';
import ProjectRequiredState from '../components/project/ProjectRequiredState';
import EmptyStateCard from '../components/project/EmptyStateCard';
import { getFirstMissingCultivationPlanRequirement, getTranslatedProjectSetupAction } from './requirementFlow';
import type { RootLayoutOutletContext, TopbarContextAction } from '../navigation/topbarTypes';
import { useTopbarContextActions } from '../hooks/useTopbarContextActions';
import {
  DeleteUndoSnackbar,
} from '../components/data-grid';
import { getCropDisplayName } from '../crops/cropDisplay';
import { getCropSpeciesKey } from '../crops/cropHierarchy';
import type { PublishVarietySelection } from '../crops/publishVarieties';
import { buildVarietyInheritanceBaseline } from '../crops/varietyValueSource';
import { normalizeCropIdentityValue } from '../crops/cropIdentity';

// Stable identity so the memos downstream do not see a new array on every
// render while no project is selected.
const EMPTY_CROPS: Crop[] = [];

const PLANTING_PLAN_REQUIREMENT_EMPTY_STATE_CONTAINER_SX: SxProps<Theme> = {
  backgroundColor: (theme) => alpha(theme.palette.success.main, 0.06),
  borderLeft: '3px solid',
  borderLeftColor: 'success.main',
  py: 1.25,
  px: 1.5,
};

const PLANTING_PLAN_REQUIREMENT_EMPTY_STATE_TITLE_SX: SxProps<Theme> = {
  fontWeight: 500,
};

function Crops() {
  const { t } = useTranslation(['crops', 'common']);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const outletContext = useOutletContext<RootLayoutOutletContext | null>();
  const setTopbarContextActions = outletContext?.setTopbarContextActions;
  const activeSeasonLoaded = outletContext?.activeSeasonLoaded ?? true;
  const isMissingActiveSeason = Boolean(outletContext) && activeSeasonLoaded && !outletContext?.activeSeason;
  const { shouldShowProjectRequiredState, missingProjectReason } = useProjectRequirement();
  const { selectedCropId, updateSelectedCropId } = useSelectedCropSync();
  const fallbackHistoryActorLabel = user?.display_label || user?.display_name || user?.email || undefined;

  const [loadedCrops, setCrops] = useState<Crop[]>([]);
  const [isFetchingCrops, setIsCropsLoading] = useState(true);
  // Whether a crop list response has already been rendered. Guards the loading
  // state in fetchCrops below so later refetches keep the list on screen.
  const hasLoadedCropsRef = useRef(false);
  const [showForm, setShowForm] = useState(false);
  const [editingCrop, setEditingCrop] = useState<Crop | undefined>(undefined);
  const [cropFormKind, setCropFormKind] = useState<'crop' | 'variety'>('crop');
  const [initialFormDraft, setInitialFormDraft] = useState<Partial<Crop> | undefined>(undefined);
  const [snackbar, setSnackbar] = useState<SnackbarState>({ open: false, message: '', severity: 'success' });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<CropHistoryEntry[]>([]);
  const [historyScope, setHistoryScope] = useState<HistoryScope>('crop');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const focusSearch = useCallback(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, []);
  const [hasFieldsLoaded, setHasFields] = useState(false);
  const [hasBedsLoaded, setHasBeds] = useState(false);

  // Without a project nothing is fetched, so the page reports an empty,
  // settled state. Derived during render rather than pushed into state from
  // the load effect below — that reset is what react-hooks/set-state-in-effect
  // flags, and deriving also avoids the extra render pass it caused.
  const crops = shouldShowProjectRequiredState ? EMPTY_CROPS : loadedCrops;
  const isCropsLoading = shouldShowProjectRequiredState ? false : isFetchingCrops;
  const hasFields = shouldShowProjectRequiredState ? false : hasFieldsLoaded;
  const hasBeds = shouldShowProjectRequiredState ? false : hasBedsLoaded;

  const selectedCrop = crops.find((crop) => crop.id === selectedCropId);

  const showSnackbar = useCallback((message: string, severity: 'success' | 'error' | 'info') => {
    setSnackbar({ open: true, message, severity });
  }, []);

  const {
    deleteDialogCrop,
    deleteDialogImpact,
    setDeleteDialogCrop,
    setDeleteDialogImpact,
    pendingCropDeletions,
    handleDelete,
    handleDeleteConfirm,
    undoPendingCropDeletion,
    closePendingCropDeletionSnackbar,
  } = useCropDelete({
    crops,
    setCrops,
    selectedCropId,
    updateSelectedCropId,
    showSnackbar,
  });

  const deleteDialogMessage = useMemo(() => {
    if (!deleteDialogCrop) {
      return '';
    }
    const cropName = getCropDisplayName(deleteDialogCrop);
    if (!deleteDialogImpact || deleteDialogImpact.variety_count === 0) {
      return t('deleteDialog.confirmation', { name: cropName });
    }

    const varietyNames = deleteDialogImpact.varieties.map((variety) => variety.name).join(', ');
    const baseMessage = deleteDialogImpact.group_without_general
      ? t('deleteDialog.groupOnlyConfirmation', {
        count: deleteDialogImpact.variety_count,
        varieties: varietyNames,
      })
      : t('deleteDialog.cascadeConfirmation', {
        name: cropName,
        count: deleteDialogImpact.variety_count,
        varieties: varietyNames,
      });
    const planningMessage = deleteDialogImpact.planning_data_count > 0
      ? t('deleteDialog.planningDataWarning', { count: deleteDialogImpact.planning_data_count })
      : null;

    return (
      <>
        <Box component="span" sx={{ display: 'block' }}>{baseMessage}</Box>
        {planningMessage ? (
          <Box component="span" sx={{ display: 'block', mt: 1 }}>{planningMessage}</Box>
        ) : null}
      </>
    );
  }, [deleteDialogCrop, deleteDialogImpact, t]);

  const replaceSavedCrop = useCallback((savedCrop: Crop): void => {
    setCrops((currentCrops) => {
      const savedCropId = savedCrop.id;
      if (savedCropId === undefined) {
        return currentCrops;
      }

      const cropExists = currentCrops.some((crop) => crop.id === savedCropId);
      if (!cropExists) {
        return [...currentCrops, savedCrop];
      }

      return currentCrops.map((crop) => (
        crop.id === savedCropId ? savedCrop : crop
      ));
    });
  }, []);

  const fetchCrops = useCallback(async (preservedCrop?: Crop) => {
    // Only the first load swaps the page for the loading card. A refetch that
    // runs while crops are already on screen (save, import, publish to the
    // public library) would otherwise unmount the detail area including the
    // crop list, which drops the list's scroll position back to the top.
    const isInitialLoad = !hasLoadedCropsRef.current;
    if (isInitialLoad) {
      setIsCropsLoading(true);
    }
    try {
      const response = await cropAPI.list();
      hasLoadedCropsRef.current = true;
      const fetchedCrops = response.data.results;
      if (!preservedCrop?.id) {
        setCrops(fetchedCrops);
        return;
      }

      const preservedCropId = preservedCrop.id;
      const fetchedCropIds = new Set(fetchedCrops.map((crop) => crop.id));
      const nextCrops = fetchedCrops.map((crop) => (
        crop.id === preservedCropId
          ? { ...crop, ...preservedCrop }
          : crop
      ));
      setCrops(
        fetchedCropIds.has(preservedCropId)
          ? nextCrops
          : [...nextCrops, preservedCrop],
      );
    } catch (error) {
      console.error('Error fetching crops:', error);
      showSnackbar(t('messages.fetchError'), 'error');
    } finally {
      if (isInitialLoad) {
        setIsCropsLoading(false);
      }
    }
  }, [showSnackbar, t]);

  const {
    importDialogOpen,
    importStartDialogOpen,
    exportDialogOpen,
    exportDialogInitialScope,
    importState,
    hasImportableEntries,
    confirmUpdates,
    setConfirmUpdates,
    handleImportFileTrigger,
    handleImportFileSelected,
    handleExportCurrentCrop,
    handleExportAllCrops,
    handleOpenExportDialog,
    handleExport,
    handleImportStart,
    handleImportDialogClose,
    setImportStartDialogOpen,
    setExportDialogOpen,
  } = useCropImportExport({
    selectedCrop,
    fetchCrops,
    showSnackbar,
  });

  const onPublicLibraryImportSuccess = useCallback(async (crop: Crop) => {
    await fetchCrops(crop);
    if (crop.id !== undefined) {
      updateSelectedCropId(crop.id, 'internal');
    }
  }, [fetchCrops, updateSelectedCropId]);

  const onClearFormForLibrary = useCallback(() => {
    setShowForm(false);
    setEditingCrop(undefined);
  }, []);

  const {
    publicLibraryOpen,
    setPublicLibraryOpen,
    publicLibraryLoading,
    publicLibraryError,
    publicCrops,
    publicLibraryImportingId,
    publicLibraryInitialSelectedId,
    publicLibraryInitialQuery,
    publishingCropId,
    fetchPublicCrops,
    handleOpenPublicLibrary,
    handleImportPublicCrop,
    handlePublishCurrentCrop,
  } = usePublicCropLibrary({
    shouldShowProjectRequiredState,
    selectedCrop,
    onImportSuccess: onPublicLibraryImportSuccess,
    onPublicCropStatusChange: fetchCrops,
    onClearForm: onClearFormForLibrary,
    showSnackbar,
  });

  const [publishWizardOpen, setPublishWizardOpen] = useState(false);

  // Only a general Kultur has Sorten to offer: the group members of a Sorte
  // are its siblings, which are published from their own page.
  const publishWizardVarieties = useMemo(() => {
    if (!selectedCrop || (selectedCrop.variety ?? '').trim()) {
      return [];
    }
    const speciesKey = getCropSpeciesKey(selectedCrop);
    return crops.filter((candidate) => (
      candidate.id !== selectedCrop.id
      && Boolean((candidate.variety ?? '').trim())
      && getCropSpeciesKey(candidate) === speciesKey
    ));
  }, [crops, selectedCrop]);

  const handleRequestPublishCrop = useCallback(() => {
    setPublishWizardOpen(true);
  }, []);

  const handlePublishingWizardPublish = useCallback((data: {
    acceptedPublicLibraryTerms: boolean;
    cropSpeciesId?: number;
    originalLanguageCode: string;
    publicCropId?: number | null;
    publishAsGeneral?: boolean;
    varieties?: PublishVarietySelection[];
  }) => {
    setPublishWizardOpen(false);
    void handlePublishCurrentCrop(data.acceptedPublicLibraryTerms, {
      cropSpeciesId: data.cropSpeciesId,
      originalLanguageCode: data.originalLanguageCode,
      publicCropId: data.publicCropId,
      publishAsGeneral: data.publishAsGeneral,
      varieties: data.varieties,
    });
  }, [handlePublishCurrentCrop]);

  // Fetch crops on mount
  useEffect(() => {
    if (shouldShowProjectRequiredState) {
      return;
    }
    fetchCrops();
  }, [fetchCrops, shouldShowProjectRequiredState]);

  useEffect(() => {
    if (shouldShowProjectRequiredState) {
      return;
    }
    const fetchPlanRequirements = async (): Promise<void> => {
      try {
        const [fieldsResponse, bedsResponse] = await Promise.all([
          fieldAPI.list(),
          bedAPI.list(),
        ]);
        setHasFields(fieldsResponse.data.results.length > 0);
        setHasBeds(bedsResponse.data.results.length > 0);
      } catch {
        setHasFields(false);
        setHasBeds(false);
      }
    };
    void fetchPlanRequirements();
  }, [shouldShowProjectRequiredState]);


  useEffect(() => {
    if (crops.length === 0) {
      return;
    }

    if (selectedCropId === undefined && !showForm) {
      const [firstCrop] = crops;
      if (firstCrop?.id !== undefined) {
        updateSelectedCropId(firstCrop.id, 'internal');
      }
      return;
    }

    if (selectedCropId !== undefined && !crops.some((crop) => crop.id === selectedCropId)) {
      updateSelectedCropId(undefined, 'internal');
    }
  }, [crops, selectedCropId, showForm, updateSelectedCropId]);

  const handleCropSelect = (crop: Crop | null) => {
    updateSelectedCropId(crop?.id, 'internal');
  };

  // Regular crop selection (sidebar browsing, filters, etc.) replaces the
  // current history entry via useSelectedCropSync — deliberately, so
  // clicking through many crops in the sidebar doesn't turn "back" into
  // stepping through each one. Clicking a row in the Varieties comparison
  // table is a more deliberate "go to this variety's page" action, so it
  // should behave like normal navigation: pushing a new history entry means
  // the back button returns to the crop page you navigated from.
  const handleVarietyRowNavigate = useCallback((crop: Crop) => {
    updateSelectedCropId(crop.id, 'internal', 'push');
  }, [updateSelectedCropId]);

  const handleAddNew = useCallback(() => {
    setEditingCrop(undefined);
    setCropFormKind('crop');
    setInitialFormDraft(undefined);
    setShowForm(true);
  }, []);

  const handleAddVariety = useCallback((speciesCrop: Crop) => {
    setEditingCrop(undefined);
    setCropFormKind('variety');
    setInitialFormDraft({
      ...buildVarietyInheritanceBaseline(speciesCrop),
      crop_species: speciesCrop.crop_species ?? null,
      name: speciesCrop.name,
      variety: '',
    });
    setShowForm(true);
  }, []);

  useEffect(() => {
    if (shouldShowProjectRequiredState || showForm) {
      return;
    }
    const searchParams = new URLSearchParams(location.search);
    if (searchParams.get('create') !== 'true') {
      return;
    }

    handleAddNew();
    searchParams.delete('create');
    const nextSearch = searchParams.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
      },
      { replace: true },
    );
  }, [handleAddNew, location.pathname, location.search, navigate, shouldShowProjectRequiredState, showForm]);

  const handleEdit = useCallback((crop: Crop) => {
    setEditingCrop(crop);
    setCropFormKind((crop.variety || '').trim() ? 'variety' : 'crop');
    setInitialFormDraft(undefined);
    setShowForm(true);
  }, []);

  useEffect(() => {
    if (shouldShowProjectRequiredState || showForm || !selectedCrop) {
      return;
    }
    const searchParams = new URLSearchParams(location.search);
    if (searchParams.get('action') !== 'edit' || searchParams.get('cropId') !== String(selectedCrop.id)) {
      return;
    }

    handleEdit(selectedCrop);
    searchParams.delete('action');
    const nextSearch = searchParams.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
      },
      { replace: true },
    );
  }, [handleEdit, location.pathname, location.search, navigate, selectedCrop, shouldShowProjectRequiredState, showForm]);

  const handleOpenHistory = async () => {
    if (!selectedCrop?.id) {
      return;
    }
    const response = await cropAPI.history(selectedCrop.id);
    if (response.data.length === 0) {
      showSnackbar(t('history.emptyState.title'), 'info');
      return;
    }
    setHistoryItems(response.data);
    setHistoryScope('crop');
    setHistoryOpen(true);
  };

  const handleRestoreVersion = async (historyId: number) => {
    try {
      if (historyScope === 'project') {
        await cropAPI.projectRestore(historyId);
      } else if (historyScope === 'global') {
        await cropAPI.globalRestore(historyId);
      } else {
        if (!selectedCrop?.id) return;
        await cropAPI.restore(selectedCrop.id, historyId);
      }
      await fetchCrops();
      setHistoryOpen(false);
      showSnackbar(t('messages.restoreSuccess'), 'success');
    } catch {
      showSnackbar(t('messages.restoreError'), 'error');
    }
  };


  const handleSave = async (crop: Crop, firstVariety?: FirstVarietyDraft) => {
    try {
      const savePayload = buildCropSavePayload(crop);
      const normalizedCropName = normalizeCropIdentityValue(crop.name);
      const existingGeneralCrop = firstVariety && normalizedCropName
        ? crops.find((candidate) => (
          normalizeCropIdentityValue(candidate.name) === normalizedCropName
          && !(candidate.variety ?? '').trim()
        ))
        : undefined;

      let savedCrop: Crop;
      if (editingCrop) {
        const response = await cropAPI.update(editingCrop.id!, savePayload as Crop);
        savedCrop = response.data;
        showSnackbar(t('messages.updateSuccess'), 'success');
      } else {
        if (existingGeneralCrop) {
          savedCrop = existingGeneralCrop;
          updateSelectedCropId(savedCrop.id, 'internal');
        } else {
          const generalCropPayload = firstVariety
            ? buildCropSavePayload(buildGeneralCropDraftForFirstVariety(
              crop,
              { copyValuesToCrop: Boolean(firstVariety.copyValuesToCrop) },
            ) as Crop)
            : savePayload;
          const response = await cropAPI.create(generalCropPayload as Crop);
          savedCrop = response.data;
          // Auto-select the newly created crop
          updateSelectedCropId(savedCrop.id, 'internal');
        }

        if (firstVariety) {
          try {
            // Without a library draft the variety inherits the crop's own
            // values; with one it carries the library values and the same
            // source linking an import would produce.
            const varietyPayload = buildCropSavePayload({
              ...crop,
              ...(firstVariety.draft ?? {}),
              id: undefined,
              name: crop.name,
              crop_species: savedCrop.crop_species ?? crop.crop_species,
              variety: firstVariety.name,
              copy_values_to_crop: firstVariety.copyValuesToCrop,
            });
            const varietyResponse = await cropAPI.create(varietyPayload as Crop);
            savedCrop = varietyResponse.data;
            updateSelectedCropId(savedCrop.id, 'internal');
            showSnackbar(t('messages.createWithVarietySuccess'), 'success');
          } catch (varietyError) {
            console.error('Error creating initial variety:', varietyError);
            showSnackbar(t('messages.createVarietyPartialError'), 'error');
          }
        } else {
          showSnackbar(t('messages.createSuccess'), 'success');
        }
      }
      replaceSavedCrop(savedCrop);
      setShowForm(false);
      setEditingCrop(undefined);
      setInitialFormDraft(undefined);
      void fetchCrops(savedCrop);
    } catch (error) {
      console.error('Error saving crop:', error);
      throw error; // Re-throw to prevent form from closing
    }
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingCrop(undefined);
    setInitialFormDraft(undefined);
  };

  const handleCloseSnackbar = () => {
    setSnackbar(prev => ({ ...prev, open: false }));
  };

  const handleCreatePlantingPlan = useCallback(() => {
    if (selectedCropId && !isMissingActiveSeason) {
      navigate(`/app/planting-plans?cropId=${selectedCropId}`);
    }
  }, [isMissingActiveSeason, navigate, selectedCropId]);

  const firstMissingPlanRequirement = getFirstMissingCultivationPlanRequirement({
    hasFields,
    hasBeds,
    hasCrops: crops.length > 0,
  });
  const firstMissingPlanAction = firstMissingPlanRequirement
    ? getTranslatedProjectSetupAction(firstMissingPlanRequirement, t)
    : null;
  const planRequirementActions = isMissingActiveSeason
    ? [{ label: t('buttons.createSeason'), onClick: outletContext?.requestSeasonCreation }]
    : firstMissingPlanAction
      ? [firstMissingPlanAction]
      : [];
  const canCreatePlantingPlan = Boolean(selectedCrop) && firstMissingPlanRequirement === null && !isMissingActiveSeason;
  const createPlanDisabledTooltip = isMissingActiveSeason
    ? t('buttons.createPlantingPlanMissingSeasonTooltip')
    : undefined;
  const planRequirementEmptyState = isMissingActiveSeason
    ? {
      title: t('buttons.createPlantingPlanMissingSeasonTitle'),
      description: t('buttons.createPlantingPlanDisabled.seasons'),
    }
    : firstMissingPlanRequirement === 'fields'
    ? {
      title: t('buttons.createPlantingPlanMissingFieldsTitle'),
      description: t('buttons.createPlantingPlanDisabled.fields'),
    }
    : firstMissingPlanRequirement === 'beds'
      ? {
        title: t('buttons.createPlantingPlanMissingBedsTitle'),
        description: t('buttons.createPlantingPlanDisabled.beds'),
      }
      : null;
  useCommandContextTag('crops');

  const goToRelativeCrop = useCallback((direction: 'next' | 'previous') => {
    if (!selectedCropId || crops.length === 0) {
      return;
    }

    const currentIndex = crops.findIndex((crop) => crop.id === selectedCropId);
    if (currentIndex === -1) {
      return;
    }

    const delta = direction === 'next' ? 1 : -1;
    const nextIndex = (currentIndex + delta + crops.length) % crops.length;
    updateSelectedCropId(crops[nextIndex]?.id, 'internal');
  }, [crops, selectedCropId, updateSelectedCropId]);

  const contextActions = useMemo<TopbarContextAction[]>(() => ([
    {
      id: 'crops-open-library',
      label: t('library.openButton'),
      ariaLabel: t('library.openButton'),
      onClick: () => {
        void handleOpenPublicLibrary();
      },
    },
    {
      id: 'crops-import',
      label: t('import.menuLabel'),
      ariaLabel: t('import.menuLabel'),
      onClick: handleImportFileTrigger,
      shortcutHint: 'Alt+I',
    },
    {
      id: 'crops-export',
      label: t('export.menuLabel'),
      ariaLabel: t('export.menuLabel'),
      onClick: handleOpenExportDialog,
      shortcutHint: 'Alt+X',
    },
  ]), [handleImportFileTrigger, handleOpenExportDialog, handleOpenPublicLibrary, t]);

  useTopbarContextActions(setTopbarContextActions, contextActions);

  const createActions = useMemo(() => [
    {
      id: 'create-crop',
      label: t('crops:buttons.addNew'),
      shortcut: 'Alt+Shift+N',
      handler: handleAddNew,
    },
  ], [handleAddNew, t]);

  useRegisterCreateActions('crops-page', createActions);

  // `focusSearch` reads searchInputRef.current in its body, and the rule cannot
  // see into the imported spec factory to know the callback is only stored, not
  // invoked, so it assumes the ref could be read during render. The ref is only
  // ever touched when the command runs.
  // eslint-disable-next-line react-hooks/refs
  const commandSpecs = useMemo(() => createCropsCommandSpecs({
    t,
    crops,
    focusSearch,
    goToRelativeCrop,
    handleCreatePlantingPlan,
    handleDelete,
    handleEdit,
    handleExportAllCrops,
    handleExportCurrentCrop,
    handleImportFileTrigger,
    selectedCrop,
    selectedCropId,
  }), [
    crops,
    focusSearch,
    goToRelativeCrop,
    handleCreatePlantingPlan,
    handleDelete,
    handleEdit,
    handleExportAllCrops,
    handleExportCurrentCrop,
    handleImportFileTrigger,
    selectedCrop,
    selectedCropId,
    t,
  ]);

  useRegisterCommands('crops-page', commandSpecs);




  if (shouldShowProjectRequiredState && missingProjectReason) {
    return (
      <PageContainer variant="xwide">
        <ProjectRequiredState reason={missingProjectReason} />
      </PageContainer>
    );
  }

  return (
    <PageContainer variant="xwide">

      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        <CropDetail
          crops={crops}
          isLoading={isCropsLoading}
          selectedCropId={selectedCropId}
          onCropSelect={handleCropSelect}
          onNavigateToVariety={handleVarietyRowNavigate}
          searchInputRef={searchInputRef}
          onCreateCrop={handleAddNew}
          onOpenPublicLibrary={() => {
            void handleOpenPublicLibrary();
          }}
          onEditCrop={handleEdit}
          onAddVariety={handleAddVariety}
          onCreatePlan={handleCreatePlantingPlan}
          onOpenHistory={handleOpenHistory}
          onExportCrop={handleExportCurrentCrop}
          onPublishCrop={handleRequestPublishCrop}
          onPublicUpdateApplied={() => {
            void fetchCrops();
          }}
          onDeleteCrop={handleDelete}
          canCreatePlan={canCreatePlantingPlan}
          createPlanDisabledTooltip={createPlanDisabledTooltip}
          isPublishingCrop={Boolean(selectedCrop && publishingCropId === selectedCrop.id)}
        />
      </Box>
      {crops.length > 0 && (
        <Box sx={{ mb: 2 }}>
          {planRequirementEmptyState ? (
            <EmptyStateCard
              title={planRequirementEmptyState.title}
              description={planRequirementEmptyState.description}
              actions={planRequirementActions}
              containerSx={PLANTING_PLAN_REQUIREMENT_EMPTY_STATE_CONTAINER_SX}
              titleSx={PLANTING_PLAN_REQUIREMENT_EMPTY_STATE_TITLE_SX}
            />
          ) : null}
        </Box>
      )}

      <PublicCropLibraryDialog
        open={publicLibraryOpen}
        loading={publicLibraryLoading}
        error={publicLibraryError}
        crops={publicCrops}
        importingId={publicLibraryImportingId}
        initialSelectedId={publicLibraryInitialSelectedId}
        initialQuery={publicLibraryInitialQuery}
        onClose={() => setPublicLibraryOpen(false)}
        onSearch={(query) => {
          void fetchPublicCrops(query);
        }}
        onImport={(crop) => {
          void handleImportPublicCrop(crop);
        }}
      />

      <ConfirmationDialog
        open={Boolean(deleteDialogCrop)}
        fullWidth
        title={t('deleteDialog.title')}
        message={deleteDialogMessage}
        cancelLabel={t('common:actions.cancel')}
        confirmLabel={t('buttons.delete')}
        onCancel={() => {
          setDeleteDialogCrop(null);
          setDeleteDialogImpact(null);
        }}
        onConfirm={handleDeleteConfirm}
        titleSx={{ pb: 1 }}
        contentSx={{ pt: 1 }}
        messageTypographyProps={{ variant: 'body1', color: 'text.secondary' }}
        actionsSx={{ px: 3, pb: 2.5, pt: 1 }}
        cancelButtonProps={{ variant: 'outlined' }}
        confirmButtonProps={{ color: 'error', variant: 'contained' }}
      />

      <CropsPublishingWizardDialog
        open={publishWizardOpen}
        crop={selectedCrop}
        varieties={publishWizardVarieties}
        termsAlreadyAccepted={Boolean(user?.public_library_terms_accepted)}
        publishing={Boolean(selectedCrop && publishingCropId === selectedCrop.id)}
        onClose={() => setPublishWizardOpen(false)}
        onPublish={handlePublishingWizardPublish}
      />

      {showForm ? (
        <CropForm
          crop={editingCrop}
          crops={crops}
          onSave={handleSave}
          onCancel={handleCancel}
          onSwitchToAddVariety={handleAddVariety}
          formKind={cropFormKind}
          initialDraft={initialFormDraft}
        />
      ) : null}

      <CropsImportStartDialog
        open={importStartDialogOpen}
        onClose={() => setImportStartDialogOpen(false)}
        onFileSelected={(file) => void handleImportFileSelected(file)}
        t={t}
      />

      <CropsImportDialog
        open={importDialogOpen}
        importState={importState}
        hasImportableEntries={hasImportableEntries}
        confirmUpdates={confirmUpdates}
        onConfirmUpdatesChange={setConfirmUpdates}
        onClose={handleImportDialogClose}
        onImportStart={() => void handleImportStart()}
        t={t}
      />

      <CropsExportDialog
        open={exportDialogOpen}
        hasCurrentCrop={Boolean(selectedCrop)}
        initialScope={exportDialogInitialScope}
        onClose={() => setExportDialogOpen(false)}
        onExport={handleExport}
        t={t}
      />

      {/* Snackbar for notifications */}

      <CropsHistoryDialog
        open={historyOpen}
        scope={historyScope}
        items={historyItems}
        isMobile={isMobile}
        fallbackActorLabel={fallbackHistoryActorLabel}
        onClose={() => setHistoryOpen(false)}
        onRestore={handleRestoreVersion}
        t={t}
      />



      <AlertSnackbar
        open={snackbar.open}
        autoHideDuration={4200}
        onClose={handleCloseSnackbar}
        message={snackbar.message}
        severity={snackbar.severity}
        variant="filled"
        snackbarSx={{
          '& .MuiAlert-root': {
            borderRadius: 2,
            boxShadow: 4,
          },
        }}
        alertSx={{
          width: '100%',
          alignItems: 'center',
          fontWeight: 500,
        }}
      />
      {pendingCropDeletions.map((deletion, index) => (
        <DeleteUndoSnackbar
          key={deletion.id}
          open={deletion.visible}
          message={deletion.message}
          undoLabel={t('common:actions.undo')}
          offsetIndex={index}
          testId="crop-delete-snackbar"
          onClose={() => closePendingCropDeletionSnackbar(deletion.id)}
          onUndo={() => undoPendingCropDeletion(deletion.id)}
        />
      ))}
    </PageContainer>
  );
}
export default Crops;
