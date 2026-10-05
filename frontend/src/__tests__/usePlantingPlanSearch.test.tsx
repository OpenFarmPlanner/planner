import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PLANTING_PLAN_SEARCH_DEBOUNCE_MS,
  usePlantingPlanSearch,
} from '../pages/usePlantingPlanSearch';
import {
  EMPTY_PLANTING_PLAN_FILTERS,
  type PlantingPlanFilters,
  type PlantingPlanSearchRecordInput,
} from '../pages/plantingPlanSearch';
import { registerSeasonSwitchState, stashSeasonSwitchState } from '../seasons/seasonSwitchState';

interface Row extends PlantingPlanSearchRecordInput {
  isNew?: boolean;
}

const plan = (overrides: Partial<Row> = {}): Row => ({
  id: 1,
  cropLabel: 'Karotte (Nantaise)',
  cropName: 'Karotte',
  cropSynonyms: [],
  cultivationType: 'direct_sowing',
  cultivationTypeLabel: 'Direktsaat',
  locationId: 10,
  locationName: 'Hof',
  fieldId: 100,
  fieldName: 'Parzelle A',
  bedName: 'Beet 1',
  notesText: '',
  plantingDate: '2026-03-01',
  sowingDate: null,
  harvestDate: '2026-06-01',
  harvestEndDate: '2026-07-01',
  ...overrides,
});

const CARROT = plan({ id: 1 });
const TOMATO = plan({
  id: 2,
  cropLabel: 'Tomate (Matina)',
  cropName: 'Tomate',
  cropSynonyms: ['Paradeiser'],
  cultivationType: 'pre_cultivation',
  cultivationTypeLabel: 'Pflanzung',
  locationId: 20,
  locationName: 'Garten',
  fieldId: 200,
  fieldName: 'Parzelle B',
  bedName: 'Beet 2',
  plantingDate: '2026-04-01',
  harvestDate: '2026-08-01',
  harvestEndDate: '2026-09-01',
});

const toRecordInput = (row: Row): PlantingPlanSearchRecordInput => row;

const setup = (rows: Row[] = [CARROT, TOMATO], projectId: number | null = 1) =>
  renderHook(
    ({ rows: currentRows, projectId: currentProject }: { rows: Row[]; projectId: number | null }) =>
      usePlantingPlanSearch({ rows: currentRows, toRecordInput, projectId: currentProject }),
    { initialProps: { rows, projectId } },
  );

/**
 * Lets queued microtasks and zero-delay timers land without moving the clock.
 *
 * The clock stays frozen on purpose: the debounce tests assert that nothing
 * has been applied one millisecond short of the threshold, and a clock that
 * also advances in real time turns that into a race the test loses on a
 * loaded machine.
 */
const settle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
};

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  window.sessionStorage.clear();
});

/**
 * The one search/filter/sort state the planting-plan page holds; the desktop
 * grid and the mobile card list both read it, so the same input has to yield
 * the same plans in both. `plantingPlanSearch.test.ts` covers the matching
 * rules themselves and `PlantingPlans.search.test.tsx` the page integration;
 * what is covered here is the state machine around them.
 *
 * The binding rules are in docs/search.md.
 *
 * One thing is deliberately left unpinned. The debounce callback reads
 * `previous.query` from the state updater rather than the `query` the effect
 * closed over, which is defensive only: `query` is a dependency of that
 * effect, so a changed query always tears down the pending timer and arms a
 * new one with the current value. No fixture can make the two disagree.
 */
describe('usePlantingPlanSearch', () => {
  describe('the debounce', () => {
    it('shows the typed text at once but waits before filtering on it', async () => {
      const { result } = setup();

      act(() => result.current.setQuery('tomate'));

      // The field has to stay responsive; only the matching waits.
      expect(result.current.query).toBe('tomate');
      expect(result.current.terms).toEqual([]);
      expect(result.current.shownCount).toBe(2);

      await advance(PLANTING_PLAN_SEARCH_DEBOUNCE_MS);

      expect(result.current.terms).toEqual(['tomate']);
      expect(result.current.shownCount).toBe(1);
    });

    it('has not filtered one millisecond short of the threshold', async () => {
      const { result } = setup();

      act(() => result.current.setQuery('tomate'));
      await advance(PLANTING_PLAN_SEARCH_DEBOUNCE_MS - 1);

      expect(result.current.terms).toEqual([]);
      expect(result.current.shownCount).toBe(2);
    });

    it('filters once for a word typed through, not once per keystroke', async () => {
      const { result } = setup();

      for (const partial of ['t', 'to', 'tom', 'toma', 'tomat', 'tomate']) {
        act(() => result.current.setQuery(partial));
        await advance(20);
      }

      // Each keystroke restarts the wait, so nothing has been applied yet.
      expect(result.current.terms).toEqual([]);

      await advance(PLANTING_PLAN_SEARCH_DEBOUNCE_MS);

      // And what lands is the finished word, not a prefix of it.
      expect(result.current.terms).toEqual(['tomate']);
    });

    it('applies the latest text, not the one the timer started with', async () => {
      const { result } = setup();

      act(() => result.current.setQuery('karotte'));
      await advance(100);
      act(() => result.current.setQuery('tomate'));
      await advance(PLANTING_PLAN_SEARCH_DEBOUNCE_MS);

      expect(result.current.terms).toEqual(['tomate']);
      expect(result.current.shownCount).toBe(1);
    });

    it('does not restart the wait when the text is retyped identically', async () => {
      const { result } = setup();

      act(() => result.current.setQuery('tomate'));
      await advance(PLANTING_PLAN_SEARCH_DEBOUNCE_MS);
      expect(result.current.terms).toEqual(['tomate']);

      act(() => result.current.setQuery('tomate'));
      await settle();

      // Already applied, so there is nothing to wait for.
      expect(result.current.terms).toEqual(['tomate']);
    });

    it('drops a pending filter when the hook goes away', () => {
      const { result, unmount } = setup();

      act(() => result.current.setQuery('tomate'));
      expect(vi.getTimerCount()).toBe(1);

      unmount();

      // Checked before advancing, not after: letting the clock run would
      // fire the timer and leave a count of zero either way, so the
      // assertion would hold whether or not the effect cleans up.
      expect(vi.getTimerCount()).toBe(0);
    });

    it('schedules nothing while the text and the filtering agree', async () => {
      const { result } = setup();

      act(() => result.current.setQuery('tomate'));
      await advance(PLANTING_PLAN_SEARCH_DEBOUNCE_MS);
      expect(result.current.terms).toEqual(['tomate']);

      // Nothing is pending once the query has been applied. Without the
      // equality guard the hook would keep arming a timer on every render to
      // re-apply a query that is already in force.
      expect(vi.getTimerCount()).toBe(0);

      act(() => result.current.setQuery('tomate'));

      expect(vi.getTimerCount()).toBe(0);
    });

    it('replaces the pending timer rather than adding to it', () => {
      const { result } = setup();

      act(() => result.current.setQuery('to'));
      act(() => result.current.setQuery('tom'));
      act(() => result.current.setQuery('toma'));

      // One wait at a time, restarted -- three stacked timers would each
      // fire and filter three times for one word.
      expect(vi.getTimerCount()).toBe(1);
    });
  });

  describe('clearing', () => {
    it('clears the text and the filtering in one step, without waiting', async () => {
      const { result } = setup();
      act(() => result.current.setQuery('tomate'));
      await advance(PLANTING_PLAN_SEARCH_DEBOUNCE_MS);

      act(() => result.current.clearSearch());

      // Clearing is instant by specification -- a wait here would leave the
      // list filtered by a query the field no longer shows.
      expect(result.current.query).toBe('');
      expect(result.current.terms).toEqual([]);
      expect(result.current.shownCount).toBe(2);
    });

    it('keeps the filters, which are cleared separately', async () => {
      const { result } = setup();
      act(() => result.current.setFilters({ ...EMPTY_PLANTING_PLAN_FILTERS, locationIds: [10] }));
      act(() => result.current.setQuery('karotte'));
      await advance(PLANTING_PLAN_SEARCH_DEBOUNCE_MS);

      act(() => result.current.clearSearch());

      expect(result.current.hasFilters).toBe(true);
      expect(result.current.filters.locationIds).toEqual([10]);
    });
  });

  describe('counting', () => {
    it('reports the whole season, what is shown, and what the search alone would find', async () => {
      const { result } = setup();

      act(() => result.current.setQuery('e'));
      act(() => result.current.setFilters({ ...EMPTY_PLANTING_PLAN_FILTERS, locationIds: [20] }));
      await advance(PLANTING_PLAN_SEARCH_DEBOUNCE_MS);

      expect(result.current.totalCount).toBe(2);
      expect(result.current.shownCount).toBe(1);
      // The unfiltered figure is what lets the page offer "2 hits are hidden
      // by your filters" instead of an unexplained empty list.
      expect(result.current.searchOnlyCount).toBe(2);
    });

    it('counts a search hit that the filters then hide', async () => {
      const { result } = setup();

      act(() => result.current.setQuery('karotte'));
      act(() => result.current.setFilters({ ...EMPTY_PLANTING_PLAN_FILTERS, locationIds: [20] }));
      await advance(PLANTING_PLAN_SEARCH_DEBOUNCE_MS);

      expect(result.current.shownCount).toBe(0);
      expect(result.current.searchOnlyCount).toBe(1);
    });
  });

  describe('search and filters together', () => {
    it('requires both', async () => {
      const { result } = setup();

      act(() => result.current.setQuery('tomate'));
      act(() => result.current.setFilters({ ...EMPTY_PLANTING_PLAN_FILTERS, locationIds: [10] }));
      await advance(PLANTING_PLAN_SEARCH_DEBOUNCE_MS);

      // Tomate is at location 20, so the two conditions have no overlap.
      expect(result.current.sortedRows).toEqual([]);
    });

    it('reports which plans matched and how', async () => {
      const { result } = setup();

      act(() => result.current.setQuery('paradeiser'));
      await advance(PLANTING_PLAN_SEARCH_DEBOUNCE_MS);

      expect(result.current.sortedRows.map((row) => row.id)).toEqual([2]);
      expect(result.current.matchById.get(2)?.synonym).toBe('Paradeiser');
    });

    it('marks a plan found through its notes', async () => {
      const { result } = setup([plan({ id: 3, notesText: 'Vlies auflegen' })]);

      act(() => result.current.setQuery('vlies'));
      await advance(PLANTING_PLAN_SEARCH_DEBOUNCE_MS);

      // The page gives a notes hit its own affordance, so it has to be told
      // the hit was in the note rather than in a visible column.
      expect([...result.current.noteMatchIds]).toEqual([3]);
    });

    it('leaves the note set empty for a hit in a visible column', async () => {
      const { result } = setup();

      act(() => result.current.setQuery('karotte'));
      await advance(PLANTING_PLAN_SEARCH_DEBOUNCE_MS);

      expect([...result.current.noteMatchIds]).toEqual([]);
    });
  });

  describe('sorting', () => {
    it('defaults to planting date ascending', () => {
      const { result } = setup();

      expect(result.current.sortKey).toBe('plantingDateAsc');
      expect(result.current.sortedRows.map((row) => row.id)).toEqual([1, 2]);
    });

    it('reorders on request', () => {
      const { result } = setup();

      act(() => result.current.setSortKey('plantingDateDesc'));

      expect(result.current.sortedRows.map((row) => row.id)).toEqual([2, 1]);
    });
  });

  describe('unsaved rows', () => {
    const draft = plan({ id: 99, isNew: true, cropLabel: '', cropName: '', plantingDate: null });

    it('are not counted as plans of the season', () => {
      const { result } = setup([CARROT, TOMATO, draft]);

      // The row exists only in the grid's edit state; counting it would
      // report a plan the season does not have.
      expect(result.current.totalCount).toBe(2);
    });

    it('stay visible while a search is active, so the row being added is not hidden', async () => {
      const { result } = setup([CARROT, TOMATO, draft]);

      act(() => result.current.setQuery('tomate'));
      await advance(PLANTING_PLAN_SEARCH_DEBOUNCE_MS);

      expect(result.current.isRowVisible?.(draft)).toBe(true);
      expect(result.current.isRowVisible?.(CARROT)).toBe(false);
    });
  });

  describe('the grid row predicate', () => {
    it('is withheld while nothing is searched or filtered', () => {
      const { result } = setup();

      // `undefined` tells the grid to skip filtering entirely rather than
      // run a predicate that would accept every row.
      expect(result.current.isRowVisible).toBeUndefined();
    });

    it('appears as soon as filters alone are active', () => {
      const { result } = setup();

      act(() => result.current.setFilters({ ...EMPTY_PLANTING_PLAN_FILTERS, locationIds: [10] }));

      expect(result.current.isRowVisible).toBeDefined();
      expect(result.current.isRowVisible?.(CARROT)).toBe(true);
      expect(result.current.isRowVisible?.(TOMATO)).toBe(false);
    });

    it('honours search and filters together', async () => {
      const { result } = setup();

      act(() => result.current.setQuery('karotte'));
      act(() => result.current.setFilters({ ...EMPTY_PLANTING_PLAN_FILTERS, locationIds: [20] }));
      await advance(PLANTING_PLAN_SEARCH_DEBOUNCE_MS);

      expect(result.current.isRowVisible?.(CARROT)).toBe(false);
    });

    it('still answers for a row object it has never seen', async () => {
      const { result } = setup();

      act(() => result.current.setQuery('karotte'));
      await advance(PLANTING_PLAN_SEARCH_DEBOUNCE_MS);

      // The grid asks with its own row objects, which need not be the ones
      // the hook holds; the predicate rebuilds the record rather than
      // treating the row as unknown.
      expect(result.current.isRowVisible?.({ ...CARROT })).toBe(true);
      expect(result.current.isRowVisible?.({ ...TOMATO })).toBe(false);
    });
  });

  describe('active flags', () => {
    it('separates a search from a filter', async () => {
      const { result } = setup();

      act(() => result.current.setQuery('karotte'));
      await advance(PLANTING_PLAN_SEARCH_DEBOUNCE_MS);

      expect(result.current.hasSearch).toBe(true);
      expect(result.current.hasFilters).toBe(false);
      expect(result.current.isActive).toBe(true);
    });

    it('is active with filters and no search', () => {
      const { result } = setup();

      act(() => result.current.setFilters({ ...EMPTY_PLANTING_PLAN_FILTERS, cropKeys: ['Karotte'] }));

      expect(result.current.hasSearch).toBe(false);
      expect(result.current.hasFilters).toBe(true);
      expect(result.current.isActive).toBe(true);
    });

    it('is inactive for whitespace alone', async () => {
      const { result } = setup();

      act(() => result.current.setQuery('   '));
      await advance(PLANTING_PLAN_SEARCH_DEBOUNCE_MS);

      expect(result.current.hasSearch).toBe(false);
      expect(result.current.isActive).toBe(false);
    });

    it('names each active filter group', () => {
      const { result } = setup();

      act(() => result.current.setFilters({
        ...EMPTY_PLANTING_PLAN_FILTERS,
        locationIds: [10],
        cultivationTypes: ['direct_sowing'],
      }));

      expect(result.current.activeFilterGroups).toEqual(['location', 'cultivationType']);
    });
  });

  describe('filter options', () => {
    it("offers only values the season's plans actually have", () => {
      const { result } = setup();

      // A filter that offers a value matching nothing is a dead end, so the
      // options come from the records. They are ordered by label rather than
      // by id, which is the order a reader scans them in: Garten (20) before
      // Hof (10).
      expect(result.current.options.locations.map((option) => option.label)).toEqual(['Garten', 'Hof']);
      expect(result.current.options.crops.map((option) => option.label)).toEqual(['Karotte', 'Tomate']);
      expect(result.current.options.cultivationTypes.map((option) => option.label))
        .toEqual(['Direktsaat', 'Pflanzung']);
    });

    it('narrows the Parzelle options to the selected Standorte', () => {
      const { result } = setup();

      act(() => result.current.setLocationIds([10]));

      expect(result.current.options.fields.map((option) => option.value)).toEqual([100]);
    });

    it('offers every Parzelle again once no Standort is selected', () => {
      const { result } = setup();
      act(() => result.current.setLocationIds([10]));

      act(() => result.current.setLocationIds([]));

      expect(result.current.options.fields.map((option) => option.value)).toEqual([100, 200]);
    });

    it('drops a Parzelle from the selection when its Standort is deselected', () => {
      const { result } = setup();
      act(() => result.current.setLocationIds([10, 20]));
      act(() => result.current.setFilters({
        ...result.current.filters,
        fieldIds: [100, 200],
      }));

      act(() => result.current.setLocationIds([10]));

      // Leaving Parzelle B selected under Standort Hof would filter to
      // nothing, with no visible reason why.
      expect(result.current.filters.fieldIds).toEqual([100]);
    });
  });

  describe('clearing filters', () => {
    const bothGroups: PlantingPlanFilters = {
      ...EMPTY_PLANTING_PLAN_FILTERS,
      locationIds: [10],
      cultivationTypes: ['direct_sowing'],
    };

    it('clears one group and leaves the rest', () => {
      const { result } = setup();
      act(() => result.current.setFilters(bothGroups));

      act(() => result.current.clearFilterGroup('location'));

      expect(result.current.filters.locationIds).toEqual([]);
      expect(result.current.filters.cultivationTypes).toEqual(['direct_sowing']);
    });

    it('resets every group at once', () => {
      const { result } = setup();
      act(() => result.current.setFilters(bothGroups));

      act(() => result.current.resetFilters());

      expect(result.current.hasFilters).toBe(false);
    });

    it('leaves the search alone when the filters are reset', async () => {
      const { result } = setup();
      act(() => result.current.setQuery('karotte'));
      await advance(PLANTING_PLAN_SEARCH_DEBOUNCE_MS);
      act(() => result.current.setFilters(bothGroups));

      act(() => result.current.resetFilters());

      // Two separate controls; the reset button next to the chips must not
      // silently empty the search field as well.
      expect(result.current.query).toBe('karotte');
      expect(result.current.terms).toEqual(['karotte']);
    });
  });

  describe('switching project', () => {
    it('starts over', async () => {
      const { result, rerender } = setup();
      act(() => result.current.setQuery('karotte'));
      act(() => result.current.setFilters({ ...EMPTY_PLANTING_PLAN_FILTERS, locationIds: [10] }));
      await advance(PLANTING_PLAN_SEARCH_DEBOUNCE_MS);

      rerender({ rows: [CARROT, TOMATO], projectId: 2 });

      // Another project's plans have nothing to do with this query, and its
      // location ids mean something else entirely.
      expect(result.current.query).toBe('');
      expect(result.current.hasFilters).toBe(false);
      expect(result.current.sortKey).toBe('plantingDateAsc');
    });
  });

  describe('switching season', () => {
    const stashFor = (projectId: number, snapshot: unknown) => {
      const unregister = registerSeasonSwitchState('plantingPlanSearch', () => snapshot);
      stashSeasonSwitchState(projectId);
      unregister();
    };

    it('restores the search, filters and sort a season switch carried over', () => {
      stashFor(1, {
        query: 'tomate',
        sortKey: 'plantingDateDesc',
        filters: { ...EMPTY_PLANTING_PLAN_FILTERS, locationIds: [20] },
      });

      const { result } = setup();

      // A season switch reloads the app, so without this the search would be
      // silently lost every time the season changes.
      expect(result.current.query).toBe('tomate');
      expect(result.current.sortKey).toBe('plantingDateDesc');
      expect(result.current.filters.locationIds).toEqual([20]);
    });

    it('restores it already applied, not waiting on a debounce', () => {
      stashFor(1, {
        query: 'tomate',
        sortKey: 'plantingDateAsc',
        filters: EMPTY_PLANTING_PLAN_FILTERS,
      });

      const { result } = setup();

      // Otherwise the field would show a query the list is not filtered by.
      expect(result.current.terms).toEqual(['tomate']);
      expect(result.current.shownCount).toBe(1);
    });

    it('restores once, so a later reload starts empty', async () => {
      stashFor(1, {
        query: 'tomate',
        sortKey: 'plantingDateAsc',
        filters: EMPTY_PLANTING_PLAN_FILTERS,
      });
      const first = setup();
      expect(first.result.current.query).toBe('tomate');
      await settle();
      first.unmount();

      const second = setup();

      expect(second.result.current.query).toBe('');
    });

    it('ignores a snapshot stashed for another project', () => {
      stashFor(2, {
        query: 'tomate',
        sortKey: 'plantingDateAsc',
        filters: EMPTY_PLANTING_PLAN_FILTERS,
      });

      const { result } = setup([CARROT, TOMATO], 1);

      expect(result.current.query).toBe('');
    });

    it('starts empty when there is no project yet', () => {
      stashFor(1, {
        query: 'tomate',
        sortKey: 'plantingDateAsc',
        filters: EMPTY_PLANTING_PLAN_FILTERS,
      });

      const { result } = setup([CARROT, TOMATO], null);

      expect(result.current.query).toBe('');
    });
  });

  describe('rejecting a snapshot it cannot trust', () => {
    const stashRaw = (snapshot: unknown) => {
      const unregister = registerSeasonSwitchState('plantingPlanSearch', () => snapshot);
      stashSeasonSwitchState(1);
      unregister();
    };

    const valid = {
      query: 'tomate',
      sortKey: 'plantingDateAsc',
      filters: EMPTY_PLANTING_PLAN_FILTERS,
    };

    const expectIgnored = () => {
      const { result } = setup();
      expect(result.current.query).toBe('');
      expect(result.current.filters).toEqual(EMPTY_PLANTING_PLAN_FILTERS);
    };

    it('rejects an unknown sort key', () => {
      // sessionStorage is writable by anything in the tab and survives a
      // rename of these keys, so a snapshot is untrusted input.
      stashRaw({ ...valid, sortKey: 'byWhatever' });

      expectIgnored();
    });

    it('rejects a query that is not text', () => {
      stashRaw({ ...valid, query: 42 });

      expectIgnored();
    });

    it('rejects location ids that are not numbers', () => {
      stashRaw({ ...valid, filters: { ...EMPTY_PLANTING_PLAN_FILTERS, locationIds: ['10'] } });

      expectIgnored();
    });

    it('rejects cultivation types that are not strings', () => {
      stashRaw({ ...valid, filters: { ...EMPTY_PLANTING_PLAN_FILTERS, cultivationTypes: [3] } });

      expectIgnored();
    });

    it('rejects a month outside the calendar', () => {
      stashRaw({
        ...valid,
        filters: {
          ...EMPTY_PLANTING_PLAN_FILTERS,
          monthRanges: {
            ...EMPTY_PLANTING_PLAN_FILTERS.monthRanges,
            plantingDate: { from: 13, to: null },
          },
        },
      });

      expectIgnored();
    });

    it('rejects month zero', () => {
      stashRaw({
        ...valid,
        filters: {
          ...EMPTY_PLANTING_PLAN_FILTERS,
          monthRanges: {
            ...EMPTY_PLANTING_PLAN_FILTERS.monthRanges,
            plantingDate: { from: 0, to: null },
          },
        },
      });

      expectIgnored();
    });

    it('rejects a fractional month', () => {
      stashRaw({
        ...valid,
        filters: {
          ...EMPTY_PLANTING_PLAN_FILTERS,
          monthRanges: {
            ...EMPTY_PLANTING_PLAN_FILTERS.monthRanges,
            plantingDate: { from: 3.5, to: null },
          },
        },
      });

      expectIgnored();
    });

    it('rejects a month range that is missing entirely', () => {
      stashRaw({ ...valid, filters: { ...EMPTY_PLANTING_PLAN_FILTERS, monthRanges: {} } });

      expectIgnored();
    });

    it('rejects a snapshot that is not an object', () => {
      stashRaw('tomate');

      expectIgnored();
    });

    it('accepts a month range at the edges of the calendar', () => {
      stashRaw({
        ...valid,
        filters: {
          ...EMPTY_PLANTING_PLAN_FILTERS,
          monthRanges: {
            ...EMPTY_PLANTING_PLAN_FILTERS.monthRanges,
            plantingDate: { from: 1, to: 12 },
          },
        },
      });

      const { result } = setup();

      expect(result.current.filters.monthRanges.plantingDate).toEqual({ from: 1, to: 12 });
    });
  });
});
