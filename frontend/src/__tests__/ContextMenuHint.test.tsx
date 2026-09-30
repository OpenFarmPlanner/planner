import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextMenuHint } from '../components/data-grid/ContextMenuHint';

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  Object.defineProperty(window, 'matchMedia', { writable: true, value: originalMatchMedia });
});

interface Device {
  coarsePointer?: boolean;
  narrowViewport?: boolean;
}

/**
 * The hint reads two capabilities, and jsdom answers every media query with
 * `false`, so both have to be stated explicitly for a test to mean anything.
 *
 * Each query is matched by its exact text rather than by "whatever is not the
 * pointer one": a mock that answers any remaining query would keep reporting a
 * narrow viewport even if the component started asking about a different
 * breakpoint, and the gate would look unchanged.
 */
const MOBILE_VIEWPORT_QUERY = '(max-width:900px)';
const COARSE_POINTER_QUERY = '(pointer: coarse)';

const mockDevice = ({ coarsePointer = false, narrowViewport = false }: Device = {}): void => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches:
        (query.includes(COARSE_POINTER_QUERY) && coarsePointer)
        || (query.includes(MOBILE_VIEWPORT_QUERY) && narrowViewport),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

const MOUSE = { coarsePointer: false, narrowViewport: false };
const TOUCH = { coarsePointer: true, narrowViewport: true };

type HintProps = Parameters<typeof ContextMenuHint>[0];

const renderHint = (props: Partial<HintProps> = {}) =>
  render(<ContextMenuHint message="Rechtsklick für Aktionen" {...props} />);

const hint = (): HTMLElement | null => screen.queryByRole('note');

/**
 * The discovery hint for the context menu, which exists in two variants that are
 * mutually exclusive by device: the right-click hint for a fine pointer and the
 * long-press hint for a coarse one. A page renders both unconditionally and
 * relies on exactly one appearing, so the gate -- not the box it draws -- is
 * what this covers, at both ends of the desktop/mobile split.
 *
 * Every test states both capabilities, because jsdom reports no media query as
 * matching and a hint that renders for the wrong reason looks identical to one
 * that renders for the right one.
 */
describe('ContextMenuHint', () => {
  describe('the desktop variant', () => {
    it('appears on a mouse at a wide viewport', () => {
      mockDevice(MOUSE);
      renderHint();
      expect(hint()).toBeInTheDocument();
      expect(screen.getByText('Rechtsklick für Aktionen')).toBeInTheDocument();
    });

    it('is the default when no variant is named', () => {
      mockDevice(MOUSE);
      renderHint({ variant: undefined });
      expect(hint()).toBeInTheDocument();
    });

    /** There is no right-click to discover on a touch device. */
    it('stays away on a touch device', () => {
      mockDevice(TOUCH);
      renderHint({ variant: 'desktop' });
      expect(hint()).not.toBeInTheDocument();
    });

    /**
     * A narrow window on a mouse device gets no hint either: the gate matches
     * the one in `useContextMenuHint`, where a narrow viewport means the table
     * is in its mobile layout and the right-click target is not there.
     */
    it('stays away in a narrow window even with a mouse', () => {
      mockDevice({ coarsePointer: false, narrowViewport: true });
      renderHint({ variant: 'desktop' });
      expect(hint()).not.toBeInTheDocument();
    });

    it('stays away on a touch device at a wide viewport', () => {
      mockDevice({ coarsePointer: true, narrowViewport: false });
      renderHint({ variant: 'desktop' });
      expect(hint()).not.toBeInTheDocument();
    });
  });

  describe('the touch variant', () => {
    it('appears on a touch device', () => {
      mockDevice(TOUCH);
      renderHint({ variant: 'touch', message: 'Lange drücken für Aktionen' });
      expect(hint()).toBeInTheDocument();
      expect(screen.getByText('Lange drücken für Aktionen')).toBeInTheDocument();
    });

    /**
     * Pointer capability alone decides this one. A tablet held in landscape is
     * still a touch device, so the viewport width must not enter into it.
     */
    it('appears on a touch device at a wide viewport too', () => {
      mockDevice({ coarsePointer: true, narrowViewport: false });
      renderHint({ variant: 'touch' });
      expect(hint()).toBeInTheDocument();
    });

    it('stays away on a mouse device', () => {
      mockDevice(MOUSE);
      renderHint({ variant: 'touch' });
      expect(hint()).not.toBeInTheDocument();
    });

    it('stays away in a narrow window that is not a touch device', () => {
      mockDevice({ coarsePointer: false, narrowViewport: true });
      renderHint({ variant: 'touch' });
      expect(hint()).not.toBeInTheDocument();
    });
  });

  describe('the two variants together', () => {
    it.each([
      ['a mouse at a wide viewport', MOUSE, 1],
      ['a touch device', TOUCH, 1],
      ['a narrow window with a mouse', { coarsePointer: false, narrowViewport: true }, 0],
    ])('shows %s exactly the hints it should', (_label, device, expected) => {
      mockDevice(device);
      render(
        <>
          <ContextMenuHint message="Rechtsklick" variant="desktop" />
          <ContextMenuHint message="Lange drücken" variant="touch" />
        </>,
      );
      expect(screen.queryAllByRole('note')).toHaveLength(expected);
    });
  });

  describe('what it shows', () => {
    it('adds a secondary line when given one', () => {
      mockDevice(MOUSE);
      renderHint({ secondary: 'Oder Menü-Taste' });
      expect(screen.getByText('Oder Menü-Taste')).toBeInTheDocument();
    });

    it('renders no second line otherwise', () => {
      mockDevice(MOUSE);
      const { container } = renderHint();
      expect(container.querySelectorAll('.MuiTypography-caption')).toHaveLength(0);
    });

    it('hides its icon from assistive technology', () => {
      mockDevice(MOUSE);
      const { container } = renderHint();
      const decoration = container.querySelector('[aria-hidden="true"]');
      expect(decoration?.querySelector('svg')).toBeInTheDocument();
    });

    it('uses a mouse icon for the right-click hint', () => {
      mockDevice(MOUSE);
      const { container } = renderHint({ variant: 'desktop' });
      expect(container.querySelector('[data-testid="MouseOutlinedIcon"]')).toBeInTheDocument();
      expect(container.querySelector('[data-testid="TouchAppOutlinedIcon"]')).toBeNull();
    });

    it('uses a touch icon for the long-press hint', () => {
      mockDevice(TOUCH);
      const { container } = renderHint({ variant: 'touch' });
      expect(container.querySelector('[data-testid="TouchAppOutlinedIcon"]')).toBeInTheDocument();
      expect(container.querySelector('[data-testid="MouseOutlinedIcon"]')).toBeNull();
    });

    it('marks the message more strongly when prominent', () => {
      mockDevice(MOUSE);
      renderHint({ prominent: true });
      const message = screen.getByText('Rechtsklick für Aktionen');
      expect(window.getComputedStyle(message).fontWeight).toBe('700');
      expect(window.getComputedStyle(hint() as HTMLElement).borderLeftWidth).toBe('4px');
    });

    it('keeps the plain weight and no accent bar otherwise', () => {
      mockDevice(MOUSE);
      renderHint();
      const message = screen.getByText('Rechtsklick für Aktionen');
      expect(window.getComputedStyle(message).fontWeight).toBe('600');
      expect(window.getComputedStyle(hint() as HTMLElement).borderLeftWidth).not.toBe('4px');
    });

    /** MUI's 8px spacing unit: `px: 1` is 8px and `px: 1.25` is 10px. */
    it('tightens its padding when compact', () => {
      mockDevice(MOUSE);
      renderHint({ compact: true });
      const compact = window.getComputedStyle(hint() as HTMLElement);
      expect(compact.paddingLeft).toBe('8px');
      expect(compact.paddingTop).toBe('5px');
    });

    it('leaves its padding roomy otherwise', () => {
      mockDevice(MOUSE);
      renderHint();
      const roomy = window.getComputedStyle(hint() as HTMLElement);
      expect(roomy.paddingLeft).toBe('10px');
      expect(roomy.paddingTop).toBe('6px');
    });

    it('takes extra styling from the caller', () => {
      mockDevice(MOUSE);
      renderHint({ sx: { marginTop: '11px' } });
      expect(window.getComputedStyle(hint() as HTMLElement).marginTop).toBe('11px');
    });

    /**
     * The caller's `sx` is spread last, so it can override the hint's own
     * styling and not only add to it -- pages place this box in layouts the
     * component knows nothing about.
     */
    it('lets the caller override its own styling', () => {
      mockDevice(MOUSE);
      renderHint({ sx: { borderRadius: '2px', boxShadow: 'none' } });
      const style = window.getComputedStyle(hint() as HTMLElement);
      expect(style.borderRadius).toBe('2px');
      expect(style.boxShadow).toBe('none');
    });
  });

  describe('dismissing', () => {
    it('offers a close button when the caller can handle it', async () => {
      const user = userEvent.setup();
      mockDevice(MOUSE);
      const onClose = vi.fn();
      renderHint({ onClose });
      await user.click(screen.getByRole('button', { name: 'Schließen' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    /** A hint the page keeps for good has nothing to dismiss. */
    it('offers no close button otherwise', () => {
      mockDevice(MOUSE);
      renderHint();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('offers it on the touch variant too', async () => {
      const user = userEvent.setup();
      mockDevice(TOUCH);
      const onClose = vi.fn();
      renderHint({ variant: 'touch', onClose });
      await user.click(screen.getByRole('button', { name: 'Schließen' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
