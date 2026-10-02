import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { HierarchyAddIcon } from '../components/hierarchy/HierarchyAddIcon';
import { AddBedIcon } from '../components/hierarchy/AddBedIcon';
import theme from '../theme';

type IconProps = ComponentProps<typeof HierarchyAddIcon>;

const renderIcon = (props: Partial<IconProps> = {}) =>
  render(
    <ThemeProvider theme={theme}>
      <HierarchyAddIcon {...props} />
    </ThemeProvider>,
  );

/** The static variant renders a span, so there is no role to query it by. */
const staticIcon = (container: HTMLElement): HTMLElement =>
  container.querySelector('span[aria-hidden]') as HTMLElement;

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

/**
 * The small "+" badge used in the growing-areas hierarchy and, as a legend
 * glyph, in the page help. It renders as one of two different elements rather
 * than one element with a disabled attribute, and that is the whole point:
 * inside a table row it is a real button a user can tab to and press, while in
 * a sentence explaining what the button looks like it is a decorative span that
 * assistive technology skips and the pointer cannot reach.
 *
 * Both shapes share one `commonSx`, so the thing most likely to break is one
 * mode quietly picking up the other's affordances -- a legend glyph that takes
 * focus, or a row button that ignores clicks.
 */
describe('HierarchyAddIcon', () => {
  describe('the interactive variant', () => {
    it('is a button', () => {
      renderIcon({ ariaLabel: 'Beet hinzufügen' });
      expect(screen.getByRole('button', { name: 'Beet hinzufügen' })).toBeInTheDocument();
    });

    it('is the default, with no prop passed', () => {
      renderIcon({ ariaLabel: 'Beet hinzufügen' });
      expect(screen.getByRole('button')).toBeInTheDocument();
    });

    it('reports a click', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      renderIcon({ ariaLabel: 'Beet hinzufügen', onClick });
      await user.click(screen.getByRole('button'));
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('accepts the caller\'s tab index', () => {
      renderIcon({ ariaLabel: 'Beet hinzufügen', tabIndex: -1 });
      expect(screen.getByRole('button')).toHaveAttribute('tabindex', '-1');
    });

    it('stays in the natural tab order when the caller says nothing', () => {
      renderIcon({ ariaLabel: 'Beet hinzufügen' });
      expect(screen.getByRole('button')).not.toHaveAttribute('tabindex', '-1');
    });

    it('invites a click and lets pointer events through', () => {
      renderIcon({ ariaLabel: 'Beet hinzufügen' });
      const style = window.getComputedStyle(screen.getByRole('button'));
      expect(style.cursor).toBe('pointer');
      expect(style.pointerEvents).not.toBe('none');
    });

    /** A row's hover background is the button's own, so it starts clear. */
    it('starts with no fill of its own', () => {
      renderIcon({ ariaLabel: 'Beet hinzufügen' });
      expect(window.getComputedStyle(screen.getByRole('button')).backgroundColor).toBe(
        TRANSPARENT,
      );
    });

    it('drops the icon button\'s default padding so it stays 20px across', () => {
      renderIcon({ ariaLabel: 'Beet hinzufügen' });
      const style = window.getComputedStyle(screen.getByRole('button'));
      expect(style.padding).toBe('0px');
      expect(style.width).toBe('20px');
      expect(style.height).toBe('20px');
    });

    /**
     * `ariaHidden` is accepted by the props but never reaches this branch --
     * a hidden button would be unreachable while still being focusable, so
     * ignoring it is the safer reading. Pinned so the asymmetry is on record.
     */
    it('ignores ariaHidden', () => {
      renderIcon({ ariaLabel: 'Beet hinzufügen', ariaHidden: true });
      expect(screen.getByRole('button')).not.toHaveAttribute('aria-hidden');
    });
  });

  describe('the static variant', () => {
    it('is not a button', () => {
      renderIcon({ interactive: false });
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('renders a span instead', () => {
      const { container } = renderIcon({ interactive: false });
      expect(staticIcon(container).tagName).toBe('SPAN');
      expect(staticIcon(container).querySelector('svg')).toBeInTheDocument();
    });

    /** It is a glyph inside a sentence that already names it, so it is skipped. */
    it('hides itself from assistive technology by default', () => {
      const { container } = renderIcon({ interactive: false });
      expect(staticIcon(container)).toHaveAttribute('aria-hidden', 'true');
    });

    it('can be made visible to assistive technology', () => {
      const { container } = renderIcon({ interactive: false, ariaHidden: false });
      expect(staticIcon(container)).toHaveAttribute('aria-hidden', 'false');
    });

    it('takes no clicks and shows no pointer affordance', () => {
      const { container } = renderIcon({ interactive: false });
      const style = window.getComputedStyle(staticIcon(container));
      expect(style.pointerEvents).toBe('none');
      expect(style.cursor).toBe('default');
    });

    /**
     * The code asks for a pale fill here (`success.50`) to set the glyph apart
     * from the clickable version, but the theme's `success` palette defines only
     * `main`, `light`, `dark` and `contrastText` -- so `success.50` resolves to
     * nothing and both variants render with no fill at all. Pinned as the real
     * behaviour; see the note at the bottom of this file.
     */
    it('renders without the pale fill its styling asks for', () => {
      const { container } = renderIcon({ interactive: false });
      expect(window.getComputedStyle(staticIcon(container)).backgroundColor).toBe(TRANSPARENT);
    });

    it('sits on the text baseline it is written into', () => {
      const { container } = renderIcon({ interactive: false });
      expect(window.getComputedStyle(staticIcon(container)).verticalAlign).toBe('middle');
    });

    /**
     * `fireEvent`, because `pointer-events: none` makes userEvent refuse the
     * click outright -- and the point is that even a click reaching the element
     * does nothing, since the static branch never wires the handler up.
     */
    it('ignores a click handler it should never have been given', () => {
      const onClick = vi.fn();
      const { container } = renderIcon({ interactive: false, onClick });
      fireEvent.click(staticIcon(container));
      expect(onClick).not.toHaveBeenCalled();
    });
  });

  describe('what both variants share', () => {
    it.each([
      ['interactive', true],
      ['static', false],
    ])('keeps the %s variant 20px across with a round border', (_label, interactive) => {
      const { container } = renderIcon({ interactive, ariaLabel: 'Beet hinzufügen' });
      const element = interactive ? screen.getByRole('button') : staticIcon(container);
      const style = window.getComputedStyle(element);
      expect(style.width).toBe('20px');
      expect(style.height).toBe('20px');
      expect(style.borderRadius).toBe('50%');
      expect(style.borderWidth).toBe('1px');
    });

    /** 12px inside a 20px badge; the glyph has to stay inside the circle. */
    it.each([
      ['interactive', true],
      ['static', false],
    ])('keeps the %s variant\'s glyph small enough for the badge', (_label, interactive) => {
      const { container } = renderIcon({ interactive, ariaLabel: 'Beet hinzufügen' });
      const element = interactive ? screen.getByRole('button') : staticIcon(container);
      const glyph = element.querySelector('.MuiSvgIcon-root') as HTMLElement;
      expect(window.getComputedStyle(glyph).fontSize).toBe('12px');
    });

    it.each([
      ['interactive', true],
      ['static', false],
    ])('lets the caller override its styling on the %s variant', (_label, interactive) => {
      const { container } = renderIcon({
        interactive,
        ariaLabel: 'Beet hinzufügen',
        sx: { width: 32, height: 32 },
      });
      const element = interactive ? screen.getByRole('button') : staticIcon(container);
      const style = window.getComputedStyle(element);
      expect(style.width).toBe('32px');
      expect(style.height).toBe('32px');
    });
  });

  /**
   * `AddBedIcon` is a named pass-through, so the only thing it can get wrong is
   * dropping one of the props on the way. It has no `tabIndex`, which is the
   * one prop it deliberately does not forward.
   */
  describe('AddBedIcon, which only forwards', () => {
    it('forwards the interactive variant and its label and handler', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      render(
        <ThemeProvider theme={theme}>
          <AddBedIcon ariaLabel="Beet hinzufügen" onClick={onClick} />
        </ThemeProvider>,
      );
      await user.click(screen.getByRole('button', { name: 'Beet hinzufügen' }));
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('forwards the static variant and its aria-hidden', () => {
      const { container } = render(
        <ThemeProvider theme={theme}>
          <AddBedIcon interactive={false} ariaHidden={false} />
        </ThemeProvider>,
      );
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(staticIcon(container)).toHaveAttribute('aria-hidden', 'false');
    });

    it('forwards the caller\'s styling', () => {
      render(
        <ThemeProvider theme={theme}>
          <AddBedIcon ariaLabel="Beet hinzufügen" sx={{ width: 32 }} />
        </ThemeProvider>,
      );
      expect(window.getComputedStyle(screen.getByRole('button')).width).toBe('32px');
    });
  });
});

/*
 * Finding, recorded rather than fixed.
 *
 * This component asks for `success.400` (border), `success.50` (the static
 * variant's fill) and `success.100` (the hover fill), and the theme's `success`
 * palette defines only `main`, `light`, `dark` and `contrastText`. All three
 * resolve to nothing: the static and interactive variants end up with the same
 * absent fill, the hover fill never appears, and the border falls back to
 * `currentColor` -- which happens to be `success.main`, so the border looks
 * right by accident rather than by instruction.
 *
 * The battery demonstrates it directly: swapping the two branches of
 * `bgcolor: interactive ? 'transparent' : 'success.50'` changes nothing, because
 * both sides render to no fill. That mutation is left standing on purpose --
 * writing a test that passes today would mean asserting the absence of the fill
 * on both variants, which is exactly what would have to be deleted when the
 * palette is fixed.
 *
 * It is not this file's bug. 18 references to numeric `success` shades
 * (50/100/200/400) exist across 9 files, including `ContextMenuHint`,
 * `EmptyStateCard`, `GraphicalFields` and `PublicCropLibraryDialog`, and every
 * one of them is dead for the same reason. Fixing it means extending the
 * palette, which changes the look of several screens at once and so needs the
 * visual review this repo asks for on rendered-UI changes.
 */
