import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOnlineStatus } from '../useOnlineStatus';

function setNavigatorOnline(value: boolean | undefined): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

afterEach(() => {
  setNavigatorOnline(true);
  vi.restoreAllMocks();
});

describe('useOnlineStatus', () => {
  it('reports the browser connection state on mount', () => {
    setNavigatorOnline(false);

    const { result } = renderHook(() => useOnlineStatus());

    expect(result.current).toBe(false);
  });

  it('re-reads the connection on the online and offline events', () => {
    setNavigatorOnline(true);
    const { result } = renderHook(() => useOnlineStatus());

    expect(result.current).toBe(true);

    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current).toBe(false);

    act(() => {
      setNavigatorOnline(true);
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current).toBe(true);
  });

  it('assumes a connection when the browser does not report one', () => {
    // Environments without a usable navigator.onLine must not make the
    // indicator claim an outage it cannot actually observe.
    setNavigatorOnline(undefined);

    const { result } = renderHook(() => useOnlineStatus());

    expect(result.current).toBe(true);
  });

  it('stops listening once unmounted', () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useOnlineStatus());
    unmount();

    const removed = removeEventListener.mock.calls.map(([type]) => type);
    expect(removed).toContain('online');
    expect(removed).toContain('offline');
  });
});
