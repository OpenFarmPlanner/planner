import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CROP_FILTERS_STORAGE_KEY,
  LEGACY_CROP_FILTERS_STORAGE_KEY,
} from '../crops/cropDetailFormatters';
import type { PersistedCropFilters } from '../crops/cropDetailFormatters';
import { EMPTY_CROP_FILTERS, usePersistedCropFilters } from '../crops/usePersistedCropFilters';

const setup = (query = '') => {
  const setSearchParams = vi.fn();
  const { result, rerender } = renderHook(
    ({ search }: { search: string }) => usePersistedCropFilters(
      new URLSearchParams(search),
      setSearchParams as never,
    ),
    { initialProps: { search: query } },
  );
  return { result, rerender, setSearchParams };
};

const stored = (): PersistedCropFilters | null => {
  const raw = window.sessionStorage.getItem(CROP_FILTERS_STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
};

const FULL_FILTERS: PersistedCropFilters = {
  searchQuery: 'möhre',
  selectedFamilyFilter: 'Doldenblütler',
  selectedCultivationFilter: 'direct_sowing',
  selectedNutrientFilter: 'low',
  selectedSupplierFilter: '4',
  growthDaysMin: '10',
  growthDaysMax: '90',
  yieldMin: '1',
  yieldMax: '5',
  selectedSowingMonths: [3, 4],
};

beforeEach(() => {
  window.sessionStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usePersistedCropFilters — reading what was stored', () => {
  it('starts with everything cleared when nothing is stored', () => {
    expect(setup().result.current.filters).toEqual(EMPTY_CROP_FILTERS);
  });

  it('restores a full set of stored filters', () => {
    // They live in sessionStorage so they survive navigating into a crop and
    // back out again.
    window.sessionStorage.setItem(CROP_FILTERS_STORAGE_KEY, JSON.stringify(FULL_FILTERS));
    expect(setup().result.current.filters).toEqual(FULL_FILTERS);
  });

  it('adopts filters left under the pre-rename key', () => {
    // A returning user still has the Culture-era key; ignoring it would
    // silently reset filters they had set.
    window.sessionStorage.setItem(LEGACY_CROP_FILTERS_STORAGE_KEY, JSON.stringify(FULL_FILTERS));

    const { result } = setup();

    expect(result.current.filters).toEqual(FULL_FILTERS);
    expect(window.sessionStorage.getItem(LEGACY_CROP_FILTERS_STORAGE_KEY)).toBeNull();
  });

  it('prefers the current key when both are present', () => {
    window.sessionStorage.setItem(CROP_FILTERS_STORAGE_KEY, JSON.stringify({ searchQuery: 'neu' }));
    window.sessionStorage.setItem(LEGACY_CROP_FILTERS_STORAGE_KEY, JSON.stringify({ searchQuery: 'alt' }));

    expect(setup().result.current.filters.searchQuery).toBe('neu');
  });

  it.each([
    ['searchQuery', ''],
    ['selectedFamilyFilter', ''],
    ['selectedCultivationFilter', ''],
    ['selectedNutrientFilter', ''],
    ['growthDaysMin', ''],
    ['growthDaysMax', ''],
    ['yieldMin', ''],
    ['yieldMax', ''],
    ['selectedSupplierFilter', ''],
  ])('defaults a missing %s to an empty string, never undefined', (key, fallback) => {
    // An undefined here would reach a controlled input and flip it to
    // uncontrolled, which React warns about and which loses the value.
    window.sessionStorage.setItem(CROP_FILTERS_STORAGE_KEY, JSON.stringify({}));

    expect(setup().result.current.filters[key as keyof PersistedCropFilters]).toBe(fallback);
  });

  it.each([
    ['missing', {}],
    ['null', { selectedSowingMonths: null }],
    ['a string', { selectedSowingMonths: 'März' }],
    ['an object', { selectedSowingMonths: { 3: true } }],
  ])('falls back to an empty month list when it is %s', (_label, payload) => {
    window.sessionStorage.setItem(CROP_FILTERS_STORAGE_KEY, JSON.stringify(payload));

    expect(setup().result.current.filters.selectedSowingMonths).toEqual([]);
  });

  it('keeps a stored month list', () => {
    window.sessionStorage.setItem(
      CROP_FILTERS_STORAGE_KEY, JSON.stringify({ selectedSowingMonths: [3, 4] }),
    );
    expect(setup().result.current.filters.selectedSowingMonths).toEqual([3, 4]);
  });

  it('recovers from corrupt JSON rather than failing to render the page', () => {
    window.sessionStorage.setItem(CROP_FILTERS_STORAGE_KEY, '{ not json');

    expect(setup().result.current.filters).toEqual(EMPTY_CROP_FILTERS);
  });

  it('clears both spellings when the stored value is corrupt', () => {
    // Note: the `removeWithLegacyKey` call in the catch cannot change this
    // outcome. The read-through has already dropped the legacy key on its way
    // past, and the persist effect overwrites the current one with the fresh
    // filters a moment later. Removing it leaves this file green; it states the
    // intent rather than doing the work.
    window.sessionStorage.setItem(CROP_FILTERS_STORAGE_KEY, '{ not json');
    window.sessionStorage.setItem(LEGACY_CROP_FILTERS_STORAGE_KEY, JSON.stringify(FULL_FILTERS));

    setup();

    expect(window.sessionStorage.getItem(LEGACY_CROP_FILTERS_STORAGE_KEY)).toBeNull();
    expect(stored()).toEqual(EMPTY_CROP_FILTERS);
  });

  it('still honours the query supplier when the stored value is corrupt', () => {
    // The corrupt-payload path builds its own fallback object, so it has to
    // carry the parameter too — otherwise arriving from a supplier's page with
    // a damaged session shows an unfiltered list.
    window.sessionStorage.setItem(CROP_FILTERS_STORAGE_KEY, '{ not json');

    const { result } = setup('?supplierId=7');

    expect(result.current.filters).toEqual({
      ...EMPTY_CROP_FILTERS, selectedSupplierFilter: '7',
    });
  });
});

describe('usePersistedCropFilters — the supplierId query parameter', () => {
  it('preselects the supplier filter on the first render', () => {
    // Arriving from a supplier's page should filter the list straight away,
    // before any effect runs.
    expect(setup('?supplierId=7').result.current.filters.selectedSupplierFilter).toBe('7');
  });

  it('beats a supplier stored from an earlier session', () => {
    window.sessionStorage.setItem(
      CROP_FILTERS_STORAGE_KEY, JSON.stringify({ selectedSupplierFilter: '4' }),
    );
    expect(setup('?supplierId=7').result.current.filters.selectedSupplierFilter).toBe('7');
  });

  it('keeps the stored supplier when the URL names none', () => {
    window.sessionStorage.setItem(
      CROP_FILTERS_STORAGE_KEY, JSON.stringify({ selectedSupplierFilter: '4' }),
    );
    expect(setup().result.current.filters.selectedSupplierFilter).toBe('4');
  });

  it('keeps the rest of the stored filters alongside the query supplier', () => {
    window.sessionStorage.setItem(CROP_FILTERS_STORAGE_KEY, JSON.stringify(FULL_FILTERS));

    const { result } = setup('?supplierId=7');

    expect(result.current.filters).toEqual({ ...FULL_FILTERS, selectedSupplierFilter: '7' });
  });

  it('consumes the parameter so it does not pin the list for the session', () => {
    const { setSearchParams } = setup('?supplierId=7');

    act(() => { vi.advanceTimersByTime(1); });

    const [nextParams, options] = setSearchParams.mock.calls[0];
    expect(nextParams.get('supplierId')).toBeNull();
    expect(options).toEqual({ replace: true });
  });

  it('replaces rather than pushes, so Back does not return to the filtered URL', () => {
    const { setSearchParams } = setup('?supplierId=7');
    act(() => { vi.advanceTimersByTime(1); });
    expect(setSearchParams.mock.calls[0][1]).toEqual({ replace: true });
  });

  it('leaves other query parameters in place', () => {
    const { setSearchParams } = setup('?supplierId=7&view=grid');

    act(() => { vi.advanceTimersByTime(1); });

    expect(setSearchParams.mock.calls[0][0].get('view')).toBe('grid');
  });

  it('touches nothing when the URL carries no supplier', () => {
    const { setSearchParams } = setup('?view=grid');

    act(() => { vi.advanceTimersByTime(1); });

    expect(setSearchParams).not.toHaveBeenCalled();
  });

  it('applies a supplier that only appears after mount', () => {
    const { result, rerender } = setup();

    rerender({ search: '?supplierId=7' });
    act(() => { vi.advanceTimersByTime(1); });

    expect(result.current.filters.selectedSupplierFilter).toBe('7');
  });

  it('leaves the filter object alone when the supplier already matches', () => {
    // Returning the previous object keeps the effect from re-rendering for a
    // value that has not changed.
    const { result } = setup('?supplierId=7');
    const before = result.current.filters;

    act(() => { vi.advanceTimersByTime(1); });

    expect(result.current.filters).toBe(before);
  });

  it('does not act on a parameter that is gone before the timer fires', () => {
    const { rerender, setSearchParams } = setup('?supplierId=7');

    rerender({ search: '' });
    act(() => { vi.advanceTimersByTime(1); });

    expect(setSearchParams).not.toHaveBeenCalled();
  });
});

describe('usePersistedCropFilters — updating and resetting', () => {
  it('changes one filter and leaves the others alone', () => {
    window.sessionStorage.setItem(CROP_FILTERS_STORAGE_KEY, JSON.stringify(FULL_FILTERS));
    const { result } = setup();

    act(() => result.current.updateFilter('searchQuery', 'kohl'));

    expect(result.current.filters).toEqual({ ...FULL_FILTERS, searchQuery: 'kohl' });
  });

  it('updates the month list too', () => {
    const { result } = setup();

    act(() => result.current.updateFilter('selectedSowingMonths', [5]));

    expect(result.current.filters.selectedSowingMonths).toEqual([5]);
  });

  it('clears everything on reset, including a supplier from the URL', () => {
    const { result } = setup('?supplierId=7');

    act(() => result.current.resetFilters());

    expect(result.current.filters).toEqual(EMPTY_CROP_FILTERS);
  });
});

describe('usePersistedCropFilters — writing back to storage', () => {
  it('stores the filters on mount so a later read finds them', () => {
    setup();
    expect(stored()).toEqual(EMPTY_CROP_FILTERS);
  });

  it('stores each change', () => {
    const { result } = setup();

    act(() => result.current.updateFilter('searchQuery', 'kohl'));

    expect(stored()?.searchQuery).toBe('kohl');
  });

  it('stores a reset, so it survives navigating away and back', () => {
    window.sessionStorage.setItem(CROP_FILTERS_STORAGE_KEY, JSON.stringify(FULL_FILTERS));
    const { result } = setup();

    act(() => result.current.resetFilters());

    expect(stored()).toEqual(EMPTY_CROP_FILTERS);
  });

  it('writes only the current key, never the pre-rename one', () => {
    const { result } = setup();

    act(() => result.current.updateFilter('searchQuery', 'kohl'));

    expect(window.sessionStorage.getItem(LEGACY_CROP_FILTERS_STORAGE_KEY)).toBeNull();
  });

  it('stores the supplier the query parameter supplied', () => {
    setup('?supplierId=7');
    expect(stored()?.selectedSupplierFilter).toBe('7');
  });
});
