/**
 * Reusable Editable Data Grid component.
 * 
 * Provides Excel-like inline editing with validation and API integration.
 * Supports spreadsheet-like autosave on blur.
 * Can be used for any entity type with proper configuration.
 * UI text is in German, code comments remain in English.
 * 
 * @template T The type of data rows
 * @returns A configurable editable data grid component
 * 
 * @remarks
 * Changes are saved through the row save action.
 * Keyboard navigation commits edit values locally without calling the API.
 * Navigation is blocked if there are unsaved changes (row in edit mode).
 *
 * See docs/datagrid-architecture.md for the full picture of what this adds on
 * top of MUI X DataGrid (imperative command API, custom edit cells, row-action
 * menu, notes cells, copy/paste, column visibility) — note that not every grid
 * page uses this component (FieldsBedsHierarchy.tsx renders a raw MUI
 * DataGrid with its own parallel implementation of several of these patterns).
 */

import { useState, useEffect, useCallback, useRef, useMemo, type KeyboardEvent, type ReactNode } from 'react';
import {
  DataGrid,
  GridPagination,
  GridRowEditStopReasons,
  GridRowModes,
  useGridApiRef,
} from '@mui/x-data-grid';
import { dataGridSx, dataGridFooterSx, dataGridAddRowButtonSx, deleteIconButtonSx } from './styles';
import { handleRowEditStop, handleEditableCellClick } from './handlers';
import {
  editModeEditorArrowKeys,
  getRowIdFromElement,
  isEnterSaveInputTarget,
} from './domEventTargets';
import type { GridColDef, GridRowsProp, GridRowModesModel, GridRowId, GridSortModel, GridFilterModel, GridCellParams, GridRenderCellParams, GridRowParams, GridPaginationModel, GridEventListener } from '@mui/x-data-grid';
import { Box, Alert, IconButton, Chip, Button, useMediaQuery } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/Check';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { CustomContextMenu } from '../contextMenu/CustomContextMenu';
import { ContextMenuActionItem } from '../contextMenu/ContextMenuActionItem';
import { ContextMenuIndicator } from '../contextMenu/ContextMenuIndicator';
import { contextMenuActionsOverlaySx } from '../contextMenu/contextMenuIndicatorStyles';
import { isAnyContextMenuOpen } from '../contextMenu/contextMenuOpenState';
import { useNavigationBlocker } from '../../hooks/autosave';
import { usePersistentSortModel } from '../../hooks/usePersistentSortModel';
import { useTranslation } from '../../i18n';
import { NotesCell } from './NotesCell';
import { NotesDrawer } from './NotesDrawer';
import {
  DeleteUndoSnackbar,
} from './DeleteUndoSnackbar';
import { getPlainExcerpt } from './markdown';
import { useNotesEditor } from './useNotesEditor';
import { useNotesPreview } from './useNotesPreview';
import { NotesPreviewPopover } from './NotesPreviewPopover';
import { extractApiErrorMessage } from '../../api/errors';
import { getDataGridLocaleText } from './localeText';
import { TableCopyMenuItems } from './TableCopyMenuItems';
import { buildClipboardRowValues, buildClipboardTableRows, type TableClipboardRow } from './tableClipboard';
import { ContextMenuHint } from './ContextMenuHint';
import { useContextMenuHint } from './useContextMenuHint';
import { useDataGridCommandApi } from './hooks/useDataGridCommandApi';
import { useDataGridDelete } from './hooks/useDataGridDelete';
import { useDataGridRowActionMenu } from './hooks/useDataGridRowActionMenu';
import { useDataGridRowCommands } from './hooks/useDataGridRowCommands';
import { useScrollDrivenRowWindow } from './hooks/useScrollDrivenRowWindow';
import { useStableDataGridScrollbar } from './hooks/useStableDataGridScrollbar';
import { StableScrollbarTrack } from './StableScrollbarTrack';
import { isContextMenuDismissGestureInProgress } from '../../utils/contextMenu';
import {
  EditCellNavigationContext,
  type EditCellKeyboardEvent,
  type EditCellTabNavigationHandler,
} from './EditCellNavigationContext';
import {
  buildDialogEditCellKey,
  DialogEditCellContext,
  type DialogEditCellContextValue,
  type DialogEditCellRequest,
} from './DialogEditCellContext';
import {
  buildSelectEditCellKey,
  SelectEditCellContext,
  type SelectEditCellContextValue,
  type SelectEditCellOpenRequest,
} from './SelectEditCellContext';
import {
  CONTINUOUS_SCROLL_PAGE_SIZE,
  CONTINUOUS_SCROLL_COMPACT_ROW_HEIGHT_PX,
  DATA_GRID_CONTINUOUS_SCROLL_FOOTER_CLASS,
  CONTINUOUS_SCROLL_REQUESTED_ROW_HEIGHT_PX,
  CONTINUOUS_SCROLL_HEADER_HEIGHT_PX,
  CONTINUOUS_SCROLL_FOOTER_HEIGHT_PX,
  DATA_GRID_VIRTUAL_SCROLLER_SELECTOR,
  cssEscape,
} from './continuousScrollLayout';
import { useContinuousScrollSizing } from './useContinuousScrollSizing';
import {
  buildDefaultClipboardColumns,
  getSortedRowIds,
  isEmptyNewDraftRow,
  isSaveBlockedError,
  isUnsavedDraftRow,
  orderRowsByStableIds,
  prepareDataGridColumn,
  SaveBlockedError,
} from './dataGridUtils';
import { toGridDateValue } from './dateEditCellUtils';
import { mergeVisibleDateEditInputValues, readDraftRow } from './draftRowReaders';
import {
  collectRowValidationErrors,
  hasInvalidRowInEditMode as hasInvalidRowInEditModeState,
} from './rowValidation';
import {
  focusKeyboardNavigableCell as focusDataGridKeyboardNavigableCell,
  getKeyboardNavigationTarget,
  getVerticalKeyboardNavigationTarget,
  getCellLocationFromDomTarget,
  getHorizontalKeyboardNavigationTarget,
  getViewModeNavigationRequest,
  isCellKeyboardNavigable,
  isInteractiveCellTarget,
  preventReadOnlyCellMouseFocus,
  resolveFocusedCellFromEvent,
  scrollCellIntoView,
} from './keyboardNavigation';
import { useSpreadsheetEditStarter } from './keyboardEditing';
import type {
  EditableDataGridClipboardColumn,
  EditableDataGridProps,
  EditableDataGridRowAction,
  EditableDataGridRowActionHelpers,
  EditableRow,
} from './types';

export type {
  DataGridAPI,
  DeleteUndoOptions,
  EditableDataGridClipboardColumn,
  EditableDataGridCommandApi,
  EditableDataGridProps,
  EditableDataGridRowAction,
  EditableDataGridRowActionHelpers,
  EditableRow,
  NotesFieldConfig,
} from './types';
import { AppTooltip } from '../AppTooltip';
import {
  isSelectEditMenuCloseOutsideElement,
  isSelectEditMenuEscapeClose,
  isSelectEditMenuInternalCloseTarget,
} from './selectEditMenuClose';

type DataGridKeyboardEvent = (KeyboardEvent | EditCellKeyboardEvent) & {
  defaultMuiPrevented?: boolean;
};

const wrapNativeKeyboardEvent = (event: globalThis.KeyboardEvent): DataGridKeyboardEvent => ({
  altKey: event.altKey,
  ctrlKey: event.ctrlKey,
  key: event.key,
  metaKey: event.metaKey,
  nativeEvent: event,
  preventDefault: () => event.preventDefault(),
  shiftKey: event.shiftKey,
  stopPropagation: () => event.stopPropagation(),
} as DataGridKeyboardEvent);

export function EditableDataGrid<T extends EditableRow>({
  columns,
  api,
  createNewRow,
  mapToRow,
  mapToApiData,
  validateRow,
  loadErrorMessage,
  saveErrorMessage,
  deleteErrorMessage,
  deleteConfirmMessage,
  addButtonLabel,
  addButtonText,
  showDeleteAction = true,
  initialRow,
  tableKey,
  defaultSortModel = [],
  persistSortInUrl = true,
  notes,
  dialogEditFields,
  commandApiRef,
  onSelectedRowChange,
  getRowValidationErrors,
  showAddAction = true,
  showFooterEditControls = true,
  showRowEditActions = false,
  getRowActions,
  inlineRowActionField,
  getInlineRowActions,
  showInlineRowActionMenu = false,
  duplicateRow,
  deleteUndoOptions,
  clipboardColumns,
  onRowsStateChange,
  onLoadStateChange,
  onBeforeSaveRow,
  isNewRowEmpty = isEmptyNewDraftRow,
  isSaveErrorHandled,
  surfaceSizing,
  paginationPageSizeOptions,
  initialPageSize = 25,
  scrollMode = 'autoHeight',
  columnVisibilityModel,
  onColumnVisibilityModelChange,
}: EditableDataGridProps<T>) {
  const gridApiRef = useGridApiRef();
  const resolvedSurfaceSizing = surfaceSizing ?? 'contentFit';
  const isContentSizedSurface = resolvedSurfaceSizing === 'contentFit' || resolvedSurfaceSizing === 'compact';
  const shouldUseCompactContainer = resolvedSurfaceSizing === 'compact';
  const shouldDisableTrailingFiller = isContentSizedSurface;
  const isContinuousScroll = scrollMode === 'continuous';
  const showPaginationControls = Boolean(paginationPageSizeOptions) && !isContinuousScroll;
  const shouldRenderGridFooter = showAddAction || showFooterEditControls || showPaginationControls;
  const continuousScrollFooterFallbackHeight = shouldRenderGridFooter ? CONTINUOUS_SCROLL_FOOTER_HEIGHT_PX : 0;
  const [rows, setRows] = useState<GridRowsProp<T>>([]);
  const [stableRowOrder, setStableRowOrder] = useState<GridRowId[]>([]);
  const [rowModesModel, setRowModesModel] = useState<GridRowModesModel>({});
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [dataFetched, setDataFetched] = useState<boolean>(false);
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({
    page: 0,
    pageSize: initialPageSize,
  });
  const initialRowProcessedRef = useRef<boolean>(false);
  const initialFetchDoneRef = useRef<boolean>(false);
  const [selectedRowIds, setSelectedRowIds] = useState<GridRowId[]>([]);
  const [dirtyRowIds, setDirtyRowIds] = useState<Set<string>>(new Set());
  const [activeValidationErrors, setActiveValidationErrors] = useState<Record<string, Record<string, string>>>({});
  const rowSnapshotRef = useRef<Map<string, T>>(new Map());
  const rowSavePromisesRef = useRef<Map<string, Promise<T>>>(new Map());
  const canceledRowIdsRef = useRef<Set<string>>(new Set());
  const internalEditNavigationRowIdRef = useRef<string | null>(null);
  const activeEditCellRef = useRef<{ id: GridRowId; field: string } | null>(null);
  const gridSurfaceRef = useRef<HTMLDivElement | null>(null);
  const pageContentRef = useRef<HTMLDivElement | null>(null);
  const horizontalScrollRef = useRef<HTMLDivElement | null>(null);
  const stableScrollbarTrackRef = useRef<HTMLDivElement | null>(null);
  const stableScrollbarThumbRef = useRef<HTMLDivElement | null>(null);
  const isMobile = useMediaQuery('(max-width:900px)');
  
  const { t, i18n } = useTranslation('common');
  const { sortModel, setSortModel, filterModel, setFilterModel } = usePersistentSortModel({
    tableKey: tableKey ?? 'editableDataGrid',
    defaultSortModel,
    allowedFields: columns.map((column) => column.field),
    persistInUrl: persistSortInUrl,
  });
  const rowsForGrid = useMemo(
    () => orderRowsByStableIds(rows as T[], stableRowOrder),
    [rows, stableRowOrder],
  );
  const scrollDrivenRowWindow = useScrollDrivenRowWindow(
    rowsForGrid.length,
    CONTINUOUS_SCROLL_PAGE_SIZE,
    DATA_GRID_VIRTUAL_SCROLLER_SELECTOR,
    gridSurfaceRef,
    { preservePageOnRowCountChange: true },
  );
  const activePaginationModel = useMemo(
    () => (
      isContinuousScroll
        ? { page: scrollDrivenRowWindow.page, pageSize: scrollDrivenRowWindow.pageSize }
        : paginationModel
    ),
    [isContinuousScroll, paginationModel, scrollDrivenRowWindow.page, scrollDrivenRowWindow.pageSize],
  );
  const currentWindowRowCount = isContinuousScroll
    ? Math.max(
      0,
      Math.min(
        scrollDrivenRowWindow.pageSize,
        rowsForGrid.length - scrollDrivenRowWindow.page * scrollDrivenRowWindow.pageSize,
      ),
    )
    : rowsForGrid.length;
  const stableScrollbarRowHeights = useMemo(
    () => (isContinuousScroll && !isMobile ? rowsForGrid.map(() => CONTINUOUS_SCROLL_COMPACT_ROW_HEIGHT_PX) : []),
    [isContinuousScroll, isMobile, rowsForGrid],
  );
  const ensureRowVisible = useCallback((rowId: GridRowId): boolean => {
    if (!isContinuousScroll) {
      return false;
    }
    const rowIndex = rowsForGrid.findIndex((row) => String(row.id) === String(rowId));
    return scrollDrivenRowWindow.ensureRowIndexVisible(rowIndex);
  }, [isContinuousScroll, rowsForGrid, scrollDrivenRowWindow]);

  const runAfterRowVisible = useCallback((rowId: GridRowId, action: () => void): void => {
    const changedPage = ensureRowVisible(rowId);
    if (!changedPage) {
      action();
      return;
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(action);
    });
  }, [ensureRowVisible]);

  useEffect(() => {
    if (!import.meta.env.DEV || (!showPaginationControls && !isContinuousScroll) || loading) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const visibleRowCount = Math.max(
        0,
        Math.min(
          activePaginationModel.pageSize,
          rowsForGrid.length - activePaginationModel.page * activePaginationModel.pageSize,
        ),
      );
      console.debug('[DataGrid diagnostics]', {
        table: tableKey ?? 'editableDataGrid',
        totalRows: rowsForGrid.length,
        visibleRows: visibleRowCount,
        page: activePaginationModel.page + 1,
        pageSize: activePaginationModel.pageSize,
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [
    gridApiRef,
    loading,
    activePaginationModel,
    isContinuousScroll,
    rowsForGrid,
    showPaginationControls,
    tableKey,
  ]);
  const hasContextMenuHintRows = useMemo(
    () => rowsForGrid.some((row) => !isUnsavedDraftRow(row)),
    [rowsForGrid],
  );
  const {
    showContextMenuHint,
    closeContextMenuHint,
    markContextMenuHintUsed,
    showTouchContextMenuHint,
    closeTouchContextMenuHint,
    markTouchContextMenuHintUsed,
  } = useContextMenuHint({
    contextKey: tableKey ?? 'editableDataGrid',
    enabled: dataFetched && !error,
    isLoading: loading,
    hasRows: hasContextMenuHintRows,
  });

  const {
    layoutHeights: continuousScrollLayoutHeights,
    resolvedHeight: resolvedContinuousScrollHeight,
    resolvedBodyHeight: resolvedContinuousScrollBodyHeight,
    shouldHideVerticalOverflow: shouldHideContinuousVerticalOverflow,
    shouldCollapseRenderZone: shouldCollapseContinuousRenderZone,
    scrollbarRightOffsetPx,
  } = useContinuousScrollSizing({
    isContinuousScroll,
    isMobile,
    gridSurfaceRef,
    horizontalScrollRef,
    pageContentRef,
    currentWindowRowCount,
    totalRowCount: rowsForGrid.length,
    footerFallbackHeight: continuousScrollFooterFallbackHeight,
    scrollWindowPage: scrollDrivenRowWindow.page,
    hasErrorBanner: Boolean(error),
    hasContextMenuHint: showContextMenuHint,
    hasTouchContextMenuHint: showTouchContextMenuHint,
  });

  // Placed after useContinuousScrollSizing so both this hook and the track it
  // drives use the same measured header height. MUI renders the column
  // headers inside .MuiDataGrid-virtualScroller, so that container's
  // clientHeight covers them too, and the track is drawn below them — without
  // subtracting the header the thumb's travel range is taller than the track
  // and overflows past its bottom edge on the last internal page. The
  // measured height is what counts, not CONTINUOUS_SCROLL_HEADER_HEIGHT_PX:
  // the grid renders at compact density, which scales that requested height
  // down.
  const stableScrollbar = useStableDataGridScrollbar(
    stableScrollbarRowHeights,
    scrollDrivenRowWindow,
    DATA_GRID_VIRTUAL_SCROLLER_SELECTOR,
    gridSurfaceRef,
    stableScrollbarTrackRef,
    stableScrollbarThumbRef,
    continuousScrollLayoutHeights.header,
  );

  const refreshStableRowOrder = useCallback((sourceRows: readonly T[], model: GridSortModel = sortModel): void => {
    setStableRowOrder(getSortedRowIds(sourceRows, model));
  }, [sortModel]);

  const saveUpdatedRow = useCallback(async (updatedRow: T): Promise<T> => {
    const numericId = Number(updatedRow.id);
    if (numericId < 0 || updatedRow.isNew) {
      setRows((prevRows) =>
        prevRows.map((row) => (row.id === updatedRow.id ? updatedRow : row))
      );
      return updatedRow;
    }

    const apiData = await mapToApiData(updatedRow);
    const response = await api.update(numericId, apiData);
    if (!response.data.id) {
      throw new Error('API response missing ID');
    }

    const savedRow = mapToRow(response.data as T);
    setRows((prevRows) =>
      prevRows.map((row) => (row.id === updatedRow.id ? savedRow : row))
    );
    setError('');
    return savedRow;
  }, [api, mapToApiData, mapToRow]);

  const notesEditor = useNotesEditor({
    rows,
    onSave: async ({ row, field, value }) => {
      const updatedRow = { ...row, [field]: value } as T;
      await saveUpdatedRow(updatedRow);
    },
    onError: (errorMessage) => {
      const extractedError = extractApiErrorMessage(errorMessage, t, saveErrorMessage);
      setError(extractedError);
    },
  });
  const notesPreview = useNotesPreview();

  const hasRowsInEditMode = Object.values(rowModesModel).some(
    (mode) => mode.mode === GridRowModes.Edit
  );
  const hasUnsavedChanges = hasRowsInEditMode || dirtyRowIds.size > 0;
  const notesFieldNames = useMemo(
    () => notes?.fields.map((fieldConfig) => fieldConfig.field) ?? [],
    [notes],
  );
  // Notes and dialog-edited cells share one rule: they own their editor, so the
  // grid never starts inline edit mode for them, but they stay keyboard stops.
  const dedicatedEditorFieldNames = useMemo(
    () => [...notesFieldNames, ...(dialogEditFields ?? [])],
    [dialogEditFields, notesFieldNames],
  );
  const hasDedicatedEditor = useCallback(
    (field: string): boolean => dedicatedEditorFieldNames.includes(field),
    [dedicatedEditorFieldNames],
  );
  // A dialog-edited cell has no inline edit session the grid could start, so
  // explicit edit commands can be expressed as a request its own renderer
  // reacts to. Plain Tab focus must not request a dialog.
  const isDialogEditField = useCallback(
    (field: string): boolean => (dialogEditFields ?? []).includes(field),
    [dialogEditFields],
  );
  const [dialogEditRequest, setDialogEditRequest] = useState<DialogEditCellRequest | null>(null);
  const dialogEditTokenRef = useRef(0);
  const requestDialogEditForCell = useCallback((rowId: GridRowId, field: string): void => {
    if (!isDialogEditField(field)) {
      return;
    }

    dialogEditTokenRef.current += 1;
    setDialogEditRequest({
      cellKey: buildDialogEditCellKey(rowId, field),
      token: dialogEditTokenRef.current,
    });
  }, [isDialogEditField]);
  const consumeDialogEditRequest = useCallback((token: number): void => {
    setDialogEditRequest((current) => (current?.token === token ? null : current));
  }, []);
  const dialogEditCellContextValue = useMemo<DialogEditCellContextValue>(() => ({
    request: dialogEditRequest,
    consumeRequest: consumeDialogEditRequest,
  }), [consumeDialogEditRequest, dialogEditRequest]);
  const [selectEditOpenRequest, setSelectEditOpenRequest] = useState<SelectEditCellOpenRequest | null>(null);
  const selectEditOpenTokenRef = useRef(0);
  const requestSelectEditOpenForCell = useCallback((rowId: GridRowId, field: string): void => {
    selectEditOpenTokenRef.current += 1;
    setSelectEditOpenRequest({
      cellKey: buildSelectEditCellKey(rowId, field),
      token: selectEditOpenTokenRef.current,
    });
  }, []);
  const consumeSelectEditOpenRequest = useCallback((token: number): void => {
    setSelectEditOpenRequest((current) => (current?.token === token ? null : current));
  }, []);

  // Check if there's a validation error (indicating incomplete/invalid data)
  const hasValidationError = Boolean(error);
  
  // Check if any row in edit mode has validation errors
  // This prevents navigation when user has incomplete data even if blur hasn't happened yet
  const rowsById = useMemo(() => {
    return new Map(rows.map((row) => [String(row.id), row]));
  }, [rows]);
  const {
    handleEditSelectedRow,
    handleStartRowEdit,
    focusTable,
    openRowById,
  } = useDataGridRowCommands<T>({
    gridApiRef,
    rowsById,
    columns,
    selectedRowIds,
    setSelectedRowIds,
    setRowModesModel,
    rowSnapshotRef,
    ensureRowVisible,
  });
  const handleSortModelChange = useCallback((nextSortModel: GridSortModel): void => {
    setSortModel(nextSortModel);
    refreshStableRowOrder(rows as T[], nextSortModel);
    if (isContinuousScroll) {
      scrollDrivenRowWindow.ensureRowIndexVisible(0);
    }
  }, [isContinuousScroll, refreshStableRowOrder, rows, scrollDrivenRowWindow, setSortModel]);
  const handleFilterModelChange = useCallback((nextFilterModel: GridFilterModel): void => {
    setFilterModel(nextFilterModel);
    refreshStableRowOrder(rows as T[]);
    if (isContinuousScroll) {
      scrollDrivenRowWindow.ensureRowIndexVisible(0);
    }
  }, [isContinuousScroll, refreshStableRowOrder, rows, scrollDrivenRowWindow, setFilterModel]);

  const clearSavedRowInteractionState = useCallback((
    rowId: GridRowId,
    savedRowId: GridRowId = rowId,
    options: { preserveFocus?: boolean } = {},
  ): void => {
    const rowKey = String(rowId);
    const savedRowKey = String(savedRowId);
    const preserveFocus = options.preserveFocus ?? true;

    setDirtyRowIds((prev) => {
      const next = new Set(prev);
      next.delete(rowKey);
      next.delete(savedRowKey);
      return next;
    });
    setActiveValidationErrors((prev) => {
      const next = { ...prev };
      delete next[rowKey];
      delete next[savedRowKey];
      return next;
    });
    setSelectedRowIds([]);

    const api = gridApiRef.current as typeof gridApiRef.current & {
      state?: { focus?: { cell?: { id?: GridRowId; field?: string } | null } };
    };
    const focusedCell = api?.state?.focus?.cell;
    if (
      focusedCell &&
      (String(focusedCell.id) === rowKey || String(focusedCell.id) === savedRowKey)
    ) {
      if (preserveFocus) {
        api.state.focus.cell = {
          ...focusedCell,
          id: String(focusedCell.id) === rowKey ? savedRowId : focusedCell.id,
        };
      } else {
        api.state.focus.cell = null;
      }
    }

    if (!preserveFocus && document.activeElement instanceof HTMLElement) {
      const gridSurface = gridSurfaceRef.current;
      if (!gridSurface || gridSurface.contains(document.activeElement)) {
        document.activeElement.blur();
      }
    }
  }, [gridApiRef]);

  const getFocusedCellFromEvent = useCallback((event: KeyboardEvent): { id: GridRowId; field: string } | null => (
    resolveFocusedCellFromEvent(gridApiRef.current, event)
  ), [gridApiRef]);

  const isActionCellKeyboardNavigable = useCallback((params: GridCellParams<T>): boolean => (
    hasDedicatedEditor(params.field)
  ), [hasDedicatedEditor]);

  const getKeyboardNavigableFieldsForRow = useCallback((rowId: GridRowId): string[] => {
    const api = gridApiRef.current;
    if (!api) {
      return [];
    }
    return api.getVisibleColumns()
      .filter((column) => {
        const row = rowsById.get(String(rowId)) as T | undefined;
        return isCellKeyboardNavigable<T>({
          api,
          columns,
          field: column.field,
          isActionCell: isActionCellKeyboardNavigable,
          row,
          rowId,
        });
      })
      .map((column) => column.field);
  }, [columns, gridApiRef, isActionCellKeyboardNavigable, rowsById]);

  const focusKeyboardNavigableCell = useCallback((
    rowId: GridRowId,
    field: string,
    options: { startEdit: boolean; requestDialogEdit?: boolean },
  ): void => {
    const rowKey = String(rowId);
    const row = rowsById.get(rowKey);
    if (row && !rowSnapshotRef.current.has(rowKey)) {
      rowSnapshotRef.current.set(rowKey, row as T);
    }

    runAfterRowVisible(rowId, () => {
      const api = gridApiRef.current;
      if (!api) {
        return;
      }

      scrollCellIntoView<T>(api, { id: rowId, field });
      focusDataGridKeyboardNavigableCell<T>({
        api,
        cell: { id: rowId, field },
        focusEditInput: !hasDedicatedEditor(field)
          && (rowModesModel[rowId]?.mode === GridRowModes.Edit || options.startEdit),
      });

      if (options.requestDialogEdit) {
        requestDialogEditForCell(rowId, field);
      }

      if (!options.startEdit || hasDedicatedEditor(field)) {
        return;
      }

      if (rowModesModel[rowId]?.mode === GridRowModes.Edit) {
        setRowModesModel((oldModel) => ({
          ...oldModel,
          [rowId]: { ...oldModel[rowId], mode: GridRowModes.Edit, fieldToFocus: field },
        }));
        return;
      }

      setRowModesModel((oldModel) => ({
        ...oldModel,
        [rowId]: { mode: GridRowModes.Edit, fieldToFocus: field },
      }));
    });
  }, [
    gridApiRef,
    hasDedicatedEditor,
    requestDialogEditForCell,
    rowModesModel,
    rowsById,
    runAfterRowVisible,
  ]);

  const getHorizontalNavigationTarget = useCallback((
    rowId: GridRowId,
    field: string,
    direction: 1 | -1,
  ): { id: GridRowId; field: string } | null => (
    getHorizontalKeyboardNavigationTarget(
      getKeyboardNavigableFieldsForRow(rowId),
      rowId,
      field,
      direction,
    )
  ), [getKeyboardNavigableFieldsForRow]);

  const handleReadOnlyCellMouseDown = useCallback((event: React.MouseEvent<HTMLElement>): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (isInteractiveCellTarget(target)) {
      return;
    }

    const cellLocation = getCellLocationFromDomTarget(target);
    if (!cellLocation) {
      return;
    }

    if (isCellKeyboardNavigable<T>({
      api: gridApiRef.current,
      field: cellLocation.field,
      isActionCell: isActionCellKeyboardNavigable,
      rowId: cellLocation.id,
    })) {
      return;
    }

    preventReadOnlyCellMouseFocus(event);
  }, [gridApiRef, isActionCellKeyboardNavigable]);

  const hasInvalidRowInEditMode = useMemo(() => {
    if (!hasRowsInEditMode) return false;
    return hasInvalidRowInEditModeState(rowModesModel, rowsById, validateRow);
  }, [hasRowsInEditMode, rowModesModel, rowsById, validateRow]);

  const rowValidationErrors = useMemo(() => {
    if (!getRowValidationErrors) return {};
    return collectRowValidationErrors(rows as T[], getRowValidationErrors);
  }, [getRowValidationErrors, rows]);

  /**
   * Fetch data from API and populate grid
   */
  const fetchData = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const response = await api.list();
      const dataRows: T[] = response.data.results
        .filter((item): item is T & { id: number } => item.id !== undefined)
        .map(mapToRow);
      setRows(dataRows);
      refreshStableRowOrder(dataRows);
      setError('');
      setDataFetched(true);
    } catch (err) {
      setError(loadErrorMessage);
      console.error('Error fetching data:', err);
      setDataFetched(true);
    } finally {
      setLoading(false);
    }
  }, [api, mapToRow, loadErrorMessage, refreshStableRowOrder]);

  useEffect(() => {
    // Only fetch on initial mount
    if (!initialFetchDoneRef.current) {
      initialFetchDoneRef.current = true;
      fetchData();
    }
  }, [fetchData]);

  /**
   * Add initial row if provided and not already processed
   * Only runs once when initialRow is provided and data has finished loading
   */
  useEffect(() => {
    if (initialRow && !initialRowProcessedRef.current && dataFetched && !loading) {
      initialRowProcessedRef.current = true;
      const newRow = { ...createNewRow(), ...initialRow };
      setRows((oldRows) => [...oldRows, newRow]);
      setStableRowOrder((previousOrder) => [...previousOrder, newRow.id]);
      setSelectedRowIds([newRow.id]);
      if (isContinuousScroll) {
        scrollDrivenRowWindow.ensureRowIndexVisible(rows.length, { forRowCount: rows.length + 1 });
      }
      // Set row to edit mode after a small delay to ensure row is added first
      setTimeout(() => {
        const fieldToFocus = columns.find((column) => column.editable !== false)?.field ?? columns[0]?.field;
        setRowModesModel((oldModel) => ({
          ...oldModel,
          [newRow.id]: { mode: GridRowModes.Edit, fieldToFocus },
        }));
        if (fieldToFocus) {
          gridApiRef.current?.setCellFocus(newRow.id, fieldToFocus);
        }
      }, 0);
    }
  }, [
    columns,
    createNewRow,
    dataFetched,
    gridApiRef,
    initialRow,
    isContinuousScroll,
    loading,
    rows.length,
    scrollDrivenRowWindow,
    setSelectedRowIds,
  ]);

  /**
   * Handle adding a new row to the grid
   */
  const handleAddClick = useCallback((): void => {
    const newRow = createNewRow();
    setRows((oldRows) => [...oldRows, newRow]);
    setStableRowOrder((previousOrder) => [...previousOrder, newRow.id]);
    setRowModesModel((oldModel) => ({
      ...oldModel,
      [newRow.id]: { mode: GridRowModes.Edit, fieldToFocus: columns[0]?.field },
    }));
    if (isContinuousScroll) {
      scrollDrivenRowWindow.ensureRowIndexVisible(rows.length, { forRowCount: rows.length + 1 });
    } else if (showPaginationControls) {
      setPaginationModel((current) => ({
        ...current,
        page: Math.floor(rows.length / current.pageSize),
      }));
    }
  }, [columns, createNewRow, isContinuousScroll, rows.length, scrollDrivenRowWindow, showPaginationControls]);

  const handleDiscardRowChanges = useCallback((rowId: GridRowId): void => {
    const rowKey = String(rowId);
    canceledRowIdsRef.current.add(rowKey);
    setError('');
    // Escape's default MUI behavior (which normally restores keyboard focus
    // to the cell) is intentionally suppressed above so Escape can cancel
    // instead of just exiting edit mode — so focus has to be restored here,
    // or it's left stranded outside the grid entirely once the edit input
    // unmounts.
    const currentRowMode = rowModesModel[rowId];
    const fieldToRestoreFocus = (currentRowMode?.mode === GridRowModes.Edit ? currentRowMode.fieldToFocus : undefined)
      ?? columns.find((column) => column.editable !== false)?.field;
    const snapshot = rowSnapshotRef.current.get(rowKey);
    const currentRow = rowsById.get(rowKey) ?? snapshot;
    const rowWasRemoved = Boolean(currentRow && isUnsavedDraftRow(currentRow));

    if (rowWasRemoved) {
      setRows((prevRows) => prevRows.filter((row) => String(row.id) !== rowKey));
      setStableRowOrder((previousOrder) => previousOrder.filter((orderedId) => String(orderedId) !== rowKey));
      rowSnapshotRef.current.delete(rowKey);
    } else if (snapshot) {
      setRows((prevRows) => prevRows.map((row) => (String(row.id) === rowKey ? snapshot : row)));
    }

    setDirtyRowIds((prev) => {
      const next = new Set(prev);
      next.delete(rowKey);
      return next;
    });
    setActiveValidationErrors((prev) => {
      const next = { ...prev };
      delete next[rowKey];
      return next;
    });
    setRowModesModel((oldModel) => ({
      ...oldModel,
      [rowId]: { mode: GridRowModes.View, ignoreModifications: true },
    }));
    clearSavedRowInteractionState(rowId, rowId, { preserveFocus: false });
    window.setTimeout(() => {
      canceledRowIdsRef.current.delete(rowKey);
    }, 0);
    if (fieldToRestoreFocus && !rowWasRemoved) {
      requestAnimationFrame(() => {
        gridApiRef.current?.setCellFocus(rowId, fieldToRestoreFocus);
      });
    }
  }, [clearSavedRowInteractionState, columns, gridApiRef, rowModesModel, rowsById]);

  const markRowDirty = useCallback((rowKey: string): void => {
    setDirtyRowIds((previous) => {
      if (previous.has(rowKey)) {
        return previous;
      }
      const next = new Set(previous);
      next.add(rowKey);
      return next;
    });
  }, []);

  const getDraftRow = useCallback((rowId: GridRowId): T | null => {
    const api = gridApiRef.current;
    if (!api) {
      return null;
    }
    const baseRow = (rowsById.get(String(rowId)) as T | undefined) ?? (api.getRow(rowId) as T | null);
    if (!baseRow) {
      return null;
    }
    return readDraftRow(api, columns, baseRow, rowId);
  }, [columns, gridApiRef, rowsById]);

  const mergeVisibleEditInputValues = useCallback((rowId: GridRowId, draftRow: T): T => (
    mergeVisibleDateEditInputValues(
      gridApiRef.current?.rootElementRef?.current ?? null,
      columns,
      rowId,
      draftRow,
    )
  ), [columns, gridApiRef]);

  /** Whether the grid currently offers an inline editor for this cell. */
  const isEditableCell = useCallback((rowId: GridRowId, field: string): boolean => {
    if (!columns.find((column) => column.field === field)?.editable) {
      return false;
    }
    const api = gridApiRef.current;
    try {
      return api?.isCellEditable(api.getCellParams(rowId, field)) ?? true;
    } catch {
      return true;
    }
  }, [columns, gridApiRef]);

  /**
   * MUI keeps `Date` objects in the edit state of a date column and formats
   * them without passing them through `valueGetter`, so a raw ISO string from
   * row state would throw while the cell renders. Row state stays the string
   * it always was; only the value handed to the edit session is coerced.
   */
  const toEditCellValue = useCallback((field: string, value: unknown): unknown => {
    const columnType = columns.find((column) => column.field === field)?.type;
    return columnType === 'date' || columnType === 'dateTime'
      ? toGridDateValue(value)
      : value;
  }, [columns]);

  const applyDraftValues = useCallback(async (rowId: GridRowId, values: Partial<T>): Promise<void> => {
    const rowKey = String(rowId);
    const isEditing = rowModesModel[rowId]?.mode === GridRowModes.Edit;
    const targetRow = rowsById.get(rowKey) as T | undefined;
    const api = gridApiRef.current;

    if (isEditing && api) {
      const editUpdates = Object.entries(values).flatMap(([fieldKey, fieldValue]) => {
        // MUI throws for a field that has no editor in the open edit session,
        // so values for read-only or dialog-edited columns are carried by the
        // `setRows` merge below instead.
        if (fieldKey === 'id' || fieldKey === 'isNew' || !isEditableCell(rowId, fieldKey)) {
          return [];
        }
        return [
          api.setEditCellValue({
            id: rowId,
            field: fieldKey,
            value: toEditCellValue(fieldKey, fieldValue),
          }),
        ];
      });
      await Promise.allSettled(editUpdates);
    }

    setRows((previousRows) =>
      previousRows.map((row) =>
        String(row.id) === rowKey ? ({ ...row, ...values } as T) : row,
      ),
    );
    if (targetRow) {
      const nextRow = { ...targetRow, ...values } as T;
      const fieldErrors = getRowValidationErrors?.(nextRow) ?? {};
      setActiveValidationErrors((prev) => ({
        ...prev,
        [rowKey]: fieldErrors,
      }));
    }
    markRowDirty(rowKey);
  }, [getRowValidationErrors, gridApiRef, isEditableCell, markRowDirty, rowModesModel, rowsById, toEditCellValue]);

  const runBeforeSaveGate = useCallback(async (row: T): Promise<T | null> => {
    if (!onBeforeSaveRow) {
      return row;
    }
    const saveDecision = await onBeforeSaveRow(row);
    if (saveDecision === false) {
      return null;
    }
    if (saveDecision !== true && saveDecision !== null && typeof saveDecision === 'object') {
      return { ...row, ...saveDecision } as T;
    }
    return row;
  }, [onBeforeSaveRow]);

  const waitForPendingEditCellUpdates = useCallback(async (): Promise<void> => {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }, []);

  const prepareRowForSave = useCallback(async (rowId: GridRowId): Promise<T | null> => {
    await waitForPendingEditCellUpdates();
    const draftRow = getDraftRow(rowId);
    if (!draftRow) {
      return rowsById.get(String(rowId)) as T | undefined ?? null;
    }
    return mergeVisibleEditInputValues(rowId, draftRow);
  }, [getDraftRow, mergeVisibleEditInputValues, rowsById, waitForPendingEditCellUpdates]);

  const getCurrentEditableRow = useCallback((rowId: GridRowId): T | null => {
    const draftRow = getDraftRow(rowId);
    if (draftRow) {
      return mergeVisibleEditInputValues(rowId, draftRow);
    }
    return rowsById.get(String(rowId)) as T | undefined ?? null;
  }, [getDraftRow, mergeVisibleEditInputValues, rowsById]);

  const hasVisibleEditInputValue = useCallback((rowId: GridRowId): boolean => {
    const root = gridApiRef.current?.rootElementRef?.current;
    if (!root) {
      return false;
    }
    const rowElement = root.querySelector<HTMLElement>(
      `[role="row"][data-id="${cssEscape(String(rowId))}"]`,
    );
    if (!rowElement) {
      return false;
    }

    return Array.from(
      rowElement.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        '.MuiDataGrid-cell--editing input:not([type="hidden"]):not([aria-hidden="true"]), .MuiDataGrid-cell--editing textarea',
      ),
    ).some((input) => input.value.trim().length > 0);
  }, [gridApiRef]);

  const commitEditedRowDraftForKeyboardNavigation = useCallback((
    rowId: GridRowId,
    options: { syncRows: boolean },
  ): boolean => {
    const rowKey = String(rowId);
    setError((currentError) => (currentError ? '' : currentError));
    markRowDirty(rowKey);

    if (!options.syncRows) {
      return true;
    }

    const draftRow = getDraftRow(rowId);
    if (!draftRow) {
      return true;
    }

    setRows((prevRows) =>
      prevRows.map((row) => (String(row.id) === rowKey ? draftRow : row)),
    );
    return true;
  }, [getDraftRow, markRowDirty]);

  const navigateFromEditedCell = useCallback((
    current: { id: GridRowId; field: string },
    target: { id: GridRowId; field: string },
    options: { startTargetEdit: boolean; requestDialogEdit?: boolean },
  ): void => {
    if (current.id === target.id && current.field === target.field) {
      return;
    }

    const isSameRow = String(current.id) === String(target.id);
    const targetHasDedicatedEditor = hasDedicatedEditor(target.field);
    const canCommitCurrentDraft = commitEditedRowDraftForKeyboardNavigation(current.id, {
      syncRows: !isSameRow || targetHasDedicatedEditor,
    });
    if (!canCommitCurrentDraft) {
      return;
    }

    if (isSameRow) {
      internalEditNavigationRowIdRef.current = String(current.id);
      focusKeyboardNavigableCell(target.id, target.field, {
        startEdit: options.startTargetEdit,
        requestDialogEdit: options.requestDialogEdit,
      });
      window.requestAnimationFrame(() => {
        if (internalEditNavigationRowIdRef.current === String(current.id)) {
          internalEditNavigationRowIdRef.current = null;
        }
      });
      return;
    }

    if (rowModesModel[current.id]?.mode === GridRowModes.Edit) {
      setRowModesModel((oldModel) => ({
        ...oldModel,
        [current.id]: { mode: GridRowModes.View, ignoreModifications: true },
      }));
    }

    focusKeyboardNavigableCell(target.id, target.field, {
      startEdit: options.startTargetEdit,
      requestDialogEdit: options.requestDialogEdit,
    });
  }, [
    commitEditedRowDraftForKeyboardNavigation,
    focusKeyboardNavigableCell,
    hasDedicatedEditor,
    rowModesModel,
  ]);

  const recoverSameRowNavigationFromTabEvent = useCallback((
    rowId: GridRowId,
    event: { key?: string; shiftKey?: boolean },
  ): boolean => {
    if (event.key !== 'Tab') {
      return false;
    }

    const current = activeEditCellRef.current;
    if (!current || String(current.id) !== String(rowId)) {
      return false;
    }

    const direction = event.shiftKey ? -1 : 1;
    const sameRowTarget = getHorizontalNavigationTarget(current.id, current.field, direction);
    if (!sameRowTarget) {
      return false;
    }

    navigateFromEditedCell(current, sameRowTarget, {
      startTargetEdit: !hasDedicatedEditor(sameRowTarget.field),
    });
    return true;
  }, [
    getHorizontalNavigationTarget,
    hasDedicatedEditor,
    navigateFromEditedCell,
  ]);

  const handleEditableRowEditStop: GridEventListener<'rowEditStop'> = useCallback((params, event, details): void => {
    if (params.reason === GridRowEditStopReasons.rowFocusOut) {
      if (isAnyContextMenuOpen() || isContextMenuDismissGestureInProgress()) {
        event.defaultMuiPrevented = true;
        return;
      }

      const rowKey = String(params.id);
      if (internalEditNavigationRowIdRef.current === rowKey) {
        internalEditNavigationRowIdRef.current = null;
        event.defaultMuiPrevented = true;
        return;
      }
      internalEditNavigationRowIdRef.current = null;

      if (recoverSameRowNavigationFromTabEvent(params.id, event as unknown as { key?: string; shiftKey?: boolean })) {
        event.defaultMuiPrevented = true;
        return;
      }

      const currentRow = getCurrentEditableRow(params.id);
      if (
        currentRow &&
        isUnsavedDraftRow(currentRow) &&
        isNewRowEmpty(currentRow) &&
        !hasVisibleEditInputValue(params.id)
      ) {
        event.defaultMuiPrevented = true;
        handleDiscardRowChanges(params.id);
        return;
      }
    }

    if (params.reason === GridRowEditStopReasons.escapeKeyDown) {
      handleDiscardRowChanges(params.id);
    }
    activeEditCellRef.current = null;
    handleRowEditStop(params, event, details);
  }, [
    getCurrentEditableRow,
    handleDiscardRowChanges,
    hasVisibleEditInputValue,
    isNewRowEmpty,
    recoverSameRowNavigationFromTabEvent,
  ]);

  const saveResolvedRow = useCallback(async (rowAfterSaveGate: T): Promise<T> => {
    const rowKey = String(rowAfterSaveGate.id);
    // Validate required fields
    const validationError = validateRow(rowAfterSaveGate);
    const fieldErrors = getRowValidationErrors?.(rowAfterSaveGate) ?? {};
    setActiveValidationErrors((prev) => ({
      ...prev,
      [rowKey]: fieldErrors,
    }));
    if (validationError) {
      if (rowAfterSaveGate.isNew) {
        throw new Error(validationError);
      }
      setError(validationError);
      throw new Error(validationError);
    }

    try {
      if (rowAfterSaveGate.isNew) {
        // Create new item via API
        const apiData = await mapToApiData(rowAfterSaveGate);
        const response = await api.create(apiData);
        setError('');
        if (!response.data.id) {
          throw new Error('API response missing ID');
        }

        // Remove the temporary row and add the saved row
        const savedRow = mapToRow(response.data as T);
        rowSnapshotRef.current.set(String(savedRow.id), savedRow);
        setRows((prevRows) => {
          // Remove the temporary row with negative ID
          const filteredRows = prevRows.filter(row => row.id !== rowAfterSaveGate.id);
          // Add the saved row at the beginning
          return [savedRow, ...filteredRows];
        });
        setStableRowOrder((previousOrder) =>
          previousOrder.map((orderedId) => (String(orderedId) === rowKey ? savedRow.id : orderedId)),
        );
        clearSavedRowInteractionState(rowAfterSaveGate.id, savedRow.id);

        return savedRow;
      } else {
        // Update existing item via API
        const apiData = await mapToApiData(rowAfterSaveGate);
        const response = await api.update(rowAfterSaveGate.id, apiData);
        setError('');
        if (!response.data.id) {
          throw new Error('API response missing ID');
        }
        // Map the response through mapToRow to ensure all fields are properly formatted
        // This is important for auto-calculated fields like harvest dates
        const mappedRow = mapToRow(response.data as T);
        rowSnapshotRef.current.set(String(mappedRow.id), mappedRow);
        clearSavedRowInteractionState(rowAfterSaveGate.id, mappedRow.id);
        return mappedRow;
      }
    } catch (err) {
      if (isSaveErrorHandled?.(err)) {
        throw err;
      }
      // Extract user-friendly error message
      const errorMessage = extractApiErrorMessage(err, t, saveErrorMessage);
      setError(errorMessage);
      console.error('Error saving data:', err);
      throw new Error(errorMessage, { cause: err });
    }
  }, [
    api,
    clearSavedRowInteractionState,
    getRowValidationErrors,
    isSaveErrorHandled,
    mapToApiData,
    mapToRow,
    saveErrorMessage,
    t,
    validateRow,
  ]);

  const processRowUpdate = useCallback(async (newRow: T): Promise<T> => {
    const rowKey = String(newRow.id);
    if (canceledRowIdsRef.current.has(rowKey)) {
      canceledRowIdsRef.current.delete(rowKey);
      setError('');
      setDirtyRowIds((prev) => {
        const next = new Set(prev);
        next.delete(rowKey);
        return next;
      });
      setActiveValidationErrors((prev) => {
        const next = { ...prev };
        delete next[rowKey];
        return next;
      });
      return rowSnapshotRef.current.get(rowKey) ?? newRow;
    }

    const inFlightSave = rowSavePromisesRef.current.get(rowKey);
    if (inFlightSave) {
      return inFlightSave;
    }

    // Clear previous error before validating
    // This ensures dropdown selections and other changes trigger fresh validation
    setError('');

    const savePromise = (async (): Promise<T> => {
      const rowAfterSaveGate = await runBeforeSaveGate(newRow);
      if (!rowAfterSaveGate) {
        setRowModesModel((oldModel) => ({
          ...oldModel,
          [newRow.id]: { mode: GridRowModes.Edit },
        }));
        throw new SaveBlockedError();
      }

      const savedRow = await saveResolvedRow(rowAfterSaveGate);
      setRowModesModel((oldModel) => ({
        ...oldModel,
        [newRow.id]: { mode: GridRowModes.View, ignoreModifications: true },
      }));
      return savedRow;
    })();
    rowSavePromisesRef.current.set(rowKey, savePromise);
    try {
      return await savePromise;
    } finally {
      rowSavePromisesRef.current.delete(rowKey);
    }
  }, [
    runBeforeSaveGate,
    saveResolvedRow,
  ]);

  const handleProcessRowUpdateError = useCallback((error: unknown): void => {
    if (isSaveBlockedError(error)) {
      return;
    }
    console.error('Row update error:', error);
    if (isSaveErrorHandled?.(error)) {
      return;
    }
    if (error instanceof Error && error.message) {
      setError(error.message);
      return;
    }
    const errorMessage = extractApiErrorMessage(error, t, saveErrorMessage);
    setError(errorMessage);
  }, [isSaveErrorHandled, saveErrorMessage, t]);

  const commitDraftValues = useCallback(async (rowId: GridRowId, values: Partial<T>): Promise<void> => {
    const rowKey = String(rowId);
    await applyDraftValues(rowId, values);

    const draftRow = getDraftRow(rowId);
    const baseRow = draftRow ?? (rowsById.get(rowKey) as T | undefined);
    if (!baseRow) {
      return;
    }

    const rowToSave = { ...baseRow, ...values } as T;
    try {
      const savedRow = await saveResolvedRow(rowToSave);
      setRows((prevRows) =>
        prevRows.map((currentRow) =>
          String(currentRow.id) === rowKey ? savedRow : currentRow,
        ),
      );
      gridApiRef.current?.stopRowEditMode({ id: rowId, ignoreModifications: true });
      setRowModesModel((oldModel) => ({
        ...oldModel,
        [rowId]: { mode: GridRowModes.View, ignoreModifications: true },
      }));
    } catch (error) {
      setRowModesModel((oldModel) => ({
        ...oldModel,
        [rowId]: { mode: GridRowModes.Edit },
      }));
      handleProcessRowUpdateError(error);
    }
  }, [applyDraftValues, getDraftRow, gridApiRef, handleProcessRowUpdateError, rowsById, saveResolvedRow]);

  const applyDialogEditValues = useCallback(async (
    rowId: GridRowId,
    values: Partial<T>,
  ): Promise<void> => {
    const rowKey = String(rowId);
    await applyDraftValues(rowId, values);

    if (rowModesModel[rowId]?.mode === GridRowModes.Edit) {
      // The row already has an open edit session (typically a new draft row).
      // Its own save cycle persists the dialog values together with the rest,
      // so committing here would save a half-filled row.
      return;
    }

    const baseRow = getDraftRow(rowId) ?? (rowsById.get(rowKey) as T | undefined);
    if (!baseRow) {
      return;
    }

    try {
      const savedRow = await processRowUpdate({ ...baseRow, ...values } as T);
      setRows((previousRows) =>
        previousRows.map((currentRow) =>
          String(currentRow.id) === rowKey ? savedRow : currentRow,
        ),
      );
    } catch (error) {
      handleProcessRowUpdateError(error);
    }
  }, [
    applyDraftValues,
    getDraftRow,
    handleProcessRowUpdateError,
    processRowUpdate,
    rowModesModel,
    rowsById,
  ]);

  const handleSaveRow = useCallback(async (rowId: GridRowId): Promise<void> => {
    const preparedRow = await prepareRowForSave(rowId);
    if (!preparedRow) {
      return;
    }

    try {
      const savedRow = await processRowUpdate(preparedRow);
      setRowModesModel((oldModel) => ({
        ...oldModel,
        [rowId]: { mode: GridRowModes.View, ignoreModifications: true },
      }));
      setRows((prevRows) =>
        prevRows.some((currentRow) => String(currentRow.id) === String(rowId))
          ? prevRows.map((currentRow) =>
            String(currentRow.id) === String(rowId) ? savedRow : currentRow,
          )
          : prevRows,
      );
    } catch (error) {
      handleProcessRowUpdateError(error);
    }
  }, [
    handleProcessRowUpdateError,
    prepareRowForSave,
    processRowUpdate,
  ]);

  const handleSelectEditMenuClose = useCallback((rowId: GridRowId, _field: string, event: unknown): void => {
    const rowMode = rowModesModel[rowId] ?? rowModesModel[String(rowId)];
    if (rowMode?.mode !== GridRowModes.Edit || isSelectEditMenuInternalCloseTarget(event)) {
      return;
    }

    if (isSelectEditMenuEscapeClose(event)) {
      handleDiscardRowChanges(rowId);
      return;
    }

    const rowElement = gridApiRef.current?.rootElementRef?.current?.querySelector<HTMLElement>(
      `[role="row"][data-id="${cssEscape(String(rowId))}"]`,
    );
    if (!rowElement || !isSelectEditMenuCloseOutsideElement(event, rowElement)) {
      return;
    }

    void handleSaveRow(rowId);
  }, [gridApiRef, handleDiscardRowChanges, handleSaveRow, rowModesModel]);

  const selectEditCellContextValue = useMemo<SelectEditCellContextValue>(() => ({
    request: selectEditOpenRequest,
    consumeRequest: consumeSelectEditOpenRequest,
    onMenuClose: handleSelectEditMenuClose,
  }), [consumeSelectEditOpenRequest, handleSelectEditMenuClose, selectEditOpenRequest]);

  const saveEditedRowAndFocusTarget = useCallback(async (
    current: { id: GridRowId; field: string },
    target: { id: GridRowId; field: string },
    options: { startTargetEdit?: boolean; requestDialogEdit?: boolean } = {},
  ): Promise<void> => {
    const preparedRow = await prepareRowForSave(current.id);
    if (!preparedRow) {
      return;
    }

    try {
      const savedRow = await processRowUpdate(preparedRow);
      setRows((prevRows) =>
        prevRows.some((currentRow) => String(currentRow.id) === String(current.id))
          ? prevRows.map((currentRow) =>
            String(currentRow.id) === String(current.id) ? savedRow : currentRow,
          )
          : prevRows,
      );
      focusKeyboardNavigableCell(target.id, target.field, {
        startEdit: options.startTargetEdit ?? !hasDedicatedEditor(target.field),
        requestDialogEdit: options.requestDialogEdit,
      });
    } catch (error) {
      handleProcessRowUpdateError(error);
    }
  }, [
    focusKeyboardNavigableCell,
    handleProcessRowUpdateError,
    hasDedicatedEditor,
    prepareRowForSave,
    processRowUpdate,
  ]);

  const saveEditedRowAndFocusNextVerticalCell = useCallback((
    current: { id: GridRowId; field: string },
  ): void => {
    const target = getVerticalKeyboardNavigationTarget<T>({
      api: gridApiRef.current,
      columns,
      current,
      direction: 1,
      isActionCell: isActionCellKeyboardNavigable,
      rows: rowsForGrid,
    }) ?? current;

    void saveEditedRowAndFocusTarget(current, target, {
      startTargetEdit: false,
    });
  }, [
    columns,
    gridApiRef,
    isActionCellKeyboardNavigable,
    rowsForGrid,
    saveEditedRowAndFocusTarget,
  ]);

  const handleEditedCellTabNavigation = useCallback((
    current: { id: GridRowId; field: string },
    event: DataGridKeyboardEvent,
  ): boolean => {
    if (
      event.key !== 'Tab'
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.nativeEvent.isComposing
    ) {
      return false;
    }

    activeEditCellRef.current = current;
    const direction = event.shiftKey ? -1 : 1;
    const sameRowTarget = getHorizontalNavigationTarget(current.id, current.field, direction);
    const target = sameRowTarget ?? getKeyboardNavigationTarget<T>({
      api: gridApiRef.current,
      columns,
      current,
      direction,
      isActionCell: isActionCellKeyboardNavigable,
      rows: rowsForGrid,
      wrapRows: true,
    });

    event.preventDefault();
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation?.();
    event.defaultMuiPrevented = true;

    if (!target) {
      void handleSaveRow(current.id);
      return true;
    }

    if (String(target.id) === String(current.id)) {
      navigateFromEditedCell(current, target, {
        startTargetEdit: !hasDedicatedEditor(target.field),
      });
      return true;
    }

    void saveEditedRowAndFocusTarget(current, target);
    return true;
  }, [
    columns,
    getHorizontalNavigationTarget,
    gridApiRef,
    handleSaveRow,
    hasDedicatedEditor,
    isActionCellKeyboardNavigable,
    navigateFromEditedCell,
    rowsForGrid,
    saveEditedRowAndFocusTarget,
  ]);

  const handleGridEditNavigation = useCallback((event: KeyboardEvent): void => {
    const focusedCell = getFocusedCellFromEvent(event);
    if (!focusedCell || rowModesModel[focusedCell.id]?.mode !== GridRowModes.Edit) {
      return;
    }

    handleEditedCellTabNavigation(focusedCell, event as DataGridKeyboardEvent);
  }, [
    getFocusedCellFromEvent,
    handleEditedCellTabNavigation,
    rowModesModel,
  ]);

  const handleEditTabNavigationFromEventTarget = useCallback((
    target: EventTarget | null,
    event: DataGridKeyboardEvent,
  ): boolean => {
    const gridSurface = gridSurfaceRef.current;
    if (!(target instanceof HTMLElement) || !gridSurface?.contains(target)) {
      return false;
    }

    const current = getCellLocationFromDomTarget(target);
    const isEditingDomTarget = Boolean(
      target.closest('.MuiDataGrid-cell--editing, .MuiDataGrid-row--editing, .ofp-row-editing'),
    );
    if (!current || (!isEditingDomTarget && rowModesModel[current.id]?.mode !== GridRowModes.Edit)) {
      return false;
    }

    return handleEditedCellTabNavigation(current, event);
  }, [handleEditedCellTabNavigation, rowModesModel]);

  useEffect(() => {
    const handleNativeEditTabNavigation = (event: globalThis.KeyboardEvent): void => {
      if (
        event.key !== 'Tab'
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.isComposing
      ) {
        return;
      }

      handleEditTabNavigationFromEventTarget(event.target, wrapNativeKeyboardEvent(event));
    };

    window.addEventListener('keydown', handleNativeEditTabNavigation, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleNativeEditTabNavigation, { capture: true });
    };
  }, [handleEditTabNavigationFromEventTarget]);

  const handleGridSurfaceKeyDownCapture = useCallback((event: KeyboardEvent<HTMLElement>): void => {
    handleEditTabNavigationFromEventTarget(
      event.target,
      event as unknown as DataGridKeyboardEvent,
    );
  }, [handleEditTabNavigationFromEventTarget]);

  const handleEditCellTabNavigation = useCallback<EditCellTabNavigationHandler>((request) => {
    return handleEditedCellTabNavigation(
      { id: request.id, field: request.field },
      request.event as DataGridKeyboardEvent,
    );
  }, [handleEditedCellTabNavigation]);

  const handleSaveAllDirtyRows = useCallback(async (): Promise<void> => {
    // Awaits the real save (including the API call) for every dirty row in
    // turn, rather than just flipping rowModesModel to View and hoping MUI's
    // own async commit catches up later. Callers (e.g. the navigation
    // blocker below) may unmount this component right after this resolves,
    // which would cancel a save that hadn't actually started yet.
    const editingRowIds = Object.entries(rowModesModel)
      .filter(([, mode]) => mode.mode === GridRowModes.Edit)
      .map(([id]) => id);
    for (const rowId of editingRowIds) {
      await handleSaveRow(rowId);
    }
    const editingRowIdKeys = new Set(editingRowIds.map(String));
    for (const rowKey of dirtyRowIds) {
      if (!editingRowIdKeys.has(rowKey)) {
        await handleSaveRow(rowKey);
      }
    }
  }, [dirtyRowIds, handleSaveRow, rowModesModel]);

  useEffect(() => {
    if (!hasUnsavedChanges) {
      return;
    }

    const handleDocumentPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (
        target.closest('[role="listbox"], .MuiAutocomplete-popper, .MuiPopover-root, .MuiPickersPopper-root, .MuiDialog-root, .MuiModal-root')
        || target.closest('a[href]')
      ) {
        return;
      }

      const editingRowElements = Object.entries(rowModesModel)
        .filter(([, mode]) => mode.mode === GridRowModes.Edit)
        .map(([id]) => `[role="row"][data-id="${cssEscape(id)}"]`)
        .join(',');
      if (editingRowElements && target.closest(editingRowElements)) {
        return;
      }

      void handleSaveAllDirtyRows();
    };

    document.addEventListener('pointerdown', handleDocumentPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
    };
  }, [handleSaveAllDirtyRows, hasUnsavedChanges, rowModesModel]);

  // Route changes save first and then proceed without showing a confirmation.
  // Browser tab close/reload still gets the native beforeunload protection.
  useNavigationBlocker(
    hasUnsavedChanges,
    t('messages.unsavedChanges'),
    handleSaveAllDirtyRows,
    false,
  );

  const rememberRowSnapshotForCellEdit = useCallback((params: GridCellParams<T>): void => {
    const rowKey = String(params.id);
    if (rowSnapshotRef.current.has(rowKey)) {
      return;
    }
    const row = rowsById.get(rowKey);
    if (row) {
      rowSnapshotRef.current.set(rowKey, row as T);
    }
  }, [rowsById]);

  const handleStartCellEditFromKeyboard = useCallback((params: GridCellParams<T>): void => {
    if (!params.isEditable || rowModesModel[params.id]?.mode === GridRowModes.Edit) {
      return;
    }

    rememberRowSnapshotForCellEdit(params);

    const api = gridApiRef.current;
    if (!api) {
      return;
    }

    api.setCellFocus(params.id, params.field);
    setRowModesModel((oldModel) => ({
      ...oldModel,
      [params.id]: { mode: GridRowModes.Edit, fieldToFocus: params.field },
    }));
  }, [gridApiRef, rememberRowSnapshotForCellEdit, rowModesModel]);

  const spreadsheetEditStarter = useSpreadsheetEditStarter<T>({
    apiRef: gridApiRef,
    rowModesModel,
    setRowModesModel,
    // Notes and dialog cells own their editor, so neither F2 nor "just start
    // typing" may pull them into the inline edit mode they never leave through.
    isCellEditable: (params) => !hasDedicatedEditor(params.field),
    onBeforeEdit: rememberRowSnapshotForCellEdit,
    onReplaceValue: (params) => markRowDirty(String(params.id)),
  });

  const hasContextualRowActions = true;

  const {
    rowActionMenuState,
    longPressFeedbackRowId,
    rowActionMenuListRef,
    openRowActionMenuAt,
    openRowActionContextMenu,
    openRowActionKeyboardContextMenu,
    closeRowActionMenu,
    isRowActionContextMenuTarget,
    clearRowActionMenuForId,
    handleGridTouchStart,
    handleGridTouchMove,
    handleGridTouchEnd,
  } = useDataGridRowActionMenu({
    rowsById,
    hasContextualRowActions,
    markContextMenuHintUsed,
    markTouchContextMenuHintUsed,
    setSelectedRowIds,
    getRowIdFromElement,
  });

  const clearRowInteractionState = useCallback((rowId: GridRowId): void => {
    const rowKey = String(rowId);
    setSelectedRowIds((currentSelectedIds) =>
      currentSelectedIds.filter((selectedId) => String(selectedId) !== rowKey),
    );
    setDirtyRowIds((previous) => {
      const next = new Set(previous);
      next.delete(rowKey);
      return next;
    });
    setActiveValidationErrors((previous) => {
      const next = { ...previous };
      delete next[rowKey];
      return next;
    });
    setRowModesModel((previousModel) => {
      const next = { ...previousModel };
      delete next[rowId];
      delete next[rowKey];
      return next;
    });
    rowSnapshotRef.current.delete(rowKey);
    clearRowActionMenuForId(rowId);
  }, [clearRowActionMenuForId]);

  const moveFocusAwayFromRemovedRow = useCallback((rowId: GridRowId, remainingRows: readonly T[]): void => {
    const rowKey = String(rowId);
    const api = gridApiRef.current as typeof gridApiRef.current & {
      state?: { focus?: { cell?: { id?: GridRowId } | null } };
    };
    const focusedCell = api?.state?.focus?.cell;
    if (focusedCell && String(focusedCell.id) !== rowKey) {
      return;
    }

    const focusField = columns.find((column) => column.editable !== false)?.field ?? columns[0]?.field;
    const fallbackRow = remainingRows.find((row) => String(row.id) !== rowKey);
    if (fallbackRow && focusField) {
      api?.setCellFocus(fallbackRow.id, focusField);
      return;
    }

    if (api?.state?.focus) {
      api.state.focus.cell = null;
    }
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, [columns, gridApiRef]);

  const {
    pendingDeleteWithUndo,
    handleDeleteClick,
    deleteRowCommandRef,
    closeDeleteWithUndoSnackbar,
    undoDeleteWithUndo,
  } = useDataGridDelete<T>({
    rowsById,
    rows,
    stableRowOrder,
    rowModesModel,
    api,
    deleteConfirmMessage,
    deleteErrorMessage,
    saveErrorMessage,
    deleteUndoOptions,
    t,
    mapToApiData,
    reloadRows: fetchData,
    setRows,
    setStableRowOrder,
    setRowModesModel,
    setError,
    clearRowInteractionState,
    moveFocusAwayFromRemovedRow,
  });

  const handleDeleteSelectedRow = useCallback((): void => {
    const selectedRowId = selectedRowIds[0];
    if (!selectedRowId) {
      return;
    }

    handleDeleteClick(selectedRowId)();
  }, [handleDeleteClick, selectedRowIds]);

  useDataGridCommandApi<T>({
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
    reload: fetchData,
    focusTable,
    openRowById,
  });

  const handleDuplicateRow = useCallback((row: T): void => {
    if (!duplicateRow) {
      return;
    }

    const duplicatedRow = duplicateRow(row);
    setRows((previousRows) => [duplicatedRow, ...previousRows]);
    setStableRowOrder((previousOrder) => [duplicatedRow.id, ...previousOrder]);
    setDirtyRowIds((previous) => {
      const next = new Set(previous);
      next.add(String(duplicatedRow.id));
      return next;
    });
    setRowModesModel((oldModel) => ({
      ...oldModel,
      [duplicatedRow.id]: { mode: GridRowModes.Edit, fieldToFocus: columns[0]?.field },
    }));
  }, [columns, duplicateRow]);

  const rowActionHelpers = useMemo<EditableDataGridRowActionHelpers<T>>(() => ({
    startEdit: handleStartRowEdit,
    duplicate: handleDuplicateRow,
    delete: (rowId: GridRowId) => handleDeleteClick(rowId)(),
  }), [handleDeleteClick, handleDuplicateRow, handleStartRowEdit]);

  const defaultRowActions = useCallback((row: T): EditableDataGridRowAction<T>[] => {
    const actions: EditableDataGridRowAction<T>[] = [];

    if (duplicateRow) {
      actions.push({
        id: 'duplicate',
        label: t('actions.duplicate'),
        icon: <ContentCopyIcon fontSize="small" />,
        onClick: (targetRow, helpers) => helpers.duplicate(targetRow),
      });
    }

    actions.push({
      id: 'delete',
      label: t('actions.delete'),
      icon: <DeleteIcon fontSize="small" />,
      color: 'error',
      onClick: (_row, helpers) => helpers.delete(row.id),
    });

    return actions;
  }, [duplicateRow, t]);

  const resolveRowActions = useCallback((row: T): EditableDataGridRowAction<T>[] => {
    return getRowActions ? getRowActions(row, rowActionHelpers) : defaultRowActions(row);
  }, [defaultRowActions, getRowActions, rowActionHelpers]);

  const menuRow = rowActionMenuState ? rowsById.get(String(rowActionMenuState.rowId)) as T | undefined : undefined;
  const shouldUseRowActions = Boolean(getRowActions || duplicateRow);
  const menuActions = menuRow && shouldUseRowActions ? resolveRowActions(menuRow) : [];
  const resolvedClipboardColumns = useMemo<EditableDataGridClipboardColumn<T>[]>(() => (
    clipboardColumns ?? buildDefaultClipboardColumns<T>(columns)
  ), [clipboardColumns, columns]);
  const getClipboardRowValues = useCallback((row: T): TableClipboardRow => (
    buildClipboardRowValues(resolvedClipboardColumns, row)
  ), [resolvedClipboardColumns]);
  const getClipboardTableRows = useCallback((): TableClipboardRow[] => (
    buildClipboardTableRows(resolvedClipboardColumns, rowsForGrid as T[])
  ), [resolvedClipboardColumns, rowsForGrid]);

  const renderInlineActionCell = useCallback((
    col: GridColDef,
    params: GridRenderCellParams<T>,
  ) => {
    const row = params.row as T;
    const actions = getInlineRowActions?.(row, rowActionHelpers) ?? [];
    const hasInlineMenuAction = showInlineRowActionMenu && row.id !== undefined;
    const baseContent: ReactNode = col.renderCell
      ? col.renderCell(params)
      : String(params.formattedValue ?? params.value ?? '');
    const hasEmptyTextContent = typeof baseContent === 'string' && baseContent.length === 0;

    if (actions.length === 0 && !hasInlineMenuAction) {
      return baseContent;
    }

    return (
      <Box
        sx={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          minHeight: '100%',
          minWidth: 0,
          width: '100%',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            display: 'block',
            flex: '1 1 auto',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {hasEmptyTextContent ? (
            <Box component="span" aria-hidden="true" sx={{ visibility: 'hidden' }}>
              {'\u00a0'}
            </Box>
          ) : baseContent}
        </Box>
        <Box
          className="ofp-inline-row-actions"
          sx={{
            ...contextMenuActionsOverlaySx('.MuiDataGrid-row:hover &'),
            '.MuiDataGrid-row--editing:hover &, .ofp-row-editing:hover &': {
              opacity: 0,
              pointerEvents: 'none',
            },
          }}
        >
          {actions.map((action) => (
            <AppTooltip key={action.id} title={action.label} arrow>
              <span>
                <IconButton
                  size="small"
                  color={action.color ?? 'default'}
                  aria-label={action.label}
                  disabled={action.disabled}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    action.onClick(row, rowActionHelpers);
                  }}
                >
                  {action.icon}
                </IconButton>
              </span>
            </AppTooltip>
          ))}
          {hasInlineMenuAction ? (
            <ContextMenuIndicator
              label={t('actions.actions')}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                openRowActionMenuAt(row.id, event.currentTarget, rect.right - 8, rect.top + 12);
              }}
            />
          ) : null}
        </Box>
      </Box>
    );
  }, [getInlineRowActions, openRowActionMenuAt, rowActionHelpers, showInlineRowActionMenu, t]);

  /**
   * Custom footer component with add button. Kept behind useCallback so its
   * component identity is stable: a footer re-created on every render is a
   * different component type to React, which remounts the whole footer
   * subtree (and, through the `slots` object below, invalidates the grid's
   * root props for every rendered row) on each pass.
   */
  const CustomFooter = useCallback(() => {
    if (!shouldRenderGridFooter) {
      return null;
    }

    const hasInvalidCell = hasValidationError || hasInvalidRowInEditMode;

    return (
      <Box
        className={DATA_GRID_CONTINUOUS_SCROLL_FOOTER_CLASS}
        sx={
          showPaginationControls
            ? { ...dataGridFooterSx, justifyContent: 'space-between' }
            : dataGridFooterSx
        }
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          {showAddAction && (
            <AppTooltip title={addButtonLabel}>
              <Button
                onClick={handleAddClick}
                size="small"
                startIcon={<AddIcon fontSize="small" />}
                aria-label={addButtonLabel}
                sx={dataGridAddRowButtonSx}
              >
                {addButtonText ?? addButtonLabel}
              </Button>
            </AppTooltip>
          )}
          {showFooterEditControls && hasUnsavedChanges && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: showAddAction ? 1 : 0 }}>
              <Button size="small" variant="contained" onClick={() => void handleSaveAllDirtyRows()}>
                {t('actions.save')}
              </Button>
              <Button
                size="small"
                onClick={() => {
                  const editIds = Object.entries(rowModesModel)
                    .filter(([, mode]) => mode.mode === GridRowModes.Edit)
                    .map(([id]) => id);
                  for (const id of editIds) {
                    handleDiscardRowChanges(id);
                  }
                }}
              >
                {t('actions.cancel')}
              </Button>
              {hasInvalidCell && <Chip size="small" color="error" label={t('messages.validationErrors')} />}
            </Box>
          )}
        </Box>
        {showPaginationControls && <GridPagination />}
      </Box>
    );
  }, [
    addButtonLabel,
    addButtonText,
    handleAddClick,
    handleDiscardRowChanges,
    handleSaveAllDirtyRows,
    hasInvalidRowInEditMode,
    hasUnsavedChanges,
    hasValidationError,
    rowModesModel,
    shouldRenderGridFooter,
    showAddAction,
    showFooterEditControls,
    showPaginationControls,
    t,
  ]);

  const gridSlots = useMemo(
    () => (shouldRenderGridFooter ? { footer: CustomFooter } : undefined),
    [CustomFooter, shouldRenderGridFooter],
  );

  // MUI keeps every grid prop in one root-props object handed to all its
  // internal components, so a prop rebuilt on each render (a fresh locale
  // object, a fresh selection Set) re-renders every mounted row and cell even
  // when nothing about it changed.
  // getDataGridLocaleText reads the active language at call time, so the
  // resolved language is what invalidates this — not every render.
  const localeLanguage = i18n?.resolvedLanguage ?? i18n?.language;
  // The language is read inside getDataGridLocaleText, so the linter cannot
  // see it as an input of this memo.
  const gridLocaleText = useMemo(
    () => getDataGridLocaleText(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [localeLanguage],
  );
  const gridSx = useMemo(() => ({
    ...dataGridSx,
    width: isContentSizedSurface ? 'max-content' : '100%',
    minWidth: isContentSizedSurface ? 0 : '100%',
    display: 'block',
    ...(
      isContinuousScroll && !isMobile
        ? {
            height: `${resolvedContinuousScrollHeight}px`,
            '& .MuiDataGrid-main': {
              height: `${resolvedContinuousScrollBodyHeight ?? 0}px !important`,
              maxHeight: `${resolvedContinuousScrollBodyHeight ?? 0}px !important`,
              overflow: 'hidden',
            },
            '& .MuiDataGrid-virtualScroller': {
              height: `${resolvedContinuousScrollBodyHeight ?? 0}px !important`,
              maxHeight: `${resolvedContinuousScrollBodyHeight ?? 0}px !important`,
              overflowY: shouldHideContinuousVerticalOverflow ? 'clip !important' : undefined,
            },
            ...(shouldCollapseContinuousRenderZone ? {
              '& .MuiDataGrid-virtualScrollerContent': {
                height: `${currentWindowRowCount * CONTINUOUS_SCROLL_COMPACT_ROW_HEIGHT_PX}px !important`,
              },
              // MUI's render-zone transform now bakes the header height into
              // its vertical offset (translate3d(0, topContainerHeight +
              // scrollOffset, 0)) rather than just carrying scroll offset like
              // pre-v9. Pinning it to `none` here (to drop any leftover
              // scroll-position offset once every row already fits without
              // scrolling) used to be harmless; in v9 it also zeroes the header
              // offset, so rows render underneath the sticky column headers
              // instead of below them. Pin to the header-height translate
              // instead of `none` so the collapse still drops scroll offset but
              // keeps rows positioned below the header.
              '& .MuiDataGrid-virtualScrollerRenderZone': {
                transform: 'translate3d(0, var(--DataGrid-topContainerHeight, 0px), 0) !important',
              },
            } : {}),
            '& .MuiDataGrid-scrollbar--vertical': {
              display: 'none',
            },
          }
        : {}
    ),
    '& .MuiDataGrid-row.ofp-row-long-press .MuiDataGrid-cell': {
      bgcolor: 'action.selected',
    },
    ...(shouldDisableTrailingFiller ? {
      '& .MuiDataGrid-filler': { display: 'none' },
      '& .MuiDataGrid-scrollbarFiller': { display: 'none' },
      '& .MuiDataGrid-scrollbar--horizontal': { display: 'none' },
      '& .MuiDataGrid-main': { width: 'fit-content' },
      '& .MuiDataGrid-virtualScroller': { overflowX: 'hidden !important' },
      '& .MuiDataGrid-virtualScrollerContent': {
        width: 'fit-content !important',
        ...(shouldCollapseContinuousRenderZone ? {
          height: `${currentWindowRowCount * CONTINUOUS_SCROLL_COMPACT_ROW_HEIGHT_PX}px !important`,
        } : {}),
      },
      '& .MuiDataGrid-columnHeaders': { width: 'fit-content !important' },
    } : {}),
  }), [
    currentWindowRowCount,
    isContentSizedSurface,
    isContinuousScroll,
    isMobile,
    resolvedContinuousScrollBodyHeight,
    resolvedContinuousScrollHeight,
    shouldCollapseContinuousRenderZone,
    shouldDisableTrailingFiller,
    shouldHideContinuousVerticalOverflow,
  ]);

  const gridRowSelectionModel = useMemo(
    () => ({ type: "include" as const, ids: new Set(selectedRowIds) }),
    [selectedRowIds],
  );

  /**
   * Process columns to replace notes fields with NotesCell renderer
   */
  const processedColumns: GridColDef[] = useMemo(() => {
    const prepareColumn = (col: GridColDef): GridColDef => {
      const preparedColumn = prepareDataGridColumn(col);
      if (preparedColumn.field !== inlineRowActionField || (!getInlineRowActions && !showInlineRowActionMenu)) {
        return preparedColumn;
      }

      return {
        ...preparedColumn,
        renderCell: (params) => renderInlineActionCell(preparedColumn, params as GridRenderCellParams<T>),
      };
    };

    if (!notes || !notes.fields || notes.fields.length === 0) {
      return columns.map((col) => prepareColumn(col));
    }

    return columns.map((col) => {
      if (!notesFieldNames.includes(col.field)) {
        return prepareColumn(col);
      }

      const fieldConfig = notes.fields.find((f) => f.field === col.field);

      return prepareColumn({
        ...col,
        editable: false,
        renderCell: (params) => {
          const value = (params.value as string) || '';
          const hasValue = value.trim().length > 0;
          const excerpt = hasValue ? getPlainExcerpt(value, 120) : '';

          const row = params.row as T;
          const attachmentCountRaw = fieldConfig?.attachmentCountField
            ? row[fieldConfig.attachmentCountField as keyof T]
            : 0;
          const attachmentCount = typeof attachmentCountRaw === 'number' ? attachmentCountRaw : 0;

          const isPreviewOpen = notesPreview.state?.rowId === params.id && notesPreview.state?.field === col.field;

          return (
            <NotesCell
              hasValue={hasValue}
              excerpt={excerpt}
              rawValue={value}
              attachmentCount={attachmentCount}
              compactIndicator={Boolean(fieldConfig?.compactIndicator)}
              onOpen={() => {
                notesPreview.close();
                notesEditor.handleOpen(params.id, col.field);
              }}
              onOpenAttachments={(event) => {
                event.preventDefault();
                event.stopPropagation();
                notesPreview.close();
                notesEditor.handleOpen(params.id, col.field, { focusAttachments: true });
              }}
              hasFocus={params.hasFocus}
              isPreviewOpen={isPreviewOpen}
              onPreviewOpen={notesEditor.isOpen ? undefined : (anchorEl, mode) => notesPreview.openPreview(anchorEl, params.id, col.field, mode)}
              onPreviewClose={notesEditor.isOpen ? undefined : notesPreview.scheduleClose}
            />
          );
        },
      });
    });
  }, [columns, getInlineRowActions, inlineRowActionField, notes, notesEditor, notesFieldNames, notesPreview, renderInlineActionCell, showInlineRowActionMenu]);

  const columnsWithActions: GridColDef[] = useMemo(() => [
    ...processedColumns,
    ...(showRowEditActions
      ? [
          {
            field: 'rowEditActions',
            headerName: '',
            sortable: false,
            filterable: false,
            hideable: false,
            width: 128,
            align: 'right' as const,
            renderCell: (params: GridCellParams<T>) => {
              const rowId = params.id;
              const rowKey = String(rowId);
              const isEditing = rowModesModel[rowId]?.mode === GridRowModes.Edit;
              const hasLocalDraft = dirtyRowIds.has(rowKey);

              return (
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, width: '100%', justifyContent: 'flex-end' }}>
                  {(isEditing || hasLocalDraft) && (
                    <>
                      <AppTooltip title={t('actions.saveRow')} arrow>
                        <IconButton size="small" color="primary" aria-label={t('actions.save')} onClick={() => void handleSaveRow(rowId)}>
                          <CheckIcon fontSize="small" />
                        </IconButton>
                      </AppTooltip>
                      <AppTooltip title={t('actions.cancelRowEdit')} arrow>
                        <IconButton size="small" aria-label={t('actions.cancel')} onClick={() => handleDiscardRowChanges(rowId)}>
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </AppTooltip>
                    </>
                  )}
                  <AppTooltip title={t('actions.deleteRow')} arrow>
                    <IconButton
                      size="small"
                      color="error"
                      aria-label={t('actions.delete')}
                      onClick={() => handleDeleteClick(rowId)()}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </AppTooltip>
                </Box>
              );
            },
          },
        ]
      : []),
    ...(!showRowEditActions && showDeleteAction
      ? [
          {
            field: 'actions',
            type: 'actions' as const,
            headerName: '',
            width: 70,
            cellClassName: 'actions',
            getActions: ({ id }: GridRowParams<T>) => {
              return [
                <IconButton
                  key={`delete-${id}`}
                  onClick={handleDeleteClick(id)}
                  size="small"
                  sx={deleteIconButtonSx}
                  aria-label={t('actions.delete')}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>,
              ];
            },
          },
        ]
      : []),
  ], [
    dirtyRowIds,
    handleDeleteClick,
    handleDiscardRowChanges,
    handleSaveRow,
    processedColumns,
    rowModesModel,
    showDeleteAction,
    showRowEditActions,
    t,
  ]);

  const isInlineSingleSelectCell = useCallback((params: GridCellParams<T>): boolean => {
    if (!params.isEditable || hasDedicatedEditor(params.field)) {
      return false;
    }

    return columnsWithActions.some((column) => (
      column.field === params.field && column.type === 'singleSelect'
    ));
  }, [columnsWithActions, hasDedicatedEditor]);

  const handleViewModeCellNavigation = useCallback((params: GridCellParams<T>, event: DataGridKeyboardEvent): boolean => {
    if (
      rowModesModel[params.id]?.mode === GridRowModes.Edit ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    ) {
      return false;
    }

    const navigationRequest = getViewModeNavigationRequest(event.key, Boolean(event.shiftKey));
    if (!navigationRequest) {
      return false;
    }

    const navigationOptions = {
      api: gridApiRef.current,
      columns: columnsWithActions,
      current: { id: params.id, field: params.field },
      direction: navigationRequest.direction,
      isActionCell: isActionCellKeyboardNavigable,
      rows: rowsForGrid,
    };
    const target = navigationRequest.axis === 'horizontal'
      ? getKeyboardNavigationTarget<T>({ ...navigationOptions, wrapRows: navigationRequest.wrapRows })
      : getVerticalKeyboardNavigationTarget<T>(navigationOptions);

    if (!target) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    event.defaultMuiPrevented = true;
    runAfterRowVisible(target.id, () => {
      focusDataGridKeyboardNavigableCell<T>({
        api: gridApiRef.current,
        cell: target,
      });
    });
    return true;
  }, [
    columnsWithActions,
    gridApiRef,
    isActionCellKeyboardNavigable,
    rowModesModel,
    rowsForGrid,
    runAfterRowVisible,
  ]);

  const getNotesDrawerTitle = (): string => {
    if (!notesEditor.field || !notes) return 'Notizen';
    
    const config = notes.fields.find(f => f.field === notesEditor.field);
    if (!config) return 'Notizen';
    
    // Use titleKey if provided
    if (config.titleKey) {
      return t(config.titleKey);
    }
    
    // Use labelKey if provided
    if (config.labelKey) {
      const fieldLabel = t(config.labelKey);
      return `${fieldLabel} – Notizen`;
    }
    
    // Fallback to field name from translations
    const fieldLabel = t(`fields.${notesEditor.field}`);
    if (fieldLabel !== `fields.${notesEditor.field}`) {
      return `${fieldLabel} – Notizen`;
    }
    
    // Last resort: use field name itself
    return `${notesEditor.field} – Notizen`;
  };

  const previewState = notesPreview.state;
  const previewRow = previewState ? rowsById.get(String(previewState.rowId)) : undefined;
  const previewFieldConfig = previewState && notes
    ? notes.fields.find((f) => f.field === previewState.field)
    : undefined;
  const previewRawValue = previewState && previewRow
    ? ((previewRow[previewState.field as keyof T] as string) || '')
    : '';
  const previewAttachmentCountRaw = previewFieldConfig?.attachmentCountField && previewRow
    ? previewRow[previewFieldConfig.attachmentCountField as keyof T]
    : 0;
  const previewAttachmentCount = typeof previewAttachmentCountRaw === 'number' ? previewAttachmentCountRaw : 0;
  const previewNoteIdRaw = previewFieldConfig?.attachmentNoteIdField && previewRow
    ? previewRow[previewFieldConfig.attachmentNoteIdField as keyof T]
    : undefined;
  const previewNoteId = typeof previewNoteIdRaw === 'number' ? previewNoteIdRaw : undefined;

  useEffect(() => {
    if (!onRowsStateChange) {
      return;
    }
    onRowsStateChange(rows as T[]);
  }, [onRowsStateChange, rows]);

  useEffect(() => {
    if (!onLoadStateChange) {
      return;
    }
    onLoadStateChange({ loading, dataFetched, error });
  }, [dataFetched, error, loading, onLoadStateChange]);

  useEffect(() => {
    if (!onSelectedRowChange) {
      return;
    }

    const selectedId = selectedRowIds[0];
    const selectedRow = rows.find((row) => row.id === selectedId) as T | undefined;
    onSelectedRowChange(selectedRow ?? null);
  }, [onSelectedRowChange, selectedRowIds, rows]);

  return (
    <>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {showContextMenuHint ? (
        <ContextMenuHint
          variant="desktop"
          message={t('messages.contextMenuTableHint')}
          onClose={closeContextMenuHint}
          sx={{ mb: 1.25 }}
        />
      ) : null}
      {showTouchContextMenuHint ? (
        <ContextMenuHint
          variant="touch"
          message={t('messages.contextMenuTableHintTouch')}
          onClose={closeTouchContextMenuHint}
          sx={{ mb: 1.25 }}
        />
      ) : null}
      
      <Box
        ref={pageContentRef}
        sx={{
          position: 'relative',
          width: '100%',
          maxWidth: '100%',
          minWidth: 0,
          overflow: 'visible',
        }}
      >
        <Box
          ref={horizontalScrollRef}
          onKeyDownCapture={handleGridEditNavigation}
          sx={{
            minWidth: 0,
            maxWidth: '100%',
            overflowX: 'auto',
            overflowY: 'visible',
            display: 'flex',
            justifyContent: shouldUseCompactContainer || isContentSizedSurface ? 'center' : 'flex-start',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              width: isContentSizedSurface ? 'max-content' : '100%',
              minWidth: isContentSizedSurface ? 0 : '100%',
            }}
          >
            <Box
            ref={gridSurfaceRef}
            onContextMenuCapture={hasContextualRowActions ? (event) => {
              if (!isRowActionContextMenuTarget(event.target)) {
                return;
              }
              const rowId = getRowIdFromElement(event.target);
              if (rowId === null) {
                return;
              }
              openRowActionContextMenu(rowId, event);
            } : undefined}
            onTouchStart={hasContextualRowActions ? handleGridTouchStart : undefined}
            onTouchMove={hasContextualRowActions ? handleGridTouchMove : undefined}
            onTouchEnd={hasContextualRowActions ? handleGridTouchEnd : undefined}
            onTouchCancel={hasContextualRowActions ? handleGridTouchEnd : undefined}
            onKeyDownCapture={handleGridSurfaceKeyDownCapture}
            onMouseDownCapture={handleReadOnlyCellMouseDown}
            sx={{
              position: 'relative',
              display: 'block',
              width: isContentSizedSurface ? 'max-content' : '100%',
              minWidth: isContentSizedSurface ? 0 : '100%',
              maxWidth: isContentSizedSurface ? 'none' : '100%',
              '& [role="row"][data-id]': {
                WebkitTouchCallout: 'none',
              },
            }}
          >
            <EditCellNavigationContext.Provider value={handleEditCellTabNavigation}>
              <SelectEditCellContext.Provider value={selectEditCellContextValue}>
              <DialogEditCellContext.Provider value={dialogEditCellContextValue}>
              <DataGrid
          rows={rowsForGrid}
          columns={columnsWithActions}
          columnVisibilityModel={columnVisibilityModel}
          onColumnVisibilityModelChange={onColumnVisibilityModelChange}
          rowModesModel={rowModesModel}
          onRowModesModelChange={setRowModesModel}
          onRowEditStop={handleEditableRowEditStop}
          processRowUpdate={processRowUpdate}
          onProcessRowUpdateError={handleProcessRowUpdateError}
          loading={loading}
          editMode="row"
          density={isMobile ? 'standard' : 'compact'}
          autoHeight={!isContinuousScroll || isMobile}
          hideFooter={!shouldRenderGridFooter}
          pagination={showPaginationControls || isContinuousScroll ? true : undefined}
          paginationModel={showPaginationControls || isContinuousScroll ? activePaginationModel : undefined}
          onPaginationModelChange={
            isContinuousScroll
              ? () => {}
              : showPaginationControls
                ? setPaginationModel
                : undefined
          }
          pageSizeOptions={showPaginationControls ? paginationPageSizeOptions : undefined}
          rowHeight={isContinuousScroll ? CONTINUOUS_SCROLL_REQUESTED_ROW_HEIGHT_PX : undefined}
          columnHeaderHeight={isContinuousScroll ? CONTINUOUS_SCROLL_HEADER_HEIGHT_PX : undefined}
          sortModel={sortModel}
          onSortModelChange={handleSortModelChange}
          sortingMode="server"
          filterModel={filterModel}
          onFilterModelChange={handleFilterModelChange}
          rowSelectionModel={gridRowSelectionModel}
          onRowSelectionModelChange={(nextModel) => setSelectedRowIds(Array.from(nextModel.ids))}
          slots={gridSlots}
          sx={gridSx}
          getRowClassName={(params) => {
            const rowKey = String(params.id);
            const classNames: string[] = [];
            if (rowModesModel[params.id]?.mode === GridRowModes.Edit) {
              classNames.push('ofp-row-editing');
            }
            if (dirtyRowIds.has(rowKey)) {
              classNames.push('ofp-row-dirty');
            }
            if (longPressFeedbackRowId !== null && String(longPressFeedbackRowId) === rowKey) {
              classNames.push('ofp-row-long-press');
            }
            return classNames.join(' ');
          }}
          getCellClassName={(params) => {
            const rowKey = String(params.id);
            const errorText = activeValidationErrors[rowKey]?.[params.field] ?? rowValidationErrors[rowKey]?.[params.field];
            if (errorText) {
              return 'ofp-cell-error';
            }
            if (dirtyRowIds.has(rowKey)) {
              return 'ofp-cell-dirty';
            }
            return '';
          }}
          onCellClick={(params, event) => {
            if (isAnyContextMenuOpen() || isContextMenuDismissGestureInProgress()) {
              event?.preventDefault?.();
              event?.stopPropagation?.();
              if (event) {
                event.defaultMuiPrevented = true;
              }
              return;
            }

            if (!isCellKeyboardNavigable<T>({
              api: gridApiRef.current,
              field: params.field,
              isActionCell: isActionCellKeyboardNavigable,
              rowId: params.id,
            })) {
              event.preventDefault();
              event.stopPropagation();
              event.defaultMuiPrevented = true;
              return;
            }

            const rowKey = String(params.id);
            activeEditCellRef.current = { id: params.id, field: params.field };
            if (!rowSnapshotRef.current.has(rowKey)) {
              const row = rowsById.get(rowKey);
              if (row) {
                rowSnapshotRef.current.set(rowKey, row as T);
              }
            }
            markRowDirty(rowKey);
            if (hasDedicatedEditor(params.field)) {
              // The cell's own popover/dialog is the editor and the click has
              // already opened it — never layer inline edit mode on top.
              return;
            }
            if (isInlineSingleSelectCell(params)) {
              requestSelectEditOpenForCell(params.id, params.field);
            }
            handleEditableCellClick(params, rowModesModel, setRowModesModel);
          }}
          onCellKeyDown={(params: GridCellParams<T>, event) => {
            activeEditCellRef.current = { id: params.id, field: params.field };
            if (
              hasContextualRowActions &&
              (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) &&
              rowsById.has(String(params.id))
            ) {
              event.preventDefault();
              event.stopPropagation();
              event.defaultMuiPrevented = true;
              openRowActionKeyboardContextMenu(params.id, event.currentTarget as HTMLElement);
              return;
            }

            if (
              rowModesModel[params.id]?.mode === GridRowModes.Edit &&
              handleEditedCellTabNavigation(
                { id: params.id, field: params.field },
                event as unknown as DataGridKeyboardEvent,
              )
            ) {
              return;
            }

            if (
              event.key === 'Tab' ||
              event.key === 'ArrowLeft' ||
              event.key === 'ArrowRight' ||
              event.key === 'ArrowUp' ||
              event.key === 'ArrowDown'
            ) {
              const didNavigate = handleViewModeCellNavigation(params, event as unknown as DataGridKeyboardEvent);
              if (didNavigate) {
                return;
              }
            }

            const shouldOpenNotes =
              notesFieldNames.includes(params.field) &&
              (event.key === 'Enter' || event.key === ' ') &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey;

            if (shouldOpenNotes) {
              event.preventDefault();
              event.defaultMuiPrevented = true;
              notesEditor.handleOpen(params.id, params.field);
              return;
            }

            if (spreadsheetEditStarter.startEditFromF2(params, event)) {
              return;
            }

            if (spreadsheetEditStarter.startEditFromPrintableKey(params, event)) {
              return;
            }

            const shouldStartCellEdit =
              event.key === 'Enter' &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey &&
              !event.shiftKey &&
              params.isEditable &&
              rowModesModel[params.id]?.mode !== GridRowModes.Edit;

            if (shouldStartCellEdit) {
              event.preventDefault();
              event.defaultMuiPrevented = true;
              handleStartCellEditFromKeyboard(params);
              return;
            }
            if (
              rowModesModel[params.id]?.mode === GridRowModes.Edit &&
              editModeEditorArrowKeys.has(event.key) &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey
            ) {
              event.defaultMuiPrevented = true;
              return;
            }
            const shouldHandleEnterInEditedRow =
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.altKey &&
              rowModesModel[params.id]?.mode === GridRowModes.Edit;
            if (shouldHandleEnterInEditedRow) {
              event.defaultMuiPrevented = true;
              if (isEnterSaveInputTarget(event.target)) {
                event.preventDefault();
                saveEditedRowAndFocusNextVerticalCell({ id: params.id, field: params.field });
              }
              return;
            }
            if (event.key === 'Escape' && rowModesModel[params.id]?.mode === GridRowModes.Edit) {
              // Only intercept Escape for a row actually being edited — MUI's
              // default Escape handling (and its own focus-restoration) is
              // fine for a row that isn't, and this keeps
              // handleDiscardRowChanges' focus-restore fallback from firing
              // on unrelated cells.
              event.preventDefault();
              event.defaultMuiPrevented = true;
              handleDiscardRowChanges(params.id);
              return;
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
              event.preventDefault();
              void handleSaveRow(params.id);
            }
          }}
          localeText={gridLocaleText}
          apiRef={gridApiRef}
              />
              </DialogEditCellContext.Provider>
              </SelectEditCellContext.Provider>
            </EditCellNavigationContext.Provider>
          </Box>
          </Box>
        </Box>
        {!isMobile && isContinuousScroll && (
          // Deliberately a sibling of the overflowX:'auto' horizontal-scroll
          // Box above, not a child of gridSurfaceRef inside it: gridSurfaceRef
          // is sized to the full (possibly viewport-exceeding) table content
          // under surfaceSizing="contentFit", so a `right: 0` anchored there
          // sits at the content's right edge, not the visible viewport's —
          // scrolling the table horizontally carried the track out of view.
          // pageContentRef (this Box's parent) stays at the fixed visible
          // width regardless of the inner horizontal scroll position.
          <StableScrollbarTrack
            trackRef={stableScrollbarTrackRef}
            thumbRef={stableScrollbarThumbRef}
            scrollbar={stableScrollbar}
            top={continuousScrollLayoutHeights.header}
            bottom={continuousScrollLayoutHeights.footer + continuousScrollLayoutHeights.border}
            right={scrollbarRightOffsetPx}
            trackTestId="continuous-scrollbar-track"
            thumbTestId="continuous-scrollbar-thumb"
          />
        )}
      </Box>
      <CustomContextMenu
        open={Boolean(rowActionMenuState)}
        onClose={closeRowActionMenu}
        keyboardNavigation
        listRef={rowActionMenuListRef}
        anchorEl={rowActionMenuState?.anchorEl}
        mouseX={rowActionMenuState?.mouseX}
        mouseY={rowActionMenuState?.mouseY}
      >
        {menuActions.map((action) => (
          <ContextMenuActionItem
            key={action.id}
            label={action.label}
            icon={action.icon}
            color={action.color === 'error' || action.color === 'primary' ? action.color : undefined}
            disabled={action.disabled}
            onClick={() => {
              if (!menuRow) {
                return;
              }
              closeRowActionMenu();
              action.onClick(menuRow, rowActionHelpers);
            }}
          />
        ))}
        <TableCopyMenuItems
          rowValues={menuRow ? getClipboardRowValues(menuRow) : null}
          tableRows={getClipboardTableRows()}
          includeDivider={menuActions.length > 0}
          onClose={closeRowActionMenu}
        />
      </CustomContextMenu>

      {deleteUndoOptions ? pendingDeleteWithUndo.map((deletion, index) => (
        <DeleteUndoSnackbar
          key={deletion.id}
          open={deletion.visible}
          message={deleteUndoOptions.message}
          undoLabel={t('actions.undo')}
          offsetIndex={index}
          testId={deleteUndoOptions.snackbarTestId ?? 'data-grid-delete-snackbar'}
          onClose={() => closeDeleteWithUndoSnackbar(deletion.id)}
          onUndo={() => {
            void undoDeleteWithUndo(deletion.id);
          }}
        />
      )) : null}

      {/* Notes Editor Drawer */}
      {notes && notes.fields && notes.fields.length > 0 && (
        <NotesDrawer
          open={notesEditor.isOpen}
          title={getNotesDrawerTitle()}
          value={notesEditor.draft}
          onChange={notesEditor.setDraft}
          onSave={notesEditor.handleSave}
          onClose={notesEditor.handleClose}
          hasUnsavedChanges={Boolean(
            notesEditor.currentRow &&
              notesEditor.field &&
              notesEditor.draft !== ((notesEditor.currentRow[notesEditor.field] as string) || ''),
          )}
          loading={notesEditor.isSaving}
          focusAttachments={notesEditor.focusAttachments}
          focusRequestId={notesEditor.focusRequestId}
          noteId={(() => {
            if (!notesEditor.currentRow || !notesEditor.field || !notes) return undefined;
            const cfg = notes.fields.find((f) => f.field === notesEditor.field);
            if (!cfg?.attachmentNoteIdField) return undefined;
            const val = notesEditor.currentRow[cfg.attachmentNoteIdField as keyof typeof notesEditor.currentRow];
            return typeof val === "number" ? val : undefined;
          })()}
        />
      )}

      {/* Notes preview popover: single shared instance for the whole grid */}
      {notes && notes.fields && notes.fields.length > 0 && (
        <NotesPreviewPopover
          open={Boolean(previewState)}
          anchorEl={previewState?.anchorEl ?? null}
          rawValue={previewRawValue}
          hasValue={previewRawValue.trim().length > 0}
          noteId={previewNoteId}
          attachmentCount={previewAttachmentCount}
          onClose={notesPreview.close}
          onOpenNote={() => {
            if (!previewState) return;
            notesEditor.handleOpen(previewState.rowId, previewState.field);
            notesPreview.close();
          }}
          onOpenAttachment={() => {
            if (!previewState) return;
            notesEditor.handleOpen(previewState.rowId, previewState.field, { focusAttachments: true });
            notesPreview.close();
          }}
          onMouseEnter={notesPreview.cancelScheduledClose}
          onMouseLeave={notesPreview.scheduleClose}
        />
      )}
    </>
  );
}
