import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PlantingPlanFilterFields } from '../components/planting-plans/search/PlantingPlanFilterFields';
import {
  EMPTY_PLANTING_PLAN_FILTERS,
  type PlantingPlanFilterOptions,
  type PlantingPlanFilters,
} from '../pages/plantingPlanSearch';
import type { PlantingPlanSearchControls } from '../pages/usePlantingPlanSearch';

const fullOptions: PlantingPlanFilterOptions = {
  locations: [
    { value: 20, label: 'Garten' },
    { value: 10, label: 'Hof' },
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

const emptyOptions: PlantingPlanFilterOptions = {
  locations: [],
  fields: [],
  cultivationTypes: [],
  crops: [],
};

const withFilters = (partial: Partial<PlantingPlanFilters> = {}): PlantingPlanFilters => ({
  ...EMPTY_PLANTING_PLAN_FILTERS,
  ...partial,
  monthRanges: { ...EMPTY_PLANTING_PLAN_FILTERS.monthRanges, ...(partial.monthRanges ?? {}) },
});

const controls = (
  filters: PlantingPlanFilters,
  options: PlantingPlanFilterOptions = fullOptions,
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
  activeFilterGroups: [],
  hasSearch: false,
  hasFilters: false,
  isActive: false,
  options,
  matchById: new Map(),
  noteMatchIds: new Set(),
  totalCount: 0,
  shownCount: 0,
  searchOnlyCount: 0,
});

const renderFields = (
  filters: PlantingPlanFilters = withFilters(),
  {
    showSort = false,
    options = fullOptions,
  }: { showSort?: boolean; options?: PlantingPlanFilterOptions } = {},
) => {
  const search = controls(filters, options);
  const view = render(<PlantingPlanFilterFields search={search} showSort={showSort} />);
  return { ...view, search };
};

const group = (name: string): HTMLElement => screen.getByRole('group', { name });
const chip = (groupName: string, label: string): HTMLElement =>
  within(group(groupName)).getByRole('button', { name: label });

/**
 * Every filter field of the planting-plan search, shared by the desktop
 * filter popover and the mobile bottom sheet. The two differ in one thing
 * only -- the sheet also offers a sort order, because the desktop grid sorts
 * by column header instead -- so that difference is covered explicitly and
 * everything else is asserted to be identical.
 *
 * Filters apply immediately; there is no apply button to press.
 */
describe('PlantingPlanFilterFields', () => {
  describe('the fields it offers', () => {
    it('offers all four multi-selects and all three date ranges', () => {
      renderFields();

      ['Standort', 'Parzelle', 'Anbauart', 'Kultur'].forEach((label) => {
        expect(group(label)).toBeInTheDocument();
      });
      ['Pflanzzeitraum', 'Erntebeginn', 'Ernteende'].forEach((label) => {
        expect(group(label)).toBeInTheDocument();
      });
    });

    it('labels each group so its chips are announced under it', () => {
      renderFields();

      // Four chip rows of place names are only distinguishable by the
      // heading they sit under.
      expect(within(group('Standort')).getByRole('button', { name: 'Hof' })).toBeInTheDocument();
      expect(within(group('Kultur')).getByRole('button', { name: 'Karotte' })).toBeInTheDocument();
    });
  });

  describe('the sort order', () => {
    it('is left out where the grid sorts by column header', () => {
      renderFields();

      expect(screen.queryByText('Sortierung')).not.toBeInTheDocument();
    });

    it('is offered where there are no column headers to click', () => {
      // The mobile card list has no header row, so the sheet is the only
      // place a sort order can be chosen.
      renderFields(withFilters(), { showSort: true });

      expect(screen.getByText('Sortierung')).toBeInTheDocument();
    });

    it('offers every sort option', async () => {
      const user = userEvent.setup();
      renderFields(withFilters(), { showSort: true });

      await user.click(screen.getByRole('combobox', { name: 'Sortierung' }));

      [
        'Pflanzdatum, aufsteigend',
        'Pflanzdatum, absteigend',
        'Kultur, A bis Z',
        'Erntebeginn, aufsteigend',
      ].forEach((label) => {
        expect(screen.getByRole('option', { name: label })).toBeInTheDocument();
      });
    });

    it('reports the chosen order', async () => {
      const user = userEvent.setup();
      const { search } = renderFields(withFilters(), { showSort: true });

      await user.click(screen.getByRole('combobox', { name: 'Sortierung' }));
      await user.click(screen.getByRole('option', { name: 'Kultur, A bis Z' }));

      expect(search.setSortKey).toHaveBeenCalledWith('cropAsc');
    });
  });

  describe('toggling a chip', () => {
    it('adds a value to the selection', async () => {
      const user = userEvent.setup();
      const { search } = renderFields();

      await user.click(chip('Kultur', 'Tomate'));

      expect(search.setFilters).toHaveBeenCalledWith(
        expect.objectContaining({ cropKeys: ['Tomate'] }),
      );
    });

    it('keeps what was already selected', async () => {
      // Values within one filter are an OR, so a second pick widens the
      // selection instead of replacing it.
      const user = userEvent.setup();
      const { search } = renderFields(withFilters({ cropKeys: ['Karotte'] }));

      await user.click(chip('Kultur', 'Tomate'));

      expect(search.setFilters).toHaveBeenCalledWith(
        expect.objectContaining({ cropKeys: ['Karotte', 'Tomate'] }),
      );
    });

    it('removes a value that was already selected', async () => {
      const user = userEvent.setup();
      const { search } = renderFields(withFilters({ cropKeys: ['Karotte', 'Tomate'] }));

      await user.click(chip('Kultur', 'Karotte'));

      expect(search.setFilters).toHaveBeenCalledWith(
        expect.objectContaining({ cropKeys: ['Tomate'] }),
      );
    });

    it('leaves the other filters untouched', async () => {
      const user = userEvent.setup();
      const { search } = renderFields(withFilters({
        cultivationTypes: ['direct_sowing'],
        fieldIds: [100],
      }));

      await user.click(chip('Kultur', 'Tomate'));

      expect(search.setFilters).toHaveBeenCalledWith(
        expect.objectContaining({
          cropKeys: ['Tomate'],
          cultivationTypes: ['direct_sowing'],
          fieldIds: [100],
        }),
      );
    });

    it('shows which chips are on', () => {
      renderFields(withFilters({ cropKeys: ['Tomate'] }));

      // aria-pressed is what tells a screen reader the difference; the
      // filled variant is only the visual half of it.
      expect(chip('Kultur', 'Karotte')).toHaveAttribute('aria-pressed', 'false');
      expect(chip('Kultur', 'Tomate')).toHaveAttribute('aria-pressed', 'true');
    });
  });

  describe('Standort and Parzelle', () => {
    it('reports a Standort change through the handler that prunes Parzellen', async () => {
      const user = userEvent.setup();
      const { search } = renderFields(withFilters({ fieldIds: [200] }));

      await user.click(chip('Standort', 'Hof'));

      // Not `setFilters`: deselecting a Standort has to drop its Parzellen
      // from the selection, which only `setLocationIds` does.
      expect(search.setLocationIds).toHaveBeenCalledWith([10]);
      expect(search.setFilters).not.toHaveBeenCalled();
    });

    it('sets Parzellen directly, since they prune nothing', async () => {
      const user = userEvent.setup();
      const { search } = renderFields();

      await user.click(chip('Parzelle', 'Parzelle A'));

      expect(search.setFilters).toHaveBeenCalledWith(
        expect.objectContaining({ fieldIds: [100] }),
      );
      expect(search.setLocationIds).not.toHaveBeenCalled();
    });

    it('suggests picking a Standort first while none is picked', () => {
      renderFields();

      expect(
        screen.getByText('Tipp: Wähle zuerst einen Standort, dann siehst du nur dessen Parzellen.'),
      ).toBeInTheDocument();
    });

    it('drops the hint once a Standort is picked', () => {
      // The advice has been taken; repeating it is noise.
      renderFields(withFilters({ locationIds: [10] }));

      expect(
        screen.queryByText('Tipp: Wähle zuerst einen Standort, dann siehst du nur dessen Parzellen.'),
      ).not.toBeInTheDocument();
    });
  });

  describe('when a filter has nothing to offer', () => {
    it('marks the empty row without announcing it', () => {
      renderFields(withFilters(), { options: emptyOptions });

      // A dash keeps the row from collapsing, but it is decoration: a screen
      // reader should hear the group label and nothing else.
      const placeholders = screen.getAllByText('—');
      expect(placeholders).toHaveLength(4);
      placeholders.forEach((placeholder) => {
        expect(placeholder).toHaveAttribute('aria-hidden', 'true');
      });
    });

    it('still offers the date ranges, which never run out of months', () => {
      renderFields(withFilters(), { options: emptyOptions });

      expect(group('Pflanzzeitraum')).toBeInTheDocument();
      expect(within(group('Pflanzzeitraum')).getAllByRole('combobox')).toHaveLength(2);
    });
  });

  describe('month ranges', () => {
    it('starts empty on both ends, labelled as such', () => {
      renderFields();

      const [from, to] = within(group('Pflanzzeitraum')).getAllByRole('combobox');
      // Placeholders rather than a default month, so an untouched range
      // cannot silently filter anything out.
      expect(from).toHaveTextContent('Von');
      expect(to).toHaveTextContent('Bis');
    });

    it('shows the months that are set', () => {
      renderFields(withFilters({ monthRanges: { plantingDate: { from: 3, to: 5 } } as never }));

      const [from, to] = within(group('Pflanzzeitraum')).getAllByRole('combobox');
      expect(from).toHaveTextContent('März');
      expect(to).toHaveTextContent('Mai');
    });

    it('sets the start month without touching the end', async () => {
      const user = userEvent.setup();
      const { search } = renderFields(
        withFilters({ monthRanges: { plantingDate: { from: null, to: 5 } } as never }),
      );

      const [from] = within(group('Pflanzzeitraum')).getAllByRole('combobox');
      await user.click(from);
      await user.click(await screen.findByRole('option', { name: 'März' }));

      expect(search.setFilters).toHaveBeenCalledWith(
        expect.objectContaining({
          monthRanges: expect.objectContaining({ plantingDate: { from: 3, to: 5 } }),
        }),
      );
    });

    it('sets the end month without touching the start', async () => {
      const user = userEvent.setup();
      const { search } = renderFields(
        withFilters({ monthRanges: { plantingDate: { from: 3, to: null } } as never }),
      );

      const [, to] = within(group('Pflanzzeitraum')).getAllByRole('combobox');
      await user.click(to);
      await user.click(await screen.findByRole('option', { name: 'Mai' }));

      expect(search.setFilters).toHaveBeenCalledWith(
        expect.objectContaining({
          monthRanges: expect.objectContaining({ plantingDate: { from: 3, to: 5 } }),
        }),
      );
    });

    it('clears one end back to no bound', async () => {
      const user = userEvent.setup();
      const { search } = renderFields(
        withFilters({ monthRanges: { plantingDate: { from: 3, to: 5 } } as never }),
      );

      const [from] = within(group('Pflanzzeitraum')).getAllByRole('combobox');
      await user.click(from);
      // The empty option is what turns a span back into an open-ended range.
      await user.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'Von' }));

      expect(search.setFilters).toHaveBeenCalledWith(
        expect.objectContaining({
          monthRanges: expect.objectContaining({ plantingDate: { from: null, to: 5 } }),
        }),
      );
    });

    it('keeps the three ranges apart', async () => {
      const user = userEvent.setup();
      const { search } = renderFields(
        withFilters({ monthRanges: { plantingDate: { from: 1, to: null } } as never }),
      );

      const [from] = within(group('Erntebeginn')).getAllByRole('combobox');
      await user.click(from);
      await user.click(await screen.findByRole('option', { name: 'Juni' }));

      // Editing the harvest start must not disturb the planting range.
      expect(search.setFilters).toHaveBeenCalledWith(
        expect.objectContaining({
          monthRanges: expect.objectContaining({
            plantingDate: { from: 1, to: null },
            harvestStartDate: { from: 6, to: null },
          }),
        }),
      );
    });

    it('accepts a range that wraps across the year end', async () => {
      const user = userEvent.setup();
      const { search } = renderFields(
        withFilters({ monthRanges: { plantingDate: { from: 11, to: null } } as never }),
      );

      const [, to] = within(group('Pflanzzeitraum')).getAllByRole('combobox');
      await user.click(to);
      await user.click(await screen.findByRole('option', { name: 'Februar' }));

      // November to February is a legal range by specification, so the field
      // must not reorder or reject it.
      expect(search.setFilters).toHaveBeenCalledWith(
        expect.objectContaining({
          monthRanges: expect.objectContaining({ plantingDate: { from: 11, to: 2 } }),
        }),
      );
    });

    it('offers every month on both ends', async () => {
      const user = userEvent.setup();
      renderFields();

      const [from] = within(group('Pflanzzeitraum')).getAllByRole('combobox');
      await user.click(from);

      const listbox = await screen.findByRole('listbox');
      // Twelve months plus the empty option.
      expect(within(listbox).getAllByRole('option')).toHaveLength(13);
      expect(within(listbox).getByRole('option', { name: 'Dezember' })).toBeInTheDocument();
    });
  });
});
