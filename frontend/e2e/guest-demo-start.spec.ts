import { expect, test } from '@playwright/test';
import { apiRequest, waitForPageStable } from './utils';

for (const locale of [
  { language: 'fr', start: 'Voir la démo sans inscription', project: 'AMAP du Champ ensoleillé',
    location: 'Champ du ruisseau', field: 'Légumes-racines', expand: 'Déplier',
    bed: 'Carottes 1', task: 'Désherber les planches',
    tag: 'Légumes-fruits', companionNote: "Exemple d'association de cultures propre à la ferme." },
  { language: 'es', start: 'Ver la demo sin registrarse', project: 'Huerta comunitaria Soleada',
    location: 'Campo del arroyo', field: 'Hortalizas de raíz', expand: 'Desplegar',
    bed: 'Zanahorias 1', task: 'Desherbar los bancales',
    tag: 'Hortalizas de fruto', companionNote: 'Ejemplo de asociación de cultivos propia de la finca.' },
]) {
  test.describe(`localized ${locale.language} demo`, () => {
    test.use({ locale: locale.language });
    for (const viewport of [{ width: 375, height: 800 }, { width: 1440, height: 900 },
      { width: 800, height: 375 }]) {
      test(`shows translated project data at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
        await page.setViewportSize(viewport);
        await page.goto(`/${locale.language}`);
        await page.getByRole('button', { name: locale.start, exact: true }).click();
        await expect(page).toHaveURL(/\/app\/fields-beds/);
        await expect(page.getByText(locale.location, { exact: true })).toBeVisible();
        const user = await apiRequest<{ memberships: { project_name: string }[] }>(
          page, 'GET', '/auth/me/',
        );
        expect(user.memberships.map((membership) => membership.project_name)).toContain(locale.project);
        if (viewport.width === 375 || viewport.height === 375) {
          for (const name of [locale.location, locale.field]) {
            await page.getByRole('button', {
              name: new RegExp(`^${locale.expand}\\s*:\\s*${name}$`),
            }).click();
          }
        }
        await expect(page.getByText(locale.bed, { exact: true })).toBeVisible();
        await waitForPageStable(page);
        await page.screenshot({ path: testInfo.outputPath('localized-fields.png') });

        await page.goto('/app/dashboard');
        await expect(page.getByRole('article', { name: locale.task, exact: true })).toBeVisible();
        await waitForPageStable(page);
        await page.screenshot({ path: testInfo.outputPath('localized-tasks.png') });

        const crops = await apiRequest<{ results: { id: number; name: string; variety: string }[] }>(
          page, 'GET', `/crops/?page_size=100&language=${locale.language}`,
        );
        const tomato = crops.results.find((crop) => crop.name === 'Tomate' && !crop.variety);
        expect(tomato).toBeDefined();
        await page.goto(`/app/crops?cropId=${tomato!.id}`);
        await expect(page.getByText('Solanum lycopersicum', { exact: true })).toBeVisible();
        await expect(page.getByText(locale.tag, { exact: true }).first()).toBeVisible();
        await expect(page.getByText(locale.companionNote, { exact: true }).first()).toBeVisible();
        await waitForPageStable(page);
        await page.screenshot({ path: testInfo.outputPath('localized-crop.png') });
        await page.getByText(locale.companionNote, { exact: true }).first().scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath('localized-companions.png') });
      });
    }
  });
}

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
