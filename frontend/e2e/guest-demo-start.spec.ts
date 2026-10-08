import { expect, test } from '@playwright/test';

test('starts the public guest demo and keeps the user in the app', async ({ page }) => {
  let publicAuthProbeCount = 0;

  page.on('request', (request) => {
    if (request.url().endsWith('/api/auth/me/')) {
      publicAuthProbeCount += 1;
    }
  });

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Demo ohne Registrierung ansehen' })).toBeVisible();
  expect(publicAuthProbeCount).toBe(0);

  await page.getByRole('button', { name: 'Demo ohne Registrierung ansehen' }).click();

  await expect(page).toHaveURL(/\/app\/fields-beds/);
  await expect(page).toHaveURL(/\/app\/fields-beds/);
  await expect(page.getByRole('heading', { name: 'Anbauflächen' })).toBeVisible();
});

test('returns guest demo sessions to the public landing page when leaving the demo', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Demo ohne Registrierung ansehen' }).click();

  await expect(page).toHaveURL(/\/app\/fields-beds/);
  await expect(page.getByRole('heading', { name: 'Anbauflächen' })).toBeVisible();

  // `exact` matters here: role-name matching is substring-based, and the
  // hierarchy toolbar's "Eine Hierarchieebene mehr anzeigen" button also
  // contains "mehr". Without it the locator resolves to two elements as soon
  // as that toolbar has rendered, which is a race rather than a stable pass.
  await page.getByRole('button', { name: 'Mehr', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Demo verlassen' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: 'Demo ohne Registrierung ansehen' })).toBeVisible();
  // "Anmelden" appears both in the sticky topbar and in the hero actions.
  await expect(page.getByRole('link', { name: 'Anmelden' })).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Registrieren' })).toBeVisible();
});

test('keeps the guest demo after an older login-page auth refresh finishes', async ({ page }) => {
  let releaseAuthRefresh: () => void = () => {};
  const authRefreshReleased = new Promise<void>((resolve) => {
    releaseAuthRefresh = resolve;
  });
  let authRefreshCount = 0;

  await page.route('**/api/auth/me/', async (route) => {
    authRefreshCount += 1;
    if (authRefreshCount === 1) {
      await authRefreshReleased;
    }
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Authentication credentials were not provided.' }),
    });
  });

  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Anmelden' })).toBeVisible();
  await page.goto('/');
  await page.getByRole('button', { name: 'Demo ohne Registrierung ansehen' }).click();

  await expect(page).toHaveURL(/\/app\/fields-beds/);
  releaseAuthRefresh();
  await expect(page).toHaveURL(/\/app\/fields-beds/);
  await expect(page.getByRole('heading', { name: 'Anbauflächen' })).toBeVisible();

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('openfarmplanner:authentication-expired', {
      detail: { requestStartedAt: Date.now() - 10_000 },
    }));
  });

  await expect(page).toHaveURL(/\/app\/fields-beds/);
  await expect(page.getByRole('heading', { name: 'Anbauflächen' })).toBeVisible();
});

test('stays on the demo project instead of bouncing back to login after a few seconds', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Demo ohne Registrierung ansehen' }).click();

  await expect(page).toHaveURL(/\/app\/fields-beds/);
  await expect(page.getByRole('heading', { name: 'Anbauflächen' })).toBeVisible();

  // Regression guard: the demo previously bounced back to /login a fraction
  // of a second after landing, once background requests fired by the newly
  // mounted app shell (deleted-projects count, language promotion, etc.)
  // resolved. Give those a few seconds to settle and assert we are still on
  // the demo project, not redirected to /login.
  await page.waitForTimeout(3_000);
  await expect(page).toHaveURL(/\/app\/fields-beds/);
  await expect(page.getByRole('heading', { name: 'Anbauflächen' })).toBeVisible();
});
