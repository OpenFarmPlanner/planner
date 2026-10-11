import { expect, isMobileProject, loginToDemoProject, test } from './fixtures';

// Regression test: Firefox and WebKit reject a lazy-route import that is
// still loading when the user leaves the page, and the app's stale-deploy
// recovery used to reload the page being left, cancelling the navigation
// (src/runtime/chunkLoadErrors.ts, recoverUnlessPageIsUnloading).
test.describe('leaving a page while a route chunk loads', () => {
  // A service worker would serve the chunk from its precache, out of reach of page.route().
  test.use({ serviceWorkers: 'block' });

  test('a full navigation is not cancelled by the chunk-error reload', async ({ page }, testInfo) => {
    await loginToDemoProject(page, testInfo);

    // Hold every not-yet-loaded script so the next lazy route stays in flight.
    let releaseScripts: () => void = () => undefined;
    const scriptsHeld = new Promise<void>((resolve) => { releaseScripts = resolve; });
    let heldRequests = 0;
    await page.route('**/assets/*.js', async (route) => {
      heldRequests += 1;
      await scriptsHeld;
      await route.continue().catch(() => undefined);
    });

    // Start loading the Anbaukalender route chunk through in-app navigation...
    if (isMobileProject(testInfo)) {
      await page.getByRole('banner').getByRole('button', { name: 'Menü öffnen' }).click();
    }
    await page.getByRole('list').getByRole('link', { name: 'Anbaukalender', exact: true })
      .locator('visible=true').click();
    await expect.poll(() => heldRequests).toBeGreaterThan(0);

    // ...and leave the page while it is still loading, as a user following a
    // bookmark or typing a URL would.
    const navigation = page.goto('/app/crops');
    releaseScripts();
    await page.unroute('**/assets/*.js');
    await navigation;

    await expect(page).toHaveURL(/\/app\/crops/);
    await expect(page.getByRole('banner').getByRole('heading', { name: 'Kulturen', level: 1 })).toBeVisible();
    const automaticReloads = await page.evaluate(() => window.sessionStorage.getItem('openFarmPlanner.lastChunkReloadAt'));
    expect(automaticReloads, 'the chunk-error recovery reloaded the page that was being left').toBeNull();
  });
});
