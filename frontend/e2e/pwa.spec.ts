import { expect, test } from '@playwright/test';
import { loginWithDeterministicProject } from './utils';

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
});
