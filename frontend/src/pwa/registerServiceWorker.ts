/**
 * Service-worker registration for OpenFarmPlanner's PWA support.
 *
 * Scope is deliberately narrow: the worker exists to make the app installable
 * and to start faster from cached build assets. It caches **only** the
 * fingerprinted build output (JS, CSS, fonts, icons) and treats every API
 * request as network-only — see `docs/pwa.md` and the `VitePWA` block in
 * `vite.config.ts`.
 *
 * IMPORTANT for any future API caching: API requests are scoped by the
 * multi-tenancy headers `X-Project-Id` and `X-Season-Id` (see
 * `src/api/httpClient.ts`). A URL alone does not identify a response, so
 * caching API responses without folding those headers into the cache key
 * would serve one project's or season's data to another. No API caching
 * exists today precisely so that this cannot happen by accident.
 */

const SERVICE_WORKER_FILENAME = 'sw.js';

function isServiceWorkerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

/**
 * Registers the generated service worker once the page has loaded.
 *
 * Registration is intentionally deferred until `load`: it competes with the
 * app's own startup requests otherwise, which would trade the very startup
 * time the caching is meant to improve. Failures are swallowed on purpose —
 * an unavailable worker (private browsing, an unsupported browser, a blocked
 * scope) must never keep the app itself from booting.
 */
export function registerServiceWorker(baseUrl: string = import.meta.env.BASE_URL): void {
  if (!isServiceWorkerSupported() || !import.meta.env.PROD) {
    return;
  }

  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const serviceWorkerUrl = `${normalizedBase}${SERVICE_WORKER_FILENAME}`;

  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register(serviceWorkerUrl, { scope: normalizedBase })
      .catch(() => {
        /* Installability and asset caching are progressive enhancements. */
      });
  });
}
