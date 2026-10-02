import { createRef } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { PlantingPlanMobileSearchBar } from '../components/planting-plans/search/PlantingPlanMobileSearchBar';
import type { PlantingPlanFilters } from '../pages/plantingPlanSearch';
import type { PlantingPlanSearchControls } from '../pages/usePlantingPlanSearch';
import {
  plantingPlanFilters as withFilters,
  plantingPlanSearchControls as controls,
} from './helpers/plantingPlanSearchControls';
import theme from '../theme';

interface RenderOptions {
  filters?: PlantingPlanFilters;
  overrides?: Partial<PlantingPlanSearchControls>;
  isFilterSheetOpen?: boolean;
}

const renderBar = ({
  filters = withFilters(),
  overrides = {},
  isFilterSheetOpen = false,
}: RenderOptions = {}) => {
  const search = controls(filters, overrides);
  const onOpenFilterSheet = vi.fn();
  const searchInputRef = createRef<HTMLInputElement>();
  const view = render(
    <ThemeProvider theme={theme}>
      <PlantingPlanMobileSearchBar
        search={search}
        searchInputRef={searchInputRef}
        isFilterSheetOpen={isFilterSheetOpen}
        onOpenFilterSheet={onOpenFilterSheet}
        filterSheetId="planting-plan-filter-sheet"
      />
    </ThemeProvider>,
  );
  return { ...view, search, onOpenFilterSheet, searchInputRef };
};

const bar = (): HTMLElement => screen.getByTestId('planting-plan-mobile-search');

/** `PageSearchField` renders `type="search"`, so the role is searchbox. */
const searchField = (): HTMLInputElement =>
  screen.getByRole('searchbox', { name: 'Anbaupläne durchsuchen' }) as HTMLInputElement;

/**
 * Found by the attribute that makes it the sheet's trigger rather than by name:
 * once filters are on, the chips line below carries buttons whose labels also
 * begin with "Filter".
 */
const filterButton = (): HTMLElement =>
  bar().querySelector('button[aria-haspopup="dialog"]') as HTMLElement;

const PRIMARY_COLOR = 'rgb(37, 111, 42)';

/**
 * The planting-plan page's mobile search row. `usePlantingPlanSearch` owns the
 * state and has its own suite, `PageSearchField` and
 * `PlantingPlanActiveFilterChips` have theirs, so what is left here is the row's
 * own job: telling the user how many filters are on, through three channels at
 * once -- the button's accessible name, a count badge, and whether the chips
 * line below appears at all -- and wiring the filter sheet up for assistive
 * technology.
 *
 * This is a mobile-only surface; the desktop page has a separate row. Nothing
 * here should be read as applying to both.
 *
 * A mutation battery leaves three breaks standing, all of them redundant code
 * rather than gaps:
 *
 * - The button's own `aria-label`. `AppTooltip` is not `describeChild` here, so
 *   MUI copies the tooltip title onto the child as an `aria-label` when the
 *   child has none -- the name survives either way.
 * - `invisible={!hasFilters}` on the badge. With no filters the count is 0, and
 *   MUI hides a zero badge by itself unless `showZero` is set.
 * - The outer `hasFilters ?` around the chips row.
 *   `PlantingPlanActiveFilterChips` returns `null` when it has no chips, so
 *   rendering it unconditionally shows nothing either.
 */
describe('PlantingPlanMobileSearchBar', () => {
  describe('the search field', () => {
    it('shows the current query', () => {
      renderBar({ overrides: { query: 'Karotte' } });
      expect(searchField()).toHaveValue('Karotte');
    });

    it('reports what the user types', () => {
      const { search } = renderBar();
      fireEvent.change(searchField(), { target: { value: 'Tomate' } });
      expect(search.setQuery).toHaveBeenCalledExactlyOnceWith('Tomate');
    });

    it('carries the short mobile placeholder, not the desktop one', () => {
      renderBar();
      expect(searchField()).toHaveAttribute('placeholder', 'Suchen');
    });

    /**
     * `clearSearch` rather than `setQuery('')`: it skips the debounce, so the
     * list reacts at once instead of a beat later.
     */
    it('clears through the dedicated handler', async () => {
      const user = userEvent.setup();
      const { search } = renderBar({ overrides: { query: 'Karotte' } });
      await user.click(screen.getByRole('button', { name: 'Suche löschen' }));
      expect(search.clearSearch).toHaveBeenCalledTimes(1);
      expect(search.setQuery).not.toHaveBeenCalled();
    });

    /**
     * The `rounded` variant is the full-width pill under the app bar: a large
     * radius and a 44px minimum height, which is also the touch-target floor.
     * The desktop page uses the `toolbar` variant, which has neither.
     */
    it('is the rounded pill, not the desktop toolbar field', () => {
      renderBar();
      const style = window.getComputedStyle(
        searchField().closest('.MuiInputBase-root') as HTMLElement,
      );
      expect(style.minHeight).toBe('44px');
      // `borderRadius: 5` against the theme's 4px shape unit.
      expect(style.borderRadius).toBe('20px');
    });

    /** The page focuses this input from its own shortcut. */
    it('hands the input back through the caller\'s ref', () => {
      const { searchInputRef } = renderBar();
      expect(searchInputRef.current).toBe(searchField());
    });
  });

  describe('with no filters on', () => {
    it('names the filter button plainly', () => {
      renderBar();
      expect(filterButton()).toHaveAccessibleName('Filter');
    });

    it('shows no count badge', () => {
      renderBar();
      expect(filterButton().querySelector('.MuiBadge-badge')).toHaveClass('MuiBadge-invisible');
    });

    it('leaves the chips line out entirely', () => {
      renderBar();
      expect(bar().querySelectorAll('.MuiChip-root')).toHaveLength(0);
      expect(within(bar()).getAllByRole('button')).toHaveLength(1);
    });

    it('leaves the button unhighlighted', () => {
      renderBar();
      const style = window.getComputedStyle(filterButton());
      expect(style.backgroundColor).not.toBe(PRIMARY_COLOR);
      expect(style.borderColor).not.toBe(PRIMARY_COLOR);
    });
  });

  describe('with filters on', () => {
    const oneGroup = () => withFilters({ locationIds: [10] });
    const twoGroups = () => withFilters({ locationIds: [10], cropKeys: ['Karotte'] });

    it('says how many filter groups are active', () => {
      renderBar({ filters: twoGroups() });
      expect(filterButton()).toHaveAccessibleName('Filter, 2 Filter aktiv');
    });

    /** The German bundle uses the same wording for one as for many. */
    it('says so for a single group too', () => {
      renderBar({ filters: oneGroup() });
      expect(filterButton()).toHaveAccessibleName('Filter, 1 Filter aktiv');
    });

    it('counts groups, not individual values', () => {
      renderBar({ filters: withFilters({ locationIds: [10, 20] }) });
      expect(filterButton()).toHaveAccessibleName('Filter, 1 Filter aktiv');
    });

    it('shows the count on a visible badge', () => {
      renderBar({ filters: twoGroups() });
      const badge = filterButton().querySelector('.MuiBadge-badge') as HTMLElement;
      expect(badge).not.toHaveClass('MuiBadge-invisible');
      expect(badge).toHaveTextContent('2');
    });

    it('highlights the button', () => {
      renderBar({ filters: oneGroup() });
      const style = window.getComputedStyle(filterButton());
      expect(style.backgroundColor).toBe(PRIMARY_COLOR);
      expect(style.borderColor).toBe(PRIMARY_COLOR);
    });

    it('shows the chips line below', () => {
      renderBar({ filters: twoGroups() });
      expect(bar().querySelectorAll('.MuiChip-root').length).toBeGreaterThan(0);
    });

    /**
     * On a phone the chips have to scroll sideways rather than wrap onto more
     * and more lines, which would push the plan list down the screen. The same
     * component wraps instead on desktop.
     */
    it('lets the chips scroll sideways rather than wrap', () => {
      renderBar({ filters: twoGroups() });
      const style = window.getComputedStyle(
        screen.getByLabelText('Aktive Filter'),
      );
      expect(style.flexWrap).toBe('nowrap');
      expect(style.overflowX).toBe('auto');
    });

    /**
     * A search on its own is not a filter: it has its own clear button in the
     * field, so neither the badge nor the chips line should react to it.
     */
    it('ignores a search that sets no filter', () => {
      renderBar({ overrides: { query: 'Karotte', hasSearch: true, isActive: true } });
      expect(filterButton()).toHaveAccessibleName('Filter');
      expect(bar().querySelectorAll('.MuiChip-root')).toHaveLength(0);
    });
  });

  describe('opening the filter sheet', () => {
    it('asks the page to open it', async () => {
      const user = userEvent.setup();
      const { onOpenFilterSheet } = renderBar();
      await user.click(filterButton());
      expect(onOpenFilterSheet).toHaveBeenCalledTimes(1);
    });

    it('announces that it opens a dialog', () => {
      renderBar();
      expect(filterButton()).toHaveAttribute('aria-haspopup', 'dialog');
    });

    it('reports the sheet as closed while it is', () => {
      renderBar({ isFilterSheetOpen: false });
      expect(filterButton()).toHaveAttribute('aria-expanded', 'false');
    });

    it('reports the sheet as open while it is', () => {
      renderBar({ isFilterSheetOpen: true });
      expect(filterButton()).toHaveAttribute('aria-expanded', 'true');
    });

    /**
     * `aria-controls` points at an element that only exists while the sheet is
     * mounted, so it is withheld until then rather than dangling at an id
     * nothing answers to.
     */
    it('points at the sheet only while it exists', () => {
      renderBar({ isFilterSheetOpen: true });
      expect(filterButton()).toHaveAttribute('aria-controls', 'planting-plan-filter-sheet');
    });

    it('points at nothing while the sheet is closed', () => {
      renderBar({ isFilterSheetOpen: false });
      expect(filterButton()).not.toHaveAttribute('aria-controls');
    });

    it('still explains itself on hover', async () => {
      const user = userEvent.setup();
      renderBar({ filters: withFilters({ locationIds: [10] }) });
      await user.hover(filterButton());
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Filter, 1 Filter aktiv');
    });
  });

  describe('sticking under the app bar', () => {
    it('stays put while the list scrolls past it', () => {
      renderBar();
      expect(window.getComputedStyle(bar()).position).toBe('sticky');
    });

    /**
     * Below the app bar in the stack, so the bar's own menus still open over
     * this row rather than behind it.
     */
    it('sits just below the app bar in the stacking order', () => {
      renderBar();
      expect(Number(window.getComputedStyle(bar()).zIndex)).toBe(theme.zIndex.appBar - 1);
    });

    /**
     * Opaque, because the list scrolls underneath. jsdom resolves no layout, so
     * the measured `top` offset itself is not assertable here.
     */
    it('is opaque rather than letting the list show through', () => {
      renderBar();
      expect(window.getComputedStyle(bar()).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    });
  });
});
