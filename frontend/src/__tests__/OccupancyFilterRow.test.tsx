import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OccupancyFilterRow } from '../components/gantt/OccupancyFilterRow';
import type { Location } from '../api/api';
import type { OccupancyHierarchyNode } from '../pages/ganttChartUtils';

const locations = [
  { id: 1, name: 'Hof' },
  { id: 2, name: 'Gärtnerei' },
] as Location[];

const fieldNode = (
  id: string,
  fieldId: number,
  name: string,
): OccupancyHierarchyNode =>
  ({
    id,
    parentId: 'loc-1',
    type: 'field',
    name,
    locationId: 1,
    fieldId,
    tasks: [],
    bedCount: 0,
    occupiedBedCount: 0,
  } as unknown as OccupancyHierarchyNode);

const fieldOptions = [fieldNode('field-10', 10, 'Nordfeld'), fieldNode('field-11', 11, 'Südfeld')];

interface RenderOptions {
  searchText?: string;
  locationFilter?: number | 'all';
  fieldFilter?: number | 'all';
  fields?: OccupancyHierarchyNode[];
  onlyOccupiedBeds?: boolean;
  allLocations?: Location[];
}

const renderRow = ({
  searchText = '',
  locationFilter = 'all',
  fieldFilter = 'all',
  fields = fieldOptions,
  onlyOccupiedBeds = false,
  allLocations = locations,
}: RenderOptions = {}) => {
  const handlers = {
    onSearchTextChange: vi.fn(),
    onLocationFilterChange: vi.fn(),
    onFieldFilterChange: vi.fn(),
    onOnlyOccupiedBedsChange: vi.fn(),
  };
  const searchInputRef = createRef<HTMLInputElement>();
  const view = render(
    <OccupancyFilterRow
      searchText={searchText}
      searchInputRef={searchInputRef}
      locations={allLocations}
      fieldOptions={fields}
      locationFilter={locationFilter}
      fieldFilter={fieldFilter}
      onlyOccupiedBeds={onlyOccupiedBeds}
      {...handlers}
    />,
  );
  return { ...view, ...handlers, searchInputRef };
};

const searchField = (): HTMLElement =>
  screen.getByPlaceholderText('Suche nach Kultur, Beet, Parzelle oder Standort…');

/**
 * `Select` here is `TypeaheadSelect`, which renders a combobox rather than a
 * native select, so the two filters are told apart by the option list each one
 * opens.
 */
const locationSelect = (): HTMLElement => screen.getAllByRole('combobox')[0];
const fieldSelect = (): HTMLElement => screen.getAllByRole('combobox')[1];

const pick = async (
  user: ReturnType<typeof userEvent.setup>,
  select: HTMLElement,
  option: string,
): Promise<void> => {
  await user.click(select);
  await user.click(await screen.findByRole('option', { name: option }));
};

/**
 * The bed-occupancy calendar's desktop filter row. `GanttChart.tsx` owns every
 * filter value, and the search input is the shared `GanttSearchField`, so what
 * is left here -- and the only thing this file can get wrong -- is the
 * conversion at the boundary: the two selects carry their ids as strings
 * because MUI needs string option values, and each `onChange` has to turn that
 * back into a number or the sentinel `'all'` before the page sees it. A filter
 * handed `"10"` where it expects `10` matches nothing and the calendar silently
 * empties.
 *
 * Two mutations stand, and both are the same redundancy on the display side:
 * dropping the `String(...)` around the current value. MUI matches a numeric
 * `value` to its string option anyway -- `value={2}` against an option of `"2"`
 * still renders that option's label -- so the conversion is the honest,
 * type-matching form rather than something the rendered output depends on. The
 * conversions that do matter are the ones in the two `onChange` handlers, and
 * every one of those is caught.
 */
describe('OccupancyFilterRow', () => {
  describe('the search field', () => {
    it('shows the current search text', () => {
      renderRow({ searchText: 'Karotte' });
      expect(searchField()).toHaveValue('Karotte');
    });

    it('reports what the user types', () => {
      const { onSearchTextChange } = renderRow();
      fireEvent.change(searchField(), { target: { value: 'Beet A' } });
      expect(onSearchTextChange).toHaveBeenCalledExactlyOnceWith('Beet A');
    });

    it('reports an emptied search rather than swallowing it', () => {
      const { onSearchTextChange } = renderRow({ searchText: 'Karotte' });
      fireEvent.change(searchField(), { target: { value: '' } });
      expect(onSearchTextChange).toHaveBeenCalledExactlyOnceWith('');
    });

    /** The page focuses this input from a keyboard shortcut. */
    it('hands the input back through the caller\'s ref', () => {
      const { searchInputRef } = renderRow();
      expect(searchInputRef.current).toBe(searchField());
    });
  });

  describe('the location filter', () => {
    it('lists the locations behind an "all" entry', async () => {
      const user = userEvent.setup();
      renderRow();
      await user.click(locationSelect());
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Alle Standorte',
        'Hof',
        'Gärtnerei',
      ]);
    });

    /**
     * An unsaved location has no id yet, and an option with an empty value
     * would clear the filter instead of setting it.
     */
    it('leaves out a location that has no id yet', async () => {
      const user = userEvent.setup();
      renderRow({
        allLocations: [...locations, { name: 'Neuer Standort' } as Location],
      });
      await user.click(locationSelect());
      expect(screen.queryByRole('option', { name: 'Neuer Standort' })).not.toBeInTheDocument();
      expect(screen.getAllByRole('option')).toHaveLength(3);
    });

    it('reports the picked location as a number', async () => {
      const user = userEvent.setup();
      const { onLocationFilterChange } = renderRow();
      await pick(user, locationSelect(), 'Gärtnerei');
      expect(onLocationFilterChange).toHaveBeenCalledExactlyOnceWith(2);
    });

    it('reports the sentinel rather than a number for "all"', async () => {
      const user = userEvent.setup();
      const { onLocationFilterChange } = renderRow({ locationFilter: 1 });
      await pick(user, locationSelect(), 'Alle Standorte');
      expect(onLocationFilterChange).toHaveBeenCalledExactlyOnceWith('all');
    });

    it('shows the location already filtered on', () => {
      renderRow({ locationFilter: 2 });
      expect(locationSelect()).toHaveTextContent('Gärtnerei');
    });

    it('shows "all" when nothing is filtered', () => {
      renderRow({ locationFilter: 'all' });
      expect(locationSelect()).toHaveTextContent('Alle Standorte');
    });
  });

  describe('the field filter', () => {
    /** Fields belong to a location, so there is nothing to choose from yet. */
    it('is disabled while no location is picked', () => {
      renderRow({ locationFilter: 'all' });
      expect(fieldSelect()).toHaveAttribute('aria-disabled', 'true');
    });

    it('becomes available once a location is picked', () => {
      renderRow({ locationFilter: 1 });
      expect(fieldSelect()).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('lists the fields of that location behind an "all" entry', async () => {
      const user = userEvent.setup();
      renderRow({ locationFilter: 1 });
      await user.click(fieldSelect());
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Alle Parzellen',
        'Nordfeld',
        'Südfeld',
      ]);
    });

    /**
     * A field node's `id` is the tree key (`field-10`) while `fieldId` is the
     * database id the filter needs -- picking the wrong one yields `NaN` and
     * empties the calendar.
     */
    it('reports the field id, not the tree node id', async () => {
      const user = userEvent.setup();
      const { onFieldFilterChange } = renderRow({ locationFilter: 1 });
      await pick(user, fieldSelect(), 'Südfeld');
      expect(onFieldFilterChange).toHaveBeenCalledExactlyOnceWith(11);
    });

    it('reports the sentinel rather than a number for "all"', async () => {
      const user = userEvent.setup();
      const { onFieldFilterChange } = renderRow({ locationFilter: 1, fieldFilter: 10 });
      await pick(user, fieldSelect(), 'Alle Parzellen');
      expect(onFieldFilterChange).toHaveBeenCalledExactlyOnceWith('all');
    });

    it('shows the field already filtered on', () => {
      renderRow({ locationFilter: 1, fieldFilter: 10 });
      expect(fieldSelect()).toHaveTextContent('Nordfeld');
    });

    it('offers only "all" when the location has no fields', async () => {
      const user = userEvent.setup();
      renderRow({ locationFilter: 1, fields: [] });
      await user.click(fieldSelect());
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Alle Parzellen']);
    });
  });

  describe('the only-occupied-beds switch', () => {
    it('reflects the current setting', () => {
      renderRow({ onlyOccupiedBeds: true });
      expect(screen.getByRole('checkbox', { name: 'Nur belegte Beete' })).toBeChecked();
    });

    it('starts unchecked when the page says so', () => {
      renderRow({ onlyOccupiedBeds: false });
      expect(screen.getByRole('checkbox', { name: 'Nur belegte Beete' })).not.toBeChecked();
    });

    it('reports being switched on', async () => {
      const user = userEvent.setup();
      const { onOnlyOccupiedBedsChange } = renderRow({ onlyOccupiedBeds: false });
      await user.click(screen.getByRole('checkbox', { name: 'Nur belegte Beete' }));
      expect(onOnlyOccupiedBedsChange).toHaveBeenCalledExactlyOnceWith(true);
    });

    it('reports being switched off', async () => {
      const user = userEvent.setup();
      const { onOnlyOccupiedBedsChange } = renderRow({ onlyOccupiedBeds: true });
      await user.click(screen.getByRole('checkbox', { name: 'Nur belegte Beete' }));
      expect(onOnlyOccupiedBedsChange).toHaveBeenCalledExactlyOnceWith(false);
    });

    it('is reachable by its visible label', async () => {
      const user = userEvent.setup();
      const { onOnlyOccupiedBedsChange } = renderRow();
      await user.click(screen.getByText('Nur belegte Beete'));
      expect(onOnlyOccupiedBedsChange).toHaveBeenCalledExactlyOnceWith(true);
    });
  });

  describe('keeping the filters apart', () => {
    it('changes only the location when a location is picked', async () => {
      const user = userEvent.setup();
      const { onFieldFilterChange, onSearchTextChange, onOnlyOccupiedBedsChange } = renderRow();
      await pick(user, locationSelect(), 'Hof');
      expect(onFieldFilterChange).not.toHaveBeenCalled();
      expect(onSearchTextChange).not.toHaveBeenCalled();
      expect(onOnlyOccupiedBedsChange).not.toHaveBeenCalled();
    });

    it('changes only the field when a field is picked', async () => {
      const user = userEvent.setup();
      const { onLocationFilterChange, onSearchTextChange } = renderRow({ locationFilter: 1 });
      await pick(user, fieldSelect(), 'Nordfeld');
      expect(onLocationFilterChange).not.toHaveBeenCalled();
      expect(onSearchTextChange).not.toHaveBeenCalled();
    });
  });
});
