import { renderHook } from '@testing-library/react';
import { useGlobalOverlayKeyboardScroll } from '../hooks/useDialogKeyboardScroll';

/** jsdom reports no client rects, which the overlay lookup filters on. */
function makeVisible(element: Element): void {
  element.getClientRects = (() => [{ width: 1, height: 1 }]) as unknown as Element['getClientRects'];
}

function scrollable(element: HTMLElement, { scrollHeight = 1000, clientHeight = 200 } = {}): HTMLElement {
  element.style.overflowY = 'auto';
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: clientHeight });
  let top = 0;
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (next: number) => { top = next; },
  });
  return element;
}

/** A visible dialog whose content scrolls. */
function mountDialog({ scrollHeight = 1000, clientHeight = 200 } = {}) {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  makeVisible(dialog);
  const content = document.createElement('div');
  content.className = 'MuiDialogContent-root';
  scrollable(content, { scrollHeight, clientHeight });
  makeVisible(content);
  dialog.appendChild(content);
  document.body.appendChild(dialog);
  return { dialog, content };
}

function press(key: string, target: Element, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('useGlobalOverlayKeyboardScroll', () => {
  beforeEach(() => { renderHook(() => useGlobalOverlayKeyboardScroll()); });
  afterEach(() => { document.body.innerHTML = ''; });

  describe('scroll amounts', () => {
    it('moves a line down on ArrowDown and back up on ArrowUp', () => {
      const { content } = mountDialog();

      press('ArrowDown', content);
      expect(content.scrollTop).toBe(40);

      press('ArrowUp', content);
      expect(content.scrollTop).toBe(0);
    });

    it('moves nearly a viewport on PageDown', () => {
      const { content } = mountDialog({ clientHeight: 500 });

      press('PageDown', content);

      expect(content.scrollTop).toBe(450);
    });

    it('never pages by less than a sensible minimum on a short dialog', () => {
      const { content } = mountDialog({ clientHeight: 100, scrollHeight: 1000 });

      press('PageDown', content);

      expect(content.scrollTop).toBe(200);
    });

    it('jumps to the ends on Home and End', () => {
      const { content } = mountDialog({ scrollHeight: 1000, clientHeight: 200 });

      press('End', content);
      expect(content.scrollTop).toBe(800);

      press('Home', content);
      expect(content.scrollTop).toBe(0);
    });

    it('scrolls on Space, so a long dialog reads like a page', () => {
      const { content } = mountDialog({ clientHeight: 500 });

      press(' ', content);

      expect(content.scrollTop).toBe(450);
    });

    it('stops at the bottom rather than scrolling past it', () => {
      const { content } = mountDialog({ scrollHeight: 1000, clientHeight: 200 });

      for (let i = 0; i < 50; i += 1) press('PageDown', content);

      expect(content.scrollTop).toBe(800);
    });

    it('stops at the top rather than going negative', () => {
      const { content } = mountDialog();

      press('ArrowUp', content);

      expect(content.scrollTop).toBe(0);
    });
  });

  describe('keys it must not take', () => {
    it('leaves Space to a focused button, which it activates', () => {
      // Hijacking Space here would break keyboard activation of the button.
      const { dialog, content } = mountDialog();
      const button = document.createElement('button');
      dialog.appendChild(button);

      const event = press(' ', button);

      expect(content.scrollTop).toBe(0);
      expect(event.defaultPrevented).toBe(false);
    });

    it('leaves Space to a link', () => {
      const { dialog, content } = mountDialog();
      const link = document.createElement('a');
      link.href = '#x';
      dialog.appendChild(link);

      press(' ', link);

      expect(content.scrollTop).toBe(0);
    });

    it.each([
      ['a text input', 'input'],
      ['a textarea', 'textarea'],
      ['a select', 'select'],
    ])('leaves arrow keys to %s', (_label, tag) => {
      const { dialog, content } = mountDialog();
      const field = document.createElement(tag);
      dialog.appendChild(field);

      press('ArrowDown', field);

      expect(content.scrollTop).toBe(0);
    });

    it.each([
      ['combobox'], ['listbox'], ['grid'], ['menu'], ['slider'], ['spinbutton'], ['textbox'],
    ])('leaves arrow keys to a %s, which drives its own selection', (role) => {
      const { dialog, content } = mountDialog();
      const widget = document.createElement('div');
      widget.setAttribute('role', role);
      dialog.appendChild(widget);

      press('ArrowDown', widget);

      expect(content.scrollTop).toBe(0);
    });

    it.each([['ctrlKey'], ['metaKey'], ['altKey']])('ignores %s combinations, which are shortcuts', (modifier) => {
      const { content } = mountDialog();

      press('ArrowDown', content, { [modifier]: true });

      expect(content.scrollTop).toBe(0);
    });

    it('ignores keys that are not scroll keys', () => {
      const { content } = mountDialog();

      press('a', content);
      press('Enter', content);

      expect(content.scrollTop).toBe(0);
    });
  });

  describe('choosing what to scroll', () => {
    it('does nothing when no overlay is open', () => {
      const loose = scrollable(document.createElement('div'));
      document.body.appendChild(loose);

      const event = press('ArrowDown', loose);

      expect(loose.scrollTop).toBe(0);
      expect(event.defaultPrevented).toBe(false);
    });

    it('scrolls the topmost overlay when several are stacked', () => {
      const first = mountDialog();
      const second = mountDialog();

      press('ArrowDown', document.body);

      expect(second.content.scrollTop).toBe(40);
      expect(first.content.scrollTop).toBe(0);
    });

    it('prefers a scrollable ancestor of the focused element', () => {
      const { dialog, content } = mountDialog();
      const inner = scrollable(document.createElement('div'), { scrollHeight: 500, clientHeight: 100 });
      makeVisible(inner);
      dialog.appendChild(inner);
      const leaf = document.createElement('span');
      inner.appendChild(leaf);

      press('ArrowDown', leaf);

      expect(inner.scrollTop).toBe(40);
      expect(content.scrollTop).toBe(0);
    });

    it('swallows the key when the overlay has nothing to scroll, so the page behind stays put', () => {
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      makeVisible(dialog);
      document.body.appendChild(dialog);

      const event = press('ArrowDown', dialog);

      expect(event.defaultPrevented).toBe(true);
    });

    it('claims the key when it does scroll, so nothing else acts on it too', () => {
      const { content } = mountDialog();

      const event = press('ArrowDown', content);

      expect(event.defaultPrevented).toBe(true);
    });
  });
});
