import { expect, test } from '@playwright/test';
import { MAIN_ROUTES, submitLoginFormAndAwaitApp, trackConsoleErrors, waitForPageStable } from '../e2e/utils';

const email = process.env.SMOKE_LOGIN_EMAIL;
const password = process.env.SMOKE_LOGIN_PASSWORD;

/**
 * Post-deploy smoke check for the normal (non-guest) login flow against a
 * live environment: logs in with a persistent test account and loads every
 * main navigation page, failing on any failed API response or console/page
 * error. Complements post-deploy.spec.ts, which covers the guest-demo flow.
 * See e2e-smoke/README.md for how to provision the test account.
 */
test('normal login loads every main navigation page without errors', async ({ page }) => {
  test.skip(!email || !password, 'SMOKE_LOGIN_EMAIL/SMOKE_LOGIN_PASSWORD are not set.');

  const failedRequests: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400 && response.url().includes('/api/')) {
      failedRequests.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });
  const consoleErrors = trackConsoleErrors(page);

  await page.goto('/login');
  await submitLoginFormAndAwaitApp(page, { email: email!, password: password! });

  for (const route of MAIN_ROUTES) {
    await page.goto(route.path);
    await waitForPageStable(page, route.ready);
  }

  await page.getByRole('button', { name: 'Mehr', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Abmelden' }).click();
  await expect(page).toHaveURL(/\/login/);

  expect(failedRequests, `Failed API requests:\n${failedRequests.join('\n')}`).toEqual([]);
  expect(consoleErrors, `Console/page errors:\n${consoleErrors.join('\n')}`).toEqual([]);
});
