import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectNoHorizontalPageOverflow, loginWithDeterministicProject } from './utils';

const header = (page: Page, field: string) => page.locator(`[role="columnheader"][data-field="${field}"]`).first();
const width = (column: Locator) => column.evaluate(element => Math.round(element.getBoundingClientRect().width));
const divider = (column: Locator) => column.locator('.MuiDataGrid-columnSeparator--sideRight');

async function dragDivider(page: Page, column: Locator, delta: number) {
  await column.scrollIntoViewIfNeeded();
  await column.hover();
  const bounds = (await divider(column).boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + delta, y, { steps: 8 });
  await page.mouse.up();
}

test('planting plan resize, auto-fit and reset preserve sorting and visibility', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'planting-grid-sizing', { demoProject: true, loginAsAdmin: true });
  await page.goto('/app/planting-plans');
  const crop = header(page, 'crop');
  const sowing = header(page, 'sowing_date');
  await expect(crop).toBeVisible();
  const original = await width(crop);
  const originalSowing = await width(sowing);
  await dragDivider(page, crop, 120);
  await expect.poll(() => width(crop)).toBeGreaterThan(original + 90);
  const wide = await width(crop);
  expect(await width(sowing)).toBe(originalSowing);

  await page.reload();
  await expect.poll(() => width(crop)).toBe(wide);
  await crop.focus();
  await crop.press('Enter');
  await expect(crop).toHaveAttribute('aria-sort', /ascending|descending/);
  expect(await width(crop)).toBe(wide);

  await crop.hover();
  await divider(crop).dblclick();
  await expect.poll(() => width(crop)).toBeLessThan(wide);
  const planting = header(page, 'planting_date');
  await dragDivider(page, planting, 100);
  const widePlanting = await width(planting);
  await divider(planting).dblclick();
  await expect.poll(() => width(planting)).toBeLessThan(widePlanting);
  await planting.hover();
  // Auto-fit must account for the sort and menu controls revealed on hover.
  await expect.poll(() => planting.getByText('Pflanzung', { exact: true }).evaluate(
    label => label.scrollWidth - label.clientWidth,
  )).toBeLessThanOrEqual(1);

  await dragDivider(page, crop, 160);

  const columns = page.getByRole('button', { name: 'Spalten', exact: true });
  await columns.click();
  const reset = page.getByRole('button', { name: 'Spaltenbreiten zurücksetzen' });
  await expect(reset).toBeEnabled();
  const visibility = await page.evaluate(() => localStorage.getItem('tableColumns.plantingPlans'));
  await reset.click();
  await expect(reset).toBeDisabled();
  await expect.poll(() => width(crop)).toBe(original);
  await expect(crop).toHaveAttribute('aria-sort', /ascending|descending/);
  expect(await page.evaluate(() => localStorage.getItem('tableColumns.plantingPlans'))).toBe(visibility);

  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1024, height: 900 });
  await dragDivider(page, crop, 300);
  await expectNoHorizontalPageOverflow(page);
});

test('growing areas use their own persisted width and support menu auto-fit', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'growing-area-grid-sizing', { demoProject: true, loginAsAdmin: true });
  await page.goto('/app/fields-beds?view=list');
  const name = header(page, 'name');
  await expect(name).toBeVisible();
  const original = await width(name);
  await dragDivider(page, name, 120);
  await expect.poll(() => width(name)).toBeGreaterThan(original + 90);
  const wide = await width(name);

  await page.reload();
  await expect.poll(() => width(name)).toBe(wide);
  await name.hover();
  await name.locator('.MuiDataGrid-menuIconButton').click();
  await page.getByRole('menuitem', { name: 'Spaltenbreite automatisch anpassen' }).click();
  await expect.poll(() => width(name)).not.toBe(wide);
});
