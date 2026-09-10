import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useActiveSeason } from '../useActiveSeason';
import type { Season } from '../../api/types';

const {
  listMock, dueMock, deleteMock, undeleteMock, creationOptionsMock,
  createMock, createTransitionMock, updateMock, copyFromMock, activeProjectIdRef,
} = vi.hoisted(() => ({
  listMock: vi.fn(),
  dueMock: vi.fn(),
  deleteMock: vi.fn(),
  undeleteMock: vi.fn(),
  creationOptionsMock: vi.fn(),
  createMock: vi.fn(),
  createTransitionMock: vi.fn(),
  updateMock: vi.fn(),
  copyFromMock: vi.fn(),
  activeProjectIdRef: { current: 1 as number | null },
}));

vi.mock('../../api/api', () => ({
  seasonAPI: {
    list: listMock,
    dueSuggestion: dueMock,
    creationOptions: creationOptionsMock,
    delete: deleteMock,
    undelete: undeleteMock,
    create: createMock,
    createTransition: createTransitionMock,
    update: updateMock,
    copyFrom: copyFromMock,
  },
}));

vi.mock('../../auth/useAuth', () => ({
  useAuth: () => ({ activeProjectId: activeProjectIdRef.current }),
}));

function season(id: number, start: string, end: string): Season {
  return {
    id, project: 1, start_date: start, end_date: end, custom_label: '',
    label: `s${id}`, computed_label: `s${id}`, planting_plan_count: 0,
    created_at: '', updated_at: '',
  };
}

const seasons = [
  season(3, '2026-09-01', '2027-08-31'),
  season(2, '2025-09-01', '2026-08-31'),
  season(1, '2024-09-01', '2025-08-31'),
];

const reloadMock = vi.fn();

/** What `pendingSeasonDeletions` held at the moment each reload was called. */
const stashAtReload: (string | null)[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  listMock.mockResolvedValue({ data: { results: seasons } });
  dueMock.mockResolvedValue({ data: { due: false } });
  creationOptionsMock.mockResolvedValue({ data: { transition: null } });
  deleteMock.mockResolvedValue({});
  undeleteMock.mockResolvedValue({ data: seasons[1] });
  createMock.mockResolvedValue({ data: season(4, '2027-09-01', '2028-08-31') });
  createTransitionMock.mockResolvedValue({ data: { created: [] } });
  updateMock.mockResolvedValue({ data: seasons[0] });
  copyFromMock.mockResolvedValue({ data: { copied: 0 } });
  activeProjectIdRef.current = 1;
  stashAtReload.length = 0;
  reloadMock.mockImplementation(() => {
    stashAtReload.push(window.sessionStorage.getItem('pendingSeasonDeletions'));
  });
  Object.defineProperty(window, 'location', {
    value: { ...window.location, reload: reloadMock },
    writable: true,
  });
});

describe('useActiveSeason', () => {
  it('persists the resolved fallback season id so the X-Season-Id header never goes missing', async () => {
    const { result } = renderHook(() => useActiveSeason());
    await waitFor(() => expect(result.current.activeSeason?.id).toBe(3));
    expect(window.localStorage.getItem('activeSeasonId:1')).toBe('3');
  });

  it('deleting the active season points the stored id at the next season, reloads, and keeps the undo', async () => {
    window.localStorage.setItem('activeSeasonId:1', '3');
    const { result } = renderHook(() => useActiveSeason());
    await waitFor(() => expect(result.current.seasons).toHaveLength(3));

    await act(async () => {
      await result.current.deleteSeason(seasons[0]);
    });

    expect(deleteMock).toHaveBeenCalledWith(3);
    expect(window.localStorage.getItem('activeSeasonId:1')).toBe('2');
    expect(reloadMock).toHaveBeenCalled();
    const stashed = JSON.parse(window.sessionStorage.getItem('pendingSeasonDeletions') ?? '[]');
    expect(stashed).toHaveLength(1);
    expect(stashed[0]).toMatchObject({ seasonId: 3, restoreAsActive: true });
  });

  it('deleting a non-active season shows the undo snackbar without reloading', async () => {
    window.localStorage.setItem('activeSeasonId:1', '3');
    const { result } = renderHook(() => useActiveSeason());
    await waitFor(() => expect(result.current.seasons).toHaveLength(3));

    await act(async () => {
      await result.current.deleteSeason(seasons[1]);
    });

    expect(reloadMock).not.toHaveBeenCalled();
    expect(result.current.pendingDeletions).toHaveLength(1);
    expect(result.current.pendingDeletions[0]).toMatchObject({ seasonId: 2, restoreAsActive: false });
  });

  it('rehydrates a stashed deletion after the reload and restores it as active on undo', async () => {
    window.localStorage.setItem('activeSeasonId:1', '2');
    window.sessionStorage.setItem('pendingSeasonDeletions', JSON.stringify([
      { id: 'x', seasonId: 3, message: 'gone', expiresAt: Date.now() + 10_000, restoreAsActive: true },
    ]));

    const { result } = renderHook(() => useActiveSeason());
    await waitFor(() => expect(result.current.pendingDeletions).toHaveLength(1));

    await act(async () => {
      await result.current.undoPendingDeletion('x');
    });

    expect(undeleteMock).toHaveBeenCalledWith(3);
    expect(window.localStorage.getItem('activeSeasonId:1')).toBe('3');
    expect(reloadMock).toHaveBeenCalled();
    // The stashed entry is cleared synchronously before the reload, so the
    // snackbar does not come back for the already-restored season.
    expect(JSON.parse(window.sessionStorage.getItem('pendingSeasonDeletions') ?? '[]')).toHaveLength(0);
  });
});

describe('useActiveSeason — loading', () => {
  it('reports the loaded flag without calling the API when no project is active', async () => {
    // The hook is mounted by RootLayout before a project is picked; hitting the
    // season endpoints then would 400 on the missing project scope.
    activeProjectIdRef.current = null;
    const { result } = renderHook(() => useActiveSeason());

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(listMock).not.toHaveBeenCalled();
    expect(result.current.seasons).toEqual([]);
    expect(result.current.activeSeason).toBeNull();
  });

  it('surfaces a load failure as a localized message and still finishes loading', async () => {
    listMock.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useActiveSeason());

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.error).toBeTruthy();
    // `loading` must clear even on the failure path, or the switcher spins for
    // good.
    expect(result.current.loading).toBe(false);
  });

  it('clears a previous error when a later load succeeds', async () => {
    listMock.mockRejectedValueOnce(new Error('offline'));
    const { result, rerender } = renderHook(() => useActiveSeason());
    await waitFor(() => expect(result.current.error).toBeTruthy());

    await act(async () => {
      await result.current.reload();
    });
    rerender();

    expect(result.current.error).toBeNull();
    expect(result.current.seasons).toHaveLength(3);
  });

  it('exposes the due suggestion and creation options the switcher renders from', async () => {
    dueMock.mockResolvedValue({ data: { due: true, suggested_start: '2027-09-01' } });
    creationOptionsMock.mockResolvedValue({ data: { transition: { start_date: '2027-01-01' } } });

    const { result } = renderHook(() => useActiveSeason());

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.dueSuggestion).toMatchObject({ due: true });
    expect(result.current.seasonCreationOptions).toMatchObject({ transition: expect.anything() });
  });
});

describe('useActiveSeason — active season resolution', () => {
  it('honours a stored id that still matches a season', async () => {
    window.localStorage.setItem('activeSeasonId:1', '1');
    const { result } = renderHook(() => useActiveSeason());

    await waitFor(() => expect(result.current.seasons).toHaveLength(3));
    // Season 1 is the oldest, so picking it can only come from the stored id —
    // the fallback would land on the newest.
    expect(result.current.activeSeason?.id).toBe(1);
  });

  it('falls back to the newest season and rewrites a stale stored id', async () => {
    window.localStorage.setItem('activeSeasonId:1', '999');
    const { result } = renderHook(() => useActiveSeason());

    await waitFor(() => expect(result.current.activeSeason?.id).toBe(3));
    expect(window.localStorage.getItem('activeSeasonId:1')).toBe('3');
  });

  it('leaves the stored id untouched when the project has no seasons at all', async () => {
    listMock.mockResolvedValue({ data: { results: [] } });
    const { result } = renderHook(() => useActiveSeason());

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.activeSeason).toBeNull();
    expect(window.localStorage.getItem('activeSeasonId:1')).toBeNull();
  });
});

describe('useActiveSeason — mutations', () => {
  it('switching a season stores the id and reloads rather than re-fetching in place', async () => {
    // Every planting-plan-backed page holds season-scoped state, so the switch
    // is deliberately a full reload — see the comment on switchSeason.
    const { result } = renderHook(() => useActiveSeason());
    await waitFor(() => expect(result.current.seasons).toHaveLength(3));
    listMock.mockClear();

    act(() => result.current.switchSeason(1));

    expect(window.localStorage.getItem('activeSeasonId:1')).toBe('1');
    expect(reloadMock).toHaveBeenCalled();
    expect(listMock).not.toHaveBeenCalled();
  });

  it('ignores a season switch while no project is active', async () => {
    activeProjectIdRef.current = null;
    const { result } = renderHook(() => useActiveSeason());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    act(() => result.current.switchSeason(1));

    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('creates a season and reloads the list', async () => {
    const { result } = renderHook(() => useActiveSeason());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    listMock.mockClear();

    let created;
    await act(async () => {
      created = await result.current.createSeason('2027-09-01', '2028-08-31');
    });

    expect(createMock).toHaveBeenCalledWith({
      start_date: '2027-09-01', end_date: '2028-08-31',
    });
    expect(copyFromMock).not.toHaveBeenCalled();
    expect(listMock).toHaveBeenCalled();
    expect(created).toMatchObject({ id: 4 });
  });

  it('copies into the new season before reloading when a source is given', async () => {
    const { result } = renderHook(() => useActiveSeason());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.createSeason('2027-09-01', '2028-08-31', 2);
    });

    // Copying targets the season that was just created, not the source.
    expect(copyFromMock).toHaveBeenCalledWith(4, 2);
  });

  it('creates the transition seasons and returns the response payload', async () => {
    createTransitionMock.mockResolvedValue({ data: { created: [4, 5] } });
    const { result } = renderHook(() => useActiveSeason());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    listMock.mockClear();

    let response;
    await act(async () => {
      response = await result.current.createTransitionSeasons(true);
    });

    expect(createTransitionMock).toHaveBeenCalledWith({ copy: true });
    expect(response).toEqual({ created: [4, 5] });
    expect(listMock).toHaveBeenCalled();
  });

  it('renames a season through the custom label only', async () => {
    const { result } = renderHook(() => useActiveSeason());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.renameSeason(2, 'Saison Süd');
    });

    // A rename must not touch the dates the label is otherwise computed from.
    expect(updateMock).toHaveBeenCalledWith(2, { custom_label: 'Saison Süd' });
  });

  it('updates a season period without clearing its custom label', async () => {
    const { result } = renderHook(() => useActiveSeason());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.updateSeasonPeriod(2, {
        start_date: '2025-10-01', end_date: '2026-09-30',
      });
    });

    expect(updateMock).toHaveBeenCalledWith(2, {
      start_date: '2025-10-01', end_date: '2026-09-30',
    });
  });

  it('copies data into an existing season and returns the summary', async () => {
    copyFromMock.mockResolvedValue({ data: { copied: 12 } });
    const { result } = renderHook(() => useActiveSeason());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    listMock.mockClear();

    let summary;
    await act(async () => {
      summary = await result.current.copyDataInto(1, 2);
    });

    expect(copyFromMock).toHaveBeenCalledWith(1, 2);
    expect(summary).toEqual({ copied: 12 });
    expect(listMock).toHaveBeenCalled();
  });
});

describe('useActiveSeason — pending deletions', () => {
  it('clears the stored id when the deleted active season was the last one', async () => {
    listMock.mockResolvedValue({ data: { results: [seasons[0]] } });
    window.localStorage.setItem('activeSeasonId:1', '3');
    const { result } = renderHook(() => useActiveSeason());
    await waitFor(() => expect(result.current.seasons).toHaveLength(1));

    await act(async () => {
      await result.current.deleteSeason(seasons[0]);
    });

    // No season remains to fall back to; leaving the id pointing at the deleted
    // one would send a dead X-Season-Id header after the reload.
    expect(window.localStorage.getItem('activeSeasonId:1')).toBeNull();
    expect(reloadMock).toHaveBeenCalled();
  });

  it('undoes a non-active deletion in place, without a reload', async () => {
    window.localStorage.setItem('activeSeasonId:1', '3');
    const { result } = renderHook(() => useActiveSeason());
    await waitFor(() => expect(result.current.seasons).toHaveLength(3));
    await act(async () => {
      await result.current.deleteSeason(seasons[1]);
    });
    const deletionId = result.current.pendingDeletions[0].id;

    await act(async () => {
      await result.current.undoPendingDeletion(deletionId);
    });

    expect(undeleteMock).toHaveBeenCalledWith(2);
    expect(reloadMock).not.toHaveBeenCalled();
    expect(result.current.pendingDeletions).toHaveLength(0);
    // The active season was never this one, so the stored id must not move.
    expect(window.localStorage.getItem('activeSeasonId:1')).toBe('3');
  });

  it('ignores an undo for an id that is no longer pending', async () => {
    const { result } = renderHook(() => useActiveSeason());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.undoPendingDeletion('never-existed');
    });

    expect(undeleteMock).not.toHaveBeenCalled();
  });

  it('hides the snackbar without dropping the entry, so undo still works', async () => {
    // Closing the snackbar is not the same as letting the undo window elapse —
    // the entry has to stay until it actually expires.
    window.localStorage.setItem('activeSeasonId:1', '3');
    const { result } = renderHook(() => useActiveSeason());
    await waitFor(() => expect(result.current.seasons).toHaveLength(3));
    await act(async () => {
      await result.current.deleteSeason(seasons[1]);
    });
    const deletionId = result.current.pendingDeletions[0].id;

    act(() => result.current.closePendingDeletionSnackbar(deletionId));

    expect(result.current.pendingDeletions).toHaveLength(1);
    expect(result.current.pendingDeletions[0].visible).toBe(false);
  });

  it('drops the entry once the undo window elapses', async () => {
    vi.useFakeTimers();
    try {
      window.localStorage.setItem('activeSeasonId:1', '3');
      const { result } = renderHook(() => useActiveSeason());
      await act(async () => { await vi.runOnlyPendingTimersAsync(); });
      await act(async () => {
        await result.current.deleteSeason(seasons[1]);
      });
      expect(result.current.pendingDeletions).toHaveLength(1);

      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });

      expect(result.current.pendingDeletions).toHaveLength(0);
      expect(window.sessionStorage.getItem('pendingSeasonDeletions')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('arms a rehydrated entry with its remaining time, not a fresh full window', async () => {
    // The entry was stashed before the reload; re-arming it for the full 10s
    // would extend the undo window every time the page reloads.
    vi.useFakeTimers();
    try {
      window.sessionStorage.setItem('pendingSeasonDeletions', JSON.stringify([
        { id: 'x', seasonId: 2, message: 'weg', expiresAt: Date.now() + 2_000, restoreAsActive: false },
      ]));
      const { result } = renderHook(() => useActiveSeason());
      // Advance by zero rather than running pending timers: the rehydrated
      // entry's own expiry is already armed, and running it here would drop the
      // entry before the assertion that it survived the mount.
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(result.current.pendingDeletions).toHaveLength(1);

      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });

      expect(result.current.pendingDeletions).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops an entry whose window had already elapsed before the reload', async () => {
    window.sessionStorage.setItem('pendingSeasonDeletions', JSON.stringify([
      { id: 'stale', seasonId: 2, message: 'weg', expiresAt: Date.now() - 1, restoreAsActive: false },
    ]));
    const { result } = renderHook(() => useActiveSeason());

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.pendingDeletions).toHaveLength(0);
  });

  it('clears the expiry timers on unmount', async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(window, 'clearTimeout');
    try {
      window.localStorage.setItem('activeSeasonId:1', '3');
      const { result, unmount } = renderHook(() => useActiveSeason());
      await act(async () => { await vi.runOnlyPendingTimersAsync(); });
      await act(async () => {
        await result.current.deleteSeason(seasons[1]);
      });
      clearSpy.mockClear();

      unmount();

      expect(clearSpy).toHaveBeenCalled();
    } finally {
      clearSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe('useActiveSeason — writes that only a spy can see', () => {
  it('does not rewrite the stored id when it already points at the active season', async () => {
    // The effect exists to repair a stale or missing id. Dropping its equality
    // check would write the same value on every render — invisible in state,
    // but a storage write per render all the same.
    window.localStorage.setItem('activeSeasonId:1', '3');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    try {
      const { result, rerender } = renderHook(() => useActiveSeason());
      await waitFor(() => expect(result.current.activeSeason?.id).toBe(3));
      setItem.mockClear();
      rerender();
      rerender();

      expect(setItem).not.toHaveBeenCalledWith('activeSeasonId:1', '3');
    } finally {
      setItem.mockRestore();
    }
  });

  it('arms one expiry timer per deletion, however often the effect re-runs', async () => {
    // `vi.getTimerCount()` reads the armed timers straight off the fake clock.
    // Spying on `window.setTimeout` would measure the same thing but leaves the
    // patched function behind once fake timers are torn down, which breaks
    // `waitFor` in every test that follows.
    vi.useFakeTimers();
    try {
      window.localStorage.setItem('activeSeasonId:1', '3');
      const { result, rerender } = renderHook(() => useActiveSeason());
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      await act(async () => {
        await result.current.deleteSeason(seasons[1]);
      });
      const armed = vi.getTimerCount();

      act(() => result.current.closePendingDeletionSnackbar(
        result.current.pendingDeletions[0].id,
      ));
      rerender();

      // Hiding the snackbar changes the pendingDeletions array, re-running the
      // mirroring effect. Without the already-armed check each pass would stack
      // another timer on the same entry. The absolute count is not asserted —
      // React and the resolved API promises arm timers of their own — only that
      // re-running the effect adds none.
      expect(vi.getTimerCount()).toBe(armed);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps an already-stashed deletion when the active season is deleted too', async () => {
    // The stash is written by hand on this path, before the reload the
    // mirroring effect never gets to run for. Overwriting instead of appending
    // would silently drop an undo the user still has open.
    window.localStorage.setItem('activeSeasonId:1', '3');
    window.sessionStorage.setItem('pendingSeasonDeletions', JSON.stringify([
      { id: 'earlier', seasonId: 1, message: 'weg', expiresAt: Date.now() + 10_000, restoreAsActive: false },
    ]));
    const { result } = renderHook(() => useActiveSeason());
    await waitFor(() => expect(result.current.seasons).toHaveLength(3));

    await act(async () => {
      await result.current.deleteSeason(seasons[0]);
    });

    const stashed = JSON.parse(stashAtReload[0] ?? '[]');
    expect(stashed.map((entry: { seasonId: number }) => entry.seasonId).sort()).toEqual([1, 3]);
  });

  it('clears the stash before reloading, not merely by the time React settles', async () => {
    // In a browser the reload tears the page down, so the effect that mirrors
    // state to sessionStorage never runs — only the synchronous clear inside
    // undoPendingDeletion does. Under jsdom the reload is a no-op and the
    // effect does run, so asserting on the end state proves nothing; this
    // reads the stash as it stood at the moment reload was called.
    window.localStorage.setItem('activeSeasonId:1', '2');
    window.sessionStorage.setItem('pendingSeasonDeletions', JSON.stringify([
      { id: 'x', seasonId: 3, message: 'weg', expiresAt: Date.now() + 10_000, restoreAsActive: true },
    ]));
    const { result } = renderHook(() => useActiveSeason());
    await waitFor(() => expect(result.current.pendingDeletions).toHaveLength(1));

    await act(async () => {
      await result.current.undoPendingDeletion('x');
    });

    expect(stashAtReload).toHaveLength(1);
    expect(JSON.parse(stashAtReload[0] ?? '[]')).toEqual([]);
  });
});
