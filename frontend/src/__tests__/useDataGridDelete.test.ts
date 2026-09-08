import { act, renderHook } from '@testing-library/react';
import type { GridRowId } from '@mui/x-data-grid';
import { useDataGridDelete } from '../components/data-grid/hooks/useDataGridDelete';
import type { EditableRow } from '../components/data-grid/types';

const confirmMock = vi.hoisted(() => vi.fn());
vi.mock('../utils/confirmAction', () => ({ confirmAction: confirmMock }));

interface Row extends EditableRow {
  id: GridRowId;
  name: string;
  isNew?: boolean;
}

const ROWS: Row[] = [
  { id: 1, name: 'Eins' },
  { id: 2, name: 'Zwei' },
  { id: 3, name: 'Drei' },
];

function setup(overrides: Record<string, unknown> = {}) {
  let rows: Row[] = [...ROWS];
  let order: GridRowId[] = ROWS.map((r) => r.id);
  const api = {
    delete: vi.fn().mockResolvedValue({ data: {} }),
    create: vi.fn().mockResolvedValue({ data: {} }),
  };
  const params = {
    rowsById: new Map((overrides.rows as Row[] ?? ROWS).map((r) => [String(r.id), r])),
    rows: (overrides.rows as Row[]) ?? ROWS,
    stableRowOrder: ((overrides.rows as Row[]) ?? ROWS).map((r) => r.id),
    rowModesModel: {},
    api,
    deleteConfirmMessage: 'confirm?',
    deleteErrorMessage: 'delete failed',
    saveErrorMessage: 'save failed',
    deleteUndoOptions: undefined,
    t: ((k: string) => k) as never,
    mapToApiData: (row: Row) => ({ name: row.name }),
    reloadRows: vi.fn().mockResolvedValue(undefined),
    setRows: vi.fn((u: unknown) => {
      rows = typeof u === 'function' ? (u as (p: Row[]) => Row[])(rows) : (u as Row[]);
    }),
    setStableRowOrder: vi.fn((u: unknown) => {
      order = typeof u === 'function' ? (u as (p: GridRowId[]) => GridRowId[])(order) : (u as GridRowId[]);
    }),
    setRowModesModel: vi.fn(),
    setError: vi.fn(),
    clearRowInteractionState: vi.fn(),
    moveFocusAwayFromRemovedRow: vi.fn(),
    ...overrides,
  };
  const view = renderHook(() => useDataGridDelete(params as never));
  return { ...view, params, api, currentRows: () => rows, currentOrder: () => order };
}

describe('useDataGridDelete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    confirmMock.mockReturnValue(true);
  });

  describe('an unsaved draft row', () => {
    const draft: Row = { id: -1, name: '', isNew: true };

    it('is dropped locally without ever reaching the API', async () => {
      const view = setup({ rows: [...ROWS, draft] });

      await act(async () => { view.result.current.handleDeleteClick(-1)(); });

      expect(view.api.delete).not.toHaveBeenCalled();
      expect(view.currentRows().map((r) => r.id)).toEqual([1, 2, 3]);
    });

    it('is dropped without asking for confirmation', async () => {
      const view = setup({ rows: [...ROWS, draft] });

      await act(async () => { view.result.current.handleDeleteClick(-1)(); });

      expect(confirmMock).not.toHaveBeenCalled();
    });
  });

  describe('classic mode (no undo configured)', () => {
    it('asks before deleting and calls the API when confirmed', async () => {
      const view = setup();

      await act(async () => { view.result.current.handleDeleteClick(2)(); });

      expect(confirmMock).toHaveBeenCalledWith('confirm?');
      expect(view.api.delete).toHaveBeenCalledWith(2);
    });

    it('does nothing at all when the confirmation is declined', async () => {
      confirmMock.mockReturnValue(false);
      const view = setup();

      await act(async () => { view.result.current.handleDeleteClick(2)(); });

      expect(view.api.delete).not.toHaveBeenCalled();
      expect(view.params.setRows).not.toHaveBeenCalled();
    });

    it('queues no undo entry', async () => {
      const view = setup();

      await act(async () => { view.result.current.handleDeleteClick(2)(); });

      expect(view.result.current.pendingDeleteWithUndo).toHaveLength(0);
    });
  });

  describe('undo mode', () => {
    const undoOptions = {} as never;

    it('deletes without a confirmation prompt, since undo is the safety net', async () => {
      const view = setup({ deleteUndoOptions: undoOptions });

      await act(async () => { view.result.current.handleDeleteClick(2)(); });

      expect(confirmMock).not.toHaveBeenCalled();
      expect(view.api.delete).toHaveBeenCalledWith(2);
    });

    it('removes the row optimistically and then offers undo', async () => {
      const view = setup({ deleteUndoOptions: undoOptions });

      await act(async () => { view.result.current.handleDeleteClick(2)(); });

      expect(view.currentRows().map((r) => r.id)).toEqual([1, 3]);
      expect(view.result.current.pendingDeleteWithUndo).toHaveLength(1);
    });

    it('puts the row back and offers no undo when the delete fails', async () => {
      const view = setup({ deleteUndoOptions: undoOptions });
      view.api.delete.mockRejectedValue(new Error('boom'));

      await act(async () => { view.result.current.handleDeleteClick(2)(); });

      expect(view.currentRows().map((r) => r.id)).toEqual([1, 2, 3]);
      expect(view.currentOrder()).toEqual([1, 2, 3]);
      expect(view.result.current.pendingDeleteWithUndo).toHaveLength(0);
      expect(view.params.setError).toHaveBeenCalledWith(expect.any(String));
    });

    it('recreates the record on undo rather than cancelling a pending delete', async () => {
      const view = setup({ deleteUndoOptions: undoOptions });
      await act(async () => { view.result.current.handleDeleteClick(2)(); });
      const [pending] = view.result.current.pendingDeleteWithUndo;

      await act(async () => { await view.result.current.undoDeleteWithUndo(pending.id); });

      expect(view.api.create).toHaveBeenCalledWith({ name: 'Zwei' });
      expect(view.params.reloadRows).toHaveBeenCalled();
      expect(view.result.current.pendingDeleteWithUndo).toHaveLength(0);
    });

    it('still resyncs from the server when the recreate fails', async () => {
      const view = setup({ deleteUndoOptions: undoOptions });
      await act(async () => { view.result.current.handleDeleteClick(2)(); });
      const [pending] = view.result.current.pendingDeleteWithUndo;
      view.params.reloadRows.mockClear();
      view.api.create.mockRejectedValue(new Error('boom'));

      await act(async () => { await view.result.current.undoDeleteWithUndo(pending.id); });

      expect(view.params.reloadRows).toHaveBeenCalled();
      expect(view.params.setError).toHaveBeenCalledWith(expect.any(String));
    });

    it('dismissing the snackbar drops the entry without recreating anything', async () => {
      const view = setup({ deleteUndoOptions: undoOptions });
      await act(async () => { view.result.current.handleDeleteClick(2)(); });
      const [pending] = view.result.current.pendingDeleteWithUndo;

      act(() => { view.result.current.closeDeleteWithUndoSnackbar(pending.id); });

      expect(view.result.current.pendingDeleteWithUndo).toHaveLength(0);
      expect(view.api.create).not.toHaveBeenCalled();
    });
  });

  it('ignores a delete for a row it does not know', async () => {
    const view = setup();

    await act(async () => { view.result.current.handleDeleteClick(999)(); });

    expect(view.api.delete).not.toHaveBeenCalled();
    expect(confirmMock).not.toHaveBeenCalled();
  });
});
