/**
 * Verifies the custom scrollbar introduced to fix the free DataGrid's
 * "jumping" scrollbar under useHierarchyRowWindow's internal paging (see
 * that hook's docs): MUI's own floating scrollbar sizes itself from only the
 * currently-loaded ~100-row page, so its thumb visibly resets on every page
 * transition even though the user is scrolling continuously. This hook
 * computes the thumb's position from the TRUE total row height across every
 * page instead, which should stay continuous across a transition.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act } from 'react';
import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import {
  useHierarchyStableScrollbar,
  type HierarchyRowWindowForScrollbar,
} from '../components/hierarchy/hooks/useHierarchyStableScrollbar';
import {
  getBalancedPageSize,
  useScrollDrivenRowWindow,
} from '../components/data-grid/hooks/useScrollDrivenRowWindow';

const SELECTOR = '.mock-scroller';
const ROW_HEIGHT = 30;
const PAGE_SIZE = 100;
const CLIENT_HEIGHT = 500;

function setUpDom() {
  const wrapper = document.createElement('div');
  const container = document.createElement('div');
  container.className = 'mock-scroller';
  Object.defineProperty(container, 'clientHeight', { value: CLIENT_HEIGHT, configurable: true });
  wrapper.appendChild(container);
  document.body.appendChild(wrapper);

  const wrapperRef = createRef<HTMLDivElement>();
  // @ts-expect-error -- assigning to a readonly ref for test setup, same pattern used elsewhere in this suite.
  wrapperRef.current = wrapper;
  const trackRef = createRef<HTMLDivElement>();
  // The hook moves the thumb by writing its inline transform (rather than
  // re-rendering the grid on every scroll frame), so the tests need a real
  // element to read that position back from.
  const thumb = document.createElement('div');
  wrapper.appendChild(thumb);
  const thumbRef = createRef<HTMLDivElement>();
  // @ts-expect-error -- assigning to a readonly ref for test setup, same pattern used elsewhere in this suite.
  thumbRef.current = thumb;

  return { wrapper, container, wrapperRef, trackRef, thumbRef, thumb };
}

/** Vertical offset the hook wrote onto the thumb, in px. */
function readThumbTop(thumb: HTMLElement): number {
  const match = /translate3d\([^,]+,\s*(-?[\d.]+)px/.exec(thumb.style.transform);
  return match ? Number(match[1]) : 0;
}

function makeRowWindow(
  overrides: Partial<HierarchyRowWindowForScrollbar> = {},
): HierarchyRowWindowForScrollbar {
  return {
    page: 0,
    pageSize: PAGE_SIZE,
    pageCount: 3,
    ensureRowIndexVisible: vi.fn(() => true),
    ...overrides,
  };
}

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}


describe('useScrollDrivenRowWindow row-count transitions', () => {
  // The balanced page size moves with the row count, so a page index resolved
  // against the size still on screen can point at rows the next render no
  // longer puts there. 4512 rows page at 96, 4513 at 89.
  const ROWS_BEFORE_APPEND = 4512;
  const MAX_PAGE_SIZE = 100;

  it('pages to the row the caller is about to append, not to a stale page', () => {
    const wrapperRef = createRef<HTMLElement>();
    const { result, rerender } = renderHook(
      ({ totalRowCount }: { totalRowCount: number }) => useScrollDrivenRowWindow(
        totalRowCount,
        MAX_PAGE_SIZE,
        SELECTOR,
        wrapperRef,
        { preservePageOnRowCountChange: true },
      ),
      { initialProps: { totalRowCount: ROWS_BEFORE_APPEND } },
    );

    const newRowIndex = ROWS_BEFORE_APPEND;
    act(() => {
      result.current.ensureRowIndexVisible(newRowIndex, { forRowCount: ROWS_BEFORE_APPEND + 1 });
    });
    rerender({ totalRowCount: ROWS_BEFORE_APPEND + 1 });

    const { page, pageSize } = result.current;
    expect(newRowIndex).toBeGreaterThanOrEqual(page * pageSize);
    expect(newRowIndex).toBeLessThan((page + 1) * pageSize);
  });
});

describe('getBalancedPageSize', () => {
  it('leaves the page size alone while everything fits on one page', () => {
    expect(getBalancedPageSize(0, 100)).toBe(100);
    expect(getBalancedPageSize(9, 100)).toBe(100);
    expect(getBalancedPageSize(100, 100)).toBe(100);
  });

  it('keeps a full page size when the rows divide evenly', () => {
    expect(getBalancedPageSize(5000, 100)).toBe(100);
    expect(getBalancedPageSize(300, 100)).toBe(100);
  });

  it('picks a page size that leaves a well-filled last page', () => {
    // 209 rows used to page as 100/100/9: scrolling to the end left the grid
    // sizing itself to nine rows, so the table visibly collapsed.
    expect(getBalancedPageSize(209, 100)).toBe(74); // 74/74/61
    // Large counts just above a multiple of the cap are the case an even
    // split (ceil(total / pageCount)) does *not* fix: it rounds straight back
    // up to 100 and the 18-row remainder survives.
    expect(getBalancedPageSize(10_218, 100)).toBe(94); // last page 66 rows
    expect(getBalancedPageSize(9909, 100)).toBe(92); // last page 65 rows
  });

  it('falls back to the fullest last page when no page size reaches the minimum', () => {
    // 101 rows cannot do better than 51/50, so the fallback has to pick that
    // rather than leaving the single-row remainder of a 100-row page.
    expect(getBalancedPageSize(101, 100)).toBe(51);
  });

  it('keeps every page within the DataGrid cap and tall enough to scroll', () => {
    const rowCounts = [101, 209, 250, 999, 1000, 1001, 5000, 9909, 10_218, 20_017, 99_999];
    for (const totalRowCount of rowCounts) {
      const pageSize = getBalancedPageSize(totalRowCount, 100);
      expect(pageSize).toBeLessThanOrEqual(100);
      expect(pageSize).toBeGreaterThanOrEqual(50);

      const remainder = totalRowCount % pageSize;
      const lastPageRowCount = remainder === 0 ? pageSize : remainder;
      // 101 rows is the documented exception: no page size reaches the
      // minimum, so the fullest available last page (50) wins.
      expect(lastPageRowCount).toBeGreaterThanOrEqual(totalRowCount === 101 ? 50 : 60);
    }
  });
});

describe('useHierarchyStableScrollbar', () => {
  beforeEach(() => {
    global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  });

  it('sizes the thumb from the total row count, not just the loaded page', () => {
    const { container, wrapperRef, trackRef, thumbRef } = setUpDom();
    container.scrollTop = 0;
    const rowHeights = Array.from({ length: 300 }, () => ROW_HEIGHT); // 9000px total

    const { result } = renderHook(() => (
      useHierarchyStableScrollbar(rowHeights, makeRowWindow(), SELECTOR, wrapperRef, trackRef, thumbRef, 0)
    ));

    // total content (9000) vs viewport (500) => thumb covers ~5.5% of the track.
    expect(result.current.isActive).toBe(true);
    const expectedThumbHeight = (CLIENT_HEIGHT / 9000) * CLIENT_HEIGHT;
    expect(result.current.thumbHeight).toBeCloseTo(expectedThumbHeight, 1);
  });

  it('is inactive when all rows already fit within the viewport', () => {
    const { wrapperRef, trackRef, thumbRef } = setUpDom();
    const rowHeights = Array.from({ length: 5 }, () => ROW_HEIGHT); // 150px total, fits in 500px viewport

    const { result } = renderHook(() => (
      useHierarchyStableScrollbar(rowHeights, makeRowWindow({ pageCount: 1 }), SELECTOR, wrapperRef, trackRef, thumbRef, 0)
    ));

    expect(result.current.isActive).toBe(false);
    expect(result.current.thumbHeight).toBe(0);
  });

  it('keeps the thumb position continuous across a page transition instead of resetting', () => {
    const { container, wrapperRef, trackRef, thumbRef, thumb } = setUpDom();
    const rowHeights = Array.from({ length: 300 }, () => ROW_HEIGHT); // 9000px total, 3 pages of 100

    // Near the bottom edge of page 0 (rows 0..99, local height 3000px).
    container.scrollTop = 2900;
    const { rerender } = renderHook(
      ({ page }) => useHierarchyStableScrollbar(rowHeights, makeRowWindow({ page }), SELECTOR, wrapperRef, trackRef, thumbRef, 0),
      { initialProps: { page: 0 } },
    );
    const thumbTopBeforeTransition = readThumbTop(thumb);

    // Simulate useHierarchyRowWindow's page transition: it advances the page
    // and resets the container's local scrollTop near the new page's top
    // edge (RESET_OFFSET_PX in that hook) — done here before rerender, the
    // same order in which the real effect and this hook's effect would run.
    container.scrollTop = 56;
    rerender({ page: 1 });
    const thumbTopAfterTransition = readThumbTop(thumb);

    // The global position barely moved (2900 -> 3056 out of 8500 possible),
    // so the thumb should have moved only slightly, not snapped back toward
    // the top of the track the way a per-page-relative scrollbar would.
    expect(Math.abs(thumbTopAfterTransition - thumbTopBeforeTransition)).toBeLessThan(15);
  });

  it('dragging the thumb across a page boundary calls ensureRowIndexVisible for the target row', async () => {
    const { container, wrapperRef, trackRef, thumbRef } = setUpDom();
    const rowHeights = Array.from({ length: 300 }, () => ROW_HEIGHT); // 9000px total
    container.scrollTop = 0;
    const ensureRowIndexVisible = vi.fn(() => true);

    const { result } = renderHook(() => (
      useHierarchyStableScrollbar(rowHeights, makeRowWindow({ ensureRowIndexVisible }), SELECTOR, wrapperRef, trackRef, thumbRef, 0)
    ));

    const thumbTravel = CLIENT_HEIGHT - result.current.thumbHeight;
    const maxGlobalScrollTop = 9000 - CLIENT_HEIGHT;

    const setPointerCapture = vi.fn();
    result.current.onThumbPointerDown({
      clientY: 0,
      pointerId: 1,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      currentTarget: { setPointerCapture },
    } as unknown as React.PointerEvent<HTMLDivElement>);

    // Drag far enough down the track to land past page 0's 3000px of rows.
    const dragDeltaY = thumbTravel; // drags to the very bottom of the track
    const MoveEvent = typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
    window.dispatchEvent(new MoveEvent('pointermove', { clientY: dragDeltaY } as MouseEventInit));

    // The drag handler coalesces pointermove to one update per animation
    // frame (see useHierarchyStableScrollbar) rather than acting on every
    // event synchronously, so the resulting call lands on the next frame.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(ensureRowIndexVisible).toHaveBeenCalled();
    const targetRowIndex = ensureRowIndexVisible.mock.calls[0][0] as number;
    // Dragging to the bottom of the track should target a row well past
    // page 0's 100 rows (proof the drag maps against the full row list).
    expect(targetRowIndex).toBeGreaterThan(PAGE_SIZE);
    expect(targetRowIndex * ROW_HEIGHT).toBeCloseTo(maxGlobalScrollTop, -2);
  });

  it('moves the thumb on scroll without re-rendering its consumer', async () => {
    // Every scroll frame used to push the container's scrollTop into React
    // state, re-rendering the whole grid (rows, cells, editors) just to move
    // a 24px box — the main reason scrolling large tables felt sluggish. The
    // position is written to the thumb's inline style instead, so a scroll
    // must move the thumb without producing a single extra render.
    const { container, wrapperRef, trackRef, thumbRef, thumb } = setUpDom();
    const rowHeights = Array.from({ length: 300 }, () => ROW_HEIGHT); // 9000px total
    container.scrollTop = 0;

    let renderCount = 0;
    renderHook(() => {
      renderCount += 1;
      return useHierarchyStableScrollbar(rowHeights, makeRowWindow(), SELECTOR, wrapperRef, trackRef, thumbRef, 0);
    });

    const rendersAfterMount = renderCount;
    expect(readThumbTop(thumb)).toBe(0);

    container.scrollTop = 1500;
    container.dispatchEvent(new Event('scroll'));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(readThumbTop(thumb)).toBeGreaterThan(0);
    expect(renderCount).toBe(rendersAfterMount);
  });

  it('keeps the thumb within the rows-only viewport when clientHeight includes a header', () => {
    // MUI renders the column header row *inside* .MuiDataGrid-virtualScroller
    // (as a sticky top element), so container.clientHeight covers the header
    // too. The track this thumb is drawn in only spans the rows area (it's
    // offset below the header — see FieldsBedsHierarchy.tsx), so the hook
    // must subtract headerHeight itself or the thumb's travel range ends up
    // taller than the track and overflows past its bottom edge once scrolled
    // to the very end.
    const HEADER_HEIGHT = 40;
    const { container, wrapperRef, trackRef, thumbRef, thumb } = setUpDom();
    const rowHeights = Array.from({ length: 300 }, () => ROW_HEIGHT); // 9000px total
    container.scrollTop = 9000 - CLIENT_HEIGHT; // scrolled all the way to the end

    const { result } = renderHook(() => (
      useHierarchyStableScrollbar(rowHeights, makeRowWindow(), SELECTOR, wrapperRef, trackRef, thumbRef, HEADER_HEIGHT)
    ));

    const rowsOnlyViewport = CLIENT_HEIGHT - HEADER_HEIGHT;
    expect(readThumbTop(thumb) + result.current.thumbHeight).toBeLessThanOrEqual(rowsOnlyViewport + 0.01);
  });
});
