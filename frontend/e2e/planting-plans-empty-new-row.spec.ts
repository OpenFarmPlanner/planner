import { expect, test } from '@playwright/test';
import { loginWithDeterministicProject, waitForStableRowCount } from './utils';

test.describe('planting plans empty new row cancellation', () => {
  test.beforeEach(async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await loginWithDeterministicProject(page, request, 'planting-plans-empty-new-row', {
      demoProject: true,
      loginAsAdmin: true,
    });
    await page.goto('/app/planting-plans');
    await expect(page.getByRole('heading', { name: 'Anbaupläne' })).toBeVisible();
    await expect(page.locator('[role="row"][data-id]').first()).toBeVisible();
  });

  test('clicking outside an untouched new row discards it without validation', async ({ page }) => {
    const rows = page.locator('[role="row"][data-id]');
    const rowCountBefore = await waitForStableRowCount(page);

    await page.getByRole('button', { name: /^Anbauplan hinzufügen/ }).first().click();
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(1);

    await page.getByRole('heading', { name: 'Anbaupläne' }).click();

    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(0);
    await expect(rows).toHaveCount(rowCountBefore);
    await expect(page.getByText('Kultur oder Beet ist ein Pflichtfeld')).toHaveCount(0);
  });

  test('Escape discards an untouched new row without validation', async ({ page }) => {
    const rows = page.locator('[role="row"][data-id]');
    const rowCountBefore = await waitForStableRowCount(page);

    await page.getByRole('button', { name: /^Anbauplan hinzufügen/ }).first().click();
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(1);

    await page.keyboard.press('Escape');

    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(0);
    await expect(rows).toHaveCount(rowCountBefore);
    await expect(page.getByText('Kultur oder Beet ist ein Pflichtfeld')).toHaveCount(0);
  });
});
