import { expect, test } from '@playwright/test';
import { expectNoHorizontalPageOverflow, loginWithDeterministicProject, MAIN_ROUTES, setViewportPreset, VIEWPORTS, waitForPageStable } from './utils';

// Route-wide overflow coverage complements the focused dialog, grid and
// navigation tests without coupling ordinary UI changes to reference images.
test.describe('responsive layouts', () => {
  test.beforeEach(async ({ page, request }, testInfo) => {
    await loginWithDeterministicProject(page, request, `responsive-${testInfo.workerIndex}`);
  });

  for (const viewport of VIEWPORTS) {
    test(`main routes fit at ${viewport.key}`, async ({ page }, testInfo) => {
      await setViewportPreset(page, viewport);
      for (const route of MAIN_ROUTES) {
        await test.step(route.key, async () => {
          await page.goto(route.path);
          await waitForPageStable(page, route.ready);
          await expect(page.getByRole('banner').getByRole('heading', { level: 1 })).toBeVisible();
          await expectNoHorizontalPageOverflow(page);
          // Artifacts support human visual review; they never gate on pixels.
          const path = testInfo.outputPath(`${route.key}-${viewport.key}.png`);
          await page.screenshot({ path, animations: 'disabled' });
          await testInfo.attach(`${route.key}-${viewport.key}`, { path, contentType: 'image/png' });
        });
      }
    });
  }
});
