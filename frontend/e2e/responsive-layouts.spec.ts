import { expect, test } from '@playwright/test';
import { loginWithDeterministicProject, MAIN_ROUTES, setViewportPreset, VIEWPORTS, waitForPageStable } from './utils';

test.describe('responsive main routes', () => {
  test.beforeEach(async ({ page, request }, testInfo) => {
    await loginWithDeterministicProject(page, request, `responsive-${testInfo.workerIndex}`);
  });

  for (const viewport of VIEWPORTS) {
    test(`main routes fit at ${viewport.key}`, async ({ page }) => {
      await setViewportPreset(page, viewport);
      for (const route of MAIN_ROUTES) {
        await page.goto(route.path);
        await waitForPageStable(page, route.ready);
        const overflow = await page.evaluate(() => ({
          document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          body: document.body.scrollWidth - document.body.clientWidth,
        }));
        expect(overflow.document, `${route.key}: document overflow`).toBeLessThanOrEqual(1);
        expect(overflow.body, `${route.key}: body overflow`).toBeLessThanOrEqual(1);
        await expect(page.getByRole('banner')).toBeVisible();
        await expect(page.getByRole('main')).toBeVisible();
      }
    });
  }
});
