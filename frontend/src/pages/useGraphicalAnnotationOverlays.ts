import { useEffect, useState, type RefObject } from 'react';
import type { Rect } from './graphicalLayoutUtils';

const OVERLAY = '[data-graphical-annotation-obstacle], [data-graphical-annotation-hints] > [role="note"]';

/** Reserve the pixels occupied by mounted workspace controls and notices. */
export function useGraphicalAnnotationOverlays(root: RefObject<HTMLDivElement | null>, locationId: number | null, enabled: boolean) {
  const [measured, setMeasured] = useState<{ location: number | null; rects: Rect[] } | null>(null);
  useEffect(() => {
    const canvas = root.current;
    if (!enabled || !canvas) return;
    let frame = 0;
    let observed = new Set<Element>();
    const measure = () => {
      frame = 0;
      const origin = canvas.getBoundingClientRect();
      const overlayNodes = new Set(canvas.querySelectorAll(OVERLAY));
      for (const node of observed) if (!overlayNodes.has(node)) resize?.unobserve(node);
      for (const node of overlayNodes) if (!observed.has(node)) resize?.observe(node);
      observed = overlayNodes;
      const rects = [...overlayNodes].flatMap(node => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return width && height ? [{ x: x - origin.x - canvas.clientLeft, y: y - origin.y - canvas.clientTop, width, height }] : [];
      });
      setMeasured(previous => previous?.location === locationId && JSON.stringify(previous.rects) === JSON.stringify(rects)
        ? previous : { location: locationId, rects });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    const mutations = new MutationObserver(schedule);
    resize?.observe(canvas);
    mutations.observe(canvas, { childList: true, subtree: true });
    measure();
    return () => {
      mutations.disconnect();
      resize?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [root, locationId, enabled]);
  return measured?.location === locationId ? measured.rects : null;
}
