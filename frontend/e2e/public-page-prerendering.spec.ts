import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { PUBLIC_PAGE_VARIANTS, buildCanonicalUrl } from '../src/seo/seoConfig';

// This suite verifies build/prerender.ts's actual output, so it depends on
// `dist/` already containing a real `npm run build` (which runs the
// prerender step as its `postbuild`) — exactly what `test:e2e` does before
// launching Playwright. File assertions read the artifact from disk; the
// browser assertions go through `vite preview`, which (like production's
// .htaccess) serves the flat `<path>.html` files for slashless URLs.
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const SITE = 'https://openfarmplanner.org';

function distPathFor(routePath: string): string {
  return routePath === '/'
    ? path.join(distDir, 'index.html')
    : path.join(distDir, `${routePath.replace(/^\//, '')}.html`);
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
  test('build produces a flat HTML file for every language version of every public page', () => {
    for (const route of PUBLIC_PAGE_VARIANTS) {
      expect(existsSync(distPathFor(route.path)), `missing prerendered file for ${route.path}`).toBe(true);
      // A directory of the same name would make static servers 301 the
      // slashless canonical URL to a trailing-slash variant. Only the
      // language roots (`/en`, `/fr`, `/es`) are also directories, holding
      // that language's pages; DirectorySlash Off covers them in production.
      if (route.page.id !== 'home') {
        expect(existsSync(path.join(distDir, route.path.replace(/^\//, ''))), `${route.path} must not be a directory`).toBe(false);
      }
    }
  });

  test('each prerendered page has real body content, not an empty SPA shell', () => {
    for (const route of PUBLIC_PAGE_VARIANTS) {
      const html = readFileSync(distPathFor(route.path), 'utf-8');
      expect(html).toMatch(/<div id="root">\s*<[^/]/);
      expect(html).toMatch(/<h1[^>]*>[^<]+<\/h1>/);
    }
  });

  test('each prerendered page serializes CSS-in-JS rules needed for first paint', () => {
    for (const route of PUBLIC_PAGE_VARIANTS) {
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

  test('each prerendered page has its own canonical, language and reciprocal hreflang set', () => {
    for (const route of PUBLIC_PAGE_VARIANTS) {
      const html = readFileSync(distPathFor(route.path), 'utf-8');
      expect(html).toContain(`<link rel="canonical" href="${buildCanonicalUrl(SITE, route.path)}">`);
      expect(html).toContain(`<html lang="${route.language}"`);
      expect(html.match(/name="description"/g)).toHaveLength(1);
      expect(html.match(/rel="canonical"/g)).toHaveLength(1);
      expect(html).toContain(`<link rel="alternate" hreflang="de" href="${buildCanonicalUrl(SITE, route.page.paths.de)}">`);
      expect(html).toContain(`<link rel="alternate" hreflang="en" href="${buildCanonicalUrl(SITE, route.page.paths.en)}">`);
      expect(html).toContain(`<link rel="alternate" hreflang="x-default" href="${buildCanonicalUrl(SITE, route.page.paths.de)}">`);
    }
  });

  test('English pages are prerendered with English content and meta', () => {
    const html = readFileSync(distPathFor('/en/about'), 'utf-8');
    expect(html).toContain('<title>About OpenFarmPlanner</title>');
    expect(html).toContain('<meta property="og:locale" content="en_US">');
    expect(html).toMatch(/<h1[^>]*>How OpenFarmPlanner came to be<\/h1>/);
    // Internal links stay in English.
    expect(html).toContain('href="/en/legal-notice"');
    expect(html).not.toContain('href="/impressum"');
  });

  test('every prerendered page is marked index, follow', () => {
    for (const route of PUBLIC_PAGE_VARIANTS) {
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

  test('a browser in an unsupported language is sent from a German page to its English version before first paint', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'it-IT' });
    const page = await context.newPage();

    const response = await page.goto('/ueber?ref=newsletter');
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/en\/about\?ref=newsletter$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('h1')).toHaveText('How OpenFarmPlanner came to be');
    await context.close();
  });

  for (const { locale, from, to, lang, heading } of [
    { locale: 'fr-CA', from: '/ueber', to: /\/fr\/a-propos$/, lang: 'fr', heading: 'Comment OpenFarmPlanner est né' },
    { locale: 'es-419', from: '/en/about', to: /\/es\/acerca-de$/, lang: 'es', heading: 'Cómo nació OpenFarmPlanner' },
  ]) {
    test(`a ${locale} browser is sent to the ${lang} version before first paint`, async ({ browser }) => {
      const context = await browser.newContext({ locale });
      const page = await context.newPage();

      const response = await page.goto(from);
      expect(response?.status()).toBe(200);
      await expect(page).toHaveURL(to);
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      await expect(page.locator('h1')).toHaveText(heading);
      await context.close();
    });
  }

  test('a German browser is sent from an English page to its German version', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'de-AT' });
    const page = await context.newPage();

    await page.goto('/en');
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.getByText('Open-Source-Anbauplaner für den Gemüsebau.')).toBeVisible();
    await context.close();
  });

  test('an explicit language choice wins over the browser language', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.localStorage.setItem('ui.language', 'de');
    });

    await page.goto('/ueber');
    await expect(page.locator('h1')).toHaveText('Wie OpenFarmPlanner entstanden ist');
    await expect(page).toHaveURL(/\/ueber$/);
    await context.close();
  });

  test('crawlers are never redirected and get each URL in its own language', async ({ browser }) => {
    const context = await browser.newContext({
      locale: 'en-US',
      userAgent:
        'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/141.0 Safari/537.36',
    });
    const page = await context.newPage();

    await page.goto('/ueber');
    await expect(page.locator('h1')).toHaveText('Wie OpenFarmPlanner entstanden ist');
    await expect(page).toHaveURL(/\/ueber$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await context.close();
  });

  test('a persisted English language hides the German app shell before app code loads', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('ui.language', 'en');
    });
    const releaseJavaScript = await holdJavaScriptRequests(page);

    // Non-public routes keep following the preference.
    await page.goto('/login', { waitUntil: 'commit' });
    await page.waitForFunction(() => document.documentElement.dataset.initialUiLanguage === 'en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    releaseJavaScript();

    await expect(page.locator('html')).not.toHaveClass(/ofp-hide-prerender/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('the language switcher links to the counterpart URL of the current page', async ({ page }) => {
    await page.goto('/ueber');
    await expect(page.locator('a[hreflang="en"][href="/en/about"]')).toHaveCount(1);
    await page.getByRole('button', { name: /Sprache/ }).first().click();
    await page.getByRole('menuitemradio', { name: 'English' }).click();
    await expect(page).toHaveURL(/\/en\/about$/);
    await expect(page.locator('h1')).toHaveText('How OpenFarmPlanner came to be');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('a JS-disabled browser sees the real privacy policy content, not a blank shell', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/datenschutz');
    await expect(page.locator('h1')).toHaveText('Datenschutzerklärung');
    await expect(page.getByText('Verantwortlicher', { exact: false }).first()).toBeVisible();
    await context.close();
  });

  test('a JS-disabled browser sees the landing page with critical styles applied', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/');

    await expect(page.locator('h1').first()).toHaveText('Open-Source-Anbauplaner für den Gemüsebau.');
    await expect(page.getByRole('banner').getByText('OpenFarmPlanner', { exact: true })).toBeVisible();
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
