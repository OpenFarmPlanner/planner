import { useCallback } from 'react';
import { GridRowModes } from '@mui/x-data-grid';
import type { GridApi, GridColDef, GridRowId, GridRowModesModel } from '@mui/x-data-grid';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { EditableRow } from '../types';
import { scrollCellIntoView } from '../keyboardNavigation';

interface ScrollFocusGridApi {
  getVisibleColumns: () => { field: string }[];
  getRowIndexRelativeToVisibleRows: (id: GridRowId) => number;
  scrollToIndexes: (params: { rowIndex?: number; colIndex?: number }) => void;
  setCellFocus: (id: GridRowId, field: string) => void;
}

// Scrolls a row into view and, unless `focus: false`, moves keyboard focus
// onto its first non-action column — deferred to the next animation frame
// since the row may not exist in the grid's virtualized viewport until
// after the current render pass (e.g. right after an expand/select state
// change). Shared by focusTable and openRowById below.
function scrollAndFocusRow(
  api: ScrollFocusGridApi,
  rowId: GridRowId,
  options: { focus?: boolean; delayFrames?: number } = {},
): void {
  const firstField = api.getVisibleColumns()
    .find((col) => col.field !== 'actions' && col.field !== 'rowEditActions')?.field;
  const delayFrames = Math.max(1, options.delayFrames ?? 1);
  const run = (remainingFrames: number): void => {
    requestAnimationFrame(() => {
      if (remainingFrames > 1) {
        run(remainingFrames - 1);
        return;
      }

      if (firstField) {
        // Resolves the column index against the visible columns (see
        // scrollCellIntoView) — MUI's own getColumnIndexRelativeToVisibleColumns
        // counts hidden columns too and makes scrollToIndexes throw.
        scrollCellIntoView(api, { id: rowId, field: firstField });
      } else {
        api.scrollToIndexes({ rowIndex: api.getRowIndexRelativeToVisibleRows(rowId) });
      }
      if (options.focus !== false && firstField) {
        api.setCellFocus(rowId, firstField);
      }
    });
  };
  run(delayFrames);
}

interface UseDataGridRowCommandsParams<T extends EditableRow> {
  gridApiRef: RefObject<GridApi | null>;
  rowsById: Map<string, T>;
  columns: GridColDef[];
  selectedRowIds: GridRowId[];
  setSelectedRowIds: Dispatch<SetStateAction<GridRowId[]>>;
  setRowModesModel: Dispatch<SetStateAction<GridRowModesModel>>;
  rowSnapshotRef: MutableRefObject<Map<string, T>>;
  ensureRowVisible?: (rowId: GridRowId) => boolean;
  isReadOnlyRow?: (row: T) => boolean;
}

export function useDataGridRowCommands<T extends EditableRow>({
  gridApiRef,
  rowsById,
  columns,
  selectedRowIds,
  setSelectedRowIds,
  setRowModesModel,
  rowSnapshotRef,
  ensureRowVisible,
  isReadOnlyRow,
}: UseDataGridRowCommandsParams<T>) {
  const handleEditSelectedRow = useCallback((): void => {
    const selectedRowId = selectedRowIds[0];
    const row = rowsById.get(String(selectedRowId));
    if (!selectedRowId || (row && isReadOnlyRow?.(row))) {
      return;
    }

    setRowModesModel((oldModel) => ({
      ...oldModel,
      [selectedRowId]: { mode: GridRowModes.Edit, fieldToFocus: columns[0]?.field },
    }));
  }, [columns, isReadOnlyRow, rowsById, selectedRowIds, setRowModesModel]);

  const handleStartRowEdit = useCallback((rowId: GridRowId, field?: string): void => {
    const rowKey = String(rowId);
    const row = rowsById.get(rowKey);
    if (row && isReadOnlyRow?.(row)) return;
    if (row && !rowSnapshotRef.current.has(rowKey)) {
      rowSnapshotRef.current.set(rowKey, row);
    }

    const fieldToFocus = field ?? columns.find((column) => column.editable !== false)?.field ?? columns[0]?.field;
    setRowModesModel((oldModel) => ({
      ...oldModel,
      [rowId]: { mode: GridRowModes.Edit, fieldToFocus },
    }));
  }, [columns, isReadOnlyRow, rowSnapshotRef, rowsById, setRowModesModel]);

  const focusTable = useCallback((): void => {
    const api = gridApiRef.current;
    if (!api) return;
    const targetId = selectedRowIds[0] ?? api.getAllRowIds()[0];
    if (targetId == null) return;
    const changedPage = ensureRowVisible?.(targetId) ?? false;
    scrollAndFocusRow(api, targetId, { delayFrames: changedPage ? 2 : 1 });
  }, [ensureRowVisible, gridApiRef, selectedRowIds]);

  // Scrolls to and selects a specific row by id, optionally opening edit
  // mode on it — used by pages that deep-link into this grid (e.g.
  // "Anbauplan öffnen"/"bearbeiten" from the Gantt calendar's context menu)
  // instead of just prefilling a brand-new draft row via `initialRow`.
  const openRowById = useCallback((rowId: GridRowId, options?: { startEdit?: boolean }): void => {
    const api = gridApiRef.current;
    const row = rowsById.get(String(rowId));
    if (!api || !row) return;
    const shouldStartEdit = options?.startEdit !== false && !isReadOnlyRow?.(row);
    setSelectedRowIds([rowId]);
    const changedPage = ensureRowVisible?.(rowId) ?? false;
    // Edit mode moves focus into its own input via handleStartRowEdit's
    // `fieldToFocus` below; only move keyboard focus here for the
    // view-only (non-edit) case.
    scrollAndFocusRow(api, rowId, { focus: !shouldStartEdit, delayFrames: changedPage ? 2 : 1 });
    if (shouldStartEdit) {
      handleStartRowEdit(rowId);
    }
  }, [ensureRowVisible, gridApiRef, handleStartRowEdit, isReadOnlyRow, rowsById, setSelectedRowIds]);

  return {
    handleEditSelectedRow,
    handleStartRowEdit,
    focusTable,
    openRowById,
  };
}
