import { describe, expect, it, vi } from 'vitest';
import {
  focusKeyboardNavigableCell,
  getCellLocationFromDomTarget,
  getHorizontalKeyboardNavigationTarget,
  getKeyboardNavigationTarget,
  getVerticalKeyboardNavigationTarget,
  getViewModeNavigationRequest,
  getVisibleColumnIndex,
  isCellKeyboardNavigable,
  isInteractiveCellTarget,
  preventReadOnlyCellMouseFocus,
  resolveFocusedCellFromEvent,
  scrollCellIntoView,
} from '../components/data-grid/keyboardNavigation';

function buildGridCell(rowId: string, field: string): HTMLElement {
  const row = document.createElement('div');
  row.setAttribute('role', 'row');
  row.dataset.id = rowId;
  const cell = document.createElement('div');
  cell.setAttribute('role', 'gridcell');
  cell.dataset.field = field;
  row.append(cell);
  return cell;
}

describe('keyboardNavigation', () => {
  it('focuses the edit input inside a focused editable cell', () => {
    const cellElement = document.createElement('div');
    const input = document.createElement('input');
    cellElement.append(input);
    document.body.append(cellElement);

    const api = {
      getCellElement: vi.fn(() => cellElement),
      getVisibleColumns: vi.fn(() => [{ field: 'name' }, { field: 'width_m' }]),
      getRowIndexRelativeToVisibleRows: vi.fn(() => 0),
      scrollToIndexes: vi.fn(),
      setCellFocus: vi.fn(),
    };

    focusKeyboardNavigableCell({
      api,
      cell: { id: 1, field: 'width_m' },
      focusEditInput: true,
    });

    expect(api.scrollToIndexes).toHaveBeenCalledWith({ rowIndex: 0, colIndex: 1 });
    expect(api.setCellFocus).toHaveBeenCalledWith(1, 'width_m');
    expect(document.activeElement).toBe(input);

    cellElement.remove();
  });

  it('uses local row and column fallbacks when live grid metadata is incomplete during edit mode', () => {
    const row = { id: 5, planting_date: '2026-04-10', area_m2: 2 };
    const api = {
      getAllRowIds: vi.fn(() => [5]),
      getCellParams: vi.fn((id: number, field: string) => ({ id, field, row: undefined })),
      getVisibleColumns: vi.fn(() => [
        { field: 'planting_date', editable: true },
        { field: 'area_m2' },
      ]),
    };

    expect(isCellKeyboardNavigable({
      api,
      columns: [
        { field: 'planting_date', editable: true },
        { field: 'area_m2', editable: true },
      ],
      field: 'area_m2',
      row,
      rowId: 5,
    })).toBe(true);

    expect(getKeyboardNavigationTarget({
      api,
      columns: [
        { field: 'planting_date', editable: true },
        { field: 'area_m2', editable: true },
      ],
      current: { id: 5, field: 'planting_date' },
      direction: 1,
      rows: [row],
    })).toEqual({ id: 5, field: 'area_m2' });
  });
});

describe('getCellLocationFromDomTarget', () => {
  it('resolves a cell and parses a numeric row id', () => {
    const cell = buildGridCell('42', 'name');

    expect(getCellLocationFromDomTarget(cell)).toEqual({ id: 42, field: 'name' });
  });

  it('keeps a non-numeric row id as a string', () => {
    const cell = buildGridCell('draft-1', 'name');

    expect(getCellLocationFromDomTarget(cell)).toEqual({ id: 'draft-1', field: 'name' });
  });

  it('returns null for targets outside a grid cell', () => {
    expect(getCellLocationFromDomTarget(null)).toBeNull();
    expect(getCellLocationFromDomTarget(document.createElement('span'))).toBeNull();
  });
});

describe('getHorizontalKeyboardNavigationTarget', () => {
  const fields = ['name', 'width_m', 'notes'];

  it('moves to the next field when navigating forward', () => {
    expect(getHorizontalKeyboardNavigationTarget(fields, 5, 'name', 1)).toEqual({
      id: 5,
      field: 'width_m',
    });
  });

  it('moves to the previous field when navigating backward', () => {
    expect(getHorizontalKeyboardNavigationTarget(fields, 5, 'width_m', -1)).toEqual({
      id: 5,
      field: 'name',
    });
  });

  it('returns null at the row edges', () => {
    expect(getHorizontalKeyboardNavigationTarget(fields, 5, 'notes', 1)).toBeNull();
    expect(getHorizontalKeyboardNavigationTarget(fields, 5, 'name', -1)).toBeNull();
  });

  it('returns null when the current field is not navigable', () => {
    expect(getHorizontalKeyboardNavigationTarget(fields, 5, 'unknown', 1)).toBeNull();
  });
});

describe('scrollCellIntoView', () => {
  // Mirrors MUI's own `scrollToIndexes`, which indexes into the *visible*
  // column definitions: an index that counts hidden columns too silently
  // scrolls to the wrong column and throws once it runs past the visible
  // count. Passing that index used to abort Tab navigation for good (below
  // the `lg` breakpoint the planting plans grid hides both harvest-date
  // columns, so Tab out of "Pflanzdatum" reached "Fläche" and then stopped
  // short of "Pflanzen").
  const createApiWithHiddenColumns = () => {
    const visibleColumns = [
      { field: 'crop' },
      { field: 'planting_date' },
      { field: 'area_m2' },
      { field: 'plants_count' },
    ];
    return {
      visibleColumns,
      getVisibleColumns: vi.fn(() => visibleColumns),
      getRowIndexRelativeToVisibleRows: vi.fn(() => 3),
      scrollToIndexes: vi.fn((indexes: { rowIndex?: number; colIndex?: number }) => {
        if (indexes.colIndex !== undefined) {
          // Throws exactly like MUI does on `visibleColumns[colIndex].computedWidth`.
          expect(visibleColumns[indexes.colIndex]).toBeDefined();
        }
      }),
      setCellFocus: vi.fn(),
    };
  };

  it('resolves the column index against the visible columns, not the hidden ones', () => {
    const api = createApiWithHiddenColumns();

    scrollCellIntoView(api, { id: 10, field: 'plants_count' });

    expect(api.scrollToIndexes).toHaveBeenCalledWith({ rowIndex: 3, colIndex: 3 });
  });

  it('skips the column axis for a hidden field instead of scrolling out of range', () => {
    const api = createApiWithHiddenColumns();

    scrollCellIntoView(api, { id: 10, field: 'harvest_end_date' });

    expect(api.scrollToIndexes).toHaveBeenCalledWith({ rowIndex: 3 });
  });

  it('does not scroll at all when neither axis resolves', () => {
    const api = createApiWithHiddenColumns();
    api.getRowIndexRelativeToVisibleRows.mockReturnValue(-1);

    scrollCellIntoView(api, { id: 999, field: 'harvest_end_date' });

    expect(api.scrollToIndexes).not.toHaveBeenCalled();
  });

  it('keeps focusing a cell behind hidden columns instead of throwing', () => {
    const api = createApiWithHiddenColumns();

    expect(() =>
      focusKeyboardNavigableCell({ api, cell: { id: 10, field: 'plants_count' } }),
    ).not.toThrow();
    expect(api.setCellFocus).toHaveBeenCalledWith(10, 'plants_count');
  });
});

describe('getVisibleColumnIndex', () => {
  const api = {
    getVisibleColumns: vi.fn(() => [{ field: 'name' }, { field: 'area_m2' }]),
  };

  it('returns the index within the visible columns', () => {
    expect(getVisibleColumnIndex(api, 'area_m2')).toBe(1);
  });

  it('returns undefined for a hidden field and for a missing grid API', () => {
    expect(getVisibleColumnIndex(api, 'harvest_date')).toBeUndefined();
    expect(getVisibleColumnIndex(null, 'name')).toBeUndefined();
    expect(getVisibleColumnIndex({}, 'name')).toBeUndefined();
  });
});

describe('getViewModeNavigationRequest', () => {
  it('wraps rows and follows shift for Tab', () => {
    expect(getViewModeNavigationRequest('Tab', false)).toEqual({
      axis: 'horizontal',
      direction: 1,
      wrapRows: true,
    });
    expect(getViewModeNavigationRequest('Tab', true)).toEqual({
      axis: 'horizontal',
      direction: -1,
      wrapRows: true,
    });
  });

  it('maps arrow keys to axis and direction without row wrapping', () => {
    expect(getViewModeNavigationRequest('ArrowRight', false)).toEqual({
      axis: 'horizontal',
      direction: 1,
      wrapRows: false,
    });
    expect(getViewModeNavigationRequest('ArrowLeft', false)).toEqual({
      axis: 'horizontal',
      direction: -1,
      wrapRows: false,
    });
    expect(getViewModeNavigationRequest('ArrowDown', false)).toEqual({
      axis: 'vertical',
      direction: 1,
      wrapRows: false,
    });
    expect(getViewModeNavigationRequest('ArrowUp', false)).toEqual({
      axis: 'vertical',
      direction: -1,
      wrapRows: false,
    });
  });

  it('ignores shift for arrow keys and returns null for other keys', () => {
    expect(getViewModeNavigationRequest('ArrowRight', true)).toEqual({
      axis: 'horizontal',
      direction: 1,
      wrapRows: false,
    });
    expect(getViewModeNavigationRequest('Enter', false)).toBeNull();
    expect(getViewModeNavigationRequest('a', false)).toBeNull();
  });
});

describe('resolveFocusedCellFromEvent', () => {
  it('prefers the grid focus state when a cell is tracked', () => {
    const api = { state: { focus: { cell: { id: 7, field: 'width_m' } } } };

    const result = resolveFocusedCellFromEvent(api, { target: null });

    expect(result).toEqual({ id: 7, field: 'width_m' });
  });

  it('falls back to the event target DOM when no cell is tracked', () => {
    const cell = buildGridCell('42', 'name');

    expect(resolveFocusedCellFromEvent(null, { target: cell })).toEqual({
      id: 42,
      field: 'name',
    });
  });

  it('returns null when the target is not resolvable to a cell', () => {
    expect(resolveFocusedCellFromEvent(null, { target: null })).toBeNull();
    expect(
      resolveFocusedCellFromEvent(undefined, { target: document.createElement('span') }),
    ).toBeNull();
  });
});

type Col = { field: string; editable?: boolean; isCellEditable?: (params: unknown) => boolean };

const COLUMNS: Col[] = [
  { field: 'name', editable: true },
  { field: 'width_m', editable: true },
  { field: 'notes', editable: true },
];

const ROWS = [{ id: 1 }, { id: 2 }, { id: 3 }];

const gridApi = (columns: Col[] = COLUMNS, rows = ROWS) => ({
  getAllRowIds: vi.fn(() => rows.map((row) => row.id)),
  getVisibleColumns: vi.fn(() => columns),
  getCellParams: vi.fn((id: unknown, field: string) => ({ id, field, row: { id } })),
});

describe('isCellKeyboardNavigable', () => {
  it('skips the action columns, whatever they claim about editability', () => {
    // Landing on the row-action buttons with Tab would trap the user between
    // two icon buttons instead of moving them to the next editable value.
    ['actions', 'rowEditActions'].forEach((field) => {
      expect(isCellKeyboardNavigable({
        api: gridApi([{ field, editable: true }]),
        field,
        rowId: 1,
      })).toBe(false);
    });
  });

  it('refuses a field that is not a column at all', () => {
    expect(isCellKeyboardNavigable({
      api: gridApi(),
      field: 'nope',
      rowId: 1,
    })).toBe(false);
  });

  it('refuses a read-only column', () => {
    expect(isCellKeyboardNavigable({
      api: gridApi([{ field: 'name' }]),
      field: 'name',
      rowId: 1,
    })).toBe(false);
  });

  it('accepts an action cell even though its column is read-only', () => {
    // isActionCell is checked before editability, so a button cell stays
    // reachable without being made editable.
    expect(isCellKeyboardNavigable({
      api: gridApi([{ field: 'open' }]),
      field: 'open',
      isActionCell: () => true,
      rowId: 1,
    })).toBe(true);
  });

  it('honours a column that declares a specific cell uneditable', () => {
    expect(isCellKeyboardNavigable({
      api: gridApi([{ field: 'name', editable: true, isCellEditable: () => false }]),
      field: 'name',
      rowId: 1,
    })).toBe(false);
  });

  it('treats a column with no isCellEditable as editable throughout', () => {
    expect(isCellKeyboardNavigable({
      api: gridApi([{ field: 'name', editable: true }]),
      field: 'name',
      rowId: 1,
    })).toBe(true);
  });

  it('refuses the cell when isCellEditable throws rather than letting it escape', () => {
    // This runs inside a keydown handler; an exception here would break the
    // whole key press, not just this candidate.
    expect(isCellKeyboardNavigable({
      api: gridApi([{
        field: 'name',
        editable: true,
        isCellEditable: () => { throw new Error('row not loaded'); },
      }]),
      field: 'name',
      rowId: 1,
    })).toBe(false);
  });

  it('falls back to the local row when getCellParams throws', () => {
    const api = {
      ...gridApi(),
      getCellParams: vi.fn(() => { throw new Error('unknown row'); }),
    };

    expect(isCellKeyboardNavigable({
      api, field: 'name', row: { id: 1 }, rowId: 1,
    })).toBe(true);
  });

  it('gives up when getCellParams throws and there is no local row either', () => {
    // The early `if (!row) return false` inside the catch is redundant: without
    // it the fallback params carry `row: undefined`, which the shared
    // `!params.row` guard just below rejects for the same result. Asserted as
    // the outcome, not as evidence that the early return does work of its own.
    const api = {
      ...gridApi(),
      getCellParams: vi.fn(() => { throw new Error('unknown row'); }),
    };

    expect(isCellKeyboardNavigable({ api, field: 'name', rowId: 1 })).toBe(false);
  });

  it('refuses a cell whose params carry no row', () => {
    const api = {
      ...gridApi(),
      getCellParams: vi.fn((id: unknown, field: string) => ({ id, field, row: undefined })),
    };

    expect(isCellKeyboardNavigable({ api, field: 'name', rowId: 1 })).toBe(false);
  });

  it('keeps the local column isCellEditable when the visible column has none', () => {
    // The visible columns come from MUI and can be missing the predicate the
    // page defined; getColumns merges the two rather than taking one wholesale.
    const api = {
      ...gridApi([{ field: 'name', editable: true }]),
    };

    expect(isCellKeyboardNavigable({
      api,
      columns: [{ field: 'name', editable: true, isCellEditable: () => false }],
      field: 'name',
      rowId: 1,
    })).toBe(false);
  });
});

describe('getKeyboardNavigationTarget', () => {
  const target = (current: { id: number; field: string }, direction: 1 | -1, options = {}) =>
    getKeyboardNavigationTarget({
      api: gridApi(), columns: COLUMNS, current, direction, rows: ROWS, ...options,
    });

  it('moves to the next navigable column in the same row', () => {
    expect(target({ id: 2, field: 'name' }, 1)).toEqual({ id: 2, field: 'width_m' });
  });

  it('moves backwards too', () => {
    expect(target({ id: 2, field: 'notes' }, -1)).toEqual({ id: 2, field: 'width_m' });
  });

  it('skips a read-only column rather than stopping on it', () => {
    const columns: Col[] = [
      { field: 'name', editable: true },
      { field: 'width_m' },
      { field: 'notes', editable: true },
    ];
    expect(getKeyboardNavigationTarget({
      api: gridApi(columns), columns, current: { id: 2, field: 'name' }, direction: 1, rows: ROWS,
    })).toEqual({ id: 2, field: 'notes' });
  });

  it('stops at the row edge when wrapping is off', () => {
    expect(target({ id: 2, field: 'notes' }, 1)).toBeNull();
    expect(target({ id: 2, field: 'name' }, -1)).toBeNull();
  });

  it('wraps to the first column of the next row when asked', () => {
    expect(target({ id: 2, field: 'notes' }, 1, { wrapRows: true }))
      .toEqual({ id: 3, field: 'name' });
  });

  it('wraps backwards to the last column of the previous row', () => {
    expect(target({ id: 2, field: 'name' }, -1, { wrapRows: true }))
      .toEqual({ id: 1, field: 'notes' });
  });

  it('stops at the grid edge even when wrapping is on', () => {
    expect(target({ id: 3, field: 'notes' }, 1, { wrapRows: true })).toBeNull();
    expect(target({ id: 1, field: 'name' }, -1, { wrapRows: true })).toBeNull();
  });

  it('returns nothing for a row or field that is not in the grid', () => {
    expect(target({ id: 99, field: 'name' }, 1)).toBeNull();
    expect(target({ id: 2, field: 'nope' }, 1)).toBeNull();
  });

  it('compares row ids as strings, since the grid and the rows can disagree on type', () => {
    expect(getKeyboardNavigationTarget({
      api: { ...gridApi(), getAllRowIds: vi.fn(() => ['2']) },
      columns: COLUMNS,
      current: { id: 2, field: 'name' },
      direction: 1,
      rows: ROWS,
    })).toEqual({ id: '2', field: 'width_m' });
  });
});

describe('getVerticalKeyboardNavigationTarget', () => {
  const down = (current: { id: number; field: string }, columns = COLUMNS, rows = ROWS) =>
    getVerticalKeyboardNavigationTarget({
      api: gridApi(columns, rows), columns, current, direction: 1, rows,
    });

  it('keeps the same column when moving down', () => {
    expect(down({ id: 1, field: 'width_m' })).toEqual({ id: 2, field: 'width_m' });
  });

  it('moves up as well', () => {
    expect(getVerticalKeyboardNavigationTarget({
      api: gridApi(), columns: COLUMNS, current: { id: 3, field: 'width_m' }, direction: -1, rows: ROWS,
    })).toEqual({ id: 2, field: 'width_m' });
  });

  it('stops at the last row', () => {
    expect(down({ id: 3, field: 'width_m' })).toBeNull();
  });

  it('returns nothing for a row that is not in the grid', () => {
    expect(down({ id: 99, field: 'width_m' })).toBeNull();
  });

  it('searches sideways, right first, when the cell below is not navigable', () => {
    // The middle column is editable in general but not on row 2, so the
    // straight-down candidate is refused. Both neighbours are navigable and
    // exactly one step away, so landing on 'notes' can only mean the right-hand
    // side is tried first — matching the direction Tab moves.
    const columns: Col[] = [
      { field: 'name', editable: true },
      { field: 'width_m', editable: true, isCellEditable: (params) => (params as { id: number }).id !== 2 },
      { field: 'notes', editable: true },
    ];
    expect(down({ id: 1, field: 'width_m' }, columns)).toEqual({ id: 2, field: 'notes' });
  });

  it('falls back to the left when nothing to the right is navigable', () => {
    const columns: Col[] = [
      { field: 'name', editable: true },
      { field: 'width_m', editable: true, isCellEditable: (params) => (params as { id: number }).id !== 2 },
      { field: 'notes' },
    ];
    expect(down({ id: 1, field: 'width_m' }, columns)).toEqual({ id: 2, field: 'name' });
  });

  it('skips a wholly unnavigable row and lands on the next one', () => {
    const columns: Col[] = [
      { field: 'name', editable: true, isCellEditable: (params) => (params as { id: number }).id !== 2 },
      { field: 'width_m', editable: true, isCellEditable: (params) => (params as { id: number }).id !== 2 },
      { field: 'notes', editable: true, isCellEditable: (params) => (params as { id: number }).id !== 2 },
    ];
    expect(down({ id: 1, field: 'name' }, columns)).toEqual({ id: 3, field: 'name' });
  });
});

describe('isInteractiveCellTarget', () => {
  it.each([
    ['a link', '<a href="#x">x</a>'],
    ['a button', '<button>x</button>'],
    ['an input', '<input />'],
    ['a select', '<select></select>'],
    ['a textarea', '<textarea></textarea>'],
    ['an ARIA button', '<span role="button">x</span>'],
    ['a menu item', '<span role="menuitem">x</span>'],
    ['a tabbable element', '<span tabindex="0">x</span>'],
  ])('recognises %s', (_label, html) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    expect(isInteractiveCellTarget(host.firstElementChild)).toBe(true);
  });

  it('recognises an element nested inside an interactive one', () => {
    // A click usually lands on the icon inside a button, not the button.
    const host = document.createElement('div');
    host.innerHTML = '<button><span>x</span></button>';
    expect(isInteractiveCellTarget(host.querySelector('span'))).toBe(true);
  });

  it('does not treat an explicitly untabbable element as interactive', () => {
    const host = document.createElement('div');
    host.innerHTML = '<span tabindex="-1">x</span>';
    expect(isInteractiveCellTarget(host.firstElementChild)).toBe(false);
  });

  it('says no for plain text and for nothing at all', () => {
    expect(isInteractiveCellTarget(document.createElement('span'))).toBe(false);
    expect(isInteractiveCellTarget(null)).toBe(false);
    expect(isInteractiveCellTarget(new EventTarget())).toBe(false);
  });

  it('does not recognise an SVG icon inside a button', () => {
    // `instanceof HTMLElement` is false for SVG elements, so an icon — which is
    // what a MUI button renders and what a click actually targets — is rejected
    // even though `closest('button')` would find the button.
    //
    // This cannot bite today: both callers (DataGrid.handleReadOnlyCellMouseDown
    // and FieldsBedsHierarchy.handleReadOnlyHierarchyCellMouseDown) return early
    // on the same `instanceof HTMLElement` check before ever calling this, so an
    // SVG target takes the same no-op path either way. Recorded as the current
    // behaviour so that a future caller without that guard is not surprised.
    const host = document.createElement('div');
    host.innerHTML = '<button><svg><path d="M0 0" /></svg></button>';
    const icon = host.querySelector('path');

    expect(icon?.closest('button')).not.toBeNull();
    expect(isInteractiveCellTarget(icon)).toBe(false);
  });
});

describe('preventReadOnlyCellMouseFocus', () => {
  it('stops both the default action and the propagation', () => {
    // Only preventing the default would still let the grid's own click handler
    // move focus into the read-only cell.
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    preventReadOnlyCellMouseFocus({ preventDefault, stopPropagation } as never);

    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
  });
});
