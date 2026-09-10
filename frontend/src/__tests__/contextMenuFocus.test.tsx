import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  focusContextMenuOrigin,
  handleContextMenuKeyboardNavigation,
  useContextMenuFocus,
} from '../components/contextMenu/contextMenuFocus';

function ContextMenuHarness({ open }: { open: boolean }) {
  const menuListRef = useContextMenuFocus(open);

  if (!open) {
    return null;
  }

  return (
    <ul ref={menuListRef} role="menu">
      <li role="menuitem" tabIndex={-1} data-testid="first-item">
        Erste Aktion
      </li>
    </ul>
  );
}

describe('useContextMenuFocus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('focuses the first menu item once the menu is open', () => {
    const { getByTestId } = render(<ContextMenuHarness open />);

    vi.advanceTimersByTime(40);

    expect(getByTestId('first-item')).toHaveFocus();
  });

  it('does not run the deferred focus callbacks after unmount', () => {
    const { unmount } = render(<ContextMenuHarness open />);

    unmount();
    const pendingTimers = vi.getTimerCount();
    vi.advanceTimersByTime(40);

    expect(pendingTimers).toBe(0);
  });

  it('does not run the deferred focus callbacks after the menu closes', () => {
    const { rerender } = render(<ContextMenuHarness open />);

    rerender(<ContextMenuHarness open={false} />);

    expect(vi.getTimerCount()).toBe(0);
  });
});

/** A native-shaped keyboard event: no `nativeEvent`, so the handler takes the
 * `stopImmediatePropagation` branch it uses for document-level listeners. */
function keyEvent(key: string, target: HTMLElement, currentTarget?: HTMLElement) {
  return {
    key,
    target,
    currentTarget: currentTarget ?? target,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  } as unknown as KeyboardEvent & {
    preventDefault: ReturnType<typeof vi.fn>;
    stopPropagation: ReturnType<typeof vi.fn>;
  };
}

function mountMenu(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  return host.querySelector<HTMLElement>('[role="menu"]') ?? host;
}

const THREE_ITEMS = `
  <ul role="menu">
    <li role="menuitem" tabindex="-1" id="one">Eins</li>
    <li role="menuitem" tabindex="-1" id="two">Zwei</li>
    <li role="menuitem" tabindex="-1" id="three">Drei</li>
  </ul>
`;

describe('handleContextMenuKeyboardNavigation', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const item = (menu: HTMLElement, id: string): HTMLElement =>
    menu.querySelector<HTMLElement>(`#${id}`)!;

  it('ignores keys the menu does not navigate with', () => {
    const menu = mountMenu(THREE_ITEMS);
    const event = keyEvent('a', menu, menu);

    handleContextMenuKeyboardNavigation(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it('closes on Escape without swallowing the browser default', () => {
    const menu = mountMenu(THREE_ITEMS);
    const onClose = vi.fn();
    const event = keyEvent('Escape', menu, menu);

    handleContextMenuKeyboardNavigation(event, onClose);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('closes on Tab and swallows it, so focus does not walk out of an open menu', () => {
    const menu = mountMenu(THREE_ITEMS);
    const onClose = vi.fn();
    const event = keyEvent('Tab', menu, menu);

    handleContextMenuKeyboardNavigation(event, onClose);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it('moves down and wraps at the end', () => {
    const menu = mountMenu(THREE_ITEMS);
    item(menu, 'one').focus();

    handleContextMenuKeyboardNavigation(keyEvent('ArrowDown', item(menu, 'one'), menu));
    expect(item(menu, 'two')).toHaveFocus();

    handleContextMenuKeyboardNavigation(keyEvent('ArrowDown', item(menu, 'two'), menu));
    expect(item(menu, 'three')).toHaveFocus();

    handleContextMenuKeyboardNavigation(keyEvent('ArrowDown', item(menu, 'three'), menu));
    expect(item(menu, 'one')).toHaveFocus();
  });

  it('moves up and wraps at the start', () => {
    const menu = mountMenu(THREE_ITEMS);
    item(menu, 'one').focus();

    handleContextMenuKeyboardNavigation(keyEvent('ArrowUp', item(menu, 'one'), menu));

    expect(item(menu, 'three')).toHaveFocus();
  });

  it('enters the menu at the first item when nothing inside it has focus', () => {
    const menu = mountMenu(THREE_ITEMS);
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();

    handleContextMenuKeyboardNavigation(keyEvent('ArrowDown', outside, menu), undefined, menu);

    expect(item(menu, 'one')).toHaveFocus();
  });

  it('jumps to the first and last item with Home and End', () => {
    const menu = mountMenu(THREE_ITEMS);
    item(menu, 'two').focus();

    handleContextMenuKeyboardNavigation(keyEvent('End', item(menu, 'two'), menu));
    expect(item(menu, 'three')).toHaveFocus();

    handleContextMenuKeyboardNavigation(keyEvent('Home', item(menu, 'three'), menu));
    expect(item(menu, 'one')).toHaveFocus();
  });

  it('activates the focused item on Enter', () => {
    const menu = mountMenu(THREE_ITEMS);
    const click = vi.fn();
    item(menu, 'two').addEventListener('click', click);
    item(menu, 'two').focus();

    handleContextMenuKeyboardNavigation(keyEvent('Enter', item(menu, 'two'), menu));

    expect(click).toHaveBeenCalledTimes(1);
  });

  it('activates the first item on Enter when nothing is focused yet', () => {
    const menu = mountMenu(THREE_ITEMS);
    const click = vi.fn();
    item(menu, 'one').addEventListener('click', click);

    handleContextMenuKeyboardNavigation(keyEvent('Enter', document.body, menu), undefined, menu);

    expect(click).toHaveBeenCalledTimes(1);
  });

  it('counts focus on a child of a menu item as being on that item', () => {
    const menu = mountMenu(`
      <ul role="menu">
        <li role="menuitem" tabindex="-1" id="one"><span id="label" tabindex="-1">Eins</span></li>
        <li role="menuitem" tabindex="-1" id="two">Zwei</li>
      </ul>
    `);
    menu.querySelector<HTMLElement>('#label')!.focus();

    handleContextMenuKeyboardNavigation(
      keyEvent('ArrowDown', menu.querySelector<HTMLElement>('#label')!, menu),
    );

    expect(item(menu, 'two')).toHaveFocus();
  });

  it('skips disabled items in both directions', () => {
    const menu = mountMenu(`
      <ul role="menu">
        <li role="menuitem" tabindex="-1" id="one">Eins</li>
        <li role="menuitem" tabindex="-1" id="skipped" aria-disabled="true">Gesperrt</li>
        <li role="menuitem" tabindex="-1" id="three">Drei</li>
      </ul>
    `);
    item(menu, 'one').focus();

    handleContextMenuKeyboardNavigation(keyEvent('ArrowDown', item(menu, 'one'), menu));

    expect(item(menu, 'three')).toHaveFocus();
  });

  it('also treats the disabled property as disabled, not only the aria attribute', () => {
    const menu = mountMenu(`
      <ul role="menu">
        <li role="menuitem" tabindex="-1" id="one">Eins</li>
        <li role="menuitem" tabindex="-1" id="skipped">Gesperrt</li>
        <li role="menuitem" tabindex="-1" id="three">Drei</li>
      </ul>
    `);
    (item(menu, 'skipped') as HTMLElement & { disabled?: boolean }).disabled = true;
    item(menu, 'one').focus();

    handleContextMenuKeyboardNavigation(keyEvent('ArrowDown', item(menu, 'one'), menu));

    expect(item(menu, 'three')).toHaveFocus();
  });

  it('recognises the checkbox and radio menu item roles too', () => {
    const menu = mountMenu(`
      <ul role="menu">
        <li role="menuitemcheckbox" tabindex="-1" id="one">Eins</li>
        <li role="menuitemradio" tabindex="-1" id="two">Zwei</li>
      </ul>
    `);
    item(menu, 'one').focus();

    handleContextMenuKeyboardNavigation(keyEvent('ArrowDown', item(menu, 'one'), menu));

    expect(item(menu, 'two')).toHaveFocus();
  });

  it('stands aside while the user is typing in a field inside the menu', () => {
    // A search box in a menu needs its own arrow keys and Enter.
    const menu = mountMenu(`
      <ul role="menu">
        <li><input id="search" /></li>
        <li role="menuitem" tabindex="-1" id="one">Eins</li>
      </ul>
    `);
    const search = menu.querySelector<HTMLElement>('#search')!;
    const event = keyEvent('ArrowDown', search, menu);

    handleContextMenuKeyboardNavigation(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(item(menu, 'one')).not.toHaveFocus();
  });

  it('does nothing for a menu that is no longer in the document', () => {
    const menu = mountMenu(THREE_ITEMS);
    const onClose = vi.fn();
    menu.remove();
    const event = keyEvent('Escape', menu, menu);

    handleContextMenuKeyboardNavigation(event, onClose, menu);

    expect(onClose).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it('swallows the key but moves nothing when every item is disabled', () => {
    const menu = mountMenu(`
      <ul role="menu">
        <li role="menuitem" tabindex="-1" aria-disabled="true">Gesperrt</li>
      </ul>
    `);
    const event = keyEvent('ArrowDown', menu, menu);

    handleContextMenuKeyboardNavigation(event);

    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it('falls back to the menu list itself, not its wrapper, when it has no items', () => {
    // Only reachable with an empty menu: with items present, both the wrapper
    // and the list find the same ones, so this is where the lookup earns its
    // keep — focus must land on the element that carries role="menu".
    const host = document.createElement('div');
    host.innerHTML = '<ul role="menu" tabindex="-1"></ul>';
    document.body.append(host);
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();

    handleContextMenuKeyboardNavigation(keyEvent('ArrowDown', outside, host));

    expect(host.querySelector('[role="menu"]')).toHaveFocus();
  });

  it('finds the menu list nested inside the element the event was bound to', () => {
    const host = document.createElement('div');
    host.innerHTML = THREE_ITEMS;
    document.body.append(host);
    const menu = host.querySelector<HTMLElement>('[role="menu"]')!;
    menu.querySelector<HTMLElement>('#one')!.focus();

    handleContextMenuKeyboardNavigation(
      keyEvent('ArrowDown', menu.querySelector<HTMLElement>('#one')!, host),
    );

    expect(menu.querySelector('#two')).toHaveFocus();
  });
});

describe('focusContextMenuOrigin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('returns focus to the element the menu was opened from', () => {
    const origin = document.createElement('button');
    document.body.append(origin);

    focusContextMenuOrigin(origin);
    vi.advanceTimersByTime(40);

    expect(origin).toHaveFocus();
  });

  it('does nothing when there is no origin', () => {
    expect(() => focusContextMenuOrigin(null)).not.toThrow();
  });

  it('does nothing for an origin that has already left the document', () => {
    const origin = document.createElement('button');
    const focus = vi.spyOn(origin, 'focus');

    focusContextMenuOrigin(origin);
    vi.advanceTimersByTime(40);

    expect(focus).not.toHaveBeenCalled();
  });

  it('does not focus an origin removed between the call and the next frame', () => {
    // The row the menu belonged to can be deleted by the very action the menu
    // ran, so the deferred focus has to re-check.
    const origin = document.createElement('button');
    document.body.append(origin);
    const focus = vi.spyOn(origin, 'focus');

    focusContextMenuOrigin(origin);
    origin.remove();
    vi.advanceTimersByTime(40);

    expect(focus).not.toHaveBeenCalled();
  });
});
