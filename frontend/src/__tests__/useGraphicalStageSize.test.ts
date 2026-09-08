import { act, renderHook } from '@testing-library/react';
import { useGraphicalStageSize } from '../pages/useGraphicalStageSize';
import { MAX_STAGE_HEIGHT, MIN_STAGE_HEIGHT } from '../pages/graphicalFieldsGeometry';

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: height });
}

function setFullscreenElement(element: Element | null): void {
  Object.defineProperty(document, 'fullscreenElement', {
    writable: true,
    configurable: true,
    value: element,
  });
}

function canvasNode(width: number, height: number): HTMLDivElement {
  const node = document.createElement('div');
  Object.defineProperty(node, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(node, 'clientHeight', { configurable: true, value: height });
  return node;
}

describe('useGraphicalStageSize', () => {
  const originalWidth = window.innerWidth;
  const originalHeight = window.innerHeight;

  afterEach(() => {
    setViewport(originalWidth, originalHeight);
    setFullscreenElement(null);
  });

  it('measures the viewport on mount when no container is attached yet', () => {
    setViewport(1200, 900);
    const { result } = renderHook(() => useGraphicalStageSize());

    expect(result.current.stageWidth).toBe(1192);
    expect(result.current.stageHeight).toBe(405);
    expect(result.current.fullscreenLocationId).toBeNull();
  });

  it('prefers the container width over the viewport', () => {
    setViewport(1200, 900);
    const { result } = renderHook(() => useGraphicalStageSize());

    result.current.containerRef.current = canvasNode(640, 480);
    act(() => { window.dispatchEvent(new Event('resize')); });

    expect(result.current.stageWidth).toBe(632);
  });

  it('never draws a stage narrower than the minimum', () => {
    setViewport(200, 900);
    const { result } = renderHook(() => useGraphicalStageSize());

    expect(result.current.stageWidth).toBe(320);
  });

  it('clamps the height between the configured bounds', () => {
    setViewport(1200, 400);
    const { result: shortViewport } = renderHook(() => useGraphicalStageSize());
    expect(shortViewport.current.stageHeight).toBe(MIN_STAGE_HEIGHT);

    setViewport(1200, 4000);
    const { result: tallViewport } = renderHook(() => useGraphicalStageSize());
    expect(tallViewport.current.stageHeight).toBe(MAX_STAGE_HEIGHT);
  });

  it('tracks which location went fullscreen, and lets it exceed the height cap', () => {
    setViewport(1200, 900);
    const { result } = renderHook(() => useGraphicalStageSize());
    const node = canvasNode(1920, 1080);
    result.current.locationCanvasRefs.current[7] = node;

    act(() => {
      setFullscreenElement(node);
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    expect(result.current.fullscreenLocationId).toBe(7);
    expect(result.current.stageWidth).toBe(1912);
    // Fullscreen fills the screen instead of the 45% viewport share, so
    // MAX_STAGE_HEIGHT deliberately does not apply here.
    expect(result.current.stageHeight).toBe(1072);
  });

  it('returns to viewport sizing when fullscreen is left from the browser chrome', () => {
    setViewport(1200, 900);
    const { result } = renderHook(() => useGraphicalStageSize());
    const node = canvasNode(1920, 1080);
    result.current.locationCanvasRefs.current[7] = node;

    act(() => {
      setFullscreenElement(node);
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    act(() => {
      setFullscreenElement(null);
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    expect(result.current.fullscreenLocationId).toBeNull();
    expect(result.current.stageHeight).toBe(405);
  });

  it('ignores a fullscreen element that is not one of the location canvases', () => {
    const { result } = renderHook(() => useGraphicalStageSize());

    act(() => {
      setFullscreenElement(document.createElement('section'));
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    expect(result.current.fullscreenLocationId).toBeNull();
  });

  it('stops listening once unmounted', () => {
    const removeWindowListener = vi.spyOn(window, 'removeEventListener');
    const removeDocumentListener = vi.spyOn(document, 'removeEventListener');

    renderHook(() => useGraphicalStageSize()).unmount();

    expect(removeWindowListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(removeDocumentListener).toHaveBeenCalledWith('fullscreenchange', expect.any(Function));
    removeWindowListener.mockRestore();
    removeDocumentListener.mockRestore();
  });
});
