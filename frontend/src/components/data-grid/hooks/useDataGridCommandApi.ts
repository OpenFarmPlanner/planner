import { useEffect } from 'react';
import { GridRowModes } from '@mui/x-data-grid';
import type { GridRowId, GridRowModesModel } from '@mui/x-data-grid';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { EditableDataGridCommandApi, EditableRow } from '../types';

interface UseDataGridCommandApiParams<T extends EditableRow> {
  commandApiRef?: MutableRefObject<EditableDataGridCommandApi | null>;
  selectedRowIds: GridRowId[];
  deleteRowCommandRef: MutableRefObject<(rowId: GridRowId) => void>;
  handleAddClick: () => void;
  handleEditSelectedRow: () => void;
  handleDeleteSelectedRow: () => void;
  setRowModesModel: Dispatch<SetStateAction<GridRowModesModel>>;
  applyDraftValues: (rowId: GridRowId, values: Partial<T>) => Promise<void>;
  commitDraftValues: (rowId: GridRowId, values: Partial<T>) => Promise<void>;
  applyDialogEditValues: (rowId: GridRowId, values: Partial<T>) => Promise<boolean>;
  applySavedRowValues: (rowId: GridRowId, values: Partial<T>) => void;
  reload: () => Promise<void>;
  focusTable: () => void;
  openRowById: (rowId: GridRowId, options?: { startEdit?: boolean }) => void;
}

export function useDataGridCommandApi<T extends EditableRow>({
  commandApiRef,
  selectedRowIds,
  deleteRowCommandRef,
  handleAddClick,
  handleEditSelectedRow,
  handleDeleteSelectedRow,
  setRowModesModel,
  applyDraftValues,
  commitDraftValues,
  applyDialogEditValues,
  applySavedRowValues,
  reload,
  focusTable,
  openRowById,
}: UseDataGridCommandApiParams<T>): void {
  useEffect(() => {
    if (!commandApiRef) {
      return;
    }

    commandApiRef.current = {
      addRow: handleAddClick,
      editSelectedRow: handleEditSelectedRow,
      deleteSelectedRow: handleDeleteSelectedRow,
      deleteRow: (rowId) => deleteRowCommandRef.current(rowId),
      getSelectedRowId: () => selectedRowIds[0] ?? null,
      setDraftValues: async (rowId, values) => {
        await applyDraftValues(rowId, values as Partial<T>);
        setRowModesModel((previousModel) => ({
          ...previousModel,
          [rowId]: {
            ...(previousModel[rowId] ?? {}),
            mode: GridRowModes.Edit,
          },
        }));
      },
      commitDraftValues: async (rowId, values) => {
        await commitDraftValues(rowId, values as Partial<T>);
      },
      applyDialogEditValues: (rowId, values) => applyDialogEditValues(rowId, values as Partial<T>),
      applySavedRowValues: (rowId, values) => applySavedRowValues(rowId, values as Partial<T>),
      reload,
      focusTable,
      openRowById,
    };

    return () => {
      commandApiRef.current = null;
    };
  }, [
    applyDialogEditValues,
    applySavedRowValues,
    applyDraftValues,
    commandApiRef,
    commitDraftValues,
    deleteRowCommandRef,
    focusTable,
    handleAddClick,
    handleDeleteSelectedRow,
    handleEditSelectedRow,
    openRowById,
    reload,
    selectedRowIds,
    setRowModesModel,
  ]);
}
