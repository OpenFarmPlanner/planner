import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useCropImportState } from '../pages/useCropImportState';

describe('useCropImportState', () => {
  it('starts with empty idle state', () => {
    const { result } = renderHook(() => useCropImportState());

    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.previewCount).toBe(0);
    expect(result.current.hasImportableEntries).toBe(false);
  });

  it('keeps a partial result terminal after applying', () => {
    const { result } = renderHook(() => useCropImportState());

    act(() => {
      result.current.setPreviewReadyState({
        previewCount: 5,
        validCount: 3,
        invalidEntries: ['Invalid 1'],
        payload: [{ name: 'Carrot' }, { name: 'Lettuce' }, { name: 'Radish' }],
        previewResults: [{
          index: 0,
          status: 'create',
          import_data: { name: 'Carrot' },
        }],
      });
    });

    expect(result.current.state.status).toBe('ready');
    expect(result.current.hasImportableEntries).toBe(true);

    act(() => {
      result.current.startApply();
    });

    expect(result.current.state.status).toBe('applying');
    expect(result.current.hasImportableEntries).toBe(false);

    act(() => {
      result.current.finishApply({
        outcome: 'partial', error: 'Some items failed',
        failedEntries: [{ index: 1, error: 'duplicate' }],
        confirmedRows: [1], savedSummary: '1 crop saved', details: '', seedRateConstraints: null,
      });
    });

    expect(result.current.state.status).toBe('finished');
    expect(result.current.state.result?.failedEntries).toHaveLength(1);
    expect(result.current.state.result?.error).toBe('Some items failed');
    expect(result.current.hasImportableEntries).toBe(false);
  });

  it('resets state after success', () => {
    const { result } = renderHook(() => useCropImportState());

    act(() => {
      result.current.setPreviewReadyState({
        previewCount: 1,
        validCount: 1,
        invalidEntries: [],
        payload: [{ name: 'Bean' }],
        previewResults: [{
          index: 0,
          status: 'create',
          import_data: { name: 'Bean' },
        }],
      });
      result.current.startApply();
      result.current.finishApply({
        outcome: 'complete', error: null,
        failedEntries: [], confirmedRows: [1], savedSummary: 'Imported',
        details: '', seedRateConstraints: null,
      });
    });

    expect(result.current.state.status).toBe('finished');
    expect(result.current.state.result?.savedSummary).toBe('Imported');

    act(() => {
      result.current.reset();
    });

    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.previewResults).toEqual([]);
    expect(result.current.hasImportableEntries).toBe(false);
  });
});
