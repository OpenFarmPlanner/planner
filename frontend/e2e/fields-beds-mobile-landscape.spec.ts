import { expect, test, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject, waitForPageStable } from './utils';

type LocationResponse = { id: number; name: string };

/**
 * Covers the mobile/desktop hierarchy layout switch across both axes it
 * depends on (see useIsMobileHierarchyLayout): narrow width (portrait phone)
 * and short height (phone landscape, which is wider than `sm` but too short
 * for the DataGrid). Tablet and desktop widths at a tall-enough height must
 * keep the DataGrid unchanged.
 */
async function seedOneLocation(page: Page, prefix: string): Promise<LocationResponse> {
  return apiRequest<LocationResponse>(page, 'POST', '/locations/', { name: `${prefix} Standort` });
}

test.describe('fields-beds mobile/desktop layout switch', () => {
  test('portrait phone (375x800) shows the mobile list', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'fields-landscape-portrait', { loginAsAdmin: true });
    const location = await seedOneLocation(page, 'Portrait');
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/app/fields-beds');
    await waitForPageStable(page, /Anbauflächen|Parzellen|Beete/i);

    await expect(page.locator(`[data-hierarchy-mobile-row-id="location-${location.id}"]`)).toBeVisible();
    await expect(page.locator('[role="grid"]')).toHaveCount(0);
    await expect(page).toHaveScreenshot('fields-beds-layout-375x800.png', {
      fullPage: false,
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });
  });

  test('phone landscape (800x375) shows the mobile list', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'fields-landscape-phone', { loginAsAdmin: true });
    const location = await seedOneLocation(page, 'Landscape');
    await page.setViewportSize({ width: 800, height: 375 });
    await page.goto('/app/fields-beds');
    await waitForPageStable(page, /Anbauflächen|Parzellen|Beete/i);

    await expect(page.locator(`[data-hierarchy-mobile-row-id="location-${location.id}"]`)).toBeVisible();
    await expect(page.locator('[role="grid"]')).toHaveCount(0);
    await expect(page).toHaveScreenshot('fields-beds-layout-800x375.png', {
      fullPage: false,
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });
  });

  test('tablet (768x900) keeps the DataGrid', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'fields-landscape-tablet', { loginAsAdmin: true });
    await seedOneLocation(page, 'Tablet');
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto('/app/fields-beds');
    await waitForPageStable(page, /Anbauflächen|Parzellen|Beete/i);

    await expect(page.locator('[role="grid"]')).toBeVisible();
    await expect(page.locator('[data-hierarchy-mobile-row-id]')).toHaveCount(0);
    await expect(page).toHaveScreenshot('fields-beds-layout-768x900.png', {
      fullPage: false,
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });
  });

  test('desktop (1440x900) keeps the DataGrid', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'fields-landscape-desktop', { loginAsAdmin: true });
    await seedOneLocation(page, 'Desktop');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app/fields-beds');
    await waitForPageStable(page, /Anbauflächen|Parzellen|Beete/i);

    await expect(page.locator('[role="grid"]')).toBeVisible();
    await expect(page.locator('[data-hierarchy-mobile-row-id]')).toHaveCount(0);
    await expect(page).toHaveScreenshot('fields-beds-layout-1440x900.png', {
      fullPage: false,
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });
  });
});
