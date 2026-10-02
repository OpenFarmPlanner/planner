import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { MenuList } from '@mui/material';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ContextMenuActionItem } from '../components/contextMenu/ContextMenuActionItem';
import theme from '../theme';

/**
 * Resolved from the app theme rather than written as a literal: the point is
 * that `color="error"` means the theme's error colour, not one particular hex.
 */
const ERROR_COLOR = 'rgb(211, 47, 47)';
const PRIMARY_COLOR = 'rgb(37, 111, 42)';

type ItemProps = ComponentProps<typeof ContextMenuActionItem>;

const renderItem = (props: Partial<ItemProps> = {}) =>
  render(
    <ThemeProvider theme={theme}>
      <MenuList>
        <ContextMenuActionItem label="Löschen" {...props} />
      </MenuList>
    </ThemeProvider>,
  );

const item = (): HTMLElement => screen.getByRole('menuitem');
const labelText = (): HTMLElement => screen.getByText('Löschen');
const isPlain = (): boolean => item().querySelector('.MuiListItemText-root') === null;

/**
 * One action row in a context menu. Every menu in the app builds its rows from
 * this, so the two things it has to get right are which parts it draws and how
 * a caller's own `sx` combines with the colour it derives from `color` --
 * `mergeSx` exists because MUI's `sx` is not a plain object once a caller
 * passes an array, and dropping either side silently loses styling.
 *
 * `renderPlainWhenUnadorned` is the other decision: a row with nothing but a
 * label skips the `ListItemIcon`/`ListItemText` scaffolding so it lines up with
 * MUI's own plain `MenuItem`s in the same menu. Any one adornment turns the
 * scaffolding back on, which is four separate conditions and four tests.
 *
 * A mutation battery leaves three breaks standing, all redundant code:
 *
 * - `mergeSx`'s two early returns. MUI ignores falsy entries in an `sx` array,
 *   so falling through to `[undefined, sx]` or `[base, undefined]` renders the
 *   same thing; the guards only avoid building a pointless array.
 * - `color: resolvedColor` on the label. The `MenuItem` around it already
 *   carries that colour and the label inherits it -- the theme overrides
 *   `MuiListItemText`'s `secondary` colour but not `primary`, so nothing stands
 *   in the way of the inheritance.
 */
describe('ContextMenuActionItem', () => {
  describe('what it draws', () => {
    it('shows its label', () => {
      renderItem();
      expect(item()).toHaveTextContent('Löschen');
    });

    it('wraps the label in list-item scaffolding by default', () => {
      renderItem();
      expect(isPlain()).toBe(false);
    });

    it('shows an icon when given one', () => {
      renderItem({ icon: <span data-testid="icon" /> });
      expect(screen.getByTestId('icon')).toBeInTheDocument();
      expect(item().querySelector('.MuiListItemIcon-root')).toBeInTheDocument();
    });

    it('draws no icon slot otherwise', () => {
      renderItem();
      expect(item().querySelector('.MuiListItemIcon-root')).toBeNull();
    });

    it('shows a shortcut hint when given one', () => {
      renderItem({ shortcutHint: 'Entf' });
      expect(screen.getByText('Entf')).toBeInTheDocument();
    });

    it('draws no hint slot otherwise', () => {
      renderItem();
      expect(screen.queryByText('Entf')).not.toBeInTheDocument();
      expect(item().querySelectorAll('.MuiTypography-body2')).toHaveLength(0);
    });

    /** The hint is pushed to the trailing edge so the hints line up down a menu. */
    it('pushes the hint away from the label', () => {
      renderItem({ shortcutHint: 'Entf' });
      expect(window.getComputedStyle(screen.getByText('Entf')).marginLeft).toBe('auto');
    });

    /**
     * `emphasized` currently changes nothing a user can see.
     * `theme.ts` sets `MuiListItemText.styleOverrides.primary.fontWeight: 400`,
     * and that override beats the `fontWeight` this component passes through
     * `slotProps.primary.sx`, so the label stays at 400 either way.
     * `FieldsBedsHierarchy` passes `emphasized: true` for two of its
     * context-menu actions and gets no emphasis.
     *
     * Pinned as the current behaviour rather than fixed: making it work changes
     * what two menu rows look like, which needs the visual review this repo
     * asks for on rendered-UI changes. Moving the weight onto the
     * `ListItemText`'s own `sx` (`'& .MuiListItemText-primary'`) does make it
     * apply -- verified against this suite -- so the fix is known and small; it
     * just is not a test-only change.
     */
    it('does not actually change the label weight, despite the prop', () => {
      renderItem({ emphasized: true });
      expect(window.getComputedStyle(labelText()).fontWeight).toBe('400');
    });

    it('leaves the label at 400 without the prop too', () => {
      renderItem();
      expect(window.getComputedStyle(labelText()).fontWeight).toBe('400');
    });

    /**
     * What `emphasized` does still do: it counts as an adornment, so it turns
     * the plain rendering off. That half works and the menus depend on it.
     */
    it('still counts as an adornment', () => {
      renderItem({ emphasized: true, renderPlainWhenUnadorned: true });
      expect(isPlain()).toBe(false);
    });
  });

  describe('colour', () => {
    it('paints a destructive action in the theme error colour', () => {
      renderItem({ color: 'error' });
      expect(window.getComputedStyle(item()).color).toBe(ERROR_COLOR);
      expect(window.getComputedStyle(labelText()).color).toBe(ERROR_COLOR);
    });

    it('paints a primary action in the theme primary colour', () => {
      renderItem({ color: 'primary' });
      expect(window.getComputedStyle(item()).color).toBe(PRIMARY_COLOR);
      expect(window.getComputedStyle(labelText()).color).toBe(PRIMARY_COLOR);
    });

    it('leaves an ordinary action alone', () => {
      renderItem();
      const color = window.getComputedStyle(item()).color;
      expect(color).not.toBe(ERROR_COLOR);
      expect(color).not.toBe(PRIMARY_COLOR);
    });

    /** The icon has to follow the row, or a red action keeps a grey icon. */
    it('paints the icon to match', () => {
      renderItem({ color: 'error', icon: <span data-testid="icon" /> });
      const iconSlot = item().querySelector('.MuiListItemIcon-root') as HTMLElement;
      expect(window.getComputedStyle(iconSlot).color).toBe(ERROR_COLOR);
    });

    it('leaves the icon alone on an ordinary action', () => {
      renderItem({ icon: <span data-testid="icon" /> });
      const iconSlot = item().querySelector('.MuiListItemIcon-root') as HTMLElement;
      expect(window.getComputedStyle(iconSlot).color).not.toBe(ERROR_COLOR);
    });
  });

  describe('merging the caller\'s own styling', () => {
    it('keeps the caller\'s styling when there is no colour to merge with', () => {
      renderItem({ sx: { marginTop: '7px' } });
      expect(window.getComputedStyle(item()).marginTop).toBe('7px');
    });

    it('keeps the colour when the caller passes no styling', () => {
      renderItem({ color: 'error' });
      expect(window.getComputedStyle(item()).color).toBe(ERROR_COLOR);
    });

    it('keeps both when the caller passes an object', () => {
      renderItem({ color: 'error', sx: { marginTop: '7px' } });
      const style = window.getComputedStyle(item());
      expect(style.color).toBe(ERROR_COLOR);
      expect(style.marginTop).toBe('7px');
    });

    /**
     * MUI lets `sx` be an array, and spreading it rather than nesting it is the
     * whole reason `mergeSx` exists -- `[base, sx]` with an array `sx` would put
     * an array inside an array and MUI would drop it.
     */
    it('keeps every entry when the caller passes an array', () => {
      renderItem({
        color: 'error',
        sx: [{ marginTop: '7px' }, { marginBottom: '9px' }],
      });
      const style = window.getComputedStyle(item());
      expect(style.color).toBe(ERROR_COLOR);
      expect(style.marginTop).toBe('7px');
      expect(style.marginBottom).toBe('9px');
    });

    it('lets the caller override the colour it derived', () => {
      renderItem({ color: 'error', sx: { color: 'rgb(1, 2, 3)' } });
      expect(window.getComputedStyle(item()).color).toBe('rgb(1, 2, 3)');
    });
  });

  describe('the plain rendering', () => {
    it('drops the scaffolding for a label-only row', () => {
      renderItem({ renderPlainWhenUnadorned: true });
      expect(isPlain()).toBe(true);
      expect(item()).toHaveTextContent('Löschen');
    });

    it('keeps the scaffolding unless the caller asks for plain', () => {
      renderItem({ renderPlainWhenUnadorned: false });
      expect(isPlain()).toBe(false);
    });

    it.each([
      ['an icon', { icon: <span data-testid="icon" /> }],
      ['a shortcut hint', { shortcutHint: 'Entf' }],
      ['an emphasized label', { emphasized: true }],
    ])('keeps the scaffolding for a row with %s', (_label, adornment) => {
      renderItem({ renderPlainWhenUnadorned: true, ...adornment });
      expect(isPlain()).toBe(false);
    });

    it('still takes its colour when rendered plain', () => {
      renderItem({ renderPlainWhenUnadorned: true, color: 'error' });
      expect(isPlain()).toBe(true);
      expect(window.getComputedStyle(item()).color).toBe(ERROR_COLOR);
    });

    it('still merges the caller\'s styling when rendered plain', () => {
      renderItem({
        renderPlainWhenUnadorned: true,
        color: 'primary',
        sx: [{ marginTop: '7px' }],
      });
      const style = window.getComputedStyle(item());
      expect(style.color).toBe(PRIMARY_COLOR);
      expect(style.marginTop).toBe('7px');
    });
  });

  describe('being a menu item', () => {
    it('passes a click through to the caller', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      renderItem({ onClick });
      await user.click(item());
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('passes a click through from a plain row too', async () => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      renderItem({ renderPlainWhenUnadorned: true, onClick });
      await user.click(item());
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('can be disabled', async () => {
      const onClick = vi.fn();
      renderItem({ onClick, disabled: true });
      expect(item()).toHaveAttribute('aria-disabled', 'true');
      expect(onClick).not.toHaveBeenCalled();
    });

    it('forwards any other MenuItem prop', () => {
      renderItem({ autoFocus: true, 'data-testid': 'row' } as Partial<ItemProps>);
      expect(screen.getByTestId('row')).toBe(item());
      expect(item()).toHaveFocus();
    });
  });
});
