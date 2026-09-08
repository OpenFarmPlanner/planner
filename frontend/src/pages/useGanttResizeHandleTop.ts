import { useLayoutEffect, useState } from 'react';

/** The vendored Gantt renders its scrollable body under this class. */
const GANTT_BODY_SELECTOR = '.rmg-container';

/**
 * Where the drag handle that resizes the Gantt has to sit: the offset of the
 * chart's own scrollable body from the top of the boundary element around it.
 *
 * The body is rendered by the vendored Gantt, so its offset is only knowable by
 * measuring, and it moves whenever the header above it reflows. A ResizeObserver
 * on both elements catches that; `contentKey` covers the reflows that replace
 * the body outright (a different calendar mode, view mode or row count), where
 * the observer would otherwise still be watching the old node.
 *
 * Returns null while there is nothing to measure, which is the caller's signal
 * not to render the handle at all.
 */
export function useGanttResizeHandleTop(
  boundaryNode: HTMLElement | null,
  contentKey: string,
): number | null {
  const [handleTop, setHandleTop] = useState<number | null>(null);

  useLayoutEffect(() => {
    const boundary = boundaryNode;
    if (!boundary) {
      return undefined;
    }

    let animationFrameId: number | null = null;
    const measureHandleTop = (): void => {
      animationFrameId = null;
      const ganttBody = boundary.querySelector<HTMLElement>(GANTT_BODY_SELECTOR);
      if (!ganttBody) {
        setHandleTop(null);
        return;
      }
      const boundaryRect = boundary.getBoundingClientRect();
      const bodyRect = ganttBody.getBoundingClientRect();
      setHandleTop(Math.max(0, Math.round(bodyRect.top - boundaryRect.top)));
    };
    const queueMeasure = (): void => {
      if (animationFrameId === null) {
        animationFrameId = window.requestAnimationFrame(measureHandleTop);
      }
    };

    measureHandleTop();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', queueMeasure);
      return () => {
        window.removeEventListener('resize', queueMeasure);
        if (animationFrameId !== null) {
          window.cancelAnimationFrame(animationFrameId);
        }
      };
    }

    const observer = new ResizeObserver(queueMeasure);
    observer.observe(boundary);
    const ganttBody = boundary.querySelector<HTMLElement>(GANTT_BODY_SELECTOR);
    if (ganttBody) {
      observer.observe(ganttBody);
    }

    return () => {
      observer.disconnect();
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
      }
    };
  }, [boundaryNode, contentKey]);

  return handleTop;
}
