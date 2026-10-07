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

test.describe('landing page closing call-to-action', () => {
  test('starts the guest demo from the closing section', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Demo starten' }).click();

    await expect(page).toHaveURL(/\/app\/fields-beds/);
    await expect(page.getByRole('heading', { name: 'Anbauflächen' })).toBeVisible();
  });
});
