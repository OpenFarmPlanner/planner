import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCreatedPlanPin, withPinnedRowFirst } from '../pages/useCreatedPlanPin';
import { HIGHLIGHT_FLASH_DURATION_MS } from '../components/feedback/highlightFlashStyles';

const rows = [{ id: 1 }, { id: 2 }, { id: 3 }];

describe('withPinnedRowFirst', () => {
  it('returns the sorted rows unchanged without a pin', () => {
    expect(withPinnedRowFirst(rows, rows, null)).toBe(rows);
  });

  it('moves the pinned plan to the front and keeps the others in their order', () => {
    expect(withPinnedRowFirst(rows, rows, 3).map((row) => row.id)).toEqual([3, 1, 2]);
  });

  it('shows the pinned plan even when the search or filters would hide it', () => {
    const matching = [{ id: 1 }, { id: 2 }];
    expect(withPinnedRowFirst(matching, rows, 3).map((row) => row.id)).toEqual([3, 1, 2]);
  });

  it('ignores a pin whose plan is gone (e.g. deleted)', () => {
    expect(withPinnedRowFirst(rows, rows, 99)).toBe(rows);
  });
});

describe('useCreatedPlanPin', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pins and flashes a created plan; the flash ends, the pin stays', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCreatedPlanPin('planting_date'));

    act(() => { result.current.pinCreatedPlan(7); });
    expect(result.current.pinnedPlanId).toBe(7);
    expect(result.current.flashingPlanId).toBe(7);

    act(() => { vi.advanceTimersByTime(HIGHLIGHT_FLASH_DURATION_MS); });
    expect(result.current.flashingPlanId).toBeNull();
    expect(result.current.pinnedPlanId).toBe(7);
  });

  it('drops the pin once the user picks another sort, and does not bring it back', () => {
    const { result, rerender } = renderHook(({ sortKey }) => useCreatedPlanPin(sortKey), {
      initialProps: { sortKey: 'planting_date' },
    });
    act(() => { result.current.pinCreatedPlan(7); });

    rerender({ sortKey: 'crop' });
    expect(result.current.pinnedPlanId).toBeNull();

    rerender({ sortKey: 'planting_date' });
    expect(result.current.pinnedPlanId).toBeNull();
  });
});
