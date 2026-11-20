import { expect, test, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

test.use({ serviceWorkers: 'block' });

const create = (page: Page, path: string, data: Record<string, unknown>) => (
  apiRequest<{ id: number }>(page, 'POST', path, data)
);

test('records and edits separate crop losses from an empty plan on mobile', async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await loginWithDeterministicProject(page, request, 'crop-loss-empty-plan', { loginAsAdmin: true });
  const season = await create(page, '/seasons/', { start_date: '2026-01-01', end_date: '2026-12-31' });
  const crop = await create(page, '/crops/', { name: 'Ausfall-Testsalat', growth_duration_days: 50 });
  const plan = await create(page, '/planting-plans/', { crop: crop.id, season: season.id, planting_date: '2026-05-01' });
  await page.goto(`/app/planting-plans/${plan.id}`);
  await expect(page.getByText('Keine Ausfälle erfasst.')).toBeVisible();
  const add = page.getByRole('button', { name: 'Ausfall erfassen' });
  await add.click();
  const form = page.getByRole('dialog', { name: 'Ausfall erfassen' });
  const extent = form.getByRole('textbox', { name: 'Ausmaß (optional)' });
  await form.getByLabel('Ausfalldatum').fill('2026-05-11');
  await form.getByRole('combobox', { name: 'Ursache' }).click();
  await page.getByRole('option', { name: 'Staunässe' }).click();
  await form.getByRole('combobox', { name: 'Einheit' }).click();
  await page.getByRole('option', { name: 'Fläche (m²)' }).click();
  await extent.fill('1,5');
  await form.getByRole('textbox', { name: 'Notiz (optional)' }).fill('Nördliches Beetende');
  const save = form.getByRole('button', { name: 'Speichern' });
  const endpoint = '**/api/crop-losses/';
  const unavailable = (route: import('@playwright/test').Route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 503 }) : route.continue();
  await page.route(endpoint, unavailable);
  await save.click();
  await expect(form.getByRole('alert')).toContainText('Der Ausfall konnte nicht gespeichert werden.');
  await expect(extent).toHaveValue('1,5');
  await page.unroute(endpoint, unavailable);
  await save.click();
  await expect(form).toBeHidden();
  const incidents = page.getByRole('list', { name: 'Ausfälle' });
  await expect(incidents.getByText('Teilausfall · Staunässe · 1,5 m²')).toBeVisible();

  await add.click();
  await form.getByLabel('Ausfalldatum').fill('2026-06-11');
  await form.getByRole('combobox', { name: 'Ursache' }).click();
  await page.getByRole('option', { name: 'Frost', exact: true }).click();
  await form.getByRole('textbox', { name: 'Notiz (optional)' }).fill('Abgedeckte Reihe');
  await extent.fill('15');
  const lossType = form.getByRole('combobox', { name: 'Art des Ausfalls' });
  await lossType.click();
  await page.getByRole('option', { name: 'Totalausfall' }).click();
  await expect(extent).toHaveCount(0);
  await expect(form.getByRole('combobox', { name: 'Einheit' })).toHaveCount(0);
  await expect(form.getByLabel('Ausfalldatum')).toHaveValue('2026-06-11');
  await expect(form.getByRole('combobox', { name: 'Ursache' })).toHaveText('Frost');
  await expect(form.getByRole('textbox', { name: 'Notiz (optional)' })).toHaveValue('Abgedeckte Reihe');
  await lossType.click();
  await page.getByRole('option', { name: 'Teilausfall' }).click();
  await expect(extent).toHaveValue('15');
  await lossType.click();
  await page.getByRole('option', { name: 'Totalausfall' }).click();
  await save.click();
  await expect(form).toBeHidden();
  await expect(incidents.getByRole('listitem')).toHaveCount(2);
  await expect(incidents.getByRole('listitem').first()).toContainText('Totalausfall · Frost');

  await incidents.getByRole('button', { name: /Staunässe/ }).click();
  await page.getByRole('menuitem', { name: 'Ausfall bearbeiten' }).click();
  const edit = page.getByRole('dialog', { name: 'Ausfall bearbeiten' });
  await expect(edit.getByRole('textbox', { name: 'Ausmaß (optional)' })).toHaveValue('1,5');
  await edit.getByRole('combobox', { name: 'Einheit' }).click();
  await page.getByRole('option', { name: 'Pflanzen', exact: true }).click();
  await edit.getByRole('button', { name: 'Speichern' }).click();
  await expect(edit.getByText('Gib eine ganze, nicht negative Pflanzenanzahl ein.')).toBeVisible();
  await edit.getByRole('textbox', { name: 'Ausmaß (optional)' }).fill('2');
  await edit.getByRole('button', { name: 'Speichern' }).click();
  await expect(edit).toBeHidden();
  await expect(incidents.getByText('Teilausfall · Staunässe · 2 Pflanzen')).toBeVisible();

  await incidents.getByRole('button', { name: /Frost/ }).click();
  await page.getByRole('menuitem', { name: 'Ausfall löschen' }).click();
  await page.getByRole('dialog', { name: 'Ausfall löschen' }).getByRole('button', { name: 'Löschen', exact: true }).click();
  await expect(incidents.getByRole('listitem')).toHaveCount(1);
  await expect(incidents.getByText('Teilausfall · Staunässe · 2 Pflanzen')).toBeVisible();

  await incidents.getByRole('button', { name: /Staunässe/ }).click();
  await page.getByRole('menuitem', { name: 'Ausfall bearbeiten' }).click();
  await edit.getByRole('textbox', { name: 'Ausmaß (optional)' }).fill('0');
  await edit.getByRole('button', { name: 'Speichern' }).click();
  await expect(incidents.getByText('Teilausfall · Staunässe · 0 Pflanzen')).toBeVisible();
});

test('shows an optional count while preserving planting-plan grid navigation', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'crop-loss-demo-count', {
    loginAsAdmin: true, demoProject: true, demoYear: 2026,
  });
  const losses = await apiRequest<{ results: Array<{ planting_plan: number; cause: string }> }>(page, 'GET', '/crop-losses/');
  const planId = losses.results.find(row => row.cause === 'frost')!.planting_plan;
  await page.goto('/app/planting-plans');
  await page.getByRole('searchbox', { name: 'Anbaupläne durchsuchen' }).fill('Tomate');
  const row = page.locator(`[role="row"][data-id="${planId}"]`);
  await expect(row).toBeVisible();
  await page.getByRole('button', { name: 'Spalten', exact: true }).click();
  const column = page.getByRole('checkbox', { name: 'Ausfälle', exact: true });
  await expect(column).not.toBeChecked();
  await column.check();
  await page.keyboard.press('Escape');
  const cell = row.locator('[data-field="crop_loss_count"]');
  await expect(cell).toHaveText('2 Ausfälle');
  await cell.click();
  await expect(cell).toBeFocused();
  await expect(page).toHaveURL(/\/app\/planting-plans$/);
  await cell.dblclick();
  await expect(row).not.toHaveClass(/MuiDataGrid-row--editing/);
  await cell.press('ArrowLeft');
  await expect(cell).not.toBeFocused();
  const cropCell = row.locator('[data-field="crop"]');
  await cropCell.dblclick();
  await expect(row).toHaveClass(/MuiDataGrid-row--editing/);
  await page.keyboard.press('Escape');
  await expect(row).not.toHaveClass(/MuiDataGrid-row--editing/);
  await row.hover();
  await row.getByRole('button', { name: 'Aktionen', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Anbauplan-Details' }).click();
  const detail = page.getByRole('dialog', { name: 'Anbauplan-Details' });
  const incidents = detail.getByRole('list', { name: 'Ausfälle' });
  await expect(incidents.getByRole('listitem')).toHaveCount(2);
  await expect(incidents.getByText(/Teilausfall · Frost · 20/)).toBeVisible();
  await expect(incidents.getByText('Teilausfall · Schädlinge · 3 Pflanzen')).toBeVisible();
});
