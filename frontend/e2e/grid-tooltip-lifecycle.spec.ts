import { expect, test, type Locator } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });

test('releases the demo bed preview on picker cancel, pointer movement, scroll and menus', async ({ page, request }) => {
  await loginWithDeterministicProject(page, request, 'grid-tooltip-demo', {
    demoProject: true, languageCode: 'en', loginAsAdmin: true,
  });
  await page.goto('/app/account-settings');
  await page.getByRole('combobox', { name: 'Sprache' }).click();
  await page.getByRole('option', { name: 'English', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.goto('/app/planting-plans');
  const grid = page.getByRole('grid');
  await expect(grid).toBeVisible();

  const beds = grid.locator('[role="gridcell"][data-field="bed"]');
  const potatoes = beds.filter({ hasText: 'Potatoes 1' }).first();
  const cabbage = beds.filter({ hasText: 'Cabbage Bed' }).first();
  const tooltips = page.getByRole('tooltip');
  const expectBedPreview = async (name: string) => {
    await expect(tooltips).toHaveCount(1);
    await expect(tooltips).toHaveText(`Linden Farm Lease › North Plot › ${name}`);
  };

  await potatoes.getByText('Potatoes 1', { exact: true }).hover();
  await expectBedPreview('Potatoes 1');

  await potatoes.getByText('Potatoes 1', { exact: true }).dblclick();
  const editor = page.getByTestId('inline-bed-picker').getByRole('combobox');
  await expect(editor).toBeFocused();
  await expect(tooltips).toHaveCount(0);
  await editor.press('Escape');
  await expect(editor).toHaveCount(0);
  await expect(potatoes.locator('span[tabindex]')).toBeFocused();
  await expect(tooltips).toHaveCount(0);

  await cabbage.getByText('Cabbage Bed', { exact: true }).hover();
  await expectBedPreview('Cabbage Bed');
  await grid.locator('.MuiDataGrid-virtualScroller').evaluate(element => { element.scrollTop += 100; });
  await expect(tooltips).toHaveCount(0);

  // Use an intentional pointer entry after scrolling, then open a row menu.
  await page.mouse.move(2, 2);
  await cabbage.getByText('Cabbage Bed', { exact: true }).hover();
  await expectBedPreview('Cabbage Bed');
  await cabbage.click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(tooltips).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toBeHidden();
  await expect(tooltips).toHaveCount(0);

  await page.mouse.move(2, 2);
  await potatoes.getByText('Potatoes 1', { exact: true }).hover();
  await expectBedPreview('Potatoes 1');
  await page.goto('/app/crops');
  await expect(page.getByRole('heading', { name: 'Crops', exact: true })).toBeVisible();
  await expect(tooltips).toHaveCount(0);
});

test('suppresses inherited previews during a Growing Areas inline save', async ({ page, request }) => {
  await loginWithDeterministicProject(page, request, 'grid-tooltip-growing-areas', { loginAsAdmin: true });
  const location = await apiRequest<{ id: number }>(page, 'POST', '/locations/', {
    name: 'Standort mit Anbaubedingungen', light_condition: 'sunny',
  });
  const field = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
    name: 'Parzelle', location: location.id, length_m: 10, width_m: 5,
  });
  const createBed = (name: string) => apiRequest<{ id: number }>(page, 'POST', '/beds/', {
    name, field: field.id, length_m: 2, width_m: 1,
  });
  const first = await createBed('Beet Eins');
  const second = await createBed('Beet Zwei');
  await page.goto('/app/fields-beds');
  const grid = page.getByRole('grid');
  const row = (id: number): Locator => grid.locator(`[role="row"][data-id="${id}"]`);
  const cell = (id: number, name: string): Locator => row(id).locator(`[data-field="${name}"]`);
  await expect(row(second.id)).toBeVisible();
  await page.getByTestId('growing-area-search-toolbar').getByRole('button', { name: 'Spalten' }).click();
  await page.getByRole('checkbox', { name: 'Licht' }).check();
  await page.keyboard.press('Escape');
  const tooltips = page.getByRole('tooltip');
  const light = (id: number) => cell(id, 'light_condition').getByTestId('site-condition-light_condition');

  await light(first.id).hover();
  await expect(tooltips).toHaveText(/Übernommen vom Standort/);
  const name = cell(first.id, 'name');
  await name.dblclick();
  const editor = name.locator('input');
  await expect(editor).toBeFocused();
  await expect(tooltips).toHaveCount(0);
  await light(second.id).hover();
  await expect(tooltips).toHaveCount(0);
  await editor.fill('Beet Eins gespeichert');
  await editor.press('Enter');
  await expect(name).toContainText('Beet Eins gespeichert');
  await expect(tooltips).toHaveCount(0);

  await page.mouse.move(2, 2);
  await light(second.id).hover();
  await expect(tooltips).toHaveCount(1);
  await expect(tooltips).toHaveText(/Übernommen vom Standort/);
  await page.getByRole('heading', { level: 1 }).click();
  await expect(tooltips).toHaveCount(0);
});
