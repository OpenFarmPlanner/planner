import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import {
  useStableDataGridScrollbar,
  type StableDataGridScrollbarRowWindow,
} from '../components/data-grid/hooks/useStableDataGridScrollbar';

const SCROLLER = '.MuiDataGrid-virtualScroller';
const THUMB_MIN_HEIGHT_PX = 24;
const OVERFLOW_TOLERANCE_PX = 4;

function installResizeObserver(): void {
  class FakeResizeObserver {
    observe(): void {}
    disconnect(): void {}
    unobserve(): void {}
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
}

/** A wrapper holding a scroll container of a known clientHeight. */
function wrapperWithViewport(clientHeight: number) {
  const wrapper = document.createElement('div');
  const scroller = document.createElement('div');
  scroller.className = 'MuiDataGrid-virtualScroller';
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: clientHeight });
  Object.defineProperty(scroller, 'scrollTop', { configurable: true, writable: true, value: 0 });
  wrapper.appendChild(scroller);
  document.body.appendChild(wrapper);
  return { current: wrapper };
}

const rowWindow: StableDataGridScrollbarRowWindow = {
  page: 0,
  pageSize: 100,
  pageCount: 1,
  ensureRowIndexVisible: () => true,
};

function setup(rowHeights: number[], viewportClientHeight: number, headerHeight = 0) {
  installResizeObserver();
  return renderHook(() => useStableDataGridScrollbar(
    rowHeights,
    rowWindow,
    SCROLLER,
    wrapperWithViewport(viewportClientHeight),
    createRef<HTMLDivElement>(),
    createRef<HTMLDivElement>(),
    headerHeight,
  ));
}

describe('useStableDataGridScrollbar', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('is inactive before anything has been measured', () => {
    installResizeObserver();
    const { result } = renderHook(() => useStableDataGridScrollbar(
      [30, 30], rowWindow, SCROLLER,
      createRef<HTMLElement>(), createRef<HTMLDivElement>(), createRef<HTMLDivElement>(), 0,
    ));

    expect(result.current.isActive).toBe(false);
    expect(result.current.thumbHeight).toBe(0);
  });

  it('draws no scrollbar when the rows fit the viewport', () => {
    const { result } = setup([30, 30, 30], 300);

    expect(result.current.isActive).toBe(false);
  });

  it('tolerates a viewport a few px short of the content', () => {
    // Content and viewport are measured from different sources and land a
    // couple of px apart from border and sub-pixel rounding alone. Without
    // the tolerance that discrepancy drew a scrollbar on a table that fits.
    const { result } = setup([100, 100, 100], 300 - OVERFLOW_TOLERANCE_PX);

    expect(result.current.isActive).toBe(false);
  });

  it('draws a scrollbar once the content genuinely overflows', () => {
    const { result } = setup([100, 100, 100], 300 - OVERFLOW_TOLERANCE_PX - 1);

    expect(result.current.isActive).toBe(true);
  });

  it('subtracts the header, which the scroll container’s height includes', () => {
    // MUI renders the column headers inside the virtual scroller, so a
    // container of 300px with a 100px header leaves a 200px viewport — and
    // 300px of rows then overflow it.
    const withoutHeader = setup([100, 100, 100], 300);
    expect(withoutHeader.result.current.isActive).toBe(false);

    const withHeader = setup([100, 100, 100], 300, 100);
    expect(withHeader.result.current.isActive).toBe(true);
  });

  it('sizes the thumb in proportion to how much of the content is visible', () => {
    // 10 rows of 100px in a 200px viewport: (200 / 1000) * 200 = 40.
    const { result } = setup(Array(10).fill(100), 200);

    expect(result.current.isActive).toBe(true);
    expect(result.current.thumbHeight).toBeCloseTo(40, 5);
  });

  it('never shrinks the thumb below its minimum, however long the list', () => {
    const { result } = setup(Array(1000).fill(100), 200);

    expect(result.current.thumbHeight).toBe(THUMB_MIN_HEIGHT_PX);
  });

  it('measures total height from the real per-row heights, not an average', () => {
    // Same row count, different heights: a hook estimating from an average
    // row height would size both thumbs identically.
    const uniform = setup(Array(10).fill(100), 200);
    const mixed = setup([500, 500, 100, 100, 100, 100, 100, 100, 100, 300], 200);

    expect(mixed.result.current.thumbHeight)
      .not.toBeCloseTo(uniform.result.current.thumbHeight, 5);
  });
});
