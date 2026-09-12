import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GANTT_LEFT_COLUMN_DESKTOP_DEFAULT_WIDTH,
  GANTT_LEFT_COLUMN_DESKTOP_MAX_WIDTH,
  GANTT_LEFT_COLUMN_DESKTOP_MIN_WIDTH,
  GANTT_LEFT_COLUMN_MOBILE_DEFAULT_WIDTH,
  GANTT_LEFT_COLUMN_MOBILE_MAX_WIDTH,
  GANTT_LEFT_COLUMN_MOBILE_MIN_WIDTH,
  GANTT_SIDEBAR_RESIZE_HANDLE_DESKTOP_HITBOX_WIDTH,
  GANTT_SIDEBAR_RESIZE_HANDLE_MOBILE_HITBOX_WIDTH,
  GANTT_SIDEBAR_RESIZE_KEYBOARD_STEP,
  getStoredGanttState,
} from '../pages/ganttChartState';
import type { StoredGanttState } from '../pages/ganttChartState';
import { useGanttSidebarResize } from '../pages/useGanttSidebarResize';

const KEY = 'openfarmplanner:gantt:1:state';

const setup = ({
  storedState = null,
  useMobileLimits = false,
  storageKey = KEY as string | null,
}: {
  storedState?: StoredGanttState | null;
  useMobileLimits?: boolean;
  storageKey?: string | null;
} = {}) => renderHook(
  (props: { useMobileLimits: boolean; storedState: StoredGanttState | null }) =>
    useGanttSidebarResize({ storageKey, ...props }),
  { initialProps: { useMobileLimits, storedState } },
);

/** A handle element that records the pointer-capture calls made against it. */
const buildHandle = () => {
  const element = document.createElement('div');
  const capture = { set: [] as number[], released: [] as number[], has: true };
  element.setPointerCapture = (id: number) => { capture.set.push(id); };
  element.releasePointerCapture = (id: number) => {
    capture.released.push(id);
    capture.has = false;
    // Real browsers fire lostpointercapture synchronously on release, which
    // re-enters the finish handler. jsdom does not, so the stub does it.
    element.dispatchEvent(new Event('lostpointercapture'));
  };
  element.hasPointerCapture = () => capture.has;
  document.body.append(element);
  return { element, capture };
};

const pointerDown = (element: HTMLElement, clientX = 0) => ({
  currentTarget: element,
  clientX,
  pointerId: 7,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
} as unknown as React.PointerEvent<HTMLElement>);

const keyDown = (key: string) => ({
  key,
  preventDefault: vi.fn(),
} as unknown as React.KeyboardEvent<HTMLElement>);

/**
 * Drags the handle by `deltaX` and lets the queued frame flush.
 *
 * The pointer starts at a non-zero x on purpose: from an origin of 0 the
 * delta arithmetic (`startWidth + clientX - startClientX`) is indistinguishable
 * from ignoring the origin altogether.
 */
const DRAG_ORIGIN_X = 500;

const drag = (result: { current: ReturnType<typeof useGanttSidebarResize> }, element: HTMLElement, deltaX: number) => {
  act(() => result.current.handleResizeStart(pointerDown(element, DRAG_ORIGIN_X)));
  act(() => {
    window.dispatchEvent(Object.assign(new Event('pointermove', { cancelable: true }), {
      clientX: DRAG_ORIGIN_X + deltaX,
    }));
    vi.advanceTimersByTime(32);
  });
};

const release = () => {
  act(() => {
    window.dispatchEvent(new Event('pointerup', { cancelable: true }));
  });
};

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
  document.body.style.cursor = 'auto';
  document.body.style.userSelect = 'auto';
  document.body.style.touchAction = 'auto';
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('useGanttSidebarResize — initial width', () => {
  it('starts at the desktop default with nothing stored', () => {
    expect(setup().result.current.width).toBe(GANTT_LEFT_COLUMN_DESKTOP_DEFAULT_WIDTH);
  });

  it('starts at the mobile default on a phone', () => {
    // The two defaults differ; carrying the desktop one over would leave a
    // phone with a sidebar wider than its screen.
    const { result } = setup({ useMobileLimits: true });
    expect(result.current.width).toBe(GANTT_LEFT_COLUMN_MOBILE_DEFAULT_WIDTH);
  });

  it('restores the stored desktop width', () => {
    const { result } = setup({ storedState: { leftColumnWidthDesktop: 300 } });
    expect(result.current.width).toBe(300);
  });

  it('restores the stored mobile width', () => {
    const { result } = setup({
      storedState: { leftColumnWidthMobile: 150 }, useMobileLimits: true,
    });
    expect(result.current.width).toBe(150);
  });

  it('falls back to the pre-split stored width for desktop', () => {
    // `leftColumnWidth` predates the desktop/mobile split; a returning user
    // should not be reset to the default.
    const { result } = setup({ storedState: { leftColumnWidth: 320 } });
    expect(result.current.width).toBe(320);
  });

  it('prefers the desktop-specific width over the legacy one', () => {
    const { result } = setup({
      storedState: { leftColumnWidthDesktop: 300, leftColumnWidth: 320 },
    });
    expect(result.current.width).toBe(300);
  });

  it('never gives the legacy width to mobile', () => {
    // The legacy value was only ever a desktop width, so inheriting it on a
    // phone would be worse than starting from the mobile default.
    const { result } = setup({ storedState: { leftColumnWidth: 320 }, useMobileLimits: true });
    expect(result.current.width).toBe(GANTT_LEFT_COLUMN_MOBILE_DEFAULT_WIDTH);
  });

  it('keeps the two breakpoints’ widths apart', () => {
    // Rotating a phone or resizing a window restores what that breakpoint was
    // last left at rather than carrying one over.
    const { result, rerender } = setup({
      storedState: { leftColumnWidthDesktop: 300, leftColumnWidthMobile: 150 },
    });
    expect(result.current.width).toBe(300);

    rerender({ useMobileLimits: true, storedState: { leftColumnWidthDesktop: 300, leftColumnWidthMobile: 150 } });

    expect(result.current.width).toBe(150);
  });

  it('paints the stored width on the very first render, before any effect', () => {
    // The initial-state expressions and the sync effect below them compute the
    // same fallback chain, so mutating either alone is masked by the other.
    // Only the first rendered value is the initializer's own work — and it is
    // what decides whether the sidebar flashes at the default width before
    // settling. Recording every width the hook reports isolates it.
    const seen: number[] = [];
    renderHook(() => {
      const resize = useGanttSidebarResize({
        storageKey: KEY,
        storedState: { leftColumnWidth: 320 },
        useMobileLimits: false,
      });
      seen.push(resize.width);
      return resize;
    });

    expect(seen[0]).toBe(320);
  });

  it('paints the mobile default on the first render, never the desktop one', () => {
    const seen: number[] = [];
    renderHook(() => {
      const resize = useGanttSidebarResize({
        storageKey: KEY,
        storedState: { leftColumnWidth: 320 },
        useMobileLimits: true,
      });
      seen.push(resize.width);
      return resize;
    });

    expect(seen[0]).toBe(GANTT_LEFT_COLUMN_MOBILE_DEFAULT_WIDTH);
  });

  it('prefers the breakpoint-specific stored width on the first render', () => {
    const seen: number[] = [];
    renderHook(() => {
      const resize = useGanttSidebarResize({
        storageKey: KEY,
        storedState: { leftColumnWidthDesktop: 300, leftColumnWidth: 320 },
        useMobileLimits: false,
      });
      seen.push(resize.width);
      return resize;
    });

    expect(seen[0]).toBe(300);
  });

  it('adopts a stored width that arrives after mount', () => {
    // The gantt state loads asynchronously, so the first render has none.
    const { result, rerender } = setup();
    expect(result.current.width).toBe(GANTT_LEFT_COLUMN_DESKTOP_DEFAULT_WIDTH);

    rerender({ useMobileLimits: false, storedState: { leftColumnWidthDesktop: 300 } });

    expect(result.current.width).toBe(300);
  });
});

describe('useGanttSidebarResize — limits reported per breakpoint', () => {
  it('reports the desktop limits and hitbox', () => {
    const { result } = setup();
    expect(result.current.minWidth).toBe(GANTT_LEFT_COLUMN_DESKTOP_MIN_WIDTH);
    expect(result.current.maxWidth).toBe(GANTT_LEFT_COLUMN_DESKTOP_MAX_WIDTH);
    expect(result.current.handleHitboxWidth)
      .toBe(GANTT_SIDEBAR_RESIZE_HANDLE_DESKTOP_HITBOX_WIDTH);
  });

  it('reports the narrower mobile limits and the larger touch hitbox', () => {
    // A touch target needs more room than a mouse one, even though the sidebar
    // itself is narrower.
    const { result } = setup({ useMobileLimits: true });
    expect(result.current.minWidth).toBe(GANTT_LEFT_COLUMN_MOBILE_MIN_WIDTH);
    expect(result.current.maxWidth).toBe(GANTT_LEFT_COLUMN_MOBILE_MAX_WIDTH);
    expect(result.current.handleHitboxWidth)
      .toBeGreaterThan(GANTT_SIDEBAR_RESIZE_HANDLE_DESKTOP_HITBOX_WIDTH);
    expect(result.current.handleHitboxWidth)
      .toBe(GANTT_SIDEBAR_RESIZE_HANDLE_MOBILE_HITBOX_WIDTH);
  });
});

describe('useGanttSidebarResize — keyboard', () => {
  it('narrows with ArrowLeft and widens with ArrowRight', () => {
    const { result } = setup({ storedState: { leftColumnWidthDesktop: 300 } });

    act(() => result.current.handleResizeKeyDown(keyDown('ArrowLeft')));
    expect(result.current.width).toBe(300 - GANTT_SIDEBAR_RESIZE_KEYBOARD_STEP);

    act(() => result.current.handleResizeKeyDown(keyDown('ArrowRight')));
    expect(result.current.width).toBe(300);
  });

  it('jumps to the minimum with Home and the maximum with End', () => {
    const { result } = setup({ storedState: { leftColumnWidthDesktop: 300 } });

    act(() => result.current.handleResizeKeyDown(keyDown('Home')));
    expect(result.current.width).toBe(GANTT_LEFT_COLUMN_DESKTOP_MIN_WIDTH);

    act(() => result.current.handleResizeKeyDown(keyDown('End')));
    expect(result.current.width).toBe(GANTT_LEFT_COLUMN_DESKTOP_MAX_WIDTH);
  });

  it('uses the mobile limits for Home and End on a phone', () => {
    const { result } = setup({ useMobileLimits: true });

    act(() => result.current.handleResizeKeyDown(keyDown('End')));

    expect(result.current.width).toBe(GANTT_LEFT_COLUMN_MOBILE_MAX_WIDTH);
  });

  it('clamps rather than stepping past the limit', () => {
    const { result } = setup({ storedState: { leftColumnWidthDesktop: GANTT_LEFT_COLUMN_DESKTOP_MIN_WIDTH } });

    act(() => result.current.handleResizeKeyDown(keyDown('ArrowLeft')));

    expect(result.current.width).toBe(GANTT_LEFT_COLUMN_DESKTOP_MIN_WIDTH);
  });

  it('claims the arrow keys so the page does not scroll sideways', () => {
    const { result } = setup();
    const event = keyDown('ArrowLeft');

    act(() => result.current.handleResizeKeyDown(event));

    expect(event.preventDefault).toHaveBeenCalled();
  });

  it.each(['Tab', 'Enter', 'a', 'ArrowUp'])('leaves %s alone', (key) => {
    const { result } = setup({ storedState: { leftColumnWidthDesktop: 300 } });
    const event = keyDown(key);

    act(() => result.current.handleResizeKeyDown(event));

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(result.current.width).toBe(300);
  });

  it('persists the new width immediately', () => {
    const { result } = setup({ storedState: { leftColumnWidthDesktop: 300 } });

    act(() => result.current.handleResizeKeyDown(keyDown('ArrowRight')));

    expect(getStoredGanttState(KEY)?.leftColumnWidthDesktop)
      .toBe(300 + GANTT_SIDEBAR_RESIZE_KEYBOARD_STEP);
  });

  it('persists under the mobile key on a phone', () => {
    // Writing the desktop key from a phone would overwrite a width the user
    // set on their laptop.
    const { result } = setup({ useMobileLimits: true });

    act(() => result.current.handleResizeKeyDown(keyDown('End')));

    const stored = getStoredGanttState(KEY);
    expect(stored?.leftColumnWidthMobile).toBe(GANTT_LEFT_COLUMN_MOBILE_MAX_WIDTH);
    expect(stored?.leftColumnWidthDesktop).toBeUndefined();
  });

  it('writes nothing without a storage key', () => {
    const { result } = setup({ storageKey: null });

    act(() => result.current.handleResizeKeyDown(keyDown('ArrowRight')));

    expect(window.localStorage.length).toBe(0);
    expect(result.current.width).toBe(
      GANTT_LEFT_COLUMN_DESKTOP_DEFAULT_WIDTH + GANTT_SIDEBAR_RESIZE_KEYBOARD_STEP,
    );
  });
});

describe('useGanttSidebarResize — pointer drag', () => {
  it('widens the sidebar as the pointer moves right', () => {
    const { element } = buildHandle();
    const { result } = setup({ storedState: { leftColumnWidthDesktop: 300 } });

    drag(result, element, 40);

    expect(result.current.width).toBe(340);
  });

  it('narrows it as the pointer moves left', () => {
    const { element } = buildHandle();
    const { result } = setup({ storedState: { leftColumnWidthDesktop: 300 } });

    drag(result, element, -40);

    expect(result.current.width).toBe(260);
  });

  it('clamps to the maximum while dragging, not only on release', () => {
    const { element } = buildHandle();
    const { result } = setup({ storedState: { leftColumnWidthDesktop: 300 } });

    drag(result, element, 5000);

    expect(result.current.width).toBe(GANTT_LEFT_COLUMN_DESKTOP_MAX_WIDTH);
  });

  it('clamps to the mobile maximum on a phone', () => {
    const { element } = buildHandle();
    const { result } = setup({ useMobileLimits: true });

    drag(result, element, 5000);

    expect(result.current.width).toBe(GANTT_LEFT_COLUMN_MOBILE_MAX_WIDTH);
  });

  it('reports that a resize is in progress, and that it has ended', () => {
    const { element } = buildHandle();
    const { result } = setup();

    act(() => result.current.handleResizeStart(pointerDown(element)));
    expect(result.current.isResizing).toBe(true);

    release();
    expect(result.current.isResizing).toBe(false);
  });

  it('persists a width its callers have already clamped', () => {
    // `persistWidth` clamps again on the way to storage, but neither caller can
    // reach it with an unclamped value: the drag clamps in `queueWidthUpdate`
    // and the keyboard path clamps before calling. Removing the inner clamp
    // leaves this file green — noted so the outer clamps are understood to be
    // the ones doing the work.
    const { element } = buildHandle();
    const { result } = setup({ storedState: { leftColumnWidthDesktop: 300 } });

    drag(result, element, 5000);
    release();

    expect(getStoredGanttState(KEY)?.leftColumnWidthDesktop)
      .toBe(GANTT_LEFT_COLUMN_DESKTOP_MAX_WIDTH);
  });

  it('persists the final width on release', () => {
    const { element } = buildHandle();
    const { result } = setup({ storedState: { leftColumnWidthDesktop: 300 } });

    drag(result, element, 40);
    expect(getStoredGanttState(KEY)?.leftColumnWidthDesktop).toBeUndefined();

    release();

    expect(getStoredGanttState(KEY)?.leftColumnWidthDesktop).toBe(340);
  });

  it('batches moves into one frame instead of a render per event', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const { element } = buildHandle();
    const { result } = setup({ storedState: { leftColumnWidthDesktop: 300 } });

    act(() => result.current.handleResizeStart(pointerDown(element, 0)));
    act(() => {
      [10, 20, 30].forEach((clientX) => {
        window.dispatchEvent(
          Object.assign(new Event('pointermove', { cancelable: true }), { clientX }),
        );
      });
    });

    expect(raf).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(32); });
    // The last position wins, not the one that happened to schedule the frame.
    expect(result.current.width).toBe(330);
    raf.mockRestore();
  });

  it('applies the final position even if no frame has run yet', () => {
    const { element } = buildHandle();
    const { result } = setup({ storedState: { leftColumnWidthDesktop: 300 } });

    act(() => result.current.handleResizeStart(pointerDown(element, 0)));
    act(() => {
      window.dispatchEvent(
        Object.assign(new Event('pointermove', { cancelable: true }), { clientX: 40 }),
      );
    });
    release();

    expect(result.current.width).toBe(340);
  });

  it('claims the pointerdown so it does not also start a text selection', () => {
    const { element } = buildHandle();
    const { result } = setup();
    const event = pointerDown(element);

    act(() => result.current.handleResizeStart(event));

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it('takes pointer capture so the drag survives leaving the handle', () => {
    const { element, capture } = buildHandle();
    const { result } = setup();

    act(() => result.current.handleResizeStart(pointerDown(element)));

    expect(capture.set).toEqual([7]);
  });

  it('releases pointer capture when the drag ends', () => {
    const { element, capture } = buildHandle();
    const { result } = setup();

    act(() => result.current.handleResizeStart(pointerDown(element)));
    release();

    expect(capture.released).toEqual([7]);
  });

  it('does not release a capture it never held', () => {
    const { element, capture } = buildHandle();
    capture.has = false;
    const { result } = setup();

    act(() => result.current.handleResizeStart(pointerDown(element)));
    release();

    expect(capture.released).toEqual([]);
  });

  it('ends the drag on pointercancel as well as pointerup', () => {
    const { element } = buildHandle();
    const { result } = setup();
    act(() => result.current.handleResizeStart(pointerDown(element)));

    act(() => { window.dispatchEvent(new Event('pointercancel', { cancelable: true })); });

    expect(result.current.isResizing).toBe(false);
  });

  it('ends the drag when the browser takes the capture away', () => {
    const { element } = buildHandle();
    const { result } = setup();
    act(() => result.current.handleResizeStart(pointerDown(element)));

    act(() => { element.dispatchEvent(new Event('lostpointercapture', { cancelable: true })); });

    expect(result.current.isResizing).toBe(false);
  });

  it('finishes only once, however many end events arrive', () => {
    // pointerup and lostpointercapture both fire on a normal release.
    //
    // The `isFinished` flag is defence in depth rather than the thing that
    // makes this work: releasing the capture clears it, so the
    // `hasPointerCapture` guard already blocks the re-entrant call, and the
    // listeners are torn down in the same pass. Removing the flag leaves this
    // file green. It still earns its place — it does not depend on the order
    // in which a browser clears capture and fires the event.
    const { element, capture } = buildHandle();
    const { result } = setup();
    act(() => result.current.handleResizeStart(pointerDown(element)));

    release();
    act(() => { element.dispatchEvent(new Event('lostpointercapture')); });
    act(() => { window.dispatchEvent(new Event('pointercancel')); });

    expect(capture.released).toEqual([7]);
  });

  it('does not let a frame from one drag swallow the next', () => {
    // The frame handle lives on the hook, not the drag. If a pending frame
    // survived the first release, the second drag would see a non-null handle,
    // schedule nothing, and apply the *first* drag's width instead.
    const { element } = buildHandle();
    const { result } = setup({ storedState: { leftColumnWidthDesktop: 300 } });

    act(() => result.current.handleResizeStart(pointerDown(element, DRAG_ORIGIN_X)));
    act(() => {
      window.dispatchEvent(Object.assign(new Event('pointermove', { cancelable: true }), {
        clientX: DRAG_ORIGIN_X + 40,
      }));
    });
    release();

    drag(result, element, -20);

    expect(result.current.width).toBe(320);
  });

  it('stops listening once the drag is over', () => {
    const { element } = buildHandle();
    const { result } = setup({ storedState: { leftColumnWidthDesktop: 300 } });

    drag(result, element, 40);
    release();
    act(() => {
      window.dispatchEvent(
        Object.assign(new Event('pointermove', { cancelable: true }), { clientX: 200 }),
      );
      vi.advanceTimersByTime(32);
    });

    expect(result.current.width).toBe(340);
  });
});

describe('useGanttSidebarResize — body styles during a drag', () => {
  it('shows the resize cursor and suppresses selection while dragging', () => {
    const { element } = buildHandle();
    const { result } = setup();

    act(() => result.current.handleResizeStart(pointerDown(element)));

    expect(document.body.style.cursor).toBe('col-resize');
    expect(document.body.style.userSelect).toBe('none');
    expect(document.body.style.touchAction).toBe('none');
  });

  it('leaves the cursor alone on a touch drag, where there is none', () => {
    const { element } = buildHandle();
    const { result } = setup({ useMobileLimits: true });

    act(() => result.current.handleResizeStart(pointerDown(element)));

    expect(document.body.style.cursor).toBe('auto');
    // Selection and scrolling still have to be suppressed on touch.
    expect(document.body.style.touchAction).toBe('none');
  });

  it('restores every style it changed', () => {
    const { element } = buildHandle();
    const { result } = setup();

    act(() => result.current.handleResizeStart(pointerDown(element)));
    release();

    expect(document.body.style.cursor).toBe('auto');
    expect(document.body.style.userSelect).toBe('auto');
    expect(document.body.style.touchAction).toBe('auto');
  });
});

describe('useGanttSidebarResize — widthRef', () => {
  it('tracks the width without forcing effects to re-run on every drag frame', () => {
    const { element } = buildHandle();
    const { result } = setup({ storedState: { leftColumnWidthDesktop: 300 } });
    expect(result.current.widthRef.current).toBe(300);

    drag(result, element, 40);

    expect(result.current.widthRef.current).toBe(340);
  });
});
