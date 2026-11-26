import { expect, test, type Locator, type Page } from '@playwright/test';
import { apiRequest, expectNoHorizontalPageOverflow, loginWithDeterministicProject, VIEWPORTS } from './utils';
import { SUPPORTED_LANGUAGES } from '../src/i18n/languages';

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
  await expect(page.getByRole('grid')).toHaveAttribute('aria-busy', 'false');
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
  await expect(page.getByRole('grid')).toHaveAttribute('aria-busy', 'false');
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

test('growing areas fit collapsed bed names and reserve their row actions', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'collapsed-hierarchy-sizing', { loginAsAdmin: true });
  const location = await apiRequest<{ id: number }>(page, 'POST', '/locations/', { name: 'Acker am Bach' });
  const field = await apiRequest<{ id: number }>(page, 'POST', '/fields/', { name: 'Kohlquartier', location: location.id });
  const bedName = 'Gründüngung – Klimaresiliente Zwischenfrucht '.repeat(2) + 'Nördlicher Versuchsabschnitt';
  const bed = await apiRequest<{ id: number }>(page, 'POST', '/beds/', { name: bedName, field: field.id });
  await page.goto('/app/fields-beds?view=list');
  const name = header(page, 'name');
  const length = header(page, 'length_m');
  const row = page.locator(`[role="row"][data-id="bed-${bed.id}"]`);
  const label = row.getByTestId('hierarchy-name-text');
  const locationRow = page.locator(`[role="row"][data-id="location-${location.id}"]`);
  const fieldRow = page.locator(`[role="row"][data-id="field-${field.id}"]`);
  const scroller = page.getByRole('grid').locator('.MuiDataGrid-virtualScroller');
  const expand = (item: Locator) => item.getByTestId('expand-icon-slot').getByRole('button');
  await expect.poll(() => width(name)).toBe(420);
  await expect.poll(() => scroller.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  const originalLength = await width(length);

  // A collapsed branch keeps the bed out of the DOM during the measurement.
  if (await row.count()) await expand(locationRow).click();
  await expect(row).toHaveCount(0);
  await divider(name).dblclick();
  await expect.poll(() => width(name)).toBeGreaterThan(720);
  const fitted = await width(name);
  expect(await width(length)).toBe(originalLength);

  if (!await fieldRow.count()) await expand(locationRow).click();
  await expand(fieldRow).click();
  await expect(label).toHaveText(bedName);
  const overflow = () => label.evaluate(node => node.scrollWidth - node.clientWidth);
  await expect.poll(overflow).toBeLessThanOrEqual(1);
  await row.hover({ position: { x: 180, y: 25 } });
  await expect(row.getByTestId('hierarchy-name-actions-overlay')).toHaveCSS('opacity', '1');
  await expect.poll(overflow).toBeLessThanOrEqual(1);
  expect(await width(name)).toBe(fitted);
  const search = page.getByRole('textbox', { name: 'Anbauflächen durchsuchen' });
  await search.fill('Kohlquartier');
  await expect(name).toBeVisible();
  expect(await width(name)).toBe(fitted);
  await search.clear();

  await page.reload();
  await expect.poll(() => width(name)).toBe(fitted);
  await page.setViewportSize({ width: 768, height: 900 });
  await expect.poll(() => scroller.evaluate(node => node.scrollWidth - node.clientWidth)).toBeGreaterThan(200);
  await expectNoHorizontalPageOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('growing-areas-wide-tablet.png') });

  await page.getByRole('button', { name: 'Spalten', exact: true }).click();
  await page.getByRole('button', { name: 'Spaltenbreiten zurücksetzen' }).click();
  await expect.poll(() => width(name)).toBe(420);
});

test('variety comparison sizes only the selected column and keeps overflow inside the table', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'variety-table-sizing', { loginAsAdmin: true });
  const variety = 'Späte Ernte violette Züchtung '.repeat(3).trim();
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'E2E Sortenvergleich', growth_duration_days: 40, harvest_duration_days: 10,
  });
  await apiRequest(page, 'POST', '/crops/', {
    name: 'E2E Sortenvergleich', variety, growth_duration_days: 60, harvest_duration_days: 10,
  });
  const url = `/app/crops?cropId=${crop.id}`;
  await page.goto(url);
  const table = page.getByTestId('varieties-comparison-table');
  const column = table.locator('th[data-field="variety"]');
  const other = table.locator('th[data-field="growthDurationDays"]');
  const label = table.getByText(variety, { exact: true });
  const fit = column.getByRole('button');
  await expect.poll(() => width(column)).toBe(240);
  const otherWidth = await width(other);
  await expect.poll(() => label.evaluate(node => node.scrollWidth - node.clientWidth)).toBeGreaterThan(100);
  await fit.dblclick();
  await expect.poll(() => label.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  const fitted = await width(column);
  expect(await width(other)).toBe(otherWidth);
  await page.reload();
  await expect.poll(() => width(column)).toBe(fitted);

  for (const viewport of [...VIEWPORTS, { key: 'phone-landscape', width: 800, height: 375 }]) {
    await page.setViewportSize(viewport);
    await table.scrollIntoViewIfNeeded();
    if (viewport.width === 375) {
      await expect.poll(() => table.evaluate(node => node.scrollWidth - node.clientWidth)).toBeGreaterThan(100);
    }
    await expectNoHorizontalPageOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`varieties-width-${viewport.key}.png`) });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await fit.press('ArrowRight');
  await expect.poll(() => width(column)).toBe(fitted + 12);
  await page.getByRole('button', { name: 'Spaltenbreiten zurücksetzen', exact: true }).click();
  await expect.poll(() => width(column)).toBe(240);
});

test('localized planting plan headers fit with their controls in all seven languages', async ({ page, request }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'localized-plan-sizing', { demoProject: true, loginAsAdmin: true });
  for (const { code } of SUPPORTED_LANGUAGES) {
    await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: code });
    await page.evaluate(language => localStorage.setItem('ui.language', language), code);
    await page.goto('/app/planting-plans');
    await expect(page.locator('html')).toHaveAttribute('lang', code);
    await expect(page.getByRole('grid')).toHaveAttribute('aria-busy', 'false');
    const sowing = header(page, 'sowing_date');
    await sowing.hover();
    const text = sowing.locator('.MuiDataGrid-columnHeaderTitleContainerContent > span').first();
    await expect.poll(() => text.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    await expectNoHorizontalPageOverflow(page);
  }
});
