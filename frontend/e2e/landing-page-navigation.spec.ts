import { expect, test } from '@playwright/test';

// Functional checks for the public landing page's sticky topbar (anchor nav,
// mobile menu) and the closing call-to-action. Not a screenshot baseline -
// see docs/design-system.md on when a screenshot test is/isn't appropriate.

test.describe('landing page topbar anchors', () => {
  test('scrolls to a section and updates the hash when clicking an anchor link on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');

    await page.getByRole('banner').getByRole('link', { name: 'Kulturbibliothek' }).click();

    await expect(page).toHaveURL(/#kulturbibliothek$/);
    await expect(page.locator('#kulturbibliothek')).toBeInViewport();
  });

  test('scrolls to the right section on a deep link from another route', async ({ page }) => {
    await page.goto('/#open-source');

    await expect(page.locator('#open-source')).toBeInViewport();
  });

  test('moves the anchor links behind a labelled menu on mobile and closes it after a selection', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/');

    const header = page.getByRole('banner');
    await expect(header.getByRole('link', { name: 'Funktionen' })).toBeHidden();

    await header.getByRole('button', { name: 'Menü öffnen' }).click();
    const menu = page.getByRole('menu', { name: 'Hauptnavigation' });
    await menu.getByRole('menuitem', { name: 'Funktionen' }).click();

    await expect(menu).toBeHidden();
    await expect(page).toHaveURL(/#funktionen$/);
    await expect(page.locator('#funktionen')).toBeInViewport();
  });
});

test.describe('landing page topbar wordmark', () => {
  // Where the localized language and sign-in labels leave too little room,
  // the wordmark disappears completely instead of showing a cut-off "OpenF…".
  async function wordmarkState(page: import('@playwright/test').Page): Promise<'shown' | 'hidden' | 'cut'> {
    return page.getByRole('banner').getByText('OpenFarmPlanner', { exact: true }).evaluate((element) => {
      const clip = element.parentElement!.getBoundingClientRect();
      const text = element.getBoundingClientRect();
      if (text.top >= clip.bottom) {
        return 'hidden';
      }
      return text.right <= clip.right + 0.5 ? 'shown' : 'cut';
    });
  }

  for (const { language, path, width, expected } of [
    { language: 'fr', path: '/fr', width: 320, expected: 'hidden' },
    { language: 'es', path: '/es', width: 375, expected: 'hidden' },
    { language: 'en', path: '/en', width: 375, expected: 'shown' },
    { language: 'fr', path: '/fr', width: 1440, expected: 'shown' },
  ] as const) {
    test(`is ${expected} on ${path} at ${width}px, never cut off`, async ({ page }) => {
      // The suite's browser locale is German; without a stored choice the
      // first load would redirect to the German version of the page.
      await page.addInitScript((code) => window.localStorage.setItem('ui.language', code), language);
      await page.setViewportSize({ width, height: 800 });
      await page.goto(path);

      expect(await wordmarkState(page)).toBe(expected);
    });
  }
});

test.describe('landing page closing call-to-action', () => {
  test('starts the guest demo from the closing section', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Demo starten' }).click();

    await expect(page).toHaveURL(/\/app\/fields-beds/);
    await expect(page.getByRole('heading', { name: 'Anbauflächen' })).toBeVisible();
  });
});
