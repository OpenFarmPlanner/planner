import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { PlantingPlanFilterSheet } from '../components/planting-plans/search/PlantingPlanFilterSheet';
import {
  DEFAULT_PLANTING_PLAN_SORT,
  type PlantingPlanFilters,
} from '../pages/plantingPlanSearch';
import type { PlantingPlanSearchControls } from '../pages/usePlantingPlanSearch';
import {
  plantingPlanFilters as withFilters,
  plantingPlanSearchControls as controls,
} from './helpers/plantingPlanSearchControls';
import theme from '../theme';

interface RenderOptions {
  open?: boolean;
  filters?: PlantingPlanFilters;
  overrides?: Partial<PlantingPlanSearchControls>;
}

const renderSheet = ({
  open = true,
  filters = withFilters(),
  overrides = {},
}: RenderOptions = {}) => {
  const search = controls(filters, overrides);
  const onClose = vi.fn();
  const view = render(
    <ThemeProvider theme={theme}>
      <PlantingPlanFilterSheet
        id="planting-plan-filter-sheet"
        open={open}
        onClose={onClose}
        search={search}
      />
    </ThemeProvider>,
  );
  return { ...view, search, onClose };
};

const sheet = (): HTMLElement => screen.getByRole('dialog');
const resetButton = (): HTMLElement => screen.getByRole('button', { name: 'Zurücksetzen' });
const showResultsButton = (): HTMLElement => screen.getByRole('button', { name: /anzeigen$/ });

/**
 * The mobile filter sheet the search bar's filter button opens.
 * `PlantingPlanFilterFields` carries the fields themselves and has its own
 * suite, and `usePlantingPlanSearch` owns the state, so what is left here is
 * the sheet's own frame: that it identifies itself to assistive technology by
 * the id the trigger points at, that its reset covers the sort order as well as
 * the filters, and that its one big button closes rather than applies --
 * filters take effect live, so a user who taps away from the sheet keeps them.
 */
describe('PlantingPlanFilterSheet', () => {
  describe('being open', () => {
    it('renders nothing while closed', () => {
      renderSheet({ open: false });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('shows its title once open', () => {
      renderSheet();
      expect(screen.getByRole('heading', { name: 'Filter und Sortierung' })).toBeInTheDocument();
    });

    /** The search bar's `aria-controls` points at this id while the sheet is open. */
    it('carries the id its trigger points at', () => {
      renderSheet();
      expect(sheet()).toHaveAttribute('id', 'planting-plan-filter-sheet');
    });

    /**
     * Only `aria-labelledby` is this component's doing. MUI's Drawer already
     * puts `role="dialog"` and `aria-modal` on the paper, so the explicit ones
     * beside them are redundant -- verified by removing both and finding the
     * paper still reported as a modal dialog.
     */
    it('names itself by its own title for assistive technology', () => {
      renderSheet();
      const titleId = sheet().getAttribute('aria-labelledby');
      expect(titleId).toBeTruthy();
      expect(document.getElementById(titleId as string)).toHaveTextContent(
        'Filter und Sortierung',
      );
    });

    /**
     * A bottom sheet rather than a side drawer. `anchor` itself is not
     * assertable -- this MUI version folds it into the generated emotion class
     * instead of a stable `paperAnchorBottom` -- so what is pinned is the
     * geometry the sheet sets for that shape: rounded only along its top edge
     * and capped below the viewport height. The `env(safe-area-inset-bottom)`
     * padding that keeps the button clear of the home indicator is not
     * assertable -- jsdom resolves `env()` to its fallback, which is the same
     * `0` as no padding at all.
     */
    it('is shaped as a bottom sheet', () => {
      renderSheet();
      const style = window.getComputedStyle(sheet());
      expect(style.borderTopLeftRadius).toBe('16px');
      expect(style.borderTopRightRadius).toBe('16px');
      expect(style.borderBottomLeftRadius).not.toBe('16px');
      expect(style.maxHeight).toBe('85dvh');
    });

    it('closes on Escape', async () => {
      const user = userEvent.setup();
      const { onClose } = renderSheet();
      await user.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    /**
     * Browser Back closes the sheet rather than leaving the page, which
     * `useOverlayHistory` arranges by pushing an entry while it is open.
     */
    it('closes on browser Back', async () => {
      const { onClose } = renderSheet();
      await waitFor(() => expect(window.history.state).not.toBeNull());
      window.history.back();
      await waitFor(() => expect(onClose).toHaveBeenCalled());
    });

    /**
     * Found as the sheet's first child rather than by `aria-hidden` alone:
     * MUI puts that attribute on other elements inside the drawer too, so an
     * attribute-only query keeps passing after the handle is gone.
     */
    it('shows a grab handle and hides it from assistive technology', () => {
      renderSheet();
      const handle = sheet().firstElementChild as HTMLElement;
      expect(handle).toBeEmptyDOMElement();
      expect(handle).toHaveAttribute('aria-hidden', 'true');
      const style = window.getComputedStyle(handle);
      expect(style.width).toBe('40px');
      expect(style.height).toBe('4px');
    });
  });

  describe('resetting', () => {
    it('is unavailable while nothing is filtered or re-sorted', () => {
      renderSheet();
      expect(resetButton()).toBeDisabled();
    });

    it('becomes available once a filter is set', () => {
      renderSheet({ filters: withFilters({ locationIds: [10] }) });
      expect(resetButton()).toBeEnabled();
    });

    /**
     * A changed sort order counts as something to reset even with no filters --
     * the sheet holds both, so its reset has to clear both.
     */
    it('becomes available on a changed sort order alone', () => {
      renderSheet({ overrides: { sortKey: 'cropAsc' } });
      expect(resetButton()).toBeEnabled();
    });

    it('stays unavailable on the default sort order', () => {
      renderSheet({ overrides: { sortKey: DEFAULT_PLANTING_PLAN_SORT } });
      expect(resetButton()).toBeDisabled();
    });

    it('clears the filters and the sort order together', async () => {
      const user = userEvent.setup();
      const { search } = renderSheet({ filters: withFilters({ locationIds: [10] }) });
      await user.click(resetButton());
      expect(search.resetFilters).toHaveBeenCalledTimes(1);
      expect(search.setSortKey).toHaveBeenCalledExactlyOnceWith(DEFAULT_PLANTING_PLAN_SORT);
    });

    it('does not close the sheet, so the user sees the cleared state', async () => {
      const user = userEvent.setup();
      const { onClose } = renderSheet({ filters: withFilters({ locationIds: [10] }) });
      await user.click(resetButton());
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('the show-results button', () => {
    it('counts the plans currently shown', () => {
      renderSheet({ overrides: { shownCount: 7 } });
      expect(screen.getByRole('button', { name: '7 Anbaupläne anzeigen' })).toBeInTheDocument();
    });

    it('uses the singular for one plan', () => {
      renderSheet({ overrides: { shownCount: 1 } });
      expect(screen.getByRole('button', { name: '1 Anbauplan anzeigen' })).toBeInTheDocument();
    });

    it('still reads correctly for none', () => {
      renderSheet({ overrides: { shownCount: 0 } });
      expect(screen.getByRole('button', { name: '0 Anbaupläne anzeigen' })).toBeInTheDocument();
    });

    /**
     * It only closes. The filters already applied as they were changed, which
     * is why there is no apply/cancel pair and why tapping the backdrop keeps
     * them rather than discarding them.
     */
    it('closes without touching the filters', async () => {
      const user = userEvent.setup();
      const { onClose, search } = renderSheet({
        filters: withFilters({ locationIds: [10] }),
      });
      await user.click(showResultsButton());
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(search.setFilters).not.toHaveBeenCalled();
      expect(search.resetFilters).not.toHaveBeenCalled();
      expect(search.setSortKey).not.toHaveBeenCalled();
    });

    /**
     * Pinned to the bottom of the sheet rather than scrolling away with the
     * fields: on a phone the field list is taller than the sheet, so a button
     * inside it would be unreachable without scrolling to the end.
     */
    it('sits in the sheet\'s own bottom row, outside the scrolling area', () => {
      renderSheet();
      const bottomRow = sheet().lastElementChild as HTMLElement;
      expect(bottomRow.contains(showResultsButton())).toBe(true);
      expect(window.getComputedStyle(bottomRow).flexShrink).toBe('0');
    });
  });

  describe('the fields it hosts', () => {
    /** Sort lives in the sheet on mobile; the desktop panel places it elsewhere. */
    it('includes the sort order alongside the filters', () => {
      renderSheet();
      expect(within(sheet()).getByLabelText('Sortierung')).toBeInTheDocument();
    });

    it('offers the filter fields themselves', () => {
      renderSheet();
      expect(within(sheet()).getByLabelText('Standort')).toBeInTheDocument();
    });
  });
});
