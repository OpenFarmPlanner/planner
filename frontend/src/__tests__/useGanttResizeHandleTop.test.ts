import { act, renderHook } from '@testing-library/react';
import { useGanttResizeHandleTop } from '../pages/useGanttResizeHandleTop';

type ObserverCallback = () => void;

const observerInstances: { callback: ObserverCallback; observed: Element[] }[] = [];

function installResizeObserver(): void {
  class FakeResizeObserver {
    private readonly entry: { callback: ObserverCallback; observed: Element[] };

    constructor(callback: ObserverCallback) {
      this.entry = { callback, observed: [] };
      observerInstances.push(this.entry);
    }

    observe(target: Element): void {
      this.entry.observed.push(target);
    }

    disconnect(): void {
      this.entry.observed = [];
    }

    unobserve(): void {}
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
}

function boundaryWith(bodyTop: number | null, boundaryTop = 100): HTMLDivElement {
  const boundary = document.createElement('div');
  boundary.getBoundingClientRect = () => ({ top: boundaryTop }) as DOMRect;
  if (bodyTop !== null) {
    const body = document.createElement('div');
    body.className = 'rmg-container';
    body.getBoundingClientRect = () => ({ top: bodyTop }) as DOMRect;
    boundary.appendChild(body);
  }
  return boundary;
}

describe('useGanttResizeHandleTop', () => {
  beforeEach(() => {
    observerInstances.length = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null when there is no boundary to measure', () => {
    installResizeObserver();
    const { result } = renderHook(() => useGanttResizeHandleTop(null, 'key'));

    expect(result.current).toBeNull();
  });

  it('returns null when the boundary has no gantt body yet', () => {
    installResizeObserver();
    const { result } = renderHook(() => useGanttResizeHandleTop(boundaryWith(null), 'key'));

    expect(result.current).toBeNull();
  });

  it('measures the body offset from the top of the boundary', () => {
    installResizeObserver();
    const { result } = renderHook(
      () => useGanttResizeHandleTop(boundaryWith(148, 100), 'key'),
    );

    expect(result.current).toBe(48);
  });

  it('never reports a negative offset', () => {
    installResizeObserver();
    const { result } = renderHook(
      () => useGanttResizeHandleTop(boundaryWith(80, 100), 'key'),
    );

    expect(result.current).toBe(0);
  });

  it('observes both the boundary and the gantt body', () => {
    installResizeObserver();
    const boundary = boundaryWith(148);
    renderHook(() => useGanttResizeHandleTop(boundary, 'key'));

    expect(observerInstances).toHaveLength(1);
    expect(observerInstances[0].observed).toHaveLength(2);
    expect(observerInstances[0].observed[0]).toBe(boundary);
  });

  it('re-measures when the observer fires', () => {
    installResizeObserver();
    const boundary = boundaryWith(148, 100);
    const { result } = renderHook(() => useGanttResizeHandleTop(boundary, 'key'));
    expect(result.current).toBe(48);

    const body = boundary.querySelector('.rmg-container') as HTMLElement;
    body.getBoundingClientRect = () => ({ top: 220 }) as DOMRect;
    act(() => { observerInstances[0].callback(); });

    expect(result.current).toBe(120);
  });

  it('re-measures when the content key changes, which replaces the observed body', () => {
    installResizeObserver();
    const first = boundaryWith(148, 100);
    const { result, rerender } = renderHook(
      ({ node, key }: { node: HTMLElement; key: string }) => useGanttResizeHandleTop(node, key),
      { initialProps: { node: first, key: 'month|1|10' } },
    );
    expect(result.current).toBe(48);

    rerender({ node: boundaryWith(180, 100), key: 'week|2|40' });

    expect(result.current).toBe(80);
  });

  it('falls back to a window resize listener where ResizeObserver is missing', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const addListener = vi.spyOn(window, 'addEventListener');
    const removeListener = vi.spyOn(window, 'removeEventListener');

    const { result, unmount } = renderHook(
      () => useGanttResizeHandleTop(boundaryWith(148, 100), 'key'),
    );

    expect(result.current).toBe(48);
    expect(addListener).toHaveBeenCalledWith('resize', expect.any(Function));
    unmount();
    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
    addListener.mockRestore();
    removeListener.mockRestore();
  });
});
