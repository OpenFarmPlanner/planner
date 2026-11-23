import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { loginWithDeterministicProject } from './utils';

const backendPort = process.env.BACKEND_PORT ?? '8000';
const apiBase = `http://127.0.0.1:${backendPort}/api`;

interface SowingDateEditFixture {
  planId: number;
  propagationDurationDays: number;
  api: <T>(path: string, data: Record<string, unknown>) => Promise<T>;
  getPlan: () => Promise<{ planting_date: string; planned_propagation_start_date: string | null }>;
}

async function createSowingDateEditFixture(
  page: Page,
  request: APIRequestContext,
  scenario: string,
  plannedPropagationStart?: string,
): Promise<SowingDateEditFixture> {
  await loginWithDeterministicProject(page, request, scenario, { loginAsAdmin: true });

  const activeProjectId = await page.evaluate(() => window.localStorage.getItem('activeProjectId'));
  const projectId = Number(activeProjectId);
  const csrfToken = await page.evaluate(() =>
    document.cookie.split('; ').find((row) => row.startsWith('csrftoken='))?.split('=')[1] ?? '');

  const api = async <T,>(path: string, data: Record<string, unknown>): Promise<T> => {
    const response = await page.request.post(`${apiBase}${path}`, {
      headers: {
        'X-CSRFToken': csrfToken,
        'Content-Type': 'application/json',
        'X-Project-Id': String(projectId),
      },
      data: { ...data, project: projectId },
    });
    expect(response.ok(), `${path} -> ${response.status()}: ${await response.text()}`).toBeTruthy();
    return response.json() as Promise<T>;
  };

  const propagationDurationDays = 20;
  const season = await api<{ id: number }>('/seasons/', { start_date: '2026-01-01', end_date: '2026-12-31' });
  const location = await api<{ id: number }>('/locations/', { name: 'Aussaat-Edit-Hof' });
  const field = await api<{ id: number }>('/fields/', { name: 'Aussaat-Edit-Feld', location: location.id });
  const bed = await api<{ id: number }>('/beds/', { name: 'Aussaat-Edit-Beet', field: field.id, area_sqm: 10 });
  const crop = await api<{ id: number }>('/crops/', {
    name: 'Aussaat-Edit-Kultur',
    variety: 'Sorte A',
    propagation_duration_days: propagationDurationDays,
    cultivation_type: 'pre_cultivation',
    cultivation_types: ['pre_cultivation'],
    plants_per_m2: 4,
  });
  const plan = await api<{ id: number }>('/planting-plans/', {
    bed: bed.id,
    crop: crop.id,
    season: season.id,
    cultivation_type: 'pre_cultivation',
    planting_date: '2026-05-01',
    planned_propagation_start_date: plannedPropagationStart,
    area_usage_sqm: 1,
  });

  const getPlan = async (): ReturnType<SowingDateEditFixture['getPlan']> => {
    const response = await page.request.get(`${apiBase}/planting-plans/${plan.id}/`, {
      headers: { 'X-Project-Id': String(projectId) },
    });
    expect(response.ok(), `GET plan -> ${response.status()}: ${await response.text()}`).toBeTruthy();
    return response.json();
  };

  return { planId: plan.id, propagationDurationDays, api, getPlan };
}

async function selectPlannedDates(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Terminansicht / }).click();
  await page.getByRole('menuitemradio', { name: 'Geplant', exact: true }).click();
}

test.describe('planting plans sowing date edit', () => {
  test('editing Aussaattermin on an existing row persists the shifted Pflanztermin on save', async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    const fixture = await createSowingDateEditFixture(page, request, 'planting-plans-sowing-date-edit');

    await page.goto('/app/planting-plans');
    await expect(page.getByRole('heading', { name: 'Anbaupläne' })).toBeVisible();
    await selectPlannedDates(page);

    const row = page.locator(`[role="row"][data-id="${fixture.planId}"]`);
    await expect(row).toBeVisible();
    const sowingCell = row.locator('[data-field="sowing_date"]');
    // Anzucht with a 20-day propagation duration: planting_date 2026-05-01
    // implies a sowing date of 2026-04-11.
    await expect(sowingCell).toContainText('11.4.2026');

    await sowingCell.dblclick();
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(1);
    const sowingInput = row.locator('[data-field="sowing_date"] input[type="text"]');
    await expect(sowingInput).toBeFocused();
    await sowingInput.fill('20.04.2026');
    await sowingInput.press('Enter');
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(0, { timeout: 5000 });

    // Pflanztermin must have moved with it — 20.04.2026 + 20 days.
    await expect(row.locator('[data-field="planting_date"]')).toContainText('10.5.2026');
    await expect(sowingCell).toContainText('20.4.2026');

    const persisted = await fixture.getPlan();
    expect(persisted.planting_date).toBe('2026-05-10');

    // Reloading from the server must show the same, persisted values —
    // not just an optimistic client-side state.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Anbaupläne' })).toBeVisible();
    const reloadedRow = page.locator(`[role="row"][data-id="${fixture.planId}"]`);
    await expect(reloadedRow.locator('[data-field="sowing_date"]')).toContainText('20.4.2026');
    await expect(reloadedRow.locator('[data-field="planting_date"]')).toContainText('10.5.2026');
  });

  test('editing Pflanztermin on an existing row keeps the recomputed Aussaattermin on save', async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    const fixture = await createSowingDateEditFixture(page, request, 'planting-plans-planting-date-edit');

    await page.goto('/app/planting-plans');
    await expect(page.getByRole('heading', { name: 'Anbaupläne' })).toBeVisible();
    await selectPlannedDates(page);

    const row = page.locator(`[role="row"][data-id="${fixture.planId}"]`);
    await expect(row).toBeVisible();
    const plantingCell = row.locator('[data-field="planting_date"]');

    await plantingCell.dblclick();
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(1);
    const plantingInput = row.locator('[data-field="planting_date"] input[type="text"]');
    await expect(plantingInput).toBeFocused();
    await plantingInput.fill('15.06.2026');
    await plantingInput.press('Enter');
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(0, { timeout: 5000 });

    // Aussaattermin must follow — 15.06.2026 minus 20 days.
    await expect(row.locator('[data-field="sowing_date"]')).toContainText('26.5.2026');

    const persisted = await fixture.getPlan();
    expect(persisted.planting_date).toBe('2026-06-15');
  });

  test('edits an independently planned propagation date without moving the transplant date', async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    const fixture = await createSowingDateEditFixture(page, request, 'independent-propagation-date', '2026-04-15');
    await page.goto('/app/planting-plans');
    await selectPlannedDates(page);

    const row = page.locator(`[role="row"][data-id="${fixture.planId}"]`);
    const sowingCell = row.locator('[data-field="sowing_date"]');
    await expect(sowingCell).toContainText('15.4.2026');
    await sowingCell.dblclick();
    const sowingInput = sowingCell.getByRole('textbox');
    await expect(sowingInput).toBeFocused();
    await sowingInput.fill('17.04.2026');
    await sowingInput.press('Enter');
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(0);

    expect(await fixture.getPlan()).toMatchObject({
      planned_propagation_start_date: '2026-04-17', planting_date: '2026-05-01',
    });
    await page.reload();
    await expect(sowingCell).toContainText('17.4.2026');
    await expect(row.locator('[data-field="planting_date"]')).toContainText('1.5.2026');
  });

  test('recomputes propagation timing when the grid changes the crop', async ({ page, request }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    const fixture = await createSowingDateEditFixture(page, request, 'replace-propagation-crop', '2026-04-15');
    const replacement = await fixture.api<{ id: number }>('/crops/', {
      name: 'Ersatzkultur',
      propagation_duration_days: 30,
      cultivation_type: 'pre_cultivation',
      cultivation_types: ['pre_cultivation'],
      plants_per_m2: 4,
    });
    await page.goto('/app/planting-plans');

    const row = page.locator(`[role="row"][data-id="${fixture.planId}"]`);
    const sowingCell = row.locator('[data-field="sowing_date"]');
    await expect(sowingCell).toContainText('15.4.2026');
    const cropCell = row.locator('[data-field="crop"]');
    await cropCell.dblclick();
    await cropCell.getByRole('combobox').fill('Ersatzkultur');
    await page.getByRole('option', { name: 'Ersatzkultur' }).click();
    await page.getByRole('heading', { name: 'Anbaupläne' }).click();

    await expect(sowingCell).toContainText('1.4.2026');
    expect(await fixture.getPlan()).toMatchObject({
      crop: replacement.id,
      planned_propagation_start_date: null,
      planting_date: '2026-05-01',
    });
  });

  test('keeps the planned propagation date when duplicating on mobile', async ({ page, request }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    const fixture = await createSowingDateEditFixture(page, request, 'duplicate-mobile-propagation', '2026-04-15');
    await page.goto('/app/planting-plans');

    const card = page.locator(`[data-mobile-card-id="${fixture.planId}"]`);
    await card.getByRole('button', { name: /Aktionen für Anbauplan/ }).click();
    await page.getByRole('menuitem', { name: 'Duplizieren' }).click();
    const dialog = page.getByRole('dialog', { name: 'Anbauplan hinzufügen' });
    await expect(dialog.getByRole('textbox', { name: 'Aussaattermin' })).toHaveValue('15.04.2026');

    const created = page.waitForResponse(response =>
      new URL(response.url()).pathname === '/api/planting-plans/' && response.request().method() === 'POST'
    );
    await dialog.getByRole('button', { name: 'Hinzufügen' }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    expect(await response.json()).toMatchObject({
      planned_propagation_start_date: '2026-04-15',
      planting_date: '2026-05-01',
      actual_propagation_start_date: null,
    });
    await expect(dialog).toBeHidden();
  });
});
