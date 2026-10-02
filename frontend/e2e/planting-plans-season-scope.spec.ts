import { expect, test, type Request } from '@playwright/test';
import { loginWithDeterministicProject } from './utils';

// The PWA service worker answers fetches itself, and page.route() never sees a
// request a service worker handled — blocking it is what lets this spec hold
// the season responses back.
test.use({ serviceWorkers: 'block' });

// Regression for a CI flake (OpenFarmPlanner/planner#742, e2e shard 2/3, run
// 36989707245): the demo project has a 2025 and a 2026 season, and a page that
// mounted before the season list had loaded fetched its plans without
// X-Season-Id, so it kept showing both seasons (17 plans, three tomato rows).
test('a first visit without a stored season only loads the active season', async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await loginWithDeterministicProject(page, request, 'planting-plans-season-scope', {
    demoProject: true,
    loginAsAdmin: true,
  });
  // Cleared as the next document starts, before the app boots: clearing it
  // under the already-running landing page would race that page's own loads.
  await page.addInitScript(() => {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith('activeSeasonId:'))
      .forEach((key) => window.localStorage.removeItem(key));
  });
  // Let the page's own data (crops, beds) win the race against the seasons.
  await page.route(/\/api\/seasons\//, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue();
  });
  const planRequests: Request[] = [];
  page.on('request', (planRequest) => {
    if (/\/api\/planting-plans\//.test(planRequest.url())) {
      planRequests.push(planRequest);
    }
  });

  await page.goto('/app/planting-plans');
  const cards = page.locator('[data-mobile-card-id]');
  await expect(cards.first()).toBeVisible();

  expect(planRequests.length).toBeGreaterThan(0);
  for (const planRequest of planRequests) {
    expect(planRequest.headers()['x-season-id'], planRequest.url()).toBeTruthy();
  }
  // Only the two 2026 tomato rows; the 2025 one belongs to the other season.
  await page.getByRole('searchbox', { name: 'Anbaupläne durchsuchen' }).fill('Paradeiser');
  await expect(cards).toHaveCount(2);
});
