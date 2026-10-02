import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import theme from '../theme';
import { MobilePlanActionsMenu } from '../components/planting-plans/MobilePlanActionsMenu';
import type { PlantingPlanRow } from '../pages/plantingPlansUtils';

const row = { id: 42, crop: 7 } as unknown as PlantingPlanRow;

const anchor = (): HTMLElement => {
  const button = document.createElement('button');
  button.textContent = 'Aktionen';
  document.body.appendChild(button);
  return button;
};

interface RenderOptions {
  open?: boolean;
  plan?: PlantingPlanRow | null;
}

const renderMenu = ({ open = true, plan = row }: RenderOptions = {}) => {
  const handlers = {
    onClose: vi.fn(),
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onCopy: vi.fn(),
    onDelete: vi.fn(),
  };
  const view = render(
    <ThemeProvider theme={theme}>
      <MobilePlanActionsMenu anchorEl={open ? anchor() : null} row={plan} {...handlers} />
    </ThemeProvider>,
  );
  return { ...view, ...handlers };
};

const action = (name: string): HTMLElement => screen.getByRole('menuitem', { name });

/**
 * The per-card actions menu on the mobile planting-plan list. It is
 * presentational -- `PlantingPlans.tsx` owns the anchor, the row and every
 * handler -- so what is covered here is the contract each card relies on: which
 * four actions appear in which order, that each one hands over the row it was
 * opened for, and that each one closes the menu afterwards whether or not it had
 * a row to act on.
 *
 * That last part is the reason every item has its own `if (row)`: the menu stays
 * mounted between openings, so an action can fire while `row` is already null
 * and must still close rather than leave the sheet stuck open over the list.
 *
 * One mutation stands: pointing `anchorEl` at a fixed element instead of the
 * card's button. `open` is derived from `Boolean(anchorEl)` separately, so the
 * anchor only decides where the sheet is positioned -- and jsdom reports every
 * element as 0x0 with no layout, so there is no position to assert. It would
 * take a real browser, which is e2e territory.
 */
describe('MobilePlanActionsMenu', () => {
  describe('what it offers', () => {
    it('shows the four card actions', () => {
      renderMenu();
      ['Bearbeiten', 'Duplizieren', 'Anbauplan kopieren', 'Löschen'].forEach((name) =>
        expect(action(name)).toBeInTheDocument(),
      );
    });

    it('keeps them in the order the cards expect', () => {
      renderMenu();
      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
        'Bearbeiten',
        'Duplizieren',
        'Anbauplan kopieren',
        'Löschen',
      ]);
    });

    /** Deleting is set apart from the three non-destructive actions. */
    it('separates the destructive action from the rest', () => {
      renderMenu();
      const items = screen.getAllByRole('menuitem');
      const separator = screen.getByRole('separator');
      expect(separator.compareDocumentPosition(items[2]) & Node.DOCUMENT_POSITION_PRECEDING)
        .toBeTruthy();
      expect(separator.compareDocumentPosition(items[3]) & Node.DOCUMENT_POSITION_FOLLOWING)
        .toBeTruthy();
    });

    /**
     * Rendered inside the app theme, so this asserts the project's own error
     * colour. Without the provider MUI's default theme would answer -- and its
     * `error.main` happens to be the same hex, so the test would pass while
     * testing the wrong palette.
     */
    it('marks deleting as destructive', () => {
      renderMenu();
      const errorColor = 'rgb(211, 47, 47)';
      expect(window.getComputedStyle(action('Löschen')).color).toBe(errorColor);
      expect(window.getComputedStyle(action('Bearbeiten')).color).not.toBe(errorColor);
    });

    it('gives every action an icon', () => {
      renderMenu();
      screen.getAllByRole('menuitem').forEach((item) => {
        expect(item.querySelector('.MuiListItemIcon-root svg')).toBeInTheDocument();
      });
    });

    it('distinguishes duplicating from copying, which share an icon', () => {
      renderMenu();
      expect(action('Duplizieren')).not.toBe(action('Anbauplan kopieren'));
    });
  });

  describe('being open', () => {
    it('opens once a card supplies an anchor', () => {
      renderMenu({ open: true });
      expect(screen.getByRole('menu')).toBeInTheDocument();
    });

    it('renders nothing without one', () => {
      renderMenu({ open: false });
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
      expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
    });

    it('closes on Escape', async () => {
      const user = userEvent.setup();
      const { onClose, onEdit } = renderMenu();
      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onEdit).not.toHaveBeenCalled();
    });
  });

  describe('delegating', () => {
    it.each([
      ['Bearbeiten', 'onEdit' as const],
      ['Duplizieren', 'onDuplicate' as const],
      ['Anbauplan kopieren', 'onCopy' as const],
      ['Löschen', 'onDelete' as const],
    ])('hands the row to %s', async (name, handler) => {
      const user = userEvent.setup();
      const menu = renderMenu();
      await user.click(action(name));
      expect(menu[handler]).toHaveBeenCalledWith(row);
      expect(menu[handler]).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['Bearbeiten', 'onEdit' as const],
      ['Duplizieren', 'onDuplicate' as const],
      ['Anbauplan kopieren', 'onCopy' as const],
      ['Löschen', 'onDelete' as const],
    ])('runs only %s and nothing else', async (name, handler) => {
      const user = userEvent.setup();
      const menu = renderMenu();
      await user.click(action(name));
      (['onEdit', 'onDuplicate', 'onCopy', 'onDelete'] as const)
        .filter((other) => other !== handler)
        .forEach((other) => expect(menu[other]).not.toHaveBeenCalled());
    });

    it.each(['Bearbeiten', 'Duplizieren', 'Anbauplan kopieren', 'Löschen'])(
      'closes the menu after %s',
      async (name) => {
        const user = userEvent.setup();
        const { onClose } = renderMenu();
        await user.click(action(name));
        expect(onClose).toHaveBeenCalledTimes(1);
      },
    );
  });

  describe('without a row', () => {
    it.each([
      ['Bearbeiten', 'onEdit' as const],
      ['Duplizieren', 'onDuplicate' as const],
      ['Anbauplan kopieren', 'onCopy' as const],
      ['Löschen', 'onDelete' as const],
    ])('does nothing on %s', async (name, handler) => {
      const user = userEvent.setup();
      const menu = renderMenu({ plan: null });
      await user.click(action(name));
      expect(menu[handler]).not.toHaveBeenCalled();
    });

    /**
     * Still closes. Without this the sheet would stay open over the list with
     * nothing to act on, and on a phone there is no second click target to
     * escape it with.
     */
    it.each(['Bearbeiten', 'Duplizieren', 'Anbauplan kopieren', 'Löschen'])(
      'still closes on %s',
      async (name) => {
        const user = userEvent.setup();
        const { onClose } = renderMenu({ plan: null });
        await user.click(action(name));
        expect(onClose).toHaveBeenCalledTimes(1);
      },
    );
  });
});
