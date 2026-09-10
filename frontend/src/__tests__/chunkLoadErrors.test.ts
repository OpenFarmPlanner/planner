import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearRouteLoadRetry,
  isDynamicImportLoadError,
  markDynamicImportRecoverySpent,
  routeLoadRetryIsAvailable,
  shouldAutomaticallyReloadForChunkError,
  shouldAutomaticallyReloadForRouteLoadError,
} from '../runtime/chunkLoadErrors';

describe('route load error recovery', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('allows one automatic reload per route', () => {
    expect(shouldAutomaticallyReloadForRouteLoadError('/app/gantt-chart')).toBe(true);
    expect(shouldAutomaticallyReloadForRouteLoadError('/app/gantt-chart')).toBe(false);
  });

  it('tracks retries independently for each route', () => {
    expect(shouldAutomaticallyReloadForRouteLoadError('/app/gantt-chart')).toBe(true);
    expect(shouldAutomaticallyReloadForRouteLoadError('/app/fields-beds')).toBe(true);
    expect(shouldAutomaticallyReloadForRouteLoadError('/app/gantt-chart')).toBe(false);
  });

  it('allows retrying a route again after a successful load clears the marker', () => {
    expect(shouldAutomaticallyReloadForRouteLoadError('/app/fields-beds')).toBe(true);
    expect(shouldAutomaticallyReloadForRouteLoadError('/app/fields-beds')).toBe(false);

    clearRouteLoadRetry('/app/fields-beds');

    expect(shouldAutomaticallyReloadForRouteLoadError('/app/fields-beds')).toBe(true);
  });

  it('allows retrying a route again once the retry window has passed', () => {
    const now = 1_000_000;

    expect(shouldAutomaticallyReloadForRouteLoadError('/app/crop-library', now)).toBe(true);
    expect(shouldAutomaticallyReloadForRouteLoadError('/app/crop-library', now + 59_000)).toBe(false);
    expect(shouldAutomaticallyReloadForRouteLoadError('/app/crop-library', now + 61_000)).toBe(true);
  });

  it('peeks the route retry budget without consuming it', () => {
    const now = 1_000_000;

    expect(routeLoadRetryIsAvailable('/app/crop-library', now)).toBe(true);
    expect(routeLoadRetryIsAvailable('/app/crop-library', now)).toBe(true);
    expect(shouldAutomaticallyReloadForRouteLoadError('/app/crop-library', now)).toBe(true);
    expect(routeLoadRetryIsAvailable('/app/crop-library', now)).toBe(false);
    expect(routeLoadRetryIsAvailable('/app/crop-library', now + 61_000)).toBe(true);
  });

  it('marks both guards spent so a manual reload does not trigger a second automatic reload', () => {
    const now = 1_000_000;

    markDynamicImportRecoverySpent('/app/crop-library', now);

    expect(shouldAutomaticallyReloadForChunkError(now)).toBe(false);
    expect(shouldAutomaticallyReloadForRouteLoadError('/app/crop-library', now)).toBe(false);
    expect(routeLoadRetryIsAvailable('/app/crop-library', now)).toBe(false);
  });
});

describe('isDynamicImportLoadError', () => {
  it('recognises the message every bundler and browser words differently', () => {
    // One deploy replacing the chunk files produces all of these, depending on
    // browser and whether it was a JS or CSS chunk.
    const messages = [
      'Failed to fetch dynamically imported module: /assets/Crops-abc.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',
      'Loading chunk 42 failed',
      'Loading CSS chunk 7 failed',
      'Unable to preload CSS for /assets/Crops-abc.css',
    ];

    for (const message of messages) {
      expect(isDynamicImportLoadError(new Error(message))).toBe(true);
    }
  });

  it('matches regardless of casing', () => {
    expect(isDynamicImportLoadError(new Error('FAILED TO FETCH DYNAMICALLY IMPORTED MODULE'))).toBe(true);
  });

  it('matches on the error name as well as the message', () => {
    const error = new Error('etwas ging schief');
    error.name = 'ChunkLoadError';

    expect(isDynamicImportLoadError(error)).toBe(true);
  });

  it('reads a bare string error', () => {
    expect(isDynamicImportLoadError('Loading chunk 3 failed')).toBe(true);
    expect(isDynamicImportLoadError('etwas anderes')).toBe(false);
  });

  it('reads the shapes that arrive from event handlers rather than throws', () => {
    // A `vite:preloadError` event and an unhandled rejection are not Errors.
    expect(isDynamicImportLoadError({ type: 'vite:preloadError' })).toBe(true);
    expect(isDynamicImportLoadError({ reason: 'Loading chunk 3 failed' })).toBe(true);
    expect(isDynamicImportLoadError({ payload: 'unable to preload css' })).toBe(true);
    expect(isDynamicImportLoadError({ name: 'ChunkLoadError' })).toBe(true);
  });

  it('ignores non-string fields instead of stringifying them into a match', () => {
    // An array stringifies to its contents, so blindly coercing would turn a
    // nested value into a false positive and reload on an unrelated error.
    expect(isDynamicImportLoadError({ reason: ['Loading chunk 3 failed'] })).toBe(false);
    expect(isDynamicImportLoadError({ message: 42 })).toBe(false);
  });

  it('says no to an ordinary application error, so it is not reloaded away', () => {
    // Reloading on a real bug would hide it behind an endless refresh.
    expect(isDynamicImportLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isDynamicImportLoadError(new TypeError('x is not a function'))).toBe(false);
  });

  it('says no to values that carry no text at all', () => {
    expect(isDynamicImportLoadError(null)).toBe(false);
    expect(isDynamicImportLoadError(undefined)).toBe(false);
    expect(isDynamicImportLoadError(42)).toBe(false);
    expect(isDynamicImportLoadError({})).toBe(false);
  });
});

describe('shouldAutomaticallyReloadForChunkError', () => {
  // Real epoch milliseconds: an absent marker reads back as `Number(null)` = 0,
  // and unlike `routeLoadRetryIsAvailable` this guard has no `> 0` check, so a
  // timestamp under 60_000 would compare against epoch zero and refuse. Only
  // reachable with fabricated clocks, but it is why these use real values.
  const NOW = 1_800_000_000_000;

  beforeEach(() => {
    sessionStorage.clear();
  });

  it('allows one reload, then refuses within the same minute', () => {
    expect(shouldAutomaticallyReloadForChunkError(NOW)).toBe(true);
    expect(shouldAutomaticallyReloadForChunkError(NOW + 1_000)).toBe(false);
    expect(shouldAutomaticallyReloadForChunkError(NOW + 59_500)).toBe(false);
  });

  it('allows another reload once the window has passed', () => {
    shouldAutomaticallyReloadForChunkError(NOW);

    expect(shouldAutomaticallyReloadForChunkError(NOW + 60_001)).toBe(true);
  });

  it('measures the window from the reload it last allowed, not the first one', () => {
    shouldAutomaticallyReloadForChunkError(NOW);
    shouldAutomaticallyReloadForChunkError(NOW + 60_001);

    expect(shouldAutomaticallyReloadForChunkError(NOW + 90_000)).toBe(false);
  });

  it('treats a corrupted marker as no marker rather than blocking forever', () => {
    sessionStorage.setItem('openFarmPlanner.lastChunkReloadAt', 'unsinn');

    expect(shouldAutomaticallyReloadForChunkError(NOW)).toBe(true);
  });
});
