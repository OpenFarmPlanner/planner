import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { loginWithDeterministicProject } from './utils';

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

/**
 * Pins the PWA setup's two load-bearing promises: the app is installable, and
 * the service worker caches build assets only. Functional assertions rather
 * than screenshots — none of this is visible in the rendered page.
 *
 * Runs against the preview server (`dist/`), which is where the manifest and
 * the generated `sw.js` exist at all; `npm run dev` deliberately ships no
 * service worker.
 */
test.describe('progressive web app', () => {
  test('serves an installable manifest', async ({ page, request }) => {
    await page.goto('/');

    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /manifest\.json$/);
    await expect(page.locator('meta[name="theme-color"]')).toHaveCount(1);

    const response = await request.get('/manifest.json');
    expect(response.ok()).toBeTruthy();

    const manifest = await response.json() as {
      name: string;
      short_name: string;
      display: string;
      start_url: string;
      icons: { src: string; sizes: string; purpose?: string }[];
    };
    expect(manifest.name).toBe('OpenFarmPlanner');
    expect(manifest.short_name).toBe('OFP');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/app/dashboard');
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(
      expect.arrayContaining(['192x192', '512x512']),
    );

    for (const icon of manifest.icons) {
      const iconResponse = await request.get(icon.src);
      expect(iconResponse.ok(), `${icon.src} is served`).toBeTruthy();
    }
  });

  test('caches build assets but never API responses or HTML', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'pwa');

    await page.waitForFunction(
      async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated',
      undefined,
      { timeout: 20_000 },
    );

    // Exercise an API endpoint through the active worker, so a caching
    // regression would have something to store.
    await page.goto('/app/crops');
    await expect(page.locator('h1')).toHaveText('Kulturen');

    const cachedUrls = await page.evaluate(async () => {
      const names = await caches.keys();
      const urls: string[] = [];
      for (const name of names) {
        const cache = await caches.open(name);
        for (const cachedRequest of await cache.keys()) {
          urls.push(new URL(cachedRequest.url).pathname);
        }
      }
      return urls;
    });

    expect(cachedUrls.some((url) => url.startsWith('/assets/') && url.endsWith('.js'))).toBeTruthy();
    expect(cachedUrls.filter((url) => url.startsWith('/api/'))).toEqual([]);
    expect(cachedUrls.filter((url) => url.endsWith('.html'))).toEqual([]);
    // The SPA shell is served for every app route; a cached "/" would pin a
    // stale document across deploys.
    expect(cachedUrls).not.toContain('/');
  });

  test('the generated API route matcher has no dangling reference to vite.config.ts scope', async () => {
    // Regression guard for a real bug: workbox-build serializes a function
    // urlPattern into sw.js via Function.prototype.toString() (see
    // runtime-caching-converter.js), which drops any closure. A matcher that
    // reads a variable from vite.config.ts's module scope (e.g.
    // `apiPathPrefix`) compiles there without error but throws
    // "<name> is not defined" once the browser evaluates the extracted
    // source with no access to that scope — a failure the other test above
    // cannot see, because Workbox silently drops a route whose matcher
    // throws instead of registering it, and an unmatched request still ends
    // up uncached either way. Extract the matcher's actual source from the
    // built sw.js and run it standalone, exactly as the worker does.
    const sw = await readFile(path.join(distDir, 'sw.js'), 'utf-8');

    const registerRouteCall = sw.match(/\.registerRoute\(([\s\S]*?),new [^,]+\.NetworkOnly/);
    expect(registerRouteCall, 'sw.js contains a NetworkOnly registerRoute call').not.toBeNull();

    const matcherSource = registerRouteCall![1];
    // Deliberately re-creating the matcher with no closure, exactly like
    // workbox-build's own toString()-then-reevaluate round trip.
    const matcher = new Function(`return ${matcherSource};`)() as (options: {
      url: URL;
      sameOrigin: boolean;
    }) => boolean;

    expect(() => matcher({ url: new URL('https://example.test/api/crops/'), sameOrigin: true })).not.toThrow();
    expect(matcher({ url: new URL('https://example.test/api/crops/'), sameOrigin: true })).toBe(true);
    expect(matcher({ url: new URL('https://example.test/app/dashboard'), sameOrigin: true })).toBe(false);
    expect(matcher({ url: new URL('https://example.test/api/crops/'), sameOrigin: false })).toBe(false);
  });
});
