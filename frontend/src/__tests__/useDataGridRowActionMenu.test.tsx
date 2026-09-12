import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GridRowId } from '@mui/x-data-grid';
import { ROW_LONG_PRESS_MS } from '../components/contextMenu/useLongPressTimer';
import { useDataGridRowActionMenu } from '../components/data-grid/hooks/useDataGridRowActionMenu';

const ROWS = new Map<string, unknown>([['10', { id: 10 }], ['11', { id: 11 }]]);

const setup = ({
  rowsById = ROWS,
  hasContextualRowActions = true,
  getRowIdFromElement = ((target: EventTarget | null) => {
    const element = target instanceof Element
      ? target.closest<HTMLElement>('[role="row"][data-id]')
      : null;
    const id = element?.dataset.id;
    return id === undefined ? null : Number(id);
  }) as (target: EventTarget | null) => GridRowId | null,
} = {}) => {
  const markContextMenuHintUsed = vi.fn();
  const markTouchContextMenuHintUsed = vi.fn();
  const setSelectedRowIds = vi.fn();

  const { result } = renderHook(() => useDataGridRowActionMenu({
    rowsById,
    hasContextualRowActions,
    markContextMenuHintUsed,
    markTouchContextMenuHintUsed,
    setSelectedRowIds,
    getRowIdFromElement,
  }));

  return { result, markContextMenuHintUsed, markTouchContextMenuHintUsed, setSelectedRowIds };
};

/** A grid row, optionally containing an editable cell to press on. */
const buildRow = (id = 10, inner?: 'input' | 'textarea' | 'plain') => {
  const row = document.createElement('div');
  row.setAttribute('role', 'row');
  row.dataset.id = String(id);
  row.getBoundingClientRect = () => ({
    left: 100, top: 50, width: 800, height: 40, right: 900, bottom: 90, x: 100, y: 50,
    toJSON: () => ({}),
  });
  let target: HTMLElement = row;
  if (inner && inner !== 'plain') {
    target = document.createElement(inner);
    row.append(target);
  } else if (inner === 'plain') {
    target = document.createElement('span');
    row.append(target);
  }
  document.body.append(row);
  return { row, target };
};

const touchEvent = (target: EventTarget, touches: { clientX: number; clientY: number }[]) => ({
  target,
  touches,
  preventDefault: vi.fn(),
} as unknown as React.TouchEvent<HTMLDivElement>);

const mouseEvent = (currentTarget: HTMLElement) => ({
  currentTarget,
  clientX: 300,
  clientY: 200,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  nativeEvent: { stopImmediatePropagation: vi.fn() },
} as unknown as React.MouseEvent);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('isRowActionContextMenuTarget', () => {
  it('accepts a plain cell in a known row', () => {
    const { target } = buildRow(10, 'plain');
    expect(setup().result.current.isRowActionContextMenuTarget(target)).toBe(true);
  });

  it.each(['input', 'textarea'] as const)('refuses an open %s, which owns its own menu', (tag) => {
    // The browser's own text menu (cut/copy/paste) has to win inside an editor.
    const { target } = buildRow(10, tag);
    expect(setup().result.current.isRowActionContextMenuTarget(target)).toBe(false);
  });

  it('refuses everything when the grid offers no row actions', () => {
    const { target } = buildRow(10, 'plain');
    expect(
      setup({ hasContextualRowActions: false }).result.current
        .isRowActionContextMenuTarget(target),
    ).toBe(false);
  });

  it('refuses a target outside any row', () => {
    // The explicit `rowId !== null` half of the guard is redundant against the
    // lookup beside it: `rowsById.has(String(null))` is a miss anyway.
    // Removing it leaves this file green.
    const stray = document.createElement('div');
    document.body.append(stray);
    expect(setup().result.current.isRowActionContextMenuTarget(stray)).toBe(false);
  });

  it('refuses a row the grid does not know', () => {
    // A row can be removed between render and the right-click.
    const { target } = buildRow(99, 'plain');
    expect(setup().result.current.isRowActionContextMenuTarget(target)).toBe(false);
  });
});

describe('openRowActionContextMenu — right click', () => {
  it('opens the menu near the pointer', () => {
    const { row } = buildRow();
    const { result } = setup();

    act(() => result.current.openRowActionContextMenu(10, mouseEvent(row)));

    expect(result.current.rowActionMenuState).toMatchObject({
      rowId: 10, mouseX: 302, mouseY: 194,
    });
  });

  it('suppresses the browser menu three ways', () => {
    // A native menu opening on top of this one would make both unusable.
    const { row } = buildRow();
    const event = mouseEvent(row);
    const { result } = setup();

    act(() => result.current.openRowActionContextMenu(10, event));

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(event.nativeEvent.stopImmediatePropagation).toHaveBeenCalled();
  });

  it('selects the row it opened for', () => {
    const { row } = buildRow();
    const { result, setSelectedRowIds } = setup();

    act(() => result.current.openRowActionContextMenu(10, mouseEvent(row)));

    expect(setSelectedRowIds).toHaveBeenCalledWith([10]);
  });

  it('records that the user has found the menu, so the hint can stop', () => {
    const { row } = buildRow();
    const { result, markContextMenuHintUsed, markTouchContextMenuHintUsed } = setup();

    act(() => result.current.openRowActionContextMenu(10, mouseEvent(row)));

    expect(markContextMenuHintUsed).toHaveBeenCalled();
    // The touch hint is a separate lesson and must not be marked by a mouse.
    expect(markTouchContextMenuHintUsed).not.toHaveBeenCalled();
  });
});

describe('openRowActionKeyboardContextMenu', () => {
  it('anchors the menu inside the row rather than at the pointer', () => {
    // There is no pointer for a keyboard menu, so it is placed against the
    // row's own box.
    const { row } = buildRow();
    const { result } = setup();

    act(() => result.current.openRowActionKeyboardContextMenu(10, row));

    expect(result.current.rowActionMenuState).toMatchObject({
      rowId: 10, mouseX: 340, mouseY: 62,
    });
  });

  it('caps how far right it places a very wide row', () => {
    // Without the cap the menu would land off the side of a wide table.
    const { row } = buildRow();
    row.getBoundingClientRect = () => ({
      left: 100, top: 50, width: 100, height: 40, right: 200, bottom: 90, x: 100, y: 50,
      toJSON: () => ({}),
    });
    const { result } = setup();

    act(() => result.current.openRowActionKeyboardContextMenu(10, row));

    expect(result.current.rowActionMenuState?.mouseX).toBe(200);
  });

  it('walks up to the row when given a cell inside it', () => {
    const { row, target } = buildRow(10, 'plain');
    const { result } = setup();

    act(() => result.current.openRowActionKeyboardContextMenu(10, target));

    expect(result.current.rowActionMenuState?.mouseX).toBe(340);
    expect(row.contains(target)).toBe(true);
  });

  it('falls back to the element itself when it is in no row', () => {
    const loose = document.createElement('div');
    loose.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 50, height: 10, right: 50, bottom: 10, x: 0, y: 0,
      toJSON: () => ({}),
    });
    document.body.append(loose);
    const { result } = setup();

    act(() => result.current.openRowActionKeyboardContextMenu(10, loose));

    expect(result.current.rowActionMenuState).toMatchObject({ mouseX: 50, mouseY: 12 });
  });
});

describe('long press on touch', () => {
  const pressAndHold = (
    result: { current: ReturnType<typeof useDataGridRowActionMenu> },
    target: EventTarget,
    touches = [{ clientX: 120, clientY: 240 }],
  ) => {
    act(() => result.current.handleGridTouchStart(touchEvent(target, touches)));
    act(() => { vi.advanceTimersByTime(ROW_LONG_PRESS_MS); });
  };

  it('opens the menu after the press is held long enough', () => {
    const { target } = buildRow(10, 'plain');
    const { result } = setup();

    pressAndHold(result, target);

    expect(result.current.rowActionMenuState).toMatchObject({
      rowId: 10, mouseX: 122, mouseY: 234,
    });
  });

  it('does not open on a press shorter than the threshold', () => {
    // A plain tap has to keep working as a tap.
    const { target } = buildRow(10, 'plain');
    const { result } = setup();

    act(() => result.current.handleGridTouchStart(touchEvent(target, [{ clientX: 120, clientY: 240 }])));
    act(() => { vi.advanceTimersByTime(ROW_LONG_PRESS_MS - 1); });

    expect(result.current.rowActionMenuState).toBeNull();
  });

  it('cancels when the finger moves, which means a scroll', () => {
    const { target } = buildRow(10, 'plain');
    const { result } = setup();

    act(() => result.current.handleGridTouchStart(touchEvent(target, [{ clientX: 120, clientY: 240 }])));
    act(() => result.current.handleGridTouchMove());
    act(() => { vi.advanceTimersByTime(ROW_LONG_PRESS_MS * 2); });

    expect(result.current.rowActionMenuState).toBeNull();
  });

  it('cancels when the finger lifts early', () => {
    const { target } = buildRow(10, 'plain');
    const { result } = setup();

    act(() => result.current.handleGridTouchStart(touchEvent(target, [{ clientX: 120, clientY: 240 }])));
    act(() => result.current.handleGridTouchEnd(touchEvent(target, [])));
    act(() => { vi.advanceTimersByTime(ROW_LONG_PRESS_MS * 2); });

    expect(result.current.rowActionMenuState).toBeNull();
  });

  it('swallows the trailing click after a long press fired', () => {
    // Otherwise the browser's synthetic click runs the row's own tap action
    // on top of the menu that just opened.
    const { target } = buildRow(10, 'plain');
    const { result } = setup();
    pressAndHold(result, target);
    const endEvent = touchEvent(target, []);

    act(() => result.current.handleGridTouchEnd(endEvent));

    expect(endEvent.preventDefault).toHaveBeenCalled();
  });

  it('leaves a plain tap’s click alone', () => {
    const { target } = buildRow(10, 'plain');
    const { result } = setup();
    act(() => result.current.handleGridTouchStart(touchEvent(target, [{ clientX: 120, clientY: 240 }])));
    const endEvent = touchEvent(target, []);

    act(() => result.current.handleGridTouchEnd(endEvent));

    expect(endEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores a two-finger gesture, which is a pinch or a scroll', () => {
    const { target } = buildRow(10, 'plain');
    const { result } = setup();

    pressAndHold(result, target, [
      { clientX: 120, clientY: 240 }, { clientX: 200, clientY: 300 },
    ]);

    expect(result.current.rowActionMenuState).toBeNull();
  });

  it.each(['input', 'textarea'] as const)('ignores a long press inside an open %s', (tag) => {
    const { target } = buildRow(10, tag);
    const { result } = setup();

    pressAndHold(result, target);

    expect(result.current.rowActionMenuState).toBeNull();
  });

  it('ignores a long press when the grid offers no row actions', () => {
    const { target } = buildRow(10, 'plain');
    const { result } = setup({ hasContextualRowActions: false });

    pressAndHold(result, target);

    expect(result.current.rowActionMenuState).toBeNull();
  });

  it('ignores a long press on a row the grid does not know', () => {
    const { target } = buildRow(99, 'plain');
    const { result } = setup();

    pressAndHold(result, target);

    expect(result.current.rowActionMenuState).toBeNull();
  });

  it('marks the touch hint used, not the mouse one', () => {
    const { target } = buildRow(10, 'plain');
    const { result, markContextMenuHintUsed, markTouchContextMenuHintUsed } = setup();

    pressAndHold(result, target);

    expect(markTouchContextMenuHintUsed).toHaveBeenCalled();
    expect(markContextMenuHintUsed).not.toHaveBeenCalled();
  });

  it('shows pressed feedback on the row it opened for', () => {
    const { target } = buildRow(10, 'plain');
    const { result } = setup();

    pressAndHold(result, target);

    expect(result.current.longPressFeedbackRowId).toBe(10);
  });

  it('gives no pressed feedback for a right click', () => {
    // The feedback exists to explain a touch gesture that has no cursor.
    const { row } = buildRow();
    const { result } = setup();

    act(() => result.current.openRowActionContextMenu(10, mouseEvent(row)));

    expect(result.current.longPressFeedbackRowId).toBeNull();
  });

  it('selects the row the press landed on', () => {
    const { target } = buildRow(11, 'plain');
    const { result, setSelectedRowIds } = setup();

    pressAndHold(result, target);

    expect(setSelectedRowIds).toHaveBeenCalledWith([11]);
  });

  it('only arms the timer, doing nothing until it fires', () => {
    const { target } = buildRow(10, 'plain');
    const { result, setSelectedRowIds } = setup();

    act(() => result.current.handleGridTouchStart(touchEvent(target, [{ clientX: 1, clientY: 1 }])));

    expect(setSelectedRowIds).not.toHaveBeenCalled();
  });

  it('re-arms for a second press, keeping the newer position', () => {
    const { target } = buildRow(10, 'plain');
    const { result } = setup();

    act(() => result.current.handleGridTouchStart(touchEvent(target, [{ clientX: 1, clientY: 1 }])));
    act(() => result.current.handleGridTouchStart(touchEvent(target, [{ clientX: 500, clientY: 400 }])));
    act(() => { vi.advanceTimersByTime(ROW_LONG_PRESS_MS); });

    expect(result.current.rowActionMenuState).toMatchObject({ mouseX: 502, mouseY: 394 });
  });
});

describe('closing and clearing', () => {
  const openViaTouch = (result: { current: ReturnType<typeof useDataGridRowActionMenu> }, id = 10) => {
    const { target } = buildRow(id, 'plain');
    act(() => result.current.handleGridTouchStart(touchEvent(target, [{ clientX: 1, clientY: 1 }])));
    act(() => { vi.advanceTimersByTime(ROW_LONG_PRESS_MS); });
  };

  it('closes the menu and drops the pressed feedback together', () => {
    const { result } = setup();
    openViaTouch(result);

    act(() => result.current.closeRowActionMenu());

    expect(result.current.rowActionMenuState).toBeNull();
    expect(result.current.longPressFeedbackRowId).toBeNull();
  });

  it('clears the menu when its own row is removed', () => {
    // Leaving it open would point at a row that no longer exists.
    const { result } = setup();
    openViaTouch(result, 10);

    act(() => result.current.clearRowActionMenuForId(10));

    expect(result.current.rowActionMenuState).toBeNull();
    expect(result.current.longPressFeedbackRowId).toBeNull();
  });

  it('leaves the menu alone when a different row is removed', () => {
    const { result } = setup();
    openViaTouch(result, 10);

    act(() => result.current.clearRowActionMenuForId(11));

    expect(result.current.rowActionMenuState).toMatchObject({ rowId: 10 });
    expect(result.current.longPressFeedbackRowId).toBe(10);
  });

  it('matches the removed row by string, since ids arrive both ways', () => {
    const { result } = setup();
    openViaTouch(result, 10);

    act(() => result.current.clearRowActionMenuForId('10'));

    expect(result.current.rowActionMenuState).toBeNull();
  });
});
