import { act, renderHook } from '@testing-library/react';
import { useRowEditTracking } from '../components/data-grid/useRowEditTracking';

describe('useRowEditTracking', () => {
  it('starts with nothing tracked', () => {
    const { result } = renderHook(() => useRowEditTracking());

    expect(result.current.dirtyRowIds.size).toBe(0);
    expect(result.current.activeValidationErrors).toEqual({});
  });

  it('marks rows dirty', () => {
    const { result } = renderHook(() => useRowEditTracking());

    act(() => { result.current.markRowDirty('1'); });
    act(() => { result.current.markRowDirty('2'); });

    expect([...result.current.dirtyRowIds]).toEqual(['1', '2']);
  });

  it('keeps the same set when a row is already dirty', () => {
    const { result } = renderHook(() => useRowEditTracking());

    act(() => { result.current.markRowDirty('1'); });
    const first = result.current.dirtyRowIds;
    act(() => { result.current.markRowDirty('1'); });

    expect(result.current.dirtyRowIds).toBe(first);
  });

  it('records per-field errors under the row key', () => {
    const { result } = renderHook(() => useRowEditTracking());

    act(() => { result.current.setRowFieldErrors('1', { name: 'Pflichtfeld' }); });

    expect(result.current.activeValidationErrors).toEqual({ 1: { name: 'Pflichtfeld' } });
  });

  it('replaces the errors of a row rather than merging them', () => {
    const { result } = renderHook(() => useRowEditTracking());

    act(() => { result.current.setRowFieldErrors('1', { name: 'a', area: 'b' }); });
    act(() => { result.current.setRowFieldErrors('1', { area: 'c' }); });

    expect(result.current.activeValidationErrors['1']).toEqual({ area: 'c' });
  });

  it('forgets the dirty flag and the errors of a row together', () => {
    const { result } = renderHook(() => useRowEditTracking());

    act(() => {
      result.current.markRowDirty('1');
      result.current.markRowDirty('2');
      result.current.setRowFieldErrors('1', { name: 'Pflichtfeld' });
      result.current.setRowFieldErrors('2', { name: 'Pflichtfeld' });
    });
    act(() => { result.current.forgetRows('1'); });

    expect([...result.current.dirtyRowIds]).toEqual(['2']);
    expect(result.current.activeValidationErrors).toEqual({ 2: { name: 'Pflichtfeld' } });
  });

  it('forgets several keys at once, for a row tracked under both its temporary and saved id', () => {
    const { result } = renderHook(() => useRowEditTracking());

    act(() => {
      result.current.markRowDirty('temp-1');
      result.current.markRowDirty('42');
      result.current.setRowFieldErrors('temp-1', { name: 'Pflichtfeld' });
    });
    act(() => { result.current.forgetRows('temp-1', '42'); });

    expect(result.current.dirtyRowIds.size).toBe(0);
    expect(result.current.activeValidationErrors).toEqual({});
  });

  it('keeps both containers identical when forgetting an untracked row', () => {
    const { result } = renderHook(() => useRowEditTracking());

    act(() => { result.current.markRowDirty('1'); });
    const dirtyBefore = result.current.dirtyRowIds;
    const errorsBefore = result.current.activeValidationErrors;
    act(() => { result.current.forgetRows('does-not-exist'); });

    expect(result.current.dirtyRowIds).toBe(dirtyBefore);
    expect(result.current.activeValidationErrors).toBe(errorsBefore);
  });
});
