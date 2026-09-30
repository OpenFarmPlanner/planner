/**
 * Carries page state across the full reload a season switch performs.
 *
 * Switching seasons reloads the app (see `useActiveSeason.switchSeason`), which
 * would throw away page state such as the planting-plan search that is
 * specified to survive a season switch. A page registers a snapshot getter
 * while it is mounted; `stashSeasonSwitchState` writes the snapshots right
 * before the reload, and the page reads its snapshot back once on mount.
 *
 * This is deliberately not general persistence: the entry is keyed by project
 * (a project switch never restores it), written only on a season switch, and
 * removed after the first mount reads it, so a later reload or a return to the
 * page starts fresh.
 */

const STORAGE_PREFIX = 'seasonSwitchState:';

const snapshotGetters = new Map<string, () => unknown>();

const storageKey = (projectId: number): string => `${STORAGE_PREFIX}${projectId}`;

const readEntries = (projectId: number): Record<string, unknown> => {
  try {
    const raw = window.sessionStorage.getItem(storageKey(projectId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const writeEntries = (projectId: number, entries: Record<string, unknown>): void => {
  try {
    if (Object.keys(entries).length === 0) {
      window.sessionStorage.removeItem(storageKey(projectId));
    } else {
      window.sessionStorage.setItem(storageKey(projectId), JSON.stringify(entries));
    }
  } catch {
    // Storage can be unavailable (private mode, quota); the state is then simply not carried over.
  }
};

/** Registers the snapshot a page wants to keep across a season switch. Returns the unregister function. */
export function registerSeasonSwitchState(key: string, getSnapshot: () => unknown): () => void {
  snapshotGetters.set(key, getSnapshot);
  return () => {
    if (snapshotGetters.get(key) === getSnapshot) {
      snapshotGetters.delete(key);
    }
  };
}

/** Called right before the season-switch reload. */
export function stashSeasonSwitchState(projectId: number): void {
  const entries: Record<string, unknown> = {};
  for (const [key, getSnapshot] of snapshotGetters) {
    const snapshot = getSnapshot();
    if (snapshot !== undefined && snapshot !== null) {
      entries[key] = snapshot;
    }
  }
  writeEntries(projectId, entries);
}

/** The snapshot stashed for `key` before the last season switch, without consuming it. */
export function peekSeasonSwitchState(projectId: number, key: string): unknown {
  return readEntries(projectId)[key] ?? null;
}

/** Drops the stashed snapshot once the page has restored it. */
export function clearSeasonSwitchState(projectId: number, key: string): void {
  const entries = readEntries(projectId);
  if (key in entries) {
    delete entries[key];
    writeEntries(projectId, entries);
  }
}
