/**
 * Unit tests for useHierarchyGridFocus.
 *
 * These tests verify focus-restoration behaviour that is difficult to cover
 * at the component level because the critical scenarios depend on the
 * internal relationship between selectedRowId React state and the
 * selectedRowIdRef that is updated transiently during arrow-key navigation.
 */

import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GridRowModes } from '@mui/x-data-grid';
import type { GridRowModesModel } from '@mui/x-data-grid';
import { isFocusOnOtherRowCell, useHierarchyGridFocus } from '../components/hierarchy/hooks/useHierarchyGridFocus';
import type { HierarchyRow } from '../components/hierarchy/utils/types';

const makeRow = (id: string, type: HierarchyRow['type'] = 'field'): HierarchyRow => ({
  id,
  type,
  name: id,
  level: 0,
  hasChildren: false,
  isNew: false,
});

const ROWS: HierarchyRow[] = [
  makeRow('field-1'),
  makeRow('field-2'),
  makeRow('field-3'),
];

const ROWS_WITH_NUMERIC_BED_ID: HierarchyRow[] = [
  makeRow('field-1'),
  {
    id: 2,
    type: 'bed',
    name: 'Bed 2',
    level: 1,
    hasChildren: false,
    isNew: false,
  },
];

interface HookProps {
  rowModesModel: GridRowModesModel;
  selectedRowId: string | number | null;
  treeActive: boolean;
}

const renderFocusHook = (initialProps: HookProps) => {
  const setCellFocus = vi.fn();
  const selectRow = vi.fn();
  const gridApiRef = { current: { setCellFocus } };

  const hookResult = renderHook(
    ({ rowModesModel, selectedRowId, treeActive }: HookProps) =>
      useHierarchyGridFocus({
        gridApiRef,
        rowModesModel,
        rows: ROWS,
        selectRow,
        selectedRowId,
        treeActive,
      }),
    { initialProps },
  );

  return { ...hookResult, setCellFocus, selectRow };
};

const renderFocusHookWithRows = (
  initialProps: HookProps,
  rows: HierarchyRow[],
) => {
  const setCellFocus = vi.fn();
  const selectRow = vi.fn();
  const gridApiRef = { current: { setCellFocus } };

  const hookResult = renderHook(
    ({ rowModesModel, selectedRowId, treeActive }: HookProps) =>
      useHierarchyGridFocus({
        gridApiRef,
        rowModesModel,
        rows,
        selectRow,
        selectedRowId,
        treeActive,
      }),
    { initialProps },
  );

  return { ...hookResult, setCellFocus, selectRow };
};

describe('useHierarchyGridFocus', () => {
  it('focuses the edited row on Edit→View transition, not the stale selectedRowId', () => {
    // Reproduce the bug: user arrow-navigated to field-2 (only ref updated),
    // so selectedRowId state is still field-1 from the last click.
    const { rerender, setCellFocus, selectRow } = renderFocusHook({
      rowModesModel: { 'field-2': { mode: GridRowModes.Edit } },
      selectedRowId: 'field-1', // stale — last clicked row
      treeActive: true,
    });

    setCellFocus.mockClear();
    selectRow.mockClear();

    // Simulate save: row exits edit mode while selectedRowId state is still stale.
    act(() => {
      rerender({
        rowModesModel: {},
        selectedRowId: 'field-1', // still stale (state not updated yet)
        treeActive: true,
      });
    });

    // Must focus field-2 (the row that was being edited), not field-1 (the stale state).
    expect(setCellFocus).toHaveBeenCalledWith('field-2', 'name');
    const callsToField1 = setCellFocus.mock.calls.filter(([id]) => id === 'field-1');
    expect(callsToField1).toHaveLength(0);

    // State must be synced so subsequent arrow navigation starts from field-2.
    expect(selectRow).toHaveBeenCalledWith('field-2');
  });

  it('focuses selectedRowId when no editing row is identifiable in prevModel', () => {
    // Degenerate case: rowModesModel transitions from {} to {} (no editing row ever set).
    const { rerender, setCellFocus } = renderFocusHook({
      rowModesModel: {},
      selectedRowId: 'field-1',
      treeActive: true,
    });

    setCellFocus.mockClear();

    act(() => {
      rerender({
        rowModesModel: {},
        selectedRowId: 'field-2',
        treeActive: true,
      });
    });

    // No Edit→View transition — the selectedRowId change should trigger
    // the selectedRowId/treeActive effect and focus field-2.
    expect(setCellFocus).toHaveBeenCalledWith('field-2', 'name');
  });

  it('does not focus when treeActive is false', () => {
    const { rerender, setCellFocus } = renderFocusHook({
      rowModesModel: {},
      selectedRowId: 'field-1',
      treeActive: false,
    });

    setCellFocus.mockClear();

    act(() => {
      rerender({
        rowModesModel: {},
        selectedRowId: 'field-2',
        treeActive: false,
      });
    });

    expect(setCellFocus).not.toHaveBeenCalled();
  });

  it('does not trigger Edit→View restoration when only entering edit mode', () => {
    // Entering Edit mode must NOT call focusRow (that would fight with MUI's own
    // focus management for the edit cell).
    const { rerender, setCellFocus } = renderFocusHook({
      rowModesModel: {},
      selectedRowId: 'field-1',
      treeActive: true,
    });

    setCellFocus.mockClear();

    act(() => {
      rerender({
        rowModesModel: { 'field-1': { mode: GridRowModes.Edit } },
        selectedRowId: 'field-1',
        treeActive: true,
      });
    });

    // No Edit→View transition occurred — no restoration focus call expected.
    // (The existing cell click / MUI focus management handles the edit focus.)
    const restorationCalls = setCellFocus.mock.calls;
    // It's OK if setCellFocus was called (e.g. by the selectedRowId/treeActive effect),
    // but there must be no spurious call that would fight with the edit input focus.
    // Since field-1 was already selected and treeActive was already true, the
    // selectedRowId/treeActive effect also should not fire (deps didn't change).
    expect(restorationCalls).toHaveLength(0);
  });

  it('preFocusEditCell calls getCellElement().focus() for the remembered field', () => {
    const mockElement = { focus: vi.fn() };
    const getCellElement = vi.fn().mockReturnValue(mockElement);
    const selectRow = vi.fn();
    const gridApiRef = { current: { setCellFocus: vi.fn(), getCellElement } };

    const { result } = renderHook(() =>
      useHierarchyGridFocus({
        gridApiRef,
        rowModesModel: {},
        rows: ROWS,
        selectRow,
        selectedRowId: 'field-1',
        treeActive: true,
      }),
    );

    act(() => { result.current.rememberFocusedField('width_m'); });
    act(() => { result.current.preFocusEditCell('field-1'); });

    expect(getCellElement).toHaveBeenCalledWith('field-1', 'width_m');
    expect(mockElement.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('syncs selectedRowId state after focusing the edited row', () => {
    // After Edit→View, selectRow must be called so that subsequent
    // arrow navigation and useLayoutEffect([selectedRowId]) start from the
    // correct row.
    const { rerender, selectRow } = renderFocusHook({
      rowModesModel: { 'field-3': { mode: GridRowModes.Edit } },
      selectedRowId: 'field-1',
      treeActive: true,
    });

    selectRow.mockClear();

    act(() => {
      rerender({
        rowModesModel: {},
        selectedRowId: 'field-1',
        treeActive: true,
      });
    });

    expect(selectRow).toHaveBeenCalledWith('field-3');
  });

  it('restores focus with the numeric bed row id after Edit→View', () => {
    const { rerender, setCellFocus, selectRow } = renderFocusHookWithRows(
      {
        rowModesModel: { 2: { mode: GridRowModes.Edit } },
        selectedRowId: 'field-1',
        treeActive: true,
      },
      ROWS_WITH_NUMERIC_BED_ID,
    );

    setCellFocus.mockClear();
    selectRow.mockClear();

    act(() => {
      rerender({
        rowModesModel: {},
        selectedRowId: 'field-1',
        treeActive: true,
      });
    });

    expect(setCellFocus).toHaveBeenCalledWith(2, 'name');
    expect(setCellFocus).not.toHaveBeenCalledWith('2', 'name');
    expect(selectRow).toHaveBeenCalledWith(2);
  });
});

describe('isFocusOnOtherRowCell', () => {
  const renderRowWithCell = (rowId: string): HTMLElement => {
    const row = document.createElement('div');
    row.setAttribute('role', 'row');
    row.dataset.id = rowId;
    const cell = document.createElement('div');
    cell.setAttribute('role', 'gridcell');
    cell.tabIndex = -1;
    row.appendChild(cell);
    document.body.appendChild(row);
    return cell;
  };

  it('is true when a cell of another row holds the focus', () => {
    renderRowWithCell('field-1');
    const otherCell = renderRowWithCell('field-2');
    otherCell.focus();

    expect(isFocusOnOtherRowCell('field-1')).toBe(true);
    expect(isFocusOnOtherRowCell('field-1', 'field-2')).toBe(false);
    expect(isFocusOnOtherRowCell('field-2')).toBe(false);
    document.body.innerHTML = '';
  });

  it('is false when the focus is outside the grid', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();

    expect(isFocusOnOtherRowCell('field-1')).toBe(false);
    document.body.innerHTML = '';
  });
});
