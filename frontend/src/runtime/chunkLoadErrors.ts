import { unregisterServiceWorkers } from '../pwa/registerServiceWorker';

const CHUNK_RELOAD_STORAGE_KEY = 'openFarmPlanner.lastChunkReloadAt';
const CHUNK_RELOAD_WINDOW_MS = 60_000;
const ROUTE_LOAD_RETRY_STORAGE_PREFIX = 'openFarmPlanner.routeLoadRetry.';
const ROUTE_LOAD_RETRY_WINDOW_MS = 60_000;

const DYNAMIC_IMPORT_ERROR_PATTERNS = [
  'failed to fetch dynamically imported module',
  'importing a module script failed',
  'error loading dynamically imported module',
  'chunkloaderror',
  'loading chunk',
  'loading css chunk',
  'unable to preload css',
  'vite:preloaderror',
];

function getErrorText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name} ${error.message}`.toLowerCase();
  }

  if (typeof error === 'string') {
    return error.toLowerCase();
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const parts = [record.name, record.message, record.type, record.reason, record.payload]
      .filter((value): value is string => typeof value === 'string');
    return parts.join(' ').toLowerCase();
  }

  return '';
}

function getSessionStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function getRouteLoadRetryStorageKey(routeKey: string): string {
  return `${ROUTE_LOAD_RETRY_STORAGE_PREFIX}${routeKey}`;
}

function getCurrentRouteKey(): string {
  return `${window.location.pathname}${window.location.search}`;
}

export function isDynamicImportLoadError(error: unknown): boolean {
  const errorText = getErrorText(error);
  return DYNAMIC_IMPORT_ERROR_PATTERNS.some((pattern) => errorText.includes(pattern));
}

export function shouldAutomaticallyReloadForChunkError(now = Date.now()): boolean {
  const storage = getSessionStorage();
  if (!storage) {
    return false;
  }

  const previousReloadAt = Number(storage.getItem(CHUNK_RELOAD_STORAGE_KEY));
  if (Number.isFinite(previousReloadAt) && now - previousReloadAt < CHUNK_RELOAD_WINDOW_MS) {
    return false;
  }

  storage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(now));
  return true;
}

/**
 * Reads whether an automatic route reload is still allowed for `routeKey`
 * without consuming the budget. Lets a render path decide synchronously that
 * the fallback is imminent (avoiding a blank frame) while the authoritative
 * one-shot claim still happens in `shouldAutomaticallyReloadForRouteLoadError`.
 */
export function routeLoadRetryIsAvailable(
  routeKey = getCurrentRouteKey(),
  now = Date.now(),
): boolean {
  const storage = getSessionStorage();
  if (!storage) {
    return false;
  }

  const previousRetryAt = Number(storage.getItem(getRouteLoadRetryStorageKey(routeKey)));
  return !(
    Number.isFinite(previousRetryAt)
    && previousRetryAt > 0
    && now - previousRetryAt < ROUTE_LOAD_RETRY_WINDOW_MS
  );
}

export function shouldAutomaticallyReloadForRouteLoadError(
  routeKey = getCurrentRouteKey(),
  now = Date.now(),
): boolean {
  const storage = getSessionStorage();
  if (!storage) {
    return false;
  }

  if (!routeLoadRetryIsAvailable(routeKey, now)) {
    return false;
  }

  storage.setItem(getRouteLoadRetryStorageKey(routeKey), String(now));
  return true;
}

export function clearRouteLoadRetry(routeKey = getCurrentRouteKey()): void {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  storage.removeItem(getRouteLoadRetryStorageKey(routeKey));
}

/**
 * A stale service worker left over from an older build can keep serving its
 * own mismatched precached assets after a plain reload (see
 * `unregisterServiceWorkers`'s doc comment). Clearing it first is what makes
 * this reload an actual recovery attempt rather than a repeat of the same
 * failure.
 */
export function reloadPage(): void {
  void unregisterServiceWorkers()
    .catch(() => {
      /* unregisterServiceWorkers already swallows its own failures; this is
         only a safeguard against a mocked or future implementation that does not. */
    })
    .finally(() => {
      window.location.reload();
    });
}

export function reloadOnceForDynamicImportError(error: unknown): boolean {
  if (!isDynamicImportLoadError(error) || !shouldAutomaticallyReloadForChunkError()) {
    return false;
  }

  reloadPage();
  return true;
}

/**
 * Marks both automatic-recovery guards as just spent for `routeKey`.
 *
 * The manual reload button performs the reload itself, so that reload *is* the
 * one retry attempt: once the page comes back the boundary and the global
 * handler must show the fallback again instead of firing a second automatic
 * reload (which would flash another blank screen).
 */
export function markDynamicImportRecoverySpent(
  routeKey = getCurrentRouteKey(),
  now = Date.now(),
): void {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }

  storage.setItem(CHUNK_RELOAD_STORAGE_KEY, String(now));
  storage.setItem(getRouteLoadRetryStorageKey(routeKey), String(now));
}

export function reloadForManualRecovery(routeKey = getCurrentRouteKey()): void {
  markDynamicImportRecoverySpent(routeKey);
  reloadPage();
}
