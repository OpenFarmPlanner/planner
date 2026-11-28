import { useCallback, useState } from 'react';
import type { TFunction } from 'i18next';
import type { GridRowModesModel } from '@mui/x-data-grid';
import { bedAPI, fieldAPI, locationAPI, type Bed, type Field, type Location as FarmLocation } from '../../../api/api';
import { extractApiErrorMessage } from '../../../api/errors';
import { retireInsteadOfDelete } from '../geometryChange/geometryChangeBridge';
import { createTransientId } from '../../../utils/transientId';
import type { HierarchyRow } from '../utils/types';
import { hasPersistedEntityId } from '../utils/hierarchyUtils';

export type PendingHierarchyDeletionType = 'location' | 'field' | 'bed';

export interface PendingHierarchyDeletion {
  id: string;
  type: PendingHierarchyDeletionType;
  targetId: number;
  message: string;
  locations: FarmLocation[];
  fields: Field[];
  beds: Bed[];
  expandedRowsBeforeDelete: Set<string | number>;
  visible: boolean;
}

interface UseHierarchyDeleteParams {
  locations: FarmLocation[];
  fields: Field[];
  beds: Bed[];
  expandedRows: Set<string | number>;
  fetchData: (options?: { showLoading?: boolean }) => Promise<void>;
  expandAll: (ids: (string | number)[]) => void;
  setLocations: (updater: (prev: FarmLocation[]) => FarmLocation[]) => void;
  setFields: (updater: (prev: Field[]) => Field[]) => void;
  setBeds: (updater: (prev: Bed[]) => Bed[]) => void;
  setSelectedRowId: React.Dispatch<React.SetStateAction<string | number | null>>;
  setError: (error: string) => void;
  onPendingDeletionCountChange?: (count: number) => void;
  t: TFunction;
  rowSnapshotRef?: React.MutableRefObject<Map<string, HierarchyRow>>;
  setRowModesModel?: React.Dispatch<React.SetStateAction<GridRowModesModel>>;
  setDraftValidationWarning?: (warning: string) => void;
}

interface UseHierarchyDeleteResult {
  pendingDeletions: PendingHierarchyDeletion[];
  deleteHierarchyRowWithUndo: (row: HierarchyRow) => Promise<void>;
  undoPendingDeletion: (deletionId: string) => Promise<void>;
  closePendingDeletionSnackbar: (deletionId: string) => void;
}

function buildLocationRestorePayload(location: FarmLocation): FarmLocation {
  return {
    name: location.name,
    address: location.address,
    description: location.description,
    soil_type: location.soil_type,
    exposure: location.exposure,
    latitude: location.latitude,
    longitude: location.longitude,
    notes: location.notes,
  };
}

function buildFieldRestorePayload(field: Field, location: number): Field {
  return {
    name: field.name,
    location,
    area_sqm: field.area_sqm,
    length_m: field.length_m,
    width_m: field.width_m,
    notes: field.notes,
  };
}

function buildBedRestorePayload(bed: Bed, field: number): Bed {
  return {
    name: bed.name,
    field,
    area_sqm: bed.area_sqm,
    length_m: bed.length_m,
    width_m: bed.width_m,
    notes: bed.notes,
  };
}

export function useHierarchyDelete({
  locations,
  fields,
  beds,
  expandedRows,
  fetchData,
  expandAll,
  setLocations,
  setFields,
  setBeds,
  setSelectedRowId,
  setError,
  onPendingDeletionCountChange,
  t,
  rowSnapshotRef,
  setRowModesModel,
  setDraftValidationWarning,
}: UseHierarchyDeleteParams): UseHierarchyDeleteResult {
  const [pendingDeletions, setPendingDeletions] = useState<PendingHierarchyDeletion[]>([]);

  const restoreDeletedItems = useCallback(async (deletion: PendingHierarchyDeletion): Promise<void> => {
    const locationIdMap = new Map<number, number>();
    const fieldIdMap = new Map<number, number>();

    for (const locationItem of deletion.locations) {
      const { id } = locationItem;
      if (typeof id !== 'number') {
        continue;
      }
      const restoredLocation = await locationAPI.create(buildLocationRestorePayload(locationItem));
      if (typeof restoredLocation.data.id === 'number') {
        locationIdMap.set(id, restoredLocation.data.id);
      }
    }

    for (const field of deletion.fields) {
      const { id } = field;
      if (typeof id !== 'number') {
        continue;
      }
      const restoredLocationId = locationIdMap.get(field.location) ?? field.location;
      const restoredField = await fieldAPI.create(buildFieldRestorePayload(field, restoredLocationId));
      if (typeof restoredField.data.id === 'number') {
        fieldIdMap.set(id, restoredField.data.id);
      }
    }

    for (const bed of deletion.beds) {
      const { id } = bed;
      if (typeof id !== 'number') {
        continue;
      }
      const restoredFieldId = fieldIdMap.get(bed.field) ?? bed.field;
      await bedAPI.create(buildBedRestorePayload(bed, restoredFieldId));
    }

    await fetchData();
    expandAll(Array.from(deletion.expandedRowsBeforeDelete));
  }, [expandAll, fetchData]);

  const removePendingDeletion = useCallback((deletionId: string): void => {
    setPendingDeletions((currentDeletions) =>
      currentDeletions.filter((deletion) => deletion.id !== deletionId),
    );
  }, []);

  const undoPendingDeletion = useCallback(async (deletionId: string): Promise<void> => {
    const deletion = pendingDeletions.find((pendingDeletion) => pendingDeletion.id === deletionId);
    if (!deletion) {
      return;
    }

    removePendingDeletion(deletionId);
    try {
      await restoreDeletedItems(deletion);
      setError('');
    } catch (err) {
      await fetchData();
      setError(extractApiErrorMessage(err, t, t('errors.save')));
    }
  }, [fetchData, pendingDeletions, removePendingDeletion, restoreDeletedItems, setError, t]);

  const closePendingDeletionSnackbar = useCallback((deletionId: string): void => {
    removePendingDeletion(deletionId);
  }, [removePendingDeletion]);

  const getDeletionMessage = useCallback((
    rowType: PendingHierarchyDeletionType,
    deletedBedCount: number,
  ): string => {
    if (rowType === 'bed') {
      return t('messages.bedDeleted');
    }
    if (rowType === 'location') {
      if (deletedBedCount > 0) {
        return t('messages.locationAndBedsDeleted', { count: deletedBedCount });
      }
      return t('messages.locationDeleted');
    }
    if (deletedBedCount > 0) {
      return t('messages.fieldAndBedsDeleted', { count: deletedBedCount });
    }
    return t('messages.fieldDeleted');
  }, [t]);

  const deleteHierarchyRowWithUndo = useCallback(async (row: HierarchyRow): Promise<void> => {
    const deletionId = createTransientId(row.type, row.id);
    let deletionType: PendingHierarchyDeletionType;
    let targetId: number | undefined;
    let deletedLocations: FarmLocation[] = [];
    let deletedFields: Field[] = [];
    let deletedBeds: Bed[] = [];

    if (row.type === 'location') {
      deletionType = 'location';
      targetId = row.locationId;
      deletedLocations = locations.filter((locationItem) => locationItem.id === row.locationId);
      const deletedLocationIds = new Set(deletedLocations.map((locationItem) => locationItem.id));
      deletedFields = fields.filter((field) => deletedLocationIds.has(field.location));
      const deletedFieldIds = new Set(deletedFields.map((field) => field.id));
      deletedBeds = beds.filter((bed) => deletedFieldIds.has(bed.field));
    } else if (row.type === 'field') {
      deletionType = 'field';
      targetId = row.fieldId;
      deletedFields = fields.filter((field) => field.id === row.fieldId);
      deletedBeds = beds.filter((bed) => bed.field === row.fieldId);
    } else {
      deletionType = 'bed';
      targetId = row.bedId;
      deletedBeds = beds.filter((bed) => bed.id === row.bedId);
    }

    if (typeof targetId !== 'number') {
      return;
    }

    const deletedLocationIds = new Set(deletedLocations.map((locationItem) => locationItem.id));
    const deletedFieldIds = new Set(deletedFields.map((field) => field.id));
    const deletedBedIds = new Set(deletedBeds.map((bed) => bed.id));

    const removeDeletedItemsFromLocalState = (): void => {
      setLocations((currentLocations) =>
        currentLocations.filter((locationItem) => !deletedLocationIds.has(locationItem.id)),
      );
      setFields((currentFields) =>
        currentFields.filter((field) => !deletedFieldIds.has(field.id)),
      );
      setBeds((currentBeds) =>
        currentBeds.filter((bed) => !deletedBedIds.has(bed.id)),
      );
      setSelectedRowId((currentSelectedRowId) => {
        if (currentSelectedRowId === null) {
          return null;
        }
        const deletedRowIds = new Set<string | number>([
          ...deletedLocations.map((locationItem) => `location-${locationItem.id}`),
          ...deletedFields.map((field) => `field-${field.id}`),
          ...deletedBeds.map((bed) => bed.id).filter((id): id is number => typeof id === 'number'),
        ]);
        return deletedRowIds.has(currentSelectedRowId) ? null : currentSelectedRowId;
      });
    };

    if (!hasPersistedEntityId(targetId)) {
      removeDeletedItemsFromLocalState();
      rowSnapshotRef?.current.delete(String(row.id));
      setRowModesModel?.((currentModel) => {
        const nextModel = { ...currentModel };
        delete nextModel[row.id];
        return nextModel;
      });
      setDraftValidationWarning?.('');
      setError('');
      return;
    }

    const pendingDeletion: PendingHierarchyDeletion = {
      id: deletionId,
      type: deletionType,
      targetId,
      message: getDeletionMessage(deletionType, deletedBeds.length),
      locations: deletedLocations,
      fields: deletedFields,
      beds: deletedBeds,
      expandedRowsBeforeDelete: new Set(expandedRows),
      visible: true,
    };

    try {
      if (deletionType === 'location') {
        await locationAPI.delete(targetId);
      } else if (deletionType === 'field') {
        await fieldAPI.delete(targetId);
      } else {
        await bedAPI.delete(targetId);
      }
    } catch (err) {
      // A used area is retired from a season instead of deleted (#1634).
      const retired = await retireInsteadOfDelete(err);
      if (retired !== null) {
        // The row stays in place; only its status changes, so refresh without the spinner.
        await fetchData({ showLoading: false });
        setError('');
        return;
      }
      await fetchData();
      setError(extractApiErrorMessage(err, t, t('errors.delete')));
      return;
    }

    removeDeletedItemsFromLocalState();
    setError('');
    onPendingDeletionCountChange?.(pendingDeletions.length + 1);
    setPendingDeletions((currentDeletions) => [...currentDeletions, pendingDeletion]);
  }, [
    beds,
    expandedRows,
    fetchData,
    fields,
    getDeletionMessage,
    locations,
    onPendingDeletionCountChange,
    pendingDeletions.length,
    rowSnapshotRef,
    setBeds,
    setDraftValidationWarning,
    setFields,
    setLocations,
    setRowModesModel,
    setSelectedRowId,
    setError,
    t,
  ]);

  return {
    pendingDeletions,
    deleteHierarchyRowWithUndo,
    undoPendingDeletion,
    closePendingDeletionSnackbar,
  };
}
