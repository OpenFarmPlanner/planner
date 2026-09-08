import {
  clearStoredActiveSeasonId,
  getStoredActiveSeasonId,
  setStoredActiveSeasonId,
} from '../seasons/activeSeasonStorage';
import {
  readPendingSeasonDeletions,
  writePendingSeasonDeletions,
  type StoredSeasonDeletion,
} from '../seasons/pendingSeasonDeletionStorage';

function deletion(overrides: Partial<StoredSeasonDeletion> = {}): StoredSeasonDeletion {
  return {
    id: 'deletion-1',
    seasonId: 7,
    message: 'Saison gelöscht',
    expiresAt: Date.now() + 10_000,
    restoreAsActive: false,
    ...overrides,
  };
}

describe('activeSeasonStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('round-trips the active season of a project', () => {
    setStoredActiveSeasonId(1, 42);

    expect(getStoredActiveSeasonId(1)).toBe(42);
  });

  it('namespaces per project, so switching projects cannot leak a stale season', () => {
    setStoredActiveSeasonId(1, 42);
    setStoredActiveSeasonId(2, 99);

    expect(getStoredActiveSeasonId(1)).toBe(42);
    expect(getStoredActiveSeasonId(2)).toBe(99);
    expect(getStoredActiveSeasonId(3)).toBeNull();
  });

  it('clears only the project it was asked to clear', () => {
    setStoredActiveSeasonId(1, 42);
    setStoredActiveSeasonId(2, 99);

    clearStoredActiveSeasonId(1);

    expect(getStoredActiveSeasonId(1)).toBeNull();
    expect(getStoredActiveSeasonId(2)).toBe(99);
  });

  it('uses the documented key, which open tabs depend on across a deploy', () => {
    setStoredActiveSeasonId(5, 3);

    expect(window.localStorage.getItem('activeSeasonId:5')).toBe('3');
  });

  it('treats an unparsable stored value as absent', () => {
    window.localStorage.setItem('activeSeasonId:1', 'not-a-number');

    expect(getStoredActiveSeasonId(1)).toBeNull();
  });
});

describe('pendingSeasonDeletionStorage', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('round-trips a pending deletion across a reload', () => {
    const entry = deletion();
    writePendingSeasonDeletions([entry]);

    expect(readPendingSeasonDeletions()).toEqual([entry]);
  });

  it('drops entries whose undo window has already elapsed', () => {
    const live = deletion({ id: 'live' });
    const expired = deletion({ id: 'expired', expiresAt: Date.now() - 1 });
    writePendingSeasonDeletions([live, expired]);

    expect(readPendingSeasonDeletions().map((e) => e.id)).toEqual(['live']);
  });

  it('clears the key entirely when the last entry goes', () => {
    writePendingSeasonDeletions([deletion()]);
    writePendingSeasonDeletions([]);

    expect(window.sessionStorage.getItem('pendingSeasonDeletions')).toBeNull();
  });

  it('preserves restoreAsActive, which decides whether undo switches back', () => {
    writePendingSeasonDeletions([deletion({ restoreAsActive: true })]);

    expect(readPendingSeasonDeletions()[0].restoreAsActive).toBe(true);
  });

  it('coerces a missing restoreAsActive rather than yielding undefined', () => {
    const withoutFlag = { ...deletion() } as Partial<StoredSeasonDeletion>;
    delete withoutFlag.restoreAsActive;
    window.sessionStorage.setItem('pendingSeasonDeletions', JSON.stringify([withoutFlag]));

    expect(readPendingSeasonDeletions()[0].restoreAsActive).toBe(false);
  });

  it('ignores malformed rows instead of surfacing them', () => {
    window.sessionStorage.setItem('pendingSeasonDeletions', JSON.stringify([
      deletion({ id: 'good' }),
      { id: 'no-season-id', expiresAt: Date.now() + 1000 },
      { seasonId: 3, expiresAt: Date.now() + 1000 },
    ]));

    expect(readPendingSeasonDeletions().map((e) => e.id)).toEqual(['good']);
  });

  it('survives unparsable JSON and a non-array payload', () => {
    window.sessionStorage.setItem('pendingSeasonDeletions', '{oops');
    expect(readPendingSeasonDeletions()).toEqual([]);

    window.sessionStorage.setItem('pendingSeasonDeletions', '"a string"');
    expect(readPendingSeasonDeletions()).toEqual([]);
  });

  it('degrades gracefully when sessionStorage refuses to write', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => writePendingSeasonDeletions([deletion()])).not.toThrow();
    setItem.mockRestore();
  });
});
