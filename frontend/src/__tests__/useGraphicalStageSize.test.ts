import { act, renderHook } from '@testing-library/react';
import { useGraphicalStageSize } from '../pages/useGraphicalStageSize';

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}
function fullscreen(element: Element | null): void {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: element });
  document.dispatchEvent(new Event('fullscreenchange'));
}
function canvasNode(width: number, height: number, top = 0): HTMLDivElement {
  const node = document.createElement('div');
  Object.defineProperties(node, {
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height },
    offsetHeight: { configurable: true, value: height },
  });
  node.getBoundingClientRect = () => new DOMRect(0, top, width, height);
  return node;
}

describe('useGraphicalStageSize', () => {
  const originalWidth = window.innerWidth;
  const originalHeight = window.innerHeight;
  beforeEach(() => setViewport(1200, 900));
  afterEach(() => { act(() => { setViewport(originalWidth, originalHeight); fullscreen(null); }); });

  it('starts with viewport dimensions until a canvas is attached', () => {
    const { result } = renderHook(() => useGraphicalStageSize());
    expect(result.current.stageWidth).toBe(1184);
    expect(result.current.stageHeight).toBe(892);
  });

  it('uses the inner canvas width and the actual space below its top edge', () => {
    const { result } = renderHook(() => useGraphicalStageSize(7));
    result.current.containerRef.current = canvasNode(700, 500);
    result.current.locationCanvasRefs.current[7] = canvasNode(640, 480, 120);
    act(() => window.dispatchEvent(new Event('resize')));
    expect(result.current.stageWidth).toBe(640);
    expect(result.current.stageHeight).toBe(772);
  });

  it('fits narrow and short windows without imposing the old 320px minimum', () => {
    setViewport(200, 375);
    const { result } = renderHook(() => useGraphicalStageSize(7));
    result.current.locationCanvasRefs.current[7] = canvasNode(180, 200, 160);
    act(() => window.dispatchEvent(new Event('resize')));
    expect(result.current.stageWidth).toBe(180);
    expect(result.current.stageHeight).toBe(207);
  });

  it('uses tall windows without the old maximum-height cap', () => {
    setViewport(1200, 2000);
    const { result } = renderHook(() => useGraphicalStageSize());
    expect(result.current.stageHeight).toBe(1992);
  });

  it('remeasures when the shared header wraps without a window resize', () => {
    let notify: () => void = () => {};
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notify = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    const header = document.createElement('header');
    document.body.append(header);
    try {
      const canvas = canvasNode(640, 480);
      let top = 100;
      canvas.getBoundingClientRect = () => new DOMRect(0, top, 640, 480);
      const { result, unmount } = renderHook(() => {
        const size = useGraphicalStageSize(7);
        size.containerRef.current = canvas;
        size.locationCanvasRefs.current[7] = canvas;
        return size;
      });
      expect(observe).toHaveBeenCalledWith(header);
      expect(observe).toHaveBeenCalledWith(canvas);
      expect(result.current.stageHeight).toBe(792);
      top = 180;
      act(() => notify());
      expect(result.current.stageHeight).toBe(712);
      unmount();
      expect(disconnect).toHaveBeenCalledOnce();
    } finally { header.remove(); vi.unstubAllGlobals(); }
  });

  it('measures the selected canvas rather than a previously selected node', () => {
    const { result, rerender } = renderHook(({ id }) => {
      const size = useGraphicalStageSize(id);
      size.locationCanvasRefs.current[1] = canvasNode(640, 480, 100);
      size.locationCanvasRefs.current[2] = canvasNode(400, 300, 200);
      return size;
    }, { initialProps: { id: 1 } });
    expect(result.current.stageWidth).toBe(640);
    rerender({ id: 2 });
    expect(result.current.stageWidth).toBe(400);
    expect(result.current.stageHeight).toBe(692);
  });

  it('fills fullscreen and returns to the available page space on Escape', () => {
    const { result } = renderHook(() => useGraphicalStageSize(7));
    const canvas = canvasNode(1920, 1080, 100);
    result.current.locationCanvasRefs.current[7] = canvas;
    act(() => fullscreen(canvas));
    expect(result.current.fullscreenLocationId).toBe(7);
    expect(result.current.stageWidth).toBe(1920);
    expect(result.current.stageHeight).toBe(1080);
    act(() => fullscreen(null));
    expect(result.current.fullscreenLocationId).toBeNull();
    expect(result.current.stageHeight).toBe(792);
  });

  it('ignores unrelated fullscreen elements and removes its event handlers', () => {
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const removeDocument = vi.spyOn(document, 'removeEventListener');
    const { result, unmount } = renderHook(() => useGraphicalStageSize());
    act(() => fullscreen(document.createElement('section')));
    expect(result.current.fullscreenLocationId).toBeNull();
    unmount();
    expect(removeWindow).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(removeDocument).toHaveBeenCalledWith('fullscreenchange', expect.any(Function));
    removeWindow.mockRestore(); removeDocument.mockRestore();
  });
});
