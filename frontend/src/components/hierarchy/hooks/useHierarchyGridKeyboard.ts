import { useCallback } from "react";
import { GridRowModes } from "@mui/x-data-grid";
import type {
  GridCellParams,
  GridColDef,
  GridRowId,
  GridRowModesModel,
} from "@mui/x-data-grid";
import { handleEditableCellClick } from "../../data-grid/handlers";
import {
  focusKeyboardNavigableCell,
  getDatasetEdgeKeyboardNavigationTarget,
  getKeyboardNavigationTarget,
  getPagingKeyboardNavigationTarget,
} from "../../data-grid/keyboardNavigation";
import { useSpreadsheetEditStarter } from "../../data-grid/keyboardEditing";
import type { HierarchyRow } from "../utils/types";

type HierarchyKeyboardEvent = React.KeyboardEvent & {
  defaultMuiPrevented?: boolean;
};

interface HierarchyGridKeyboardApi {
  getAllRowIds?: () => GridRowId[];
  getCellElement?: (id: GridRowId, field: string) => HTMLElement | null;
  getCellParams?: (id: GridRowId, field: string) => GridCellParams<HierarchyRow>;
  getRowIndexRelativeToVisibleRows?: (id: GridRowId) => number;
  getVisibleColumns?: () => GridColDef<HierarchyRow>[];
  isCellEditable?: (params: GridCellParams<HierarchyRow>) => boolean;
  scrollToIndexes?: (indexes: { rowIndex?: number; colIndex?: number }) => void;
  setCellFocus?: (id: GridRowId, field: string) => void;
  setEditCellValue?: (params: { id: GridRowId; field: string; value: unknown }) => Promise<boolean> | boolean | void;
  stopRowEditMode?: (params: { id: GridRowId }) => void;
}

interface UseHierarchyGridKeyboardParams {
  columns: GridColDef<HierarchyRow>[];
  discardRowEdit: (rowId: GridRowId) => void;
  deferCrossRowEditOnClick?: boolean;
  gridApiRef: {
    current?: HierarchyGridKeyboardApi | null;
  };
  isCellFocusable: (row: HierarchyRow, field: string) => boolean;
  isHierarchyCellAction: (params: GridCellParams<HierarchyRow>) => boolean;
  notesEditor: {
    handleOpen: (rowId: GridRowId, field: string) => void;
  };
  openContextMenuForRow: (
    row: HierarchyRow,
    mouseX: number,
    mouseY: number,
    origin?: HTMLElement | null,
  ) => void;
  rememberFocusedField: (field: string) => void;
  rememberRowSnapshot: (rowId: GridRowId) => void;
  // Ensures the target row's page is loaded (paging the continuous-scroll
  // row window when needed) before running `action` — see
  // FieldsBedsHierarchy.tsx's `runAfterRowVisibleOnPage`. Used for Home/End/
  // PageUp/PageDown, which can jump beyond the hierarchy's currently
  // mounted internal row window.
  runAfterRowVisible: (rowId: GridRowId, action: () => void) => void;
  // How many rows currently fit in the grid's visible scroll viewport —
  // the PageUp/PageDown step size. See
  // `getViewportRowPageSize` in `keyboardNavigation.ts` for why this is
  // measured from the DOM rather than MUI's own apiRef method.
  getViewportRowPageSize: () => number;
  rowModesModel: GridRowModesModel;
  rows: readonly HierarchyRow[];
  rowsById: Map<string, HierarchyRow>;
  selectRow: (rowId: GridRowId) => void;
  setRowModesModel: React.Dispatch<React.SetStateAction<GridRowModesModel>>;
  setTreeActive: (active: boolean) => void;
  // Ends a row's edit session the same way clicking outside the grid does:
  // MUI's real stopRowEditMode never reaches processRowUpdate for a row with
  // an empty required "name" cell (the column's preProcessEditCellProps
  // marks it errored, and MUI silently refuses to exit edit mode for a row
  // with an errored cell), so this pre-checks for that instead of calling
  // stopRowEditMode directly.
  stopEditingRow: (rowId: GridRowId) => void;
  toggleExpand: (rowId: GridRowId) => void;
}

interface UseHierarchyGridKeyboardResult {
  handleCellClick: (
    params: GridCellParams<HierarchyRow>,
    event?: React.MouseEvent<HTMLElement> & { defaultMuiPrevented?: boolean },
  ) => void;
  handleCellKeyDown: (
    params: GridCellParams<HierarchyRow>,
    event: React.KeyboardEvent,
  ) => void;
}

const isRowEditing = (rowModesModel: GridRowModesModel, rowId: GridRowId): boolean =>
  rowModesModel[rowId]?.mode === GridRowModes.Edit;

const getEditingRowId = (rowModesModel: GridRowModesModel): string | undefined =>
  Object.entries(rowModesModel).find(([, mode]) => mode.mode === GridRowModes.Edit)?.[0];

const shouldSuppressModifiedPrintableViewEdit = (
  event: HierarchyKeyboardEvent,
  rowModesModel: GridRowModesModel,
  rowId: GridRowId,
): boolean => (
  event.key.length === 1
  && event.altKey
  && !isRowEditing(rowModesModel, rowId)
);

export function useHierarchyGridKeyboard({
  columns,
  discardRowEdit,
  deferCrossRowEditOnClick = false,
  gridApiRef,
  isCellFocusable,
  isHierarchyCellAction,
  notesEditor,
  getViewportRowPageSize,
  openContextMenuForRow,
  rememberFocusedField,
  rememberRowSnapshot,
  runAfterRowVisible,
  rowModesModel,
  rows,
  rowsById,
  selectRow,
  setRowModesModel,
  setTreeActive,
  stopEditingRow,
  toggleExpand,
}: UseHierarchyGridKeyboardParams): UseHierarchyGridKeyboardResult {
  const spreadsheetEditStarter = useSpreadsheetEditStarter<HierarchyRow>({
    apiRef: gridApiRef,
    rowModesModel,
    setRowModesModel,
    isCellEditable: (params) => {
      if (!params.isEditable) {
        return false;
      }
      if (!params.row || !('type' in params.row)) {
        return true;
      }
      return params.field !== "notes" && isCellFocusable(params.row, params.field);
    },
    onBeforeEdit: (params) => {
      rememberFocusedField(params.field);
      rememberRowSnapshot(params.id);
      selectRow(params.id);
      setTreeActive(true);
    },
  });

  const navigateCell = useCallback((
    params: GridCellParams<HierarchyRow>,
    event: HierarchyKeyboardEvent,
  ): boolean => {
    const editMode = isRowEditing(rowModesModel, params.id);
    if (
      (editMode && event.key !== "Tab")
      || event.altKey
      || event.ctrlKey
      || event.metaKey
    ) {
      return false;
    }

    const direction = event.key === "ArrowLeft" || event.shiftKey ? -1 : 1;
    const target = event.key === "Tab" || event.key === "ArrowLeft" || event.key === "ArrowRight"
      ? getKeyboardNavigationTarget<HierarchyRow>({
        api: gridApiRef.current,
        columns,
        current: { id: params.id, field: params.field },
        direction,
        isActionCell: isHierarchyCellAction,
        rows,
        wrapRows: event.key === "Tab" && !editMode,
      })
      : null;

    if (!target) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    event.defaultMuiPrevented = true;
    rememberFocusedField(target.field);
    selectRow(target.id);
    setTreeActive(true);
    if (editMode) {
      setRowModesModel((previousModel) => ({
        ...previousModel,
        [target.id]: { mode: GridRowModes.Edit, fieldToFocus: target.field },
      }));
    }
    focusKeyboardNavigableCell<HierarchyRow>({
      api: gridApiRef.current,
      cell: target,
      focusEditInput: editMode,
    });
    return true;
  }, [
    columns,
    gridApiRef,
    isHierarchyCellAction,
    rememberFocusedField,
    rowModesModel,
    rows,
    selectRow,
    setRowModesModel,
    setTreeActive,
  ]);

  // Ctrl/Shift+Home, Ctrl/Shift+End, and PageUp/PageDown resolved against the
  // complete loaded hierarchy (`rows`), not the grid's currently mounted
  // internal row window — see docs/keyboard-architecture.md,
  // "Continuous-scroll paging". Bare Home/End are left to MUI's default
  // handling: they only move within the current row, which is always
  // already visible.
  const navigateEdgeOrPage = useCallback((
    params: GridCellParams<HierarchyRow>,
    event: HierarchyKeyboardEvent,
  ): boolean => {
    if (isRowEditing(rowModesModel, params.id) || event.altKey) {
      return false;
    }

    const isEdgeKey = event.key === "Home" || event.key === "End";
    const isPagingKey = event.key === "PageUp" || event.key === "PageDown";
    if (!isPagingKey && (!isEdgeKey || !(event.ctrlKey || event.metaKey || event.shiftKey))) {
      return false;
    }

    const target = isEdgeKey
      ? getDatasetEdgeKeyboardNavigationTarget<HierarchyRow>({
        api: gridApiRef.current,
        columns,
        edge: event.key === "Home" ? "first" : "last",
        isActionCell: isHierarchyCellAction,
        rows,
      })
      : getPagingKeyboardNavigationTarget<HierarchyRow>({
        api: gridApiRef.current,
        columns,
        current: { id: params.id, field: params.field },
        direction: event.key === "PageDown" ? 1 : -1,
        isActionCell: isHierarchyCellAction,
        pageSize: getViewportRowPageSize(),
        rows,
      });

    // Taken over even when there is nowhere left to go: at the dataset edge
    // MUI's own handling would resolve the key against its mounted page and
    // jump focus to a row this grid doesn't have rendered, losing focus
    // entirely. Standing still is also what a spreadsheet does there.
    event.preventDefault();
    event.stopPropagation();
    event.defaultMuiPrevented = true;
    if (!target) {
      return true;
    }

    rememberFocusedField(target.field);
    selectRow(target.id);
    setTreeActive(true);
    runAfterRowVisible(target.id, () => {
      focusKeyboardNavigableCell<HierarchyRow>({
        api: gridApiRef.current,
        cell: target,
      });
    });
    return true;
  }, [
    columns,
    getViewportRowPageSize,
    gridApiRef,
    isHierarchyCellAction,
    rememberFocusedField,
    rowModesModel,
    rows,
    runAfterRowVisible,
    selectRow,
    setTreeActive,
  ]);

  const handleCellClick = useCallback((
    params: GridCellParams<HierarchyRow>,
    event?: React.MouseEvent<HTMLElement> & { defaultMuiPrevented?: boolean },
  ): void => {
    if (!isCellFocusable(params.row, params.field)) {
      event?.preventDefault();
      event?.stopPropagation();
      if (event) {
        event.defaultMuiPrevented = true;
      }
      return;
    }

    const editingRowId = getEditingRowId(rowModesModel);
    const isChangingEditedRow = editingRowId !== undefined && String(editingRowId) !== String(params.id);
    if (isChangingEditedRow) {
      const rowIdToStop = rowsById.get(editingRowId)?.id ?? editingRowId;
      stopEditingRow(rowIdToStop);
    }

    rememberFocusedField(params.field);
    rememberRowSnapshot(params.id);
    selectRow(params.id);
    setTreeActive(true);
    if (params.isEditable && isRowEditing(rowModesModel, params.id)) {
      setRowModesModel((previousModel) => ({
        ...previousModel,
        [params.id]: { mode: GridRowModes.Edit, fieldToFocus: params.field },
      }));
      focusKeyboardNavigableCell<HierarchyRow>({
        api: gridApiRef.current,
        cell: { id: params.id, field: params.field },
        focusEditInput: true,
      });
      return;
    }
    if (isChangingEditedRow && deferCrossRowEditOnClick) {
      return;
    }
    handleEditableCellClick(params, rowModesModel, setRowModesModel);
  }, [
    deferCrossRowEditOnClick,
    gridApiRef,
    isCellFocusable,
    rememberFocusedField,
    rememberRowSnapshot,
    rowModesModel,
    rowsById,
    selectRow,
    setRowModesModel,
    setTreeActive,
    stopEditingRow,
  ]);

  const handleCellKeyDown = useCallback((
    params: GridCellParams<HierarchyRow>,
    event: React.KeyboardEvent,
  ): void => {
    const keyboardEvent = event as HierarchyKeyboardEvent;
    rememberFocusedField(params.field);

    if (
      keyboardEvent.key === "Tab"
      || keyboardEvent.key === "ArrowLeft"
      || keyboardEvent.key === "ArrowRight"
    ) {
      if (navigateCell(params, keyboardEvent)) {
        return;
      }
    }

    if (
      keyboardEvent.key === "Home"
      || keyboardEvent.key === "End"
      || keyboardEvent.key === "PageUp"
      || keyboardEvent.key === "PageDown"
    ) {
      if (navigateEdgeOrPage(params, keyboardEvent)) {
        return;
      }
    }

    if (keyboardEvent.key === "Escape" && isRowEditing(rowModesModel, params.id)) {
      keyboardEvent.preventDefault();
      keyboardEvent.defaultMuiPrevented = true;
      discardRowEdit(params.id);
      return;
    }

    if (
      params.field === "notes"
      && (keyboardEvent.key === "Enter"
        || keyboardEvent.key === " "
        || keyboardEvent.key === "Spacebar")
    ) {
      keyboardEvent.preventDefault();
      keyboardEvent.stopPropagation();
      keyboardEvent.defaultMuiPrevented = true;
      notesEditor.handleOpen(params.id, "notes");
      return;
    }

    if (
      (keyboardEvent.key === " " || keyboardEvent.key === "Spacebar")
      && params.field !== "notes"
      && !isRowEditing(rowModesModel, params.id)
    ) {
      keyboardEvent.preventDefault();
      keyboardEvent.defaultMuiPrevented = true;
      const row = params.row as HierarchyRow;
      if ((row.type === "location" || row.type === "field") && row.hasChildren) {
        toggleExpand(params.id);
      }
      return;
    }

    if (
      (keyboardEvent.key === "ArrowDown" || keyboardEvent.key === "ArrowUp")
      && !isRowEditing(rowModesModel, params.id)
    ) {
      keyboardEvent.defaultMuiPrevented = true;
    }

    if (spreadsheetEditStarter.startEditFromF2(params, keyboardEvent)) {
      return;
    }

    if (spreadsheetEditStarter.startEditFromPrintableKey(params, keyboardEvent)) {
      return;
    }

    if (shouldSuppressModifiedPrintableViewEdit(keyboardEvent, rowModesModel, params.id)) {
      keyboardEvent.defaultMuiPrevented = true;
    }

    if (keyboardEvent.key === "ContextMenu" || (keyboardEvent.shiftKey && keyboardEvent.key === "F10")) {
      keyboardEvent.preventDefault();
      keyboardEvent.stopPropagation();
      const targetRow = rows.find((row) => row.id === params.id);
      if (targetRow) {
        const targetElement = keyboardEvent.currentTarget as HTMLElement;
        const rect = targetElement.getBoundingClientRect();
        openContextMenuForRow(
          targetRow,
          rect.left + Math.min(240, rect.width),
          rect.top + 12,
          targetElement,
        );
      }
    }
  }, [
    discardRowEdit,
    navigateCell,
    navigateEdgeOrPage,
    notesEditor,
    openContextMenuForRow,
    rememberFocusedField,
    rowModesModel,
    rows,
    spreadsheetEditStarter,
    toggleExpand,
  ]);

  return {
    handleCellClick,
    handleCellKeyDown,
  };
}
