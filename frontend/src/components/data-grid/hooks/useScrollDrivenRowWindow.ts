import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/**
 * Works around the MIT/free @mui/x-data-grid's hard-coded pagination and its
 * page-size cap of 100 rows (see `throwIfPageSizeExceedsTheLimit` in the
 * installed package's gridPaginationUtils — DataGridPro lifts this cap, and
 * this project only depends on the free tier). Below the cap this hook is a
 * no-op passthrough (page 0, pageCount 1) and MUI's own virtualization
 * handles everything. Above it, exposes a `page` the caller must feed into
 * `paginationModel`, and auto-advances/retreats it as the user scrolls near
 * the top/bottom edge of the grid's internal scroll container, so browsing
 * feels like one continuous scroll instead of discrete pages — no pager UI
 * is ever shown (callers keep `hideFooter`).
 *
 * `ensureRowIndexVisible` lets keyboard navigation and deep-link focus (which
 * jump directly to a row by id, not by scrolling) change the page themselves
 * when the target row isn't on the current one — see its callers for the
 * retry-after-next-paint pattern this requires.
 */

const EDGE_THRESHOLD_PX = 48;
// Deliberately outside the edge-trigger zone above, so a reset landing right
// at a page's start/end doesn't sit inside the zone it would otherwise
// immediately re-trigger from on the very next same-direction wheel/touch
// event.
const RESET_OFFSET_PX = 56;
// Minimum accumulated scroll distance in one direction, while already at the
// relevant edge, before a page transition fires. Real trackpads/precision
// mice commonly emit a stray reversed-sign deltaY tick during otherwise
// continuous scrolling (sub-pixel sampling noise, momentum-deceleration
// tail) — reacting to a single event's sign flipped the page on that noise
// alone whenever the current page happened to sit close enough to an edge
// (which is common: some 100-row pages are only slightly taller than the
// viewport, depending on where the boundary lands relative to field/bed
// groupings). Requiring a small committed distance filters that noise
// without perceptibly delaying an intentional scroll.
const COMMIT_THRESHOLD_PX = 24;

// A last page shorter than this looks like the table "lost" most of its rows
// when the user reaches the end, so a page size that produces one is rejected
// while a better one is available. 60 rows is roughly twice the rows a grid
// fills on a common desktop viewport.
const MIN_LAST_PAGE_ROWS = 60;

const getLastPageRowCount = (totalRowCount: number, pageSize: number): number => {
  const remainder = totalRowCount % pageSize;
  return remainder === 0 ? pageSize : remainder;
};

/**
 * Picks the internal page size so the *last* page is well filled instead of
 * holding whatever remainder is left over.
 *
 * Both continuous-scroll grids pin their height to the rows a full page holds,
 * and MUI slices pages at fixed offsets, so the last page keeps
 * `totalRowCount % pageSize` rows. At 10,218 rows that is 18 — the table
 * visibly collapsed to a fraction of its height the moment the user scrolled
 * to the end. Dividing evenly (`ceil(total / pageCount)`) fixes the small
 * cases (209 rows become 70/70/69) but not the large ones: with 103 pages the
 * even split rounds straight back up to 100 and the remainder survives.
 *
 * So the page size is searched downwards from `maxPageSize` for the first one
 * whose last page is full or holds at least MIN_LAST_PAGE_ROWS rows, never
 * going below half of `maxPageSize` — every page has to stay taller than the
 * viewport for the continuous-scroll illusion to hold. If no candidate
 * qualifies (possible for row counts just above the cap, e.g. 101), the one
 * with the fullest last page wins.
 *
 * Returns `maxPageSize` unchanged when everything fits on one page: there is
 * no page transition to smooth out, and a single short page *should* size the
 * table to its content.
 */
export function getBalancedPageSize(totalRowCount: number, maxPageSize: number): number {
  if (totalRowCount <= maxPageSize || maxPageSize <= 0) {
    return maxPageSize;
  }

  const smallestPageSize = Math.max(1, Math.floor(maxPageSize / 2));
  let bestPageSize = maxPageSize;
  let bestLastPageRowCount = 0;

  for (let pageSize = maxPageSize; pageSize >= smallestPageSize; pageSize -= 1) {
    const lastPageRowCount = getLastPageRowCount(totalRowCount, pageSize);
    if (lastPageRowCount >= Math.min(MIN_LAST_PAGE_ROWS, pageSize)) {
      return pageSize;
    }
    if (lastPageRowCount > bestLastPageRowCount) {
      bestPageSize = pageSize;
      bestLastPageRowCount = lastPageRowCount;
    }
  }

  return bestPageSize;
}

export interface ScrollDrivenRowWindow {
  page: number;
  pageCount: number;
  pageSize: number;
  ensureRowIndexVisible: (rowIndex: number, options?: { forRowCount?: number }) => boolean;
}

export function useScrollDrivenRowWindow(
  totalRowCount: number,
  pageSize: number,
  scrollContainerSelector: string,
  wrapperRef: React.RefObject<HTMLElement | null>,
  options: { preservePageOnRowCountChange?: boolean } = {},
): ScrollDrivenRowWindow {
  // Page is paired with the row count it was set for, so a change to
  // totalRowCount (any expand/collapse re-flattens the tree into a
  // differently-sized list) makes the stored page fall back to 0 purely by
  // derivation — no ref/effect needed to "reset" it.
  const [pageState, setPageState] = useState({ page: 0, forRowCount: totalRowCount });
  const pageCount = Math.max(1, Math.ceil(totalRowCount / pageSize));
  const page = options.preservePageOnRowCountChange || pageState.forRowCount === totalRowCount
    ? pageState.page
    : 0;
  const clampedPage = Math.min(page, pageCount - 1);

  // Read at call time via a ref (kept fresh below) instead of closing over
  // totalRowCount directly, so setPage's identity — and everything derived
  // from it (ensureRowIndexVisible, the returned object) — stays stable
  // across ordinary row count changes. Depending on totalRowCount here
  // would give focus helpers a new identity on every toggle or insertion.
  const totalRowCountRef = useRef(totalRowCount);
  useLayoutEffect(() => {
    totalRowCountRef.current = totalRowCount;
  }, [totalRowCount]);

  const setPage = useCallback((nextPage: number, forRowCount = totalRowCountRef.current) => {
    setPageState({ page: nextPage, forRowCount });
  }, []);

  const pendingResetRef = useRef<"top" | "bottom" | null>(null);

  useEffect(() => {
    if (!pendingResetRef.current) {
      return;
    }
    const container = wrapperRef.current?.querySelector<HTMLElement>(scrollContainerSelector);
    if (container) {
      container.scrollTop = pendingResetRef.current === "top"
        ? RESET_OFFSET_PX
        : Math.max(0, container.scrollHeight - container.clientHeight - RESET_OFFSET_PX);
    }
    pendingResetRef.current = null;
  }, [clampedPage, scrollContainerSelector, wrapperRef]);

  useEffect(() => {
    if (totalRowCount <= pageSize) {
      return undefined;
    }
    const container = wrapperRef.current?.querySelector<HTMLElement>(scrollContainerSelector);
    if (!container) {
      return undefined;
    }

    // Trigger transitions only from genuine user gestures (wheel deltaY,
    // touch drag distance) rather than from the container's scrollTop
    // itself. An earlier version inferred direction from scrollTop's
    // position or its delta between 'scroll' events, which broke in two
    // related ways: (1) row heights vary (a field row is taller than a bed
    // row), so a 100-row page can land anywhere relative to field/bed
    // groupings — some pages are shorter than the viewport and never
    // accumulate any scrollTop, making "near top"/"near bottom" both
    // trivially true; and (2) MUI's own virtualization can adjust scrollTop
    // asynchronously after a page renders (e.g. once real row heights
    // replace estimates), which a scrollTop-delta listener can't tell apart
    // from the user scrolling, misreading an internal adjustment as
    // "scrolling up" and cascading back a page with no user input at all.
    // Gesture deltas aren't affected by either: they only exist while a
    // real wheel/touch event is in flight.
    //
    // A single event's sign still isn't reliable enough on its own — see
    // COMMIT_THRESHOLD_PX above — so deltas accumulate here and only commit
    // to a transition once they add up to a real, sustained gesture in one
    // direction. A sign change starts the accumulator over instead of
    // partially cancelling it, so a genuine reversal isn't dampened by
    // whatever noise preceded it.
    let committedDelta = 0;
    const processDelta = (deltaY: number): void => {
      if (pendingResetRef.current || deltaY === 0) {
        return;
      }
      committedDelta = Math.sign(committedDelta) === Math.sign(deltaY)
        ? committedDelta + deltaY
        : deltaY;

      const { scrollTop, scrollHeight, clientHeight } = container;
      const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
      if (
        committedDelta >= COMMIT_THRESHOLD_PX
        && scrollTop >= maxScrollTop - EDGE_THRESHOLD_PX
        && clampedPage < pageCount - 1
      ) {
        committedDelta = 0;
        pendingResetRef.current = "top";
        setPage(clampedPage + 1);
      } else if (
        committedDelta <= -COMMIT_THRESHOLD_PX
        && scrollTop <= EDGE_THRESHOLD_PX
        && clampedPage > 0
      ) {
        committedDelta = 0;
        pendingResetRef.current = "bottom";
        setPage(clampedPage - 1);
      }
    };

    const handleWheel = (event: WheelEvent): void => {
      processDelta(event.deltaY);
    };

    // Touch has no deltaY, so direction is tracked as the distance dragged
    // since the last touch point.
    let touchY = 0;
    const handleTouchStart = (event: TouchEvent): void => {
      touchY = event.touches[0]?.clientY ?? 0;
    };
    const handleTouchMove = (event: TouchEvent): void => {
      const currentY = event.touches[0]?.clientY;
      if (currentY == null) {
        return;
      }
      processDelta(touchY - currentY);
      touchY = currentY;
    };

    container.addEventListener("wheel", handleWheel, { passive: true });
    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: true });
    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
    };
  }, [clampedPage, pageCount, pageSize, scrollContainerSelector, setPage, totalRowCount, wrapperRef]);

  const ensureRowIndexVisible = useCallback((rowIndex: number, options?: { forRowCount?: number }): boolean => {
    if (rowIndex < 0) {
      return false;
    }
    const targetPage = Math.floor(rowIndex / pageSize);
    if (targetPage === clampedPage) {
      return false;
    }
    setPage(targetPage, options?.forRowCount);
    return true;
  }, [clampedPage, pageSize, setPage]);

  // Memoized so consumers that focus rows after changing the window can
  // safely depend on the whole returned object without it changing identity
  // on every render — only when the page/pageCount actually change.
  return useMemo(() => ({
    page: clampedPage,
    pageCount,
    pageSize,
    ensureRowIndexVisible,
  }), [clampedPage, pageCount, pageSize, ensureRowIndexVisible]);
}
