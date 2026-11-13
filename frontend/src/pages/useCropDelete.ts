import { useState, useRef, useCallback, useEffect } from 'react';
import type React from 'react';
import { cropAPI, type Crop } from '../api/api';
import type { CropDeletePreview } from '../api/types';
import { useTranslation } from '../i18n';
import { extractApiErrorMessage } from '../api/errors';
import { DELETE_UNDO_DURATION_MS } from '../components/data-grid';
import { createTransientId } from '../utils/transientId';
import { getCropSpeciesKey } from '../crops/cropHierarchy';

export interface PendingCropDeletion {
  id: string;
  cropId: number;
  cropIds: number[];
  crop: Crop;
  deletedCrops: Crop[];
  cropsBeforeDelete: Crop[];
  message: string;
  selectedCropIdBeforeDelete?: number;
  visible: boolean;
}

export type CropDeleteImpact = CropDeletePreview & {
  loading: boolean;
};

interface UseCropDeleteConfig {
  crops: Crop[];
  setCrops: React.Dispatch<React.SetStateAction<Crop[]>>;
  selectedCropId: number | undefined;
  updateSelectedCropId: (id: number | undefined, source: 'internal' | 'query') => void;
  showSnackbar: (message: string, severity: 'success' | 'error' | 'info') => void;
}

export function useCropDelete({
  crops,
  setCrops,
  selectedCropId,
  updateSelectedCropId,
  showSnackbar,
}: UseCropDeleteConfig) {
  const { t } = useTranslation(['crops', 'common']);

  const [deleteDialogCrop, setDeleteDialogCrop] = useState<Crop | null>(null);
  const [deleteDialogImpact, setDeleteDialogImpact] = useState<CropDeleteImpact | null>(null);
  const [pendingCropDeletions, setPendingCropDeletions] = useState<PendingCropDeletion[]>([]);
  const pendingCropDeleteTimersRef = useRef<Map<string, number>>(new Map());

  const buildLocalDeleteImpact = useCallback((crop: Crop): CropDeleteImpact => {
    const speciesKey = getCropSpeciesKey(crop);
    const group = crops.filter((candidate) => getCropSpeciesKey(candidate) === speciesKey);
    const hasGeneralEntry = group.some((candidate) => !(candidate.variety ?? '').trim());
    const deletesWholeGroup = !(crop.variety ?? '').trim() || !hasGeneralEntry;
    const affectedCrops = deletesWholeGroup ? group : [crop];
    const varieties = affectedCrops
      .filter((candidate) => (candidate.variety ?? '').trim())
      .map((candidate) => ({
        id: candidate.id ?? 0,
        name: (candidate.variety ?? '').trim() || candidate.name,
      }))
      .filter((candidate) => candidate.id > 0);

    return {
      crop_ids: affectedCrops
        .map((candidate) => candidate.id)
        .filter((id): id is number => typeof id === 'number'),
      varieties,
      variety_count: varieties.length,
      planning_data_count: 0,
      deletes_general_crop: !(crop.variety ?? '').trim(),
      group_without_general: Boolean((crop.variety ?? '').trim()) && !hasGeneralEntry,
      ambiguous_general_group: group.filter((candidate) => !candidate.variety?.trim()).length > 1,
      loading: true,
    };
  }, [crops]);

  const handleDelete = (crop: Crop) => {
    setDeleteDialogCrop(crop);
    setDeleteDialogImpact(buildLocalDeleteImpact(crop));
    const cropId = crop.id;
    if (cropId) {
      void cropAPI.deletePreview(cropId)
        .then((response) => {
          setDeleteDialogImpact((currentImpact) => (
            currentImpact && currentImpact.crop_ids.includes(cropId)
              ? { ...response.data, loading: false }
              : currentImpact
          ));
        })
        .catch((error) => {
          console.error('Error loading crop delete preview:', error);
          setDeleteDialogImpact((currentImpact) => (
            currentImpact ? { ...currentImpact, loading: false } : currentImpact
          ));
        });
    }
  };

  const removePendingCropDeletion = useCallback((deletionId: string): void => {
    setPendingCropDeletions((currentDeletions) =>
      currentDeletions.filter((deletion) => deletion.id !== deletionId),
    );
  }, []);

  const restorePendingCropDeletion = useCallback((deletion: PendingCropDeletion): void => {
    setCrops((currentCrops) => {
      if (currentCrops.some((crop) => crop.id === deletion.cropId)) {
        return currentCrops;
      }
      const currentById = new Map<number, Crop>();
      currentCrops.forEach((crop) => {
        if (typeof crop.id === 'number') {
          currentById.set(crop.id, crop);
        }
      });
      deletion.deletedCrops.forEach((crop) => {
        if (typeof crop.id === 'number') {
          currentById.set(crop.id, crop);
        }
      });
      const restoredCrops = deletion.cropsBeforeDelete
        .map((crop) => (typeof crop.id === 'number' ? currentById.get(crop.id) : crop))
        .filter((crop): crop is Crop => Boolean(crop));
      const restoredIds = new Set(restoredCrops.map((crop) => crop.id));
      return [
        ...restoredCrops,
        ...currentCrops.filter((crop) => !restoredIds.has(crop.id)),
      ];
    });
    if (
      deletion.selectedCropIdBeforeDelete !== undefined
      && deletion.cropIds.includes(deletion.selectedCropIdBeforeDelete)
    ) {
      updateSelectedCropId(deletion.selectedCropIdBeforeDelete, 'internal');
    }
  }, [setCrops, updateSelectedCropId]);

  const expirePendingCropDeletion = useCallback((deletion: PendingCropDeletion): void => {
    pendingCropDeleteTimersRef.current.delete(deletion.id);
    removePendingCropDeletion(deletion.id);
  }, [removePendingCropDeletion]);

  const undoPendingCropDeletion = useCallback(async (deletionId: string): Promise<void> => {
    const deletion = pendingCropDeletions.find((pendingDeletion) => pendingDeletion.id === deletionId);
    if (!deletion) {
      return;
    }

    const timerId = pendingCropDeleteTimersRef.current.get(deletionId);
    if (timerId !== undefined) {
      window.clearTimeout(timerId);
      pendingCropDeleteTimersRef.current.delete(deletionId);
    }

    try {
      await cropAPI.undelete(deletion.cropId);
      restorePendingCropDeletion(deletion);
      removePendingCropDeletion(deletionId);
    } catch (error) {
      console.error('Error restoring crop:', error);
      showSnackbar(extractApiErrorMessage(error, t, t('messages.restoreDeleteError')), 'error');
    }
  }, [pendingCropDeletions, removePendingCropDeletion, restorePendingCropDeletion, showSnackbar, t]);

  const closePendingCropDeletionSnackbar = useCallback((deletionId: string): void => {
    setPendingCropDeletions((currentDeletions) =>
      currentDeletions.map((deletion) =>
        deletion.id === deletionId ? { ...deletion, visible: false } : deletion,
      ),
    );
  }, []);

  useEffect(() => {
    const pendingCropDeleteTimers = pendingCropDeleteTimersRef.current;
    return () => {
      pendingCropDeleteTimers.forEach((timerId) => window.clearTimeout(timerId));
      pendingCropDeleteTimers.clear();
    };
  }, []);

  const handleDeleteConfirm = async (): Promise<void> => {
    if (!deleteDialogCrop?.id) {
      return;
    }

    const cropId = deleteDialogCrop.id;
    const affectedCropIds = deleteDialogImpact?.crop_ids.length
      ? deleteDialogImpact.crop_ids
      : [cropId];
    if (pendingCropDeletions.some((deletion) => deletion.cropIds.includes(cropId))) {
      setDeleteDialogCrop(null);
      setDeleteDialogImpact(null);
      return;
    }

    const deletionId = createTransientId('crop', cropId);
    const currentCrops = crops;
    const deletedCropIndex = currentCrops.findIndex((crop) => crop.id === cropId);
    const affectedCropIdSet = new Set(affectedCropIds);
    const deletedCrops = currentCrops.filter((crop) => (
      typeof crop.id === 'number' && affectedCropIdSet.has(crop.id)
    ));
    const deletionMessage = deleteDialogImpact?.group_without_general && deleteDialogImpact.variety_count > 1
      ? t('messages.varietiesDeleted')
      : (deleteDialogCrop.variety ?? '').trim()
        ? t('messages.varietyDeleted')
        : t('messages.deleted');
    const pendingDeletion: PendingCropDeletion = {
      id: deletionId,
      cropId,
      cropIds: affectedCropIds,
      crop: deleteDialogCrop,
      deletedCrops,
      cropsBeforeDelete: currentCrops,
      message: deletionMessage,
      selectedCropIdBeforeDelete: selectedCropId,
      visible: true,
    };

    setDeleteDialogCrop(null);
    setDeleteDialogImpact(null);

    try {
      await cropAPI.delete(cropId);
    } catch (error) {
      console.error('Error deleting crop:', error);
      showSnackbar(extractApiErrorMessage(error, t, t('messages.deleteError')), 'error');
      return;
    }

    setCrops((currentItems) => currentItems.filter((crop) => (
      typeof crop.id !== 'number' || !affectedCropIdSet.has(crop.id)
    )));
    if (selectedCropId !== undefined && affectedCropIdSet.has(selectedCropId)) {
      const nextSelectedCrop =
        currentCrops.slice(deletedCropIndex + 1).find((crop) => (
          typeof crop.id !== 'number' || !affectedCropIdSet.has(crop.id)
        )) ??
        currentCrops.slice(0, deletedCropIndex).reverse().find((crop) => (
          typeof crop.id !== 'number' || !affectedCropIdSet.has(crop.id)
        )) ??
        null;
      updateSelectedCropId(nextSelectedCrop?.id, 'internal');
    }
    setPendingCropDeletions((currentDeletions) => [...currentDeletions, pendingDeletion]);

    const timerId = window.setTimeout(() => {
      expirePendingCropDeletion(pendingDeletion);
    }, DELETE_UNDO_DURATION_MS);
    pendingCropDeleteTimersRef.current.set(deletionId, timerId);
  };

  return {
    deleteDialogCrop,
    deleteDialogImpact,
    setDeleteDialogCrop,
    setDeleteDialogImpact,
    pendingCropDeletions,
    handleDelete,
    handleDeleteConfirm,
    undoPendingCropDeletion,
    closePendingCropDeletionSnackbar,
  };
}
