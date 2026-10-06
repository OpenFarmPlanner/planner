import { expect, test, type Page } from '@playwright/test';
import { loginWithDeterministicProject } from './utils';

const backendPort = process.env.BACKEND_PORT ?? '8000';
const apiBase = `http://127.0.0.1:${backendPort}/api`;

// 1100px keeps the desktop grid but is narrow enough for the responsive column
// visibility model to hide the two calculated harvest columns that sit right
// after "Pflanztermin" — the case where Tab used to die on the date cell
// because the hidden columns shifted the index handed to MUI's scrollToIndexes.
const NARROW_DESKTOP_WIDTH = 1100;

const focusedField = async (page: Page): Promise<string | null> =>
  page.evaluate(() =>
    document.activeElement?.closest('[role="gridcell"]')?.getAttribute('data-field') ?? null);

// These fixtures run against the demo project, which already seeds its own
// seasons (Jan–Dec, one per year of demo data). Creating another season for the
// same period fails the overlap check, so reuse the existing season that
// contains the fixture planting date instead of creating one.
async function resolveSeasonId(page: Page, projectId: number, containedDate: string): Promise<number> {
  const response = await page.request.get(`${apiBase}/seasons/`, {
    headers: { 'X-Project-Id': String(projectId) },
  });
  expect(
    response.ok(),
    `GET /seasons/ -> ${response.status()}: ${await response.text()}`,
  ).toBeTruthy();
  const { results } = (await response.json()) as {
    results: Array<{ id: number; start_date: string; end_date: string }>;
  };
  const season = results.find(
    (entry) => entry.start_date <= containedDate && containedDate <= entry.end_date,
  );
  if (!season) {
    throw new Error(`No demo season contains ${containedDate} (project ${projectId})`);
  }
  return season.id;
}

async function createAutocompleteFixture(
  page: Page,
): Promise<{ planId: number; targetCropName: string }> {
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

  const seasonId = await resolveSeasonId(page, projectId, '2026-05-01');
  const location = await api<{ id: number }>('/locations/', { name: 'Tastaturhof' });
  const field = await api<{ id: number }>('/fields/', { name: 'Tabfeld', location: location.id });
  const bed = await api<{ id: number }>('/beds/', { name: 'Autocomplete-Beet', field: field.id, area_sqm: 12 });
  const initialCrop = await api<{ id: number }>('/crops/', {
    name: 'Bohne',
    variety: 'Start',
    cultivation_type: 'direct_sowing',
    cultivation_types: ['direct_sowing'],
    plants_per_m2: 6,
  });
  await api<{ id: number }>('/crops/', {
    name: 'Zucchini',
    variety: 'Enter',
    cultivation_type: 'direct_sowing',
    cultivation_types: ['direct_sowing'],
    plants_per_m2: 1,
  });

  const plan = await api<{ id: number }>('/planting-plans/', {
    bed: bed.id,
    crop: initialCrop.id,
    season: seasonId,
    cultivation_type: 'direct_sowing',
    planting_date: '2026-05-01',
    area_usage_sqm: 2,
  });

  return { planId: plan.id, targetCropName: 'Zucchini (Enter)' };
}

async function createCultivationTypeFixture(page: Page): Promise<{ planId: number }> {
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

  const seasonId = await resolveSeasonId(page, projectId, '2026-05-01');
  const location = await api<{ id: number }>('/locations/', { name: 'Anbauart-Enter-Hof' });
  const field = await api<{ id: number }>('/fields/', { name: 'Anbauart-Enter-Feld', location: location.id });
  const bed = await api<{ id: number }>('/beds/', { name: 'Anbauart-Enter-Beet', field: field.id, area_sqm: 12 });
  const crop = await api<{ id: number }>('/crops/', {
    name: 'Gurke',
    variety: 'Enter',
    cultivation_type: 'direct_sowing',
    cultivation_types: ['direct_sowing', 'pre_cultivation'],
    plants_per_m2: 2,
  });
  const plan = await api<{ id: number }>('/planting-plans/', {
    bed: bed.id,
    crop: crop.id,
    season: seasonId,
    cultivation_type: 'direct_sowing',
    planting_date: '2026-05-01',
    area_usage_sqm: 2,
  });

  return { planId: plan.id };
}

async function createMissingSpacingFixture(page: Page): Promise<{ planId: number }> {
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

  const seasonId = await resolveSeasonId(page, projectId, '2026-05-01');
  const location = await api<{ id: number }>('/locations/', { name: 'Pflanzen-Tab-Hof' });
  const field = await api<{ id: number }>('/fields/', { name: 'Pflanzen-Tab-Feld', location: location.id });
  const bed = await api<{ id: number }>('/beds/', { name: 'Pflanzen-Tab-Beet', field: field.id, area_sqm: 12 });
  const crop = await api<{ id: number }>('/crops/', {
    name: 'Abstandslos',
    variety: 'Tab',
    cultivation_type: 'direct_sowing',
    cultivation_types: ['direct_sowing'],
  });
  const plan = await api<{ id: number }>('/planting-plans/', {
    bed: bed.id,
    crop: crop.id,
    season: seasonId,
    cultivation_type: 'direct_sowing',
    planting_date: '2026-05-01',
    area_usage_sqm: 2,
  });

  return { planId: plan.id };
}

async function createPlantsAreaLimitFixture(page: Page): Promise<{ planId: number }> {
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

  const seasonId = await resolveSeasonId(page, projectId, '2026-05-01');
  const location = await api<{ id: number }>('/locations/', { name: 'Pflanzen-Limit-Hof' });
  const field = await api<{ id: number }>('/fields/', { name: 'Pflanzen-Limit-Feld', location: location.id });
  const bed = await api<{ id: number }>('/beds/', { name: 'Pflanzen-Limit-Beet', field: field.id, area_sqm: 7 });
  const crop = await api<{ id: number }>('/crops/', {
    name: 'Limit-Salat',
    variety: 'Pflanzen',
    cultivation_type: 'direct_sowing',
    cultivation_types: ['direct_sowing'],
    distance_within_row_cm: 10,
    row_spacing_cm: 100,
  });
  const plan = await api<{ id: number }>('/planting-plans/', {
    bed: bed.id,
    crop: crop.id,
    season: seasonId,
    cultivation_type: 'direct_sowing',
    planting_date: '2026-05-01',
    area_usage_sqm: 2,
  });

  return { planId: plan.id };
}

test.describe('planting plans tab navigation with hidden columns', () => {
  test.beforeEach(async ({ page, request }) => {
    await page.setViewportSize({ width: NARROW_DESKTOP_WIDTH, height: 900 });
    await loginWithDeterministicProject(page, request, 'planting-plans-tab-navigation', {
      demoProject: true,
      loginAsAdmin: true,
    });
    await page.goto('/app/planting-plans');
    await expect(page.getByRole('heading', { name: 'Anbaupläne' })).toBeVisible();
    await expect(page.locator('[role="row"][data-id]').first()).toBeVisible();
  });

  test('Tab and Shift+Tab keep moving between editable cells around the date cell', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const rowWithEditablePlantCount = page
      .locator('[role="row"][data-id]')
      .filter({ has: page.locator('[data-field="plants_count"]', { hasText: /≈/ }) })
      .first();
    await expect(rowWithEditablePlantCount).toBeVisible();
    await rowWithEditablePlantCount.locator('[data-field="planting_date"]').dblclick();
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(1);
    await expect.poll(() => focusedField(page)).toBe('planting_date');

    await page.keyboard.press('Tab');
    await expect.poll(() => focusedField(page)).toBe('area_m2');

    await page.keyboard.press('Tab');
    await expect.poll(() => focusedField(page)).toBe('plants_count');

    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => focusedField(page)).toBe('area_m2');

    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => focusedField(page)).toBe('planting_date');

    expect(pageErrors).toEqual([]);
  });

  test('Enter commits the highlighted searchable crop option before grid navigation handles the key', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    const { planId, targetCropName } = await createAutocompleteFixture(page);

    await page.goto('/app/planting-plans');
    await expect(page.getByRole('heading', { name: 'Anbaupläne' })).toBeVisible();
    const firstRow = page.locator(`[role="row"][data-id="${planId}"]`);
    const cropCell = firstRow.locator('[data-field="crop"]');
    await expect(cropCell).toBeVisible();

    await cropCell.dblclick();
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(1);
    const editor = page.locator('.MuiDataGrid-row--editing [data-field="crop"] input[role="combobox"]');
    await expect(editor).toBeFocused();

    await editor.fill('Zucchini');
    await expect(page.getByRole('option', { name: targetCropName })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    const highlightedCropName = (await page.locator('[role="option"].Mui-focused').innerText()).trim();
    await page.keyboard.press('Enter');

    await expect(editor).toHaveValue(highlightedCropName);
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(1);

    await page.keyboard.press('Tab');
    await expect.poll(() => focusedField(page)).toBe('cultivation_type');
  });

  test('Enter commits the highlighted cultivation type option', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    const { planId } = await createCultivationTypeFixture(page);

    await page.goto('/app/planting-plans');
    await expect(page.getByRole('heading', { name: 'Anbaupläne' })).toBeVisible();
    const row = page.locator(`[role="row"][data-id="${planId}"]`);
    const cultivationTypeCell = row.locator('[data-field="cultivation_type"]');
    await expect(cultivationTypeCell).toBeVisible();

    await cultivationTypeCell.dblclick();
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(1);
    await expect(page.getByRole('listbox')).toBeVisible();

    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('option', { name: 'Pflanzung' })).toBeVisible();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('listbox')).toBeHidden();
    await expect(cultivationTypeCell.getByRole('combobox')).toHaveText('Pflanzung');
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(1);
  });

  test('Tab keeps plants and growing-area cells in the row edit flow', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    const { planId } = await createMissingSpacingFixture(page);

    await page.goto('/app/planting-plans');
    await expect(page.getByRole('heading', { name: 'Anbaupläne' })).toBeVisible();
    const row = page.locator(`[role="row"][data-id="${planId}"]`);
    await expect(row).toBeVisible();

    await row.locator('[data-field="area_m2"]').dblclick();
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(1);
    await expect.poll(() => focusedField(page)).toBe('area_m2');

    await page.keyboard.press('Tab');
    await expect.poll(() => focusedField(page)).toBe('plants_count');
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(1);

    // The grid can re-assert focus on the just-edited plants cell for a tick
    // after the Tab above, so keep re-focusing until the cultivation-type cell
    // actually holds focus before driving the next Tab.
    await expect(async () => {
      await row.locator('[data-field="cultivation_type"]').focus();
      expect(await focusedField(page)).toBe('cultivation_type');
    }).toPass({ timeout: 5_000 });

    await page.keyboard.press('Tab');
    await expect.poll(() => focusedField(page)).toBe('bed');
    await expect(page.getByRole('dialog', { name: 'Anbaufläche ändern' })).toBeHidden();
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(1);
  });

  test('saving too many plants opens the area limit dialog', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    const { planId } = await createPlantsAreaLimitFixture(page);

    await page.goto('/app/planting-plans');
    await expect(page.getByRole('heading', { name: 'Anbaupläne' })).toBeVisible();
    const row = page.locator(`[role="row"][data-id="${planId}"]`);
    const plantsCell = row.locator('[data-field="plants_count"]');
    await expect(plantsCell).toBeVisible();

    await plantsCell.dblclick();
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(1);
    const plantsInput = row.locator('[data-field="plants_count"] input');
    await expect(plantsInput).toBeFocused();
    await plantsInput.fill('1000');
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', {
      name: 'Die angegebene Fläche überschreitet die Größe dieses Beets.',
    });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Beetfläche: 7,00 m²');
    await expect(dialog).toContainText('Angefragt: 100,00 m²');
  });
});
