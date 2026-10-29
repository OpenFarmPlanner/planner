// The spreadsheet edit model shared by every inline-editing grid (desktop):
// a single click only selects, editing starts by double click, Enter, F2 or
// typing, and repeated single clicks on an editable cell bring up the edit
// hint. Touch and narrow layouts keep tap-to-edit. See
// docs/datagrid-architecture.md ("Spreadsheet edit model").
import { useCallback, useRef } from 'react';
import type React from 'react';
import { GridRowModes } from '@mui/x-data-grid';
import type { GridCellParams, GridRowId, GridValidRowModel } from '@mui/x-data-grid';
import { useSpreadsheetEditStarter, type SpreadsheetEditTrigger } from './keyboardEditing';
import { handleEditableCellClick } from './handlers';
import { EDITABLE_CELL_CLASS } from './styles';
import { useEditHint, type EditHintControls } from './useEditHint';

type SpreadsheetEditStarterParams<Row extends GridValidRowModel> = Parameters<typeof useSpreadsheetEditStarter<Row>>[0];

interface UseSpreadsheetCellEditingParams<Row extends GridValidRowModel>
  extends SpreadsheetEditStarterParams<Row> {
  /**
   * Desktop (fine pointer, wide layout): the spreadsheet model. Otherwise a
   * tap on an editable cell starts editing, unchanged from before.
   */
  spreadsheetMode: boolean;
  /** Cells in rows like hierarchy groups never trigger the edit hint. */
  isHintEligible?: (params: GridCellParams<Row>) => boolean;
}

export interface SpreadsheetCellEditing<Row extends GridValidRowModel> {
  /** Returns true when the click started editing (touch mode only). */
  handleCellClick: (params: GridCellParams<Row>, event?: React.MouseEvent) => boolean;
  handleCellDoubleClick: (params: GridCellParams<Row>, event: React.MouseEvent) => void;
  /** Handles F2, Enter and typing on a view-mode cell; returns true when handled. */
  handleCellKeyDown: (params: GridCellParams<Row>, event: React.KeyboardEvent) => boolean;
  getEditableCellClassName: (params: GridCellParams<Row>) => string;
  editHint: EditHintControls;
}

interface ClickedCell {
  id: GridRowId;
  field: string;
}

const CONTROL_INSIDE_CELL_SELECTOR = 'a[href], button, input, select, textarea, [role="button"], [role="menuitem"]';

// A press on a control inside the cell (expand toggle, row actions) belongs
// to that control. The cell element itself is excluded: the focused cell
// carries tabindex="0" and must still count as a cell.
const isOnControlInsideCell = (event: React.MouseEvent): boolean => {
  const { target, currentTarget } = event;
  if (!(target instanceof Element)) {
    return false;
  }
  const control = target.closest(CONTROL_INSIDE_CELL_SELECTOR);
  return control !== null && control !== currentTarget && currentTarget.contains(control);
};

// `detail` counts the clicks of one gesture: 1 is a lone click, 2 the second
// half of a double click, 0 a click synthesized from the keyboard.
const isLoneMouseClick = (event: React.MouseEvent): boolean => {
  const pointerType = (event.nativeEvent as PointerEvent | undefined)?.pointerType;
  return event.detail === 1 && event.button === 0 && (!pointerType || pointerType === 'mouse');
};

export function useSpreadsheetCellEditing<Row extends GridValidRowModel>({
  spreadsheetMode,
  isHintEligible,
  onEditStarted,
  ...starterParams
}: UseSpreadsheetCellEditingParams<Row>): SpreadsheetCellEditing<Row> {
  const editHint = useEditHint();
  const { markEdited, requestHint } = editHint;
  const lastClickedCellRef = useRef<ClickedCell | null>(null);
  const { rowModesModel, setRowModesModel, isCellEditable } = starterParams;

  const handleEditStarted = useCallback((params: GridCellParams<Row>, trigger: SpreadsheetEditTrigger): void => {
    lastClickedCellRef.current = null;
    markEdited();
    onEditStarted?.(params, trigger);
  }, [markEdited, onEditStarted]);

  const starter = useSpreadsheetEditStarter<Row>({
    ...starterParams,
    onEditStarted: handleEditStarted,
  });
  const { canStartEdit } = starter;

  const handleCellClick = useCallback((params: GridCellParams<Row>, event?: React.MouseEvent): boolean => {
    if (!spreadsheetMode) {
      const startsEdit = Boolean(params.isEditable) && rowModesModel[params.id]?.mode !== GridRowModes.Edit;
      handleEditableCellClick(params, rowModesModel, setRowModesModel);
      return startsEdit;
    }

    const isHintCandidate = event !== undefined
      && isLoneMouseClick(event)
      && !isOnControlInsideCell(event)
      && canStartEdit(params)
      && (isHintEligible?.(params) ?? true);
    if (!isHintCandidate) {
      lastClickedCellRef.current = null;
      return false;
    }

    const lastClickedCell = lastClickedCellRef.current;
    if (lastClickedCell && String(lastClickedCell.id) === String(params.id) && lastClickedCell.field === params.field) {
      lastClickedCellRef.current = null;
      requestHint();
      return false;
    }
    lastClickedCellRef.current = { id: params.id, field: params.field };
    return false;
  }, [canStartEdit, isHintEligible, requestHint, rowModesModel, setRowModesModel, spreadsheetMode]);

  const handleCellDoubleClick = useCallback((params: GridCellParams<Row>, event: React.MouseEvent): void => {
    if (!spreadsheetMode) {
      return;
    }
    // Whatever the double click does not start, MUI must not start either:
    // a double click on a button inside the cell (expand toggle, row
    // actions) belongs to that button.
    (event as React.MouseEvent & { defaultMuiPrevented?: boolean }).defaultMuiPrevented = true;
    if (!isOnControlInsideCell(event)) {
      starter.startEditFromDoubleClick(params, event);
    }
  }, [spreadsheetMode, starter]);

  const handleCellKeyDown = useCallback((params: GridCellParams<Row>, event: React.KeyboardEvent): boolean => {
    lastClickedCellRef.current = null;
    return starter.startEditFromF2(params, event)
      || starter.startEditFromEnter(params, event)
      || starter.startEditFromPrintableKey(params, event);
  }, [starter]);

  const getEditableCellClassName = useCallback((params: GridCellParams<Row>): string => (
    spreadsheetMode && params.isEditable && (isCellEditable?.(params) ?? true) ? EDITABLE_CELL_CLASS : ''
  ), [isCellEditable, spreadsheetMode]);

  return {
    handleCellClick,
    handleCellDoubleClick,
    handleCellKeyDown,
    getEditableCellClassName,
    editHint,
  };
}
