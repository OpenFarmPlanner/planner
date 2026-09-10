import { act, renderHook } from '@testing-library/react';
import { useScrollDrivenRowWindow } from '../components/data-grid/hooks/useScrollDrivenRowWindow';

const SELECTOR = '.scroller';
const EDGE_THRESHOLD_PX = 48;
const COMMIT_THRESHOLD_PX = 24;
const RESET_OFFSET_PX = 56;

interface Metrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** jsdom lays nothing out, so the scroll metrics the hook reads are stubbed. */
function makeScroller(metrics: Metrics) {
  const wrapper = document.createElement('div');
  const scroller = document.createElement('div');
  scroller.className = 'scroller';
  wrapper.append(scroller);
  document.body.append(wrapper);

  const state = { ...metrics };
  Object.defineProperty(scroller, 'scrollHeight', { get: () => state.scrollHeight });
  Object.defineProperty(scroller, 'clientHeight', { get: () => state.clientHeight });
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => state.scrollTop,
    set: (value: number) => { state.scrollTop = value; },
    configurable: true,
  });

  return { wrapper, scroller, state };
}

function setup({
  totalRowCount,
  maxPageSize = 100,
  metrics = { scrollTop: 0, scrollHeight: 2000, clientHeight: 500 },
  preservePageOnRowCountChange,
}: {
  totalRowCount: number;
  maxPageSize?: number;
  metrics?: Metrics;
  preservePageOnRowCountChange?: boolean;
}) {
  const { wrapper, scroller, state } = makeScroller(metrics);
  const wrapperRef = { current: wrapper as HTMLElement | null };

  const view = renderHook(
    (props: { totalRowCount: number }) => useScrollDrivenRowWindow(
      props.totalRowCount,
      maxPageSize,
      SELECTOR,
      wrapperRef,
      preservePageOnRowCountChange === undefined ? {} : { preservePageOnRowCountChange },
    ),
    { initialProps: { totalRowCount } },
  );

  const wheel = (deltaY: number) => act(() => {
    scroller.dispatchEvent(Object.assign(new Event('wheel'), { deltaY }));
  });

  return { ...view, scroller, state, wheel, wrapperRef };
}

/** Enough scroll in one direction to clear the commit threshold. */
const COMMIT = COMMIT_THRESHOLD_PX + 1;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('below the page-size cap', () => {
  it('is a passthrough, leaving MUI to virtualize', () => {
    const { result } = setup({ totalRowCount: 40 });

    expect(result.current).toMatchObject({ page: 0, pageCount: 1, pageSize: 100 });
  });

  it('does not react to scrolling, because there is nowhere to page to', () => {
    const { result, wheel } = setup({
      totalRowCount: 40,
      metrics: { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 },
    });

    wheel(COMMIT);

    expect(result.current.page).toBe(0);
  });
});

describe('page geometry', () => {
  it('derives the page count from the balanced page size, not the cap', () => {
    // 209 rows balance to 74 (74/74/61) rather than 100/100/9.
    const { result } = setup({ totalRowCount: 209 });

    expect(result.current.pageSize).toBe(74);
    expect(result.current.pageCount).toBe(3);
  });

  it('never reports fewer than one page', () => {
    expect(setup({ totalRowCount: 0 }).result.current.pageCount).toBe(1);
  });
});

describe('scrolling past the bottom edge', () => {
  const atBottom = { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 };

  it('advances a page', () => {
    const { result, wheel } = setup({ totalRowCount: 500, metrics: atBottom });

    wheel(COMMIT);

    expect(result.current.page).toBe(1);
  });

  it('waits for a committed gesture rather than reacting to one stray tick', () => {
    // Trackpads emit noise ticks; a single small delta must not flip the page.
    const { result, wheel } = setup({ totalRowCount: 500, metrics: atBottom });

    wheel(1);
    wheel(1);

    expect(result.current.page).toBe(0);
  });

  it('accumulates deltas in the same direction until they commit', () => {
    const { result, wheel } = setup({ totalRowCount: 500, metrics: atBottom });

    wheel(10);
    wheel(10);
    expect(result.current.page).toBe(0);

    wheel(10);
    expect(result.current.page).toBe(1);
  });

  it('starts the accumulator over on a reversal instead of subtracting', () => {
    // The distinguishing case: a small noise tick against the run. Summing
    // signed deltas would leave 20 - 5 + 10 = 25 and commit; restarting on the
    // sign change leaves 10, which correctly does not.
    const { result, wheel } = setup({ totalRowCount: 500, metrics: atBottom });

    wheel(20);
    wheel(-5);
    wheel(10);

    expect(result.current.page).toBe(0);
  });

  it('lets a reversal build its own run at full strength', () => {
    const { result, wheel, state } = setup({ totalRowCount: 500, metrics: atBottom });

    wheel(COMMIT);
    expect(result.current.page).toBe(1);

    // Scrolling back up from the top edge must commit on its own distance,
    // undampened by the downward run that preceded it.
    state.scrollTop = 0;
    wheel(-COMMIT);

    expect(result.current.page).toBe(0);
  });

  it('does nothing while the user is still away from the edge', () => {
    const { result, wheel } = setup({
      totalRowCount: 500,
      metrics: { scrollTop: 800, scrollHeight: 2000, clientHeight: 500 },
    });

    wheel(COMMIT);

    expect(result.current.page).toBe(0);
  });

  it('treats anywhere within the edge threshold as the edge', () => {
    const { result, wheel } = setup({
      totalRowCount: 500,
      metrics: { scrollTop: 1500 - EDGE_THRESHOLD_PX, scrollHeight: 2000, clientHeight: 500 },
    });

    wheel(COMMIT);

    expect(result.current.page).toBe(1);
  });

  it('stops at the last page, without even resetting the scroll position', () => {
    const { result, wheel, state } = setup({ totalRowCount: 150, metrics: atBottom });

    wheel(COMMIT);
    expect(result.current.page).toBe(1);
    expect(result.current.pageCount).toBe(2);

    // The page number alone would not catch an off-by-one here, because the
    // clamp hides it — but a transition that should not happen still moves the
    // scroll position, so that is what this asserts.
    state.scrollTop = 1500;
    wheel(COMMIT);

    expect(result.current.page).toBe(1);
    expect(state.scrollTop).toBe(1500);
  });

  it('stays responsive after refusing to advance past the last page', () => {
    // A refused transition must not leave a pending scroll reset behind: the
    // reset effect is keyed on the page, so one queued for a page change that
    // never happened would never be consumed — and every later gesture returns
    // early while one is pending, wedging the hook for good.
    const { result, wheel, state } = setup({ totalRowCount: 150, metrics: atBottom });

    wheel(COMMIT);
    expect(result.current.page).toBe(1);

    state.scrollTop = 1500;
    wheel(COMMIT);

    state.scrollTop = 0;
    wheel(-COMMIT);

    expect(result.current.page).toBe(0);
  });

  it('is unmoved by a stream of zero deltas', () => {
    // The explicit `deltaY === 0` guard is belt-and-braces: a zero never moves
    // the accumulator anyway, so removing it changes nothing observable. Kept
    // as a statement about the behaviour, not about that line.
    const { result, wheel } = setup({ totalRowCount: 500, metrics: atBottom });

    for (let i = 0; i < 10; i += 1) wheel(0);

    expect(result.current.page).toBe(0);
  });
});

describe('scrolling past the top edge', () => {
  it('retreats a page', () => {
    const { result, wheel, state } = setup({
      totalRowCount: 500,
      metrics: { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 },
    });

    wheel(COMMIT);
    expect(result.current.page).toBe(1);

    state.scrollTop = 0;
    wheel(-COMMIT);

    expect(result.current.page).toBe(0);
  });

  it('stops at the first page', () => {
    const { result, wheel } = setup({
      totalRowCount: 500,
      metrics: { scrollTop: 0, scrollHeight: 2000, clientHeight: 500 },
    });

    wheel(-COMMIT);

    expect(result.current.page).toBe(0);
  });

  it('does nothing while the user is still away from the top edge', () => {
    const { result, wheel, state } = setup({
      totalRowCount: 500,
      metrics: { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 },
    });

    wheel(COMMIT);
    expect(result.current.page).toBe(1);

    // Mid-page, so scrolling up is ordinary scrolling, not a page transition.
    state.scrollTop = 800;
    wheel(-COMMIT);

    expect(result.current.page).toBe(1);
  });
});

describe('the scroll reset after a transition', () => {
  it('lands just inside the top, clear of the zone it would re-trigger from', () => {
    const { state, wheel } = setup({
      totalRowCount: 500,
      metrics: { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 },
    });

    wheel(COMMIT);

    expect(state.scrollTop).toBe(RESET_OFFSET_PX);
    expect(RESET_OFFSET_PX).toBeGreaterThan(EDGE_THRESHOLD_PX);
  });

  it('lands just inside the bottom when moving back a page', () => {
    const { state, wheel } = setup({
      totalRowCount: 500,
      metrics: { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 },
    });

    wheel(COMMIT);
    state.scrollTop = 0;
    wheel(-COMMIT);

    expect(state.scrollTop).toBe(2000 - 500 - RESET_OFFSET_PX);
  });
});

describe('touch scrolling', () => {
  const touch = (scroller: Element, type: string, clientY: number) => act(() => {
    scroller.dispatchEvent(Object.assign(new Event(type), {
      touches: [{ clientY }],
    }));
  });

  it('pages on a drag, since touch events carry no deltaY', () => {
    const { result, scroller } = setup({
      totalRowCount: 500,
      metrics: { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 },
    });

    touch(scroller, 'touchstart', 300);
    touch(scroller, 'touchmove', 300 - COMMIT);

    expect(result.current.page).toBe(1);
  });

  it('ignores a move with no touch point', () => {
    const { result, scroller } = setup({
      totalRowCount: 500,
      metrics: { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 },
    });

    touch(scroller, 'touchstart', 300);
    act(() => {
      scroller.dispatchEvent(Object.assign(new Event('touchmove'), { touches: [] }));
    });

    expect(result.current.page).toBe(0);
  });
});

describe('when the row count changes', () => {
  it('falls back to the first page, because the rows are no longer the same list', () => {
    const { result, wheel, rerender } = setup({
      totalRowCount: 500,
      metrics: { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 },
    });

    wheel(COMMIT);
    expect(result.current.page).toBe(1);

    act(() => { rerender({ totalRowCount: 600 }); });

    expect(result.current.page).toBe(0);
  });

  it('keeps the page when the caller asks it to', () => {
    const { result, wheel, rerender } = setup({
      totalRowCount: 500,
      metrics: { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 },
      preservePageOnRowCountChange: true,
    });

    wheel(COMMIT);
    act(() => { rerender({ totalRowCount: 600 }); });

    expect(result.current.page).toBe(1);
  });

  it('clamps a preserved page that the shorter list no longer has', () => {
    const { result, wheel, rerender } = setup({
      totalRowCount: 500,
      metrics: { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 },
      preservePageOnRowCountChange: true,
    });

    wheel(COMMIT);
    expect(result.current.page).toBe(1);

    // Below the cap there is only one page, so the preserved page 1 no longer
    // exists and must fall back rather than pointing past the end.
    act(() => { rerender({ totalRowCount: 60 }); });

    expect(result.current.pageCount).toBe(1);
    expect(result.current.page).toBe(0);
  });
});

describe('ensureRowIndexVisible', () => {
  it('refuses a negative index', () => {
    const { result } = setup({ totalRowCount: 500 });

    expect(result.current.ensureRowIndexVisible(-1)).toBe(false);
  });

  it('reports no change when the row is already on this page', () => {
    const { result } = setup({ totalRowCount: 500 });

    expect(result.current.ensureRowIndexVisible(3)).toBe(false);
    expect(result.current.page).toBe(0);
  });

  it('moves to the page holding the row and says so', () => {
    const { result } = setup({ totalRowCount: 500 });
    const { pageSize } = result.current;

    let moved = false;
    act(() => { moved = result.current.ensureRowIndexVisible(pageSize * 2 + 1); });

    expect(moved).toBe(true);
    expect(result.current.page).toBe(2);
  });

  it('resolves against the page size a pending row count will produce', () => {
    // A caller about to change the row count passes the count it is moving to,
    // because the balanced page size moves with it — a page computed against
    // the outgoing size can point at rows the next render puts elsewhere.
    const { result, rerender } = setup({ totalRowCount: 500 });

    act(() => { result.current.ensureRowIndexVisible(150, { forRowCount: 209 }); });
    act(() => { rerender({ totalRowCount: 209 }); });

    // 209 rows balance to pages of 74, so row 150 sits on page 2.
    expect(result.current.pageSize).toBe(74);
    expect(result.current.page).toBe(2);
  });
});

describe('lifecycle', () => {
  it('stops listening once unmounted', () => {
    const { scroller, unmount } = setup({
      totalRowCount: 500,
      metrics: { scrollTop: 1500, scrollHeight: 2000, clientHeight: 500 },
    });
    const removeEventListener = vi.spyOn(scroller, 'removeEventListener');

    unmount();

    expect(removeEventListener).toHaveBeenCalledWith('wheel', expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith('touchstart', expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith('touchmove', expect.any(Function));
  });

  it('does nothing when the scroll container is not there', () => {
    const wrapperRef = { current: document.createElement('div') as HTMLElement | null };
    const { result } = renderHook(() => useScrollDrivenRowWindow(500, 100, SELECTOR, wrapperRef));

    expect(result.current.page).toBe(0);
  });

  it('keeps a stable identity while the window has not moved', () => {
    const { result, rerender } = setup({ totalRowCount: 500 });
    const first = result.current;

    act(() => { rerender({ totalRowCount: 500 }); });

    expect(result.current).toBe(first);
  });
});
