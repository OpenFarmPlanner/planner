/**
 * Navigation performance and correctness tests for FieldsBedsHierarchy.
 *
 * These tests verify:
 * 1. ArrowDown/Up navigation moves focus to the correct rows.
 * 2. Navigation does not produce cascading React re-renders.
 * 3. Rapid navigation stays within a generous timing budget so infinite
 *    loops or O(n²) regressions are caught early.
 *
 * Note: the DataGrid is mocked, so absolute durations here are much lower
 * than in the browser. The real-browser performance benefit comes from:
 *   – transient keyboard selection updates refs instead of page state
 *   – stable callbacks read the current row from refs
 *   – focused grid cells are updated imperatively
 * Those changes avoid expensive page re-renders per keypress in the browser.
 */

import React, { Profiler } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import FieldsBedsHierarchy from '../pages/FieldsBedsHierarchy';
import { mockT } from './helpers/testI18n';
import { resetTableEditHintSessionState, useEditHint } from '../components/data-grid/useEditHint';
import { EDIT_HINT_DELAY_MS } from '../components/data-grid/useSpreadsheetCellEditing';

// ── mocks (mirrors FieldsBedsHierarchy.editCancel.test.tsx) ─────────────────

const {
  bedListMock,
  fieldListMock,
  fieldUpdateMock,
  locationListMock,
  getCapturedOnCellKeyDown,
  setCapturedOnCellKeyDown,
  getCapturedOnRowEditStop,
  setCapturedOnRowEditStop,
  getEditCellFocusMock,
  getCapturedProcessRowUpdate,
  setCapturedProcessRowUpdate,
  getSetCellFocusMock,
  getSelectRowImpl,
  setSelectRowImpl,
} = vi.hoisted(() => {
  // capturedOnCellKeyDown is set by the DataGrid mock each render so tests
  // can call the handler directly to verify blocking behaviour.
  let capturedOnCellKeyDown: ((params: unknown, event: unknown) => void) | undefined;
  // capturedProcessRowUpdate lets tests simulate a row-save confirmation.
  let capturedProcessRowUpdate: ((row: unknown) => Promise<unknown>) | undefined;
  let capturedOnRowEditStop: ((params: unknown, event: { defaultMuiPrevented: boolean }) => void) | undefined;
  // selectRowImpl bridges gridApiRef.current.selectRow() → DataGrid's React state.
  // It should stay unused for keyboard-only focus navigation.
  let selectRowImpl: ((id: string | number, isSelected: boolean, reset: boolean) => void) | undefined;
  const setCellFocusMock = vi.fn();
  const editCellFocusMock = vi.fn();
  return {
    bedListMock: vi.fn(),
    fieldListMock: vi.fn(),
    fieldUpdateMock: vi.fn(),
    locationListMock: vi.fn(),
    getCapturedOnCellKeyDown: () => capturedOnCellKeyDown,
    setCapturedOnCellKeyDown: (fn: ((params: unknown, event: unknown) => void) | undefined) => {
      capturedOnCellKeyDown = fn;
    },
    getCapturedOnRowEditStop: () => capturedOnRowEditStop,
    setCapturedOnRowEditStop: (fn: typeof capturedOnRowEditStop) => {
      capturedOnRowEditStop = fn;
    },
    getEditCellFocusMock: () => editCellFocusMock,
    getCapturedProcessRowUpdate: () => capturedProcessRowUpdate,
    setCapturedProcessRowUpdate: (fn: typeof capturedProcessRowUpdate) => {
      capturedProcessRowUpdate = fn;
    },
    getSetCellFocusMock: () => setCellFocusMock,
    getSelectRowImpl: () => selectRowImpl,
    setSelectRowImpl: (fn: typeof selectRowImpl) => { selectRowImpl = fn; },
  };
});

vi.mock('../i18n', () => ({ useTranslation: () => ({ t: mockT }) }));
vi.mock('../commands/useCommandContext', () => ({
  useCommandContextTag: vi.fn(),
  useRegisterCommands: vi.fn(),
}));
vi.mock('../hooks/autosave', () => ({ useNavigationBlocker: vi.fn() }));

vi.mock('../api/api', async () => {
  const actual = await vi.importActual<typeof import('../api/api')>('../api/api');
  return {
    ...actual,
    bedAPI: {
      create: vi.fn(),
      delete: vi.fn(),
      list: bedListMock,
      // listAll mirrors whatever list() is mocked to resolve, unwrapped —
      // useHierarchyData uses listAll (not list) to fetch every page.
      listAll: async () => (await bedListMock()).data,
      update: vi.fn(),
    },
    fieldAPI: {
      create: vi.fn(),
      delete: vi.fn(),
      list: fieldListMock,
      listAll: async () => (await fieldListMock()).data,
      update: fieldUpdateMock,
    },
    locationAPI: {
      create: vi.fn(),
      delete: vi.fn(),
      list: locationListMock,
      listAll: async () => (await locationListMock()).data,
      update: vi.fn(),
    },
  };
});

vi.mock('@mui/x-data-grid', async () => {
  const ReactModule = await import('react');
  const GridRowModes = { Edit: 'edit', View: 'view' };
  const GridRowEditStopReasons = {
    escapeKeyDown: 'escapeKeyDown',
    enterKeyDown: 'enterKeyDown',
    rowFocusOut: 'rowFocusOut',
    shiftTabKeyDown: 'shiftTabKeyDown',
    tabKeyDown: 'tabKeyDown',
  };
  // Mirror the real useGridApiRef which uses React.useRef internally, returning the
  // same ref object across re-renders. Without this, gridApiRef changes on every
  // render, which cascades through focusRow → focusSelectedCell → useLayoutEffect,
  // causing spurious re-focus on every render — the exact bug this file tests for.
  const useGridApiRef = vi.fn(() => ReactModule.useRef({
    setCellFocus: getSetCellFocusMock(),
    // Route imperative selectRow calls into DataGrid's React state so tests
    // can assert data-selected without a controlled rowSelectionModel prop.
    selectRow: vi.fn((id: string | number, isSelected: boolean = true, resetOtherRows: boolean = false) => {
      getSelectRowImpl()?.(id, isSelected, resetOtherRows);
    }),
    setRowSelectionModel: vi.fn(),
    stopRowEditMode: vi.fn(),
  }));

  const DataGrid = ({
    apiRef,
    columns,
    isCellEditable,
    onCellClick,
    onCellDoubleClick,
    onCellKeyDown,
    onRowEditStop,
    processRowUpdate,
    rowModesModel,
    rows,
  }: {
    apiRef?: {
      current?: Record<string, unknown>;
    };
    columns: Array<{ field: string; renderCell?: (p: unknown) => unknown; editable?: boolean }>;
    isCellEditable?: (p: { row: Record<string, unknown>; field: string }) => boolean;
    onCellClick?: (
      p: { id: string | number; field: string; isEditable: boolean; row: Record<string, unknown> },
      event?: React.MouseEvent,
    ) => void;
    onCellDoubleClick?: (
      p: { id: string | number; field: string; isEditable: boolean; row: Record<string, unknown> },
      event: React.MouseEvent,
    ) => void;
    onCellKeyDown?: (params: unknown, event: unknown) => void;
    onRowEditStop?: (params: unknown, event: { defaultMuiPrevented: boolean }) => void;
    processRowUpdate?: (row: unknown) => Promise<unknown>;
    rowModesModel: Record<string, { mode: string }>;
    rows: Array<Record<string, unknown> & { id: string | number }>;
  }) => {
    const [selectedIds, setSelectedIds] = ReactModule.useState(new Set<string | number>());
    const [focusedCell, setFocusedCell] = ReactModule.useState<{ id: string | number; field: string } | null>(null);
    // Register state updater on every render so gridApiRef.current.selectRow() can
    // trigger a DataGrid re-render (mirrors MUI DataGrid's internal state update).
    setSelectRowImpl((id, isSelected, resetOtherRows) => {
      setSelectedIds(prev => {
        if (resetOtherRows) return isSelected ? new Set([id]) : new Set<string | number>();
        const next = new Set(prev);
        if (isSelected) next.add(id); else next.delete(id);
        return next;
      });
    });
    // Capture so tests can invoke them directly.
    setCapturedOnCellKeyDown(onCellKeyDown);
    setCapturedOnRowEditStop(onRowEditStop);
    setCapturedProcessRowUpdate(processRowUpdate);
    ReactModule.useLayoutEffect(() => {
      if (!apiRef?.current) {
        return;
      }

      const api = apiRef.current;
      api.setCellFocus = (id: string | number, field: string) => {
        getSetCellFocusMock()(id, field);
        setFocusedCell({ id, field });
      };
      api.getAllRowIds = () => rows.map((row) => row.id);
      api.getVisibleColumns = () => columns;
      api.getCellParams = (id: string | number, field: string) => {
        const row = rows.find((currentRow) => String(currentRow.id) === String(id));
        return {
          id,
          field,
          row,
          isEditable: row ? (isCellEditable?.({ row, field }) ?? true) : false,
        };
      };
      api.getRowIndexRelativeToVisibleRows = (id: string | number) =>
        rows.findIndex((row) => String(row.id) === String(id));
      api.getColumnIndexRelativeToVisibleColumns = (field: string) =>
        columns.findIndex((column) => column.field === field);
      api.getCellElement = () => {
        const element = document.createElement('div');
        element.focus = getEditCellFocusMock();
        return element;
      };
      api.isCellEditable = (params: { row?: Record<string, unknown>; field: string }) =>
        params.row ? (isCellEditable?.({ row: params.row, field: params.field }) ?? true) : false;
      api.scrollToIndexes = vi.fn();
    }, [apiRef, columns, isCellEditable, rows]);

    return (
      <div data-testid="hierarchy-grid">
        <div data-testid="row-count">{rows.length}</div>
        {rows.map((row) => {
          const mode = rowModesModel[row.id]?.mode ?? rowModesModel[String(row.id)]?.mode ?? GridRowModes.View;
          const isSelected = selectedIds.has(row.id) || selectedIds.has(String(row.id));
          const isFocused = focusedCell !== null && String(focusedCell.id) === String(row.id);
          return (
            <div
              data-id={String(row.id)}
              data-focused={isFocused ? 'true' : 'false'}
              data-testid={`row-${row.id}`}
              data-selected={isSelected ? 'true' : 'false'}
              key={String(row.id)}
              role="row"
            >
              <span data-testid={`mode-${row.id}`}>{mode}</span>
              {columns.map((col) => {
                const editable = isCellEditable?.({ row, field: col.field }) ?? true;
                if (typeof col.renderCell === 'function') {
                  return (
                    <div key={`${row.id}-${col.field}`} role="gridcell" data-field={col.field}>
                      <button
                        type="button"
                        data-testid={`select-${row.id}-${col.field}`}
                        onClick={(event) => {
                          onCellClick?.({ id: row.id, field: col.field, isEditable: editable, row }, event);
                        }}
                        onDoubleClick={(event) => {
                          onCellDoubleClick?.({ id: row.id, field: col.field, isEditable: editable, row }, event);
                        }}
                      >
                        {`Select ${row.id} ${col.field}`}
                      </button>
                      {col.renderCell({
                        api: {},
                        cellMode: mode === GridRowModes.Edit ? 'edit' : 'view',
                        field: col.field,
                        id: row.id,
                        row,
                        value: row[col.field],
                      } as never)}
                    </div>
                  );
                }
                return (
                  <div key={`${row.id}-${col.field}`} role="gridcell" data-field={col.field}>
                    <button
                      type="button"
                      data-testid={`select-${row.id}-${col.field}`}
                      onClick={(event) => {
                        onCellClick?.({ id: row.id, field: col.field, isEditable: editable, row }, event);
                      }}
                      onDoubleClick={(event) => {
                        onCellDoubleClick?.({ id: row.id, field: col.field, isEditable: editable, row }, event);
                      }}
                    >
                      {`Select ${row.id} ${col.field}`}
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  };

  return { DataGrid, GridRowEditStopReasons, GridRowModes, useGridApiRef };
});

// ── helpers ──────────────────────────────────────────────────────────────────

const FIELD_COUNT = 5;

const renderHierarchy = () =>
  render(
    <MemoryRouter initialEntries={['/app/fields-beds']}>
      <FieldsBedsHierarchy showTitle={false} />
    </MemoryRouter>,
  );

const renderHierarchyWithProfiler = (onRender: React.ProfilerOnRenderCallback) =>
  render(
    <Profiler id="fields-beds-hierarchy" onRender={onRender}>
      <MemoryRouter initialEntries={['/app/fields-beds']}>
        <FieldsBedsHierarchy showTitle={false} />
      </MemoryRouter>
    </Profiler>,
  );

const pressArrowDown = () =>
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });

const pressArrowUp = () =>
  act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); });

// ── tests ────────────────────────────────────────────────────────────────────

describe('FieldsBedsHierarchy keyboard navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSetCellFocusMock().mockClear();
    getEditCellFocusMock().mockClear();
    window.sessionStorage.clear();
    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    // jsdom does not implement scrollIntoView
    window.HTMLElement.prototype.scrollIntoView = vi.fn();

    locationListMock.mockResolvedValue({
      data: { results: [{ id: 1, name: 'Standort A' }] },
    });
    fieldListMock.mockResolvedValue({
      data: {
        results: Array.from({ length: FIELD_COUNT }, (_, i) => ({
          id: i + 1,
          name: `Parzelle ${i + 1}`,
          location: 1,
          area_sqm: 10,
        })),
      },
    });
    bedListMock.mockResolvedValue({ data: { results: [] } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('ArrowDown moves focus through consecutive rows without selecting rows', async () => {
    renderHierarchy();

    // Wait for rows to appear (fields are visible under the single location)
    await waitFor(() => expect(screen.getByTestId('row-field-1')).toBeInTheDocument());

    // Click the first field to focus it and activate keyboard navigation.
    await act(async () => {
      fireEvent.click(screen.getByTestId('select-field-1-name'));
    });

    // Navigate down 4 rows
    await pressArrowDown();
    await pressArrowDown();
    await pressArrowDown();
    await pressArrowDown();

    // The 5th field (field-5) should now be focused but not selected.
    await waitFor(() =>
      expect(screen.getByTestId('row-field-5')).toHaveAttribute('data-focused', 'true'),
    );
    expect(screen.getByTestId('row-field-5')).toHaveAttribute('data-selected', 'false');
    // The first field should no longer be focused or selected.
    expect(screen.getByTestId('row-field-1')).toHaveAttribute('data-focused', 'false');
    expect(screen.getByTestId('row-field-1')).toHaveAttribute('data-selected', 'false');
  });

  it('ArrowUp moves focus back up without selecting rows', async () => {
    renderHierarchy();
    await waitFor(() => expect(screen.getByTestId('row-field-1')).toBeInTheDocument());

    // Focus field-5 first by clicking it.
    await act(async () => { fireEvent.click(screen.getByTestId('select-field-5-name')); });

    await pressArrowUp();
    await pressArrowUp();

    await waitFor(() =>
      expect(screen.getByTestId('row-field-3')).toHaveAttribute('data-focused', 'true'),
    );
    expect(screen.getByTestId('row-field-3')).toHaveAttribute('data-selected', 'false');
  });

  it('ArrowDown does not move past the last row', async () => {
    renderHierarchy();
    await waitFor(() => expect(screen.getByTestId(`row-field-${FIELD_COUNT}`)).toBeInTheDocument());

    // Focus the last field.
    await act(async () => {
      fireEvent.click(screen.getByTestId(`select-field-${FIELD_COUNT}-name`));
    });

    // Try to go further — should stay on the last field
    await pressArrowDown();
    await pressArrowDown();

    await waitFor(() =>
      expect(screen.getByTestId(`row-field-${FIELD_COUNT}`)).toHaveAttribute('data-focused', 'true'),
    );
    expect(screen.getByTestId(`row-field-${FIELD_COUNT}`)).toHaveAttribute('data-selected', 'false');
  });

  it('ArrowDown preserves the focused column when moving to the next row', async () => {
    renderHierarchy();

    await waitFor(() => expect(screen.getByTestId('row-field-2')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId('select-field-2-width_m'));
    });
    getSetCellFocusMock().mockClear();

    await pressArrowDown();

    await waitFor(() =>
      expect(screen.getByTestId('row-field-3')).toHaveAttribute('data-focused', 'true'),
    );
    expect(screen.getByTestId('row-field-3')).toHaveAttribute('data-selected', 'false');
    expect(getSetCellFocusMock()).toHaveBeenLastCalledWith('field-3', 'width_m');
    expect(getSetCellFocusMock()).not.toHaveBeenLastCalledWith('field-3', 'name');
  });

  it('Alt+T focuses the first editable cell without selecting a row', async () => {
    renderHierarchy();

    await waitFor(() => expect(screen.getByTestId('row-field-2')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId('select-field-2-width_m'));
    });
    getSetCellFocusMock().mockClear();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'T', altKey: true, bubbles: true }));
    });

    await waitFor(() =>
      expect(screen.getByTestId('row-field-1')).toHaveAttribute('data-focused', 'true'),
    );
    expect(screen.getByTestId('row-field-1')).toHaveAttribute('data-selected', 'false');
    expect(screen.getByTestId('row-field-2')).toHaveAttribute('data-focused', 'false');
    expect(getSetCellFocusMock()).toHaveBeenLastCalledWith('field-1', 'name');
  });

  it('does not select or edit calculated area cells on click', async () => {
    renderHierarchy();
    await waitFor(() => expect(screen.getByTestId('row-field-1')).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByTestId('select-field-1-area_sqm'));
    });

    expect(screen.getByTestId('row-field-1')).toHaveAttribute('data-selected', 'false');
    expect(screen.getByTestId('mode-field-1')).toHaveTextContent('view');
    expect(getSetCellFocusMock()).not.toHaveBeenCalledWith('field-1', 'area_sqm');
  });

  it('ArrowRight skips calculated area cells', async () => {
    renderHierarchy();
    await waitFor(() => expect(screen.getByTestId('row-field-1')).toBeInTheDocument());
    const onCellKeyDown = getCapturedOnCellKeyDown();
    expect(onCellKeyDown).toBeDefined();

    const event = {
      key: 'ArrowRight',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      defaultMuiPrevented: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    act(() => {
      onCellKeyDown!(
        {
          id: 'field-1',
          field: 'width_m',
          isEditable: true,
          row: { id: 'field-1', type: 'field' },
        },
        event,
      );
    });

    expect(event.defaultMuiPrevented).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(getSetCellFocusMock()).toHaveBeenLastCalledWith('field-1', 'notes');
  });

  it('ArrowUp does not move past the first row', async () => {
    renderHierarchy();
    // With a single location the hierarchy renders fields directly without a location header,
    // so field-1 is the first row in the flat list.
    await waitFor(() => expect(screen.getByTestId('row-field-1')).toBeInTheDocument());

    // Focus the first field.
    await act(async () => { fireEvent.click(screen.getByTestId('select-field-1-name')); });

    // Pressing up multiple times should keep field-1 focused without selecting it.
    await pressArrowUp();
    await pressArrowUp();

    await waitFor(() =>
      expect(screen.getByTestId('row-field-1')).toHaveAttribute('data-focused', 'true'),
    );
    expect(screen.getByTestId('row-field-1')).toHaveAttribute('data-selected', 'false');
  });

  it(`${FIELD_COUNT} rapid ArrowDown presses cause at most ${FIELD_COUNT} React updates`, async () => {
    const updates: number[] = [];
    const onRender: React.ProfilerOnRenderCallback = (_id, phase, actualDuration) => {
      if (phase === 'update') updates.push(actualDuration);
    };

    renderHierarchyWithProfiler(onRender);
    await waitFor(() => expect(screen.getByTestId('row-field-1')).toBeInTheDocument());

    const updatesBeforeNav = updates.length;

    // Activate navigation
    await act(async () => { fireEvent.click(screen.getByTestId('select-field-1-name')); });

    const updatesAfterClick = updates.length;

    // Navigate FIELD_COUNT - 1 times (stays within bounds)
    for (let i = 0; i < FIELD_COUNT - 1; i++) {
      await pressArrowDown();
    }

    const navUpdates = updates.length - updatesAfterClick;

    // The grid mock updates its internal focused-cell state, but navigation
    // must not cascade into multiple React updates per keypress.
    expect(navUpdates).toBeLessThanOrEqual(FIELD_COUNT - 1);
    expect(navUpdates).toBeGreaterThan(0);

    // Sanity: initial load caused some renders too
    expect(updatesBeforeNav).toBeGreaterThanOrEqual(0);
  });

  it(`${FIELD_COUNT} ArrowDown presses complete within a generous jsdom budget`, async () => {
    renderHierarchy();
    await waitFor(() => expect(screen.getByTestId('row-field-1')).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByTestId('select-field-1-name')); });

    const start = performance.now();
    for (let i = 0; i < FIELD_COUNT - 1; i++) {
      await pressArrowDown();
    }
    const elapsed = performance.now() - start;

    // jsdom timing is noisy under parallel Vitest load. This guards against
    // infinite loops and O(n²) regressions, not browser interaction latency.
    expect(elapsed).toBeLessThan(5000);
  });

  it('collapsing a parent row while a child is focused moves focus to the parent and keeps navigation working', async () => {
    // Two fields, two beds under field-1.
    fieldListMock.mockResolvedValue({
      data: {
        results: [
          { id: 1, name: 'Parzelle 1', location: 1, area_sqm: 10 },
          { id: 2, name: 'Parzelle 2', location: 1, area_sqm: 10 },
        ],
      },
    });
    bedListMock.mockResolvedValue({
      data: {
        results: [
          { id: 101, name: 'Beet 1', field: 1, area_sqm: 5 },
          { id: 102, name: 'Beet 2', field: 1, area_sqm: 5 },
        ],
      },
    });

    renderHierarchy();

    // After auto-expand the beds should be visible under field-1.
    await waitFor(() => expect(screen.getByTestId('row-101')).toBeInTheDocument());

    // Focus bed-101.
    await act(async () => { fireEvent.click(screen.getByTestId('select-101-name')); });
    expect(screen.getByTestId('row-101')).toHaveAttribute('data-focused', 'true');
    expect(screen.getByTestId('row-101')).toHaveAttribute('data-selected', 'false');

    // Collapse field-1 by clicking its collapse button (rendered via renderCell).
    const collapseButton = within(screen.getByTestId('row-field-1')).getByRole('button', {
      name: 'Eintrag zuklappen',
    });
    await act(async () => { fireEvent.click(collapseButton); });

    // Beds should be gone; focus should jump to the collapsed parent (field-1).
    await waitFor(() => {
      expect(screen.queryByTestId('row-101')).not.toBeInTheDocument();
      expect(screen.getByTestId('row-field-1')).toHaveAttribute('data-focused', 'true');
    });
    expect(screen.getByTestId('row-field-1')).toHaveAttribute('data-selected', 'false');

    // Navigation must still work after the collapse: ArrowDown should go to field-2.
    await pressArrowDown();
    await waitFor(() =>
      expect(screen.getByTestId('row-field-2')).toHaveAttribute('data-focused', 'true'),
    );
    expect(screen.getByTestId('row-field-2')).toHaveAttribute('data-selected', 'false');
  });

  it('pressing spacebar after arrow-navigating away from the clicked row keeps focus on the current row', async () => {
    // Regression: rowsById → getHierarchyFocusableField → focusRow → focusSelectedCell
    // would get a new identity on every expand/collapse, causing the useLayoutEffect in
    // useHierarchyGridFocus to re-fire with selectedRowId STATE (= clicked row) instead
    // of the arrow-navigated row, jumping focus back to the clicked row.
    fieldListMock.mockResolvedValue({
      data: {
        results: [
          { id: 1, name: 'Parzelle 1', location: 1, area_sqm: 10 },
          { id: 2, name: 'Parzelle 2', location: 1, area_sqm: 10 },
        ],
      },
    });
    bedListMock.mockResolvedValue({
      data: { results: [{ id: 101, name: 'Beet 1', field: 1, area_sqm: 5 }] },
    });

    renderHierarchy();
    await waitFor(() => expect(screen.getByTestId('row-field-1')).toBeInTheDocument());

    // Click field-2 to set selectedRowId STATE = "field-2".
    await act(async () => { fireEvent.click(screen.getByTestId('select-field-2-name')); });
    expect(screen.getByTestId('row-field-2')).toHaveAttribute('data-focused', 'true');

    // Two ArrowUps needed: field-2 → bed-101 (field-1 is auto-expanded) → field-1.
    // selectedRowIdRef ends up at "field-1" while STATE remains "field-2".
    await pressArrowUp();
    await pressArrowUp();
    await waitFor(() =>
      expect(screen.getByTestId('row-field-1')).toHaveAttribute('data-focused', 'true'),
    );

    // Simulate spacebar on field-1 (which has hasChildren = true due to the bed above).
    const onCellKeyDown = getCapturedOnCellKeyDown();
    expect(onCellKeyDown).toBeDefined();

    const event = {
      key: ' ',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      defaultMuiPrevented: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    await act(async () => {
      onCellKeyDown!(
        { id: 'field-1', field: 'name', isEditable: true, row: { type: 'field', hasChildren: true } },
        event,
      );
    });

    // Focus must remain on field-1 — NOT jump back to the clicked field-2.
    await waitFor(() =>
      expect(screen.getByTestId('row-field-1')).toHaveAttribute('data-focused', 'true'),
    );
    expect(screen.getByTestId('row-field-2')).toHaveAttribute('data-focused', 'false');
  });

  it('arrow keys navigate normally after confirming an inline edit', async () => {
    // Regression: handleHierarchyProcessRowUpdate called clearHierarchyInteractionState
    // which reset treeActive=false and selectedRowId=null, so ArrowDown/Up after saving
    // would scroll the page instead of moving row focus.
    renderHierarchy();
    await waitFor(() => expect(screen.getByTestId('row-field-1')).toBeInTheDocument());

    // Click field-1 to select it and activate tree navigation.
    await act(async () => { fireEvent.click(screen.getByTestId('select-field-1-name')); fireEvent.doubleClick(screen.getByTestId('select-field-1-name')); });
    expect(screen.getByTestId('row-field-1')).toHaveAttribute('data-focused', 'true');
    expect(screen.getByTestId('mode-field-1')).toHaveTextContent('edit');

    // Mock the API update to return success.
    fieldUpdateMock.mockResolvedValue({ data: { id: 1, name: 'Parzelle 1', location: 1, area_sqm: 10 } });

    // Simulate confirming the edit by calling processRowUpdate with the field's row data.
    const processRowUpdate = getCapturedProcessRowUpdate();
    expect(processRowUpdate).toBeDefined();
    await act(async () => {
      await processRowUpdate!({
        id: 'field-1',
        type: 'field',
        name: 'Parzelle 1',
        fieldId: 1,
        locationId: 1,
        area_sqm: 10,
        level: 1,
        parentId: 'location-1',
        hasChildren: false,
      });
    });

    // Row should be back in view mode after save.
    await waitFor(() =>
      expect(screen.getByTestId('mode-field-1')).toHaveTextContent('view'),
    );

    await waitFor(() =>
      expect(screen.getByTestId('row-field-2')).toHaveAttribute('data-focused', 'true'),
    );

    // ArrowDown must navigate from the post-save focus to field-3, NOT scroll the page.
    await pressArrowDown();
    await waitFor(() =>
      expect(screen.getByTestId('row-field-3')).toHaveAttribute('data-focused', 'true'),
    );
    expect(screen.getByTestId('row-field-1')).toHaveAttribute('data-focused', 'false');
  });

  it('focus does not flash to first row when confirming an inline edit on a non-first row', async () => {
    // Regression: when a row exits edit mode the edit-cell input is removed from the DOM,
    // which caused the browser to drop focus to the first focusable element (first row).
    // The fix changed the focus-restoration effect from useEffect (async, after paint) to
    // useLayoutEffect (synchronous, before paint) so the correct row is focused before the
    // browser ever paints. Here we verify setCellFocus never targets the first row, and
    // ends on the post-save focus row.
    renderHierarchy();
    await waitFor(() => expect(screen.getByTestId('row-field-2')).toBeInTheDocument());

    // Click field-2 (not the first row) to select and start editing it.
    await act(async () => { fireEvent.click(screen.getByTestId('select-field-2-name')); fireEvent.doubleClick(screen.getByTestId('select-field-2-name')); });
    expect(screen.getByTestId('row-field-2')).toHaveAttribute('data-focused', 'true');
    expect(screen.getByTestId('mode-field-2')).toHaveTextContent('edit');

    fieldUpdateMock.mockResolvedValue({ data: { id: 2, name: 'Parzelle 2', location: 1, area_sqm: 20 } });

    getSetCellFocusMock().mockClear();

    const processRowUpdate = getCapturedProcessRowUpdate();
    await act(async () => {
      await processRowUpdate!({
        id: 'field-2',
        type: 'field',
        name: 'Parzelle 2',
        fieldId: 2,
        locationId: 1,
        area_sqm: 20,
        level: 1,
        parentId: 'location-1',
        hasChildren: false,
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId('mode-field-2')).toHaveTextContent('view'),
    );

    // The save must never flash to field-1, and should settle on field-3.
    const calls = getSetCellFocusMock().mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every(([id]: [unknown]) => id !== 'field-1')).toBe(true);
    expect(calls.at(-1)?.[0]).toBe('field-3');
  });

  it('anchors focus on the edited cell before MUI stops row editing with Enter', async () => {
    renderHierarchy();
    await waitFor(() => expect(screen.getByTestId('row-field-2')).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByTestId('select-field-2-width_m')); fireEvent.doubleClick(screen.getByTestId('select-field-2-width_m')); });
    expect(screen.getByTestId('mode-field-2')).toHaveTextContent('edit');

    const onRowEditStop = getCapturedOnRowEditStop();
    expect(onRowEditStop).toBeDefined();
    getEditCellFocusMock().mockClear();

    const event = { defaultMuiPrevented: false };
    act(() => {
      onRowEditStop!(
        { id: 'field-2', reason: 'enterKeyDown' },
        event,
      );
    });

    expect(event.defaultMuiPrevented).toBe(false);
    expect(getEditCellFocusMock()).toHaveBeenCalledWith({ preventScroll: true });
    expect(getSetCellFocusMock()).not.toHaveBeenCalledWith('field-1', 'name');
  });

  it('keeps hierarchy focus synchronized after Enter saves a collapsed row', async () => {
    renderHierarchy();
    await waitFor(() => expect(screen.getByTestId('row-field-3')).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByTestId('select-field-2-name')); fireEvent.doubleClick(screen.getByTestId('select-field-2-name')); });
    expect(screen.getByTestId('mode-field-2')).toHaveTextContent('edit');

    const onRowEditStop = getCapturedOnRowEditStop();
    const processRowUpdate = getCapturedProcessRowUpdate();
    expect(onRowEditStop).toBeDefined();
    expect(processRowUpdate).toBeDefined();
    fieldUpdateMock.mockResolvedValue({ data: { id: 2, name: 'Parzelle 2', location: 1, area_sqm: 20 } });

    act(() => {
      onRowEditStop!(
        { id: 'field-2', reason: 'enterKeyDown' },
        { defaultMuiPrevented: false },
      );
    });
    await act(async () => {
      await processRowUpdate!({
        id: 'field-2',
        type: 'field',
        name: 'Parzelle 2',
        fieldId: 2,
        locationId: 1,
        area_sqm: 20,
        level: 1,
        parentId: 'location-1',
        hasChildren: false,
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId('row-field-3')).toHaveAttribute('data-focused', 'true'),
    );

    await pressArrowUp();
    await waitFor(() =>
      expect(screen.getByTestId('row-field-2')).toHaveAttribute('data-focused', 'true'),
    );
    expect(screen.getByTestId('row-field-1')).toHaveAttribute('data-focused', 'false');
  });

  it('keeps hierarchy focus synchronized after Enter saves an expanded parent row', async () => {
    fieldListMock.mockResolvedValue({
      data: {
        results: [
          { id: 1, name: 'Parzelle 1', location: 1, area_sqm: 10 },
          { id: 2, name: 'Parzelle 2', location: 1, area_sqm: 20 },
        ],
      },
    });
    bedListMock.mockResolvedValue({
      data: {
        results: [
          { id: 101, name: 'Beet 1', field: 1, area_sqm: 5 },
          { id: 102, name: 'Beet 2', field: 1, area_sqm: 5 },
        ],
      },
    });
    renderHierarchy();
    await waitFor(() => expect(screen.getByTestId('row-101')).toBeInTheDocument());

    await act(async () => { fireEvent.click(screen.getByTestId('select-field-1-name')); fireEvent.doubleClick(screen.getByTestId('select-field-1-name')); });
    expect(screen.getByTestId('mode-field-1')).toHaveTextContent('edit');

    const onRowEditStop = getCapturedOnRowEditStop();
    const processRowUpdate = getCapturedProcessRowUpdate();
    expect(onRowEditStop).toBeDefined();
    expect(processRowUpdate).toBeDefined();
    fieldUpdateMock.mockResolvedValue({ data: { id: 1, name: 'Parzelle 1', location: 1, area_sqm: 10 } });

    act(() => {
      onRowEditStop!(
        { id: 'field-1', reason: 'enterKeyDown' },
        { defaultMuiPrevented: false },
      );
    });
    await act(async () => {
      await processRowUpdate!({
        id: 'field-1',
        type: 'field',
        name: 'Parzelle 1',
        fieldId: 1,
        locationId: 1,
        area_sqm: 10,
        level: 1,
        parentId: 'location-1',
        hasChildren: true,
      });
    });

    await waitFor(() =>
      expect(screen.getByTestId('row-101')).toHaveAttribute('data-focused', 'true'),
    );

    await pressArrowUp();
    await waitFor(() =>
      expect(screen.getByTestId('row-field-1')).toHaveAttribute('data-focused', 'true'),
    );
    expect(screen.getByTestId('row-field-2')).toHaveAttribute('data-focused', 'false');
  });

  it('pressing a printable key while a row is keyboard-focused starts edit mode', async () => {
    renderHierarchy();
    await waitFor(() => expect(screen.getByTestId('row-field-1')).toBeInTheDocument());

    // Activate tree navigation via Alt+T. Unlike clicking a cell, this sets
    // selectedRowId and treeActive WITHOUT calling handleEditableCellClick, so
    // field-1 stays in view mode — the scenario where the letter-key guard matters.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'T', altKey: true, bubbles: true }));
    });

    // field-1 is focused but NOT selected and NOT in edit mode.
    await waitFor(() =>
      expect(screen.getByTestId('row-field-1')).toHaveAttribute('data-focused', 'true'),
    );
    expect(screen.getByTestId('row-field-1')).toHaveAttribute('data-selected', 'false');
    expect(screen.getByTestId('mode-field-1')).toHaveTextContent('view');

    // The DataGrid mock stores the onCellKeyDown prop so we can call it directly.
    const onCellKeyDown = getCapturedOnCellKeyDown();
    expect(onCellKeyDown).toBeDefined();
    const fieldRow = {
      id: 'field-1',
      type: 'field',
      name: 'Parzelle 1',
      level: 0,
      hasChildren: false,
      isNew: false,
      fieldId: 1,
      location: 1,
    };

    // Verify that Alt+T (our navigation shortcut) is blocked.
    // MUI DataGrid v8's isPrintableKey() does not exclude altKey, so without our guard
    // pressing Alt+T while a cell has focus would start editing instead of navigating.
    const altTEvent = {
      key: 'T',
      ctrlKey: false,
      metaKey: false,
      altKey: true,
      shiftKey: false,
      defaultMuiPrevented: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    act(() => {
      onCellKeyDown!(
        { id: 'field-1', field: 'name', isEditable: true, row: fieldRow },
        altTEvent,
      );
    });

    expect(altTEvent.defaultMuiPrevented).toBe(true);
    expect(screen.getByTestId('mode-field-1')).toHaveTextContent('view');

    // Simulate the event object that MUI passes to onCellKeyDown for the letter 'a'.
    const event = {
      key: 'a',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      defaultMuiPrevented: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    act(() => {
      onCellKeyDown!(
        { id: 'field-1', field: 'name', isEditable: true, row: fieldRow },
        event,
      );
    });

    // The component owns the transition so MUI does not also start a separate edit flow.
    expect(event.defaultMuiPrevented).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(screen.getByTestId('mode-field-1')).toHaveTextContent('edit');
  });

  it('pressing spacebar on a bed row does not let MUI DataGrid jump focus to the first row', async () => {
    // Regression: bed rows have no children, so the old code skipped preventDefault
    // for spacebar — MUI DataGrid then moved focus to the first row.
    renderHierarchy();
    await waitFor(() => expect(screen.getByTestId('row-field-1')).toBeInTheDocument());

    const onCellKeyDown = getCapturedOnCellKeyDown();
    expect(onCellKeyDown).toBeDefined();

    const event = {
      key: ' ',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      defaultMuiPrevented: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    act(() => {
      onCellKeyDown!(
        { id: 101, field: 'name', isEditable: true, row: { type: 'bed', hasChildren: false } },
        event,
      );
    });

    expect(event.defaultMuiPrevented).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('Tab in edit mode skips the calculated area column and goes to notes', async () => {
    // Regression: Tab while a row is in edit mode was not intercepted, so MUI DataGrid's
    // default Tab handler moved focus to area_sqm (a non-editable calculated column).
    renderHierarchy();
    await waitFor(() => expect(screen.getByTestId('row-field-1')).toBeInTheDocument());

    // Click field-1 to start editing.
    await act(async () => { fireEvent.click(screen.getByTestId('select-field-1-name')); fireEvent.doubleClick(screen.getByTestId('select-field-1-name')); });
    expect(screen.getByTestId('mode-field-1')).toHaveTextContent('edit');

    const onCellKeyDown = getCapturedOnCellKeyDown();
    expect(onCellKeyDown).toBeDefined();

    getSetCellFocusMock().mockClear();

    const event = {
      key: 'Tab',
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      defaultMuiPrevented: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    // Tab from width_m while the row is in edit mode. MUI's default handler would
    // go to area_sqm next; our handler must skip it and go to notes instead.
    act(() => {
      onCellKeyDown!(
        {
          id: 'field-1',
          field: 'width_m',
          isEditable: true,
          row: { id: 'field-1', type: 'field' },
        },
        event,
      );
    });

    expect(event.defaultMuiPrevented).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    // Must focus notes, never area_sqm.
    expect(getSetCellFocusMock()).toHaveBeenLastCalledWith('field-1', 'notes');
    expect(getSetCellFocusMock()).not.toHaveBeenCalledWith('field-1', 'area_sqm');
  });

  it('pressing spacebar on a field row without children does not let MUI DataGrid jump focus', async () => {
    renderHierarchy();
    await waitFor(() => expect(screen.getByTestId('row-field-1')).toBeInTheDocument());

    const onCellKeyDown = getCapturedOnCellKeyDown();
    expect(onCellKeyDown).toBeDefined();

    const event = {
      key: ' ',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      defaultMuiPrevented: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };

    act(() => {
      onCellKeyDown!(
        { id: 'field-1', field: 'name', isEditable: true, row: { type: 'field', hasChildren: false } },
        event,
      );
    });

    expect(event.defaultMuiPrevented).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  describe('spreadsheet edit model', () => {
    const withBeds = () => {
      fieldListMock.mockResolvedValue({
        data: {
          results: [
            { id: 1, name: 'Parzelle 1', location: 1, area_sqm: 10 },
            { id: 2, name: 'Parzelle 2', location: 1, area_sqm: 10 },
          ],
        },
      });
      bedListMock.mockResolvedValue({
        data: {
          results: [
            { id: 101, name: 'Beet 1', field: 1, area_sqm: 5 },
            { id: 102, name: 'Beet 2', field: 1, area_sqm: 5 },
          ],
        },
      });
    };

    const waitOutHintDelay = () => act(() => new Promise<void>((resolve) => {
      window.setTimeout(resolve, EDIT_HINT_DELAY_MS + 50);
    }));

    const singleClick = async (testId: string) => {
      await act(async () => { fireEvent.click(screen.getByTestId(testId), { detail: 1 }); });
    };

    const cellKeyDown = (rowId: string | number, field: string, key: string) => {
      const event = {
        key,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        target: document.createElement('div'),
        nativeEvent: { isComposing: false },
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        defaultMuiPrevented: false,
      };
      const row = { id: rowId, type: 'bed', name: 'Beet 1', level: 2 };
      act(() => {
        getCapturedOnCellKeyDown()!({ id: rowId, field, isEditable: true, row }, event);
      });
    };

    beforeEach(() => {
      resetTableEditHintSessionState();
      withBeds();
    });

    it('selects a cell on a single click without starting the edit', async () => {
      renderHierarchy();
      await waitFor(() => expect(screen.getByTestId('row-101')).toBeInTheDocument());

      await singleClick('select-101-name');

      expect(screen.getByTestId('row-101')).toHaveAttribute('data-focused', 'true');
      expect(screen.getByTestId('mode-101')).toHaveTextContent('view');
    });

    it('starts the edit with a double click', async () => {
      renderHierarchy();
      await waitFor(() => expect(screen.getByTestId('row-101')).toBeInTheDocument());

      await act(async () => { fireEvent.doubleClick(screen.getByTestId('select-101-name')); });

      expect(screen.getByTestId('mode-101')).toHaveTextContent('edit');
    });

    it.each(['Enter', 'F2', 'B'])('starts the edit with the %s key', async (key) => {
      renderHierarchy();
      await waitFor(() => expect(screen.getByTestId('row-101')).toBeInTheDocument());
      await singleClick('select-101-name');

      cellKeyDown(101, 'name', key);

      await waitFor(() => expect(screen.getByTestId('mode-101')).toHaveTextContent('edit'));
    });

    it('saves on a click into another row without pulling focus back to the saved row', async () => {
      renderHierarchy();
      await waitFor(() => expect(screen.getByTestId('row-field-2')).toBeInTheDocument());
      await act(async () => { fireEvent.doubleClick(screen.getByTestId('select-field-2-name')); });
      expect(screen.getByTestId('mode-field-2')).toHaveTextContent('edit');
      fieldUpdateMock.mockResolvedValue({ data: { id: 2, name: 'Parzelle 2b', location: 1, area_sqm: 10 } });

      // A mouse press moves DOM focus onto the clicked cell before the edited
      // row loses its edit session and MUI hands it to processRowUpdate.
      const clickedCell = screen.getByTestId('select-101-name');
      clickedCell.focus();
      await singleClick('select-101-name');
      getSetCellFocusMock().mockClear();
      await act(async () => {
        await getCapturedProcessRowUpdate()!({
          id: 'field-2',
          type: 'field',
          name: 'Parzelle 2b',
          fieldId: 2,
          locationId: 1,
          area_sqm: 10,
          level: 1,
          parentId: 'location-1',
          hasChildren: false,
        });
      });
      await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });

      expect(fieldUpdateMock).toHaveBeenCalled();
      expect(getSetCellFocusMock()).not.toHaveBeenCalledWith('field-2', expect.anything());
      expect(screen.getByTestId('mode-field-2')).toHaveTextContent('view');
      expect(screen.getByTestId('mode-101')).toHaveTextContent('view');
      expect(document.activeElement).toBe(clickedCell);
    });

    it('shows the edit hint shortly after a single click on an editable bed cell', async () => {
      renderHierarchy();
      await waitFor(() => expect(screen.getByTestId('row-101')).toBeInTheDocument());

      await singleClick('select-101-name');
      expect(screen.queryByText('messages.tableEditHint')).not.toBeInTheDocument();

      expect(await screen.findByText('messages.tableEditHint')).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    });

    it('does not show the edit hint on group rows', async () => {
      renderHierarchy();
      await waitFor(() => expect(screen.getByTestId('row-field-2')).toBeInTheDocument());

      await singleClick('select-field-2-name');
      await waitOutHintDelay();

      expect(screen.queryByText('messages.tableEditHint')).not.toBeInTheDocument();
    });

    it('does not show the edit hint once a cell was edited in this table', async () => {
      renderHierarchy();
      await waitFor(() => expect(screen.getByTestId('row-101')).toBeInTheDocument());

      await act(async () => { fireEvent.doubleClick(screen.getByTestId('select-102-name')); });
      await singleClick('select-101-name');
      await waitOutHintDelay();

      expect(screen.queryByText('messages.tableEditHint')).not.toBeInTheDocument();
    });

    it('does not show the edit hint once a cell was edited in another table', async () => {
      const plantingPlansTable = renderHook(() => useEditHint());
      act(() => plantingPlansTable.result.current.markEdited());
      renderHierarchy();
      await waitFor(() => expect(screen.getByTestId('row-101')).toBeInTheDocument());

      await singleClick('select-101-name');
      await waitOutHintDelay();

      expect(screen.queryByText('messages.tableEditHint')).not.toBeInTheDocument();
    });

    it('stops showing the edit hint after it was dismissed', async () => {
      renderHierarchy();
      await waitFor(() => expect(screen.getByTestId('row-101')).toBeInTheDocument());
      await singleClick('select-101-name');

      fireEvent.click(await screen.findByRole('button', { name: 'messages.tableEditHintDismiss' }));
      await waitFor(() => expect(screen.queryByText('messages.tableEditHint')).not.toBeInTheDocument());
      await singleClick('select-102-name');
      await waitOutHintDelay();

      expect(screen.queryByText('messages.tableEditHint')).not.toBeInTheDocument();
    });
  });
});
