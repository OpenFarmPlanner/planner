import { expect, test, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject, waitForPageStable } from './utils';

test.use({ serviceWorkers: 'block' });

const create = (page: Page, path: string, data: Record<string, unknown>) => (
  apiRequest<{ id: number }>(page, 'POST', path, data)
);

test('records without an assignment, keeps failed input, and explicitly splits the harvest later', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'record-multiple-harvest-allocations', { loginAsAdmin: true });
  const season = await create(page, '/seasons/', { start_date: '2026-01-01', end_date: '2026-12-31' });
  const location = await create(page, '/locations/', { name: 'Erntehof' });
  const field = await create(page, '/fields/', { name: 'Erntefeld', location: location.id });
  const first = await create(page, '/beds/', { name: 'Nordbeet', field: field.id, area_sqm: 8 });
  const second = await create(page, '/beds/', { name: 'Südbeet', field: field.id, area_sqm: 8 });
  const crop = await create(page, '/crops/', {
    name: 'Test-Zucchini', default_harvest_unit: 'piece', average_harvest_piece_weight_g: 250,
    growth_duration_days: 60, harvest_duration_days: 60, expected_yield: 2, harvest_method: 'per_sqm',
  });
  const plan = (bed: number) => create(page, '/planting-plans/', {
    crop: crop.id, bed, season: season.id, planting_date: '2026-05-05', area_usage_sqm: 6,
  });
  await plan(first.id);

  await page.goto('/app/harvests');
  await expect(page.getByRole('heading', { name: 'Ernten', exact: true })).toBeVisible();
  await expect(page.getByText('Für diesen Zeitraum sind keine Ernten erfasst.')).toBeVisible();
  await page.getByRole('button', { name: 'Ernte hinzufügen' }).click();
  const form = page.getByRole('dialog', { name: 'Ernte hinzufügen' });
  await form.getByRole('combobox', { name: 'Kultur', exact: true }).fill('Test-Zucchini');
  await page.getByRole('option', { name: 'Test-Zucchini', exact: true }).click();
  await form.getByLabel('Erntedatum', { exact: true }).fill('2025-08-02');
  await expect(form.getByText(/gibt es keine passenden Anbaupläne/)).toBeVisible();
  await form.getByLabel('Erntedatum', { exact: true }).fill('2026-08-02');
  await form.getByRole('textbox', { name: 'Erntemenge' }).fill('12');
  await expect(form.getByRole('combobox', { name: 'Einheit' })).toHaveText('Stück');
  await expect(form.getByText('Geschätztes Gewicht · 3 kg')).toBeVisible();
  await expect(form.getByRole('button', { name: 'Anbauplan zuordnen' })).toBeVisible();
  await expect(form.getByText('Nicht zugeordnet')).toBeVisible();
  await expect(form.getByRole('combobox', { name: 'Anbauplan 1' })).toHaveCount(0);

  const endpoint = '**/api/harvests/';
  const offline = (route: import('@playwright/test').Route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 503 }) : route.continue();
  await page.route(endpoint, offline);
  await form.getByRole('button', { name: 'Speichern' }).click();
  await expect(form.getByRole('alert')).toContainText('Deine Eingaben bleiben erhalten.');
  await expect(form.getByRole('textbox', { name: 'Erntemenge' })).toHaveValue('12');
  await page.unroute(endpoint, offline);
  await form.getByRole('button', { name: 'Speichern' }).click();
  await expect(form).toBeHidden();
  await expect(page.getByText('Nicht zugeordnet')).toBeVisible();

  await plan(second.id);
  await page.getByRole('button', { name: /Ernteaktionen für Test-Zucchini/ }).click();
  await page.getByRole('menuitem', { name: 'Ernte bearbeiten' }).click();
  const edit = page.getByRole('dialog', { name: 'Ernte bearbeiten' });
  await expect(edit.getByText(/Geschätztes Gewicht/)).toBeVisible();
  for (const [index, bed, amount] of [[1, 'Nordbeet', '7'], [2, 'Südbeet', '6']] as const) {
    await edit.getByRole('button', { name: 'Anbauplan zuordnen' }).click();
    await edit.getByRole('combobox', { name: `Anbauplan ${index}`, exact: true }).click();
    await page.getByRole('option', { name: new RegExp(bed) }).click();
    await edit.getByRole('textbox', { name: 'Zugeordnete Menge' }).nth(index - 1).fill(amount);
  }
  await edit.getByRole('button', { name: 'Speichern' }).click();
  await expect(edit.getByRole('alert')).toContainText('Die zugeordneten Mengen überschreiten die Erntemenge.');
  await edit.getByRole('textbox', { name: 'Zugeordnete Menge' }).nth(1).fill('4');
  await expect(edit.getByText(/Übrig 1 Stück/)).toBeVisible();
  await edit.getByRole('button', { name: 'Speichern' }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByText('2 zugeordnete Anbaupläne')).toBeVisible();
  await expect(page.getByText('Erfasste Gesamtmenge · 12 Stück')).toBeVisible();
});

test('opens the shared harvest form from readonly carried plan details', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'harvest-from-carried-plan', {
    demoProject: true, demoYear: 2026, loginAsAdmin: true,
  });
  await page.goto('/app/planting-plans');
  await page.getByRole('searchbox', { name: 'Anbaupläne durchsuchen' }).fill('Rhabarber');
  const row = page.locator('[role="row"][data-id]').filter({ hasText: 'Rhabarber' });
  await expect(row.getByRole('button', { name: 'Läuft weiter aus Saison 2024. Hier nur lesbar.' })).toBeVisible();
  const id = await row.getAttribute('data-id');
  await page.getByRole('button', { name: 'Spalten', exact: true }).click();
  const actualColumn = page.getByRole('checkbox', { name: 'Tatsächliche Ernte' });
  await expect(actualColumn).not.toBeChecked();
  await actualColumn.check();
  await page.keyboard.press('Escape');
  const harvestCell = row.getByRole('gridcell').filter({ hasText: '3,5 kg' });
  await harvestCell.click();
  await expect.poll(() => harvestCell.evaluate(cell => cell.contains(document.activeElement))).toBe(true);
  await expect(page).toHaveURL(/\/app\/planting-plans$/);

  await page.goto(`/app/planting-plans/${id}`);
  await waitForPageStable(page);
  await expect(page.getByRole('button', { name: 'Räumungsdatum ändern' })).toHaveCount(0);
  await page.getByRole('button', { name: /Ernteaktionen für Rhabarber/ }).click();
  await page.getByRole('menuitem', { name: 'Ernte löschen' }).click();
  await page.getByRole('dialog', { name: 'Ernte löschen' }).getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByText('Diesem Anbauplan sind keine Ernten zugeordnet.')).toBeVisible();
  await page.getByRole('button', { name: 'Ernte hinzufügen' }).click();
  const form = page.getByRole('dialog', { name: 'Ernte hinzufügen' });
  await expect(form.getByRole('combobox', { name: 'Kultur', exact: true })).toHaveValue('Rhabarber');
  await expect(form.getByRole('combobox', { name: 'Anbauplan 1' })).toContainText('2024');
  await form.getByLabel('Erntedatum', { exact: true }).fill('2026-05-14');
  await form.getByRole('textbox', { name: 'Erntemenge' }).fill('2');
  await expect(form.getByRole('textbox', { name: 'Zugeordnete Menge' })).toHaveValue('2');
  await form.getByRole('button', { name: 'Speichern' }).click();
  await expect(form).toBeHidden();
  await expect(page.getByText('In dieser Saison zugeordnet · 2 kg')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Räumungsdatum ändern' })).toHaveCount(0);
});
