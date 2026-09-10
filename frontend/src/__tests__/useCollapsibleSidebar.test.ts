import { act, renderHook } from '@testing-library/react';
import type { MouseEvent } from 'react';
import { useCollapsibleSidebar } from '../navigation/useCollapsibleSidebar';

const STORAGE_KEY = 'openfarmplanner.sidebarCollapsed';

function setup(collapsedForBreakpoint = false) {
  const expandButton = document.createElement('button');
  const collapseButton = document.createElement('button');
  document.body.append(expandButton, collapseButton);
  const expandButtonRef = { current: expandButton as HTMLButtonElement | null };
  const collapseButtonRef = { current: collapseButton as HTMLButtonElement | null };

  const view = renderHook(
    (props: { collapsedForBreakpoint: boolean }) => useCollapsibleSidebar({
      collapsedForBreakpoint: props.collapsedForBreakpoint,
      expandButtonRef,
      collapseButtonRef,
    }),
    { initialProps: { collapsedForBreakpoint } },
  );

  return { ...view, expandButton, collapseButton };
}

/** A click whose target is the given element. */
const clickOn = (target: Element) => ({ target }) as unknown as MouseEvent<HTMLElement>;

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  return host;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('initial state', () => {
  it('follows what the breakpoint asks for', () => {
    expect(setup(false).result.current.collapsed).toBe(false);
    expect(setup(true).result.current.collapsed).toBe(true);
  });

  it('lets the breakpoint win over the stored preference on mount', () => {
    // Both effects run on mount and the breakpoint one is declared second, so
    // it lands last: the stored value is read and then immediately replaced.
    //
    // The consequence is that the preference is written but never restored —
    // collapsing the sidebar and reloading does not bring it back collapsed.
    // Pinned as the behaviour that ships, not as an endorsement of it; making
    // storage win on mount is a product decision, not a test's to take.
    localStorage.setItem(STORAGE_KEY, 'true');

    expect(setup(false).result.current.collapsed).toBe(false);
  });

  it('reads storage on mount, though nothing observable comes of it', () => {
    // Deleting the reading effect outright leaves the whole suite green. Kept
    // as evidence for the note above rather than as a guard on that effect.
    const getItem = vi.spyOn(Storage.prototype, 'getItem');

    setup(false);

    expect(getItem).toHaveBeenCalledWith(STORAGE_KEY);
    getItem.mockRestore();
  });
});

describe('toggle', () => {
  it('flips the state', () => {
    const { result } = setup(false);

    act(() => { result.current.toggle(); });
    expect(result.current.collapsed).toBe(true);

    act(() => { result.current.toggle(); });
    expect(result.current.collapsed).toBe(false);
  });

  it('writes the new state to storage, because it is a user preference', () => {
    const { result } = setup(false);

    act(() => { result.current.toggle(); });

    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
  });

  it('uses the storage key open tabs already depend on', () => {
    const { result } = setup(false);

    act(() => { result.current.toggle(); });

    // Renaming this key would silently reset the preference for every tab open
    // across a deploy.
    expect(Object.keys(localStorage)).toContain('openfarmplanner.sidebarCollapsed');
  });

  it('moves focus to the counterpart button so keyboard users keep their place', () => {
    const { result, expandButton, collapseButton } = setup(false);

    act(() => { result.current.toggle(); });
    act(() => { vi.advanceTimersByTime(20); });
    expect(expandButton).toHaveFocus();

    act(() => { result.current.toggle(); });
    act(() => { vi.advanceTimersByTime(20); });
    expect(collapseButton).toHaveFocus();
  });

  it('does not throw when the counterpart button is not mounted', () => {
    const expandButtonRef = { current: null };
    const collapseButtonRef = { current: null };
    const { result } = renderHook(() => useCollapsibleSidebar({
      collapsedForBreakpoint: false, expandButtonRef, collapseButtonRef,
    }));

    expect(() => {
      act(() => { result.current.toggle(); });
      act(() => { vi.advanceTimersByTime(20); });
    }).not.toThrow();
  });
});

describe('crossing a breakpoint', () => {
  it('follows the new breakpoint', () => {
    const { result, rerender } = setup(false);

    act(() => { rerender({ collapsedForBreakpoint: true }); });

    expect(result.current.collapsed).toBe(true);
  });

  it('does not write to storage, because it is not a user preference', () => {
    const { rerender } = setup(false);

    act(() => { rerender({ collapsedForBreakpoint: true }); });

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('keeps the user toggle across re-renders at the same breakpoint', () => {
    // The effect is keyed on the breakpoint, so an unrelated re-render must not
    // snap the sidebar back and undo what the user just chose.
    const { result, rerender } = setup(false);

    act(() => { result.current.toggle(); });
    act(() => { rerender({ collapsedForBreakpoint: false }); });

    expect(result.current.collapsed).toBe(true);
  });

  it('overrides the user toggle when the breakpoint actually changes', () => {
    const { result, rerender } = setup(false);

    act(() => { result.current.toggle(); });
    act(() => { rerender({ collapsedForBreakpoint: false }); });
    act(() => { rerender({ collapsedForBreakpoint: true }); });
    act(() => { rerender({ collapsedForBreakpoint: false }); });

    expect(result.current.collapsed).toBe(false);
  });
});

describe('handleBackgroundClick', () => {
  it('expands when the collapsed rail itself is clicked', () => {
    const { result } = setup(true);
    const rail = mount('<div id="rail"></div>');

    act(() => { result.current.handleBackgroundClick(clickOn(rail)); });

    expect(result.current.collapsed).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
  });

  it('does nothing while the sidebar is already expanded', () => {
    const { result } = setup(false);
    const rail = mount('<div id="rail"></div>');

    act(() => { result.current.handleBackgroundClick(clickOn(rail)); });

    expect(result.current.collapsed).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('leaves the rail collapsed when the user clicked something in it', () => {
    // Clicking a nav item should navigate, not expand the sidebar.
    const { result } = setup(true);
    const host = mount(`
      <div>
        <a id="link" href="/app/crops">Kulturen</a>
        <button id="button">Aktion</button>
        <input id="input" />
        <div id="role-button" role="button"></div>
        <div id="tabbable" tabindex="0"></div>
      </div>
    `);

    for (const id of ['link', 'button', 'input', 'role-button', 'tabbable']) {
      act(() => {
        result.current.handleBackgroundClick(clickOn(host.querySelector(`#${id}`)!));
      });
      expect(result.current.collapsed).toBe(true);
    }
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('counts a click on something inside a nav item as a click on that item', () => {
    const { result } = setup(true);
    const host = mount('<a href="/app/crops"><span id="label">Kulturen</span></a>');

    act(() => {
      result.current.handleBackgroundClick(clickOn(host.querySelector('#label')!));
    });

    expect(result.current.collapsed).toBe(true);
  });

  it('ignores a click whose target is not an element', () => {
    const { result } = setup(true);

    act(() => {
      result.current.handleBackgroundClick({ target: null } as unknown as MouseEvent<HTMLElement>);
    });

    expect(result.current.collapsed).toBe(true);
  });
});
