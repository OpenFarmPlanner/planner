/**
 * Tests for useAutosizeSidebarWidth hook
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAutosizeSidebarWidth } from '../hooks/useAutosizeSidebarWidth';
import type { RefObject } from 'react';

describe('useAutosizeSidebarWidth', () => {
  let containerRef: RefObject<HTMLElement | null>;
  let container: HTMLElement;

  beforeEach(() => {
    // Create a mock container element
    container = document.createElement('div');
    container.className = 'gantt-sidebar';
    containerRef = { current: container };

    // Mock ResizeObserver
    global.ResizeObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }));

    // Mock window.matchMedia
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it('should initialize and not throw with null ref', () => {
    const nullRef: RefObject<HTMLElement | null> = { current: null };

    expect(() => {
      renderHook(() => useAutosizeSidebarWidth(nullRef));
    }).not.toThrow();
  });

  it('should set CSS variable on container', () => {
    const headerContainer = document.createElement('div');
    headerContainer.className = 'gantt-sidebar-header';
    headerContainer.style.paddingLeft = '8px';
    headerContainer.style.paddingRight = '8px';

    const headerText = document.createElement('span');
    headerText.className = 'gantt-sidebar-header-text';
    headerText.textContent = 'Header';
    Object.defineProperty(headerText, 'scrollWidth', { value: 50, writable: true });

    headerContainer.appendChild(headerText);
    container.appendChild(headerContainer);

    renderHook(() => useAutosizeSidebarWidth(containerRef));

    // Should set --gantt-sidebar-width CSS variable
    expect(container.style.getPropertyValue('--gantt-sidebar-width')).toBeTruthy();
  });

  it('should use custom options', () => {
    const headerContainer = document.createElement('div');
    headerContainer.className = 'custom-header';
    headerContainer.style.paddingLeft = '10px';
    headerContainer.style.paddingRight = '10px';

    const headerText = document.createElement('span');
    headerText.className = 'custom-header-text';
    headerText.textContent = 'Custom Header';
    Object.defineProperty(headerText, 'scrollWidth', { value: 100, writable: true });

    headerContainer.appendChild(headerText);
    container.appendChild(headerContainer);

    const options = {
      headerTextSelector: '.custom-header-text',
      headerContainerSelector: '.custom-header',
      cssVarName: '--custom-width',
    };

    renderHook(() => useAutosizeSidebarWidth(containerRef, options));

    expect(container.style.getPropertyValue('--custom-width')).toBeTruthy();
  });

  it('should measure row text and sidebar paddings', () => {
    const sidebar = document.createElement('div');
    sidebar.className = 'gantt-sidebar';
    sidebar.style.paddingLeft = '12px';
    sidebar.style.paddingRight = '12px';

    const rowText = document.createElement('span');
    rowText.className = 'gantt-row-name';
    rowText.textContent = 'Row 1';

    const expandIcon = document.createElement('div');
    expandIcon.className = 'gantt-expand-icon';

    sidebar.appendChild(expandIcon);
    sidebar.appendChild(rowText);
    container.appendChild(sidebar);

    Object.defineProperty(rowText, 'getBoundingClientRect', {
      value: () => ({ width: 75 } as DOMRect),
      writable: true,
    });

    renderHook(() => useAutosizeSidebarWidth(containerRef));

    const cssValue = container.style.getPropertyValue('--gantt-sidebar-width');
    expect(cssValue).toBeTruthy();
  });

  it('should handle resize event', () => {
    const resizeListeners: FrameRequestCallback[] = [];

    window.addEventListener = vi.fn((event: string, callback: EventListener) => {
      if (event === 'resize') {
        resizeListeners.push(callback as FrameRequestCallback);
      }
    });

    const headerContainer = document.createElement('div');
    headerContainer.className = 'gantt-sidebar-header';
    headerContainer.style.paddingLeft = '0';
    headerContainer.style.paddingRight = '0';

    const headerText = document.createElement('span');
    headerText.className = 'gantt-sidebar-header-text';
    Object.defineProperty(headerText, 'scrollWidth', { value: 50, writable: true });

    headerContainer.appendChild(headerText);
    container.appendChild(headerContainer);

    renderHook(() => useAutosizeSidebarWidth(containerRef));

    expect(window.addEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('should clean up resize listener on unmount', () => {
    const removeListenerFn = vi.fn();
    window.removeEventListener = removeListenerFn;

    const headerContainer = document.createElement('div');
    headerContainer.className = 'gantt-sidebar-header';
    headerContainer.style.paddingLeft = '0';
    headerContainer.style.paddingRight = '0';

    const headerText = document.createElement('span');
    headerText.className = 'gantt-sidebar-header-text';
    Object.defineProperty(headerText, 'scrollWidth', { value: 50, writable: true });

    headerContainer.appendChild(headerText);
    container.appendChild(headerContainer);

    const { unmount } = renderHook(() => useAutosizeSidebarWidth(containerRef));

    unmount();

    expect(window.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
  });

  it('should clamp width to positive values', () => {
    const emptyContainer = document.createElement('div');
    emptyContainer.className = 'gantt-sidebar';

    containerRef.current!.appendChild(emptyContainer);

    renderHook(() => useAutosizeSidebarWidth(containerRef));

    // Should not set negative or zero values
    const cssValue = container.style.getPropertyValue('--gantt-sidebar-width');
    if (cssValue) {
      const value = parseFloat(cssValue);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });

  it('should re-measure when dependency list changes', () => {
    const deps = [1];

    const headerContainer = document.createElement('div');
    headerContainer.className = 'gantt-sidebar-header';
    headerContainer.style.paddingLeft = '0';
    headerContainer.style.paddingRight = '0';

    const headerText = document.createElement('span');
    headerText.className = 'gantt-sidebar-header-text';
    Object.defineProperty(headerText, 'scrollWidth', { value: 50, writable: true });

    headerContainer.appendChild(headerText);
    container.appendChild(headerContainer);

    const { rerender } = renderHook(
      (currentDeps) => useAutosizeSidebarWidth(containerRef, {}, currentDeps),
      { initialProps: deps }
    );

    rerender([2]);

    // Should have re-measured (cssValue should exist)
    expect(container.style.getPropertyValue('--gantt-sidebar-width')).toBeTruthy();
  });
});
