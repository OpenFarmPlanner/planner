import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// Must match playwright.config.ts's webServer default, or this hits whatever
// else happens to be running on port 8000 (e.g. a developer's own dev backend)
// instead of the backend actually under test.
const backendPort = process.env.BACKEND_PORT ?? '8000';
const e2eToken = process.env.E2E_TEST_TOKEN || 'openfarmplanner-e2e-token';
const apiBase = `http://127.0.0.1:${backendPort}/api`;

// MUI's default breakpoints put `lg` at 1200px; the grid itself only renders
// from `md` (900px) upward, below which the page switches to a card list.
const SMALL_SCREEN_WIDTH = 1000;
const LARGE_SCREEN_WIDTH = 1400;

async function setUpPlantingPlan(page: Page, request: APIRequestContext, scenario: string): Promise<void> {
  await request.post(`${apiBase}/__e2e__/invite-flow/`, {
    headers: { 'X-E2E-Token': e2eToken },
    data: { action: 'reset', scenario_id: scenario },
  });
  const setupResponse = await request.post(`${apiBase}/__e2e__/invite-flow/`, {
    headers: { 'X-E2E-Token': e2eToken },
    data: { action: 'setup', scenario_id: scenario, invitation_state: 'pending' },
  });
  const setup = await setupResponse.json() as { admin: { email: string; password: string } };

  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(setup.admin.email);
  await page.locator('input[type="password"]').fill(setup.admin.password);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page).toHaveURL(/\/app\//, { timeout: 10_000 });

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

  const season = await api<{ id: number }>('/seasons/', { start_date: '2026-01-01', end_date: '2026-12-31' });
  const location = await api<{ id: number }>('/locations/', { name: 'Testhof' });
  const field = await api<{ id: number }>('/fields/', { name: 'Testfeld', location: location.id });
  const bed = await api<{ id: number }>('/beds/', { name: 'Testbeet', field: field.id, area_sqm: 5 });
  const crop = await api<{ id: number }>('/crops/', {
    name: 'Testkultur',
    variety: 'Sorte A',
    propagation_duration_days: 21,
    cultivation_type: 'pre_cultivation',
    cultivation_types: ['pre_cultivation'],
    plants_per_m2: 4,
  });
  await api('/planting-plans/', {
    bed: bed.id,
    crop: crop.id,
    season: season.id,
    cultivation_type: 'pre_cultivation',
    planting_date: '2026-04-01',
    harvest_date: '2026-05-01',
    area_usage_sqm: 2,
  });
}

test.describe('planting plans column management', () => {
  test('native columns panel toggles a column, and the choice persists across reload and later screen-size changes', async ({ page, request }) => {
    await page.setViewportSize({ width: LARGE_SCREEN_WIDTH, height: 900 });
    await setUpPlantingPlan(page, request, 'column-visibility-manual');

    await page.goto('/app/planting-plans');
    await expect(page.getByText('Testkultur (Sorte A)').first()).toBeVisible({ timeout: 10_000 });

    // No bespoke column-picker button anymore: open MUI's built-in columns
    // panel via a column header's own native "Spaltenmenü" → "Spalten
    // verwalten" menu item. The menu trigger only becomes visible on hover.
    const notesHeader = page.locator('[role="columnheader"][data-field="notes"]');
    await notesHeader.hover();
    await notesHeader.getByRole('button', { name: 'Notizen Spaltenmenü' }).click();
    await page.getByRole('menuitem', { name: 'Spalten verwalten' }).click();

    const notesColumnCheckbox = page.getByRole('checkbox', { name: 'Notizen' });
    await expect(notesColumnCheckbox).toBeVisible({ timeout: 5_000 });
    await expect(notesColumnCheckbox).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Ausfälle', exact: true })).not.toBeChecked();
    await notesColumnCheckbox.uncheck();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('columnheader', { name: 'Notizen' })).toHaveCount(0, { timeout: 5_000 });

    // Persistence: the manual choice survives a reload (localStorage-backed).
    await page.reload();
    await expect(page.getByText('Testkultur (Sorte A)').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('columnheader', { name: 'Notizen' })).toHaveCount(0);

    const storedModel = await page.evaluate(() => window.localStorage.getItem('tableColumns.plantingPlans'));
    expect(JSON.parse(storedModel ?? '{}')).toEqual({
      notes: false, season_status: false, actual_harvest: false, crop_loss_count: false,
    });

    // A saved choice must not be overridden by screen-size changes: shrinking
    // the viewport shouldn't re-apply the small-screen default (which never
    // even mentions "notes"), and the computed date fields — which the user
    // never touched — become visible again since the automatic default no
    // longer applies at all once a manual choice exists.
    await page.setViewportSize({ width: SMALL_SCREEN_WIDTH, height: 900 });
    await expect(page.getByRole('columnheader', { name: 'Notizen' })).toHaveCount(0);
    await expect(page.locator('[role="columnheader"][data-field="crop_loss_count"]')).toHaveCount(0);
    await expect(page.locator('[role="columnheader"][data-field="harvest_date"]')).toBeVisible();
  });

  test('hides the computed date columns by default on a small screen until the user makes a choice', async ({ page, request }) => {
    await page.setViewportSize({ width: SMALL_SCREEN_WIDTH, height: 900 });
    await setUpPlantingPlan(page, request, 'column-visibility-default');

    await page.goto('/app/planting-plans');
    await expect(page.getByText('Testkultur (Sorte A)').first()).toBeVisible({ timeout: 10_000 });

    await expect(page.locator('[role="columnheader"][data-field="harvest_date"]')).toHaveCount(0);
    await expect(page.locator('[role="columnheader"][data-field="harvest_end_date"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.localStorage.getItem('tableColumns.plantingPlans'))).toBeNull();

    // Still no saved choice, so widening the screen brings the default-hidden
    // columns back.
    await page.setViewportSize({ width: LARGE_SCREEN_WIDTH, height: 900 });
    await expect(page.locator('[role="columnheader"][data-field="harvest_date"]')).toBeVisible();
  });
});
