import { useLayoutEffect, useMemo, useState } from 'react';
import type { RefObject } from 'react';

import {
  CONTINUOUS_SCROLL_BOTTOM_MARGIN_PX,
  CONTINUOUS_SCROLL_COMPACT_ROW_HEIGHT_PX,
  CONTINUOUS_SCROLL_FIT_EPSILON_PX,
  CONTINUOUS_SCROLL_MIN_HEIGHT_PX,
  CONTINUOUS_SCROLL_PAGE_SIZE,
  DATA_GRID_CONTINUOUS_SCROLL_FOOTER_CLASS,
  DATA_GRID_MAIN_SELECTOR,
  DATA_GRID_ROOT_SELECTOR,
  DATA_GRID_VIRTUAL_SCROLLER_SELECTOR,
  DEFAULT_CONTINUOUS_SCROLL_LAYOUT_HEIGHTS,
  continuousScrollLayoutHeightsEqual,
  getElementHeight,
  getVerticalBorderHeight,
  type ContinuousScrollLayoutHeights,
} from './continuousScrollLayout';

interface UseContinuousScrollSizingOptions {
  /** Sizing only applies to the desktop continuous-scroll mode. */
  isContinuousScroll: boolean;
  isMobile: boolean;
  gridSurfaceRef: RefObject<HTMLDivElement | null>;
  /** The horizontal scrollport the grid sits in, for the scrollbar offset. */
  horizontalScrollRef: RefObject<HTMLDivElement | null>;
  pageContentRef: RefObject<HTMLDivElement | null>;
  /** Rows in the currently rendered window, which set the render-zone height. */
  currentWindowRowCount: number;
  /** Rows a full internal page holds (see getBalancedPageSize). */
  windowPageSize: number;
  /** Rows the grid holds in total, which decide whether the render zone collapses. */
  totalRowCount: number;
  /** Footer height to assume before the footer has been measured. */
  footerFallbackHeight: number;
  /** Re-applies the pinned heights when the scroll window pages. */
  scrollWindowPage: number;
  /**
   * Siblings rendered *above* the grid surface. They shift its top position
   * without changing `pageContentRef`'s own size, so the ResizeObserver below
   * never fires for them: they have to be depended on explicitly. Without
   * this, the hint banner appearing after data loads (a later render than the
   * effect's first run) left the available height stale/too-tall, letting the
   * capped grid height push the whole page taller than the viewport — a
   * second, native page-level scrollbar alongside the grid's own.
   */
  hasErrorBanner: boolean;
  hasContextMenuHint: boolean;
  hasTouchContextMenuHint: boolean;
}

interface ContinuousScrollSizing {
  layoutHeights: ContinuousScrollLayoutHeights;
  /** Grid root height, or undefined outside desktop continuous scroll. */
  resolvedHeight: number | undefined;
  /** Grid body height inside `resolvedHeight`, minus footer and borders. */
  resolvedBodyHeight: number | undefined;
  /** The window fits, so the grid's own vertical scrollbar is suppressed. */
  shouldHideVerticalOverflow: boolean;
  shouldCollapseRenderZone: boolean;
  /** Distance from the page's right edge to the table's visible right edge. */
  scrollbarRightOffsetPx: number;
}

/**
 * Sizes the continuous-scroll grid to the space below it and pins the measured
 * heights onto MUI's own elements, which otherwise size themselves from the
 * virtualized row count and fight the fixed-height container.
 */
export function useContinuousScrollSizing({
  isContinuousScroll,
  isMobile,
  gridSurfaceRef,
  horizontalScrollRef,
  pageContentRef,
  currentWindowRowCount,
  windowPageSize,
  totalRowCount,
  footerFallbackHeight,
  scrollWindowPage,
  hasErrorBanner,
  hasContextMenuHint,
  hasTouchContextMenuHint,
}: UseContinuousScrollSizingOptions): ContinuousScrollSizing {
  const [layoutHeights, setLayoutHeights] = useState<ContinuousScrollLayoutHeights>(() => ({
    ...DEFAULT_CONTINUOUS_SCROLL_LAYOUT_HEIGHTS,
    footer: footerFallbackHeight,
  }));
  const [availableGridHeight, setAvailableGridHeight] = useState<number | null>(null);
  const [scrollbarRightOffsetPx, setScrollbarRightOffsetPx] = useState<number>(0);

  // Sized for a *full* page while the dataset spans more than one, never for
  // the rows the current page happens to hold: the last page keeps only the
  // remainder, and sizing to it collapsed the whole table the moment the user
  // scrolled to the end. getBalancedPageSize keeps that last page well filled,
  // and this keeps the height identical on every page even when it isn't.
  const rowCountForHeight = totalRowCount > windowPageSize ? windowPageSize : currentWindowRowCount;

  const measuredContentHeight = useMemo(() => Math.ceil(
    layoutHeights.header
    + layoutHeights.footer
    + layoutHeights.border
    + rowCountForHeight * CONTINUOUS_SCROLL_COMPACT_ROW_HEIGHT_PX
    + CONTINUOUS_SCROLL_FIT_EPSILON_PX,
  ), [layoutHeights, rowCountForHeight]);

  const resolvedHeight = isContinuousScroll && !isMobile
    ? Math.min(measuredContentHeight, availableGridHeight ?? measuredContentHeight)
    : undefined;
  const resolvedBodyHeight = resolvedHeight === undefined
    ? undefined
    : Math.max(0, resolvedHeight - layoutHeights.footer - layoutHeights.border);
  const shouldHideVerticalOverflow = Boolean(
    isContinuousScroll
    && !isMobile
    && resolvedHeight !== undefined
    && measuredContentHeight <= resolvedHeight + CONTINUOUS_SCROLL_FIT_EPSILON_PX,
  );
  const shouldCollapseRenderZone = Boolean(
    shouldHideVerticalOverflow && totalRowCount <= CONTINUOUS_SCROLL_PAGE_SIZE,
  );

  useLayoutEffect(() => {
    if (!isContinuousScroll || isMobile) {
      return undefined;
    }

    const measure = (): void => {
      const surface = gridSurfaceRef.current;
      if (!surface) {
        return;
      }

      const root = surface.querySelector(DATA_GRID_ROOT_SELECTOR);
      const header = surface.querySelector('.MuiDataGrid-columnHeaders');
      const footer = surface.querySelector(`.${DATA_GRID_CONTINUOUS_SCROLL_FOOTER_CLASS}`);
      const nextHeights = {
        header: getElementHeight(header, DEFAULT_CONTINUOUS_SCROLL_LAYOUT_HEIGHTS.header),
        footer: getElementHeight(footer, footerFallbackHeight),
        border: getVerticalBorderHeight(root, DEFAULT_CONTINUOUS_SCROLL_LAYOUT_HEIGHTS.border),
      };

      setLayoutHeights((currentHeights) => (
        continuousScrollLayoutHeightsEqual(currentHeights, nextHeights)
          ? currentHeights
          : nextHeights
      ));
    };

    measure();

    let resizeObserver: ResizeObserver | undefined;
    const observedElement = gridSurfaceRef.current;
    if (observedElement && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(observedElement);
    }

    window.addEventListener('resize', measure);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [footerFallbackHeight, currentWindowRowCount, gridSurfaceRef, isContinuousScroll, isMobile]);

  useLayoutEffect(() => {
    if (!isContinuousScroll || isMobile) {
      return undefined;
    }

    const surface = gridSurfaceRef.current;
    const root = surface?.querySelector<HTMLElement>(DATA_GRID_ROOT_SELECTOR);
    const main = surface?.querySelector<HTMLElement>(DATA_GRID_MAIN_SELECTOR);
    const scroller = surface?.querySelector<HTMLElement>(DATA_GRID_VIRTUAL_SCROLLER_SELECTOR);
    if (!root || !main || !scroller || resolvedHeight === undefined || resolvedBodyHeight === undefined) {
      return undefined;
    }

    const bodyHeight = `${resolvedBodyHeight}px`;
    const rootHeight = `${resolvedHeight}px`;
    const applyHeight = (): void => {
      root.style.setProperty('height', rootHeight, 'important');
      root.style.setProperty('max-height', rootHeight, 'important');
      main.style.setProperty('height', bodyHeight, 'important');
      main.style.setProperty('max-height', bodyHeight, 'important');
      main.style.setProperty('overflow', 'hidden');
      scroller.style.setProperty('height', bodyHeight, 'important');
      scroller.style.setProperty('max-height', bodyHeight, 'important');
    };

    applyHeight();
    const rafId = window.requestAnimationFrame(applyHeight);

    return () => {
      window.cancelAnimationFrame(rafId);
      root.style.removeProperty('height');
      root.style.removeProperty('max-height');
      main.style.removeProperty('height');
      main.style.removeProperty('max-height');
      main.style.removeProperty('overflow');
      scroller.style.removeProperty('height');
      scroller.style.removeProperty('max-height');
    };
  }, [
    gridSurfaceRef,
    isContinuousScroll,
    isMobile,
    resolvedBodyHeight,
    resolvedHeight,
    scrollWindowPage,
  ]);

  useLayoutEffect(() => {
    if (!shouldHideVerticalOverflow) {
      return undefined;
    }

    const scroller = gridSurfaceRef.current?.querySelector<HTMLElement>(DATA_GRID_VIRTUAL_SCROLLER_SELECTOR);
    if (!scroller) {
      return undefined;
    }

    const keepAtTop = (): void => {
      if (scroller.scrollTop !== 0) {
        scroller.scrollTop = 0;
      }
    };

    keepAtTop();
    scroller.addEventListener('scroll', keepAtTop);
    return () => {
      scroller.removeEventListener('scroll', keepAtTop);
    };
  }, [gridSurfaceRef, shouldHideVerticalOverflow]);

  useLayoutEffect(() => {
    if (!isContinuousScroll || isMobile) {
      return undefined;
    }

    const scrollport = horizontalScrollRef.current;
    const content = gridSurfaceRef.current;
    const page = pageContentRef.current;
    if (!scrollport || !content || !page) {
      return undefined;
    }

    // The vertical scrollbar track must sit at the table's *visible* right
    // edge: the table's own edge when it's narrower than the scrollport
    // (centered on a wide screen, with empty space to its right), or the
    // scrollport's edge when the table overflows and is scrolled (so the
    // track stays glued to the viewport instead of scrolling away with the
    // wider-than-viewport content). Taking the leftmost of the two edges
    // covers both cases without needing to special-case which one applies.
    const measure = (): void => {
      const scrollportRect = scrollport.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const pageRect = page.getBoundingClientRect();
      const visibleRight = Math.min(scrollportRect.right, contentRect.right);
      setScrollbarRightOffsetPx(Math.max(0, pageRect.right - visibleRight));
    };

    measure();

    let rafId: number | null = null;
    const scheduleMeasure = (): void => {
      if (rafId !== null) {
        return;
      }
      rafId = requestAnimationFrame(() => {
        rafId = null;
        measure();
      });
    };

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleMeasure) : undefined;
    resizeObserver?.observe(scrollport);
    resizeObserver?.observe(content);
    scrollport.addEventListener('scroll', scheduleMeasure, { passive: true });
    window.addEventListener('resize', scheduleMeasure);

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      resizeObserver?.disconnect();
      scrollport.removeEventListener('scroll', scheduleMeasure);
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [gridSurfaceRef, horizontalScrollRef, isContinuousScroll, isMobile, pageContentRef]);

  useLayoutEffect(() => {
    if (!isContinuousScroll || isMobile) {
      return undefined;
    }

    const measure = (): void => {
      const surface = gridSurfaceRef.current;
      if (!surface) {
        return;
      }
      const top = surface.getBoundingClientRect().top;
      setAvailableGridHeight(
        Math.max(CONTINUOUS_SCROLL_MIN_HEIGHT_PX, window.innerHeight - top - CONTINUOUS_SCROLL_BOTTOM_MARGIN_PX),
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
    // hasErrorBanner, hasContextMenuHint and hasTouchContextMenuHint aren't
    // read inside the effect — see their doc comment above for why they are
    // dependencies anyway.
  }, [
    gridSurfaceRef,
    hasContextMenuHint,
    hasErrorBanner,
    hasTouchContextMenuHint,
    isContinuousScroll,
    isMobile,
    pageContentRef,
  ]);

  return {
    layoutHeights,
    resolvedHeight,
    resolvedBodyHeight,
    shouldHideVerticalOverflow,
    shouldCollapseRenderZone,
    scrollbarRightOffsetPx,
  };
}
