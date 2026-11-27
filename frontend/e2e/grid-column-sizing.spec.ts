import { expect, test, type Locator, type Page } from '@playwright/test';
import { apiRequest, expectNoHorizontalPageOverflow, loginWithDeterministicProject, VIEWPORTS } from './utils';
import { SUPPORTED_LANGUAGES } from '../src/i18n/languages';

const header = (page: Page, field: string) => page.locator(`[role="columnheader"][data-field="${field}"]`).first();
const width = (column: Locator) => column.evaluate(element => Math.round(element.getBoundingClientRect().width));
const divider = (column: Locator) => column.locator('.MuiDataGrid-columnSeparator--sideRight');
const gridRoot = (page: Page) => page.locator('.MuiDataGrid-root');

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
  await expect(gridRoot(page)).toHaveAttribute('aria-busy', 'false');
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
  await loginWithDeterministicProject(page, request, 'ga', { loginAsAdmin: true });
  const location = await apiRequest<{ id: number }>(page, 'POST', '/locations/', { name: 'Hof' });
  const field = await apiRequest<{ id: number }>(page, 'POST', '/fields/', { name: 'Süd', location: location.id });
  await apiRequest(page, 'POST', '/beds/', { name: 'Kurzes Beet', field: field.id });
  await page.goto('/app/fields-beds?view=list');
  const name = header(page, 'name');
  await expect(name).toBeVisible();
  await expect(gridRoot(page)).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByTestId('hierarchy-name-text').filter({ hasText: 'Kurzes Beet' })).toBeVisible();
  await expect.poll(() => width(name)).toBeLessThan(235);
  const original = await width(name);
  await dragDivider(page, name, 120);
  await expect.poll(() => width(name)).toBeGreaterThan(original + 90);
  const wide = await width(name);

  await page.reload();
  await expect.poll(() => width(name)).toBe(wide);
  await expect(gridRoot(page)).toHaveAttribute('aria-busy', 'false');
  await name.hover();
  await name.locator('.MuiDataGrid-menuIconButton').click();
  await page.getByRole('menuitem', { name: 'Spaltenbreite automatisch anpassen' }).click();
  await expect.poll(() => width(name)).not.toBe(wide);

  await dragDivider(page, name, -110);
  await expect.poll(() => width(name)).toBe(152);
  const fieldRow = page.locator(`[role="row"][data-id="field-${field.id}"]`);
  const actions = fieldRow.getByTestId('hierarchy-name-actions-overlay');
  await fieldRow.hover({ position: { x: 90, y: 20 } });
  await expect(actions).toHaveCSS('opacity', '1');
  await expect(actions.getByRole('button')).toHaveCount(1);
  await actions.getByRole('button', { name: 'Aktionen' }).click();
  await expect(page.getByRole('menuitem', { name: /^Beet hinzufügen/ })).toBeVisible();
});

test('growing areas fit collapsed bed names and overlay actions without moving the label', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'collapsed-hierarchy-sizing', { loginAsAdmin: true });
  const location = await apiRequest<{ id: number }>(page, 'POST', '/locations/', { name: 'Acker am Bach' });
  const field = await apiRequest<{ id: number }>(page, 'POST', '/fields/', { name: 'Kohlquartier', location: location.id });
  await apiRequest(page, 'POST', '/beds/bulk-create/', {
    field: field.id,
    beds: Array.from({ length: 35 }, (_, index) => ({ name: `Beet ${index + 1}`, length_m: 8, width_m: 1 })),
  });
  const bedName = 'Gründüngung – Klimaresiliente Zwischenfrucht '.repeat(2) + 'Nördlicher Versuchsabschnitt';
  const bed = await apiRequest<{ id: number }>(page, 'POST', '/beds/', { name: bedName, field: field.id });
  await page.goto('/app/fields-beds?view=list');
  const name = header(page, 'name');
  const length = header(page, 'length_m');
  const row = page.locator(`[role="row"][data-id="${bed.id}"]`);
  const label = row.getByTestId('hierarchy-name-text');
  const locationRow = page.locator(`[role="row"][data-id="location-${location.id}"]`);
  const scroller = page.getByRole('grid').locator('.MuiDataGrid-virtualScroller');
  const expandLevel = name.getByRole('button', { name: 'Eine Hierarchieebene mehr anzeigen' });
  await expect.poll(() => width(name)).toBe(420);
  await expect.poll(() => scroller.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  const originalLength = await width(length);

  // A collapsed branch keeps the bed out of the DOM during the measurement.
  const collapseLocation = locationRow.getByTestId('expand-icon-slot').getByRole('button', { name: 'Eintrag zuklappen' });
  if (await collapseLocation.isVisible()) await collapseLocation.click();
  await expect(row).toHaveCount(0);
  await divider(name).dblclick();
  await expect.poll(() => width(name)).toBeGreaterThan(720);
  const fitted = await width(name);
  expect(await width(length)).toBe(originalLength);

  // This project has two descendant levels. The long row comes after the first viewport.
  for (let level = 0; level < 2 && await expandLevel.isEnabled(); level += 1) {
    await expandLevel.click();
  }
  await expect.poll(() => scroller.evaluate(node => node.scrollHeight - node.clientHeight)).toBeGreaterThan(200);
  await expect(row).toHaveCount(0);
  await scroller.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect(label).toHaveText(bedName);
  const overflow = () => label.evaluate(node => node.scrollWidth - node.clientWidth);
  await expect.poll(overflow).toBeLessThanOrEqual(1);
  expect(await label.evaluate(node => {
    const text = document.createRange();
    text.selectNodeContents(node);
    return node.getBoundingClientRect().right - text.getBoundingClientRect().right;
  })).toBeLessThan(28);
  const nameCell = row.getByRole('gridcell').and(row.locator('[data-field="name"]'));
  const overlay = row.getByTestId('hierarchy-name-actions-overlay');
  const labelBounds = await label.boundingBox();
  const rowHeight = (await row.boundingBox())?.height;
  await row.hover({ position: { x: 180, y: 25 } });
  await expect(overlay).toHaveCSS('opacity', '1');
  await expect(overlay).toHaveCSS('position', 'absolute');
  const overlayBounds = (await overlay.boundingBox())!;
  const cellBounds = (await nameCell.boundingBox())!;
  expect(overlayBounds.x).toBeGreaterThan(labelBounds!.x);
  expect(overlayBounds.x).toBeLessThan(labelBounds!.x + labelBounds!.width);
  expect(overlayBounds.x + overlayBounds.width).toBeLessThanOrEqual(cellBounds.x + cellBounds.width);
  expect(await label.boundingBox()).toEqual(labelBounds);
  expect((await row.boundingBox())?.height).toBe(rowHeight);
  await expect.poll(overflow).toBeLessThanOrEqual(1);
  expect(await width(name)).toBe(fitted);
  const search = page.getByRole('searchbox', { name: 'Anbauflächen durchsuchen' });
  await search.hover();
  await expect(overlay).toHaveCSS('opacity', '0');
  await nameCell.click({ position: { x: 120, y: 18 } });
  await search.hover();
  await nameCell.press('ArrowRight');
  await expect(row.locator('[role="gridcell"]:focus-visible')).toHaveCount(1);
  await expect(overlay).toHaveCSS('opacity', '1');
  await expect(overlay).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.screenshot({ path: testInfo.outputPath('growing-areas-keyboard-overlay.png') });
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Löschen', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await search.fill('E2E Project');
  await expect(row).toHaveCount(0);
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

test.describe('touch hierarchy overlays', () => {
  test.use({ hasTouch: true, viewport: { width: 850, height: 900 } });

  test('growing areas keep actions available at the minimum Name width', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'touch-hierarchy-sizing', { loginAsAdmin: true });
    const location = await apiRequest<{ id: number }>(page, 'POST', '/locations/', { name: 'Hof' });
    const field = await apiRequest<{ id: number }>(page, 'POST', '/fields/', { name: 'Lange Parzelle', location: location.id });
    const bed = await apiRequest<{ id: number }>(page, 'POST', '/beds/', { name: 'Langer Name für ein schmales Beet', field: field.id });
    await page.goto('/app/fields-beds?view=list');
    const name = header(page, 'name');
    const locationRow = page.locator(`[role="row"][data-id="location-${location.id}"]`);
    const fieldRow = page.locator(`[role="row"][data-id="field-${field.id}"]`);
    const row = page.locator(`[role="row"][data-id="${bed.id}"]`);
    await expect(row).toBeVisible();
    await dragDivider(page, name, -250);
    await expect.poll(() => width(name)).toBe(152);

    const overlay = row.getByTestId('hierarchy-name-actions-overlay');
    const nameCell = row.locator('[data-field="name"]');
    const text = row.getByTestId('hierarchy-name-text');
    const cellBounds = (await nameCell.boundingBox())!;
    const textBounds = (await text.boundingBox())!;
    expect(cellBounds.x + cellBounds.width - textBounds.x - textBounds.width).toBeLessThan(16);
    await expect(overlay).toHaveCSS('position', 'absolute');
    await overlay.getByRole('button', { name: 'Aktionen' }).tap();
    await expect(page.getByRole('menuitem', { name: 'Löschen', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');

    await fieldRow.getByTestId('expand-icon-slot').getByRole('button', { name: 'Eintrag zuklappen' }).tap();
    await expect(row).toHaveCount(0);
    await fieldRow.getByTestId('expand-icon-slot').getByRole('button', { name: 'Eintrag aufklappen' }).tap();
    await expect(row).toBeVisible();
    await locationRow.getByRole('button', { name: 'Aktionen' }).tap();
    await expect(page.getByRole('menuitem', { name: /^Parzelle hinzufügen/ })).toBeVisible();
  });
});

test('variety comparison sizes only the selected column and keeps overflow inside the table', async ({ page, request }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'variety-table-sizing', { loginAsAdmin: true, libraryModerator: true });
  const variety = 'Späte Ernte violette Züchtung '.repeat(3).trim();
  const speciesName = `E2E Sortenvergleich ${Date.now()}`;
  const species = await apiRequest<{ id: number }>(page, 'POST', '/crop-species/', { name: speciesName });
  await apiRequest(page, 'POST', `/crop-species/${species.id}/approve/`, {
    translations: SUPPORTED_LANGUAGES.map(({ code }) => ({ language_code: code, common_name: speciesName })),
  });
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: speciesName, crop_species: species.id, growth_duration_days: 40, harvest_duration_days: 10,
  });
  const child = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: speciesName, crop_species: species.id, variety, growth_duration_days: 60, harvest_duration_days: 10,
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
      await table.evaluate(node => { node.scrollLeft = node.scrollWidth; });
      await expect.poll(() => other.evaluate(node => {
        const rect = node.getBoundingClientRect();
        return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('th')?.getAttribute('data-field');
      })).toBe('growthDurationDays');
      await table.evaluate(node => { node.scrollLeft = 0; });
    }
    await expectNoHorizontalPageOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`varieties-width-${viewport.key}.png`) });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await fit.press('ArrowRight');
  await expect.poll(() => width(column)).toBe(fitted + 12);
  await page.getByRole('button', { name: 'Spaltenbreiten zurücksetzen', exact: true }).click();
  await expect.poll(() => width(column)).toBe(240);

  const publish = (id: number, general: boolean) => apiRequest<{ public_crop: { id: number } }>(
    page, 'POST', `/crops/${id}/publish-public/`, {
      accepted_public_library_terms: true, crop_species_id: species.id, original_language_code: 'de', publish_as_general: general,
    },
  );
  const libraryCrop = await publish(crop.id, true);
  await publish(child.id, false);
  await page.goto(`/app/crop-library?cropId=${libraryCrop.public_crop.id}`);
  await expect.poll(() => width(column)).toBe(240);
  await fit.dblclick();
  await expect.poll(() => label.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('library-varieties-width-desktop.png') });
  await page.goto(url);
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
    await expect(gridRoot(page)).toHaveAttribute('aria-busy', 'false');
    const sowing = header(page, 'sowing_date');
    await sowing.hover();
    const text = sowing.locator('.MuiDataGrid-columnHeaderTitleContainerContent > span').first();
    await expect.poll(() => text.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    await expectNoHorizontalPageOverflow(page);
  }
});
