import { act, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { useAvailableTableHeight } from '../pages/useAvailableTableHeight';
import {
  TABLE_BOTTOM_MARGIN_PX,
  TABLE_MIN_HEIGHT_PX,
} from '../pages/fieldsBedsHierarchyStyles';

const observerCallbacks: (() => void)[] = [];

function installResizeObserver(): void {
  class FakeResizeObserver {
    constructor(callback: () => void) {
      observerCallbacks.push(callback);
    }

    observe(): void {}
    disconnect(): void {}
    unobserve(): void {}
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
}

function wrapperAt(top: number) {
  const node = document.createElement('div');
  node.getBoundingClientRect = () => ({ top }) as DOMRect;
  return { current: node };
}

function setViewportHeight(height: number): void {
  Object.defineProperty(window, 'innerHeight', {
    writable: true,
    configurable: true,
    value: height,
  });
}

describe('useAvailableTableHeight', () => {
  const originalHeight = window.innerHeight;

  beforeEach(() => {
    observerCallbacks.length = 0;
    installResizeObserver();
  });

  afterEach(() => {
    setViewportHeight(originalHeight);
    vi.unstubAllGlobals();
  });

  it('fills the viewport below the table wrapper', () => {
    setViewportHeight(900);
    const { result } = renderHook(() => useAvailableTableHeight({
      enabled: true,
      tableWrapperRef: wrapperAt(300),
      pageContentRef: { current: document.createElement('div') },
    }));

    expect(result.current).toBe(900 - 300 - TABLE_BOTTOM_MARGIN_PX);
  });

  it('never goes below the minimum height, however little room is left', () => {
    setViewportHeight(400);
    const { result } = renderHook(() => useAvailableTableHeight({
      enabled: true,
      tableWrapperRef: wrapperAt(380),
      pageContentRef: { current: document.createElement('div') },
    }));

    expect(result.current).toBe(TABLE_MIN_HEIGHT_PX);
  });

  it('measures nothing while disabled, so the caller keeps its own height', () => {
    setViewportHeight(900);
    const { result } = renderHook(() => useAvailableTableHeight({
      enabled: false,
      tableWrapperRef: wrapperAt(300),
      pageContentRef: { current: document.createElement('div') },
    }));

    expect(result.current).toBeNull();
    expect(observerCallbacks).toHaveLength(0);
  });

  it('measures nothing until the wrapper is attached', () => {
    const { result } = renderHook(() => useAvailableTableHeight({
      enabled: true,
      tableWrapperRef: createRef<HTMLElement>(),
      pageContentRef: { current: document.createElement('div') },
    }));

    expect(result.current).toBeNull();
  });

  it('re-measures when the page content around the table reflows', () => {
    setViewportHeight(900);
    const tableWrapperRef = wrapperAt(300);
    const { result } = renderHook(() => useAvailableTableHeight({
      enabled: true,
      tableWrapperRef,
      pageContentRef: { current: document.createElement('div') },
    }));
    expect(result.current).toBe(900 - 300 - TABLE_BOTTOM_MARGIN_PX);

    // An alert above the table appears and pushes it down.
    tableWrapperRef.current.getBoundingClientRect = () => ({ top: 380 }) as DOMRect;
    act(() => { observerCallbacks[0](); });

    expect(result.current).toBe(900 - 380 - TABLE_BOTTOM_MARGIN_PX);
  });

  it('re-measures when the window resizes', () => {
    setViewportHeight(900);
    const { result } = renderHook(() => useAvailableTableHeight({
      enabled: true,
      tableWrapperRef: wrapperAt(300),
      pageContentRef: { current: document.createElement('div') },
    }));

    setViewportHeight(700);
    act(() => { window.dispatchEvent(new Event('resize')); });

    expect(result.current).toBe(700 - 300 - TABLE_BOTTOM_MARGIN_PX);
  });

  it('stops listening once unmounted', () => {
    const removeListener = vi.spyOn(window, 'removeEventListener');

    renderHook(() => useAvailableTableHeight({
      enabled: true,
      tableWrapperRef: wrapperAt(300),
      pageContentRef: { current: document.createElement('div') },
    })).unmount();

    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
    removeListener.mockRestore();
  });
});
