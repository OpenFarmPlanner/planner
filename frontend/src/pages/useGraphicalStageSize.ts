import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

const MIN_STAGE_SIZE = 1;
const MIN_USABLE_STAGE_HEIGHT = 96;
const FALLBACK_GUTTER = 8;

export interface GraphicalStageSize {
  stageWidth: number;
  stageHeight: number;
  /** The location whose canvas is currently fullscreen, or null. */
  fullscreenLocationId: number | null;
  /** Wraps every location canvas; its width sets the stage width when not fullscreen. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** One DOM node per location, assigned in render and read when going fullscreen. */
  locationCanvasRefs: RefObject<Record<number, HTMLDivElement | null>>;
  toggleFullscreen: (locationId: number) => Promise<void>;
}

/**
 * How large the Konva stages are drawn, and which location is fullscreen.
 *
 * The two answers are one concern: entering fullscreen means measuring the
 * fullscreen element instead of the page container, so the resize handler has
 * to re-run whenever that changes. Fullscreen is tracked from the browser's own
 * `fullscreenchange` event rather than from the toggle, so leaving via Escape or
 * the browser chrome is noticed too.
 */
export function useGraphicalStageSize(selectedLocationId?: number | null, ready = true): GraphicalStageSize {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const locationCanvasRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [fullscreenLocationId, setFullscreenLocationId] = useState<number | null>(null);
  const [stageWidth, setStageWidth] = useState(() => Math.max(MIN_STAGE_SIZE, window.innerWidth - FALLBACK_GUTTER * 2));
  const [stageHeight, setStageHeight] = useState(() => Math.max(MIN_USABLE_STAGE_HEIGHT, window.innerHeight - FALLBACK_GUTTER * 2));

  useLayoutEffect(() => {
    if (!ready) return;
    const getCanvas = () => (selectedLocationId == null ? null : locationCanvasRefs.current[selectedLocationId])
      ?? Object.values(locationCanvasRefs.current).find(node => node !== null);
    const container = containerRef.current;
    const canvas = getCanvas();
    const header = document.querySelector('header');
    const main = container?.closest('main');
    const measure = (): void => {
      const fullscreenCanvas = fullscreenLocationId === null ? null : locationCanvasRefs.current[fullscreenLocationId];
      const target = fullscreenCanvas ?? getCanvas() ?? containerRef.current;
      const width = target?.clientWidth || window.innerWidth - FALLBACK_GUTTER * 2;
      const top = Math.max(0, target?.getBoundingClientRect().top ?? 0);
      const bottomGutter = main ? Number.parseFloat(getComputedStyle(main).paddingBottom) || FALLBACK_GUTTER : FALLBACK_GUTTER;
      const borders = target ? Math.max(0, target.offsetHeight - target.clientHeight) : 0;
      setStageWidth(Math.max(MIN_STAGE_SIZE, Math.floor(width)));
      setStageHeight(fullscreenCanvas
        ? Math.max(MIN_STAGE_SIZE, fullscreenCanvas.clientHeight)
        : Math.max(MIN_USABLE_STAGE_HEIGHT, Math.floor(window.innerHeight - top - bottomGutter - borders)));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    for (const node of new Set([container, canvas, main, header])) if (node) observer?.observe(node);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [fullscreenLocationId, ready, selectedLocationId]);

  useEffect(() => {
    const handleFullscreenChange = (): void => {
      const element = document.fullscreenElement;
      if (!element) {
        setFullscreenLocationId(null);
        return;
      }
      const matchingLocationId = Object.entries(locationCanvasRefs.current).find(
        ([, node]) => node === element,
      )?.[0];
      setFullscreenLocationId(matchingLocationId ? Number(matchingLocationId) : null);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () =>
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = useCallback(async (locationId: number): Promise<void> => {
    const target = locationCanvasRefs.current[locationId];
    if (!target) {
      return;
    }

    try {
      if (document.fullscreenElement === target) {
        await document.exitFullscreen();
        return;
      }

      if (!document.fullscreenElement && target.requestFullscreen) {
        await target.requestFullscreen();
      }
    } catch (fullscreenError) {
      console.error('Failed to toggle fullscreen', fullscreenError);
    }
  }, []);

  return {
    stageWidth,
    stageHeight,
    fullscreenLocationId,
    containerRef,
    locationCanvasRefs,
    toggleFullscreen,
  };
}
