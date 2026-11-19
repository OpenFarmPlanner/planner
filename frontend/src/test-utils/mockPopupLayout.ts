import { vi } from 'vitest';

/** Give Popper a visible anchor and clipping parents in jsdom, which has no layout. */
export function mockPopupLayout() {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(1024);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(768);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(16, 24, 320, 40));
}
