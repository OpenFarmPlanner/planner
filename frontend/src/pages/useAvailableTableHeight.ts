import { useLayoutEffect, useState, type RefObject } from 'react';
import {
  TABLE_BOTTOM_MARGIN_PX,
  TABLE_MIN_HEIGHT_PX,
} from './fieldsBedsHierarchyStyles';

interface UseAvailableTableHeightOptions {
  /** False on mobile, where the table uses autoHeight and the page itself scrolls. */
  enabled: boolean;
  /** The element the table starts at; its distance from the viewport top is the measurement. */
  tableWrapperRef: RefObject<HTMLElement | null>;
  /** Everything above and around the table, observed so any reflow re-measures. */
  pageContentRef: RefObject<HTMLElement | null>;
}

/**
 * How tall the hierarchy table may be: the viewport height minus whatever the
 * title, alerts, hints and toggles above it currently occupy.
 *
 * It observes the whole page content area rather than a hand-picked list of
 * "things that might shift the table down". That list is easy to miss a case
 * for - an alert or hint whose height changes after an async load, say - and a
 * missed case leaves the height stale, under-sizing the table and putting its
 * last rows out of scroll reach.
 *
 * Returns null until the first measurement, which is the caller's signal to
 * fall back to its own content height.
 */
export function useAvailableTableHeight({
  enabled,
  tableWrapperRef,
  pageContentRef,
}: UseAvailableTableHeightOptions): number | null {
  const [availableTableHeight, setAvailableTableHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!enabled) {
      return;
    }

    const measure = (): void => {
      const wrapper = tableWrapperRef.current;
      if (!wrapper) {
        return;
      }
      const top = wrapper.getBoundingClientRect().top;
      setAvailableTableHeight(
        Math.max(TABLE_MIN_HEIGHT_PX, window.innerHeight - top - TABLE_BOTTOM_MARGIN_PX),
      );
    };

    measure();
    window.addEventListener('resize', measure);

    let resizeObserver: ResizeObserver | undefined;
    const observedElement = pageContentRef.current;
    if (observedElement && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(observedElement);
    }

    return () => {
      window.removeEventListener('resize', measure);
      resizeObserver?.disconnect();
    };
  }, [enabled, pageContentRef, tableWrapperRef]);

  return availableTableHeight;
}
