import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicCrop } from '../../api/types';
import { usePublicCropSuggestions } from '../usePublicCropSuggestions';

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));
vi.mock('../../api/api', () => ({ publicCropAPI: { list: listMock } }));

/** The debounce the search waits out before it asks the library. */
const DEBOUNCE_MS = 250;

const crop = (overrides: Partial<PublicCrop> = {}): PublicCrop => ({
  id: 1,
  name: 'Möhre',
  variety: '',
  crop_species: 7,
  crop_species_canonical_name: 'Möhre',
  crop_species_name: 'Möhre',
  display_name: 'Möhre',
  ...overrides,
} as PublicCrop);

const results = (crops: PublicCrop[]) => ({ data: { results: crops } });

interface Props {
  enabled?: boolean;
  searchTerm?: string;
  nameText?: string | undefined;
}

const setup = (initialProps: Props = {}) => renderHook(
  (props: Props) => usePublicCropSuggestions({
    enabled: props.enabled ?? true,
    searchTerm: props.searchTerm ?? '',
    nameText: props.nameText,
  }),
  { initialProps },
);

/** Runs out the debounce and lets the resulting request settle. */
const settleSearch = async () => {
  await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE_MS); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
};

/**
 * Lets queued microtasks and zero-delay timers land without moving the clock.
 *
 * Several turns, because the variety load is a chain: a microtask raises the
 * loading flag, the request resolves, and its `then` writes the state. One
 * turn settles the first link only.
 */
const settle = async (turns = 4) => {
  for (let index = 0; index < turns; index += 1) {
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  }
};

const searchCalls = () => listMock.mock.calls.filter(([params]) => 'q' in params);
const speciesCalls = () => listMock.mock.calls.filter(([params]) => 'crop_species' in params);

beforeEach(() => {
  vi.clearAllMocks();
  // The clock does not advance on its own. It must not: the debounce tests
  // assert that no request has been made one millisecond short of the
  // threshold, and a clock that also moves in real time makes that a race
  // the test loses on a slow machine. Everything here is stepped explicitly
  // instead, and `settle` stands in for `waitFor`, which cannot poll while
  // the clock is frozen.
  vi.useFakeTimers({ shouldAdvanceTime: false });
  listMock.mockResolvedValue(results([]));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('searching the library', () => {
  it('waits out the debounce before asking', async () => {
    // The Name field searches on every keystroke; asking per character would
    // be a request per letter typed.
    setup({ searchTerm: 'Möh' });

    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1); });
    expect(listMock).not.toHaveBeenCalled();

    await settleSearch();
    expect(searchCalls()[0][0]).toEqual({ q: 'Möh' });
  });

  it('asks once for a term the user typed through', async () => {
    // Each keystroke replaces the pending request rather than adding one.
    const { rerender } = setup({ searchTerm: 'M' });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    rerender({ searchTerm: 'Mö' });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    rerender({ searchTerm: 'Möh' });

    await settleSearch();

    expect(searchCalls()).toHaveLength(1);
    expect(searchCalls()[0][0]).toEqual({ q: 'Möh' });
  });

  it('trims what it sends', async () => {
    setup({ searchTerm: '  Möhre  ' });

    await settleSearch();

    expect(searchCalls()[0][0]).toEqual({ q: 'Möhre' });
  });

  it('does not ask for a term that is only whitespace', async () => {
    setup({ searchTerm: '   ' });

    await settleSearch();

    expect(listMock).not.toHaveBeenCalled();
  });

  it('does not ask at all while disabled', async () => {
    // The library's own crop form does not suggest library entries to itself.
    setup({ enabled: false, searchTerm: 'Möhre' });

    await settleSearch();

    expect(listMock).not.toHaveBeenCalled();
  });

  it('reports loading from the keystroke, not from the request', async () => {
    // The spinner belongs to the whole wait, or the field looks idle for the
    // quarter second the debounce is running.
    const { result } = setup({ searchTerm: 'Möhre' });

    await settle();

    expect(result.current.nameOptionsLoading).toBe(true);
  });

  it('stops loading once the answer arrives', async () => {
    const { result } = setup({ searchTerm: 'Möhre' });

    await settleSearch();

    expect(result.current.nameOptionsLoading).toBe(false);
  });

  it('is not loading before anything was typed', async () => {
    const { result } = setup();

    await settle();

    expect(result.current.nameOptionsLoading).toBe(false);
  });

  it('clears the options when the term is emptied', async () => {
    const { result, rerender } = setup({ searchTerm: 'Möhre' });
    listMock.mockResolvedValue(results([crop()]));
    await settleSearch();
    expect(result.current.nameOptions).toHaveLength(1);

    rerender({ searchTerm: '' });
    await settle();

    expect(result.current.nameOptions).toEqual([]);
    expect(result.current.nameOptionsLoading).toBe(false);
  });

  it('clears the options when it is switched off', async () => {
    const { result, rerender } = setup({ searchTerm: 'Möhre' });
    listMock.mockResolvedValue(results([crop()]));
    await settleSearch();

    rerender({ enabled: false, searchTerm: 'Möhre' });
    await settle();

    expect(result.current.nameOptions).toEqual([]);
  });

  it('cancels the request when the field is abandoned', async () => {
    // The signal is passed so an in-flight search is dropped rather than
    // left to resolve into a form the user has moved on from.
    let signal: AbortSignal | undefined;
    listMock.mockImplementation((_params, abortSignal: AbortSignal) => {
      signal = abortSignal;
      return new Promise(() => {});
    });
    const { unmount } = setup({ searchTerm: 'Möhre' });
    await settleSearch();

    unmount();

    expect(signal?.aborted).toBe(true);
  });

  it('does not fire a pending search after the term changed', async () => {
    const { rerender } = setup({ searchTerm: 'Möhre' });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1); });

    rerender({ searchTerm: '' });
    await settleSearch();

    expect(listMock).not.toHaveBeenCalled();
  });
});

describe('when the search fails', () => {
  it('offers nothing rather than stale options', async () => {
    const { result, rerender } = setup({ searchTerm: 'Möhre' });
    listMock.mockResolvedValue(results([crop()]));
    await settleSearch();
    listMock.mockRejectedValue(new Error('offline'));

    rerender({ searchTerm: 'Möhren' });
    await settleSearch();

    expect(result.current.nameOptions).toEqual([]);
    expect(result.current.nameOptionsLoading).toBe(false);
  });

  it('does not clear for a request it cancelled itself', async () => {
    // An abort rejects too, but it means the user moved on -- treating it as
    // a failure would blank the options the newer search is about to fill.
    //
    // Two things have to be true for this to test anything. The mock must
    // actually reject when the signal fires, or the abort path is never
    // entered; and that rejection has to land *after* the newer results, or
    // the clear it would do is overwritten a moment later and the assertion
    // passes for the wrong reason. So the rejection is held and fired by
    // hand once the newer search has already filled the options.
    //
    // The catch declines to clear when either the sequence has moved on or
    // the request was aborted, and only the first half is separable: every
    // abort here comes from the effect cleanup, which is also what bumps the
    // sequence. The one abort that does not move it happens on unmount,
    // where there is nothing left to observe.
    let rejectAborted!: (reason: unknown) => void;
    listMock.mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectAborted = reject;
    }));
    const { result, rerender } = setup({ searchTerm: 'Möhre' });
    await settleSearch();

    listMock.mockResolvedValue(results([crop()]));
    rerender({ searchTerm: 'Möhren' });
    await settleSearch();
    expect(result.current.nameOptions).toHaveLength(1);

    await act(async () => {
      rejectAborted(new DOMException('Aborted', 'AbortError'));
      await Promise.resolve();
    });

    expect(result.current.nameOptions).toHaveLength(1);
  });

});

describe('an overtaken search', () => {
  it('keeps the newer results when an older search resolves last', async () => {
    // Typing faster than the network answers: the earlier term's results
    // must not replace what the current term found.
    let resolveFirst!: (value: unknown) => void;
    listMock.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    const { result, rerender } = setup({ searchTerm: 'Möhre' });
    await settleSearch();

    const newer = [crop({ id: 2, crop_species: 8, crop_species_canonical_name: 'Zwiebel', name: 'Zwiebel' })];
    listMock.mockResolvedValue(results(newer));
    rerender({ searchTerm: 'Zwiebel' });
    await settleSearch();

    await act(async () => {
      resolveFirst(results([crop()]));
      await Promise.resolve();
    });

    expect(result.current.nameOptions.map((option) => option.canonicalName)).toEqual(['Zwiebel']);
  });
});

describe('the name options', () => {
  it('offers one entry per species, not per variety', async () => {
    // The Variety field covers the sorte-specific part; listing every pair
    // here would bury the species the user is looking for.
    listMock.mockResolvedValue(results([
      crop({ id: 1, variety: 'Nantaise' }),
      crop({ id: 2, variety: 'Pariser Markt' }),
    ]));
    const { result } = setup({ searchTerm: 'Möhre' });

    await settleSearch();

    expect(result.current.nameOptions).toHaveLength(1);
    expect(result.current.nameOptions[0].cropSpeciesId).toBe(7);
  });

  it('keeps distinct species apart', async () => {
    listMock.mockResolvedValue(results([
      crop({ id: 1, crop_species: 7, crop_species_canonical_name: 'Möhre' }),
      crop({ id: 2, crop_species: 8, crop_species_canonical_name: 'Zwiebel' }),
    ]));
    const { result } = setup({ searchTerm: 'e' });

    await settleSearch();

    expect(result.current.nameOptions).toHaveLength(2);
  });
});

describe('matching the typed name', () => {
  const MOEHRE = [crop({ crop_species: 7, crop_species_canonical_name: 'Möhre', name: 'Möhre' })];

  it('matches a name typed in full', async () => {
    listMock.mockResolvedValue(results(MOEHRE));
    const { result } = setup({ searchTerm: 'Möhre', nameText: 'Möhre' });

    await settleSearch();

    expect(result.current.matchedNameOption?.cropSpeciesId).toBe(7);
  });

  it('does not match a partial name', async () => {
    // The Variety suggestions hang off an exact species match, so a prefix
    // must not pull in a species the user has not finished naming.
    listMock.mockResolvedValue(results(MOEHRE));
    const { result } = setup({ searchTerm: 'Möh', nameText: 'Möh' });

    await settleSearch();

    expect(result.current.matchedNameOption).toBeUndefined();
  });

  it('matches regardless of case and surrounding space', async () => {
    // Typing the name by hand should work as well as picking it from the
    // dropdown, which is the whole point of matching on the text.
    listMock.mockResolvedValue(results(MOEHRE));
    const { result } = setup({ searchTerm: 'Möhre', nameText: '  möhre ' });

    await settleSearch();

    expect(result.current.matchedNameOption?.cropSpeciesId).toBe(7);
  });

  it('matches nothing when the field is empty', async () => {
    // The explicit empty check is belt and braces: an empty name normalizes
    // to an empty string, which no real species name matches, so the lookup
    // below would find nothing either way. It states the intent and skips
    // walking the list for a field the user has not filled in.
    listMock.mockResolvedValue(results(MOEHRE));
    const { result } = setup({ searchTerm: 'Möhre', nameText: '' });

    await settleSearch();

    expect(result.current.matchedNameOption).toBeUndefined();
  });

  it('matches nothing when the field was never filled in', async () => {
    listMock.mockResolvedValue(results(MOEHRE));
    const { result } = setup({ searchTerm: 'Möhre' });

    await settleSearch();

    expect(result.current.matchedNameOption).toBeUndefined();
  });
});

describe('the variety suggestions', () => {
  const MOEHRE = [crop({ crop_species: 7, crop_species_canonical_name: 'Möhre', name: 'Möhre' })];

  const withMatchedSpecies = async (varieties: PublicCrop[]) => {
    listMock.mockImplementation((params: Record<string, unknown>) => (
      'crop_species' in params ? Promise.resolve(results(varieties)) : Promise.resolve(results(MOEHRE))
    ));
    const view = setup({ searchTerm: 'Möhre', nameText: 'Möhre' });
    await settleSearch();
    await settle();
    return view;
  };

  it('loads the matched species\' entries', async () => {
    const { result } = await withMatchedSpecies([
      crop({ id: 2, variety: 'Nantaise' }),
      crop({ id: 3, variety: 'Pariser Markt' }),
    ]);

    await settle();

    expect(result.current.varietyOptions).toEqual(['Nantaise', 'Pariser Markt']);
    expect(speciesCalls()[0][0]).toEqual({ crop_species: 7 });
  });

  it('asks for nothing until the name matches a species', async () => {
    // The chain is search, then species, then that species' entries -- the
    // second request has nothing to ask for until the first has matched.
    listMock.mockResolvedValue(results(MOEHRE));
    setup({ searchTerm: 'Möh', nameText: 'Möh' });

    await settleSearch();
    await settle();

    expect(speciesCalls()).toHaveLength(0);
  });

  it('drops a variety with no name', async () => {
    const { result } = await withMatchedSpecies([
      crop({ id: 2, variety: '' }),
      crop({ id: 3, variety: 'Nantaise' }),
    ]);

    await settle();

    expect(result.current.varietyOptions).toEqual(['Nantaise']);
  });

  it('lists a repeated variety once', async () => {
    const { result } = await withMatchedSpecies([
      crop({ id: 2, variety: 'Nantaise' }),
      crop({ id: 3, variety: 'Nantaise' }),
    ]);

    await settle();

    expect(result.current.varietyOptions).toEqual(['Nantaise']);
  });

  it('keeps the entries themselves for the prefill', async () => {
    // The form reads values off the matching library entry, so the whole
    // record has to survive alongside the name list.
    const entries = [crop({ id: 2, variety: 'Nantaise' })];
    const { result } = await withMatchedSpecies(entries);

    await settle();

    expect(result.current.varietyPublicCrops).toEqual(entries);
  });

  it('reports which species the entries belong to', async () => {
    const { result } = await withMatchedSpecies([crop({ id: 2, variety: 'Nantaise' })]);

    await settle();

    expect(result.current.loadedVarietySpeciesId).toBe(7);
  });

  it('reports no loaded species before a match', async () => {
    // A pending prefill tells "not loaded yet" from "loaded, no match" by
    // this, so it has to stay null until there is something to report.
    listMock.mockResolvedValue(results(MOEHRE));
    const { result } = setup({ searchTerm: 'Möh', nameText: 'Möh' });

    await settleSearch();
    await settle();

    expect(result.current.loadedVarietySpeciesId).toBeNull();
  });

  it('reports loading while they are being fetched', async () => {
    listMock.mockImplementation((params: Record<string, unknown>) => (
      'crop_species' in params ? new Promise(() => {}) : Promise.resolve(results(MOEHRE))
    ));
    const { result } = setup({ searchTerm: 'Möhre', nameText: 'Möhre' });

    await settleSearch();
    await settle();

    expect(result.current.varietyOptionsLoading).toBe(true);
  });

  it('stops loading once they arrive', async () => {
    const { result } = await withMatchedSpecies([crop({ id: 2, variety: 'Nantaise' })]);

    await settle();

    expect(result.current.varietyOptionsLoading).toBe(false);
  });

  it('clears them when the name stops matching', async () => {
    const { result, rerender } = await withMatchedSpecies([crop({ id: 2, variety: 'Nantaise' })]);
    await settle();
    expect(result.current.varietyOptions).toHaveLength(1);

    rerender({ searchTerm: 'Möhre', nameText: 'Möhrchen' });
    await settle();

    expect(result.current.varietyOptions).toEqual([]);
    expect(result.current.varietyPublicCrops).toEqual([]);
    expect(result.current.loadedVarietySpeciesId).toBeNull();
  });

  it('clears them when the form is switched off', async () => {
    // Three guards check `enabled` on the way here -- the search effect, the
    // matched-species effect, and this one -- and only the first is
    // separately observable. With the search cleared there is no matched
    // option, so the other two would reach the same answer on their own.

    const { result, rerender } = await withMatchedSpecies([crop({ id: 2, variety: 'Nantaise' })]);
    await settle();
    expect(result.current.varietyOptions).toHaveLength(1);

    rerender({ enabled: false, searchTerm: 'Möhre', nameText: 'Möhre' });
    await settle();

    expect(result.current.varietyPublicCrops).toEqual([]);
    expect(result.current.loadedVarietySpeciesId).toBeNull();
  });

  it('marks the species resolved even when the fetch fails', async () => {
    // A prefill waiting on this would otherwise wait forever; reporting the
    // species as resolved with no entries lets it fall back to linking the
    // species alone.
    //
    // The catch also empties the entry list, which is not separately
    // observable: the match changing takes the hook through the no-match
    // guard first, and that has already cleared them by the time the failing
    // request comes back.
    listMock.mockImplementation((params: Record<string, unknown>) => (
      'crop_species' in params
        ? Promise.reject(new Error('offline'))
        : Promise.resolve(results(MOEHRE))
    ));
    const { result } = setup({ searchTerm: 'Möhre', nameText: 'Möhre' });

    await settleSearch();
    await settle();

    await settle();

    expect(result.current.loadedVarietySpeciesId).toBe(7);
    expect(result.current.varietyPublicCrops).toEqual([]);
    expect(result.current.varietyOptionsLoading).toBe(false);
  });

  it('ignores entries that arrive after the match changed', async () => {
    // The abort is best effort -- a request already past the wire can still
    // resolve, and its entries belong to a species the form has moved off.
    let resolveFirst!: (value: unknown) => void;
    const nameResults = results(MOEHRE);
    listMock.mockImplementation((params: Record<string, unknown>) => {
      if (!('crop_species' in params)) return Promise.resolve(nameResults);
      if (params.crop_species === 7) {
        return new Promise((resolve) => { resolveFirst = resolve; });
      }
      return Promise.resolve(results([]));
    });
    const { result, rerender } = setup({ searchTerm: 'Möhre', nameText: 'Möhre' });
    await settleSearch();
    await settle();

    rerender({ searchTerm: 'Möhre', nameText: 'Möhrchen' });
    await settle();
    await act(async () => {
      resolveFirst(results([crop({ id: 2, variety: 'Nantaise' })]));
      await Promise.resolve();
    });

    expect(result.current.varietyOptions).toEqual([]);
    expect(result.current.loadedVarietySpeciesId).toBeNull();
  });

  it('drops the entries it was showing when a later fetch fails', async () => {
    // A stale variety list under a different species would offer the user
    // sorts that do not belong to the crop they are naming.
    const { result, rerender } = await withMatchedSpecies([crop({ id: 2, variety: 'Nantaise' })]);
    await settle();
    expect(result.current.varietyPublicCrops).toHaveLength(1);

    listMock.mockImplementation((params: Record<string, unknown>) => (
      'crop_species' in params
        ? Promise.reject(new Error('offline'))
        : Promise.resolve(results([
          crop({ crop_species: 8, crop_species_canonical_name: 'Zwiebel', name: 'Zwiebel' }),
        ]))
    ));
    rerender({ searchTerm: 'Zwiebel', nameText: 'Zwiebel' });
    await settleSearch();
    await settle();

    await settle();

    expect(result.current.loadedVarietySpeciesId).toBe(8);
    expect(result.current.varietyPublicCrops).toEqual([]);
  });

  it('cancels an in-flight fetch when the match changes', async () => {
    const signals: AbortSignal[] = [];
    listMock.mockImplementation((params: Record<string, unknown>, signal: AbortSignal) => {
      if ('crop_species' in params) {
        signals.push(signal);
        return new Promise(() => {});
      }
      return Promise.resolve(results(MOEHRE));
    });
    const { rerender } = setup({ searchTerm: 'Möhre', nameText: 'Möhre' });
    await settleSearch();
    await settle();

    rerender({ searchTerm: 'Möhre', nameText: 'Möhrchen' });
    await settle();

    expect(signals[0]?.aborted).toBe(true);
  });
});
