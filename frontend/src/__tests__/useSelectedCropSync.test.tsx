import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from 'react-router';
import type { ReactNode } from 'react';
import { SELECTED_CROP_STORAGE_KEY } from '../pages/cropsPageUtils';
import { useSelectedCropSync } from '../pages/useSelectedCropSync';

const { navigations } = vi.hoisted(() => ({
  navigations: [] as Array<{ to: unknown; options: { replace?: boolean } | undefined }>,
}));

/**
 * The real router is kept -- the hook's whole job is keeping React state and
 * the URL in step, and the back/forward protection only means anything
 * against a history that records entries. `useNavigate` is wrapped rather
 * than replaced so every navigation still happens *and* is observable:
 * push and replace produce the same URL, so the only way to tell them apart
 * is the option the hook passed.
 *
 * The wrapper is memoized on the real navigate, since the hook holds it in a
 * dependency array and a fresh identity per render would re-run the sync
 * effect on every commit.
 */
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  const React = await import('react');
  return {
    ...actual,
    useNavigate: () => {
      const navigate = actual.useNavigate();
      return React.useCallback((to: never, options: never) => {
        navigations.push({ to, options });
        return navigate(to, options);
      }, [navigate]);
    },
  };
});

const CROPS_PATH = '/app/crops';
const LEGACY_STORAGE_KEY = 'selectedCultureId';

/**
 * `updateCropSearchParams` reads `window.location.pathname` directly to refuse
 * writes once the browser has moved on, so jsdom's location has to agree with
 * the memory router's.
 */
const setup = ({ initialEntries = [CROPS_PATH] }: { initialEntries?: string[] } = {}) => {
  window.history.replaceState({}, '', initialEntries[initialEntries.length - 1]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>
  );
  const view = renderHook(() => {
    const location = useLocation();
    const navigate = useNavigate();
    return { ...useSelectedCropSync(), location, navigate };
  }, { wrapper });
  return view;
};

const search = (result: { current: { location: { search: string } } }) => result.current.location.search;

/**
 * Drives the URL the way the browser's back/forward buttons would.
 *
 * The navigation and the flush are separate `act` calls on purpose: the
 * query -> state effect only schedules its deferred update once the
 * navigation has committed, so advancing timers inside the same act would run
 * before there is any timer to advance.
 */
const changeUrlExternally = async (
  navigate: NavigateFunction,
  to: string,
) => {
  await act(async () => { navigate(to, { replace: false }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
};

/** Lets the query -> state effect's deferred update land. */
const settle = async () => {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
};

const lastNavigation = () => navigations[navigations.length - 1];

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  navigations.length = 0;
  window.localStorage.clear();
  window.history.replaceState({}, '', CROPS_PATH);
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

describe('seeding the selection', () => {
  it('takes the crop from the URL', () => {
    const { result } = setup({ initialEntries: [`${CROPS_PATH}?cropId=42`] });

    expect(result.current.selectedCropId).toBe(42);
  });

  it('falls back to the last crop the user had open', () => {
    // Returning to the page without a link should land where they left off.
    window.localStorage.setItem(SELECTED_CROP_STORAGE_KEY, '7');
    const { result } = setup();

    expect(result.current.selectedCropId).toBe(7);
  });

  it('prefers the URL over the stored crop', () => {
    // A shared link has to win, or opening someone else's link shows your own
    // last crop instead.
    window.localStorage.setItem(SELECTED_CROP_STORAGE_KEY, '7');
    const { result } = setup({ initialEntries: [`${CROPS_PATH}?cropId=42`] });

    expect(result.current.selectedCropId).toBe(42);
  });

  it('reads the pre-rename storage key', () => {
    // Users who last visited before the Kultur/Crop rename still have it.
    window.localStorage.setItem(LEGACY_STORAGE_KEY, '9');
    const { result } = setup();

    expect(result.current.selectedCropId).toBe(9);
  });

  it('reads the pre-rename query parameter', () => {
    // Bookmarks and links from before the rename must keep working.
    const { result } = setup({ initialEntries: [`${CROPS_PATH}?cultureId=42`] });

    expect(result.current.selectedCropId).toBe(42);
  });

  it('starts with nothing when neither source has a crop', () => {
    const { result } = setup();

    expect(result.current.selectedCropId).toBeUndefined();
  });

  it('falls through to storage for a non-numeric crop in the URL', () => {
    // The finiteness check is what makes this fall through rather than seed
    // the selection with NaN -- a parse failure is not a selection.
    window.localStorage.setItem(SELECTED_CROP_STORAGE_KEY, '7');
    const { result } = setup({ initialEntries: [`${CROPS_PATH}?cropId=abc`] });

    expect(result.current.selectedCropId).toBe(7);
  });

  it('leaves nothing selected for a non-numeric crop with no stored fallback', () => {
    const { result } = setup({ initialEntries: [`${CROPS_PATH}?cropId=abc`] });

    expect(result.current.selectedCropId).toBeUndefined();
  });

  it('writes the stored crop into a URL that has none', async () => {
    // So the address bar is shareable straight away, not only after the user
    // clicks something. This is the one case the first-sync exemption exists
    // for: the source ref is null here, which every later run would read as
    // an external URL change and refuse to act on.
    window.localStorage.setItem(SELECTED_CROP_STORAGE_KEY, '7');
    const { result } = setup();

    await waitFor(() => expect(search(result)).toBe('?cropId=7'));
  });

  it('seeds the URL by replacing, so Back still leaves the page', async () => {
    window.localStorage.setItem(SELECTED_CROP_STORAGE_KEY, '7');
    const { result } = setup();
    await waitFor(() => expect(search(result)).toBe('?cropId=7'));

    expect(lastNavigation().options).toEqual({ replace: true });
  });

  it('keeps other query parameters when seeding', async () => {
    // The crops page also carries filter parameters.
    window.localStorage.setItem(SELECTED_CROP_STORAGE_KEY, '7');
    const { result } = setup({ initialEntries: [`${CROPS_PATH}?search=M%C3%B6hre`] });

    await waitFor(() => expect(search(result)).toContain('cropId=7'));
    expect(search(result)).toContain('search=M');
  });

  it('keeps the hash when seeding', async () => {
    // Dropping it would lose an in-page anchor on every selection change.
    window.localStorage.setItem(SELECTED_CROP_STORAGE_KEY, '7');
    const { result } = setup({ initialEntries: [`${CROPS_PATH}#notes`] });

    await waitFor(() => expect(search(result)).toBe('?cropId=7'));
    expect(result.current.location.hash).toBe('#notes');
  });

  it('does not navigate when the URL already agrees', async () => {
    // Both sources hold the same crop, so there is nothing to write -- and a
    // navigation here would add a history entry for no change at all.
    window.localStorage.setItem(SELECTED_CROP_STORAGE_KEY, '42');
    setup({ initialEntries: [`${CROPS_PATH}?cropId=42`] });

    await settle();

    expect(navigations).toHaveLength(0);
  });
});

describe('selecting a crop', () => {
  it('puts it in the URL', async () => {
    const { result } = setup();

    act(() => result.current.updateSelectedCropId(42, 'internal'));

    await waitFor(() => expect(search(result)).toBe('?cropId=42'));
    expect(result.current.selectedCropId).toBe(42);
  });

  it('remembers it for the next visit', async () => {
    const { result } = setup();

    act(() => result.current.updateSelectedCropId(42, 'internal'));

    await waitFor(() => expect(window.localStorage.getItem(SELECTED_CROP_STORAGE_KEY)).toBe('42'));
  });

  it('replaces the history entry by default', async () => {
    // Clicking through the sidebar must not turn Back into stepping back
    // through every crop that was looked at. Push and replace produce the
    // same URL, so the option itself is the only thing that can be asserted.
    const { result } = setup();

    act(() => result.current.updateSelectedCropId(42, 'internal'));

    await waitFor(() => expect(search(result)).toBe('?cropId=42'));
    expect(lastNavigation().options).toEqual({ replace: true });
  });

  it('pushes a history entry when asked to', async () => {
    // A deliberate "go to this record" navigation, where Back should return
    // to where the user came from.
    const { result } = setup();

    act(() => result.current.updateSelectedCropId(42, 'internal', 'push'));

    await waitFor(() => expect(search(result)).toBe('?cropId=42'));
    expect(lastNavigation().options).toEqual({ replace: false });
  });

  it('goes back to replacing after a pushed navigation', async () => {
    // The push mode is per call, not sticky; a later sidebar click must not
    // inherit it.
    const { result } = setup();
    act(() => result.current.updateSelectedCropId(42, 'internal', 'push'));
    await waitFor(() => expect(search(result)).toBe('?cropId=42'));

    act(() => result.current.updateSelectedCropId(43, 'internal'));

    await waitFor(() => expect(search(result)).toBe('?cropId=43'));
    expect(lastNavigation().options).toEqual({ replace: true });
  });

  it('keeps the hash across a selection change', async () => {
    const { result } = setup({ initialEntries: [`${CROPS_PATH}#notes`] });

    act(() => result.current.updateSelectedCropId(42, 'internal'));

    await waitFor(() => expect(search(result)).toBe('?cropId=42'));
    expect(result.current.location.hash).toBe('#notes');
  });

  it('does not navigate when the crop is already in the URL', async () => {
    const { result } = setup({ initialEntries: [`${CROPS_PATH}?cropId=42`] });
    await settle();
    navigations.length = 0;

    act(() => result.current.updateSelectedCropId(42, 'internal'));
    await settle();

    expect(navigations).toHaveLength(0);
  });

  it('keeps the other parameters when switching crops', async () => {
    const { result } = setup({ initialEntries: [`${CROPS_PATH}?search=M%C3%B6hre&cropId=1`] });
    await waitFor(() => expect(result.current.selectedCropId).toBe(1));

    act(() => result.current.updateSelectedCropId(42, 'internal'));

    await waitFor(() => expect(search(result)).toContain('cropId=42'));
    expect(search(result)).toContain('search=M');
  });

  it('does not re-render for a selection that did not change', () => {
    // The updater compares before setting, so repeatedly selecting the same
    // crop -- which the sidebar does on every click of the open row -- costs
    // nothing. The comparison is belt and braces: React bails out of an
    // identical primitive on its own, so removing it changes no outcome.
    const { result } = setup({ initialEntries: [`${CROPS_PATH}?cropId=42`] });
    const before = result.current.location;

    act(() => result.current.updateSelectedCropId(42, 'internal'));

    expect(result.current.location).toBe(before);
    expect(result.current.selectedCropId).toBe(42);
  });
});

describe('clearing the selection', () => {
  it('takes the crop out of the URL', async () => {
    const { result } = setup({ initialEntries: [`${CROPS_PATH}?cropId=42`] });
    await waitFor(() => expect(result.current.selectedCropId).toBe(42));

    act(() => result.current.updateSelectedCropId(undefined, 'internal'));

    await waitFor(() => expect(search(result)).toBe(''));
  });

  it('clears by replacing, never by pushing', async () => {
    // Closing the detail view is not a destination; pushing would make Back
    // reopen the crop the user just closed.
    const { result } = setup({ initialEntries: [`${CROPS_PATH}?cropId=42`] });
    await waitFor(() => expect(result.current.selectedCropId).toBe(42));

    act(() => result.current.updateSelectedCropId(undefined, 'internal'));

    await waitFor(() => expect(search(result)).toBe(''));
    expect(lastNavigation().options).toEqual({ replace: true });
  });

  it('clears by replacing even when the selection was pushed', async () => {
    // The pending mode belongs to the call that set it; a clear passes its
    // own hard-coded replace rather than inheriting it.
    const { result } = setup();
    act(() => result.current.updateSelectedCropId(42, 'internal', 'push'));
    await waitFor(() => expect(search(result)).toBe('?cropId=42'));

    act(() => result.current.updateSelectedCropId(undefined, 'internal', 'push'));

    await waitFor(() => expect(search(result)).toBe(''));
    expect(lastNavigation().options).toEqual({ replace: true });
  });

  it('forgets the stored crop', async () => {
    window.localStorage.setItem(SELECTED_CROP_STORAGE_KEY, '42');
    const { result } = setup({ initialEntries: [`${CROPS_PATH}?cropId=42`] });
    await waitFor(() => expect(result.current.selectedCropId).toBe(42));

    act(() => result.current.updateSelectedCropId(undefined, 'internal'));

    await waitFor(() => expect(window.localStorage.getItem(SELECTED_CROP_STORAGE_KEY)).toBeNull());
  });

  it('also forgets the pre-rename stored crop', async () => {
    // Otherwise a user from before the rename would have their selection come
    // straight back on the next load.
    window.localStorage.setItem(LEGACY_STORAGE_KEY, '42');
    const { result } = setup({ initialEntries: [`${CROPS_PATH}?cropId=42`] });
    await waitFor(() => expect(result.current.selectedCropId).toBe(42));

    act(() => result.current.updateSelectedCropId(undefined, 'internal'));

    await waitFor(() => expect(window.localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull());
  });

  it('keeps the other parameters', async () => {
    const { result } = setup({ initialEntries: [`${CROPS_PATH}?search=M%C3%B6hre&cropId=42`] });
    await waitFor(() => expect(result.current.selectedCropId).toBe(42));

    act(() => result.current.updateSelectedCropId(undefined, 'internal'));

    await waitFor(() => expect(search(result)).not.toContain('cropId'));
    expect(search(result)).toContain('search=M');
  });

  it('leaves a pre-rename parameter behind when clearing', async () => {
    // A bug, pinned rather than fixed here -- fixing it is a behaviour change
    // and belongs in its own commit.
    //
    // The seed path reads both spellings of the parameter, but the clear path
    // deletes only `cropId`. Arriving from a pre-rename bookmark, closing the
    // crop and then reloading or sharing the URL brings the crop straight
    // back, because `?cultureId=42` is still in the address bar. The
    // selection state itself is cleared correctly; only the URL is wrong.
    //
    // Nothing navigates here either: with `cropId` absent there is nothing to
    // delete, so the resulting query string is identical to the current one
    // and the unchanged-search check stops the pointless history entry.
    const { result } = setup({ initialEntries: [`${CROPS_PATH}?cultureId=42`] });
    await waitFor(() => expect(result.current.selectedCropId).toBe(42));
    navigations.length = 0;

    act(() => result.current.updateSelectedCropId(undefined, 'internal'));
    await settle();

    expect(result.current.selectedCropId).toBeUndefined();
    expect(search(result)).toBe('?cultureId=42');
    expect(navigations).toHaveLength(0);
  });

  it('does not navigate when the URL never had a crop', async () => {
    // Nothing to remove, so a navigation would add a history entry for a
    // change that is not a change. Guarded twice: the missing-parameter check
    // returns first, and the unchanged-search check would catch it anyway
    // since deleting an absent parameter leaves the query string identical.
    const { result } = setup({ initialEntries: [`${CROPS_PATH}?search=M%C3%B6hre`] });
    await settle();
    navigations.length = 0;

    act(() => result.current.updateSelectedCropId(undefined, 'internal'));
    await settle();

    expect(navigations).toHaveLength(0);
  });
});

describe('following the URL', () => {
  it('picks up a crop the URL gained', async () => {
    // A deep link followed while the page is already open. The pickup is
    // deferred by a timeout, so it lands a tick after the URL changes.
    //
    // Two things keep that timeout from firing against our own selection:
    // the 'internal' guard at the top of the effect, and the cleanup that
    // cancels a pending timer when the effect re-runs. Dropping the guard is
    // caught; dropping only the cleanup is not, because the guard already
    // covers it. Both are kept -- the cleanup is what makes a timer from a
    // superseded URL harmless, which the guard alone would not.
    const { result } = setup({ initialEntries: [`${CROPS_PATH}?cropId=42`] });
    await waitFor(() => expect(result.current.selectedCropId).toBe(42));

    await changeUrlExternally(result.current.navigate, `${CROPS_PATH}?cropId=43`);

    expect(result.current.selectedCropId).toBe(43);
  });

  it('does not navigate again for a change that came from the URL', async () => {
    // The query -> state direction must not bounce back into a navigation, or
    // every externally driven URL change would produce a second history entry
    // and the user's Back would land on the same page twice.
    //
    // Three separate things stop that bounce -- the 'query' source check in
    // each of the sync effect's two branches, and the URL already matching --
    // so no single one of them is observable on its own. They are kept as
    // written: the source check states the intent, while the match check is
    // about the URL rather than about where the change came from.
    const { result } = setup({ initialEntries: [`${CROPS_PATH}?cropId=42`] });
    await settle();

    await changeUrlExternally(result.current.navigate, `${CROPS_PATH}?cropId=43`);
    navigations.length = 0;
    await settle();

    expect(navigations).toHaveLength(0);
    expect(search(result)).toBe('?cropId=43');
  });

  it('stores a crop that arrived from the URL', async () => {
    // It is the user's current selection either way, so the next visit should
    // land on it.
    setup({ initialEntries: [`${CROPS_PATH}?cropId=42`] });

    await waitFor(() => expect(window.localStorage.getItem(SELECTED_CROP_STORAGE_KEY)).toBe('42'));
  });

  it('does not chase a URL that dropped the parameter entirely', async () => {
    // Navigating to the bare crops page is not "deselect": the page keeps the
    // crop it had, and the state -> URL direction puts it back.
    const { result } = setup({ initialEntries: [`${CROPS_PATH}?cropId=42`] });
    await settle();

    await changeUrlExternally(result.current.navigate, CROPS_PATH);

    expect(result.current.selectedCropId).toBe(42);
  });

  it('does not undo an external URL change by writing the old crop back', async () => {
    // The back/forward case the whole `isExternalUrlChange` guard exists for.
    // The URL has moved on but the state -> URL effect runs first, and must
    // not push the stale selection back over it -- that would make Back
    // appear to do nothing at all.
    const { result } = setup({ initialEntries: [`${CROPS_PATH}?cropId=42`] });
    await settle();

    await changeUrlExternally(result.current.navigate, `${CROPS_PATH}?cropId=43`);

    expect(search(result)).toBe('?cropId=43');
    expect(result.current.selectedCropId).toBe(43);
  });

  it('does not undo an external change that follows a selection of our own', async () => {
    // The source ref is reset after every sync, so the commit after an
    // internal selection no longer looks internal. Without that the next
    // external URL change would be treated as our own and written back over
    // -- Back would appear dead for one press after every crop clicked.
    //
    // The reset appears in four places in the effect, and the commit that
    // follows a write lands on one of the early returns, which resets it too.
    // So removing only the final one changes nothing; the effect's exits
    // collectively guarantee the ref is clear, and no single exit is
    // individually load-bearing. The same is true of the navigation-mode
    // reset, since the updater sets that on every call.
    const { result } = setup();
    act(() => result.current.updateSelectedCropId(42, 'internal'));
    await waitFor(() => expect(search(result)).toBe('?cropId=42'));

    await changeUrlExternally(result.current.navigate, `${CROPS_PATH}?cropId=43`);

    expect(search(result)).toBe('?cropId=43');
    expect(result.current.selectedCropId).toBe(43);
  });

  it('picks the crop up again after an external change settled', async () => {
    // Once the external change has been absorbed, ordinary selection works
    // again -- the guard is per commit, not a latch.
    const { result } = setup({ initialEntries: [`${CROPS_PATH}?cropId=42`] });
    await settle();
    await changeUrlExternally(result.current.navigate, `${CROPS_PATH}?cropId=43`);

    act(() => result.current.updateSelectedCropId(44, 'internal'));

    await waitFor(() => expect(search(result)).toBe('?cropId=44'));
  });
});

describe('leaving the page', () => {
  it('does not write the crops URL once the browser is elsewhere', async () => {
    // The effect can still fire while the next page mounts; writing then
    // would drag the user back to the crops URL they just left.
    const { result } = setup();
    window.history.replaceState({}, '', '/app/planting-plans');
    navigations.length = 0;

    act(() => result.current.updateSelectedCropId(42, 'internal'));
    await settle();

    expect(navigations).toHaveLength(0);
  });

  it('still writes when the browser is on a non-app page', async () => {
    // The guard only applies inside the app shell; a test or storybook host
    // on some other path must not silently disable the sync.
    const { result } = setup();
    window.history.replaceState({}, '', '/something-else');
    navigations.length = 0;

    act(() => result.current.updateSelectedCropId(42, 'internal'));

    await waitFor(() => expect(navigations.length).toBeGreaterThan(0));
  });
});

describe('identity', () => {
  it('keeps the updater stable across renders', async () => {
    // It ends up in the dependency arrays of the page's own callbacks.
    const { result, rerender } = setup();
    const before = result.current.updateSelectedCropId;

    act(() => result.current.updateSelectedCropId(42, 'internal'));
    await waitFor(() => expect(result.current.selectedCropId).toBe(42));
    rerender();

    expect(result.current.updateSelectedCropId).toBe(before);
  });
});
