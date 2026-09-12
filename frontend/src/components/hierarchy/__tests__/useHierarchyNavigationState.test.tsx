import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GridRowId } from '@mui/x-data-grid';
import type { HierarchyRow } from '../utils/types';
import { useHierarchyNavigationState } from '../hooks/useHierarchyNavigationState';

const ROWS: HierarchyRow[] = [
  { id: 'location-1', type: 'location', level: 0, name: 'Hofacker' },
  { id: 'field-1', type: 'field', level: 1, name: 'Parzelle A' },
];
const OTHER_ROWS: HierarchyRow[] = [{ id: 7, type: 'bed', level: 2, name: 'Beet 7' }];
const EMPTY_EXPANDED = new Set<GridRowId>();

interface Props {
  expandedRows: Set<GridRowId>;
  rows: HierarchyRow[];
}

/**
 * Stable prop identities by default: both ref mirrors key on identity, so
 * fresh literals per render would make every "still the same object" test
 * pass for the wrong reason.
 */
const setup = ({ rows = ROWS, expandedRows = EMPTY_EXPANDED }: Partial<Props> = {}) => {
  let renders = 0;
  const view = renderHook(
    (props: Props) => {
      renders += 1;
      return useHierarchyNavigationState(props);
    },
    { initialProps: { rows, expandedRows } },
  );
  return { ...view, renderCount: () => renders };
};

describe('initial state', () => {
  it('starts with nothing selected and the tree inactive', () => {
    // The areas page opens with the grid cold: no row cursor, and the window
    // keyboard layer inert until the user actually engages the table.
    const { result } = setup();

    expect(result.current.selectedRowId).toBeNull();
    expect(result.current.treeActive).toBe(false);
  });

  it('has both mirrors already matching on the first render', () => {
    // Note this holds whichever line produces it -- by the time a test can
    // read the result, the mirror effects have already run and written the
    // same values. The test below is the one that isolates the initializers.
    const { result } = setup();

    expect(result.current.selectedRowIdRef.current).toBeNull();
    expect(result.current.treeActiveRef.current).toBe(false);
  });

  it('has all four mirrors usable during the first render itself', () => {
    // The narrow window the `useRef` initializers exist for: after the hook
    // has run but before any effect has. Nothing in the mount effects can
    // mask a wrong initial value here, which is what makes this the only
    // reading that can fail if one is dropped.
    //
    // It is not a hypothetical window. FieldsBedsHierarchy registers command
    // palette entries whose `isEnabled` predicate reads `selectedRowIdRef`
    // synchronously, and a ref that started empty would report a command as
    // unavailable -- or, for `rowsRef`, hand a lookup an empty list.
    const expandedRows = new Set<GridRowId>(['location-1']);
    const duringRender: unknown[] = [];
    renderHook(() => {
      const state = useHierarchyNavigationState({ rows: ROWS, expandedRows });
      duringRender.push({
        selectedRowId: state.selectedRowIdRef.current,
        treeActive: state.treeActiveRef.current,
        rows: state.rowsRef.current,
        expandedRows: state.expandedRowsRef.current,
      });
      return state;
    });

    expect(duringRender[0]).toEqual({
      selectedRowId: null,
      treeActive: false,
      rows: ROWS,
      expandedRows,
    });
  });

  it('exposes the rows and expand state it was handed', () => {
    const expandedRows = new Set<GridRowId>(['location-1']);
    const { result } = setup({ expandedRows });

    expect(result.current.rowsRef.current).toBe(ROWS);
    expect(result.current.expandedRowsRef.current).toBe(expandedRows);
  });
});

describe('selectRow', () => {
  it('moves the cursor and re-renders', () => {
    const { result } = setup();

    act(() => result.current.selectRow('field-1'));

    expect(result.current.selectedRowId).toBe('field-1');
    expect(result.current.selectedRowIdRef.current).toBe('field-1');
  });

  it('writes the mirror before React commits the state', () => {
    // This is the hook's whole reason to exist. The window keydown handlers
    // read the ref, and a key can arrive in the same tick as the select that
    // preceded it -- waiting for the effect would make that keypress act on
    // the previous row. Reading inside the act callback catches the window
    // where the state update is queued but not yet applied.
    const { result } = setup();
    let mirrorDuringCall: GridRowId | null | undefined;
    let stateDuringCall: GridRowId | null | undefined;

    act(() => {
      result.current.selectRow('field-1');
      mirrorDuringCall = result.current.selectedRowIdRef.current;
      stateDuringCall = result.current.selectedRowId;
    });

    expect(mirrorDuringCall).toBe('field-1');
    expect(stateDuringCall).toBeNull();
  });

  it('leaves the tree inactive, since selecting is not engaging', () => {
    // Deliberately different from activateRow: a programmatic selection (a
    // deep link, a row that was just created) should not hand the arrow keys
    // to the table behind the user's back.
    const { result } = setup();

    act(() => result.current.selectRow('field-1'));

    expect(result.current.treeActive).toBe(false);
    expect(result.current.treeActiveRef.current).toBe(false);
  });

  it('accepts a numeric id, which bed rows carry', () => {
    const { result } = setup({ rows: OTHER_ROWS });

    act(() => result.current.selectRow(7));

    expect(result.current.selectedRowId).toBe(7);
    expect(result.current.selectedRowIdRef.current).toBe(7);
  });

  it('replaces the previous selection rather than accumulating', () => {
    const { result } = setup();

    act(() => result.current.selectRow('location-1'));
    act(() => result.current.selectRow('field-1'));

    expect(result.current.selectedRowId).toBe('field-1');
  });
});

describe('selectRowTransient', () => {
  it('moves the cursor without re-rendering', () => {
    // Used while the arrow keys are being held: repainting the grid on every
    // intermediate row would make a held key crawl.
    const { result, renderCount } = setup();
    const before = renderCount();

    act(() => result.current.selectRowTransient('field-1'));

    expect(result.current.selectedRowIdRef.current).toBe('field-1');
    expect(renderCount()).toBe(before);
  });

  it('leaves the rendered selection behind on purpose', () => {
    // The visible highlight stays where the last committed selection put it;
    // only the keyboard layer's own cursor moves.
    const { result } = setup();
    act(() => result.current.selectRow('location-1'));

    act(() => result.current.selectRowTransient('field-1'));

    expect(result.current.selectedRowId).toBe('location-1');
    expect(result.current.selectedRowIdRef.current).toBe('field-1');
  });

  it('is not undone by an unrelated re-render', () => {
    // The mirror effect runs on every commit, so a transient move would be
    // reverted if that effect wrote the state value back unconditionally.
    const { result, rerender } = setup();
    act(() => result.current.selectRowTransient('field-1'));

    rerender({ rows: OTHER_ROWS, expandedRows: EMPTY_EXPANDED });

    expect(result.current.selectedRowIdRef.current).toBe('field-1');
  });

  it('is overwritten by a later committed selection', () => {
    const { result } = setup();
    act(() => result.current.selectRowTransient('field-1'));

    act(() => result.current.selectRow('location-1'));

    expect(result.current.selectedRowIdRef.current).toBe('location-1');
    expect(result.current.selectedRowId).toBe('location-1');
  });

  it('leaves the tree state untouched', () => {
    const { result } = setup();

    act(() => result.current.selectRowTransient('field-1'));

    expect(result.current.treeActive).toBe(false);
    expect(result.current.treeActiveRef.current).toBe(false);
  });
});

describe('activateRow', () => {
  it('selects the row and hands the keyboard to the table', () => {
    const { result } = setup();

    act(() => result.current.activateRow('field-1'));

    expect(result.current.selectedRowId).toBe('field-1');
    expect(result.current.treeActive).toBe(true);
  });

  it('writes both mirrors before React commits either state', () => {
    // Alt+T activates and then immediately scrolls the row into view; an
    // arrow key pressed in that same tick has to find the table active and
    // the cursor already on the first row.
    const { result } = setup();
    let selectionDuringCall: GridRowId | null | undefined;
    let activeDuringCall: boolean | undefined;

    act(() => {
      result.current.activateRow('field-1');
      selectionDuringCall = result.current.selectedRowIdRef.current;
      activeDuringCall = result.current.treeActiveRef.current;
      expect(result.current.treeActive).toBe(false);
    });

    expect(selectionDuringCall).toBe('field-1');
    expect(activeDuringCall).toBe(true);
  });

  it('reactivates a tree that was switched off without losing the row', () => {
    const { result } = setup();
    act(() => result.current.activateRow('field-1'));
    act(() => result.current.setTreeActive(false));

    act(() => result.current.activateRow('field-1'));

    expect(result.current.treeActive).toBe(true);
    expect(result.current.selectedRowId).toBe('field-1');
  });
});

describe('setters exposed directly', () => {
  it('mirrors a selection made through setSelectedRowId', () => {
    // The context menu sets the row through the plain setter, so the mirror
    // has to follow from the effect rather than only from selectRow.
    const { result } = setup();

    act(() => result.current.setSelectedRowId('field-1'));

    expect(result.current.selectedRowIdRef.current).toBe('field-1');
  });

  it('mirrors the tree flag set through setTreeActive', () => {
    const { result } = setup();

    act(() => result.current.setTreeActive(true));

    expect(result.current.treeActiveRef.current).toBe(true);
  });

  it('mirrors a deactivation too', () => {
    // Clicking outside the table turns the keyboard layer off; a mirror that
    // only followed activations would leave the shortcuts live.
    const { result } = setup();
    act(() => result.current.setTreeActive(true));

    act(() => result.current.setTreeActive(false));

    expect(result.current.treeActiveRef.current).toBe(false);
  });

  it('mirrors a cleared selection', () => {
    const { result } = setup();
    act(() => result.current.selectRow('field-1'));

    act(() => result.current.setSelectedRowId(null));

    expect(result.current.selectedRowIdRef.current).toBeNull();
  });

  it('accepts an updater function, as a Dispatch must', () => {
    const { result } = setup();
    act(() => result.current.setTreeActive(true));

    act(() => result.current.setTreeActive((previous) => !previous));

    expect(result.current.treeActive).toBe(false);
    expect(result.current.treeActiveRef.current).toBe(false);
  });
});

describe('prop mirrors', () => {
  it('follows new rows', () => {
    const { result, rerender } = setup();

    rerender({ rows: OTHER_ROWS, expandedRows: EMPTY_EXPANDED });

    expect(result.current.rowsRef.current).toBe(OTHER_ROWS);
  });

  it('follows a new expand set', () => {
    const expandedRows = new Set<GridRowId>(['location-1', 'field-1']);
    const { result, rerender } = setup();

    rerender({ rows: ROWS, expandedRows });

    expect(result.current.expandedRowsRef.current).toBe(expandedRows);
  });

  it('keeps the two mirrors independent', () => {
    // They are separate effects on purpose; a rows change must not resurrect
    // a stale expand set or vice versa.
    const expandedRows = new Set<GridRowId>(['location-1']);
    const { result, rerender } = setup({ expandedRows });

    rerender({ rows: OTHER_ROWS, expandedRows });

    expect(result.current.rowsRef.current).toBe(OTHER_ROWS);
    expect(result.current.expandedRowsRef.current).toBe(expandedRows);
  });

  it('holds the same objects the caller passed, not copies', () => {
    // The keyboard layer compares row ids against these, and the expand set
    // is read with `.has` -- a copy would work but would also silently break
    // any identity check a caller adds later.
    const expandedRows = new Set<GridRowId>(['field-1']);
    const { result } = setup({ expandedRows });

    expect(result.current.rowsRef.current).toBe(ROWS);
    expect(result.current.expandedRowsRef.current).toBe(expandedRows);
  });

  it('has the new rows in hand by the time the commit settles', () => {
    // The hook uses layout effects rather than passive ones. That choice is
    // not observable from here and is not load-bearing today: every consumer
    // reads these refs from window event handlers or command predicates,
    // which run in a later task than either kind of effect. Switching them to
    // passive effects would pass this suite. Kept as layout effects because
    // they mirror render output and should be settled before paint, but
    // recorded as a preference rather than a requirement.
    const { result, rerender } = setup();

    rerender({ rows: OTHER_ROWS, expandedRows: EMPTY_EXPANDED });

    expect(result.current.rowsRef.current).toBe(OTHER_ROWS);
  });
});

describe('callback identity', () => {
  it('keeps every callback stable across renders', () => {
    // They sit in the dependency arrays of the keyboard effects, which
    // re-subscribe window listeners when they change.
    const { result, rerender } = setup();
    const before = {
      selectRow: result.current.selectRow,
      selectRowTransient: result.current.selectRowTransient,
      activateRow: result.current.activateRow,
      setSelectedRowId: result.current.setSelectedRowId,
      setTreeActive: result.current.setTreeActive,
    };

    rerender({ rows: OTHER_ROWS, expandedRows: new Set<GridRowId>(['field-1']) });

    expect(result.current.selectRow).toBe(before.selectRow);
    expect(result.current.selectRowTransient).toBe(before.selectRowTransient);
    expect(result.current.activateRow).toBe(before.activateRow);
    expect(result.current.setSelectedRowId).toBe(before.setSelectedRowId);
    expect(result.current.setTreeActive).toBe(before.setTreeActive);
  });

  it('keeps every ref object stable across renders', () => {
    const { result, rerender } = setup();
    const before = {
      selectedRowIdRef: result.current.selectedRowIdRef,
      treeActiveRef: result.current.treeActiveRef,
      rowsRef: result.current.rowsRef,
      expandedRowsRef: result.current.expandedRowsRef,
    };

    act(() => result.current.activateRow('field-1'));
    rerender({ rows: OTHER_ROWS, expandedRows: EMPTY_EXPANDED });

    expect(result.current.selectedRowIdRef).toBe(before.selectedRowIdRef);
    expect(result.current.treeActiveRef).toBe(before.treeActiveRef);
    expect(result.current.rowsRef).toBe(before.rowsRef);
    expect(result.current.expandedRowsRef).toBe(before.expandedRowsRef);
  });
});
