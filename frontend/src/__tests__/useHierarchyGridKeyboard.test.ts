import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GridRowModes } from '@mui/x-data-grid';
import type {
  GridCellParams,
  GridColDef,
  GridRowId,
  GridRowModesModel,
} from '@mui/x-data-grid';
import { useHierarchyGridKeyboard } from '../components/hierarchy/hooks/useHierarchyGridKeyboard';
import type { HierarchyRow } from '../components/hierarchy/utils/types';

type KeyboardEventStub = React.KeyboardEvent & {
  defaultMuiPrevented: boolean;
};

type MouseEventStub = React.MouseEvent<HTMLElement> & {
  defaultMuiPrevented: boolean;
};

const columns: GridColDef<HierarchyRow>[] = [
  { field: 'name', editable: true },
  { field: 'length_m', editable: true },
  { field: 'width_m', editable: true },
  { field: 'area_sqm', editable: false },
  { field: 'notes', editable: false },
];

const rows: HierarchyRow[] = [
  {
    id: 'field-1',
    type: 'field',
    name: 'Field 1',
    level: 0,
    hasChildren: true,
    isNew: false,
  },
  {
    id: 101,
    type: 'bed',
    name: 'Bed 1',
    level: 1,
    hasChildren: false,
    isNew: false,
  },
];

const rowsById = new Map(rows.map((row) => [String(row.id), row]));

const makeCellParams = (
  id: GridRowId,
  field: string,
  row = rowsById.get(String(id))!,
): GridCellParams<HierarchyRow> => (({
  id,
  field,
  row,
  isEditable: field === 'name' || field === 'length_m' || field === 'width_m'
}) as GridCellParams<HierarchyRow>);

const makeKeyboardEvent = (key: string, overrides: Partial<KeyboardEventStub> = {}): KeyboardEventStub => (({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  defaultMuiPrevented: false,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  currentTarget: document.createElement('div'),
  ...overrides
}) as KeyboardEventStub);

const makeMouseEvent = (): MouseEventStub => ({
  defaultMuiPrevented: false,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
}) as unknown as MouseEventStub;

const renderKeyboardHook = (
  rowModesModel: GridRowModesModel = {},
  hookRows: HierarchyRow[] = rows,
  options: { deferCrossRowEditOnClick?: boolean } = {},
) => {
  const hookRowsById = new Map(hookRows.map((row) => [String(row.id), row]));
  const discardRowEdit = vi.fn();
  const editInputFocus = vi.fn();
  const focusCell = vi.fn();
  const notesOpen = vi.fn();
  const openContextMenu = vi.fn();
  const rememberFocusedField = vi.fn();
  const rememberRowSnapshot = vi.fn();
  const runAfterRowVisible = vi.fn((_rowId: GridRowId, action: () => void) => action());
  const selectRow = vi.fn();
  const setEditCellValue = vi.fn().mockResolvedValue(true);
  const setRowModesModel = vi.fn();
  const stopRowEditMode = vi.fn();
  const stopEditingRow = vi.fn();
  const setTreeActive = vi.fn();
  const toggleExpand = vi.fn();
  const scrollToIndexes = vi.fn();

  const api = {
    getAllRowIds: () => hookRows.map((row) => row.id),
    getCellElement: () => {
      const cell = document.createElement('div');
      const input = document.createElement('input');
      input.focus = editInputFocus;
      cell.append(input);
      return cell;
    },
    getCellParams: (id: GridRowId, field: string) => makeCellParams(id, field, hookRowsById.get(String(id))!),
    getColumnIndexRelativeToVisibleColumns: (field: string) =>
      columns.findIndex((column) => column.field === field),
    getRowIndexRelativeToVisibleRows: (id: GridRowId) =>
      hookRows.findIndex((row) => String(row.id) === String(id)),
    getViewportPageSize: () => 1,
    getVisibleColumns: () => columns,
    isCellEditable: (params: GridCellParams<HierarchyRow>) =>
      params.field === 'name' || params.field === 'length_m' || params.field === 'width_m',
    scrollToIndexes,
    setCellFocus: focusCell,
    setEditCellValue,
    stopRowEditMode,
  };

  const hook = renderHook(() =>
    useHierarchyGridKeyboard({
      columns,
      deferCrossRowEditOnClick: options.deferCrossRowEditOnClick,
      discardRowEdit,
      gridApiRef: { current: api },
      isCellFocusable: (row, field) => field === 'notes' || row.type !== 'location' && field !== 'area_sqm',
      isHierarchyCellAction: (params) => params.field === 'notes',
      notesEditor: { handleOpen: notesOpen },
      openContextMenuForRow: openContextMenu,
      rememberFocusedField,
      rememberRowSnapshot,
      runAfterRowVisible,
      rowModesModel,
      rows: hookRows,
      rowsById: hookRowsById,
      selectRow,
      setRowModesModel,
      setTreeActive,
      stopEditingRow,
      toggleExpand,
    }),
  );

  return {
    ...hook,
    discardRowEdit,
    editInputFocus,
    focusCell,
    notesOpen,
    openContextMenu,
    rememberFocusedField,
    rememberRowSnapshot,
    runAfterRowVisible,
    scrollToIndexes,
    selectRow,
    setEditCellValue,
    setRowModesModel,
    stopRowEditMode,
    stopEditingRow,
    setTreeActive,
    toggleExpand,
  };
};

describe('useHierarchyGridKeyboard', () => {
  const unsavedBedRow: HierarchyRow = {
    id: -1700000000000,
    type: 'bed',
    name: 'New bed',
    level: 1,
    hasChildren: false,
    isNew: true,
    bedId: -1700000000000,
    field: 1,
  };

  it('skips the calculated area column when tabbing in edit mode', () => {
    const { result, focusCell, selectRow } = renderKeyboardHook({
      'field-1': { mode: GridRowModes.Edit },
    });
    const event = makeKeyboardEvent('Tab');

    act(() => {
      result.current.handleCellKeyDown(makeCellParams('field-1', 'width_m'), event);
    });

    expect(event.defaultMuiPrevented).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(focusCell).toHaveBeenCalledWith('field-1', 'notes');
    expect(focusCell).not.toHaveBeenCalledWith('field-1', 'area_sqm');
    expect(selectRow).toHaveBeenCalledWith('field-1');
  });

  it('starts edit mode from printable keys in view mode', async () => {
    const {
      result,
      focusCell,
      rememberRowSnapshot,
      selectRow,
      setEditCellValue,
      setRowModesModel,
      setTreeActive,
    } = renderKeyboardHook();
    const event = makeKeyboardEvent('a');

    act(() => {
      result.current.handleCellKeyDown(makeCellParams('field-1', 'name'), event);
    });

    expect(event.defaultMuiPrevented).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(focusCell).toHaveBeenCalledWith('field-1', 'name');
    expect(rememberRowSnapshot).toHaveBeenCalledWith('field-1');
    expect(selectRow).toHaveBeenCalledWith('field-1');
    expect(setTreeActive).toHaveBeenCalledWith(true);
    expect(setRowModesModel).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(setEditCellValue).toHaveBeenCalledWith({ id: 'field-1', field: 'name', value: 'a' });
    });
  });

  it('keeps fast typed numeric keys together when starting edit mode', async () => {
    const { result, setEditCellValue } = renderKeyboardHook();

    act(() => {
      result.current.handleCellKeyDown(makeCellParams('field-1', 'length_m'), makeKeyboardEvent('1'));
      result.current.handleCellKeyDown(makeCellParams('field-1', 'length_m'), makeKeyboardEvent('2'));
      result.current.handleCellKeyDown(makeCellParams('field-1', 'length_m'), makeKeyboardEvent('3'));
    });

    await waitFor(() => {
      expect(setEditCellValue).toHaveBeenCalledWith({ id: 'field-1', field: 'length_m', value: '123' });
    });
  });

  it('buffers the first numeric key when Tab leaves focus on a new-row cell container', async () => {
    const {
      result,
      editInputFocus,
      focusCell,
      setEditCellValue,
      setRowModesModel,
    } = renderKeyboardHook(
      { [unsavedBedRow.id]: { mode: GridRowModes.Edit, fieldToFocus: 'name' } },
      [unsavedBedRow],
    );

    act(() => {
      result.current.handleCellKeyDown(
        makeCellParams(unsavedBedRow.id, 'name', unsavedBedRow),
        makeKeyboardEvent('Tab'),
      );
    });
    expect(focusCell).toHaveBeenLastCalledWith(unsavedBedRow.id, 'length_m');

    act(() => {
      result.current.handleCellKeyDown(
        makeCellParams(unsavedBedRow.id, 'length_m', unsavedBedRow),
        makeKeyboardEvent('1', { target: document.createElement('div') } as Partial<KeyboardEventStub>),
      );
    });

    await waitFor(() => {
      expect(setEditCellValue).toHaveBeenCalledWith({
        id: unsavedBedRow.id,
        field: 'length_m',
        value: '1',
      });
    });
    expect(setRowModesModel).toHaveBeenCalledTimes(1);
    expect(editInputFocus).toHaveBeenCalledWith({ preventScroll: true });

    act(() => {
      result.current.handleCellKeyDown(
        makeCellParams(unsavedBedRow.id, 'length_m', unsavedBedRow),
        makeKeyboardEvent('Tab'),
      );
    });
    expect(focusCell).toHaveBeenLastCalledWith(unsavedBedRow.id, 'width_m');

    act(() => {
      result.current.handleCellKeyDown(
        makeCellParams(unsavedBedRow.id, 'width_m', unsavedBedRow),
        makeKeyboardEvent('2', { target: document.createElement('div') } as Partial<KeyboardEventStub>),
      );
    });

    await waitFor(() => {
      expect(setEditCellValue).toHaveBeenCalledWith({
        id: unsavedBedRow.id,
        field: 'width_m',
        value: '2',
      });
    });
  });

  it('keeps direct typing active after Shift+Tab returns to an editable new-row cell', async () => {
    const { result, focusCell, setEditCellValue } = renderKeyboardHook(
      { [unsavedBedRow.id]: { mode: GridRowModes.Edit, fieldToFocus: 'width_m' } },
      [unsavedBedRow],
    );

    act(() => {
      result.current.handleCellKeyDown(
        makeCellParams(unsavedBedRow.id, 'width_m', unsavedBedRow),
        makeKeyboardEvent('Tab', { shiftKey: true }),
      );
    });
    expect(focusCell).toHaveBeenLastCalledWith(unsavedBedRow.id, 'length_m');

    act(() => {
      result.current.handleCellKeyDown(
        makeCellParams(unsavedBedRow.id, 'length_m', unsavedBedRow),
        makeKeyboardEvent('3', { target: document.createElement('div') } as Partial<KeyboardEventStub>),
      );
    });

    await waitFor(() => {
      expect(setEditCellValue).toHaveBeenCalledWith({
        id: unsavedBedRow.id,
        field: 'length_m',
        value: '3',
      });
    });
  });

  it('keeps direct typing active after clicking an editable cell in a new row', async () => {
    const { result, selectRow, setEditCellValue } = renderKeyboardHook(
      { [unsavedBedRow.id]: { mode: GridRowModes.Edit, fieldToFocus: 'name' } },
      [unsavedBedRow],
    );

    act(() => {
      result.current.handleCellClick(makeCellParams(unsavedBedRow.id, 'width_m', unsavedBedRow), makeMouseEvent());
    });
    expect(selectRow).toHaveBeenCalledWith(unsavedBedRow.id);

    act(() => {
      result.current.handleCellKeyDown(
        makeCellParams(unsavedBedRow.id, 'width_m', unsavedBedRow),
        makeKeyboardEvent('4', { target: document.createElement('div') } as Partial<KeyboardEventStub>),
      );
    });

    await waitFor(() => {
      expect(setEditCellValue).toHaveBeenCalledWith({
        id: unsavedBedRow.id,
        field: 'width_m',
        value: '4',
      });
    });
  });

  it('does not replace values when printable keys come from an already focused editor input', () => {
    const { result, setEditCellValue } = renderKeyboardHook(
      { [unsavedBedRow.id]: { mode: GridRowModes.Edit, fieldToFocus: 'length_m' } },
      [unsavedBedRow],
    );
    const input = document.createElement('input');
    const event = makeKeyboardEvent('5', { target: input } as Partial<KeyboardEventStub>);

    act(() => {
      result.current.handleCellKeyDown(makeCellParams(unsavedBedRow.id, 'length_m', unsavedBedRow), event);
    });

    expect(event.defaultMuiPrevented).toBe(false);
    expect(setEditCellValue).not.toHaveBeenCalled();
  });

  it('keeps calculated cells protected from direct printable editing', () => {
    const { result, setEditCellValue, setRowModesModel } = renderKeyboardHook(
      { [unsavedBedRow.id]: { mode: GridRowModes.Edit, fieldToFocus: 'name' } },
      [unsavedBedRow],
    );
    const event = makeKeyboardEvent('9');

    act(() => {
      result.current.handleCellKeyDown(makeCellParams(unsavedBedRow.id, 'area_sqm', unsavedBedRow), event);
    });

    expect(event.defaultMuiPrevented).toBe(false);
    expect(setEditCellValue).not.toHaveBeenCalled();
    expect(setRowModesModel).not.toHaveBeenCalled();
  });

  it('suppresses modified printable shortcuts in view mode without entering edit mode', () => {
    const { result, setRowModesModel } = renderKeyboardHook();
    const event = makeKeyboardEvent('T', { altKey: true });

    act(() => {
      result.current.handleCellKeyDown(makeCellParams('field-1', 'name'), event);
    });

    expect(event.defaultMuiPrevented).toBe(true);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(setRowModesModel).not.toHaveBeenCalled();
  });

  it('blocks non-focusable calculated-cell clicks before row selection or editing', () => {
    const { result, rememberRowSnapshot, selectRow, setRowModesModel } = renderKeyboardHook();
    const event = makeMouseEvent();

    act(() => {
      result.current.handleCellClick(makeCellParams('field-1', 'area_sqm'), event);
    });

    expect(event.defaultMuiPrevented).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(rememberRowSnapshot).not.toHaveBeenCalled();
    expect(selectRow).not.toHaveBeenCalled();
    expect(setRowModesModel).not.toHaveBeenCalled();
  });

  it('opens notes from the keyboard without starting row edit mode', () => {
    const { result, notesOpen, setRowModesModel } = renderKeyboardHook();
    const event = makeKeyboardEvent('Enter');

    act(() => {
      result.current.handleCellKeyDown(makeCellParams('field-1', 'notes'), event);
    });

    expect(event.defaultMuiPrevented).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(notesOpen).toHaveBeenCalledWith('field-1', 'notes');
    expect(setRowModesModel).not.toHaveBeenCalled();
  });

  it('commits the active row edit before clicking into another editable row on desktop', () => {
    const { result, discardRowEdit, selectRow, setRowModesModel, stopEditingRow } = renderKeyboardHook({
      'field-1': { mode: GridRowModes.Edit },
    });

    act(() => {
      result.current.handleCellClick(makeCellParams(101, 'name'), makeMouseEvent());
    });

    expect(stopEditingRow).toHaveBeenCalledWith('field-1');
    expect(discardRowEdit).not.toHaveBeenCalled();
    expect(selectRow).toHaveBeenCalledWith(101);
    expect(setRowModesModel).toHaveBeenCalledTimes(1);
  });

  it('does not start another row edit from the first touch click after ending the active row edit', () => {
    const { result, discardRowEdit, selectRow, setRowModesModel, stopEditingRow } = renderKeyboardHook(
      { 'field-1': { mode: GridRowModes.Edit } },
      rows,
      { deferCrossRowEditOnClick: true },
    );

    act(() => {
      result.current.handleCellClick(makeCellParams(101, 'name'), makeMouseEvent());
    });

    expect(stopEditingRow).toHaveBeenCalledWith('field-1');
    expect(discardRowEdit).not.toHaveBeenCalled();
    expect(selectRow).toHaveBeenCalledWith(101);
    expect(setRowModesModel).not.toHaveBeenCalled();
  });

  it('still starts row edit with one touch click when no row is already being edited', () => {
    const { result, setRowModesModel } = renderKeyboardHook(
      {},
      rows,
      { deferCrossRowEditOnClick: true },
    );

    act(() => {
      result.current.handleCellClick(makeCellParams(101, 'name'), makeMouseEvent());
    });

    expect(setRowModesModel).toHaveBeenCalledTimes(1);
  });

  it('uses spacebar for expandable rows and blocks default grid focus jumps for leaf rows', () => {
    const { result, toggleExpand } = renderKeyboardHook();
    const expandableEvent = makeKeyboardEvent(' ');
    const leafEvent = makeKeyboardEvent(' ');

    act(() => {
      result.current.handleCellKeyDown(makeCellParams('field-1', 'name'), expandableEvent);
      result.current.handleCellKeyDown(makeCellParams(101, 'name'), leafEvent);
    });

    expect(expandableEvent.defaultMuiPrevented).toBe(true);
    expect(expandableEvent.preventDefault).toHaveBeenCalled();
    expect(toggleExpand).toHaveBeenCalledWith('field-1');
    expect(leafEvent.defaultMuiPrevented).toBe(true);
    expect(leafEvent.preventDefault).toHaveBeenCalled();
    expect(toggleExpand).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+End jumps to the last row of the complete dataset, not just the current cell', () => {
    const manyRows: HierarchyRow[] = [
      ...rows,
      { id: 102, type: 'bed', name: 'Bed 2', level: 1, hasChildren: false, isNew: false },
      { id: 103, type: 'bed', name: 'Bed 3', level: 1, hasChildren: false, isNew: false },
    ];
    const { result, focusCell, runAfterRowVisible, selectRow } = renderKeyboardHook({}, manyRows);
    const event = makeKeyboardEvent('End', { ctrlKey: true });

    act(() => {
      result.current.handleCellKeyDown(makeCellParams('field-1', 'name', manyRows[0]), event);
    });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.defaultMuiPrevented).toBe(true);
    expect(selectRow).toHaveBeenCalledWith(103);
    expect(runAfterRowVisible).toHaveBeenCalledWith(103, expect.any(Function));
    expect(focusCell).toHaveBeenCalledWith(103, 'notes');
  });

  it('Ctrl+Home jumps to the first row of the complete dataset', () => {
    const manyRows: HierarchyRow[] = [
      ...rows,
      { id: 102, type: 'bed', name: 'Bed 2', level: 1, hasChildren: false, isNew: false },
    ];
    const { result, focusCell, selectRow } = renderKeyboardHook({}, manyRows);
    const event = makeKeyboardEvent('Home', { ctrlKey: true });

    act(() => {
      result.current.handleCellKeyDown(makeCellParams(102, 'name', manyRows[2]), event);
    });

    expect(selectRow).toHaveBeenCalledWith('field-1');
    expect(focusCell).toHaveBeenCalledWith('field-1', 'name');
  });

  it('bare Home/End are left to the grid default (no navigation, not marked handled)', () => {
    const { result, selectRow } = renderKeyboardHook();
    const homeEvent = makeKeyboardEvent('Home');
    const endEvent = makeKeyboardEvent('End');

    act(() => {
      result.current.handleCellKeyDown(makeCellParams('field-1', 'name'), homeEvent);
      result.current.handleCellKeyDown(makeCellParams('field-1', 'name'), endEvent);
    });

    expect(homeEvent.preventDefault).not.toHaveBeenCalled();
    expect(endEvent.preventDefault).not.toHaveBeenCalled();
    expect(selectRow).not.toHaveBeenCalled();
  });

  it('PageDown moves a page of rows forward across the complete dataset', () => {
    const manyRows: HierarchyRow[] = [
      ...rows,
      { id: 102, type: 'bed', name: 'Bed 2', level: 1, hasChildren: false, isNew: false },
    ];
    const { result, focusCell, runAfterRowVisible, selectRow } = renderKeyboardHook({}, manyRows);
    const event = makeKeyboardEvent('PageDown');

    act(() => {
      result.current.handleCellKeyDown(makeCellParams('field-1', 'name', manyRows[0]), event);
    });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(selectRow).toHaveBeenCalledWith(101);
    expect(runAfterRowVisible).toHaveBeenCalledWith(101, expect.any(Function));
    expect(focusCell).toHaveBeenCalledWith(101, 'name');
  });
});
