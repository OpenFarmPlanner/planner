import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { useContinuousScrollSizing } from '../components/data-grid/useContinuousScrollSizing';
import {
  CONTINUOUS_SCROLL_COMPACT_ROW_HEIGHT_PX,
  CONTINUOUS_SCROLL_FIT_EPSILON_PX,
  CONTINUOUS_SCROLL_PAGE_SIZE,
  DEFAULT_CONTINUOUS_SCROLL_LAYOUT_HEIGHTS as DEFAULTS,
} from '../components/data-grid/continuousScrollLayout';

const FOOTER_FALLBACK = DEFAULTS.footer;

/**
 * With no elements attached the measuring effects bail out, so the hook keeps
 * its default layout heights and an unmeasured available height. That isolates
 * the derived rules, which is where this hook's decisions actually live.
 */
function setup(overrides: Partial<Parameters<typeof useContinuousScrollSizing>[0]> = {}) {
  return renderHook(() => useContinuousScrollSizing({
    isContinuousScroll: true,
    isMobile: false,
    gridSurfaceRef: createRef<HTMLDivElement>(),
    horizontalScrollRef: createRef<HTMLDivElement>(),
    pageContentRef: createRef<HTMLDivElement>(),
    currentWindowRowCount: 10,
    windowPageSize: CONTINUOUS_SCROLL_PAGE_SIZE,
    totalRowCount: 10,
    footerFallbackHeight: FOOTER_FALLBACK,
    scrollWindowPage: 0,
    hasErrorBanner: false,
    hasContextMenuHint: false,
    hasTouchContextMenuHint: false,
    ...overrides,
  }));
}

function expectedHeightFor(rows: number): number {
  return Math.ceil(
    DEFAULTS.header + DEFAULTS.footer + DEFAULTS.border
    + rows * CONTINUOUS_SCROLL_COMPACT_ROW_HEIGHT_PX
    + CONTINUOUS_SCROLL_FIT_EPSILON_PX,
  );
}

describe('useContinuousScrollSizing', () => {
  it('sizes nothing outside continuous scroll', () => {
    const { result } = setup({ isContinuousScroll: false });

    expect(result.current.resolvedHeight).toBeUndefined();
    expect(result.current.resolvedBodyHeight).toBeUndefined();
    expect(result.current.shouldHideVerticalOverflow).toBe(false);
    expect(result.current.shouldCollapseRenderZone).toBe(false);
  });

  it('sizes nothing on mobile, where the page scrolls instead', () => {
    const { result } = setup({ isMobile: true });

    expect(result.current.resolvedHeight).toBeUndefined();
    expect(result.current.shouldHideVerticalOverflow).toBe(false);
  });

  it('sizes a single-page grid to the rows it actually holds', () => {
    const { result } = setup({ currentWindowRowCount: 10, totalRowCount: 10 });

    expect(result.current.resolvedHeight).toBe(expectedHeightFor(10));
  });

  it('sizes a multi-page grid to a full page, not to the current window', () => {
    // The regression this guards: the last page holds only the remainder, and
    // sizing to it collapsed the table as soon as the user scrolled to the end.
    const lastPage = setup({
      currentWindowRowCount: 7,
      windowPageSize: 40,
      totalRowCount: 247,
    });
    const firstPage = setup({
      currentWindowRowCount: 40,
      windowPageSize: 40,
      totalRowCount: 247,
    });

    expect(lastPage.result.current.resolvedHeight).toBe(expectedHeightFor(40));
    expect(lastPage.result.current.resolvedHeight)
      .toBe(firstPage.result.current.resolvedHeight);
  });

  it('takes the body height off the resolved height, never below zero', () => {
    const { result } = setup({ currentWindowRowCount: 10, totalRowCount: 10 });

    expect(result.current.resolvedBodyHeight).toBe(
      result.current.resolvedHeight! - DEFAULTS.footer - DEFAULTS.border,
    );
    expect(result.current.resolvedBodyHeight).toBeGreaterThanOrEqual(0);
  });

  it('hides the grid’s own scrollbar while the window fits', () => {
    const { result } = setup({ currentWindowRowCount: 10, totalRowCount: 10 });

    expect(result.current.shouldHideVerticalOverflow).toBe(true);
  });

  it('collapses the render zone only for a dataset within one internal page', () => {
    const withinOnePage = setup({
      currentWindowRowCount: 10,
      totalRowCount: CONTINUOUS_SCROLL_PAGE_SIZE,
    });
    const beyondOnePage = setup({
      currentWindowRowCount: 10,
      totalRowCount: CONTINUOUS_SCROLL_PAGE_SIZE + 1,
    });

    expect(withinOnePage.result.current.shouldCollapseRenderZone).toBe(true);
    expect(beyondOnePage.result.current.shouldCollapseRenderZone).toBe(false);
  });

  it('starts with the caller’s footer fallback until the footer is measured', () => {
    const { result } = setup({ footerFallbackHeight: 99, totalRowCount: 10 });

    expect(result.current.layoutHeights.footer).toBe(99);
  });

  it('reports no scrollbar offset before anything is measured', () => {
    const { result } = setup();

    expect(result.current.scrollbarRightOffsetPx).toBe(0);
  });
});
