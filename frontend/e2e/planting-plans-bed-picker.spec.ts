import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

const cell = (page: Page, field: string) => page.locator(`[role="gridcell"][data-field="${field}"]`).first();
const picker = (page: Page) => page.getByRole('combobox', { name: 'Beete suchen' });
const beds = (page: Page) => page.getByRole('listbox', { name: 'Beet' });

async function seedBeds(page: Page, request: APIRequestContext, scenario: string, longPath = false) {
  await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
  const { id: season } = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', {
    start_date: '2026-01-01', end_date: '2026-12-31',
  });
  const location = longPath
    ? 'Sonnenacker mit sehr langer Standortbezeichnung am Nordhang und schmalem Zugang'
    : 'Hofgarten';
  const field = longPath
    ? 'Folientunnel Süd mit langer Parzellenbezeichnung und mehreren getrennten Abschnitten'
    : 'Frühbeete Nord';
  const name = longPath ? 'Tomatenreihe West 2026' : 'Salat 1';
  const createBed = async (bedName: string, fieldId: number) => (await apiRequest<{ id: number }>(
    page, 'POST', '/beds/', { name: bedName, field: fieldId, area_sqm: 18.8 },
  )).id;
  const createLocation = async (locationName: string) => (await apiRequest<{ id: number }>(
    page, 'POST', '/locations/', { name: locationName },
  )).id;
  const createField = async (fieldName: string, locationId: number) => (await apiRequest<{ id: number }>(
    page, 'POST', '/fields/', { name: fieldName, location: locationId },
  )).id;
  const home = await createLocation(location);
  const north = await createField(field, home);
  const south = await createField('Sommerbeete', home);
  const remote = await createLocation('Wiesenacker');
  const west = await createField('Westparzelle', remote);
  const original = await createBed(name, north);
  const nearby = await createBed('Salat 2', north);
  await createBed('Kohl 1', south);
  const alternative = await createBed('Salat 3', west);

  const { id: crop } = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Salat', propagation_duration_days: 21,
    cultivation_type: 'pre_cultivation', cultivation_types: ['pre_cultivation'], plants_per_m2: 4,
  });
  const { id: plan } = await apiRequest<{ id: number }>(page, 'POST', '/planting-plans/', {
    bed: original, crop, season, cultivation_type: 'pre_cultivation',
    planting_date: '2026-04-10', area_input_value: 2, area_input_unit: 'M2',
  });
  await page.goto('/app/planting-plans');
  await expect(page.getByRole('heading', { name: 'Anbaupläne' })).toBeVisible();
  return { location, field, name, original, nearby, alternative, plan };
}

test.describe('inline bed picker', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('opens by double click, Enter, F2 and typing, with focus returned on cancel', async ({ page, request }) => {
    await seedBeds(page, request, 'bed-picker-entry');
    const bedCell = cell(page, 'bed');
    await bedCell.click();
    await expect(picker(page)).toHaveCount(0);
    await expect(page.locator('.MuiDataGrid-row.ofp-row-editing')).toHaveCount(0);

    await bedCell.dblclick();
    await expect(picker(page)).toBeFocused();
    await expect(beds(page).getByRole('option', { selected: true })).toContainText('Salat 1');
    await expect(beds(page).getByRole('option', { name: /Salat 2/ })).toContainText(/18,80\s*m²/);
    await page.keyboard.press('Escape');
    await expect(bedCell.locator('span[tabindex]')).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(cell(page, 'sowing_date')).toHaveAttribute('tabindex', '0');
    await page.keyboard.press('Shift+Tab');
    await expect(picker(page)).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(picker(page)).toBeFocused();
    await page.keyboard.press('Escape');

    await page.keyboard.press('F2');
    await expect(picker(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await page.keyboard.press('s');
    await expect(picker(page)).toHaveValue('s');
    await page.keyboard.press('Escape');
    await expect(picker(page)).toHaveCount(0);
  });

  test('filters by each scope, highlights all matching terms and commits with Enter', async ({ page, request }) => {
    const { plan, original, nearby, alternative } = await seedBeds(page, request, 'bed-picker-scope');
    await cell(page, 'bed').dblclick();
    await expect(page.getByText('Hofgarten', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Filter „Frühbeete Nord“ entfernen' })).toBeVisible();
    await expect(beds(page).getByRole('option')).toHaveCount(2);
    await picker(page).press('Backspace');
    await expect(beds(page).getByRole('option')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Filter „Hofgarten“ entfernen' })).toBeVisible();
    await picker(page).press('Backspace');
    await expect(beds(page).getByRole('option')).toHaveCount(4);

    await picker(page).fill('hof fruh sal');
    await expect(beds(page).getByRole('option')).toHaveCount(2);
    expect(await beds(page).locator('mark').allTextContents()).toEqual(['Hof', 'Früh', 'Sal', 'Sal']);
    await beds(page).getByRole('button', { name: 'Frühbeete Nord' }).click();
    await picker(page).fill('wiesen sal');
    await expect(beds(page).getByRole('option')).toHaveCount(0);
    await expect(page.getByText('Keine Treffer in Frühbeete Nord', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '1 Treffer außerhalb anzeigen' }).click();
    await expect(beds(page).getByRole('option')).toHaveCount(1);
    await picker(page).press('Escape');
    expect(await apiRequest(page, 'GET', `/planting-plans/${plan}/`)).toMatchObject({ bed: original });

    await cell(page, 'bed').dblclick();
    await picker(page).press('ArrowDown');
    await picker(page).press('Enter');
    await expect(cell(page, 'bed')).toContainText('Salat 2');
    expect(await apiRequest(page, 'GET', `/planting-plans/${plan}/`)).toMatchObject({ bed: nearby });

    await cell(page, 'bed').dblclick();
    await page.getByRole('button', { name: 'An allen Standorten suchen' }).click();
    await picker(page).fill('wiesen sal');
    await beds(page).getByRole('option', { name: /Salat 3/ }).click();
    await expect(cell(page, 'bed')).toContainText('Salat 3');
    expect(await apiRequest(page, 'GET', `/planting-plans/${plan}/`)).toMatchObject({ bed: alternative });
  });

  test('truncates the ancestors and exposes the full path on focus and hover', async ({ page, request }) => {
    const { location, field, name } = await seedBeds(page, request, 'bed-picker-path', true);
    const bedCell = cell(page, 'bed');
    const prefix = bedCell.getByText(`${location} › ${field}`, { exact: true });
    await expect(prefix).toBeVisible();
    expect(await prefix.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await bedCell.getByText(name, { exact: true }).evaluate((element) => {
      const cellBox = element.closest('[role="gridcell"]')!.getBoundingClientRect();
      return element.getBoundingClientRect().right <= cellBox.right;
    })).toBe(true);
    const path = `${location} › ${field} › ${name}`;
    await prefix.hover();
    await expect(page.getByRole('tooltip')).toHaveText(path);
    await page.mouse.move(2, 2);
    await expect(page.getByRole('tooltip')).toBeHidden();
    await cell(page, 'cultivation_type').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('tooltip')).toHaveText(path);
  });
});

test.describe('touch tablet bed picker', () => {
  test.use({ hasTouch: true, viewport: { width: 1024, height: 768 } });

  test('opens with a tap and commits via a full-sized option', async ({ page, request }) => {
    const { plan, nearby } = await seedBeds(page, request, 'bed-picker-touch');
    await cell(page, 'bed').tap();
    const option = beds(page).getByRole('option', { name: /Salat 2/ });
    await expect(option).toBeVisible();
    expect((await option.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await option.tap();
    await expect(cell(page, 'bed')).toContainText('Salat 2');
    expect(await apiRequest(page, 'GET', `/planting-plans/${plan}/`)).toMatchObject({ bed: nearby });
  });
});

test('preserves the mobile bed assignment when creating a plan', async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const { alternative, plan } = await seedBeds(page, request, 'bed-picker-mobile');
  await page.locator(`[data-mobile-card-id="${plan}"]`).getByRole('button', { name: /Aktionen für Anbauplan/ }).click();
  await page.getByRole('menuitem', { name: 'Duplizieren' }).click();
  const form = page.getByRole('dialog', { name: 'Anbauplan hinzufügen' });
  await form.getByRole('combobox').filter({ hasText: 'Salat 1' }).click();
  await page.getByRole('option', { name: /Salat 3/ }).click();
  await expect(picker(page)).toHaveCount(0);
  const created = page.waitForResponse(response => (
    new URL(response.url()).pathname === '/api/planting-plans/' && response.request().method() === 'POST'
  ));
  await form.getByRole('button', { name: 'Hinzufügen' }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  expect(await response.json()).toMatchObject({ bed: alternative });
  await expect(form).toBeHidden();
});
