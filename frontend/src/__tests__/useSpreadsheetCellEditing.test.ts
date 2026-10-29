import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GridCellParams, GridColDef, GridRowModesModel } from '@mui/x-data-grid';
import { resetTableEditHintSessionState } from '../components/data-grid/useEditHint';
import { EDIT_HINT_DELAY_MS, useSpreadsheetCellEditing } from '../components/data-grid/useSpreadsheetCellEditing';
import { EDITABLE_CELL_CLASS } from '../components/data-grid/styles';

interface TestRow {
  id: number;
  name: string;
  type: 'bed' | 'group';
}

const makeCellParams = (
  overrides: Partial<GridCellParams<TestRow>> & { columnType?: GridColDef['type'] } = {},
): GridCellParams<TestRow> => {
  const { columnType = 'string', ...rest } = overrides;
  return {
    id: 1,
    field: 'name',
    isEditable: true,
    row: { id: 1, name: 'Beet 1', type: 'bed' },
    colDef: { field: rest.field ?? 'name', type: columnType } as GridColDef,
    ...rest,
  } as GridCellParams<TestRow>;
};

const makeMouseEvent = (
  overrides: { detail?: number; pointerType?: string; target?: Element } = {},
): React.MouseEvent => {
  const cell = document.createElement('div');
  return {
    detail: overrides.detail ?? 1,
    button: 0,
    target: overrides.target ?? cell,
    currentTarget: cell,
    nativeEvent: { pointerType: overrides.pointerType ?? 'mouse' },
  } as unknown as React.MouseEvent;
};

const makeKeyEvent = (key: string): React.KeyboardEvent => ({
  key,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  target: document.createElement('div'),
  nativeEvent: { isComposing: false },
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
} as unknown as React.KeyboardEvent);

const renderCellEditing = (spreadsheetMode = true) => {
  const apiRef = {
    current: {
      getCellElement: vi.fn(() => null),
      isCellEditable: vi.fn(() => true),
      setCellFocus: vi.fn(),
      setEditCellValue: vi.fn(() => true),
    },
  };
  const onEditStarted = vi.fn();
  const hook = renderHook(() => {
    const [rowModesModel, setRowModesModel] = useState<GridRowModesModel>({});
    const cellEditing = useSpreadsheetCellEditing<TestRow>({
      spreadsheetMode,
      apiRef,
      rowModesModel,
      setRowModesModel,
      isCellEditable: (params) => params.field !== 'notes',
      isHintEligible: (params) => params.row?.type === 'bed',
      onEditStarted,
    });
    return { cellEditing, rowModesModel };
  });
  return { ...hook, apiRef, onEditStarted };
};

const isEditing = (rowModesModel: GridRowModesModel): boolean => rowModesModel[1]?.mode === 'edit';

describe('useSpreadsheetCellEditing', () => {
  beforeEach(() => {
    resetTableEditHintSessionState();
  });

  it('only selects on a single click', () => {
    const { result } = renderCellEditing();

    act(() => {
      result.current.cellEditing.handleCellClick(makeCellParams(), makeMouseEvent());
    });

    expect(isEditing(result.current.rowModesModel)).toBe(false);
  });

  it.each([
    ['double click', (editing: ReturnType<typeof renderCellEditing>['result']['current']['cellEditing']) => {
      editing.handleCellDoubleClick(makeCellParams(), makeMouseEvent({ detail: 2 }));
    }],
    ['Enter', (editing: ReturnType<typeof renderCellEditing>['result']['current']['cellEditing']) => {
      editing.handleCellKeyDown(makeCellParams(), makeKeyEvent('Enter'));
    }],
    ['F2', (editing: ReturnType<typeof renderCellEditing>['result']['current']['cellEditing']) => {
      editing.handleCellKeyDown(makeCellParams(), makeKeyEvent('F2'));
    }],
    ['typing', (editing: ReturnType<typeof renderCellEditing>['result']['current']['cellEditing']) => {
      editing.handleCellKeyDown(makeCellParams(), makeKeyEvent('B'));
    }],
  ])('starts editing with %s', (_trigger, startEdit) => {
    const { result, onEditStarted } = renderCellEditing();

    act(() => startEdit(result.current.cellEditing));

    expect(isEditing(result.current.rowModesModel)).toBe(true);
    expect(onEditStarted).toHaveBeenCalledTimes(1);
  });

  it('replaces the value with the typed character', () => {
    const { result, apiRef } = renderCellEditing();

    act(() => {
      result.current.cellEditing.handleCellKeyDown(makeCellParams(), makeKeyEvent('B'));
    });

    expect(apiRef.current.setEditCellValue).toHaveBeenCalledWith({ id: 1, field: 'name', value: 'B' });
  });

  it.each(['date', 'singleSelect'] as const)('does not start a %s cell by typing, only by Enter', (columnType) => {
    const { result, apiRef } = renderCellEditing();
    const params = makeCellParams({ columnType });

    act(() => {
      result.current.cellEditing.handleCellKeyDown(params, makeKeyEvent('1'));
    });
    expect(isEditing(result.current.rowModesModel)).toBe(false);
    expect(apiRef.current.setEditCellValue).not.toHaveBeenCalled();

    act(() => {
      result.current.cellEditing.handleCellKeyDown(params, makeKeyEvent('Enter'));
    });
    expect(isEditing(result.current.rowModesModel)).toBe(true);
  });

  it('ignores a double click on a control inside the cell', () => {
    const { result } = renderCellEditing();
    const event = makeMouseEvent({ detail: 2 });
    const button = document.createElement('button');
    (event.currentTarget as Element).appendChild(button);
    Object.assign(event, { target: button });

    act(() => result.current.cellEditing.handleCellDoubleClick(makeCellParams(), event));

    expect(isEditing(result.current.rowModesModel)).toBe(false);
  });

  it('keeps tap-to-edit outside the spreadsheet mode', () => {
    const { result } = renderCellEditing(false);

    act(() => {
      result.current.cellEditing.handleCellClick(makeCellParams(), makeMouseEvent({ pointerType: 'touch' }));
    });

    expect(isEditing(result.current.rowModesModel)).toBe(true);
  });

  describe('edit hint', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const click = (
      result: ReturnType<typeof renderCellEditing>['result'],
      params = makeCellParams(),
      event = makeMouseEvent(),
    ) => {
      act(() => {
        result.current.cellEditing.handleCellClick(params, event);
      });
    };

    const waitOutDoubleClickInterval = () => {
      act(() => {
        vi.advanceTimersByTime(EDIT_HINT_DELAY_MS);
      });
    };

    it('appears shortly after a single click on an editable cell', () => {
      const { result } = renderCellEditing();

      click(result);
      expect(result.current.cellEditing.editHint.open).toBe(false);
      waitOutDoubleClickInterval();

      expect(result.current.cellEditing.editHint.open).toBe(true);
    });

    it('does not appear when the click turns out to be a double click', () => {
      const { result } = renderCellEditing();

      click(result);
      act(() => {
        result.current.cellEditing.handleCellDoubleClick(makeCellParams(), makeMouseEvent({ detail: 2 }));
      });
      waitOutDoubleClickInterval();

      expect(result.current.cellEditing.editHint.open).toBe(false);
      expect(result.current.rowModesModel[1]?.mode).toBe('edit');
    });

    it('does not appear when a key is pressed right after the click', () => {
      const { result } = renderCellEditing();

      click(result);
      act(() => {
        result.current.cellEditing.handleCellKeyDown(makeCellParams(), makeKeyEvent('ArrowRight'));
      });
      waitOutDoubleClickInterval();

      expect(result.current.cellEditing.editHint.open).toBe(false);
    });

    it('does not appear for keyboard-generated clicks or the second click of a double click', () => {
      const { result } = renderCellEditing();

      click(result, makeCellParams(), makeMouseEvent({ detail: 0 }));
      waitOutDoubleClickInterval();
      click(result, makeCellParams(), makeMouseEvent({ detail: 2 }));
      waitOutDoubleClickInterval();

      expect(result.current.cellEditing.editHint.open).toBe(false);
    });

    it('does not appear on read-only cells or group rows', () => {
      const { result } = renderCellEditing();

      click(result, makeCellParams({ field: 'area', isEditable: false }));
      waitOutDoubleClickInterval();
      click(result, makeCellParams({ field: 'notes' }));
      waitOutDoubleClickInterval();
      click(result, makeCellParams({ row: { id: 1, name: 'Hof', type: 'group' } }));
      waitOutDoubleClickInterval();

      expect(result.current.cellEditing.editHint.open).toBe(false);
    });

    it.each([
      ['Enter', 'Enter'],
      ['F2', 'F2'],
      ['typing', 'B'],
    ])('does not appear after the user once started an edit with %s', (_trigger, key) => {
      const { result } = renderCellEditing();

      act(() => {
        result.current.cellEditing.handleCellKeyDown(makeCellParams({ id: 2 }), makeKeyEvent(key));
      });
      click(result);
      waitOutDoubleClickInterval();

      expect(result.current.cellEditing.editHint.open).toBe(false);
    });

    it('does not appear outside the spreadsheet mode', () => {
      const { result } = renderCellEditing(false);

      click(result, makeCellParams({ isEditable: false }));
      waitOutDoubleClickInterval();

      expect(result.current.cellEditing.editHint.open).toBe(false);
    });
  });

  it('marks editable cells for the hover state only in the spreadsheet mode', () => {
    const spreadsheet = renderCellEditing(true);
    const touch = renderCellEditing(false);

    expect(spreadsheet.result.current.cellEditing.getEditableCellClassName(makeCellParams())).toBe(EDITABLE_CELL_CLASS);
    expect(spreadsheet.result.current.cellEditing.getEditableCellClassName(makeCellParams({ field: 'notes' }))).toBe('');
    expect(spreadsheet.result.current.cellEditing.getEditableCellClassName(makeCellParams({ isEditable: false }))).toBe('');
    expect(touch.result.current.cellEditing.getEditableCellClassName(makeCellParams())).toBe('');
  });
});
