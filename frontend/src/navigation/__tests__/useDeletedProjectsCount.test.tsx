import { renderHook, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../auth/types';
import { useDeletedProjectsCount } from '../useDeletedProjectsCount';

const { listDeletedMock } = vi.hoisted(() => ({ listDeletedMock: vi.fn() }));
vi.mock('../../api/api', () => ({ projectAPI: { listDeleted: listDeletedMock } }));

const USER = { id: 1, email: 'gaertner@example.org' } as AuthUser;
const OTHER_USER = { id: 2, email: 'zweite@example.org' } as AuthUser;

/** The trash page announces a restore or a purge on this event. */
const TRASH_CHANGED = 'ofp:project-trash-changed';

const project = (id: number) => ({ id, name: `Projekt ${id}` });

/** The endpoint answers either shape depending on whether paging is on. */
const paginated = (count: number) => ({
  data: { count, next: null, previous: null, results: Array.from({ length: count }, (_, i) => project(i)) },
});
const plainList = (count: number) => ({
  data: Array.from({ length: count }, (_, i) => project(i)),
});

const setup = (user: AuthUser | null = USER) =>
  renderHook(({ currentUser }: { currentUser: AuthUser | null }) => useDeletedProjectsCount(currentUser), {
    initialProps: { currentUser: user },
  });

beforeEach(() => {
  vi.clearAllMocks();
  listDeletedMock.mockResolvedValue(plainList(0));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loading the count', () => {
  it('starts at zero before the request comes back', () => {
    // The badge must not flash a number it has not fetched yet.
    const { result } = setup();

    expect(result.current.deletedProjectsCount).toBe(0);
  });

  it('reports how many deleted projects the user has', async () => {
    listDeletedMock.mockResolvedValue(plainList(3));
    const { result } = setup();

    await waitFor(() => expect(result.current.deletedProjectsCount).toBe(3));
  });

  it('reads the count out of a paginated payload', async () => {
    // The endpoint switches shape once paging kicks in, and the badge would
    // silently go blank on exactly the accounts that have the most projects.
    listDeletedMock.mockResolvedValue(paginated(4));
    const { result } = setup();

    await waitFor(() => expect(result.current.deletedProjectsCount).toBe(4));
  });

  it('counts the rows it was sent rather than the payload total', async () => {
    // A `count` field describes the whole result set, not the page. Trusting
    // it would make the badge disagree with the list the trash page shows.
    listDeletedMock.mockResolvedValue({
      data: { count: 99, next: null, previous: null, results: [project(1), project(2)] },
    });
    const { result } = setup();

    await waitFor(() => expect(result.current.deletedProjectsCount).toBe(2));
  });

  it('asks the API exactly once on mount', async () => {
    const { result } = setup();

    await waitFor(() => expect(listDeletedMock).toHaveBeenCalledTimes(1));
    expect(result.current.deletedProjectsCount).toBe(0);
  });
});

describe('signed-out and switching accounts', () => {
  it('does not call the API without a user', () => {
    // Guarded twice over: the mount effect skips the call, and `refresh`
    // returns early on its own. Only the second guard is observable -- with
    // the first removed, `refresh` still sets the count to the zero it is
    // already at, which React discards without a render.
    setup(null);

    expect(listDeletedMock).not.toHaveBeenCalled();
  });

  it('stays at zero without a user', () => {
    const { result } = setup(null);

    expect(result.current.deletedProjectsCount).toBe(0);
  });

  it('loads once a user arrives', async () => {
    // Mount happens before the session is restored, so the first render
    // legitimately has no user yet.
    listDeletedMock.mockResolvedValue(plainList(2));
    const { result, rerender } = setup(null);

    rerender({ currentUser: USER });

    await waitFor(() => expect(result.current.deletedProjectsCount).toBe(2));
  });

  it('reloads for a different user', async () => {
    // Otherwise switching accounts would leave the previous account's badge.
    listDeletedMock.mockResolvedValue(plainList(2));
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.deletedProjectsCount).toBe(2));
    listDeletedMock.mockResolvedValue(plainList(5));

    rerender({ currentUser: OTHER_USER });

    await waitFor(() => expect(result.current.deletedProjectsCount).toBe(5));
  });

  it('does not reload for the same user object', async () => {
    const { rerender } = setup();
    await waitFor(() => expect(listDeletedMock).toHaveBeenCalledTimes(1));

    rerender({ currentUser: USER });

    expect(listDeletedMock).toHaveBeenCalledTimes(1);
  });

  it('clears the count on an explicit refresh after signing out', async () => {
    // The stale badge would otherwise sit in the menu of a signed-out shell.
    listDeletedMock.mockResolvedValue(plainList(3));
    const { result, rerender } = setup();
    await waitFor(() => expect(result.current.deletedProjectsCount).toBe(3));

    rerender({ currentUser: null });
    await act(async () => { await result.current.refresh(); });

    expect(result.current.deletedProjectsCount).toBe(0);
    expect(listDeletedMock).toHaveBeenCalledTimes(1);
  });
});

describe('failures', () => {
  it('reports zero when the request fails', async () => {
    // A broken badge is worse than an absent one: this decides whether a dot
    // appears next to a menu entry, nothing more.
    listDeletedMock.mockRejectedValue(new Error('offline'));
    const { result } = setup();

    await waitFor(() => expect(listDeletedMock).toHaveBeenCalled());
    expect(result.current.deletedProjectsCount).toBe(0);
  });

  it('drops a count it had already shown when a later request fails', async () => {
    listDeletedMock.mockResolvedValue(plainList(3));
    const { result } = setup();
    await waitFor(() => expect(result.current.deletedProjectsCount).toBe(3));
    listDeletedMock.mockRejectedValue(new Error('offline'));

    await act(async () => { await result.current.refresh(); });

    expect(result.current.deletedProjectsCount).toBe(0);
  });

  it('does not let the failure escape to the caller', async () => {
    // `refresh` is awaited by the menu's open handler; a rejection there
    // would surface as an unhandled rejection on opening a menu.
    listDeletedMock.mockRejectedValue(new Error('offline'));
    const { result } = setup();

    await expect(act(async () => { await result.current.refresh(); })).resolves.toBeUndefined();
  });

  it('recovers on the next successful refresh', async () => {
    listDeletedMock.mockRejectedValue(new Error('offline'));
    const { result } = setup();
    await waitFor(() => expect(listDeletedMock).toHaveBeenCalled());
    listDeletedMock.mockResolvedValue(plainList(2));

    await act(async () => { await result.current.refresh(); });

    expect(result.current.deletedProjectsCount).toBe(2);
  });
});

describe('refresh', () => {
  it('re-reads the count on demand', async () => {
    // Called when the project menu opens, so the badge is current at the
    // moment it is actually looked at.
    listDeletedMock.mockResolvedValue(plainList(1));
    const { result } = setup();
    await waitFor(() => expect(result.current.deletedProjectsCount).toBe(1));
    listDeletedMock.mockResolvedValue(plainList(4));

    await act(async () => { await result.current.refresh(); });

    expect(result.current.deletedProjectsCount).toBe(4);
  });

  it('settles only once the count has been applied', async () => {
    // The caller awaits it; resolving before the state is set would make a
    // menu that reads the count straight after see the old one.
    listDeletedMock.mockResolvedValue(plainList(6));
    const { result } = setup();

    await act(async () => { await result.current.refresh(); });

    expect(result.current.deletedProjectsCount).toBe(6);
  });

  it('keeps a stable identity while the user does not change', async () => {
    // It sits in the menu's dependency arrays, and in this hook's own event
    // listener effect -- a fresh identity per render would resubscribe the
    // window listener on every render.
    const { result, rerender } = setup();
    await waitFor(() => expect(listDeletedMock).toHaveBeenCalled());
    const before = result.current.refresh;

    rerender({ currentUser: USER });

    expect(result.current.refresh).toBe(before);
  });

  it('is rebuilt when the user changes', async () => {
    const { result, rerender } = setup();
    await waitFor(() => expect(listDeletedMock).toHaveBeenCalled());
    const before = result.current.refresh;

    rerender({ currentUser: OTHER_USER });

    expect(result.current.refresh).not.toBe(before);
  });
});

describe('the trash-changed event', () => {
  it('re-reads the count when the trash page restores a project', async () => {
    // The badge lives in the navigation, the change happens on another page;
    // the event is what connects them without a shared store.
    listDeletedMock.mockResolvedValue(plainList(3));
    const { result } = setup();
    await waitFor(() => expect(result.current.deletedProjectsCount).toBe(3));
    listDeletedMock.mockResolvedValue(plainList(2));

    await act(async () => {
      window.dispatchEvent(new Event(TRASH_CHANGED));
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.deletedProjectsCount).toBe(2));
  });

  it('drops to zero when the last deleted project is purged', async () => {
    listDeletedMock.mockResolvedValue(plainList(1));
    const { result } = setup();
    await waitFor(() => expect(result.current.deletedProjectsCount).toBe(1));
    listDeletedMock.mockResolvedValue(plainList(0));

    await act(async () => {
      window.dispatchEvent(new Event(TRASH_CHANGED));
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.deletedProjectsCount).toBe(0));
  });

  it('listens even while signed out, and then reports zero', async () => {
    // The listener is unconditional; the guard lives in `refresh` instead, so
    // a signed-out shell answers the event without reaching the network.
    const { result } = setup(null);

    await act(async () => {
      window.dispatchEvent(new Event(TRASH_CHANGED));
      await Promise.resolve();
    });

    expect(listDeletedMock).not.toHaveBeenCalled();
    expect(result.current.deletedProjectsCount).toBe(0);
  });

  it('uses the current user, not the one present when it subscribed', async () => {
    // The navigation mounts before the session is restored, so the listener
    // is first registered with no user. If it kept that first closure, every
    // later trash change would take the signed-out path and quietly leave the
    // badge at zero for the rest of the session.
    listDeletedMock.mockResolvedValue(plainList(2));
    const { result, rerender } = setup(null);
    rerender({ currentUser: USER });
    await waitFor(() => expect(result.current.deletedProjectsCount).toBe(2));
    listDeletedMock.mockClear();
    listDeletedMock.mockResolvedValue(plainList(1));

    await act(async () => {
      window.dispatchEvent(new Event(TRASH_CHANGED));
      await Promise.resolve();
    });

    expect(listDeletedMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.deletedProjectsCount).toBe(1));
  });

  it('ignores an unrelated event', async () => {
    const { result } = setup();
    await waitFor(() => expect(listDeletedMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      window.dispatchEvent(new Event('ofp:something-else'));
      await Promise.resolve();
    });

    expect(listDeletedMock).toHaveBeenCalledTimes(1);
    expect(result.current.deletedProjectsCount).toBe(0);
  });

  it('stops listening once the navigation unmounts', async () => {
    const { unmount } = setup();
    await waitFor(() => expect(listDeletedMock).toHaveBeenCalledTimes(1));

    unmount();
    await act(async () => {
      window.dispatchEvent(new Event(TRASH_CHANGED));
      await Promise.resolve();
    });

    expect(listDeletedMock).toHaveBeenCalledTimes(1);
  });

  it('does not register the listener twice across renders', async () => {
    // A duplicate listener would double every trash-change request.
    const { rerender } = setup();
    await waitFor(() => expect(listDeletedMock).toHaveBeenCalledTimes(1));
    rerender({ currentUser: USER });
    listDeletedMock.mockClear();

    await act(async () => {
      window.dispatchEvent(new Event(TRASH_CHANGED));
      await Promise.resolve();
    });

    expect(listDeletedMock).toHaveBeenCalledTimes(1);
  });
});
