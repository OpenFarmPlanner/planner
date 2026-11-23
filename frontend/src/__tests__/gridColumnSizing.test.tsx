import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GridColDef } from '@mui/x-data-grid';
import { useGridColumnSizing } from '../components/data-grid/useGridColumnSizing';

const columns: GridColDef[] = [
  { field: 'crop', width: 180, minWidth: 120, maxWidth: 500 },
  { field: 'date', width: 115 },
  { field: 'notes', flex: 1 },
];

const storageKey = 'tableColumnWidths.1.2.plans';

function renderSizing() {
  return renderHook(
    ({ user, project, table }) => useGridColumnSizing(columns, table, user, project),
    { initialProps: { user: 1, project: 2, table: 'plans' } },
  );
}

describe('grid column sizing', () => {
  beforeEach(() => localStorage.clear());

  it('saves and restores only the resized fields, separately for each user, project and table', () => {
    const { result, rerender, unmount } = renderSizing();
    act(() => {
      for (const [field, width] of [['crop', 270], ['notes', 200]] as const) {
        result.current.onColumnWidthChange({ colDef: { field } as never, width, element: null }, {}, {} as never);
      }
    });
    expect(result.current.columns.map(({ width }) => width)).toEqual([270, 115, 200]);
    expect(result.current.columns[2].flex).toBe(0);
    for (const scope of [
      { user: 3, project: 2, table: 'plans' },
      { user: 1, project: 3, table: 'plans' },
      { user: 1, project: 2, table: 'areas' },
    ]) {
      rerender(scope);
      expect(result.current.columns[0].width).toBe(180);
    }
    rerender({ user: 1, project: 2, table: 'plans' });
    expect(result.current.columns[0].width).toBe(270);
    unmount();
    expect(renderSizing().result.current.columns[0].width).toBe(270);
  });

  it('clamps old widths and resets only the width preference', () => {
    localStorage.setItem(storageKey, '{"crop":900,"date":"wide","retired":91,"notes":180}');
    localStorage.setItem('tableColumns.plans', '{"date":false}');
    const { result } = renderSizing();
    expect(result.current.columns.map(({ width }) => width)).toEqual([500, 115, 180]);
    expect(result.current.widthReset.enabled).toBe(true);
    act(() => result.current.widthReset.reset());
    expect(result.current.columns[0].width).toBe(180);
    expect(result.current.columns[2].flex).toBe(1);
    expect(result.current.widthReset.enabled).toBe(false);
    expect(localStorage.getItem(storageKey)).toBeNull();
    expect(localStorage.getItem('tableColumns.plans')).toBe('{"date":false}');
  });

  it.each(['{', 'null', '[180]', '{"retired":300,"crop":180}'])('uses defaults for %s', saved => {
    localStorage.setItem(storageKey, saved);
    const { result } = renderSizing();
    expect(result.current.columns[0].width).toBe(180);
    expect(result.current.widthReset.enabled).toBe(false);
  });
});
