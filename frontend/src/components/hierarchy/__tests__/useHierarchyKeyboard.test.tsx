import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef } from 'react';
import type { HierarchyRow } from '../utils/types';
import { useHierarchyKeyboard } from '../hooks/useHierarchyKeyboard';

const ROWS: HierarchyRow[] = [
  { id: 'loc-1', type: 'location', level: 0, name: 'Hofacker', hasChildren: true },
  { id: 'field-1', type: 'field', level: 1, name: 'Parzelle A', hasChildren: true },
  { id: 'bed-1', type: 'bed', level: 2, name: 'Beet 1' },
];

/**
 * The hook reads the selected row's DOM node to place the keyboard context
 * menu and to scroll the row into view, so the rows need real `data-id`
 * elements in the document rather than a stubbed `querySelector`.
 */
const mountRowElements = (rows: readonly HierarchyRow[] = ROWS) => {
  const elements = new Map<string, HTMLElement>();
  rows.forEach((row) => {
    const element = document.createElement('div');
    element.setAttribute('data-id', String(row.id));
    element.scrollIntoView = vi.fn();
    element.getBoundingClientRect = () => ({
      left: 100, top: 200, width: 800, height: 32,
      right: 900, bottom: 232, x: 100, y: 200, toJSON: () => ({}),
    });
    document.body.append(element);
    elements.set(String(row.id), element);
  });
  return elements;
};

interface SetupOptions {
  contextMenuState?: { row: HierarchyRow } | null;
  treeActive?: boolean;
  rows?: HierarchyRow[];
  selectedRowId?: string | number | null;
  expandedRows?: Set<string | number>;
}

const setup = ({
  contextMenuState = null,
  treeActive = true,
  rows = ROWS,
  selectedRowId = 'field-1',
  expandedRows = new Set<string | number>(),
}: SetupOptions = {}) => {
  const treeActiveRef = { current: treeActive };
  const rowsRef = { current: rows as readonly HierarchyRow[] };
  const selectedRowIdRef = { current: selectedRowId };
  const expandedRowsRef = { current: expandedRows };
  const tableWrapper = document.createElement('div');
  document.body.append(tableWrapper);
  const tableWrapperRef = createRef<HTMLDivElement>() as { current: HTMLDivElement | null };
  tableWrapperRef.current = tableWrapper;

  const handlers = {
    activateFirstRow: vi.fn(),
    selectRow: vi.fn(),
    setTreeActive: vi.fn(),
    toggleExpand: vi.fn(),
    discardActiveRowEdit: vi.fn(),
    openContextMenuForRow: vi.fn(),
    onInsertShortcut: vi.fn(),
  };

  const view = renderHook(
    (props: { contextMenuState: { row: HierarchyRow } | null }) => useHierarchyKeyboard({
      contextMenuState: props.contextMenuState,
      treeActiveRef,
      tableWrapperRef,
      rowsRef,
      selectedRowIdRef,
      expandedRowsRef,
      ...handlers,
    }),
    { initialProps: { contextMenuState } },
  );

  return { ...handlers, ...view, treeActiveRef, rowsRef, selectedRowIdRef, expandedRowsRef, tableWrapper };
};

const press = (key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => { window.dispatchEvent(event); });
  return event;
};

const focusEditableElement = (tag: 'input' | 'textarea' = 'input') => {
  const element = document.createElement(tag);
  document.body.append(element);
  element.focus();
  return element;
};

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('Alt+T focus shortcut', () => {
  it('activates the first row and scrolls it into view', () => {
    const elements = mountRowElements();
    const { activateFirstRow } = setup();

    const event = press('t', { altKey: true });

    expect(activateFirstRow).toHaveBeenCalledWith('loc-1');
    expect(elements.get('loc-1')?.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(event.defaultPrevented).toBe(true);
  });

  it('accepts the shifted spelling of the key', () => {
    // Some keyboard layouts and remappers deliver "T" for Alt+t even without
    // shift; the handler explicitly accepts both spellings.
    mountRowElements();
    const { activateFirstRow } = setup();

    press('T', { altKey: true });

    expect(activateFirstRow).toHaveBeenCalledWith('loc-1');
  });

  it('works while the tree is inactive, since its job is to activate it', () => {
    mountRowElements();
    const { activateFirstRow } = setup({ treeActive: false });

    press('t', { altKey: true });

    expect(activateFirstRow).toHaveBeenCalledWith('loc-1');
  });

  it.each([
    ['ctrl', { altKey: true, ctrlKey: true }],
    ['meta', { altKey: true, metaKey: true }],
    ['shift', { altKey: true, shiftKey: true }],
  ])('ignores Alt+T combined with %s', (_name, init) => {
    // Alt+Ctrl+T and Alt+Shift+T are terminal and window-manager shortcuts on
    // several platforms; claiming them would shadow the OS.
    mountRowElements();
    const { activateFirstRow } = setup();

    const event = press('t', init);

    expect(activateFirstRow).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('ignores the bare key without Alt, so typing "t" stays typing', () => {
    mountRowElements();
    const { activateFirstRow } = setup();

    press('t');

    expect(activateFirstRow).not.toHaveBeenCalled();
  });

  it('stays inert while the user is typing in a field', () => {
    mountRowElements();
    const { activateFirstRow } = setup();
    focusEditableElement();

    press('t', { altKey: true });

    expect(activateFirstRow).not.toHaveBeenCalled();
  });

  it('does nothing when the table has no rows at all', () => {
    const { activateFirstRow } = setup({ rows: [] });

    const event = press('t', { altKey: true });

    expect(activateFirstRow).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('survives a first row whose element is not in the DOM', () => {
    // Virtualized grids only render the visible window, so the target row may
    // legitimately have no node yet. Activation must still happen.
    const { activateFirstRow } = setup();

    expect(() => press('t', { altKey: true })).not.toThrow();
    expect(activateFirstRow).toHaveBeenCalledWith('loc-1');
  });

  it('reads the first row at keypress time, not at mount time', () => {
    mountRowElements();
    const { activateFirstRow, rowsRef } = setup();
    rowsRef.current = [{ id: 'loc-9', type: 'location', level: 0 }];

    press('t', { altKey: true });

    expect(activateFirstRow).toHaveBeenCalledWith('loc-9');
  });
});

describe('arrow-key tree navigation', () => {
  it('selects the next row on ArrowDown and scrolls it into view', () => {
    const elements = mountRowElements();
    const { selectRow } = setup();

    const event = press('ArrowDown');

    expect(selectRow).toHaveBeenCalledWith('bed-1');
    expect(elements.get('bed-1')?.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    expect(event.defaultPrevented).toBe(true);
  });

  it('selects the previous row on ArrowUp', () => {
    mountRowElements();
    const { selectRow } = setup();

    press('ArrowUp');

    expect(selectRow).toHaveBeenCalledWith('loc-1');
  });

  it('expands a collapsed parent on ArrowRight', () => {
    mountRowElements();
    const { toggleExpand, selectRow } = setup();

    press('ArrowRight');

    expect(toggleExpand).toHaveBeenCalledWith('field-1');
    expect(selectRow).not.toHaveBeenCalled();
  });

  it('collapses an expanded parent on ArrowLeft', () => {
    mountRowElements();
    const { toggleExpand } = setup({ expandedRows: new Set(['field-1']) });

    press('ArrowLeft');

    expect(toggleExpand).toHaveBeenCalledWith('field-1');
  });

  it('does not scroll or preventDefault when the key maps to no action', () => {
    // ArrowLeft on an already-collapsed row is a no-op, and the page below
    // may want the key.
    const elements = mountRowElements();
    const { toggleExpand, selectRow } = setup();

    const event = press('ArrowLeft');

    expect(toggleExpand).not.toHaveBeenCalled();
    expect(selectRow).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(elements.get('field-1')?.scrollIntoView).not.toHaveBeenCalled();
  });

  it('stays inert while a context menu is open', () => {
    // The menu owns the arrow keys while it is up.
    mountRowElements();
    const { selectRow } = setup({ contextMenuState: { row: ROWS[1] } });

    press('ArrowDown');

    expect(selectRow).not.toHaveBeenCalled();
  });

  it('picks the navigation back up once the context menu closes', () => {
    mountRowElements();
    const { selectRow, rerender } = setup({ contextMenuState: { row: ROWS[1] } });

    rerender({ contextMenuState: null });
    press('ArrowDown');

    expect(selectRow).toHaveBeenCalledWith('bed-1');
  });

  it('stays inert while the tree is not the active surface', () => {
    mountRowElements();
    const { selectRow } = setup({ treeActive: false });

    press('ArrowDown');

    expect(selectRow).not.toHaveBeenCalled();
  });

  it('stays inert with no row selected', () => {
    mountRowElements();
    const { selectRow } = setup({ selectedRowId: null });

    press('ArrowDown');

    expect(selectRow).not.toHaveBeenCalled();
  });

  it('stays inert while the user is typing', () => {
    mountRowElements();
    const { selectRow } = setup();
    focusEditableElement();

    press('ArrowDown');

    expect(selectRow).not.toHaveBeenCalled();
  });

  it.each([
    ['alt', { altKey: true }],
    ['ctrl', { ctrlKey: true }],
    ['meta', { metaKey: true }],
    ['shift', { shiftKey: true }],
  ])('ignores an arrow key held with %s', (_name, init) => {
    // Shift+Arrow is range selection and Ctrl/Meta+Arrow is a browser or OS
    // navigation; none of them mean "move the tree cursor".
    mountRowElements();
    const { selectRow } = setup();

    press('ArrowDown', init);

    expect(selectRow).not.toHaveBeenCalled();
  });

  it('treats a row whose id is 0 as no selection at all', () => {
    // Recorded, not endorsed. Bed rows carry the raw database id, and the
    // guard is `!currentSelectedRowId`, so id 0 reads as "nothing selected"
    // and the arrow keys go dead on that row. Postgres identities start at 1,
    // so no real bed can hit this -- but the same falsy test appears in
    // `useDataGridRowCommands`, and this pins which of the two spellings the
    // hook actually uses.
    const rows: HierarchyRow[] = [
      { id: 0, type: 'bed', level: 2, name: 'Beet 0' },
      { id: 1, type: 'bed', level: 2, name: 'Beet 1' },
    ];
    mountRowElements(rows);
    const { selectRow } = setup({ rows, selectedRowId: 0 });

    press('ArrowDown');

    expect(selectRow).not.toHaveBeenCalled();
  });

  it('navigates normally from a non-zero numeric id', () => {
    // The counterpart to the test above: numeric ids as such are fine, so the
    // dead row really is about 0 being falsy and nothing else.
    const rows: HierarchyRow[] = [
      { id: 1, type: 'bed', level: 2, name: 'Beet 1' },
      { id: 2, type: 'bed', level: 2, name: 'Beet 2' },
    ];
    mountRowElements(rows);
    const { selectRow } = setup({ rows, selectedRowId: 1 });

    press('ArrowDown');

    expect(selectRow).toHaveBeenCalledWith(2);
  });

  it('reads the live selection rather than the one present at mount', () => {
    mountRowElements();
    const { selectRow, selectedRowIdRef } = setup();
    selectedRowIdRef.current = 'loc-1';

    press('ArrowDown');

    expect(selectRow).toHaveBeenCalledWith('field-1');
  });

  it('reads the live expand state rather than the one present at mount', () => {
    mountRowElements();
    const { toggleExpand, expandedRowsRef } = setup();
    expandedRowsRef.current = new Set(['field-1']);

    press('ArrowRight');

    expect(toggleExpand).not.toHaveBeenCalled();
  });
});

describe('Insert shortcut', () => {
  it('runs the row\'s primary create action', () => {
    const { onInsertShortcut } = setup();

    const event = press('Insert');

    expect(onInsertShortcut).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('fires with no row selected, since the tree being active is enough', () => {
    // Unlike navigation, creating does not need a cursor: the page decides
    // what the new row hangs off.
    const { onInsertShortcut } = setup({ selectedRowId: null });

    press('Insert');

    expect(onInsertShortcut).toHaveBeenCalledTimes(1);
  });

  it('stays inert while the tree is not active', () => {
    const { onInsertShortcut } = setup({ treeActive: false });

    const event = press('Insert');

    expect(onInsertShortcut).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('stays inert while the user is typing, so it cannot interrupt an edit', () => {
    const { onInsertShortcut } = setup();
    focusEditableElement('textarea');

    press('Insert');

    expect(onInsertShortcut).not.toHaveBeenCalled();
  });

  it('ignores every other key', () => {
    const { onInsertShortcut } = setup();

    press('Delete');
    press('Enter');

    expect(onInsertShortcut).not.toHaveBeenCalled();
  });

  it('still fires while a context menu is open', () => {
    // Only the arrow navigation defers to the menu; the create shortcut is
    // not part of that effect's guard.
    const { onInsertShortcut } = setup({ contextMenuState: { row: ROWS[1] } });

    press('Insert');

    expect(onInsertShortcut).toHaveBeenCalledTimes(1);
  });
});

describe('keyboard context menu', () => {
  const openers: [string, KeyboardEventInit][] = [
    ['ContextMenu', { key: 'ContextMenu' }],
    ['Shift+F10', { key: 'F10', shiftKey: true }],
  ];

  it.each(openers)('opens the row menu on %s', (_name, init) => {
    mountRowElements();
    const { openContextMenuForRow } = setup();

    const event = press(String(init.key), init);

    expect(openContextMenuForRow).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('anchors the menu inside the row rather than at its far edge', () => {
    // The row is 800px wide; without the 240px cap a keyboard menu on a wide
    // table would open far to the right of the row's own label.
    const elements = mountRowElements();
    const { openContextMenuForRow } = setup();

    press('ContextMenu');

    expect(openContextMenuForRow).toHaveBeenCalledWith(
      ROWS[1], 340, 212, elements.get('field-1'),
    );
  });

  it('uses the row width when the row is narrower than the cap', () => {
    mountRowElements();
    const { openContextMenuForRow } = setup();
    const element = document.querySelector('[data-id="field-1"]') as HTMLElement;
    element.getBoundingClientRect = () => ({
      left: 100, top: 200, width: 60, height: 32,
      right: 160, bottom: 232, x: 100, y: 200, toJSON: () => ({}),
    });

    press('ContextMenu');

    expect(openContextMenuForRow).toHaveBeenCalledWith(ROWS[1], 160, 212, element);
  });

  it('does not open on F10 without shift', () => {
    // Bare F10 is the browser's own menu-bar key.
    mountRowElements();
    const { openContextMenuForRow } = setup();

    const event = press('F10');

    expect(openContextMenuForRow).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('stays inert while the tree is not active', () => {
    mountRowElements();
    const { openContextMenuForRow } = setup({ treeActive: false });

    press('ContextMenu');

    expect(openContextMenuForRow).not.toHaveBeenCalled();
  });

  it('stays inert with no row selected', () => {
    mountRowElements();
    const { openContextMenuForRow } = setup({ selectedRowId: null });

    press('ContextMenu');

    expect(openContextMenuForRow).not.toHaveBeenCalled();
  });

  it('stays inert while the user is typing', () => {
    mountRowElements();
    const { openContextMenuForRow } = setup();
    focusEditableElement();

    press('ContextMenu');

    expect(openContextMenuForRow).not.toHaveBeenCalled();
  });

  it('does nothing when the selected id matches no row', () => {
    mountRowElements();
    const { openContextMenuForRow } = setup({ selectedRowId: 'bed-404' });

    const event = press('ContextMenu');

    expect(openContextMenuForRow).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('opens no menu when the selected row has no rendered element', () => {
    // The row exists in the model but is outside the virtualized window, so
    // there is no rectangle to anchor the menu to.
    //
    // The key is still swallowed here, unlike the unknown-id case above: the
    // handler calls preventDefault before it looks the element up, so it has
    // already committed to handling the press by the time it finds nothing to
    // anchor to. Pinned as-is rather than changed -- the outcome the user sees
    // is the same either way, since the browser's own context menu would have
    // had no row to target either.
    const { openContextMenuForRow } = setup();

    const event = press('ContextMenu');

    expect(openContextMenuForRow).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('also treats a row whose id is 0 as no selection', () => {
    // Same falsy guard as the navigation effect, so the keyboard context menu
    // goes dead on that row too. Both effects agree, which is the point of
    // pinning it in both places.
    const rows: HierarchyRow[] = [{ id: 0, type: 'bed', level: 2, name: 'Beet 0' }];
    mountRowElements(rows);
    const { openContextMenuForRow } = setup({ rows, selectedRowId: 0 });

    press('ContextMenu');

    expect(openContextMenuForRow).not.toHaveBeenCalled();
  });

  it('passes the row object itself, not just its id', () => {
    // The menu builds its entries from the row type (Standort/Parzelle/Beet).
    mountRowElements();
    const { openContextMenuForRow, selectedRowIdRef } = setup();
    selectedRowIdRef.current = 'bed-1';

    press('ContextMenu');

    expect(openContextMenuForRow.mock.calls[0][0]).toBe(ROWS[2]);
  });
});

describe('pointer outside the table', () => {
  it.each(['mousedown', 'touchstart'])('discards the open edit on %s elsewhere', (type) => {
    const { discardActiveRowEdit, setTreeActive } = setup();
    const outside = document.createElement('button');
    document.body.append(outside);

    act(() => { outside.dispatchEvent(new Event(type, { bubbles: true })); });

    expect(discardActiveRowEdit).toHaveBeenCalledTimes(1);
    expect(setTreeActive).toHaveBeenCalledWith(false);
  });

  it.each(['mousedown', 'touchstart'])('leaves the table alone on %s inside it', (type) => {
    const { discardActiveRowEdit, setTreeActive, tableWrapper } = setup();
    const inside = document.createElement('span');
    tableWrapper.append(inside);

    act(() => { inside.dispatchEvent(new Event(type, { bubbles: true })); });

    expect(discardActiveRowEdit).not.toHaveBeenCalled();
    expect(setTreeActive).not.toHaveBeenCalled();
  });

  it('treats a pointer down with no mounted wrapper as outside', () => {
    const { discardActiveRowEdit } = setup();

    act(() => { document.body.dispatchEvent(new Event('mousedown', { bubbles: true })); });

    expect(discardActiveRowEdit).toHaveBeenCalledTimes(1);
  });
});

describe('listener lifecycle', () => {
  it('removes every listener on unmount', () => {
    mountRowElements();
    const { unmount, activateFirstRow, selectRow, onInsertShortcut, openContextMenuForRow, discardActiveRowEdit } = setup();

    unmount();
    press('t', { altKey: true });
    press('ArrowDown');
    press('Insert');
    press('ContextMenu');
    act(() => { document.body.dispatchEvent(new Event('mousedown', { bubbles: true })); });

    expect(activateFirstRow).not.toHaveBeenCalled();
    expect(selectRow).not.toHaveBeenCalled();
    expect(onInsertShortcut).not.toHaveBeenCalled();
    expect(openContextMenuForRow).not.toHaveBeenCalled();
    expect(discardActiveRowEdit).not.toHaveBeenCalled();
  });

  it('does not stack duplicate handlers when the context menu state changes', () => {
    // Re-subscribing without cleaning up would run the navigation twice per
    // keypress and skip a row.
    mountRowElements();
    const { selectRow, rerender } = setup();

    rerender({ contextMenuState: { row: ROWS[1] } });
    rerender({ contextMenuState: null });
    press('ArrowDown');

    expect(selectRow).toHaveBeenCalledTimes(1);
  });
});
