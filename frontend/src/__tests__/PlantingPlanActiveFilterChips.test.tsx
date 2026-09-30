import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PlantingPlanActiveFilterChips } from '../components/planting-plans/search/PlantingPlanActiveFilterChips';
import {
  EMPTY_PLANTING_PLAN_FILTERS,
  type PlantingPlanFilterGroup,
  type PlantingPlanFilterOptions,
  type PlantingPlanFilters,
} from '../pages/plantingPlanSearch';
import type { PlantingPlanSearchControls } from '../pages/usePlantingPlanSearch';

const options: PlantingPlanFilterOptions = {
  locations: [
    { value: 10, label: 'Hof' },
    { value: 20, label: 'Garten' },
  ],
  fields: [
    { value: 100, label: 'Parzelle A', locationId: 10 },
    { value: 200, label: 'Parzelle B', locationId: 20 },
  ],
  cultivationTypes: [
    { value: 'direct_sowing', label: 'Direktsaat' },
    { value: 'pre_cultivation', label: 'Pflanzung' },
  ],
  crops: [
    { value: 'Karotte', label: 'Karotte' },
    { value: 'Tomate', label: 'Tomate' },
  ],
};

const activeGroups = (filters: PlantingPlanFilters): PlantingPlanFilterGroup[] => {
  const groups: PlantingPlanFilterGroup[] = [];
  if (filters.locationIds.length) groups.push('location');
  if (filters.fieldIds.length) groups.push('field');
  if (filters.cultivationTypes.length) groups.push('cultivationType');
  if (filters.cropKeys.length) groups.push('crop');
  for (const field of ['plantingDate', 'harvestStartDate', 'harvestEndDate'] as const) {
    const range = filters.monthRanges[field];
    if (range.from !== null || range.to !== null) groups.push(field);
  }
  return groups;
};

const controls = (
  filters: PlantingPlanFilters,
  overrides: Partial<PlantingPlanSearchControls> = {},
): PlantingPlanSearchControls => ({
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
  activeFilterGroups: activeGroups(filters),
  hasSearch: false,
  hasFilters: activeGroups(filters).length > 0,
  isActive: activeGroups(filters).length > 0,
  options,
  matchById: new Map(),
  noteMatchIds: new Set(),
  totalCount: 0,
  shownCount: 0,
  searchOnlyCount: 0,
  ...overrides,
});

const withFilters = (partial: Partial<PlantingPlanFilters> = {}): PlantingPlanFilters => ({
  ...EMPTY_PLANTING_PLAN_FILTERS,
  ...partial,
  monthRanges: { ...EMPTY_PLANTING_PLAN_FILTERS.monthRanges, ...(partial.monthRanges ?? {}) },
});

const renderChips = (
  filters: PlantingPlanFilters,
  { scrollable = false }: { scrollable?: boolean } = {},
) => {
  const search = controls(filters);
  const view = render(<PlantingPlanActiveFilterChips search={search} scrollable={scrollable} />);
  return { ...view, search };
};

/**
 * The removable chips summarising which filters are on. The desktop toolbar
 * wraps them; the mobile sheet keeps them on one scrolling line. Both read
 * the same state, so the chips have to say the same thing either way -- what
 * differs is only how they are laid out and how big the touch targets are.
 */
describe('PlantingPlanActiveFilterChips', () => {
  it('renders nothing at all when no filter is on', () => {
    const { container } = renderChips(withFilters());

    // Not an empty row that still takes vertical space above the grid.
    expect(container).toBeEmptyDOMElement();
  });

  it('names the filter and lists what is selected', () => {
    renderChips(withFilters({ locationIds: [10] }));

    expect(screen.getByText('Standort: Hof')).toBeInTheDocument();
  });

  it('joins several values of one filter', () => {
    // Values within one filter are an OR, so they belong on one chip.
    renderChips(withFilters({ locationIds: [10, 20] }));

    expect(screen.getByText('Standort: Hof, Garten')).toBeInTheDocument();
  });

  it('gives each active filter its own chip', () => {
    renderChips(withFilters({
      locationIds: [10],
      cultivationTypes: ['direct_sowing'],
      cropKeys: ['Tomate'],
    }));

    expect(screen.getByText('Standort: Hof')).toBeInTheDocument();
    expect(screen.getByText('Anbauart: Direktsaat')).toBeInTheDocument();
    expect(screen.getByText('Kultur: Tomate')).toBeInTheDocument();
  });

  it('skips a selected value the options no longer offer', () => {
    // A stale selection can outlive its option, e.g. after the season's
    // plans changed. Printing "undefined" is worse than printing less.
    renderChips(withFilters({ locationIds: [10, 999] }));

    expect(screen.getByText('Standort: Hof')).toBeInTheDocument();
  });

  it('labels a Parzelle by its own name', () => {
    renderChips(withFilters({ fieldIds: [200] }));

    expect(screen.getByText('Parzelle: Parzelle B')).toBeInTheDocument();
  });

  describe('month ranges', () => {
    it('reads as a span when both ends are set', () => {
      renderChips(withFilters({ monthRanges: { plantingDate: { from: 3, to: 5 } } as never }));

      expect(screen.getByText('Pflanzdatum: Mär bis Mai')).toBeInTheDocument();
    });

    it('reads as open-ended when only the start is set', () => {
      // "ab März" and "März bis März" mean different things, so the three
      // forms are three different sentences rather than one with gaps.
      renderChips(withFilters({ monthRanges: { plantingDate: { from: 3, to: null } } as never }));

      expect(screen.getByText('Pflanzdatum: ab Mär')).toBeInTheDocument();
    });

    it('reads as open-started when only the end is set', () => {
      renderChips(withFilters({ monthRanges: { plantingDate: { from: null, to: 5 } } as never }));

      expect(screen.getByText('Pflanzdatum: bis Mai')).toBeInTheDocument();
    });

    it("uses each date filter's own name", () => {
      renderChips(withFilters({
        monthRanges: {
          plantingDate: { from: 1, to: null },
          harvestStartDate: { from: 6, to: null },
          harvestEndDate: { from: 9, to: null },
        } as never,
      }));

      expect(screen.getByText('Pflanzdatum: ab Jan')).toBeInTheDocument();
      expect(screen.getByText('Erntebeginn: ab Jun')).toBeInTheDocument();
      expect(screen.getByText('Ernteende: ab Sep')).toBeInTheDocument();
    });

    it('names a range that wraps across the year end without complaint', () => {
      // From November to February is a legal range by specification.
      renderChips(withFilters({ monthRanges: { plantingDate: { from: 11, to: 2 } } as never }));

      expect(screen.getByText('Pflanzdatum: Nov bis Feb')).toBeInTheDocument();
    });
  });

  describe('removing filters', () => {
    it('clears only the chip that was dismissed', async () => {
      const user = userEvent.setup();
      const { search } = renderChips(withFilters({
        locationIds: [10],
        cropKeys: ['Tomate'],
      }));

      await user.click(screen.getByRole('button', { name: 'Filter Standort entfernen' }));

      expect(search.clearFilterGroup).toHaveBeenCalledWith('location');
      expect(search.clearFilterGroup).toHaveBeenCalledTimes(1);
    });

    it('names each remove button by the filter it drops', () => {
      renderChips(withFilters({ locationIds: [10], cropKeys: ['Tomate'] }));

      // Three identical × buttons would be indistinguishable to a screen
      // reader; each says which filter it removes.
      expect(screen.getByRole('button', { name: 'Filter Standort entfernen' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Filter Kultur entfernen' })).toBeInTheDocument();
    });

    it("names a date chip's remove button after the date filter", () => {
      renderChips(withFilters({ monthRanges: { harvestStartDate: { from: 6, to: null } } as never }));

      expect(
        screen.getByRole('button', { name: 'Filter Erntebeginn entfernen' }),
      ).toBeInTheDocument();
    });

    it('clears a date filter by its own group', async () => {
      const user = userEvent.setup();
      const { search } = renderChips(
        withFilters({ monthRanges: { harvestEndDate: { from: null, to: 9 } } as never }),
      );

      await user.click(screen.getByRole('button', { name: 'Filter Ernteende entfernen' }));

      expect(search.clearFilterGroup).toHaveBeenCalledWith('harvestEndDate');
    });

    it('offers one action that drops them all', async () => {
      const user = userEvent.setup();
      const { search } = renderChips(withFilters({
        locationIds: [10],
        cropKeys: ['Tomate'],
        monthRanges: { plantingDate: { from: 3, to: 5 } } as never,
      }));

      await user.click(screen.getByRole('button', { name: 'Alle zurücksetzen' }));

      expect(search.resetFilters).toHaveBeenCalled();
      expect(search.clearFilterGroup).not.toHaveBeenCalled();
    });
  });

  describe('as a group', () => {
    it('is announced as the active filters', () => {
      renderChips(withFilters({ locationIds: [10] }));

      expect(screen.getByRole('group', { name: 'Aktive Filter' })).toBeInTheDocument();
    });
  });

  describe('on mobile, where the chips scroll instead of wrapping', () => {
    it('keeps them on one line', () => {
      renderChips(withFilters({ locationIds: [10], cropKeys: ['Tomate'] }), { scrollable: true });

      // Wrapping would push the grid down by a row for every filter added;
      // the phone layout scrolls sideways instead.
      const group = screen.getByRole('group', { name: 'Aktive Filter' });
      expect(group).toHaveStyle({ flexWrap: 'nowrap', overflowX: 'auto' });
    });

    it('lets them wrap on desktop, where there is room', () => {
      renderChips(withFilters({ locationIds: [10], cropKeys: ['Tomate'] }));

      const group = screen.getByRole('group', { name: 'Aktive Filter' });
      expect(group).toHaveStyle({ flexWrap: 'wrap', overflowX: 'visible' });
    });

    it('still offers every chip and the reset', () => {
      renderChips(withFilters({ locationIds: [10], cropKeys: ['Tomate'] }), { scrollable: true });

      // The layout differs, the content must not: both views read the same
      // filter state.
      expect(screen.getByText('Standort: Hof')).toBeInTheDocument();
      expect(screen.getByText('Kultur: Tomate')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Alle zurücksetzen' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Filter Standort entfernen' })).toBeInTheDocument();
    });
  });
});
