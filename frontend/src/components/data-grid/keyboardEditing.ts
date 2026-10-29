// Excel-like edit entry points shared by every inline-editing grid: "just
// start typing" (replace the cell value), F2 and Enter (edit in place) and
// double click. See docs/datagrid-architecture.md ("Spreadsheet edit model")
// for the broader picture.
import { useCallback, useEffect, useRef } from 'react';
import type React from 'react';
import { flushSync } from 'react-dom';
import { GridRowModes } from '@mui/x-data-grid';
import type { GridCellParams, GridRowId, GridRowModesModel, GridValidRowModel } from '@mui/x-data-grid';
import { EDIT_CELL_FOCUS_TARGET_SELECTOR } from './keyboardNavigation';

type DataGridKeyboardEvent = React.KeyboardEvent & {
  defaultMuiPrevented?: boolean;
};

type DataGridMouseEvent = React.MouseEvent & {
  defaultMuiPrevented?: boolean;
};

export type SpreadsheetEditTrigger = 'typing' | 'f2' | 'enter' | 'doubleClick';

// Typing a character into a date or select cell would replace its value with
// that single character, which neither editor can make sense of. Those cells
// start editing only by double click, Enter or F2; once open, their editors
// take typed input (segmented date entry, select typeahead) themselves.
const COLUMN_TYPES_WITHOUT_TYPED_START = new Set(['date', 'dateTime', 'singleSelect']);

export const acceptsTypedStartValue = (params: Pick<GridCellParams, 'colDef'>): boolean =>
  !COLUMN_TYPES_WITHOUT_TYPED_START.has(params.colDef?.type ?? 'string');

interface SpreadsheetEditApi {
  getCellElement?: (id: GridRowId, field: string) => HTMLElement | null;
  isCellEditable?: (params: GridCellParams) => boolean;
  setCellFocus?: (id: GridRowId, field: string) => void;
  setEditCellValue?: (params: { id: GridRowId; field: string; value: unknown }) => Promise<boolean> | boolean | void;
}

interface PendingEditValue {
  id: GridRowId;
  field: string;
  value: string;
}

interface UseSpreadsheetEditStarterParams<Row extends GridValidRowModel> {
  apiRef: {
    current?: SpreadsheetEditApi | null;
  };
  rowModesModel: GridRowModesModel;
  setRowModesModel: React.Dispatch<React.SetStateAction<GridRowModesModel>>;
  isCellEditable?: (params: GridCellParams<Row>) => boolean;
  onBeforeEdit?: (params: GridCellParams<Row>, trigger: SpreadsheetEditTrigger) => void;
  onReplaceValue?: (params: GridCellParams<Row>, value: string) => void;
  /** Runs after an edit was started by any of the entry points. */
  onEditStarted?: (params: GridCellParams<Row>, trigger: SpreadsheetEditTrigger) => void;
}

interface UseSpreadsheetEditStarterResult<Row extends GridValidRowModel> {
  /** Whether a view-mode cell may be opened for editing at all. */
  canStartEdit: (params: GridCellParams<Row>) => boolean;
  startEditFromPrintableKey: (
    params: GridCellParams<Row>,
    event: React.KeyboardEvent,
  ) => boolean;
  startEditFromF2: (
    params: GridCellParams<Row>,
    event: React.KeyboardEvent,
  ) => boolean;
  startEditFromEnter: (
    params: GridCellParams<Row>,
    event: React.KeyboardEvent,
  ) => boolean;
  startEditFromDoubleClick: (
    params: GridCellParams<Row>,
    event: React.MouseEvent,
  ) => boolean;
}

const getPendingKey = (id: GridRowId, field: string): string => `${String(id)}\u0000${field}`;

const isRowEditing = (rowModesModel: GridRowModesModel, rowId: GridRowId): boolean =>
  rowModesModel[rowId]?.mode === GridRowModes.Edit
  || rowModesModel[String(rowId)]?.mode === GridRowModes.Edit;

const isSpreadsheetPrintableKey = (event: DataGridKeyboardEvent): boolean => (
  event.key.length === 1
  && event.key !== ' '
  && !event.altKey
  && !event.ctrlKey
  && !event.metaKey
  && !event.nativeEvent?.isComposing
);

const markMuiEventHandled = (event: DataGridKeyboardEvent): void => {
  event.preventDefault();
  event.stopPropagation();
  event.defaultMuiPrevented = true;
};

const isEditableEventTarget = (event: DataGridKeyboardEvent): boolean => {
  const target = event.target;
  return target instanceof HTMLElement && Boolean(target.closest(EDIT_CELL_FOCUS_TARGET_SELECTOR));
};

export function useSpreadsheetEditStarter<Row extends GridValidRowModel>({
  apiRef,
  rowModesModel,
  setRowModesModel,
  isCellEditable,
  onBeforeEdit,
  onReplaceValue,
  onEditStarted,
}: UseSpreadsheetEditStarterParams<Row>): UseSpreadsheetEditStarterResult<Row> {
  const pendingValuesRef = useRef<Map<string, PendingEditValue>>(new Map());
  const clearTimersRef = useRef<Map<string, number>>(new Map());
  const focusTimerRef = useRef<number | null>(null);
  const focusFrameRef = useRef<number | null>(null);
  const unmountedRef = useRef(false);

  const cancelScheduledFocus = useCallback((): void => {
    if (focusTimerRef.current !== null) {
      window.clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }
    if (focusFrameRef.current !== null) {
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(focusFrameRef.current);
      }
      focusFrameRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    unmountedRef.current = true;
    cancelScheduledFocus();
    clearTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    clearTimersRef.current.clear();
    pendingValuesRef.current.clear();
  }, [cancelScheduledFocus]);

  const clearPendingLater = useCallback((pendingKey: string): void => {
    const existingTimer = clearTimersRef.current.get(pendingKey);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }
    const timerId = window.setTimeout(() => {
      clearTimersRef.current.delete(pendingKey);
      pendingValuesRef.current.delete(pendingKey);
    }, 250);
    clearTimersRef.current.set(pendingKey, timerId);
  }, []);

  const focusEditInput = useCallback((
    id: GridRowId,
    field: string,
    caretPosition?: number,
  ): void => {
    // A newer focus request supersedes whatever the previous one still had
    // scheduled — otherwise a stale attempt lands on the previously edited
    // cell after this one already focused the new cell.
    cancelScheduledFocus();

    const focusEditor = (): boolean => {
      if (unmountedRef.current) {
        return false;
      }
      const cellElement = apiRef.current?.getCellElement?.(id, field);
      const editor = cellElement?.querySelector<HTMLElement>(EDIT_CELL_FOCUS_TARGET_SELECTOR);
      if (!editor) {
        return false;
      }

      editor.focus({ preventScroll: true });
      if (
        typeof caretPosition === 'number'
        && (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement)
      ) {
        const position = Math.min(caretPosition, editor.value.length);
        try {
          editor.setSelectionRange(position, position);
        } catch {
          // Some non-text input types expose setSelectionRange but reject it.
        }
      }
      return true;
    };

    // The editor may not be mounted yet, so the same attempt is repeated
    // across a microtask, a macrotask and a frame. The handles are kept so
    // they can be cancelled: an uncancelled timer that fires after the grid
    // unmounted reaches for a cell element that no longer exists — in tests
    // that outlives the jsdom environment and fails the whole run with
    // "document is not defined" even though every test passed.
    focusEditor();
    queueMicrotask(focusEditor);
    focusTimerRef.current = window.setTimeout(() => {
      focusTimerRef.current = null;
      focusEditor();
    }, 0);
    if (typeof window.requestAnimationFrame === 'function') {
      focusFrameRef.current = window.requestAnimationFrame(() => {
        focusFrameRef.current = null;
        focusEditor();
      });
    }
  }, [apiRef, cancelScheduledFocus]);

  const flushPendingValue = useCallback((pendingKey: string): void => {
    const applyPendingValue = (): void => {
      const pendingValue = pendingValuesRef.current.get(pendingKey);
      const api = apiRef.current;
      if (!pendingValue || !api?.setEditCellValue) {
        return;
      }

      const valueAtFlushStart = pendingValue.value;
      void Promise.resolve(api.setEditCellValue({
        id: pendingValue.id,
        field: pendingValue.field,
        value: valueAtFlushStart,
      })).then(() => {
        focusEditInput(pendingValue.id, pendingValue.field, valueAtFlushStart.length);
      });
    };

    applyPendingValue();
    queueMicrotask(applyPendingValue);
    window.setTimeout(applyPendingValue, 0);
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(applyPendingValue);
    }
  }, [apiRef, focusEditInput]);

  const canStartEdit = useCallback((params: GridCellParams<Row>): boolean => {
    if (!params.isEditable || isRowEditing(rowModesModel, params.id)) {
      return false;
    }
    if (isCellEditable && !isCellEditable(params)) {
      return false;
    }
    return apiRef.current?.isCellEditable?.(params as GridCellParams) ?? true;
  }, [apiRef, isCellEditable, rowModesModel]);

  const canReplaceEditingCell = useCallback((
    params: GridCellParams<Row>,
    event: DataGridKeyboardEvent,
  ): boolean => {
    if (
      !params.isEditable
      || !isRowEditing(rowModesModel, params.id)
      || isEditableEventTarget(event)
    ) {
      return false;
    }
    if (isCellEditable && !isCellEditable(params)) {
      return false;
    }
    return apiRef.current?.isCellEditable?.(params as GridCellParams) ?? true;
  }, [apiRef, isCellEditable, rowModesModel]);

  const focusCellForEdit = useCallback((params: GridCellParams<Row>): void => {
    apiRef.current?.setCellFocus?.(params.id, params.field);
    flushSync(() => {
      setRowModesModel((oldModel) => {
        const previousMode = oldModel[params.id] ?? oldModel[String(params.id)] ?? {};
        return {
          ...oldModel,
          [params.id]: {
            ...previousMode,
            mode: GridRowModes.Edit,
            fieldToFocus: params.field,
          },
        };
      });
    });
    focusEditInput(params.id, params.field);
  }, [apiRef, focusEditInput, setRowModesModel]);

  const startEdit = useCallback((
    params: GridCellParams<Row>,
    trigger: SpreadsheetEditTrigger,
  ): boolean => {
    if (!canStartEdit(params)) {
      return false;
    }

    onBeforeEdit?.(params, trigger);
    focusCellForEdit(params);
    onEditStarted?.(params, trigger);
    return true;
  }, [canStartEdit, focusCellForEdit, onBeforeEdit, onEditStarted]);

  const startEditFromPrintableKey = useCallback((
    params: GridCellParams<Row>,
    event: React.KeyboardEvent,
  ): boolean => {
    const keyboardEvent = event as DataGridKeyboardEvent;
    if (!isSpreadsheetPrintableKey(keyboardEvent)) {
      return false;
    }

    const pendingKey = getPendingKey(params.id, params.field);
    const pendingValue = pendingValuesRef.current.get(pendingKey);
    const canEditFromView = canStartEdit(params) && acceptsTypedStartValue(params);
    const canEditFocusedCell = canReplaceEditingCell(params, keyboardEvent);
    if (!pendingValue && !canEditFromView && !canEditFocusedCell) {
      return false;
    }

    markMuiEventHandled(keyboardEvent);
    if (!pendingValue && canEditFromView) {
      onBeforeEdit?.(params, 'typing');
      focusCellForEdit(params);
      onEditStarted?.(params, 'typing');
    }

    const previousValue = pendingValue?.value ?? '';
    const nextValue = `${previousValue}${keyboardEvent.key}`;
    pendingValuesRef.current.set(pendingKey, {
      id: params.id,
      field: params.field,
      value: nextValue,
    });
    onReplaceValue?.(params, nextValue);
    flushPendingValue(pendingKey);
    clearPendingLater(pendingKey);
    return true;
  }, [
    canReplaceEditingCell,
    canStartEdit,
    clearPendingLater,
    focusCellForEdit,
    flushPendingValue,
    onBeforeEdit,
    onEditStarted,
    onReplaceValue,
  ]);

  const startEditFromF2 = useCallback((
    params: GridCellParams<Row>,
    event: React.KeyboardEvent,
  ): boolean => {
    const keyboardEvent = event as DataGridKeyboardEvent;
    if (
      keyboardEvent.key !== 'F2'
      || keyboardEvent.altKey
      || keyboardEvent.ctrlKey
      || keyboardEvent.metaKey
      || !startEdit(params, 'f2')
    ) {
      return false;
    }

    markMuiEventHandled(keyboardEvent);
    return true;
  }, [startEdit]);

  const startEditFromEnter = useCallback((
    params: GridCellParams<Row>,
    event: React.KeyboardEvent,
  ): boolean => {
    const keyboardEvent = event as DataGridKeyboardEvent;
    if (
      keyboardEvent.key !== 'Enter'
      || keyboardEvent.altKey
      || keyboardEvent.ctrlKey
      || keyboardEvent.metaKey
      || keyboardEvent.shiftKey
      || !startEdit(params, 'enter')
    ) {
      return false;
    }

    // Not stopped from propagating: the grid's own capture handlers still
    // need to see Enter, only MUI's default edit start is replaced.
    keyboardEvent.preventDefault();
    keyboardEvent.defaultMuiPrevented = true;
    return true;
  }, [startEdit]);

  const startEditFromDoubleClick = useCallback((
    params: GridCellParams<Row>,
    event: React.MouseEvent,
  ): boolean => {
    const mouseEvent = event as DataGridMouseEvent;
    if (mouseEvent.button !== 0 || !canStartEdit(params)) {
      return false;
    }

    mouseEvent.defaultMuiPrevented = true;
    onBeforeEdit?.(params, 'doubleClick');
    // The pointer already focused the cell, and MUI focuses `fieldToFocus`
    // once the editor mounts. The keyboard path's repeated focus attempts
    // must not run here: they would pull focus back out of a select menu the
    // double click opens.
    setRowModesModel((oldModel) => ({
      ...oldModel,
      [params.id]: { mode: GridRowModes.Edit, fieldToFocus: params.field },
    }));
    onEditStarted?.(params, 'doubleClick');
    return true;
  }, [canStartEdit, onBeforeEdit, onEditStarted, setRowModesModel]);

  return {
    canStartEdit,
    startEditFromPrintableKey,
    startEditFromF2,
    startEditFromEnter,
    startEditFromDoubleClick,
  };
}
