import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useColumnVisibility } from '../hooks/useColumnVisibility';

describe('useColumnVisibility', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('hides the default fields on a small screen when nothing is saved yet', () => {
    const { result } = renderHook(() =>
      useColumnVisibility({
        tableKey: 'plantingPlans',
        defaultHiddenFieldsOnSmallScreen: ['harvest_date', 'harvest_end_date'],
        isSmallScreen: true,
      }),
    );

    expect(result.current.columnVisibilityModel).toEqual({
      harvest_date: false,
      harvest_end_date: false,
    });
  });

  it('shows every column by default on a large screen', () => {
    const { result } = renderHook(() =>
      useColumnVisibility({
        tableKey: 'plantingPlans',
        defaultHiddenFieldsOnSmallScreen: ['harvest_date', 'harvest_end_date'],
        isSmallScreen: false,
      }),
    );

    expect(result.current.columnVisibilityModel).toEqual({});
  });

  it('persists a manual choice and keeps it across re-renders regardless of screen size', () => {
    const { result, rerender } = renderHook(
      ({ isSmallScreen }) =>
        useColumnVisibility({
          tableKey: 'plantingPlans',
          defaultHiddenFieldsOnSmallScreen: ['harvest_date', 'harvest_end_date'],
          isSmallScreen,
        }),
      { initialProps: { isSmallScreen: true } },
    );

    act(() => {
      result.current.setColumnVisibilityModel({ notes: false });
    });

    expect(result.current.columnVisibilityModel).toEqual({ notes: false });
    expect(JSON.parse(window.localStorage.getItem('tableColumns.plantingPlans') ?? '{}')).toEqual({
      notes: false,
    });

    // Screen size changes afterwards must not override the saved choice.
    rerender({ isSmallScreen: false });
    expect(result.current.columnVisibilityModel).toEqual({ notes: false });

    rerender({ isSmallScreen: true });
    expect(result.current.columnVisibilityModel).toEqual({ notes: false });
  });

  it('reads a saved choice on mount and ignores the small-screen default entirely', () => {
    window.localStorage.setItem('tableColumns.plantingPlans', JSON.stringify({ harvest_date: true }));

    const { result } = renderHook(() =>
      useColumnVisibility({
        tableKey: 'plantingPlans',
        defaultHiddenFieldsOnSmallScreen: ['harvest_date', 'harvest_end_date'],
        isSmallScreen: true,
      }),
    );

    expect(result.current.columnVisibilityModel).toEqual({ harvest_date: true });
  });

  it('migrates the legacy { autofit, model } storage format', () => {
    window.localStorage.setItem(
      'tableColumns.plantingPlans',
      JSON.stringify({ autofit: false, model: { notes: false } }),
    );

    const { result } = renderHook(() =>
      useColumnVisibility({ tableKey: 'plantingPlans' }),
    );

    expect(result.current.columnVisibilityModel).toEqual({ notes: false });
  });

  it('scopes storage per tableKey', () => {
    const { result } = renderHook(() =>
      useColumnVisibility({ tableKey: 'otherTable', defaultHiddenFieldsOnSmallScreen: ['x'], isSmallScreen: true }),
    );

    act(() => {
      result.current.setColumnVisibilityModel({ x: false });
    });

    expect(window.localStorage.getItem('tableColumns.plantingPlans')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem('tableColumns.otherTable') ?? '{}')).toEqual({ x: false });
  });

  it('keeps always-hidden optional columns hidden under an older saved model', () => {
    window.localStorage.setItem('tableColumns.fieldsBedsHierarchy', JSON.stringify({ notes: false }));
    const hidden = ['light_condition', 'irrigation'];

    const { result } = renderHook(() =>
      useColumnVisibility({ tableKey: 'fieldsBedsHierarchy', defaultHiddenFields: hidden }),
    );

    expect(result.current.columnVisibilityModel).toEqual({ light_condition: false, irrigation: false, notes: false });

    act(() => {
      result.current.setColumnVisibilityModel({ ...result.current.columnVisibilityModel, irrigation: true });
    });

    expect(result.current.columnVisibilityModel.irrigation).toBe(true);
    expect(result.current.columnVisibilityModel.light_condition).toBe(false);
  });
});
