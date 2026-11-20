import { expect, test } from '@playwright/test';

// Must match playwright.config.ts's webServer default, or this hits whatever
// else happens to be running on port 8000 (e.g. a developer's own dev backend)
// instead of the backend actually under test.
const backendPort = process.env.BACKEND_PORT ?? '8000';
const e2eToken = process.env.E2E_TEST_TOKEN || 'openfarmplanner-e2e-token';
const apiBase = `http://127.0.0.1:${backendPort}/api`;

test.describe('gantt calendar context-menu smoke test', () => {
  test('deep links, highlight, focus, drag update, and seedling search all work', async ({ page, request }) => {
    const scenario = 'gantt-smoke-1';

    // Reset + create a fresh project/admin user via the same fixture the
    // invitation-flow e2e tests use (no real user data touched).
    await request.post(`${apiBase}/__e2e__/invite-flow/`, {
      headers: { 'X-E2E-Token': e2eToken },
      data: { action: 'reset', scenario_id: scenario },
    });
    const setupResponse = await request.post(`${apiBase}/__e2e__/invite-flow/`, {
      headers: { 'X-E2E-Token': e2eToken },
      data: { action: 'setup', scenario_id: scenario, invitation_state: 'pending' },
    });
    const setup = await setupResponse.json() as { admin: { email: string; password: string }; projectSlug: string };

    // Log in as the admin through the real login form.
    await page.goto('/login');
    await page.getByLabel('E-Mail').fill(setup.admin.email);
    await page.locator('input[type="password"]').fill(setup.admin.password);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(/\/app\//, { timeout: 10_000 });

    const activeProjectId = await page.evaluate(() => window.localStorage.getItem('activeProjectId'));
    expect(activeProjectId).toBeTruthy();
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
      growth_duration_days: 30,
      harvest_duration_days: 14,
      propagation_duration_days: 21,
      cultivation_type: 'pre_cultivation',
      cultivation_types: ['pre_cultivation'],
      plants_per_m2: 4,
    });
    const plan = await api<{ id: number }>('/planting-plans/', {
      bed: bed.id,
      crop: crop.id,
      season: season.id,
      cultivation_type: 'pre_cultivation',
      planting_date: '2026-04-01',
      harvest_date: '2026-05-01',
      area_usage_sqm: 2,
    });

    // --- Occupancy view: context menu deep links + focus ---
    await page.goto('/app/gantt-chart');
    await expect(page.getByText('Feldplanung')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Testhof')).toBeVisible({ timeout: 10_000 });

    const taskBar = page.locator('[data-rmg-component="task"]').first();
    await expect(taskBar).toBeVisible({ timeout: 10_000 });
    await taskBar.click({ button: 'right' });

    const openBed = page.getByRole('menuitem', { name: 'Beet öffnen' });
    await expect(openBed).toBeVisible({ timeout: 5_000 });
    await openBed.click();

    await expect(page).toHaveURL(/\/app\/fields-beds\?highlight=bed:/, { timeout: 10_000 });
    await expect(page.getByText('Testbeet')).toBeVisible({ timeout: 10_000 });
    // The scroll-into-view + setCellFocus call is deferred (window.setTimeout
    // + requestAnimationFrame) until after the tree has expanded, so poll
    // rather than asserting immediately.
    await expect(async () => {
      const focusedField = await page.evaluate(() => document.activeElement?.getAttribute('data-field'));
      expect(focusedField).toBeTruthy();
    }).toPass({ timeout: 5_000 });

    // --- open-plan (view only, no edit mode) then Bearbeiten (edit mode) ---
    await page.goto('/app/gantt-chart');
    await expect(page.getByText('Testhof')).toBeVisible({ timeout: 10_000 });
    await taskBar.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Anbauplan öffnen' }).click();
    await expect(page).toHaveURL(/\/app\/planting-plans\?planId=\d+$/, { timeout: 10_000 });
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(0, { timeout: 5_000 });

    await page.goto('/app/gantt-chart');
    await expect(page.getByText('Testhof')).toBeVisible({ timeout: 10_000 });
    await taskBar.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Bearbeiten' }).click();
    await expect(page).toHaveURL(/\/app\/planting-plans\?planId=\d+&edit=true/, { timeout: 10_000 });
    await expect(page.locator('.MuiDataGrid-row--editing')).toHaveCount(1, { timeout: 5_000 });

    await page.goto('/app/gantt-chart');
    await expect(page.getByText('Testhof')).toBeVisible({ timeout: 10_000 });
    await taskBar.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Anbauplan-Details' }).click();
    await expect(page).toHaveURL(`/app/planting-plans/${plan.id}`);
    await expect(page.getByRole('heading', { name: 'Testkultur (Sorte A)' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // --- Mobile context menu links: the selected plan opens expanded, and
    // related crop/area links still land on the intended target. ---
    await page.setViewportSize({ width: 390, height: 844 });
    const openMobileTaskMenu = async (): Promise<void> => {
      await page.goto('/app/gantt-chart');
      await expect(page.getByText('Testhof')).toBeVisible({ timeout: 10_000 });
      const mobileTaskBar = page.locator('[data-rmg-component="task"]').first();
      await expect(mobileTaskBar).toBeVisible({ timeout: 10_000 });
      await mobileTaskBar.click({ button: 'right' });
    };

    await openMobileTaskMenu();
    await page.getByRole('menuitem', { name: 'Anbauplan öffnen' }).click();
    await expect(page).toHaveURL(/\/app\/planting-plans/, { timeout: 10_000 });
    await expect(page.getByText('Testkultur (Sorte A)').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Anbauart:/)).toBeVisible({ timeout: 10_000 });

    await openMobileTaskMenu();
    await page.getByRole('menuitem', { name: 'Kultur öffnen' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/crops\\?cropId=${crop.id}`), { timeout: 10_000 });
    await expect(page.getByText('Testkultur', { exact: true })).toBeVisible({ timeout: 10_000 });

    await openMobileTaskMenu();
    await page.getByRole('menuitem', { name: 'Beet öffnen' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/fields-beds\\?highlight=bed:${bed.id}`), { timeout: 10_000 });
    await expect(page.getByText('Testbeet')).toBeVisible({ timeout: 10_000 });

    await openMobileTaskMenu();
    await page.getByRole('menuitem', { name: 'Parzelle öffnen' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/fields-beds\\?highlight=field:${field.id}`), { timeout: 10_000 });
    await expect(page.getByText('Testfeld')).toBeVisible({ timeout: 10_000 });

    await openMobileTaskMenu();
    await page.getByRole('menuitem', { name: 'Standort öffnen' }).click();
    await expect(page).toHaveURL(new RegExp(`/app/fields-beds\\?highlight=location:${location.id}`), { timeout: 10_000 });
    await expect(page.getByText('Testhof')).toBeVisible({ timeout: 10_000 });

    await page.setViewportSize({ width: 1280, height: 720 });

    // --- Drag-and-drop: moving a bar persists a new planting_date, and the
    // bar's on-screen position never regresses back toward its start once
    // the drag begins (the "snaps back, then moves" flicker this session's
    // optimistic-update fix targeted). ---
    await page.goto('/app/gantt-chart');
    await expect(page.getByText('Testhof')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Alt+e');
    await expect(page.getByRole('button', { name: 'Zeitraum verschieben' })).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });

    const box = await taskBar.boundingBox();
    if (!box) throw new Error('task bar has no bounding box');
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    const leftPositions: number[] = [];
    for (const stepX of [startX + 40, startX + 80, startX + 120, startX + 160]) {
      await page.mouse.move(stepX, startY, { steps: 5 });
      const left = await taskBar.evaluate((el) => parseFloat((el as HTMLElement).style.left || '0'));
      leftPositions.push(left);
    }
    await page.mouse.up();

    // Monotonically increasing (dragging right): no backward jump mid-drag.
    for (let i = 1; i < leftPositions.length; i += 1) {
      expect(leftPositions[i]).toBeGreaterThanOrEqual(leftPositions[i - 1]);
    }

    await expect(async () => {
      const response = await page.request.get(`${apiBase}/planting-plans/${plan.id}/`, {
        headers: { 'X-Project-Id': String(projectId) },
      });
      const updatedPlan = await response.json() as { planting_date: string };
      expect(updatedPlan.planting_date).not.toBe('2026-04-01');
    }).toPass({ timeout: 5_000 });

    // --- Seedling view: own search field, no hierarchy filters ---
    await page.goto('/app/gantt-chart?view=seedlings');
    await expect(page.getByText('Testkultur').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByPlaceholder('Suche nach Kultur…')).toBeVisible();
    await expect(page.getByPlaceholder('Suche nach Kultur, Beet, Parzelle oder Standort…')).toHaveCount(0);

    await page.keyboard.press('/');
    await expect(page.getByPlaceholder('Suche nach Kultur…')).toBeFocused();
    await page.getByPlaceholder('Suche nach Kultur…').fill('Nichts passt hier');
    await expect(page.getByText('Testkultur')).toHaveCount(0);
  });
});
