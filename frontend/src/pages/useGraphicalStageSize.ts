import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { MAX_STAGE_HEIGHT, MIN_STAGE_HEIGHT } from './graphicalFieldsGeometry';

const MIN_STAGE_WIDTH = 320;
/** Leaves room for the canvas card's border so the stage never overflows it. */
const STAGE_INSET = 8;
const VIEWPORT_HEIGHT_SHARE = 0.45;

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
export function useGraphicalStageSize(): GraphicalStageSize {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const locationCanvasRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [fullscreenLocationId, setFullscreenLocationId] = useState<number | null>(null);
  const [stageWidth, setStageWidth] = useState<number>(() =>
    Math.max(MIN_STAGE_WIDTH, window.innerWidth - 48),
  );
  const [stageHeight, setStageHeight] = useState<number>(() =>
    Math.max(
      MIN_STAGE_HEIGHT,
      Math.min(MAX_STAGE_HEIGHT, Math.round(window.innerHeight * VIEWPORT_HEIGHT_SHARE)),
    ),
  );

  useEffect(() => {
    const handleResize = (): void => {
      const fullscreenContainer =
        fullscreenLocationId !== null
          ? locationCanvasRefs.current[fullscreenLocationId]
          : null;
      const containerWidth =
        fullscreenContainer?.clientWidth ??
        containerRef.current?.clientWidth ??
        window.innerWidth;
      setStageWidth(Math.max(MIN_STAGE_WIDTH, Math.round(containerWidth - STAGE_INSET)));
      if (fullscreenContainer) {
        setStageHeight(
          Math.max(MIN_STAGE_HEIGHT, Math.round(fullscreenContainer.clientHeight - STAGE_INSET)),
        );
      } else {
        setStageHeight(
          Math.max(
            MIN_STAGE_HEIGHT,
            Math.min(MAX_STAGE_HEIGHT, Math.round(window.innerHeight * VIEWPORT_HEIGHT_SHARE)),
          ),
        );
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [fullscreenLocationId]);

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
