import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAreaValidationDialog } from '../pages/useAreaValidationDialog';
import type { AreaValidationDialogState } from '../pages/useAreaValidationDialog';

const SUPPRESSION_MS = 250;

const dialog = (overrides: Partial<AreaValidationDialogState> = {}): AreaValidationDialogState => ({
  rowId: 1,
  requestedArea: 20,
  availableArea: 10,
  bedArea: 40,
  occupiedArea: 30,
  mode: 'remainingLimit',
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useAreaValidationDialog — opening', () => {
  it('starts closed', () => {
    const { result } = renderHook(() => useAreaValidationDialog());
    expect(result.current.areaValidationDialog).toBeNull();
    expect(result.current.areaValidationDialogRef.current).toBeNull();
  });

  it('shows the dialog', () => {
    const { result } = renderHook(() => useAreaValidationDialog());

    act(() => result.current.openAreaValidationDialog(dialog()));

    expect(result.current.areaValidationDialog).toEqual(dialog());
  });

  it('mirrors the dialog into the ref the save guard reads', () => {
    // The save guard runs outside React's render, so it needs the ref rather
    // than the state value.
    const { result } = renderHook(() => useAreaValidationDialog());

    act(() => result.current.openAreaValidationDialog(dialog()));

    expect(result.current.areaValidationDialogRef.current).toEqual(dialog());
  });

  it('replaces a dialog that is already open', () => {
    const { result } = renderHook(() => useAreaValidationDialog());
    act(() => result.current.openAreaValidationDialog(dialog({ rowId: 1 })));

    act(() => result.current.openAreaValidationDialog(dialog({ rowId: 2, mode: 'bedLimit' })));

    expect(result.current.areaValidationDialog).toMatchObject({ rowId: 2, mode: 'bedLimit' });
  });

  it('lifts the suppression flag, so the new dialog can validate', () => {
    // Re-opening for a different row must not inherit the previous close's
    // suppression and silently skip the check.
    const { result } = renderHook(() => useAreaValidationDialog());
    act(() => result.current.openAreaValidationDialog(dialog()));
    act(() => result.current.closeAreaValidationDialog());
    expect(result.current.suppressAreaValidationSaveRef.current).toBe(true);

    act(() => result.current.openAreaValidationDialog(dialog({ rowId: 2 })));

    expect(result.current.suppressAreaValidationSaveRef.current).toBe(false);
  });

  it('cancels a pending close timer, so it cannot fire over the new dialog', () => {
    // Asserting the flag straight after the open would prove nothing: the
    // stale timer sets it to false, which is what the open set it to anyway.
    // The difference only shows once something raises the flag again — as the
    // page's commit handler does — and the orphaned timer lowers it.
    const { result } = renderHook(() => useAreaValidationDialog());
    act(() => result.current.openAreaValidationDialog(dialog()));
    act(() => result.current.closeAreaValidationDialog());

    act(() => result.current.openAreaValidationDialog(dialog({ rowId: 2 })));
    act(() => { result.current.suppressAreaValidationSaveRef.current = true; });
    act(() => { vi.advanceTimersByTime(SUPPRESSION_MS * 2); });

    expect(result.current.suppressAreaValidationSaveRef.current).toBe(true);
  });
});

describe('useAreaValidationDialog — closing', () => {
  it('hides the dialog', () => {
    const { result } = renderHook(() => useAreaValidationDialog());
    act(() => result.current.openAreaValidationDialog(dialog()));

    act(() => result.current.closeAreaValidationDialog());

    expect(result.current.areaValidationDialog).toBeNull();
  });

  it('clears the ref as well as the state', () => {
    const { result } = renderHook(() => useAreaValidationDialog());
    act(() => result.current.openAreaValidationDialog(dialog()));

    act(() => result.current.closeAreaValidationDialog());

    expect(result.current.areaValidationDialogRef.current).toBeNull();
  });

  it('suppresses the next save cycle', () => {
    // Closing the dialog ends an edit that would otherwise save again and
    // re-open the same validation immediately.
    const { result } = renderHook(() => useAreaValidationDialog());
    act(() => result.current.openAreaValidationDialog(dialog()));

    act(() => result.current.closeAreaValidationDialog());

    expect(result.current.suppressAreaValidationSaveRef.current).toBe(true);
  });

  it('lifts the suppression once the window has passed', () => {
    const { result } = renderHook(() => useAreaValidationDialog());
    act(() => result.current.openAreaValidationDialog(dialog()));
    act(() => result.current.closeAreaValidationDialog());

    act(() => { vi.advanceTimersByTime(SUPPRESSION_MS); });

    expect(result.current.suppressAreaValidationSaveRef.current).toBe(false);
  });

  it('keeps suppressing right up to the end of the window', () => {
    const { result } = renderHook(() => useAreaValidationDialog());
    act(() => result.current.openAreaValidationDialog(dialog()));
    act(() => result.current.closeAreaValidationDialog());

    act(() => { vi.advanceTimersByTime(SUPPRESSION_MS - 1); });

    expect(result.current.suppressAreaValidationSaveRef.current).toBe(true);
  });

  it('restarts the window when closed twice', () => {
    // The second close is the one the user just made; its window should run
    // from then, not expire on the first close's schedule.
    const { result } = renderHook(() => useAreaValidationDialog());
    act(() => result.current.openAreaValidationDialog(dialog()));
    act(() => result.current.closeAreaValidationDialog());
    act(() => { vi.advanceTimersByTime(SUPPRESSION_MS - 10); });

    act(() => result.current.closeAreaValidationDialog());
    act(() => { vi.advanceTimersByTime(20); });

    expect(result.current.suppressAreaValidationSaveRef.current).toBe(true);
  });
});

describe('useAreaValidationDialog — clearAreaValidationCloseTimer', () => {
  it('stops a pending timer from lifting the suppression', () => {
    // The commit handler calls this when it has taken the decision itself.
    const { result } = renderHook(() => useAreaValidationDialog());
    act(() => result.current.openAreaValidationDialog(dialog()));
    act(() => result.current.closeAreaValidationDialog());

    act(() => result.current.clearAreaValidationCloseTimer());
    act(() => { vi.advanceTimersByTime(SUPPRESSION_MS * 2); });

    expect(result.current.suppressAreaValidationSaveRef.current).toBe(true);
  });

  it('is safe to call with no timer running', () => {
    // Both halves of the no-timer handling are belt and braces: `clearTimeout`
    // is a no-op on a null or dead id, and the only read of the ref is the
    // null check itself. Removing either leaves this file green.
    const { result } = renderHook(() => useAreaValidationDialog());
    expect(() => act(() => result.current.clearAreaValidationCloseTimer())).not.toThrow();
  });

  it('is safe to call twice', () => {
    const { result } = renderHook(() => useAreaValidationDialog());
    act(() => result.current.closeAreaValidationDialog());

    act(() => result.current.clearAreaValidationCloseTimer());

    expect(() => act(() => result.current.clearAreaValidationCloseTimer())).not.toThrow();
  });
});

describe('useAreaValidationDialog — the refs the page writes to', () => {
  it('lets the caller set the dialog directly', () => {
    // The page's own commit handler updates the dialog without going through
    // openAreaValidationDialog.
    const { result } = renderHook(() => useAreaValidationDialog());

    act(() => result.current.setAreaValidationDialog(dialog({ rowId: 5 })));

    expect(result.current.areaValidationDialog).toMatchObject({ rowId: 5 });
  });

  it('lets the caller reset the suppression flag itself', () => {
    const { result } = renderHook(() => useAreaValidationDialog());
    act(() => result.current.closeAreaValidationDialog());

    act(() => { result.current.suppressAreaValidationSaveRef.current = false; });

    expect(result.current.suppressAreaValidationSaveRef.current).toBe(false);
  });

  it('keeps the same ref objects across renders', () => {
    // The page captures these once; a new object per render would leave it
    // reading a stale one.
    const { result, rerender } = renderHook(() => useAreaValidationDialog());
    const dialogRef = result.current.areaValidationDialogRef;
    const suppressRef = result.current.suppressAreaValidationSaveRef;

    rerender();

    expect(result.current.areaValidationDialogRef).toBe(dialogRef);
    expect(result.current.suppressAreaValidationSaveRef).toBe(suppressRef);
  });
});

describe('useAreaValidationDialog — unmount', () => {
  it('cancels a pending timer so it cannot fire after the page is gone', () => {
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
    const { result, unmount } = renderHook(() => useAreaValidationDialog());
    act(() => result.current.openAreaValidationDialog(dialog()));
    act(() => result.current.closeAreaValidationDialog());
    clearTimeoutSpy.mockClear();

    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('unmounts cleanly with no timer pending', () => {
    const { unmount } = renderHook(() => useAreaValidationDialog());
    expect(() => unmount()).not.toThrow();
  });
});
