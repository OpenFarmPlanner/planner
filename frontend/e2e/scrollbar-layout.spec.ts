import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * Guards the interaction between MUI's modal scroll lock and the page's own
 * overflow rules. When a `Menu`/`Popover`/`Dialog` opens, MUI hides the page
 * scrollbar and compensates its width with `padding-right` on `<body>`. That
 * only nets out when `<body>` really is the element whose overflow the viewport
 * uses — an `overflow-x` on `<html>` silently breaks it, and the page then
 * shrinks by the scrollbar width on every menu open.
 *
 * Functional/geometric assertions rather than screenshots: what matters is that
 * boxes keep their exact coordinates, which a pixel diff would only cover
 * indirectly while needing a re-baseline for every unrelated visual tweak.
 *
 * Runs in the `chromium-scrollbars` project, which keeps the classic scrollbar
 * that the default headless run hides — without it there is no scrollbar to
 * compensate and the regression is invisible. See playwright.config.ts.
 */

const AUTH_ROUTES = [
  { key: 'login', path: '/login', heading: /Anmelden/i },
  { key: 'register', path: '/register', heading: /Registrieren|Konto erstellen/i },
];

// Deliberately short: every page under test has to overflow vertically, or
// there is no scrollbar for the scroll lock to compensate.
const VIEWPORT = { width: 1280, height: 600 };

function languageButton(page: Page): Locator {
  return page.getByRole('button', { name: /Sprache|language/i }).first();
}

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  expect(value).not.toBeNull();
  return value!;
}

async function pageMetrics(page: Page) {
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyPaddingRight: getComputedStyle(document.body).paddingRight,
  }));
}

test.describe('scroll lock does not reshape the page', () => {
  test('the test environment actually renders a classic scrollbar', async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto('/register');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const metrics = await pageMetrics(page);
    // Without this the remaining assertions would pass vacuously.
    expect(metrics.innerWidth - metrics.clientWidth).toBeGreaterThan(0);
  });

  for (const route of AUTH_ROUTES) {
    test(`keeps the ${route.key} card and hero backdrop in place while the language menu is open`, async ({
      page,
    }) => {
      await page.setViewportSize(VIEWPORT);
      await page.goto(route.path);
      await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();

      // CSS rather than a role query: an open Modal marks the whole app root
      // `aria-hidden`, so role-based locators stop resolving inside it exactly
      // when this test needs to measure.
      const card = page.locator('.MuiPaper-root:has(h1)').first();
      const before = await box(card);

      await languageButton(page).click();
      await expect(page.getByRole('menuitemradio', { name: 'English' })).toBeVisible();

      // The scroll lock has to remove the scrollbar it compensates for,
      // otherwise the compensation padding is pure loss and shifts the page.
      const open = await pageMetrics(page);
      expect(open.innerWidth - open.clientWidth).toBe(0);

      // No layout shift: the card must not move by so much as a pixel.
      const during = await box(card);
      expect(Math.abs(during.x - before.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(during.width - before.width)).toBeLessThanOrEqual(1);

      // No bare strip: the dimming overlay has to reach the viewport edges,
      // exactly like the hero image it sits on.
      const overlay = await box(page.getByTestId('hero-image-overlay'));
      expect(overlay.x).toBeLessThanOrEqual(1);
      expect(Math.abs(overlay.x + overlay.width - open.innerWidth)).toBeLessThanOrEqual(1);

      await page.keyboard.press('Escape');
      await expect(page.getByRole('menuitemradio', { name: 'English' })).toHaveCount(0);

      const after = await box(card);
      expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
    });
  }

  test('keeps the landing page header in place while the language menu is open', async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await page.goto('/');
    const logo = page.getByRole('banner').getByRole('link', { name: 'Zum Seitenanfang' });
    await expect(logo).toHaveText('OpenFarmPlanner');

    const before = await box(logo);

    await languageButton(page).click();
    await expect(page.getByRole('menuitemradio', { name: 'English' })).toBeVisible();

    const during = await box(logo);
    expect(Math.abs(during.x - before.x)).toBeLessThanOrEqual(1);
  });
});
