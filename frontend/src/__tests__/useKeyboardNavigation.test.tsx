import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation';

const { navigateMock, useLocationMock, useNavigateMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  useLocationMock: vi.fn(),
  useNavigateMock: vi.fn(),
}));
useNavigateMock.mockImplementation(() => navigateMock);
useLocationMock.mockImplementation(() => ({ pathname: window.location.pathname }));

vi.mock('react-router', () => ({
  useLocation: useLocationMock,
  useNavigate: useNavigateMock,
}));

function TestComponent() {
  useKeyboardNavigation();
  return null;
}

describe('useKeyboardNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/anbauplaene');
    document.body.innerHTML = '';
    useLocationMock.mockImplementation(() => ({ pathname: window.location.pathname }));
  });

  it('navigates to next route on Ctrl+Shift+ArrowDown from Anbaupläne', () => {
    render(<TestComponent />);

    const event = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    });

    window.dispatchEvent(event);

    expect(navigateMock).toHaveBeenCalledWith('/app/gantt-chart');
  });

  it('navigates to Kulturbibliothek on Ctrl+Shift+ArrowUp from Anbaupläne', () => {
    window.history.pushState({}, '', '/anbauplaene');
    render(<TestComponent />);

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      })
    );

    expect(navigateMock).toHaveBeenCalledWith('/app/crop-library');
  });


  it('navigates from gantt to yield overview on Ctrl+Shift+ArrowDown', () => {
    window.history.pushState({}, '', '/gantt-chart');
    render(<TestComponent />);

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      })
    );

    expect(navigateMock).toHaveBeenCalledWith('/app/yield-overview');
  });

  it('navigates from yield overview to harvests on Ctrl+Shift+ArrowDown', () => {
    window.history.pushState({}, '', '/yield-overview');
    render(<TestComponent />);

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      })
    );

    expect(navigateMock).toHaveBeenCalledWith('/app/harvests');
  });


  it('wraps to Übersicht when pressing Ctrl+Shift+ArrowDown from the last page', () => {
    window.history.pushState({}, '', '/suppliers');
    render(<TestComponent />);

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      })
    );

    expect(navigateMock).toHaveBeenCalledWith('/app/dashboard');
  });

  it('falls back to Übersicht when current route is unknown', () => {
    window.history.pushState({}, '', '/unknown-path');
    render(<TestComponent />);

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      })
    );

    expect(navigateMock).toHaveBeenCalledWith('/app/dashboard');
  });


  it('treats /planting-plans as Anbaupläne for shortcut navigation', () => {
    window.history.pushState({}, '', '/planting-plans');
    render(<TestComponent />);

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      })
    );

    expect(navigateMock).toHaveBeenCalledWith('/app/gantt-chart');
  });

  it('ignores shortcut when typing in input/textarea/contenteditable', () => {
    const { unmount } = render(<TestComponent />);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      })
    );
    expect(navigateMock).not.toHaveBeenCalled();

    input.blur();
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      })
    );
    expect(navigateMock).not.toHaveBeenCalled();

    textarea.blur();
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    editable.tabIndex = 0;
    document.body.appendChild(editable);
    editable.focus();

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      })
    );

    expect(navigateMock).not.toHaveBeenCalled();
    unmount();
  });

  it('ignores non-matching keyboard combinations', () => {
    render(<TestComponent />);

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        ctrlKey: true,
        shiftKey: false,
        bubbles: true,
      })
    );

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        ctrlKey: true,
        shiftKey: true,
        altKey: true,
        bubbles: true,
      })
    );

    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('navigates from Übersicht to Anbauflächen on Ctrl+Shift+ArrowDown', () => {
    window.history.pushState({}, '', '/app/dashboard');
    render(<TestComponent />);

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      })
    );

    expect(navigateMock).toHaveBeenCalledWith('/app/fields-beds');
  });

  it('skips Standorte in shortcut rotation from the direct locations page', () => {
    window.history.pushState({}, '', '/app/locations');
    render(<TestComponent />);

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      })
    );

    expect(navigateMock).toHaveBeenCalledWith('/app/fields-beds');
  });

  it('wraps to Lieferanten on Ctrl+Shift+ArrowUp from Übersicht', () => {
    window.history.pushState({}, '', '/app/dashboard');
    render(<TestComponent />);

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      })
    );

    expect(navigateMock).toHaveBeenCalledWith('/app/suppliers');
  });

  it('uses the current router pathname after normal navigation changes', () => {
    let pathname = '/app/locations';
    useLocationMock.mockImplementation(() => ({ pathname }));
    const { rerender } = render(<TestComponent />);

    pathname = '/app/gantt-chart';
    rerender(<TestComponent />);

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      })
    );

    expect(navigateMock).toHaveBeenCalledWith('/app/yield-overview');
  });

  it('uses nested app routes to determine the active navigation item', () => {
    window.history.pushState({}, '', '/app/crops/42');
    render(<TestComponent />);

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      })
    );

    expect(navigateMock).toHaveBeenCalledWith('/app/crop-library');
  });
});
