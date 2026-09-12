import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GridRowModes } from '@mui/x-data-grid';
import type { GridColDef, GridRowId, GridRowModesModel } from '@mui/x-data-grid';
import { useDataGridRowCommands } from '../components/data-grid/hooks/useDataGridRowCommands';

type Row = { id: GridRowId; name: string };

/**
 * The hook is handed the page's own columns — DataGrid passes `columns`, not
 * `columnsWithActions`, so no action field appears here.
 */
const COLUMNS: GridColDef[] = [
  { field: 'name', editable: false },
  { field: 'width_m', editable: true },
];

/**
 * What the grid api reports, which is a different list: DataGrid appends the
 * action columns after the page's own. `scrollAndFocusRow` reads this one,
 * which is why it has to skip them itself.
 */
const VISIBLE_COLUMNS = [
  { field: 'name' },
  { field: 'width_m' },
  { field: 'rowEditActions' },
  { field: 'actions' },
];

const buildApi = () => ({
  getVisibleColumns: vi.fn(() => VISIBLE_COLUMNS),
  getRowIndexRelativeToVisibleRows: vi.fn(() => 3),
  scrollToIndexes: vi.fn(),
  setCellFocus: vi.fn(),
  getAllRowIds: vi.fn(() => [10, 11]),
});

const setup = ({
  columns = COLUMNS,
  selectedRowIds = [] as GridRowId[],
  rows = [{ id: 10, name: 'Beet A' }, { id: 11, name: 'Beet B' }] as Row[],
  ensureRowVisible,
  api = buildApi(),
}: {
  columns?: GridColDef[];
  selectedRowIds?: GridRowId[];
  rows?: Row[];
  ensureRowVisible?: (rowId: GridRowId) => boolean;
  api?: ReturnType<typeof buildApi>;
} = {}) => {
  const setSelectedRowIds = vi.fn();
  const setRowModesModel = vi.fn();
  const rowSnapshotRef = { current: new Map<string, Row>() };
  const rowsById = new Map(rows.map((row) => [String(row.id), row]));

  const { result } = renderHook(() => useDataGridRowCommands<Row>({
    gridApiRef: { current: api as never },
    rowsById,
    columns,
    selectedRowIds,
    setSelectedRowIds,
    setRowModesModel,
    rowSnapshotRef: rowSnapshotRef as never,
    ensureRowVisible,
  }));

  return { result, api, setSelectedRowIds, setRowModesModel, rowSnapshotRef, rowsById };
};

/** Applies whatever updater the hook passed to setRowModesModel. */
const modelFrom = (setRowModesModel: ReturnType<typeof vi.fn>, previous: GridRowModesModel = {}) => {
  const updater = setRowModesModel.mock.calls[0]?.[0] as (m: GridRowModesModel) => GridRowModesModel;
  return updater(previous);
};

/** Runs `count` animation frames. */
const runFrames = (count: number) => {
  for (let index = 0; index < count; index += 1) {
    act(() => { vi.advanceTimersByTime(16); });
  }
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('handleEditSelectedRow', () => {
  it('opens the selected row for editing on the first column', () => {
    const { result, setRowModesModel } = setup({ selectedRowIds: [10] });

    act(() => result.current.handleEditSelectedRow());

    expect(modelFrom(setRowModesModel)).toEqual({
      10: { mode: GridRowModes.Edit, fieldToFocus: 'name' },
    });
  });

  it('keeps the other rows’ modes', () => {
    const { result, setRowModesModel } = setup({ selectedRowIds: [10] });

    act(() => result.current.handleEditSelectedRow());

    expect(modelFrom(setRowModesModel, { 11: { mode: GridRowModes.View } }))
      .toMatchObject({ 11: { mode: GridRowModes.View } });
  });

  it('edits only the first of several selected rows', () => {
    const { result, setRowModesModel } = setup({ selectedRowIds: [10, 11] });

    act(() => result.current.handleEditSelectedRow());

    expect(Object.keys(modelFrom(setRowModesModel))).toEqual(['10']);
  });

  it('does nothing with no selection', () => {
    const { result, setRowModesModel } = setup({ selectedRowIds: [] });

    act(() => result.current.handleEditSelectedRow());

    expect(setRowModesModel).not.toHaveBeenCalled();
  });

  it('cannot edit a row whose id is 0', () => {
    // The guard is `!selectedRowId`, so a legitimate id of 0 is treated as no
    // selection at all. `focusTable` below uses `== null` for the same job and
    // does handle 0. Recorded as the current behaviour: the grids in this repo
    // use database ids, which start at 1.
    const { result, setRowModesModel } = setup({
      selectedRowIds: [0], rows: [{ id: 0, name: 'Beet Null' }],
    });

    act(() => result.current.handleEditSelectedRow());

    expect(setRowModesModel).not.toHaveBeenCalled();
  });

  it('survives a grid with no columns', () => {
    const { result, setRowModesModel } = setup({ selectedRowIds: [10], columns: [] });

    act(() => result.current.handleEditSelectedRow());

    expect(modelFrom(setRowModesModel)).toEqual({
      10: { mode: GridRowModes.Edit, fieldToFocus: undefined },
    });
  });
});

describe('handleStartRowEdit', () => {
  it('focuses the first editable column, skipping the read-only one', () => {
    const { result, setRowModesModel } = setup();

    act(() => result.current.handleStartRowEdit(10));

    expect(modelFrom(setRowModesModel)).toEqual({
      10: { mode: GridRowModes.Edit, fieldToFocus: 'width_m' },
    });
  });

  it('treats a column with no editable flag as editable', () => {
    // `editable !== false` — an unset flag means the grid's own default, which
    // these grids set to editable.
    const { result, setRowModesModel } = setup({
      columns: [{ field: 'name' }, { field: 'width_m', editable: true }],
    });

    act(() => result.current.handleStartRowEdit(10));

    expect(modelFrom(setRowModesModel)[10]).toMatchObject({ fieldToFocus: 'name' });
  });

  it('honours an explicitly requested field', () => {
    const { result, setRowModesModel } = setup();

    act(() => result.current.handleStartRowEdit(10, 'name'));

    expect(modelFrom(setRowModesModel)[10]).toMatchObject({ fieldToFocus: 'name' });
  });

  it('falls back to the first column when none is editable', () => {
    const { result, setRowModesModel } = setup({
      columns: [{ field: 'name', editable: false }, { field: 'notes', editable: false }],
    });

    act(() => result.current.handleStartRowEdit(10));

    expect(modelFrom(setRowModesModel)[10]).toMatchObject({ fieldToFocus: 'name' });
  });

  it('would focus an action column if one were ever passed in', () => {
    // `editable !== false` accepts a column that sets no flag at all, and the
    // action columns set none. DataGrid hands this hook its own `columns`
    // rather than `columnsWithActions`, so that cannot happen today — pinned so
    // a future caller passing the combined list is not surprised.
    const { result, setRowModesModel } = setup({
      columns: [{ field: 'name', editable: false }, { field: 'rowEditActions' }],
    });

    act(() => result.current.handleStartRowEdit(10));

    expect(modelFrom(setRowModesModel)[10]).toMatchObject({ fieldToFocus: 'rowEditActions' });
  });

  it('keeps the other rows’ modes', () => {
    const { result, setRowModesModel } = setup();

    act(() => result.current.handleStartRowEdit(10));

    expect(modelFrom(setRowModesModel, { 11: { mode: GridRowModes.View } }))
      .toMatchObject({ 11: { mode: GridRowModes.View } });
  });

  it('snapshots the row so an escape can restore it', () => {
    const { result, rowSnapshotRef } = setup();

    act(() => result.current.handleStartRowEdit(10));

    expect(rowSnapshotRef.current.get('10')).toEqual({ id: 10, name: 'Beet A' });
  });

  it('does not overwrite a snapshot already taken', () => {
    // Re-entering edit mode mid-edit must keep the values the row had before
    // the user started typing, not the half-typed ones.
    const { result, rowSnapshotRef } = setup();
    rowSnapshotRef.current.set('10', { id: 10, name: 'Original' });

    act(() => result.current.handleStartRowEdit(10));

    expect(rowSnapshotRef.current.get('10')).toEqual({ id: 10, name: 'Original' });
  });

  it('takes no snapshot for a row the grid does not know', () => {
    const { result, rowSnapshotRef, setRowModesModel } = setup();

    act(() => result.current.handleStartRowEdit(99));

    expect(rowSnapshotRef.current.size).toBe(0);
    // The row still enters edit mode: a draft row exists in the grid before it
    // exists in rowsById.
    expect(modelFrom(setRowModesModel)[99]).toMatchObject({ mode: GridRowModes.Edit });
  });
});

describe('focusTable', () => {
  it('focuses the selected row on its first non-action column', () => {
    const { result, api } = setup({ selectedRowIds: [11] });

    act(() => result.current.focusTable());
    runFrames(1);

    expect(api.setCellFocus).toHaveBeenCalledWith(11, 'name');
  });

  it('falls back to the first row when nothing is selected', () => {
    const { result, api } = setup();

    act(() => result.current.focusTable());
    runFrames(1);

    expect(api.setCellFocus).toHaveBeenCalledWith(10, 'name');
  });

  it('handles a first row whose id is 0', () => {
    // `== null` rather than a truthiness check, so 0 is a real row here.
    const api = buildApi();
    api.getAllRowIds.mockReturnValue([0]);
    const { result } = setup({ api, rows: [{ id: 0, name: 'Beet Null' }] });

    act(() => result.current.focusTable());
    runFrames(1);

    expect(api.setCellFocus).toHaveBeenCalledWith(0, 'name');
  });

  it('does nothing on an empty grid', () => {
    const api = buildApi();
    api.getAllRowIds.mockReturnValue([]);
    const { result } = setup({ api, rows: [] });

    act(() => result.current.focusTable());
    runFrames(2);

    expect(api.setCellFocus).not.toHaveBeenCalled();
  });

  it('does nothing before the grid api exists', () => {
    const setSelectedRowIds = vi.fn();
    const { result } = renderHook(() => useDataGridRowCommands<Row>({
      gridApiRef: { current: null },
      rowsById: new Map(),
      columns: COLUMNS,
      selectedRowIds: [10],
      setSelectedRowIds,
      setRowModesModel: vi.fn(),
      rowSnapshotRef: { current: new Map() } as never,
    }));

    expect(() => act(() => result.current.focusTable())).not.toThrow();
  });

  it('waits a frame before touching the grid, since the row may not be rendered yet', () => {
    const { result, api } = setup({ selectedRowIds: [11] });

    act(() => result.current.focusTable());

    expect(api.setCellFocus).not.toHaveBeenCalled();
  });

  it('waits two frames when the row was on another page', () => {
    // A page change re-renders the whole viewport, so one frame is not enough
    // for the row to exist.
    //
    // Note that the `Math.max(1, …)` floor on the frame count is unreachable:
    // `scrollAndFocusRow` is module-private and both callers pass 1 or 2.
    // Removing it leaves this file green.
    const { result, api } = setup({ selectedRowIds: [11], ensureRowVisible: () => true });

    act(() => result.current.focusTable());
    runFrames(1);
    expect(api.setCellFocus).not.toHaveBeenCalled();

    runFrames(1);
    expect(api.setCellFocus).toHaveBeenCalledWith(11, 'name');
  });

  it('waits only one frame when the page did not change', () => {
    const { result, api } = setup({ selectedRowIds: [11], ensureRowVisible: () => false });

    act(() => result.current.focusTable());
    runFrames(1);

    expect(api.setCellFocus).toHaveBeenCalled();
  });

  it('asks to reveal the row it is about to focus', () => {
    const ensureRowVisible = vi.fn(() => false);
    const { result } = setup({ selectedRowIds: [11], ensureRowVisible });

    act(() => result.current.focusTable());

    expect(ensureRowVisible).toHaveBeenCalledWith(11);
  });

  it('scrolls by row index when every column is an action column', () => {
    const api = buildApi();
    api.getVisibleColumns.mockReturnValue([{ field: 'rowEditActions' }, { field: 'actions' }]);
    const { result } = setup({ api, selectedRowIds: [11] });

    act(() => result.current.focusTable());
    runFrames(1);

    expect(api.scrollToIndexes).toHaveBeenCalledWith({ rowIndex: 3 });
    expect(api.setCellFocus).not.toHaveBeenCalled();
  });
});

describe('openRowById', () => {
  it('selects the row', () => {
    const { result, setSelectedRowIds } = setup();

    act(() => result.current.openRowById(11));

    expect(setSelectedRowIds).toHaveBeenCalledWith([11]);
  });

  it('starts editing by default', () => {
    const { result, setRowModesModel } = setup();

    act(() => result.current.openRowById(11));

    expect(modelFrom(setRowModesModel)[11]).toMatchObject({ mode: GridRowModes.Edit });
  });

  it('does not move focus when it is opening edit mode', () => {
    // Edit mode moves focus into its own input via fieldToFocus; doing it here
    // too would fight that.
    const { result, api } = setup();

    act(() => result.current.openRowById(11));
    runFrames(1);

    expect(api.setCellFocus).not.toHaveBeenCalled();
  });

  it('still scrolls the row into view while opening edit mode', () => {
    // Asserted with the column index: scrolling by row alone would leave a
    // horizontally scrolled grid showing the wrong columns. It also
    // distinguishes the cell-aware path from the row-only fallback.
    const { result, api } = setup();

    act(() => result.current.openRowById(11));
    runFrames(1);

    expect(api.scrollToIndexes).toHaveBeenCalledWith(
      expect.objectContaining({ rowIndex: 3, colIndex: 0 }),
    );
  });

  it('moves focus when opening the row read-only', () => {
    const { result, api, setRowModesModel } = setup();

    act(() => result.current.openRowById(11, { startEdit: false }));
    runFrames(1);

    expect(api.setCellFocus).toHaveBeenCalledWith(11, 'name');
    expect(setRowModesModel).not.toHaveBeenCalled();
  });

  it('treats an options object without startEdit as a request to edit', () => {
    const { result, setRowModesModel } = setup();

    act(() => result.current.openRowById(11, {}));

    expect(setRowModesModel).toHaveBeenCalled();
  });

  it('ignores a row the grid does not have', () => {
    // A deep link can name a row that has since been deleted.
    const { result, setSelectedRowIds, api } = setup();

    act(() => result.current.openRowById(99));
    runFrames(2);

    expect(setSelectedRowIds).not.toHaveBeenCalled();
    expect(api.scrollToIndexes).not.toHaveBeenCalled();
  });

  it('does nothing before the grid api exists', () => {
    const setSelectedRowIds = vi.fn();
    const { result } = renderHook(() => useDataGridRowCommands<Row>({
      gridApiRef: { current: null },
      rowsById: new Map([['11', { id: 11, name: 'Beet B' }]]),
      columns: COLUMNS,
      selectedRowIds: [],
      setSelectedRowIds,
      setRowModesModel: vi.fn(),
      rowSnapshotRef: { current: new Map() } as never,
    }));

    act(() => result.current.openRowById(11));

    expect(setSelectedRowIds).not.toHaveBeenCalled();
  });

  it('waits two frames when the row was on another page', () => {
    const { result, api } = setup({ ensureRowVisible: () => true });

    act(() => result.current.openRowById(11, { startEdit: false }));
    runFrames(1);
    expect(api.setCellFocus).not.toHaveBeenCalled();

    runFrames(1);
    expect(api.setCellFocus).toHaveBeenCalledWith(11, 'name');
  });

  it('snapshots the row it opens for editing', () => {
    const { result, rowSnapshotRef } = setup();

    act(() => result.current.openRowById(11));

    expect(rowSnapshotRef.current.get('11')).toEqual({ id: 11, name: 'Beet B' });
  });
});
