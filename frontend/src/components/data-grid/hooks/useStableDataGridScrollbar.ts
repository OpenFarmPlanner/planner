import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

/**
 * Draws a custom vertical scrollbar for a paged DataGrid, sized and
 * positioned against the TRUE total row height across every internal page
 * (see useScrollDrivenRowWindow) instead of just the ~100 rows currently
 * mounted.
 *
 * The free @mui/x-data-grid's own floating scrollbar (`.MuiDataGrid-scrollbar
 * --vertical`) sizes itself from the grid's current content height, which —
 * under useScrollDrivenRowWindow's paging workaround — only ever reflects the
 * loaded page. Every page swap can change that page's content height,
 * so the native thumb's size and position visibly reset/jump on every
 * transition even though the user experiences it as one continuous scroll.
 * This hook computes exact cumulative row-top offsets from the real row
 * heights (not an estimate) so the thumb's size/position are stable and
 * continuous across page boundaries.
 *
 * The real scroll container (`.MuiDataGrid-virtualScroller`) is left
 * scrollable via wheel/touch/keyboard exactly as before — this hook only
 * mirrors its position for display and, when the user drags the thumb,
 * drives it via scrollTop/ensureRowIndexVisible (crossing page boundaries as
 * needed).
 *
 * The thumb's *position* is written straight to `thumbRef`'s inline style
 * instead of being returned as a rendered value: it changes on every scroll
 * frame, and a state update per frame re-rendered the whole grid (with all
 * its rows, cells and editors) just to move one 24px box. Only values that
 * change rarely — whether the scrollbar exists at all, and how tall the
 * thumb is — go through React state.
 *
 * `trackRef` and `thumbRef` are created and attached by the caller (not by
 * this hook) so their identity is a plain component-owned ref the linter can
 * follow — bundling a ref inside this hook's returned object made every other
 * property on that object look like a ref access to eslint-plugin-react-hooks'
 * static analysis.
 */

const THUMB_MIN_HEIGHT_PX = 24;
// totalContentHeight (summed from our own per-row heights) and viewportHeight
// (measured from the scroll container's real clientHeight) each land within
// a couple of px of each other purely from the grid's own border and
// sub-pixel layout rounding, even when every row is fully visible with
// nothing to scroll. Without this tolerance, that discrepancy alone flipped
// isActive to true and drew a scrollbar for tables that fit the viewport.
const OVERFLOW_TOLERANCE_PX = 4;

export interface StableDataGridScrollbarRowWindow {
  page: number;
  pageSize: number;
  pageCount: number;
  ensureRowIndexVisible: (rowIndex: number) => boolean;
}

export interface StableDataGridScrollbar {
  /** False when content fits without scrolling — nothing should render. */
  isActive: boolean;
  thumbHeight: number;
  onThumbPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onTrackPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
}

interface ThumbGeometry {
  pageStartOffset: number;
  maxGlobalScrollTop: number;
  thumbTravel: number;
}

export function useStableDataGridScrollbar(
  rowHeights: number[],
  rowWindow: StableDataGridScrollbarRowWindow,
  scrollContainerSelector: string,
  wrapperRef: React.RefObject<HTMLElement | null>,
  trackRef: React.RefObject<HTMLDivElement | null>,
  thumbRef: React.RefObject<HTMLDivElement | null>,
  headerHeight: number,
): StableDataGridScrollbar {
  const totalRowCount = rowHeights.length;
  const { page, pageSize, ensureRowIndexVisible } = rowWindow;

  // prefixOffsets[i] is the pixel offset of the top of row i within the full
  // (all-pages) row list; prefixOffsets[totalRowCount] is the total content
  // height. Built from the same exact per-row heights the grid itself uses
  // (getRowHeight), not an average/estimate.
  const prefixOffsets = useMemo(() => {
    const offsets = new Array<number>(totalRowCount + 1);
    offsets[0] = 0;
    for (let i = 0; i < totalRowCount; i += 1) {
      offsets[i + 1] = offsets[i] + rowHeights[i];
    }
    return offsets;
  }, [rowHeights, totalRowCount]);

  const totalContentHeight = prefixOffsets[totalRowCount] ?? 0;
  const pageStartOffset = prefixOffsets[Math.min(page * pageSize, totalRowCount)] ?? 0;

  const [viewportHeight, setViewportHeight] = useState(0);
  // The scroll container's own scrollTop within the currently loaded page.
  // A ref rather than state: it changes on every scroll frame and only ever
  // feeds the imperative thumb update below.
  const localScrollTopRef = useRef(0);
  const geometryRef = useRef<ThumbGeometry>({
    pageStartOffset: 0,
    maxGlobalScrollTop: 0,
    thumbTravel: 0,
  });

  const getContainer = useCallback((): HTMLElement | null => (
    wrapperRef.current?.querySelector<HTMLElement>(scrollContainerSelector) ?? null
  ), [scrollContainerSelector, wrapperRef]);

  const getGlobalScrollTop = useCallback((): number => (
    geometryRef.current.pageStartOffset + localScrollTopRef.current
  ), []);

  const applyThumbPosition = useCallback((): void => {
    const thumb = thumbRef.current;
    if (!thumb) {
      return;
    }
    const { maxGlobalScrollTop, thumbTravel } = geometryRef.current;
    const thumbTop = maxGlobalScrollTop > 0
      ? (Math.min(getGlobalScrollTop(), maxGlobalScrollTop) / maxGlobalScrollTop) * thumbTravel
      : 0;
    thumb.style.transform = `translate3d(0, ${thumbTop}px, 0)`;
  }, [getGlobalScrollTop, thumbRef]);

  const maxGlobalScrollTop = Math.max(0, totalContentHeight - viewportHeight);
  const isActive = totalContentHeight > viewportHeight + OVERFLOW_TOLERANCE_PX && viewportHeight > 0;

  const thumbHeight = isActive
    ? Math.max(THUMB_MIN_HEIGHT_PX, (viewportHeight / totalContentHeight) * viewportHeight)
    : 0;
  const thumbTravel = Math.max(0, viewportHeight - thumbHeight);

  // Publish the geometry the imperative updates read, then reposition the
  // thumb for it. Deliberately runs after every render (no dependency array):
  // it is a handful of arithmetic operations and two ref writes, and it keeps
  // the thumb correct after any change — a resize, a page swap, a row added —
  // without each of those needing its own effect.
  useLayoutEffect(() => {
    geometryRef.current = { pageStartOffset, maxGlobalScrollTop, thumbTravel };
    applyThumbPosition();
  });

  // Re-measures on every page change (not just via the scroll/resize
  // listeners below) because a page transition can move scrollTop
  // programmatically (see useScrollDrivenRowWindow's reset-to-edge effect)
  // before this effect's listener has a chance to observe the resulting
  // 'scroll' event in some environments (e.g. jsdom doesn't fire one for
  // programmatic scrollTop assignment at all).
  useLayoutEffect(() => {
    const container = getContainer();
    const measure = (): void => {
      // container.clientHeight is the *whole* scrollable area, including the
      // column header row — MUI renders GridHeaders as a sticky element
      // inside .MuiDataGrid-virtualScroller itself, not as a sibling above
      // it. The track rendered by the caller is positioned below the
      // header (top: headerHeight), so its actual rendered height is
      // clientHeight - headerHeight; using the unadjusted clientHeight here
      // made the thumb's travel range taller than the track it's drawn in,
      // letting it overflow past the track's bottom edge once scrolled to
      // the very end.
      localScrollTopRef.current = container ? container.scrollTop : 0;
      // Only the viewport height goes through state, and only when it really
      // changed: a scroll event that leaves it untouched must not re-render
      // the grid.
      setViewportHeight((currentHeight) => {
        const nextHeight = container ? Math.max(0, container.clientHeight - headerHeight) : 0;
        return nextHeight === currentHeight ? currentHeight : nextHeight;
      });
      applyThumbPosition();
    };
    measure();
    if (!container) {
      return undefined;
    }

    // A native 'scroll' event can fire far more often than the display can
    // paint (every pixel of trackpad momentum, dozens of times a second).
    // Coalescing to one measurement per animation frame keeps the thumb
    // visually in sync (still every frame) without redoing that work for
    // events the user could never see between two paints anyway.
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

    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleMeasure);
      resizeObserver.observe(container);
    }

    container.addEventListener("scroll", scheduleMeasure, { passive: true });
    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      resizeObserver?.disconnect();
      container.removeEventListener("scroll", scheduleMeasure);
    };
  }, [applyThumbPosition, getContainer, page, headerHeight]);

  // Largest row index whose top offset is <= targetOffset.
  const rowIndexAtOffset = useCallback((targetOffset: number): number => {
    if (totalRowCount === 0) {
      return 0;
    }
    let low = 0;
    let high = totalRowCount - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (prefixOffsets[mid] <= targetOffset) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return low;
  }, [prefixOffsets, totalRowCount]);

  const setContainerScrollTop = useCallback((localScrollTop: number): void => {
    const container = getContainer();
    if (!container) {
      return;
    }
    container.scrollTop = localScrollTop;
    localScrollTopRef.current = container.scrollTop;
    applyThumbPosition();
  }, [applyThumbPosition, getContainer]);

  // Set by scrollToGlobalOffset right before it triggers a page change, and
  // consumed by the effect below once that page's container is on screen —
  // mirrors the pendingResetRef pattern in useScrollDrivenRowWindow, but for an
  // arbitrary drag-target offset instead of a fixed top/bottom edge.
  const pendingGlobalOffsetRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingGlobalOffsetRef.current === null) {
      return;
    }
    const target = pendingGlobalOffsetRef.current;
    pendingGlobalOffsetRef.current = null;
    setContainerScrollTop(target - pageStartOffset);
  }, [page, pageStartOffset, setContainerScrollTop]);

  const scrollToGlobalOffset = useCallback((targetOffset: number): void => {
    const clamped = Math.min(Math.max(0, targetOffset), geometryRef.current.maxGlobalScrollTop);
    const targetRowIndex = rowIndexAtOffset(clamped);
    const targetPage = Math.floor(targetRowIndex / pageSize);
    if (targetPage !== page) {
      pendingGlobalOffsetRef.current = clamped;
      ensureRowIndexVisible(targetRowIndex);
      return;
    }
    setContainerScrollTop(clamped - geometryRef.current.pageStartOffset);
  }, [ensureRowIndexVisible, page, pageSize, rowIndexAtOffset, setContainerScrollTop]);

  const onThumbPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const { thumbTravel: travel, maxGlobalScrollTop: maxOffset } = geometryRef.current;
    if (travel <= 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const startClientY = event.clientY;
    const startGlobalScrollTop = getGlobalScrollTop();
    event.currentTarget.setPointerCapture(event.pointerId);

    // Dragging can emit pointermove far faster than the display repaints -
    // coalesce to the latest position once per animation frame instead of
    // calling scrollToGlobalOffset for every single event.
    let rafId: number | null = null;
    let latestClientY = startClientY;
    const applyLatestMove = (): void => {
      rafId = null;
      const deltaRatio = (latestClientY - startClientY) / travel;
      scrollToGlobalOffset(startGlobalScrollTop + deltaRatio * maxOffset);
    };
    const handleMove = (moveEvent: PointerEvent): void => {
      latestClientY = moveEvent.clientY;
      if (rafId === null) {
        rafId = requestAnimationFrame(applyLatestMove);
      }
    };
    const handleUp = (): void => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }, [getGlobalScrollTop, scrollToGlobalOffset]);

  const onTrackPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const track = trackRef.current;
    if (event.target !== track || !track || totalContentHeight <= 0) {
      return;
    }
    const rect = track.getBoundingClientRect();
    const clickRatio = (event.clientY - rect.top) / rect.height;
    scrollToGlobalOffset(clickRatio * totalContentHeight - viewportHeight / 2);
  }, [scrollToGlobalOffset, totalContentHeight, trackRef, viewportHeight]);

  return useMemo(() => ({
    isActive,
    thumbHeight,
    onThumbPointerDown,
    onTrackPointerDown,
  }), [isActive, thumbHeight, onThumbPointerDown, onTrackPointerDown]);
}
