import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GridRowModes } from '@mui/x-data-grid';
import type { GridRowId, GridRowModesModel } from '@mui/x-data-grid';
import type { MutableRefObject } from 'react';
import type { EditableDataGridCommandApi, EditableRow } from '../components/data-grid/types';
import { useDataGridCommandApi } from '../components/data-grid/hooks/useDataGridCommandApi';

interface TestRow extends EditableRow {
  name?: string;
}

const createDeps = () => ({
  deleteRowCommandRef: { current: vi.fn() } as MutableRefObject<(rowId: GridRowId) => void>,
  handleAddClick: vi.fn(),
  handleEditSelectedRow: vi.fn(),
  handleDeleteSelectedRow: vi.fn(),
  setRowModesModel: vi.fn(),
  applyDraftValues: vi.fn().mockResolvedValue(undefined),
  commitDraftValues: vi.fn().mockResolvedValue(undefined),
  applyDialogEditValues: vi.fn().mockResolvedValue(undefined),
  reload: vi.fn().mockResolvedValue(undefined),
  focusTable: vi.fn(),
  openRowById: vi.fn(),
});

type Deps = ReturnType<typeof createDeps>;

interface Props {
  commandApiRef?: MutableRefObject<EditableDataGridCommandApi | null>;
  selectedRowIds: GridRowId[];
}

const setup = (deps: Deps, initialProps: Props) =>
  renderHook(
    (props: Props) => useDataGridCommandApi<TestRow>({
      commandApiRef: props.commandApiRef,
      selectedRowIds: props.selectedRowIds,
      ...deps,
    }),
    { initialProps },
  );

/** Every test below publishes the api first; this keeps that assumption loud. */
const published = (ref: MutableRefObject<EditableDataGridCommandApi | null>) => {
  const api = ref.current;
  if (!api) throw new Error('command api was not published');
  return api;
};

const modelUpdater = (deps: Deps) =>
  deps.setRowModesModel.mock.calls[0][0] as (model: GridRowModesModel) => GridRowModesModel;

let deps: Deps;
let ref: MutableRefObject<EditableDataGridCommandApi | null>;

beforeEach(() => {
  deps = createDeps();
  ref = { current: null };
});

describe('publishing the api', () => {
  it('fills the ref the page handed in', () => {
    // The command palette reaches the grid through this ref; nothing else
    // connects the two.
    setup(deps, { commandApiRef: ref, selectedRowIds: [] });

    expect(ref.current).not.toBeNull();
  });

  it('publishes every command the interface promises', () => {
    setup(deps, { commandApiRef: ref, selectedRowIds: [] });

    expect(Object.keys(published(ref)).sort()).toEqual([
      'addRow',
      'applyDialogEditValues',
      'commitDraftValues',
      'deleteRow',
      'deleteSelectedRow',
      'editSelectedRow',
      'focusTable',
      'getSelectedRowId',
      'openRowById',
      'reload',
      'setDraftValues',
    ]);
  });

  it('does nothing when the page passes no ref', () => {
    // Most grids do not expose a command api at all.
    expect(() => setup(deps, { selectedRowIds: [] })).not.toThrow();
    expect(ref.current).toBeNull();
  });

  it('clears the ref on unmount', () => {
    // Leaving a live api behind would let the palette drive a grid that is no
    // longer on screen.
    const { unmount } = setup(deps, { commandApiRef: ref, selectedRowIds: [] });

    unmount();

    expect(ref.current).toBeNull();
  });

  it('republishes rather than leaving a stale api behind', () => {
    const { rerender } = setup(deps, { commandApiRef: ref, selectedRowIds: [1] });
    const before = published(ref);

    rerender({ commandApiRef: ref, selectedRowIds: [2] });

    expect(ref.current).not.toBeNull();
    expect(ref.current).not.toBe(before);
  });

  it('moves to a new ref when the page swaps it', () => {
    const replacement: MutableRefObject<EditableDataGridCommandApi | null> = { current: null };
    const { rerender } = setup(deps, { commandApiRef: ref, selectedRowIds: [] });

    rerender({ commandApiRef: replacement, selectedRowIds: [] });

    expect(replacement.current).not.toBeNull();
    expect(ref.current).toBeNull();
  });
});

describe('the plain pass-through commands', () => {
  it.each([
    ['addRow', 'handleAddClick'],
    ['editSelectedRow', 'handleEditSelectedRow'],
    ['deleteSelectedRow', 'handleDeleteSelectedRow'],
  ] as const)('%s runs %s', (command, handler) => {
    setup(deps, { commandApiRef: ref, selectedRowIds: [] });

    act(() => { published(ref)[command](); });

    expect(deps[handler]).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['addRow', 'handleEditSelectedRow', 'handleDeleteSelectedRow'],
    ['editSelectedRow', 'handleAddClick', 'handleDeleteSelectedRow'],
    ['deleteSelectedRow', 'handleAddClick', 'handleEditSelectedRow'],
  ] as const)('%s runs nothing else', (command, first, second) => {
    // The three take no arguments and have the same signature, so a swapped
    // wiring is invisible unless each is checked against the others.
    setup(deps, { commandApiRef: ref, selectedRowIds: [] });

    act(() => { published(ref)[command](); });

    expect(deps[first]).not.toHaveBeenCalled();
    expect(deps[second]).not.toHaveBeenCalled();
  });

  it('exposes reload, focusTable and openRowById as the page gave them', () => {
    // Passed straight through rather than wrapped, so the palette's await on
    // reload resolves on the page's own promise.
    setup(deps, { commandApiRef: ref, selectedRowIds: [] });

    expect(published(ref).reload).toBe(deps.reload);
    expect(published(ref).focusTable).toBe(deps.focusTable);
    expect(published(ref).openRowById).toBe(deps.openRowById);
  });

  it('forwards the start-edit option through openRowById', () => {
    setup(deps, { commandApiRef: ref, selectedRowIds: [] });

    act(() => { published(ref).openRowById(7, { startEdit: true }); });

    expect(deps.openRowById).toHaveBeenCalledWith(7, { startEdit: true });
  });
});

describe('deleteRow', () => {
  it('calls through the ref rather than a captured function', () => {
    setup(deps, { commandApiRef: ref, selectedRowIds: [] });

    act(() => { published(ref).deleteRow(3); });

    expect(deps.deleteRowCommandRef.current).toHaveBeenCalledWith(3);
  });

  it('picks up a command swapped in after the api was published', () => {
    // The delete command is rebuilt as rows change. Reading it from the ref
    // at call time is what keeps the published api working between the
    // effect's own republishes -- the ref is not in the dependency list, so
    // nothing republishes when the command inside it is replaced.
    setup(deps, { commandApiRef: ref, selectedRowIds: [] });
    const replacement = vi.fn();
    deps.deleteRowCommandRef.current = replacement;

    act(() => { published(ref).deleteRow(3); });

    expect(replacement).toHaveBeenCalledWith(3);
  });
});

describe('getSelectedRowId', () => {
  it('reports the selected row', () => {
    setup(deps, { commandApiRef: ref, selectedRowIds: [5] });

    expect(published(ref).getSelectedRowId()).toBe(5);
  });

  it('reports null when nothing is selected', () => {
    // The palette disables its row commands on null, so undefined would slip
    // through anything comparing against null explicitly.
    setup(deps, { commandApiRef: ref, selectedRowIds: [] });

    expect(published(ref).getSelectedRowId()).toBeNull();
  });

  it('reports the first of a multi-row selection', () => {
    // The row commands act on one row, and the first is the one the grid
    // treats as active.
    setup(deps, { commandApiRef: ref, selectedRowIds: [5, 6, 7] });

    expect(published(ref).getSelectedRowId()).toBe(5);
  });

  it('reports a row whose id is 0 rather than treating it as no selection', () => {
    // `?? null` rather than `|| null`: id 0 is a real row, and the falsy
    // spelling would make the palette's row commands go dead on it. Worth
    // pinning because the falsy version does appear elsewhere in this area --
    // useDataGridRowCommands and useHierarchyKeyboard both use it.
    setup(deps, { commandApiRef: ref, selectedRowIds: [0] });

    expect(published(ref).getSelectedRowId()).toBe(0);
  });

  it('follows a selection made after the api was published', () => {
    const { rerender } = setup(deps, { commandApiRef: ref, selectedRowIds: [] });

    rerender({ commandApiRef: ref, selectedRowIds: [9] });

    expect(published(ref).getSelectedRowId()).toBe(9);
  });
});

describe('setDraftValues', () => {
  it('writes the values and opens the row for editing', async () => {
    // The palette fills a row from outside the grid; the row then has to be
    // in edit mode or the values sit in a draft the user cannot see.
    setup(deps, { commandApiRef: ref, selectedRowIds: [] });

    await act(async () => { await published(ref).setDraftValues(4, { name: 'Möhre' }); });

    expect(deps.applyDraftValues).toHaveBeenCalledWith(4, { name: 'Möhre' });
    expect(deps.setRowModesModel).toHaveBeenCalledTimes(1);
  });

  it('puts exactly that row into edit mode', async () => {
    setup(deps, { commandApiRef: ref, selectedRowIds: [] });

    await act(async () => { await published(ref).setDraftValues(4, { name: 'Möhre' }); });

    expect(modelUpdater(deps)({})).toEqual({ 4: { mode: GridRowModes.Edit } });
  });

  it('leaves the other rows in the model alone', async () => {
    // The model holds every row currently in edit mode; replacing it would
    // silently close another open editor.
    setup(deps, { commandApiRef: ref, selectedRowIds: [] });

    await act(async () => { await published(ref).setDraftValues(4, { name: 'Möhre' }); });

    expect(modelUpdater(deps)({ 9: { mode: GridRowModes.Edit } })).toEqual({
      9: { mode: GridRowModes.Edit },
      4: { mode: GridRowModes.Edit },
    });
  });

  it('keeps the row entry it already had, only changing the mode', async () => {
    // A row already carrying a focus field must keep it, or the cell the grid
    // was about to focus is lost.
    setup(deps, { commandApiRef: ref, selectedRowIds: [] });

    await act(async () => { await published(ref).setDraftValues(4, { name: 'Möhre' }); });

    expect(modelUpdater(deps)({ 4: { mode: GridRowModes.View, fieldToFocus: 'name' } })).toEqual({
      4: { mode: GridRowModes.Edit, fieldToFocus: 'name' },
    });
  });

  it('writes the values before switching the mode', async () => {
    // The other order shows the user an editor briefly holding the old values
    // before they are replaced.
    const order: string[] = [];
    deps.applyDraftValues.mockImplementation(async () => { order.push('apply'); });
    deps.setRowModesModel.mockImplementation(() => { order.push('mode'); });
    setup(deps, { commandApiRef: ref, selectedRowIds: [] });

    await act(async () => { await published(ref).setDraftValues(4, { name: 'Möhre' }); });

    expect(order).toEqual(['apply', 'mode']);
  });

  it('does not switch the mode when writing the values fails', async () => {
    // Opening an editor over values that were never applied would show the
    // user a row that does not hold what they asked for.
    deps.applyDraftValues.mockRejectedValue(new Error('rejected'));
    setup(deps, { commandApiRef: ref, selectedRowIds: [] });

    await act(async () => {
      await expect(published(ref).setDraftValues(4, { name: 'Möhre' })).rejects.toThrow('rejected');
    });

    expect(deps.setRowModesModel).not.toHaveBeenCalled();
  });

  it('waits for the write rather than resolving early', async () => {
    let settle!: () => void;
    deps.applyDraftValues.mockReturnValue(new Promise<void>((resolve) => { settle = resolve; }));
    setup(deps, { commandApiRef: ref, selectedRowIds: [] });
    let settled = false;

    await act(async () => {
      void published(ref).setDraftValues(4, {}).then(() => { settled = true; });
      await Promise.resolve();
    });
    expect(settled).toBe(false);

    await act(async () => { settle(); });
    expect(settled).toBe(true);
  });
});

describe('the awaited write commands', () => {
  it('commitDraftValues passes the row and values through', async () => {
    setup(deps, { commandApiRef: ref, selectedRowIds: [] });

    await act(async () => { await published(ref).commitDraftValues(4, { name: 'Möhre' }); });

    expect(deps.commitDraftValues).toHaveBeenCalledWith(4, { name: 'Möhre' });
    expect(deps.applyDraftValues).not.toHaveBeenCalled();
  });

  it('commitDraftValues does not also touch the edit mode', async () => {
    // Committing ends the edit session; forcing the row back into edit mode
    // would reopen the editor the user just closed. Awaited on purpose: a
    // mode change made after the write would be invisible to a synchronous
    // assertion, which is the only place it could realistically appear.
    setup(deps, { commandApiRef: ref, selectedRowIds: [] });

    await act(async () => { await published(ref).commitDraftValues(4, { name: 'Möhre' }); });

    expect(deps.setRowModesModel).not.toHaveBeenCalled();
  });

  it('applyDialogEditValues passes the row and values through', async () => {
    setup(deps, { commandApiRef: ref, selectedRowIds: [] });

    await act(async () => { await published(ref).applyDialogEditValues(4, { name: 'Möhre' }); });

    expect(deps.applyDialogEditValues).toHaveBeenCalledWith(4, { name: 'Möhre' });
    expect(deps.commitDraftValues).not.toHaveBeenCalled();
  });

  it('applyDialogEditValues does not force the row into edit mode', async () => {
    // A dialog cell never opens an inline edit session of its own; the page
    // decides whether the row is saved or written into an open draft. Awaited
    // for the same reason as the commit case above.
    setup(deps, { commandApiRef: ref, selectedRowIds: [] });

    await act(async () => { await published(ref).applyDialogEditValues(4, { name: 'Möhre' }); });

    expect(deps.setRowModesModel).not.toHaveBeenCalled();
  });

  it.each([
    ['commitDraftValues'],
    ['applyDialogEditValues'],
  ] as const)('%s waits for the page rather than resolving early', async (command) => {
    // The palette awaits these before reporting success, so resolving ahead
    // of the write would report a save that had not happened.
    let settle!: () => void;
    deps[command].mockReturnValue(new Promise<void>((resolve) => { settle = resolve; }));
    setup(deps, { commandApiRef: ref, selectedRowIds: [] });
    let settled = false;

    await act(async () => {
      void published(ref)[command](4, {}).then(() => { settled = true; });
      await Promise.resolve();
    });
    expect(settled).toBe(false);

    await act(async () => { settle(); });
    expect(settled).toBe(true);
  });

  it.each([
    ['commitDraftValues'],
    ['applyDialogEditValues'],
  ] as const)('%s surfaces a failure to the caller', async (command) => {
    deps[command].mockRejectedValue(new Error('rejected'));
    setup(deps, { commandApiRef: ref, selectedRowIds: [] });

    await act(async () => {
      await expect(published(ref)[command](4, {})).rejects.toThrow('rejected');
    });
  });
});

describe('staying current', () => {
  it('republishes when a handler changes', () => {
    // The handlers are captured by value, so a stale api would run the
    // previous render's closures.
    //
    // The selection array is deliberately the same object across the
    // rerender: a fresh `[]` literal changes identity on its own and would
    // force the republish regardless of whether the handler is in the
    // dependency list at all.
    const selectedRowIds: GridRowId[] = [];
    const { rerender } = setup(deps, { commandApiRef: ref, selectedRowIds });
    const replacement = vi.fn();
    deps.handleAddClick = replacement;

    rerender({ commandApiRef: ref, selectedRowIds });
    act(() => { published(ref).addRow(); });

    expect(replacement).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['applyDraftValues', 'setDraftValues'],
    ['commitDraftValues', 'commitDraftValues'],
    ['applyDialogEditValues', 'applyDialogEditValues'],
  ] as const)('republishes when %s changes', async (dependency, command) => {
    // Same stale-closure risk as the click handlers, and the same stable
    // selection array so the republish can only come from the dependency
    // under test.
    const selectedRowIds: GridRowId[] = [];
    const { rerender } = setup(deps, { commandApiRef: ref, selectedRowIds });
    const replacement = vi.fn().mockResolvedValue(undefined);
    deps[dependency] = replacement;

    rerender({ commandApiRef: ref, selectedRowIds });
    await act(async () => { await published(ref)[command](4, { name: 'Möhre' }); });

    expect(replacement).toHaveBeenCalledWith(4, { name: 'Möhre' });
  });

  it('does not republish when nothing it depends on changed', () => {
    // Republishing on every render would churn the ref the palette reads.
    const selectedRowIds: GridRowId[] = [1];
    const { rerender } = setup(deps, { commandApiRef: ref, selectedRowIds });
    const before = published(ref);

    rerender({ commandApiRef: ref, selectedRowIds });

    expect(ref.current).toBe(before);
  });
});
