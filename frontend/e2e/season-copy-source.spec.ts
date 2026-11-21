import { expect, test, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

test.use({ serviceWorkers: 'block' });

const plansPage = '/app/planting-plans';

function createSeason(page: Page, start: string, end: string, label: string) {
  return apiRequest<{ id: number }>(page, 'POST', '/seasons/', {
    start_date: start, end_date: end, custom_label: label,
  });
}

async function createPlan(page: Page, season: number, plantingDate: string, actualSowingDate?: string, growthDuration = 30) {
  const crop = await apiRequest<{ id: number }>(page, 'POST', '/crops/', {
    name: 'Kopiersalat', cultivation_type: 'direct_sowing', growth_duration_days: growthDuration,
  });
  return apiRequest<{ id: number }>(page, 'POST', '/planting-plans/', {
    season, crop: crop.id, planting_date: plantingDate, cultivation_type: 'direct_sowing',
    actual_sowing_date: actualSowingDate,
  });
}

test.describe('season copy on a French phone', () => {
  test.use({ hasTouch: true, viewport: { width: 375, height: 800 } });

  test('requires the immediately preceding season and names both custom periods', async ({ page, request }) => {
    await loginWithDeterministicProject(page, request, 'season-copy-preceding-french', { loginAsAdmin: true });
    await createSeason(page, '2024-09-01', '2025-08-31', 'Ancienne parcelle');
    const targetLabel = 'Nouveau jardin pédagogique et parcelle de démonstration du quartier';
    const sourceLabel = 'Jardin pédagogique avant la rénovation du système d’irrigation';
    const target = await createSeason(page, '2026-09-01', '2027-08-31', targetLabel);
    await apiRequest(page, 'PUT', '/auth/account/language/', { ui_language: 'fr' });

    const openCopyDialog = async () => {
      await page.getByRole('button', { name: 'Changer de saison active' }).tap();
      await page.getByRole('menuitem').filter({ hasText: targetLabel })
        .getByRole('button', { name: 'Ouvrir les actions de la saison' }).tap();
      await page.getByRole('menuitem', { name: 'Copier les données', exact: true }).tap();
      return page.getByRole('dialog', { name: 'Copier les données' });
    };

    await page.goto(plansPage);
    let dialog = await openCopyDialog();
    await expect(dialog.getByRole('alert')).toContainText('Créez d’abord la saison manquante');
    await expect(dialog.getByText(targetLabel, { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Copier', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    const source = await createSeason(page, '2025-09-01', '2026-08-31', sourceLabel);
    const original = await createPlan(page, source.id, '2026-04-01', '2026-04-06');
    await page.goto(plansPage);
    dialog = await openCopyDialog();
    await expect(dialog.getByText(sourceLabel, { exact: true })).toBeVisible();
    await expect(dialog.getByText(targetLabel, { exact: true })).toBeVisible();
    await expect(dialog.getByRole('combobox')).toHaveCount(0);
    expect(await dialog.evaluate(node => node.scrollWidth)).toBeLessThanOrEqual(375);

    const dateBasis = dialog.getByRole('checkbox', { name: 'Utiliser les dates réelles pour la planification' });
    await expect(dateBasis).not.toBeChecked();
    await expect(dateBasis).toHaveAccessibleDescription(/saison précédente.*date prévue/);
    const freshPreview = page.waitForResponse(response => (
      response.url().includes(`/seasons/${target.id}/copy-preview/`) && response.url().includes('use_actual_dates=true')
    ));
    await dateBasis.tap();
    const preview = await freshPreview;
    expect(preview.ok()).toBeTruthy();
    expect(new URL(preview.url()).searchParams.get('source_season_id')).toBe(String(source.id));
    await expect(dialog.getByRole('button', { name: 'Copier', exact: true })).toBeEnabled();
    const copying = page.waitForResponse(response => (
      response.url().endsWith(`/seasons/${target.id}/copy-from/`) && response.request().method() === 'POST'
    ));
    await dialog.getByRole('button', { name: 'Copier', exact: true }).focus();
    await page.keyboard.press('Enter');
    const response = await copying;
    expect(response.request().postDataJSON()).toEqual({ source_season_id: source.id, use_actual_dates: true });
    expect(await response.json()).toMatchObject({ copied_count: 1, target_planting_plan_count: 1 });
    await expect(dialog).toHaveCount(0);
    const { results } = await apiRequest<{ results: Array<{
      id: number; season: number; planting_date: string; actual_sowing_date: string | null;
    }> }>(
      page, 'GET', '/planting-plans/',
    );
    expect(results.find(plan => plan.id === original.id)).toMatchObject({
      season: source.id, planting_date: '2026-04-01', actual_sowing_date: '2026-04-06',
    });
    expect(results.filter(plan => plan.season === target.id)).toMatchObject([{
      planting_date: '2027-04-06', actual_sowing_date: null,
    }]);
  });
});

for (const basis of ['planned', 'actual'] as const) {
  test(`the suggested season copies ${basis} dates from the predecessor when an older season is active`, async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginWithDeterministicProject(page, request, `season-suggestion-preceding-${basis}`, { loginAsAdmin: true });
    const older = await createSeason(page, '2024-09-01', '2025-08-31', 'Historische Saison');
    const source = await createSeason(page, '2025-09-01', '2026-08-31', 'Unmittelbar vorherige Saison');
    await apiRequest(page, 'PATCH', '/season-pattern/', { start_day: 1, start_month: 9 });
    const original = await createPlan(page, source.id, '2026-04-01', '2026-04-06', 32);

    await page.goto(plansPage);
    const switcher = page.getByRole('button', { name: 'Aktive Saison wechseln' });
    await switcher.click();
    await page.getByRole('menuitem').filter({ hasText: 'Historische Saison' }).click();
    await expect(switcher).toContainText('Historische Saison');
    await switcher.click();
    await page.getByRole('menuitem').filter({ hasText: 'Saison 26/27 anlegen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Saison 26/27 anlegen?' });
    await expect(dialog.getByRole('checkbox', { name: /Daten aus Saison Unmittelbar vorherige Saison übernehmen/ })).toBeChecked();

    const dateBasis = dialog.getByRole('checkbox', { name: 'Ist-Termine als Plantermine verwenden' });
    await expect(dateBasis).not.toBeChecked();
    await expect(dateBasis).toHaveAccessibleDescription(/vorherigen Saison.*Plantermin/);
    if (basis === 'actual') {
      const preview = page.waitForResponse(response => (
        response.url().includes('/seasons/creation-options/') && response.url().includes('use_actual_dates=true')
      ));
      await dateBasis.check();
      expect((await preview).ok()).toBe(true);
      await expect(dialog.getByText(/Anbaupläne.*übernommen/)).toBeVisible();
    }
    const copying = page.waitForResponse(response => response.url().endsWith('/seasons/create-and-copy/'));
    await dialog.getByRole('button', { name: 'Anlegen', exact: true }).click();
    const response = await copying;
    expect(response.request().postDataJSON()).toEqual({
      start_date: '2026-09-01', end_date: '2027-08-31', source_season_id: source.id,
      ...(basis === 'actual' ? { use_actual_dates: true } : {}),
    });
    const created = await response.json();
    expect(created).toMatchObject({ planting_plan_count: 1 });
    await expect(switcher).toContainText('26/27');
    const { results } = await apiRequest<{ results: Array<{ id: number; planting_plan_count: number }> }>(page, 'GET', '/seasons/');
    expect(results.find(season => season.id === older.id)?.planting_plan_count).toBe(0);
    type Dates = { id: number; season: number; planting_date: string; harvest_date: string; actual_sowing_date: string | null };
    const { results: rows } = await apiRequest<{ results: Dates[] }>(page, 'GET', '/planting-plans/');
    expect(rows.filter(plan => plan.season === created.id)).toMatchObject([{
      planting_date: basis === 'actual' ? '2027-04-06' : '2027-04-01',
      harvest_date: '2027-05-03', actual_sowing_date: null,
    }]);
    expect(await apiRequest<Dates>(page, 'GET', `/planting-plans/${original.id}/`)).toMatchObject({
      planting_date: '2026-04-01', harvest_date: '2026-05-03', actual_sowing_date: '2026-04-06',
    });
  });
}
