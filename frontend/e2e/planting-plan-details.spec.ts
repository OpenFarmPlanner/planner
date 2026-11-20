import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

test.use({ serviceWorkers: 'block' });

const cropName = 'Details-Kohl (Sorte Grün)';
const table = '/app/planting-plans';

async function seedPlans(page: Page, request: APIRequestContext, scenario: string) {
  await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });
  const create = (path: string, data: Record<string, unknown>) => apiRequest<{ id: number }>(page, 'POST', path, data);
  const previous = await create('/seasons/', { start_date: '2025-01-01', end_date: '2025-12-31', custom_label: 'Vorjahr' });
  const season = await create('/seasons/', { start_date: '2026-01-01', end_date: '2026-12-31', custom_label: 'Saison für Details' });
  const location = await create('/locations/', { name: 'Details-Hof' });
  const field = await create('/fields/', { location: location.id, name: 'Details-Parzelle' });
  const bed = await create('/beds/', { field: field.id, name: 'Details-Beet', length_m: 10, width_m: 1 });
  const crop = await create('/crops/', {
    name: 'Details-Kohl', variety: 'Sorte Grün', cultivation_type: 'pre_cultivation',
    cultivation_types: ['pre_cultivation'], propagation_duration_days: 21, growth_duration_days: 30,
    harvest_duration_days: 14,
  });
  const secondCrop = await create('/crops/', { name: 'Andere Kultur' });
  const plan = await create('/planting-plans/', {
    crop: crop.id, bed: bed.id, season: season.id, planting_date: '2026-04-01',
    cultivation_type: 'pre_cultivation', area_usage_sqm: 0,
  });
  const noBed = await create('/planting-plans/', { crop: secondCrop.id, season: season.id });
  const oldPlan = await create('/planting-plans/', { crop: crop.id, bed: bed.id, season: previous.id, notes: 'Historische Notiz' });
  await create('/tasks/', { title: 'Historische Aufgabe', planting_plan: oldPlan.id });
  await page.evaluate(seasonId => {
    const projectId = window.localStorage.getItem('activeProjectId');
    window.localStorage.setItem(`activeSeasonId:${projectId}`, String(seasonId));
  }, season.id);
  return { bed, crop, noBed, oldPlan, plan };
}

test('desktop details preserve the table, restoring row focus on Escape, Close and Back', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { plan, crop, bed } = await seedPlans(page, request, 'plan-details-desktop');
  await page.goto('/app/anbauplaene');
  const search = page.getByRole('searchbox', { name: 'Anbaupläne durchsuchen' });
  await search.fill('Details-Kohl');
  const cropHeader = page.locator('[role="columnheader"][data-field="crop"]');
  await cropHeader.click();
  await expect(cropHeader).toHaveAttribute('aria-sort', 'ascending');
  const row = page.locator(`[role="row"][data-id="${plan.id}"]`);
  const cell = row.locator('[data-field="crop"]');
  await cell.click();
  await expect(cell).toBeFocused();
  await expect(page).toHaveURL(url => url.pathname === '/app/anbauplaene' && url.searchParams.get('dir_plantingPlans') === 'asc');
  await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(0);
  await cell.press('ArrowRight');
  await expect(cell).not.toBeFocused();
  await cell.dblclick();
  await expect(row).toHaveClass(/MuiDataGrid-row--editing/);
  await row.locator('[data-field="planting_date"]').getByRole('textbox').press('Escape');
  await expect(row).not.toHaveClass(/MuiDataGrid-row--editing/);

  const menuButton = row.getByRole('button', { name: 'Aktionen', exact: true });
  const openMenu = async () => {
    await row.hover();
    await menuButton.focus();
    await menuButton.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
  };
  await openMenu();
  const menu = page.getByRole('menu');
  const menuItems = menu.getByRole('menuitem');
  await expect(menuItems.nth(0)).toHaveAccessibleName('Anbauplan-Details');
  await expect(menuItems.nth(1)).toHaveAccessibleName('Zur Kultur');
  await expect(menuItems.nth(2)).toHaveAccessibleName('Zur Beetfläche');
  await expect(menu.getByRole('separator').first()).toBeVisible();
  await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(0);
  await expect(menuItems.nth(0)).toBeFocused();
  await page.keyboard.press('Enter');

  const drawer = page.getByRole('dialog', { name: 'Anbauplan-Details' });
  await expect(page).toHaveURL(url => url.pathname === `/app/anbauplaene/${plan.id}`);
  await expect(drawer.getByRole('heading', { name: cropName })).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'Zur Kultur' })).toHaveAttribute('href', `/app/crops?cropId=${crop.id}`);
  await expect(drawer.getByRole('link', { name: 'Zur Beetfläche' })).toHaveAttribute('href', `/app/fields-beds/beds/${bed.id}`);
  await expect(drawer.getByText('11.3.2026', { exact: true })).toBeVisible();
  await expect(drawer.getByText('0', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Notiz oder Foto hinzufügen' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(menuButton).toBeFocused();
  await expect(search).toHaveValue('Details-Kohl');
  await expect(cropHeader).toHaveAttribute('aria-sort', 'ascending');
  await openMenu();
  await menuItems.first().click();
  await drawer.getByRole('button', { name: 'Schließen' }).click();
  await expect(menuButton).toBeFocused();
  await openMenu();
  await menuItems.first().click();
  await page.goBack();
  await expect(drawer).toHaveCount(0);
  await expect(menuButton).toBeFocused();
  await expect(search).toHaveValue('Details-Kohl');

  await openMenu();
  await menuItems.first().click();
  await drawer.getByRole('button', { name: 'Als ganze Seite öffnen' }).click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByRole('heading', { name: cropName })).toBeVisible();
  await expect(page.getByRole('grid')).toBeHidden();
  await page.getByRole('button', { name: 'Zurück zur Tabelle' }).click();
  await expect(search).toHaveValue('Details-Kohl');
  await expect(menuButton).toBeFocused();
});

test('direct links retain the original season and reuse the notes, task and area workflows', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { plan, bed, oldPlan } = await seedPlans(page, request, 'plan-details-direct');
  await page.goto(`${table}/${plan.id}`);
  await expect(page.getByRole('heading', { name: cropName })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Details-Hof', { exact: true })).toBeVisible();
  await expect(page.getByText('Details-Parzelle', { exact: true })).toBeVisible();
  await expect(page.getByText('Details-Beet', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Zur Beetfläche' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/fields-beds/beds/${bed.id}$`));
  await expect(page.getByRole('link', { name: cropName, exact: true })).toHaveAttribute('href', `${table}?planId=${plan.id}`);
  await page.getByRole('link', { name: `Anbauplan-Details für ${cropName}` }).click();
  await expect(page).toHaveURL(new RegExp(`${table}/${plan.id}$`));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Notiz oder Foto hinzufügen' }).click();
  const editor = page.getByRole('textbox', { name: 'Notizen' });
  await editor.fill('Neue Notiz für diesen Anbauplan');
  const navigationDialog = page.waitForEvent('dialog');
  // The drawer traps focus while the editor is open, so trigger browser history.
  void page.evaluate(() => history.back());
  const unsaved = await navigationDialog;
  expect(unsaved.type()).toBe('confirm');
  await unsaved.dismiss();
  await expect(editor).toHaveText('Neue Notiz für diesen Anbauplan');
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByText('Neue Notiz für diesen Anbauplan', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Aufgabe hinzufügen' }).click();
  const createTask = page.getByRole('dialog', { name: 'Aufgabe hinzufügen' });
  await expect(createTask.getByRole('combobox', { name: 'Anbauplan (optional)' })).toContainText(cropName);
  await createTask.getByRole('textbox', { name: 'Titel' }).fill('Neue Aufgabe für diesen Anbauplan');
  await createTask.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(createTask).toHaveCount(0);
  await page.goBack();
  await expect(page.getByText('Neue Aufgabe für diesen Anbauplan', { exact: true })).toBeVisible();

  await page.goto(`${table}/${oldPlan.id}`);
  await expect(page.getByText('Vorjahr', { exact: true })).toBeVisible();
  await expect(page.getByText('Historische Notiz', { exact: true })).toBeVisible();
  await expect(page.getByText('Historische Aufgabe', { exact: true })).toBeVisible();
  await expect(page.getByText('Fläche (m²)', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Notizen und Fotos bearbeiten' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ursprüngliche Saison öffnen' }).click();
  await expect(page.getByRole('button', { name: 'Notizen und Fotos bearbeiten' })).toBeVisible();
  await page.getByRole('button', { name: 'Zurück zur Tabelle' }).click();
  await expect(page).toHaveURL(new RegExp(`${table}$`));
});

test.describe('touch details', () => {
  test.use({ hasTouch: true, viewport: { width: 375, height: 800 } });

  test('uses the same three named actions and opens a full page', async ({ page, request }) => {
    const { noBed, crop, bed } = await seedPlans(page, request, 'plan-details-touch');
    await page.goto(table);
    const card = page.locator(`[data-mobile-card-id="${noBed.id}"]`);
    await card.getByRole('button', { name: /Aktionen für Anbauplan/ }).tap();

    const menuItems = page.getByRole('menu').getByRole('menuitem');
    await expect(menuItems.nth(0)).toHaveAccessibleName('Anbauplan-Details');
    await expect(menuItems.nth(1)).toHaveAccessibleName('Zur Kultur');
    await expect(menuItems.nth(2)).toHaveAccessibleName('Zur Beetfläche');
    await expect(menuItems.nth(2)).toBeDisabled();
    await expect(menuItems.nth(2)).toHaveAccessibleDescription('Das Beet fehlt oder wurde gelöscht.');
    await menuItems.first().tap();
    await expect(page).toHaveURL(new RegExp(`${table}/${noBed.id}$`));
    await expect(page.getByRole('heading', { name: 'Andere Kultur' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Zur Beetfläche' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Zurück zur Tabelle' }).tap();
    await expect(card).toBeVisible();
    const assigned = page.locator('[data-mobile-card-id]').filter({ hasText: cropName });
    await assigned.getByRole('button', { name: /Aktionen für Anbauplan/ }).tap();
    await page.getByRole('menuitem', { name: 'Zur Kultur' }).tap();
    await expect(page).toHaveURL(new RegExp(`/app/crops\\?cropId=${crop.id}$`));

    await page.goto(`${table}?bedId=${bed.id}&create=true`);
    const create = page.getByRole('dialog', { name: 'Anbauplan hinzufügen' });
    await expect(create.getByRole('combobox', { name: 'Beet' })).toContainText('Details-Beet');
  });
});
