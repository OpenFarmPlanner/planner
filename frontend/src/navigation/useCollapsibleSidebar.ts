import { useCallback, useEffect, useState, type MouseEvent, type RefObject } from 'react';

/**
 * Persisted per browser, so it survives a reload. The spelling is depended on
 * by tabs that are already open across a deploy - do not rename it.
 */
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'openfarmplanner.sidebarCollapsed';

/** Anything the user could have meant to click, rather than the sidebar itself. */
const INTERACTIVE_SELECTOR =
  'a, button, input, textarea, select, [role="button"], [role="link"], [tabindex]';

interface UseCollapsibleSidebarOptions {
  /** What the current breakpoint wants: wider screens expanded, narrower collapsed. */
  collapsedForBreakpoint: boolean;
  expandButtonRef: RefObject<HTMLButtonElement | null>;
  collapseButtonRef: RefObject<HTMLButtonElement | null>;
}

export interface CollapsibleSidebar {
  collapsed: boolean;
  toggle: () => void;
  /** Expands again when the user clicks the collapsed rail itself, not an item in it. */
  handleBackgroundClick: (event: MouseEvent<HTMLElement>) => void;
}

/**
 * Whether the navigation sidebar is collapsed, and the one place that writes
 * that preference to browser storage - it used to be written from three.
 */
export function useCollapsibleSidebar({
  collapsedForBreakpoint,
  expandButtonRef,
  collapseButtonRef,
}: UseCollapsibleSidebarOptions): CollapsibleSidebar {
  const [collapsed, setCollapsed] = useState(collapsedForBreakpoint);

  useEffect(() => {
    const storedValue = window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
    if (storedValue !== null) {
      setCollapsed(storedValue === 'true');
    }
  }, []);

  // Declared after the one above so it still wins on mount, as it did when both
  // effects sat in the page. Crossing the breakpoint is not a user preference,
  // so unlike the toggle this deliberately does not write to storage.
  useEffect(() => {
    setCollapsed(collapsedForBreakpoint);
  }, [collapsedForBreakpoint]);

  const toggle = useCallback((): void => {
    setCollapsed((previous) => {
      const next = !previous;
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(next));
      // Transfer focus to the counterpart button so keyboard users don't lose their position
      requestAnimationFrame(() => {
        if (next) {
          expandButtonRef.current?.focus();
        } else {
          collapseButtonRef.current?.focus();
        }
      });
      return next;
    });
  }, [collapseButtonRef, expandButtonRef]);

  const handleBackgroundClick = useCallback((event: MouseEvent<HTMLElement>): void => {
    if (!collapsed) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (target.closest(INTERACTIVE_SELECTOR)) {
      return;
    }
    setCollapsed(false);
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, 'false');
  }, [collapsed]);

  return { collapsed, toggle, handleBackgroundClick };
}
