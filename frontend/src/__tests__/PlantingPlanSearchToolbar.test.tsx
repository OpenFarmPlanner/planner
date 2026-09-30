import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PlantingPlanSearchToolbar } from '../components/planting-plans/search/PlantingPlanSearchToolbar';
import { PlantingPlanSearchCount } from '../components/planting-plans/search/PlantingPlanSearchCount';
import {
  EMPTY_PLANTING_PLAN_FILTERS,
  type PlantingPlanFilterGroup,
  type PlantingPlanFilterOptions,
  type PlantingPlanFilters,
} from '../pages/plantingPlanSearch';
import type { PlantingPlanSearchControls } from '../pages/usePlantingPlanSearch';

const options: PlantingPlanFilterOptions = {
  locations: [{ value: 10, label: 'Hof' }],
  fields: [{ value: 100, label: 'Parzelle A', locationId: 10 }],
  cultivationTypes: [{ value: 'direct_sowing', label: 'Direktsaat' }],
  crops: [{ value: 'Karotte', label: 'Karotte' }],
};

const withFilters = (partial: Partial<PlantingPlanFilters> = {}): PlantingPlanFilters => ({
  ...EMPTY_PLANTING_PLAN_FILTERS,
  ...partial,
  monthRanges: { ...EMPTY_PLANTING_PLAN_FILTERS.monthRanges, ...(partial.monthRanges ?? {}) },
});

const controls = (overrides: Partial<PlantingPlanSearchControls> = {}): PlantingPlanSearchControls => {
  const filters = overrides.filters ?? withFilters();
  const activeFilterGroups = overrides.activeFilterGroups
    ?? (filters.locationIds.length ? (['location'] as PlantingPlanFilterGroup[]) : []);
  return {
    query: '',
    setQuery: vi.fn(),
    clearSearch: vi.fn(),
    terms: [],
    filters,
    setFilters: vi.fn(),
    setLocationIds: vi.fn(),
    clearFilterGroup: vi.fn(),
    resetFilters: vi.fn(),
    sortKey: 'plantingDateAsc',
    setSortKey: vi.fn(),
    activeFilterGroups,
    hasSearch: false,
    hasFilters: activeFilterGroups.length > 0,
    isActive: activeFilterGroups.length > 0,
    options,
    matchById: new Map(),
    noteMatchIds: new Set(),
    totalCount: 12,
    shownCount: 12,
    searchOnlyCount: 12,
    ...overrides,
  };
};

const renderToolbar = (
  searchOverrides: Partial<PlantingPlanSearchControls> = {},
  { isFilterPanelOpen = false }: { isFilterPanelOpen?: boolean } = {},
) => {
  const search = controls(searchOverrides);
  const onFilterPanelOpenChange = vi.fn();
  const filterButtonRef = createRef<HTMLButtonElement>();
  const view = render(
    <PlantingPlanSearchToolbar
      search={search}
      searchInputRef={createRef<HTMLInputElement>()}
      filterButtonRef={filterButtonRef}
      isFilterPanelOpen={isFilterPanelOpen}
      onFilterPanelOpenChange={onFilterPanelOpenChange}
    />,
  );
  return { ...view, search, onFilterPanelOpenChange };
};

const filterButton = () => screen.getByRole('button', { name: /^Filter/ });

/**
 * The same button while the panel is open. MUI's popover is modal and marks
 * the rest of the document aria-hidden, so the toolbar leaves the
 * accessibility tree and has to be queried through it.
 */
const filterButtonBehindPanel = () =>
  screen.getByRole('button', { name: /^Filter/, hidden: true });

/**
 * The desktop search bar above the grid, inside its card -- never in the
 * topbar, which is reserved for a later app-wide search (docs/search.md).
 * It composes the search field, the filter popover, the chips and the hit
 * count; what is covered here is the composition and the popover, since the
 * parts have their own suites.
 */
describe('PlantingPlanSearchToolbar', () => {
  it('offers the search field and the filter button', () => {
    renderToolbar();

    expect(screen.getByRole('searchbox', { name: 'Anbaupläne durchsuchen' })).toBeInTheDocument();
    expect(filterButton()).toBeInTheDocument();
  });

  it('passes typing straight through to the search state', async () => {
    const user = userEvent.setup();
    const { search } = renderToolbar();

    await user.type(screen.getByRole('searchbox', { name: 'Anbaupläne durchsuchen' }), 'k');

    expect(search.setQuery).toHaveBeenCalledWith('k');
  });

  it("clears through the state's own instant path", async () => {
    const user = userEvent.setup();
    const { search } = renderToolbar({ query: 'karotte' });

    await user.click(screen.getByRole('button', { name: 'Suche löschen' }));

    // Not `setQuery('')`, which would go through the debounce.
    expect(search.clearSearch).toHaveBeenCalled();
    expect(search.setQuery).not.toHaveBeenCalled();
  });

  describe('the filter button', () => {
    it('announces that it opens a dialog, and that it is shut', () => {
      renderToolbar();

      expect(filterButton()).toHaveAttribute('aria-haspopup', 'dialog');
      expect(filterButton()).toHaveAttribute('aria-expanded', 'false');
    });

    it('reports the panel as open', () => {
      renderToolbar({}, { isFilterPanelOpen: true });

      expect(filterButtonBehindPanel()).toHaveAttribute('aria-expanded', 'true');
    });

    it('points at the panel only while it is open', () => {
      const { unmount } = renderToolbar();
      expect(filterButton()).not.toHaveAttribute('aria-controls');
      unmount();

      // A reference to a panel that is not rendered is a dangling one.
      renderToolbar({}, { isFilterPanelOpen: true });
      const panelId = screen.getByRole('dialog').getAttribute('id');
      expect(filterButtonBehindPanel()).toHaveAttribute('aria-controls', panelId);
    });

    it('asks to open when shut and to close when open', async () => {
      const user = userEvent.setup();
      const { onFilterPanelOpenChange } = renderToolbar();

      await user.click(filterButton());

      expect(onFilterPanelOpenChange).toHaveBeenCalledWith(true);
    });

    it('toggles back from an open panel', () => {
      const { onFilterPanelOpenChange } = renderToolbar({}, { isFilterPanelOpen: true });

      // Clicked rather than typed: userEvent refuses to reach a control the
      // modal has hidden, which is the browser's behaviour, not a bug here.
      filterButtonBehindPanel().click();

      expect(onFilterPanelOpenChange).toHaveBeenCalledWith(false);
    });

    it('says how many filters are on, for a reader who cannot see the badge', () => {
      renderToolbar({
        filters: withFilters({ locationIds: [10], cropKeys: ['Karotte'] }),
        activeFilterGroups: ['location', 'crop'],
      });

      // The count is a visual badge; the label is the only way to hear it.
      expect(
        screen.getByRole('button', { name: 'Filter, 2 Filter aktiv' }),
      ).toBeInTheDocument();
    });

    it('is named plainly when no filter is on', () => {
      renderToolbar();

      expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument();
    });
  });

  describe('the chips row', () => {
    it('stays away while no filter is on', () => {
      renderToolbar();

      expect(screen.queryByRole('group', { name: 'Aktive Filter' })).not.toBeInTheDocument();
    });

    it('appears with the active filters', () => {
      renderToolbar({
        filters: withFilters({ locationIds: [10] }),
        activeFilterGroups: ['location'],
      });

      expect(screen.getByText('Standort: Hof')).toBeInTheDocument();
    });
  });

  describe('the filter panel', () => {
    it('stays closed until asked', () => {
      renderToolbar();

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('opens as a dialog named by its own heading', () => {
      renderToolbar({}, { isFilterPanelOpen: true });

      expect(screen.getByRole('dialog')).toHaveAccessibleName('Filter');
    });

    it('holds every filter field', () => {
      renderToolbar({}, { isFilterPanelOpen: true });

      const panel = screen.getByRole('dialog');
      ['Standort', 'Parzelle', 'Anbauart', 'Kultur', 'Pflanzzeitraum'].forEach((label) => {
        expect(within(panel).getByRole('group', { name: label })).toBeInTheDocument();
      });
    });

    it('leaves the sort order out, since the grid sorts by column', () => {
      renderToolbar({}, { isFilterPanelOpen: true });

      expect(within(screen.getByRole('dialog')).queryByText('Sortierung')).not.toBeInTheDocument();
    });

    it('says how many plans the current filters leave', () => {
      renderToolbar({ shownCount: 3, totalCount: 12 }, { isFilterPanelOpen: true });

      // Feedback while choosing, so the effect of a chip is visible without
      // closing the panel.
      expect(within(screen.getByRole('dialog')).getByText('3 Treffer')).toBeInTheDocument();
    });

    it('offers a reset that is dead while nothing is filtered', () => {
      renderToolbar({}, { isFilterPanelOpen: true });

      expect(
        within(screen.getByRole('dialog')).getByRole('button', { name: 'Zurücksetzen' }),
      ).toBeDisabled();
    });

    it('enables the reset once something is filtered', async () => {
      const user = userEvent.setup();
      const { search } = renderToolbar(
        { filters: withFilters({ locationIds: [10] }), activeFilterGroups: ['location'] },
        { isFilterPanelOpen: true },
      );

      const reset = within(screen.getByRole('dialog')).getByRole('button', { name: 'Zurücksetzen' });
      expect(reset).toBeEnabled();
      await user.click(reset);

      expect(search.resetFilters).toHaveBeenCalled();
    });
  });
});

/**
 * The hit count beside the search field. It is the only feedback that a
 * search is doing something when the result happens to look like the
 * unfiltered list, so it is announced politely rather than silently updated.
 */
describe('PlantingPlanSearchCount', () => {
  const renderCount = (
    overrides: Partial<PlantingPlanSearchControls>,
    variant: 'desktop' | 'mobile' = 'desktop',
  ) => render(<PlantingPlanSearchCount search={controls(overrides)} variant={variant} />);

  it("counts the season's plans while nothing is searched", () => {
    renderCount({ totalCount: 12 });

    expect(screen.getByRole('status')).toHaveTextContent('12 Anbaupläne');
  });

  it('uses the singular for one plan', () => {
    renderCount({ totalCount: 1 });

    expect(screen.getByRole('status')).toHaveTextContent('1 Anbauplan');
  });

  it('reports shown out of total once something is active', () => {
    renderCount({
      totalCount: 12,
      shownCount: 3,
      filters: withFilters({ locationIds: [10] }),
      activeFilterGroups: ['location'],
    });

    // Without the total, "3" gives no sense of how much is hidden.
    expect(screen.getByRole('status')).toHaveTextContent('3 von 12 Anbauplänen');
  });

  it('shortens the same figure where there is less room', () => {
    renderCount(
      {
        totalCount: 12,
        shownCount: 3,
        filters: withFilters({ locationIds: [10] }),
        activeFilterGroups: ['location'],
      },
      'mobile',
    );

    expect(screen.getByRole('status')).toHaveTextContent('3 von 12');
  });

  it('is announced politely, so it does not interrupt typing', () => {
    renderCount({ totalCount: 12 });

    // The count changes on every keystroke; an assertive region would talk
    // over the user.
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  });
});
