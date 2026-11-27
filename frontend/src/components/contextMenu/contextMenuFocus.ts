import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';

const contextMenuNavigationKeys = new Set([
  'ArrowDown',
  'ArrowUp',
  'Enter',
  'Escape',
  'Home',
  'End',
  'Tab',
]);

type FocusableMenuElement = HTMLElement & {
  disabled?: boolean;
};

type ContextMenuKeyboardEvent = KeyboardEvent | ReactKeyboardEvent;

const menuItemSelector = [
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
].join(',');

function isDisabledMenuItem(element: FocusableMenuElement): boolean {
  return element.disabled === true || element.getAttribute('aria-disabled') === 'true';
}

function getMenuItems(container: HTMLElement): FocusableMenuElement[] {
  return Array.from(
    container.querySelectorAll<FocusableMenuElement>(menuItemSelector),
  ).filter((item) => !isDisabledMenuItem(item));
}

function getMenuList(element: HTMLElement): HTMLElement {
  if (element.getAttribute('role') === 'menu') {
    return element;
  }

  return element.querySelector<HTMLElement>('[role="menu"]') ?? element;
}

function findOpenMenuList(): HTMLElement | null {
  const menuLists = Array.from(document.querySelectorAll<HTMLElement>('[role="menu"]'));
  return menuLists.find((menuList) => document.contains(menuList)) ?? null;
}

function stopKeyboardEvent(event: ContextMenuKeyboardEvent): void {
  event.stopPropagation();
  if ('nativeEvent' in event) {
    event.nativeEvent.stopPropagation();
    event.nativeEvent.stopImmediatePropagation?.();
    return;
  }

  event.stopImmediatePropagation();
}

function focusMenuItem(items: FocusableMenuElement[], index: number): void {
  const item = items[index];
  if (item) {
    item.focus({ preventScroll: true });
  }
}

export function handleContextMenuKeyboardNavigation(
  event: ContextMenuKeyboardEvent,
  onClose?: () => void,
  menuListOverride?: HTMLElement | null,
): void {
  if (!contextMenuNavigationKeys.has(event.key)) {
    return;
  }

  const menuList = menuListOverride
    ?? (event.currentTarget instanceof HTMLElement
      ? getMenuList(event.currentTarget)
      : null);

  if (menuList && !document.contains(menuList)) {
    return;
  }

  if (
    menuList
    && event.target instanceof HTMLElement
    && menuList.contains(event.target)
    && event.target.closest('input, textarea, [contenteditable="true"]')
  ) {
    return;
  }

  const isEventInsideMenu = Boolean(
    menuList && event.target instanceof Node && menuList.contains(event.target),
  );

  let didFocusMenuFromOutside = false;
  const isMenuNavigationKey = event.key !== 'Escape' && event.key !== 'Tab';
  if (menuList && isMenuNavigationKey && !isEventInsideMenu) {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof Node) || !menuList.contains(activeElement)) {
      const firstMenuItem = getMenuItems(menuList)[0];
      (firstMenuItem ?? menuList).focus({ preventScroll: true });
      didFocusMenuFromOutside = true;
    }
  }

  const activeMenuList = menuList && document.contains(menuList)
    ? menuList
    : null;

  if (event.key === 'Escape') {
    stopKeyboardEvent(event);
    onClose?.();
    return;
  }

  if (event.key === 'Tab') {
    event.preventDefault();
    stopKeyboardEvent(event);
    onClose?.();
    return;
  }

  if (!activeMenuList) {
    stopKeyboardEvent(event);
    return;
  }

  const menuItems = getMenuItems(activeMenuList);
  if (menuItems.length === 0) {
    stopKeyboardEvent(event);
    return;
  }

  const activeElement = document.activeElement;
  const currentIndex = !didFocusMenuFromOutside && activeElement instanceof HTMLElement
    ? menuItems.findIndex((item) => item === activeElement || item.contains(activeElement))
    : -1;

  if (event.key === 'Enter') {
    stopKeyboardEvent(event);
    // MUI MenuItem has already dispatched a click for a handled Enter key.
    if (event.defaultPrevented) return;
    event.preventDefault();
    const activeItem = currentIndex >= 0 ? menuItems[currentIndex] : menuItems[0];
    activeItem.click();
    return;
  }

  event.preventDefault();
  stopKeyboardEvent(event);

  if (event.key === 'Home') {
    focusMenuItem(menuItems, 0);
    return;
  }

  if (event.key === 'End') {
    focusMenuItem(menuItems, menuItems.length - 1);
    return;
  }

  if (event.key === 'ArrowDown') {
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % menuItems.length : 0;
    focusMenuItem(menuItems, nextIndex);
    return;
  }

  if (event.key === 'ArrowUp') {
    const previousIndex = currentIndex >= 0
      ? (currentIndex - 1 + menuItems.length) % menuItems.length
      : menuItems.length - 1;
    focusMenuItem(menuItems, previousIndex);
  }
}

export function useContextMenuFocus(open: boolean, onClose?: () => void) {
  const menuListRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const focusFirstMenuItem = (): void => {
      const menuList = menuListRef.current ?? findOpenMenuList();
      if (!menuList) {
        return;
      }

      if (!document.contains(menuList)) {
        return;
      }

      const firstMenuItem = getMenuItems(menuList)[0];

      (firstMenuItem ?? menuList).focus({ preventScroll: true });
    };

    const animationFrame = window.requestAnimationFrame(focusFirstMenuItem);
    const immediateTimeout = window.setTimeout(focusFirstMenuItem, 0);
    const settleTimeout = window.setTimeout(focusFirstMenuItem, 40);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(immediateTimeout);
      window.clearTimeout(settleTimeout);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleDocumentKeyDown = (event: KeyboardEvent): void => {
      handleContextMenuKeyboardNavigation(event, onClose, menuListRef.current ?? findOpenMenuList());
    };

    document.addEventListener('keydown', handleDocumentKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown, true);
    };
  }, [onClose, open]);

  return menuListRef;
}

export function focusContextMenuOrigin(origin: HTMLElement | null): void {
  if (!origin || !document.contains(origin)) {
    return;
  }

  window.requestAnimationFrame(() => {
    if (document.contains(origin)) {
      origin.focus({ preventScroll: true });
    }
  });
}
