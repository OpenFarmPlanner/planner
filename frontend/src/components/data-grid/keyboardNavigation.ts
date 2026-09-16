import type {
  GridCellParams,
  GridColDef,
  GridRowId,
  GridValidRowModel,
} from '@mui/x-data-grid';
import type { MouseEvent } from 'react';

type Direction = 1 | -1;

interface CellLocation {
  id: GridRowId;
  field: string;
}

interface DataGridNavigationApi<Row extends GridValidRowModel> {
  getAllRowIds?: () => GridRowId[];
  getCellElement?: (id: GridRowId, field: string) => HTMLElement | null;
  getCellParams?: (id: GridRowId, field: string) => GridCellParams<Row>;
  getRowIndexRelativeToVisibleRows?: (id: GridRowId) => number;
  getVisibleColumns?: () => GridColDef<Row>[];
  scrollToIndexes?: (indexes: { rowIndex?: number; colIndex?: number }) => void;
  setCellFocus?: (id: GridRowId, field: string) => void;
}

type KeyboardNavigationColumn<Row extends GridValidRowModel> = GridColDef<Row> & {
  isCellEditable?: (params: GridCellParams<Row>) => boolean;
};

interface IsCellKeyboardNavigableOptions<Row extends GridValidRowModel> {
  api: DataGridNavigationApi<Row> | null | undefined;
  columns?: readonly GridColDef<Row>[];
  field: string;
  isActionCell?: (params: GridCellParams<Row>) => boolean;
  row?: Row;
  rowId: GridRowId;
}

interface GetKeyboardNavigationTargetOptions<Row extends GridValidRowModel> {
  api: DataGridNavigationApi<Row> | null | undefined;
  columns?: readonly GridColDef<Row>[];
  current: CellLocation;
  direction: Direction;
  isActionCell?: (params: GridCellParams<Row>) => boolean;
  rows?: readonly Row[];
  wrapRows?: boolean;
}

interface FocusKeyboardNavigableCellOptions<Row extends GridValidRowModel> {
  api: DataGridNavigationApi<Row> | null | undefined;
  cell: CellLocation;
  focusEditInput?: boolean;
}

const IGNORED_NAVIGATION_FIELDS = new Set(['actions', 'rowEditActions']);
export const EDIT_CELL_FOCUS_TARGET_SELECTOR = [
  'input:not([type="hidden"]):not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[role="textbox"]:not([aria-disabled="true"])',
  '[role="combobox"]:not([aria-disabled="true"])',
  '.MuiSelect-select[tabindex]:not([tabindex="-1"])',
].join(', ');
const INTERACTIVE_CELL_TARGET_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  '[role="button"]',
  '[role="menuitem"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

const getColumns = <Row extends GridValidRowModel>(
  api: DataGridNavigationApi<Row> | null | undefined,
  fallbackColumns: readonly GridColDef<Row>[] = [],
): readonly GridColDef<Row>[] => {
  const visibleColumns = api?.getVisibleColumns?.();
  if (!visibleColumns || fallbackColumns.length === 0) {
    return visibleColumns ?? fallbackColumns;
  }

  const fallbackByField = new Map(fallbackColumns.map((column) => [column.field, column]));
  return visibleColumns.map((column) => {
    const fallback = fallbackByField.get(column.field);
    if (!fallback) {
      return column;
    }

    const fallbackNavigationColumn = fallback as KeyboardNavigationColumn<Row>;
    const visibleNavigationColumn = column as KeyboardNavigationColumn<Row>;
    return {
      ...fallback,
      ...column,
      isCellEditable: visibleNavigationColumn.isCellEditable ?? fallbackNavigationColumn.isCellEditable,
    };
  });
};

const getRowIds = <Row extends GridValidRowModel>(
  api: DataGridNavigationApi<Row> | null | undefined,
  fallbackRows: readonly Row[] = [],
): readonly GridRowId[] => api?.getAllRowIds?.() ?? fallbackRows.map((row) => row.id as GridRowId);

export function isCellKeyboardNavigable<Row extends GridValidRowModel>({
  api,
  columns = [],
  field,
  isActionCell,
  row,
  rowId,
}: IsCellKeyboardNavigableOptions<Row>): boolean {
  const column = getColumns(api, columns).find((currentColumn) => currentColumn.field === field);
  if (!column || IGNORED_NAVIGATION_FIELDS.has(field)) {
    return false;
  }

  let params: GridCellParams<Row>;
  try {
    params = (api?.getCellParams?.(rowId, field) ?? {
      id: rowId,
      field,
      row,
    }) as GridCellParams<Row>;
    if (!params.row && row) {
      params = { ...params, row };
    }
  } catch {
    if (!row) {
      return false;
    }
    params = {
      id: rowId,
      field,
      row,
    } as GridCellParams<Row>;
  }

  if (!params || !params.row) {
    return false;
  }

  if (isActionCell?.(params)) {
    return true;
  }

  if (!column.editable) {
    return false;
  }

  try {
    return (column as KeyboardNavigationColumn<Row>).isCellEditable?.(params) ?? true;
  } catch {
    return false;
  }
}

export function getKeyboardNavigationTarget<Row extends GridValidRowModel>({
  api,
  columns = [],
  current,
  direction,
  isActionCell,
  rows = [],
  wrapRows = false,
}: GetKeyboardNavigationTargetOptions<Row>): CellLocation | null {
  const visibleColumns = getColumns(api, columns);
  const rowIds = getRowIds(api, rows);
  const currentRowIndex = rowIds.findIndex((rowId) => String(rowId) === String(current.id));
  const currentColumnIndex = visibleColumns.findIndex((column) => column.field === current.field);
  if (currentRowIndex < 0 || currentColumnIndex < 0) {
    return null;
  }

  let rowIndex = currentRowIndex;
  let columnIndex = currentColumnIndex + direction;

  while (rowIndex >= 0 && rowIndex < rowIds.length) {
    while (columnIndex >= 0 && columnIndex < visibleColumns.length) {
      const candidate = {
        id: rowIds[rowIndex],
        field: visibleColumns[columnIndex].field,
      };
      const row = rows.find((currentRow) => String(currentRow.id) === String(candidate.id));
      if (isCellKeyboardNavigable({
        api,
        columns: visibleColumns,
        field: candidate.field,
        isActionCell,
        row,
        rowId: candidate.id,
      })) {
        return candidate;
      }
      columnIndex += direction;
    }

    if (!wrapRows) {
      return null;
    }

    rowIndex += direction;
    columnIndex = direction > 0 ? 0 : visibleColumns.length - 1;
  }

  return null;
}

/**
 * Shared by the single-step vertical arrow-key search and the page-sized
 * Home/End/PageUp/PageDown searches below: starting at `startRowIndex`,
 * looks for a navigable cell in `field`'s column, and — when that row's own
 * cell in that column isn't navigable — falls back to the nearest navigable
 * column in the same row before continuing to the next row in `direction`.
 * Pure function of its arguments.
 */
function findNavigableRowCell<Row extends GridValidRowModel>(
  api: DataGridNavigationApi<Row> | null | undefined,
  visibleColumns: readonly GridColDef<Row>[],
  rowIds: readonly GridRowId[],
  rows: readonly Row[],
  startRowIndex: number,
  direction: Direction,
  field: string,
  isActionCell?: (params: GridCellParams<Row>) => boolean,
): CellLocation | null {
  for (let rowIndex = startRowIndex; rowIndex >= 0 && rowIndex < rowIds.length; rowIndex += direction) {
    const candidate = { id: rowIds[rowIndex], field };
    const row = rows.find((currentRow) => String(currentRow.id) === String(candidate.id));
    if (isCellKeyboardNavigable({
      api,
      columns: visibleColumns,
      field: candidate.field,
      isActionCell,
      row,
      rowId: candidate.id,
    })) {
      return candidate;
    }

    const sameFieldIndex = visibleColumns.findIndex((column) => column.field === field);
    for (let offset = 1; offset < visibleColumns.length; offset += 1) {
      const rightIndex = sameFieldIndex + offset;
      if (rightIndex < visibleColumns.length) {
        const rightCandidate = { id: rowIds[rowIndex], field: visibleColumns[rightIndex].field };
        if (isCellKeyboardNavigable({
          api,
          columns: visibleColumns,
          field: rightCandidate.field,
          isActionCell,
          row,
          rowId: rightCandidate.id,
        })) {
          return rightCandidate;
        }
      }

      const leftIndex = sameFieldIndex - offset;
      if (leftIndex >= 0) {
        const leftCandidate = { id: rowIds[rowIndex], field: visibleColumns[leftIndex].field };
        if (isCellKeyboardNavigable({
          api,
          columns: visibleColumns,
          field: leftCandidate.field,
          isActionCell,
          row,
          rowId: leftCandidate.id,
        })) {
          return leftCandidate;
        }
      }
    }
  }

  return null;
}

export function getVerticalKeyboardNavigationTarget<Row extends GridValidRowModel>({
  api,
  columns = [],
  current,
  direction,
  isActionCell,
  rows = [],
}: GetKeyboardNavigationTargetOptions<Row>): CellLocation | null {
  const visibleColumns = getColumns(api, columns);
  const rowIds = getRowIds(api, rows);
  const currentRowIndex = rowIds.findIndex((rowId) => String(rowId) === String(current.id));
  if (currentRowIndex < 0) {
    return null;
  }

  return findNavigableRowCell(
    api,
    visibleColumns,
    rowIds,
    rows,
    currentRowIndex + direction,
    direction,
    current.field,
    isActionCell,
  );
}

/**
 * Estimates how many rows fit in the grid's visible scroll viewport, for use
 * as the PageUp/PageDown step size. Deliberately measured from the actual
 * scroll container's `clientHeight` rather than MUI's own
 * `apiRef.getViewportPageSize()`: that internal helper returns 0 whenever
 * its dimensions state isn't marked ready yet
 * (`@mui/x-virtualizer/features/keyboard.mjs`), which is common in
 * OpenFarmPlanner's continuous-scroll grids since their height is driven by
 * `useContinuousScrollSizing`/custom sizing rather than MUI's own resize
 * observer — a 0 that silently collapsed PageUp/PageDown to a single row
 * once `Math.floor(0) || 1` was applied. Measuring the DOM directly
 * sidesteps that internal readiness state entirely, matching the same
 * DOM-over-internal-state approach `useScrollDrivenRowWindow` already uses
 * for its own edge detection.
 *
 * `headerHeightPx` must be subtracted first: MUI renders the column header
 * row *inside* `.MuiDataGrid-virtualScroller`, so its `clientHeight` covers
 * the header plus the data rows, not just the rows — see
 * `useStableDataGridScrollbar`'s `container.clientHeight - headerHeight`,
 * which the scrollbar thumb needed the exact same correction for. Skipping
 * it overcounts by roughly one row per `headerHeightPx / rowHeightPx`, which
 * is why PageUp/PageDown initially overshot by a row or two after this was
 * first measured without the subtraction.
 *
 * Returns undefined when the container isn't mounted yet, the corrected
 * height is non-positive, or the row height itself is non-positive; callers
 * should fall back to a sane default (e.g. the row window's page size) in
 * that case.
 */
export function getViewportRowPageSize(
  container: HTMLElement | null | undefined,
  rowHeightPx: number,
  headerHeightPx = 0,
): number | undefined {
  if (!container || rowHeightPx <= 0) {
    return undefined;
  }

  const rowsOnlyHeight = container.clientHeight - headerHeightPx;
  if (rowsOnlyHeight <= 0) {
    return undefined;
  }

  const rowsPerPage = Math.floor(rowsOnlyHeight / rowHeightPx);
  return rowsPerPage > 0 ? rowsPerPage : undefined;
}

export interface GetPagingKeyboardNavigationTargetOptions<Row extends GridValidRowModel> {
  api: DataGridNavigationApi<Row> | null | undefined;
  columns?: readonly GridColDef<Row>[];
  current: CellLocation;
  direction: Direction;
  isActionCell?: (params: GridCellParams<Row>) => boolean;
  pageSize: number;
  rows?: readonly Row[];
}

/**
 * Resolves the PageUp/PageDown target: `pageSize` rows away from `current`
 * in the same column, clamped to the *complete* loaded dataset (`rows`)
 * rather than to whatever internal row window the grid currently has
 * mounted — see keyboard-architecture.md, "Continuous-scroll paging". Returns
 * null when `current` is already at the dataset edge in that direction.
 */
export function getPagingKeyboardNavigationTarget<Row extends GridValidRowModel>({
  api,
  columns = [],
  current,
  direction,
  isActionCell,
  pageSize,
  rows = [],
}: GetPagingKeyboardNavigationTargetOptions<Row>): CellLocation | null {
  const visibleColumns = getColumns(api, columns);
  const rowIds = getRowIds(api, rows);
  const currentRowIndex = rowIds.findIndex((rowId) => String(rowId) === String(current.id));
  if (currentRowIndex < 0 || rowIds.length === 0) {
    return null;
  }

  const boundedPageSize = Math.max(1, Math.floor(pageSize) || 1);
  const targetRowIndex = direction > 0
    ? Math.min(currentRowIndex + boundedPageSize, rowIds.length - 1)
    : Math.max(currentRowIndex - boundedPageSize, 0);
  if (targetRowIndex === currentRowIndex) {
    return null;
  }

  return findNavigableRowCell(
    api,
    visibleColumns,
    rowIds,
    rows,
    targetRowIndex,
    direction,
    current.field,
    isActionCell,
  );
}

export interface GetDatasetEdgeKeyboardNavigationTargetOptions<Row extends GridValidRowModel> {
  api: DataGridNavigationApi<Row> | null | undefined;
  columns?: readonly GridColDef<Row>[];
  edge: 'first' | 'last';
  isActionCell?: (params: GridCellParams<Row>) => boolean;
  rows?: readonly Row[];
}

/**
 * Resolves the Ctrl/Shift+Home ('first') or Ctrl/Shift+End ('last') target:
 * the first (or last) navigable cell of the *complete* loaded dataset
 * (`rows`), not just the grid's currently mounted internal row window — see
 * keyboard-architecture.md, "Continuous-scroll paging". Searches forward
 * from the very first row/column for 'first', backward from the very last
 * row/column for 'last', in case the edge row has no navigable cell at all.
 */
export function getDatasetEdgeKeyboardNavigationTarget<Row extends GridValidRowModel>({
  api,
  columns = [],
  edge,
  isActionCell,
  rows = [],
}: GetDatasetEdgeKeyboardNavigationTargetOptions<Row>): CellLocation | null {
  const visibleColumns = getColumns(api, columns);
  const rowIds = getRowIds(api, rows);
  if (rowIds.length === 0 || visibleColumns.length === 0) {
    return null;
  }

  const direction: Direction = edge === 'first' ? 1 : -1;
  const startRowIndex = edge === 'first' ? 0 : rowIds.length - 1;
  const edgeField = edge === 'first' ? visibleColumns[0].field : visibleColumns[visibleColumns.length - 1].field;

  return findNavigableRowCell(
    api,
    visibleColumns,
    rowIds,
    rows,
    startRowIndex,
    direction,
    edgeField,
    isActionCell,
  );
}

/**
 * Resolves the next horizontally-adjacent navigable cell within the same row,
 * given the row's already-computed ordered list of navigable fields. Returns
 * null at the row edges. Pure function of its arguments.
 */
export function getHorizontalKeyboardNavigationTarget(
  navigableFields: readonly string[],
  rowId: GridRowId,
  field: string,
  direction: Direction,
): CellLocation | null {
  const fieldIndex = navigableFields.indexOf(field);
  if (fieldIndex === -1) {
    return null;
  }

  const nextField = navigableFields[fieldIndex + direction];
  return nextField ? { id: rowId, field: nextField } : null;
}

/**
 * Resolves a field's index among the grid's *currently visible* columns, or
 * undefined when the field is hidden (or the grid API isn't available yet).
 *
 * Deliberately not MUI's `getColumnIndexRelativeToVisibleColumns`: despite its
 * name that one looks the field up in the *full* column list, hidden columns
 * included, while `scrollToIndexes` indexes into the visible column
 * definitions. Feeding one into the other is off by however many columns are
 * hidden to the left, and once the index runs past the visible column count
 * `scrollToIndexes` throws on `visibleColumns[colIndex].computedWidth`. That
 * throw propagated out of the Tab handler and aborted keyboard navigation
 * outright — e.g. on the planting plans grid below the `lg` breakpoint, where
 * both harvest-date columns are hidden by default, Tab out of "Pflanzdatum"
 * reached "Fläche" and then stopped short of "Pflanzen".
 */
export function getVisibleColumnIndex<Row extends GridValidRowModel>(
  api: DataGridNavigationApi<Row> | null | undefined,
  field: string,
): number | undefined {
  const visibleColumns = api?.getVisibleColumns?.();
  if (!visibleColumns) {
    return undefined;
  }

  const columnIndex = visibleColumns.findIndex((column) => column.field === field);
  return columnIndex < 0 ? undefined : columnIndex;
}

/**
 * Scrolls a cell into the grid's viewport. Each axis is only passed on when its
 * index actually resolves, so a hidden column or an unknown row id simply skips
 * that axis instead of handing `scrollToIndexes` an out-of-range index.
 */
export function scrollCellIntoView<Row extends GridValidRowModel>(
  api: DataGridNavigationApi<Row> | null | undefined,
  cell: CellLocation,
): void {
  if (!api?.scrollToIndexes) {
    return;
  }

  const rowIndex = api.getRowIndexRelativeToVisibleRows?.(cell.id);
  const colIndex = getVisibleColumnIndex(api, cell.field);
  const indexes: { rowIndex?: number; colIndex?: number } = {};
  if (typeof rowIndex === 'number' && rowIndex >= 0) {
    indexes.rowIndex = rowIndex;
  }
  if (colIndex !== undefined) {
    indexes.colIndex = colIndex;
  }

  if (indexes.rowIndex === undefined && indexes.colIndex === undefined) {
    return;
  }

  api.scrollToIndexes(indexes);
}

export type KeyboardNavigationAxis = 'horizontal' | 'vertical';

export interface ViewModeNavigationRequest {
  axis: KeyboardNavigationAxis;
  direction: Direction;
  wrapRows: boolean;
}

/**
 * Maps a view-mode navigation keypress to the axis, direction, and row-wrapping
 * behavior it should trigger, or null for keys that do not navigate. Horizontal
 * requests drive the column-first target search and vertical requests the
 * same-column search; only Tab wraps across rows. Pure function of its inputs.
 */
export function getViewModeNavigationRequest(
  key: string,
  shiftKey: boolean,
): ViewModeNavigationRequest | null {
  switch (key) {
    case 'Tab':
      return { axis: 'horizontal', direction: shiftKey ? -1 : 1, wrapRows: true };
    case 'ArrowRight':
      return { axis: 'horizontal', direction: 1, wrapRows: false };
    case 'ArrowLeft':
      return { axis: 'horizontal', direction: -1, wrapRows: false };
    case 'ArrowDown':
      return { axis: 'vertical', direction: 1, wrapRows: false };
    case 'ArrowUp':
      return { axis: 'vertical', direction: -1, wrapRows: false };
    default:
      return null;
  }
}

/**
 * Number of animation frames `settleCellFocus` keeps retrying for before focus
 * has landed. Thirty frames (~500ms at 60fps) covers a row-window page swap
 * plus the scroll and virtualization pass behind it on a loaded machine, while
 * still giving up quickly enough that a target that never mounts can't keep
 * chasing focus.
 */
const CELL_FOCUS_RETRY_FRAMES = 30;

/**
 * Number of frames `settleCellFocus` keeps watching *after* focus has landed.
 * MUI's page-change handler resets focus to the first cell of the newly
 * mounted page, which can arrive several frames after our move looked
 * finished and drops DOM focus out of the grid entirely.
 */
const CELL_FOCUS_HOLD_FRAMES = 30;

/**
 * True when nothing in the grid holds DOM focus any more — the state MUI's
 * page-change reset leaves behind. Focus that moved to another cell is a
 * deliberate move (a click, a newer navigation) and is left alone.
 */
function focusWasDroppedOutsideGrid(cellElement: HTMLElement): boolean {
  const activeElement = cellElement.ownerDocument.activeElement;
  return !activeElement
    || activeElement === cellElement.ownerDocument.body
    || !activeElement.closest('[role="grid"]');
}

/**
 * Identifies the most recent focus request. A retry loop belonging to an older
 * request stops as soon as a newer one starts, so a fresh keypress or click
 * always wins over a move still settling from before.
 */
let latestCellFocusRequest = 0;

function requestCellFocusState<Row extends GridValidRowModel>(
  api: DataGridNavigationApi<Row>,
  cell: CellLocation,
): void {
  scrollCellIntoView(api, cell);
  api.setCellFocus?.(cell.id, cell.field);
}

/**
 * Drives a focus move to completion against a virtualized, internally paged
 * grid. `setCellFocus` only updates the grid's own focus state, and the cell
 * element takes DOM focus when MUI renders it — which it cannot do while the
 * target row's page is still being mounted or the row is still outside the
 * scrolled viewport. Left at one attempt, the browser keeps focus on `<body>`
 * (or on the cell the user came from) while the grid's focus state points at
 * an unrendered row, so no cell carries the roving `tabindex="0"` and every
 * following keypress is swallowed. Re-asserting the scroll and the focus
 * state each frame also outlasts MUI's own page-change handler, which resets
 * focus to the first cell of the newly mounted page.
 */
function settleCellFocus<Row extends GridValidRowModel>(
  api: DataGridNavigationApi<Row>,
  cell: CellLocation,
  request: number,
  framesUntilLanded: number,
  framesAfterLanded: number,
): void {
  if (request !== latestCellFocusRequest || typeof window.requestAnimationFrame !== 'function') {
    return;
  }
  if (framesUntilLanded <= 0 && framesAfterLanded <= 0) {
    return;
  }

  const cellElement = api.getCellElement?.(cell.id, cell.field) ?? null;
  if (cellElement
    && !cellElement.contains(document.activeElement)
    && (framesUntilLanded > 0 || focusWasDroppedOutsideGrid(cellElement))) {
    cellElement.focus({ preventScroll: true });
  }

  if (cellElement?.contains(document.activeElement)) {
    window.requestAnimationFrame(() => {
      settleCellFocus(api, cell, request, 0, framesAfterLanded - 1);
    });
    return;
  }

  if (framesUntilLanded <= 0) {
    // Past the initial budget, focus sitting on another cell is someone
    // else's — only a focus this move dropped is worth taking back.
    return;
  }

  requestCellFocusState(api, cell);
  window.requestAnimationFrame(() => {
    settleCellFocus(api, cell, request, framesUntilLanded - 1, framesAfterLanded);
  });
}

/**
 * Drops any focus move still settling. Grids call this when they unmount, so a
 * retry loop can't keep reaching for a cell of a grid that is gone.
 */
export function cancelPendingCellFocus(): void {
  latestCellFocusRequest += 1;
}

export function focusKeyboardNavigableCell<Row extends GridValidRowModel>({
  api,
  cell,
  focusEditInput = false,
}: FocusKeyboardNavigableCellOptions<Row>): void {
  if (!api?.setCellFocus) {
    return;
  }

  latestCellFocusRequest += 1;
  requestCellFocusState(api, cell);

  if (!focusEditInput) {
    // The editor path below runs its own focus retries into the cell's input,
    // so only the view-mode path needs the cell element itself chased down.
    settleCellFocus(api, cell, latestCellFocusRequest, CELL_FOCUS_RETRY_FRAMES, CELL_FOCUS_HOLD_FRAMES);
    return;
  }

  const focusEditor = (): boolean => {
    const cellElement = api.getCellElement?.(cell.id, cell.field);
    const editor = cellElement?.querySelector<HTMLElement>(EDIT_CELL_FOCUS_TARGET_SELECTOR);
    if (!editor) {
      return false;
    }

    editor.focus({ preventScroll: true });
    return true;
  };

  focusEditor();
  queueMicrotask(focusEditor);
  window.setTimeout(focusEditor, 0);
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(focusEditor);
  }
}

export function preventReadOnlyCellMouseFocus(event: MouseEvent<HTMLElement>): void {
  event.preventDefault();
  event.stopPropagation();
}

export function isInteractiveCellTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest(INTERACTIVE_CELL_TARGET_SELECTOR));
}

interface FocusStateApi {
  state?: { focus?: { cell?: CellLocation | null } };
}

/**
 * Walks up from a DOM event target to the enclosing grid cell and resolves its
 * row id and field. Row ids are returned as numbers when they parse cleanly and
 * kept as strings otherwise. Pure read; it never mutates the grid or the DOM.
 */
export function getCellLocationFromDomTarget(target: EventTarget | null): CellLocation | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const cellElement = target.closest<HTMLElement>('[role="gridcell"][data-field]');
  const rowElement = target.closest<HTMLElement>('[role="row"][data-id]');
  const field = cellElement?.dataset.field;
  const id = rowElement?.dataset.id;
  if (!field || id === undefined) {
    return null;
  }

  const numericId = Number(id);
  return {
    id: Number.isNaN(numericId) ? id : numericId,
    field,
  };
}

/**
 * Resolves the currently focused cell for a keyboard event: it prefers the
 * grid's tracked focus state and falls back to walking up from the event
 * target's DOM when the grid has not recorded a focused cell. Pure read; it
 * never mutates the grid or the DOM.
 */
export function resolveFocusedCellFromEvent(
  api: FocusStateApi | null | undefined,
  event: { target: EventTarget | null },
): CellLocation | null {
  const focusedCell = api?.state?.focus?.cell;
  if (focusedCell) {
    return focusedCell;
  }

  return getCellLocationFromDomTarget(event.target);
}
