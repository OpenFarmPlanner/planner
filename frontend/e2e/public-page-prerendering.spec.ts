import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { PUBLIC_INDEXABLE_ROUTES } from '../src/seo/seoConfig';

// This suite verifies build/prerender.ts's actual output, so it depends on
// `dist/` already containing a real `npm run build` (which runs the
// prerender step as its `postbuild`) — exactly what `test:e2e` does before
// launching Playwright. It intentionally reads files from disk rather than
// going through the `vite preview` webServer for the "no JS" assertions:
// `vite preview`'s static server only resolves a route's prerendered
// `index.html` for a *trailing-slash* request (`/impressum/`, matching how
// production Apache redirects `/impressum` -> `/impressum/` and then serves
// it) — reading the file directly sidesteps that unrelated serving detail
// and asserts on the artifact `build/prerender.ts` actually produced.
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');

function distPathFor(routePath: string): string {
  return routePath === '/'
    ? path.join(distDir, 'index.html')
    : path.join(distDir, routePath.replace(/^\//, ''), 'index.html');
}

async function holdJavaScriptRequests(page: import('@playwright/test').Page): Promise<() => void> {
  let release: () => void = () => {};
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });

  await page.route(/\/assets\/.*\.js$/, async (route) => {
    await barrier;
    await route.continue();
  });

  return release;
}

test.describe('public page prerendering', () => {
  test('build produces a real index.html for every public route', () => {
    for (const route of PUBLIC_INDEXABLE_ROUTES) {
      expect(existsSync(distPathFor(route.path)), `missing prerendered file for ${route.path}`).toBe(true);
    }
  });

  test('each prerendered page has real body content, not an empty SPA shell', () => {
    for (const route of PUBLIC_INDEXABLE_ROUTES) {
      const html = readFileSync(distPathFor(route.path), 'utf-8');
      expect(html).toMatch(/<div id="root">\s*<[^/]/);
      expect(html).toMatch(/<h1[^>]*>[^<]+<\/h1>/);
    }
  });

  test('each prerendered page serializes CSS-in-JS rules needed for first paint', () => {
    for (const route of PUBLIC_INDEXABLE_ROUTES) {
      const html = readFileSync(distPathFor(route.path), 'utf-8');
      const emotionStyles = [...html.matchAll(/<style data-emotion="[^"]*"[^>]*>([\s\S]*?)<\/style>/g)]
        .map((match) => match[1].trim());

      expect(emotionStyles.length, `missing Emotion styles for ${route.path}`).toBeGreaterThan(0);
      expect(
        emotionStyles.some((style) => style.length > 0),
        `empty Emotion styles would leave prerendered ${route.path} unstyled before JS boots`,
      ).toBe(true);
    }
  });

  test('each prerendered page has its own correct canonical URL and single description', () => {
    for (const route of PUBLIC_INDEXABLE_ROUTES) {
      const html = readFileSync(distPathFor(route.path), 'utf-8');
      const canonical = route.path === '/'
        ? 'https://openfarmplanner.org/'
        : `https://openfarmplanner.org${route.path}`;
      expect(html).toContain(`<link rel="canonical" href="${canonical}">`);
      expect(html.match(/name="description"/g)).toHaveLength(1);
      expect(html.match(/rel="canonical"/g)).toHaveLength(1);
    }
  });

  test('every prerendered page is marked index, follow', () => {
    for (const route of PUBLIC_INDEXABLE_ROUTES) {
      const html = readFileSync(distPathFor(route.path), 'utf-8');
      expect(html).toContain('<meta name="robots" content="index, follow">');
    }
  });

  test('non-indexable routes are never prerendered', () => {
    expect(existsSync(path.join(distDir, 'app'))).toBe(false);
    expect(existsSync(path.join(distDir, 'login'))).toBe(false);
    expect(existsSync(path.join(distDir, 'register'))).toBe(false);
  });

  test('app-shell.html stays the empty SPA shell, not the prerendered landing page', () => {
    // Production's Apache SPA fallback serves this file for any route that
    // isn't one of the prerendered public pages above (all /app/*, /login,
    // etc.) - see ops/deploy/deploy_frontend.sh. If this ever
    // regressed to contain rendered landing-page markup again, reloading an
    // authenticated route in production would flash the landing/login page
    // before the SPA bundle boots.
    const appShellPath = path.join(distDir, 'app-shell.html');
    expect(existsSync(appShellPath), 'missing dist/app-shell.html').toBe(true);

    const html = readFileSync(appShellPath, 'utf-8');
    expect(html).toMatch(/<div id="root">\s*<\/div>/);
    expect(html).not.toMatch(/<h1[^>]*>[^<]+<\/h1>/);
  });

  test('English browser language hides German prerendered landing text until the SPA is ready', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();
    const releaseJavaScript = await holdJavaScriptRequests(page);

    await page.goto('/', { waitUntil: 'commit' });
    await page.waitForFunction(() => document.documentElement.dataset.initialUiLanguage === 'en');

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveClass(/ofp-hide-prerender/);
    await expect(page.getByText('Open-Source-Anbauplaner für den Gemüsebau.')).not.toBeVisible();
    await expect(page.getByText('Open-source crop planning for vegetable production.')).not.toBeVisible();

    releaseJavaScript();

    await expect(page.getByText('Open-source crop planning for vegetable production.')).toBeVisible();
    await expect(page.getByText('Open-Source-Anbauplaner für den Gemüsebau.')).not.toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).not.toHaveClass(/ofp-hide-prerender/);
    await context.close();
  });

  test('a persisted English language hides German prerendered landing text before app code loads', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('ui.language', 'en');
    });
    const releaseJavaScript = await holdJavaScriptRequests(page);

    await page.goto('/', { waitUntil: 'commit' });
    await page.waitForFunction(() => document.documentElement.dataset.initialUiLanguage === 'en');

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveClass(/ofp-hide-prerender/);
    await expect(page.getByText('Open-Source-Anbauplaner für den Gemüsebau.')).not.toBeVisible();

    releaseJavaScript();

    await expect(page.getByText('Open-source crop planning for vegetable production.')).toBeVisible();
    await expect(page.getByText('Open-Source-Anbauplaner für den Gemüsebau.')).not.toBeVisible();
    await expect(page.locator('html')).not.toHaveClass(/ofp-hide-prerender/);
  });

  test('a JS-disabled browser sees the real privacy policy content, not a blank shell', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    // Trailing slash: see the module comment above re: vite preview's static
    // serving of directory-index files.
    await page.goto('/datenschutz/');
    await expect(page.locator('h1')).toHaveText('Datenschutzerklärung');
    await expect(page.getByText('Verantwortlicher', { exact: false }).first()).toBeVisible();
    await context.close();
  });

  test('a JS-disabled browser sees the landing page with critical styles applied', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/');

    await expect(page.locator('h1').first()).toHaveText('Open-Source-Anbauplaner für den Gemüsebau.');
    await expect(page.getByRole('banner').getByText('OpenFarmPlanner')).toBeVisible();
    const logo = page.locator('img[src="/favicon.png"]').first();
    await expect(logo).toBeVisible();
    await expect(logo).toHaveCSS('width', '32px');
    await expect(page.getByRole('link', { name: 'Registrieren' })).toHaveCSS('background-color', 'rgb(37, 111, 42)');
    await context.close();
  });

  test('the SPA takes over normally after loading a prerendered page (client nav still works)', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1').first()).toHaveText('Open-Source-Anbauplaner für den Gemüsebau.');
    // Client-side nav from the prerendered landing page to another public
    // page should work exactly as on any other SPA route — proves the
    // bundle boots fine on top of the prerendered markup (no interactivity
    // blocked by whatever `createRoot(...).render()` replaced).
    await page.getByRole('link', { name: 'Impressum' }).click();
    await expect(page).toHaveURL(/\/impressum$/);
    await expect(page.locator('h1')).toHaveText('Impressum');
  });
});
