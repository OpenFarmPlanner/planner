import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type React from 'react';
import type { HierarchyRow } from '../utils/types';
import { ROW_LONG_PRESS_MS } from '../../contextMenu/useLongPressTimer';
import { useHierarchyContextMenu } from '../hooks/useHierarchyContextMenu';

const ROWS: HierarchyRow[] = [
  { id: 'location-1', type: 'location', level: 0, name: 'Hofacker' },
  { id: 'field-1', type: 'field', level: 1, name: 'Parzelle A' },
  { id: 7, type: 'bed', level: 2, name: 'Beet 7' },
];

/**
 * The hook reads `[role="row"][data-id]` off the event target, so the target
 * has to be a real element inside a real row rather than a stub -- `closest`
 * is what decides whether the menu opens at all.
 */
const mountRow = (rowId: string | number, inner: 'cell' | 'input' = 'cell') => {
  const row = document.createElement('div');
  row.setAttribute('role', 'row');
  row.dataset.id = String(rowId);
  row.getBoundingClientRect = () => ({
    left: 100, top: 200, width: 400, height: 32,
    right: 500, bottom: 232, x: 100, y: 200, toJSON: () => ({}),
  });
  const child = document.createElement(inner === 'input' ? 'input' : 'div');
  row.append(child);
  document.body.append(row);
  return { row, child };
};

/**
 * The handlers touch only `target`, `currentTarget`, the coordinates, and the
 * suppression methods, so a literal with those fields is a faithful stand-in
 * for a React synthetic event -- and lets each suppression call be observed
 * separately, which a dispatched DOM event cannot.
 */
const mouseEvent = (
  target: Element,
  { clientX = 320, clientY = 240, currentTarget = target } = {},
) => ({
  target,
  currentTarget,
  clientX,
  clientY,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  stopImmediatePropagation: vi.fn(),
  nativeEvent: { stopImmediatePropagation: vi.fn() },
});

const touchEvent = (
  target: Element,
  touches: { clientX: number; clientY: number }[] = [{ clientX: 60, clientY: 90 }],
) => ({
  target,
  currentTarget: target,
  touches,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
  nativeEvent: { stopImmediatePropagation: vi.fn() },
});

const setup = ({ rows = ROWS }: { rows?: HierarchyRow[] } = {}) => {
  const markContextMenuHintUsed = vi.fn();
  const markTouchContextMenuHintUsed = vi.fn();
  const setSelectedRowId = vi.fn();
  const setTreeActive = vi.fn();
  const view = renderHook(() => useHierarchyContextMenu({
    rows,
    markContextMenuHintUsed,
    markTouchContextMenuHintUsed,
    setSelectedRowId,
    setTreeActive,
  }));
  return {
    ...view,
    markContextMenuHintUsed,
    markTouchContextMenuHintUsed,
    setSelectedRowId,
    setTreeActive,
  };
};

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('isHierarchyContextMenuTarget', () => {
  it('accepts an element inside a row the hook knows', () => {
    const { child } = mountRow('field-1');
    const { result } = setup();

    expect(result.current.isHierarchyContextMenuTarget(child)).toBe(true);
  });

  it('accepts a numeric row id, which beds carry as their database id', () => {
    const { child } = mountRow(7);
    const { result } = setup();

    expect(result.current.isHierarchyContextMenuTarget(child)).toBe(true);
  });

  it('rejects a text input, so the browser\'s own cut/copy/paste menu wins', () => {
    const { child } = mountRow('field-1', 'input');
    const { result } = setup();

    expect(result.current.isHierarchyContextMenuTarget(child)).toBe(false);
  });

  it('rejects an element that is in no row at all', () => {
    const outside = document.createElement('div');
    document.body.append(outside);
    const { result } = setup();

    expect(result.current.isHierarchyContextMenuTarget(outside)).toBe(false);
  });

  it('rejects a row whose id the hook does not have', () => {
    // A stale DOM node left behind after the row was deleted. The `rowId &&`
    // half of the check is redundant here -- an absent id makes the `some`
    // comparison miss on its own -- but it keeps the intent readable.
    const { child } = mountRow('field-404');
    const { result } = setup();

    expect(result.current.isHierarchyContextMenuTarget(child)).toBe(false);
  });

  it('rejects a row element that carries no data-id', () => {
    // The DataGrid's header is also `role="row"` but has no id, so it must
    // not be treated as a row. Note this holds with or without the
    // `[data-id]` half of the selector -- a missing id fails the membership
    // check next anyway -- see the nesting test below for where that half of
    // the selector is the thing deciding the answer.
    const header = document.createElement('div');
    header.setAttribute('role', 'row');
    const child = document.createElement('div');
    header.append(child);
    document.body.append(header);
    const { result } = setup();

    expect(result.current.isHierarchyContextMenuTarget(child)).toBe(false);
  });

  it('walks past a row-like element nested inside a real row', () => {
    // The one configuration in which `[data-id]` changes the answer rather
    // than merely restating it: with both halves, `closest` skips the inner
    // id-less element and finds the row that owns it; with `[role="row"]`
    // alone it stops at the inner one and the row is missed.
    //
    // FieldsBedsHierarchy renders no nested rows today -- no detail panels,
    // no grouping rows -- so this is not reachable from the UI. It is pinned
    // because adding either of those would make it reachable silently.
    const { row } = mountRow('field-1');
    const innerRowLike = document.createElement('div');
    innerRowLike.setAttribute('role', 'row');
    const child = document.createElement('div');
    innerRowLike.append(child);
    row.append(innerRowLike);
    const { result } = setup();

    expect(result.current.isHierarchyContextMenuTarget(child)).toBe(true);
  });

  it('rejects a non-element target', () => {
    const { result } = setup();

    expect(result.current.isHierarchyContextMenuTarget(window)).toBe(false);
    expect(result.current.isHierarchyContextMenuTarget(null)).toBe(false);
  });

  it('follows the current rows, not the list present at mount', () => {
    const { child } = mountRow('field-9');
    const { result, rerender } = setup();
    expect(result.current.isHierarchyContextMenuTarget(child)).toBe(false);

    rerender();

    expect(result.current.isHierarchyContextMenuTarget(child)).toBe(false);
  });
});

describe('openContextMenuForRow', () => {
  it('selects the row, activates the tree, and records the position', () => {
    const { result, setSelectedRowId, setTreeActive } = setup();

    act(() => result.current.openContextMenuForRow(ROWS[1], 320, 240));

    expect(setSelectedRowId).toHaveBeenCalledWith('field-1');
    expect(setTreeActive).toHaveBeenCalledWith(true);
    expect(result.current.contextMenuState).toEqual({
      row: ROWS[1], mouseX: 320, mouseY: 240,
    });
  });

  it('marks the desktop hint as used by default', () => {
    // The hint that teaches right-click is retired once the user has found it.
    const { result, markContextMenuHintUsed, markTouchContextMenuHintUsed } = setup();

    act(() => result.current.openContextMenuForRow(ROWS[1], 10, 20));

    expect(markContextMenuHintUsed).toHaveBeenCalledTimes(1);
    expect(markTouchContextMenuHintUsed).not.toHaveBeenCalled();
  });

  it('marks the touch hint instead when asked', () => {
    // Touch and mouse each get their own hint copy and their own retirement:
    // finding the long press should not silently retire the right-click hint.
    const { result, markContextMenuHintUsed, markTouchContextMenuHintUsed } = setup();

    act(() => result.current.openContextMenuForRow(ROWS[1], 10, 20, null, { markHint: 'touch' }));

    expect(markTouchContextMenuHintUsed).toHaveBeenCalledTimes(1);
    expect(markContextMenuHintUsed).not.toHaveBeenCalled();
  });

  it('marks neither hint when hint marking is switched off', () => {
    const { result, markContextMenuHintUsed, markTouchContextMenuHintUsed } = setup();

    act(() => result.current.openContextMenuForRow(ROWS[1], 10, 20, null, { markHint: false }));

    expect(markContextMenuHintUsed).not.toHaveBeenCalled();
    expect(markTouchContextMenuHintUsed).not.toHaveBeenCalled();
  });

  it('exposes the row object itself, which the menu builds its entries from', () => {
    const { result } = setup();

    act(() => result.current.openContextMenuForRow(ROWS[2], 1, 2));

    expect(result.current.contextMenuState?.row).toBe(ROWS[2]);
  });

  it('reopens at the new position for a second row without closing first', () => {
    // Right-clicking another row while the menu is up moves it there.
    const { result } = setup();

    act(() => result.current.openContextMenuForRow(ROWS[0], 10, 20));
    act(() => result.current.openContextMenuForRow(ROWS[2], 60, 70));

    expect(result.current.contextMenuState).toEqual({ row: ROWS[2], mouseX: 60, mouseY: 70 });
  });

  it('closes to null', () => {
    const { result } = setup();
    act(() => result.current.openContextMenuForRow(ROWS[1], 10, 20));

    act(() => result.current.closeContextMenu());

    expect(result.current.contextMenuState).toBeNull();
  });

  it('restores focus to the element the menu was opened from', async () => {
    // Otherwise closing the menu drops the user at the top of the document
    // and the keyboard path cannot be continued. The restore is deferred to
    // the next frame -- the menu is still unmounting on the commit that
    // closed it -- so this has to wait rather than assert straight away.
    const { row } = mountRow('field-1');
    const origin = document.createElement('button');
    row.append(origin);
    const { result } = setup();

    act(() => result.current.openContextMenuForRow(ROWS[1], 10, 20, origin));
    act(() => result.current.closeContextMenu());

    await waitFor(() => expect(document.activeElement).toBe(origin));
  });

  it('does not move focus when the menu was opened without an origin', async () => {
    // The keyboard-free paths pass no origin; stealing focus to the body
    // there would be worse than leaving it where the user put it.
    const { row } = mountRow('field-1');
    const elsewhere = document.createElement('button');
    row.append(elsewhere);
    elsewhere.focus();
    const { result } = setup();

    act(() => result.current.openContextMenuForRow(ROWS[1], 10, 20));
    act(() => result.current.closeContextMenu());
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });

    expect(document.activeElement).toBe(elsewhere);
  });
});

describe('handleNameCellContextMenu', () => {
  it('opens just below and right of the pointer', () => {
    // The small offset keeps the menu from opening under the cursor itself,
    // where its first entry would sit directly beneath the click.
    const { row, child } = mountRow('field-1');
    const { result } = setup();
    const event = mouseEvent(child, { clientX: 320, clientY: 240, currentTarget: row });

    act(() => result.current.handleNameCellContextMenu(
      event as unknown as React.MouseEvent<HTMLElement>, ROWS[1],
    ));

    expect(result.current.contextMenuState).toEqual({ row: ROWS[1], mouseX: 322, mouseY: 234 });
  });

  it('suppresses the browser menu on every channel', () => {
    // React's synthetic listener and any DOM listener on an ancestor both have
    // to be stopped, or the native menu opens on top of this one.
    const { row, child } = mountRow('field-1');
    const { result } = setup();
    const event = mouseEvent(child, { currentTarget: row });

    act(() => result.current.handleNameCellContextMenu(
      event as unknown as React.MouseEvent<HTMLElement>, ROWS[1],
    ));

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(event.nativeEvent.stopImmediatePropagation).toHaveBeenCalled();
  });

  it('leaves an editable target to the browser', () => {
    const { row, child } = mountRow('field-1', 'input');
    const { result } = setup();
    const event = mouseEvent(child, { currentTarget: row });

    act(() => result.current.handleNameCellContextMenu(
      event as unknown as React.MouseEvent<HTMLElement>, ROWS[1],
    ));

    expect(result.current.contextMenuState).toBeNull();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('anchors to the cell when the event carries no coordinates', () => {
    // A keyboard-triggered context menu has no pointer position, so the menu
    // is placed against the cell's own box instead.
    const { row, child } = mountRow('field-1');
    const { result } = setup();
    const event = {
      target: child,
      currentTarget: row,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      nativeEvent: { stopImmediatePropagation: vi.fn() },
    };

    act(() => result.current.handleNameCellContextMenu(
      event as unknown as React.KeyboardEvent<HTMLElement>, ROWS[1],
    ));

    expect(result.current.contextMenuState).toEqual({ row: ROWS[1], mouseX: 492, mouseY: 212 });
  });

  it('anchors to the cell for a 0/0 event, which is how keyboards report', () => {
    // Browsers deliver 0/0 rather than omitting the fields for a keyboard
    // context menu, so the zero pair has to be read as "no pointer" and not
    // as the top-left corner of the screen.
    const { row, child } = mountRow('field-1');
    const { result } = setup();
    const event = mouseEvent(child, { clientX: 0, clientY: 0, currentTarget: row });

    act(() => result.current.handleNameCellContextMenu(
      event as unknown as React.MouseEvent<HTMLElement>, ROWS[1],
    ));

    expect(result.current.contextMenuState).toEqual({ row: ROWS[1], mouseX: 492, mouseY: 212 });
  });

  it('still treats a pointer on one axis only as a real pointer', () => {
    // A click along the very top edge legitimately reports clientY 0.
    const { row, child } = mountRow('field-1');
    const { result } = setup();
    const event = mouseEvent(child, { clientX: 320, clientY: 0, currentTarget: row });

    act(() => result.current.handleNameCellContextMenu(
      event as unknown as React.MouseEvent<HTMLElement>, ROWS[1],
    ));

    expect(result.current.contextMenuState).toEqual({ row: ROWS[1], mouseX: 322, mouseY: -6 });
  });

  it('anchors to the cell when a coordinate is not finite', () => {
    const { row, child } = mountRow('field-1');
    const { result } = setup();
    const event = mouseEvent(child, { clientX: Number.NaN, clientY: 240, currentTarget: row });

    act(() => result.current.handleNameCellContextMenu(
      event as unknown as React.MouseEvent<HTMLElement>, ROWS[1],
    ));

    expect(result.current.contextMenuState).toEqual({ row: ROWS[1], mouseX: 492, mouseY: 212 });
  });

  it('anchors the keyboard fallback to the cell for focus restore too', async () => {
    // The fallback path passes the cell as the menu's origin, which is what
    // focus returns to on close -- a keyboard user who never touched the
    // mouse has to land back on the cell they opened the menu from.
    const { row } = mountRow('field-1');
    const cell = document.createElement('button');
    row.append(cell);
    const { result } = setup();
    const event = {
      target: cell,
      currentTarget: cell,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      nativeEvent: { stopImmediatePropagation: vi.fn() },
    };

    act(() => result.current.handleNameCellContextMenu(
      event as unknown as React.KeyboardEvent<HTMLElement>, ROWS[1],
    ));
    act(() => result.current.closeContextMenu());

    await waitFor(() => expect(document.activeElement).toBe(cell));
  });

  it('opens for the row it is handed without consulting the row list', () => {
    // The name cell renders per row and passes its own; there is no lookup to
    // get wrong, and a row absent from `rows` still opens.
    const { row, child } = mountRow('field-1');
    const { result, setSelectedRowId } = setup({ rows: [] });
    const event = mouseEvent(child, { currentTarget: row });

    act(() => result.current.handleNameCellContextMenu(
      event as unknown as React.MouseEvent<HTMLElement>, ROWS[1],
    ));

    expect(setSelectedRowId).toHaveBeenCalledWith('field-1');
    expect(result.current.contextMenuState?.row).toBe(ROWS[1]);
  });

  it('marks the desktop hint, since the name cell is a mouse path', () => {
    const { row, child } = mountRow('field-1');
    const { result, markContextMenuHintUsed } = setup();

    act(() => result.current.handleNameCellContextMenu(
      mouseEvent(child, { currentTarget: row }) as unknown as React.MouseEvent<HTMLElement>,
      ROWS[1],
    ));

    expect(markContextMenuHintUsed).toHaveBeenCalledTimes(1);
  });
});

describe('handleGridContextMenu', () => {
  it('resolves the row from the DOM and opens beside the pointer', () => {
    const { child } = mountRow('field-1');
    const { result, setSelectedRowId, setTreeActive } = setup();

    act(() => result.current.handleGridContextMenu(
      mouseEvent(child, { clientX: 320, clientY: 240 }) as unknown as React.MouseEvent<HTMLElement>,
    ));

    expect(setSelectedRowId).toHaveBeenCalledWith('field-1');
    expect(setTreeActive).toHaveBeenCalledWith(true);
    expect(result.current.contextMenuState).toEqual({ row: ROWS[1], mouseX: 322, mouseY: 234 });
  });

  it('matches a numeric row id against its string data-id', () => {
    // `data-id` is always a string; the bed's id is a number, so the lookup
    // has to compare them as strings or every bed row falls through.
    const { child } = mountRow(7);
    const { result } = setup();

    act(() => result.current.handleGridContextMenu(
      mouseEvent(child) as unknown as React.MouseEvent<HTMLElement>,
    ));

    expect(result.current.contextMenuState?.row).toBe(ROWS[2]);
  });

  it('leaves an editable target to the browser', () => {
    const { child } = mountRow('field-1', 'input');
    const { result } = setup();
    const event = mouseEvent(child);

    act(() => result.current.handleGridContextMenu(
      event as unknown as React.MouseEvent<HTMLElement>,
    ));

    expect(result.current.contextMenuState).toBeNull();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('does nothing outside a row', () => {
    const outside = document.createElement('div');
    document.body.append(outside);
    const { result, setSelectedRowId } = setup();
    const event = mouseEvent(outside);

    act(() => result.current.handleGridContextMenu(
      event as unknown as React.MouseEvent<HTMLElement>,
    ));

    expect(result.current.contextMenuState).toBeNull();
    expect(setSelectedRowId).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('does nothing for a row the hook no longer has', () => {
    // The handler's own `!rowId` and `!targetRow` guards cannot change this
    // outcome: `isHierarchyContextMenuTarget` above already required both a
    // data-id and a matching row, so by the time they run there is always
    // one. They are defence in depth against the two lookups drifting apart,
    // which is worth keeping -- the second one re-reads the DOM.
    const { child } = mountRow('field-404');
    const { result, setSelectedRowId } = setup();

    act(() => result.current.handleGridContextMenu(
      mouseEvent(child) as unknown as React.MouseEvent<HTMLElement>,
    ));

    expect(result.current.contextMenuState).toBeNull();
    expect(setSelectedRowId).not.toHaveBeenCalled();
  });

  it('suppresses the browser menu on every channel', () => {
    const { child } = mountRow('field-1');
    const { result } = setup();
    const event = mouseEvent(child);

    act(() => result.current.handleGridContextMenu(
      event as unknown as React.MouseEvent<HTMLElement>,
    ));

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(event.nativeEvent.stopImmediatePropagation).toHaveBeenCalled();
  });

  it('marks the desktop hint, since a grid right-click is a mouse path', () => {
    const { child } = mountRow('field-1');
    const { result, markContextMenuHintUsed, markTouchContextMenuHintUsed } = setup();

    act(() => result.current.handleGridContextMenu(
      mouseEvent(child) as unknown as React.MouseEvent<HTMLElement>,
    ));

    expect(markContextMenuHintUsed).toHaveBeenCalledTimes(1);
    expect(markTouchContextMenuHintUsed).not.toHaveBeenCalled();
  });
});

describe('long press on touch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('opens the menu at the finger after the threshold', () => {
    const { child } = mountRow('field-1');
    const { result, setSelectedRowId } = setup();

    act(() => result.current.handleGridTouchStart(
      touchEvent(child) as unknown as React.TouchEvent<HTMLElement>,
    ));
    act(() => { vi.advanceTimersByTime(ROW_LONG_PRESS_MS); });

    expect(setSelectedRowId).toHaveBeenCalledWith('field-1');
    expect(result.current.contextMenuState).toEqual({ row: ROWS[1], mouseX: 60, mouseY: 90 });
  });

  it('opens at the finger itself, with none of the pointer offsets', () => {
    // A mouse menu is nudged clear of the cursor; a finger already covers the
    // spot, so the menu is placed exactly where it was released.
    const { child } = mountRow('field-1');
    const { result } = setup();

    act(() => result.current.handleGridTouchStart(
      touchEvent(child, [{ clientX: 320, clientY: 240 }]) as unknown as React.TouchEvent<HTMLElement>,
    ));
    act(() => { vi.advanceTimersByTime(ROW_LONG_PRESS_MS); });

    expect(result.current.contextMenuState).toMatchObject({ mouseX: 320, mouseY: 240 });
  });

  it('marks the touch hint rather than the desktop one', () => {
    const { child } = mountRow('field-1');
    const { result, markContextMenuHintUsed, markTouchContextMenuHintUsed } = setup();

    act(() => result.current.handleGridTouchStart(
      touchEvent(child) as unknown as React.TouchEvent<HTMLElement>,
    ));
    act(() => { vi.advanceTimersByTime(ROW_LONG_PRESS_MS); });

    expect(markTouchContextMenuHintUsed).toHaveBeenCalledTimes(1);
    expect(markContextMenuHintUsed).not.toHaveBeenCalled();
  });

  it('stays closed one tick before the threshold', () => {
    const { child } = mountRow('field-1');
    const { result } = setup();

    act(() => result.current.handleGridTouchStart(
      touchEvent(child) as unknown as React.TouchEvent<HTMLElement>,
    ));
    act(() => { vi.advanceTimersByTime(ROW_LONG_PRESS_MS - 1); });

    expect(result.current.contextMenuState).toBeNull();
  });

  it('is cancelled by any finger movement, so scrolling never opens it', () => {
    const { child } = mountRow('field-1');
    const { result } = setup();

    act(() => result.current.handleGridTouchStart(
      touchEvent(child) as unknown as React.TouchEvent<HTMLElement>,
    ));
    act(() => result.current.handleGridTouchMove());
    act(() => { vi.advanceTimersByTime(ROW_LONG_PRESS_MS * 2); });

    expect(result.current.contextMenuState).toBeNull();
  });

  it('is cancelled by lifting the finger early', () => {
    const { child } = mountRow('field-1');
    const { result } = setup();

    act(() => result.current.handleGridTouchStart(
      touchEvent(child) as unknown as React.TouchEvent<HTMLElement>,
    ));
    act(() => { vi.advanceTimersByTime(ROW_LONG_PRESS_MS - 1); });
    act(() => result.current.handleGridTouchEnd(
      touchEvent(child) as unknown as React.TouchEvent<HTMLElement>,
    ));
    act(() => { vi.advanceTimersByTime(ROW_LONG_PRESS_MS * 2); });

    expect(result.current.contextMenuState).toBeNull();
  });

  it('leaves a plain tap to the grid, with no click suppression', () => {
    const { child } = mountRow('field-1');
    const { result } = setup();
    const end = touchEvent(child);

    act(() => result.current.handleGridTouchStart(
      touchEvent(child) as unknown as React.TouchEvent<HTMLElement>,
    ));
    act(() => result.current.handleGridTouchEnd(
      end as unknown as React.TouchEvent<HTMLElement>,
    ));

    expect(end.preventDefault).not.toHaveBeenCalled();
  });

  it('suppresses the trailing click once the long press fired', () => {
    // Without this the synthetic click runs the row's own tap action on top
    // of the menu the long press just opened.
    const { child } = mountRow('field-1');
    const { result } = setup();
    const end = touchEvent(child);

    act(() => result.current.handleGridTouchStart(
      touchEvent(child) as unknown as React.TouchEvent<HTMLElement>,
    ));
    act(() => { vi.advanceTimersByTime(ROW_LONG_PRESS_MS); });
    act(() => result.current.handleGridTouchEnd(
      end as unknown as React.TouchEvent<HTMLElement>,
    ));

    expect(end.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('suppresses the trailing click only once', () => {
    // A cancelled touch can deliver both touchend and touchcancel; the second
    // must not swallow the next tap's click.
    const { child } = mountRow('field-1');
    const { result } = setup();
    const second = touchEvent(child);

    act(() => result.current.handleGridTouchStart(
      touchEvent(child) as unknown as React.TouchEvent<HTMLElement>,
    ));
    act(() => { vi.advanceTimersByTime(ROW_LONG_PRESS_MS); });
    act(() => result.current.handleGridTouchEnd(
      touchEvent(child) as unknown as React.TouchEvent<HTMLElement>,
    ));
    act(() => result.current.handleGridTouchEnd(
      second as unknown as React.TouchEvent<HTMLElement>,
    ));

    expect(second.preventDefault).not.toHaveBeenCalled();
  });

  it('does not arm on a two-finger gesture', () => {
    // Two fingers mean pinch-zoom or a two-finger scroll, never a long press.
    const { child } = mountRow('field-1');
    const { result } = setup();

    act(() => result.current.handleGridTouchStart(
      touchEvent(child, []) as unknown as React.TouchEvent<HTMLElement>,
    ));
    act(() => { vi.advanceTimersByTime(ROW_LONG_PRESS_MS * 2); });

    expect(result.current.contextMenuState).toBeNull();
  });

  it('does not arm on an editable target', () => {
    const { child } = mountRow('field-1', 'input');
    const { result } = setup();

    act(() => result.current.handleGridTouchStart(
      touchEvent(child) as unknown as React.TouchEvent<HTMLElement>,
    ));
    act(() => { vi.advanceTimersByTime(ROW_LONG_PRESS_MS * 2); });

    expect(result.current.contextMenuState).toBeNull();
  });

  it('does not arm outside a row', () => {
    const outside = document.createElement('div');
    document.body.append(outside);
    const { result } = setup();

    act(() => result.current.handleGridTouchStart(
      touchEvent(outside) as unknown as React.TouchEvent<HTMLElement>,
    ));
    act(() => { vi.advanceTimersByTime(ROW_LONG_PRESS_MS * 2); });

    expect(result.current.contextMenuState).toBeNull();
  });

  it('does not arm for a row the hook no longer has', () => {
    // Unlike the right-click path, this one never consults
    // `isHierarchyContextMenuTarget`, so the membership check here is the
    // real gate. Its `!rowId` half is still redundant: a missing id makes the
    // `rows.find` miss anyway, and `!targetRow` catches it a line later.
    const { child } = mountRow('field-404');
    const { result } = setup();

    act(() => result.current.handleGridTouchStart(
      touchEvent(child) as unknown as React.TouchEvent<HTMLElement>,
    ));
    act(() => { vi.advanceTimersByTime(ROW_LONG_PRESS_MS * 2); });

    expect(result.current.contextMenuState).toBeNull();
  });

  it('re-arms from scratch when a second press starts', () => {
    // Otherwise the first press's remaining time would open the menu under
    // the second finger, before it has been held long enough.
    const { child } = mountRow('field-1');
    const { result } = setup();

    act(() => result.current.handleGridTouchStart(
      touchEvent(child) as unknown as React.TouchEvent<HTMLElement>,
    ));
    act(() => { vi.advanceTimersByTime(ROW_LONG_PRESS_MS - 50); });
    act(() => result.current.handleGridTouchStart(
      touchEvent(child, [{ clientX: 5, clientY: 6 }]) as unknown as React.TouchEvent<HTMLElement>,
    ));
    act(() => { vi.advanceTimersByTime(50); });
    expect(result.current.contextMenuState).toBeNull();

    act(() => { vi.advanceTimersByTime(ROW_LONG_PRESS_MS - 50); });

    expect(result.current.contextMenuState).toMatchObject({ mouseX: 5, mouseY: 6 });
  });

  it('does not open after the component has gone away', () => {
    const { child } = mountRow('field-1');
    const { result, unmount, setSelectedRowId } = setup();

    act(() => result.current.handleGridTouchStart(
      touchEvent(child) as unknown as React.TouchEvent<HTMLElement>,
    ));
    unmount();
    act(() => { vi.advanceTimersByTime(ROW_LONG_PRESS_MS * 2); });

    expect(setSelectedRowId).not.toHaveBeenCalled();
  });
});

describe('handler identity', () => {
  it('keeps the mouse and keyboard handlers stable while nothing changes', () => {
    // They are spread onto the DataGrid's slot props, so a fresh identity per
    // render re-renders the whole grid.
    const { result, rerender } = setup();
    const before = {
      contextMenu: result.current.handleGridContextMenu,
      nameCell: result.current.handleNameCellContextMenu,
      isTarget: result.current.isHierarchyContextMenuTarget,
      open: result.current.openContextMenuForRow,
    };

    rerender();

    expect(result.current.handleGridContextMenu).toBe(before.contextMenu);
    expect(result.current.handleNameCellContextMenu).toBe(before.nameCell);
    expect(result.current.isHierarchyContextMenuTarget).toBe(before.isTarget);
    expect(result.current.openContextMenuForRow).toBe(before.open);
  });

  it('rebuilds the three touch handlers on every render', () => {
    // Recorded, not endorsed. All three are wrapped in useCallback, but their
    // dependency list contains the object `useLongPressTimer` returns, and
    // that is a fresh literal on each render -- so the memo never holds and
    // the wrappers are rebuilt regardless. The timer's own `start`/`clear`/
    // `endTouch` are each stable; only the container around them is not.
    //
    // Harmless in practice: they go onto DataGrid slot props, which are read
    // per render anyway. Memoizing the shared hook's return would fix all of
    // its callers at once, which is a change to make deliberately rather than
    // fold in here.
    const { result, rerender } = setup();
    const before = {
      touchStart: result.current.handleGridTouchStart,
      touchMove: result.current.handleGridTouchMove,
      touchEnd: result.current.handleGridTouchEnd,
    };

    rerender();

    expect(result.current.handleGridTouchStart).not.toBe(before.touchStart);
    expect(result.current.handleGridTouchMove).not.toBe(before.touchMove);
    expect(result.current.handleGridTouchEnd).not.toBe(before.touchEnd);
  });

  it('keeps the menu state object stable while the menu does not move', () => {
    // It is a prop on the rendered menu; rebuilding it every render would
    // reopen the menu's own transition on every unrelated update.
    const { result, rerender } = setup();
    act(() => result.current.openContextMenuForRow(ROWS[1], 10, 20));
    const before = result.current.contextMenuState;

    rerender();

    expect(result.current.contextMenuState).toBe(before);
  });
});
