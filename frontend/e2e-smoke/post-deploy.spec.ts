import { expect, test } from '@playwright/test';
import { MAIN_ROUTES, trackConsoleErrors, waitForPageStable } from '../e2e/utils';

/**
 * Post-deploy smoke check for a live environment: starts a real guest-demo
 * session (the same "Demo ohne Registrierung ansehen" flow a visitor uses,
 * see docs/demo-project.md) and loads every main navigation page, failing on
 * any failed API response or console/page error. Run after a deploy instead
 * of clicking through the app by hand — see e2e-smoke/README.md.
 */
test('guest demo loads every main navigation page without errors', async ({ page }) => {
  const failedRequests: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400 && response.url().includes('/api/')) {
      failedRequests.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  const consoleErrors = trackConsoleErrors(page);

  await page.goto('/');
  await page.getByRole('button', { name: 'Demo ohne Registrierung ansehen' }).click();
  await expect(page).toHaveURL(/\/app\/fields-beds/);
  await waitForPageStable(page, /Anbauflächen/);

  for (const route of MAIN_ROUTES) {
    await page.goto(route.path);
    await waitForPageStable(page, route.ready);
  }

  // Leave the demo rather than let it sit for the retention cleanup cron
  // (see docs/demo-project.md) — this run's project has already served its
  // purpose by the time the loop above finishes.
  await page.getByRole('button', { name: 'Mehr', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Demo verlassen' }).click();
  await expect(page).toHaveURL(/\/$/);

  expect(failedRequests, `Failed API requests:\n${failedRequests.join('\n')}`).toEqual([]);
  expect(consoleErrors, `Console/page errors:\n${consoleErrors.join('\n')}`).toEqual([]);
});
