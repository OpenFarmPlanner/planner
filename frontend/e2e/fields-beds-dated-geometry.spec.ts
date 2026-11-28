import { expect, test, type Locator, type Page } from '@playwright/test';
import { apiRequest, loginWithDeterministicProject } from './utils';

// A used bed changes its measurements only through the preview/confirm
// dialog (#1634). A physical change from a later season keeps the earlier
// season's measurements, and the List shows each season's own values.

const BED = 'Geometriebeet';

const bedCell = (page: Page, field: string): Locator =>
  page.locator('[role="row"][data-id]').filter({ hasText: BED }).locator(`[role="gridcell"][data-field="${field}"]`);

async function selectSeason(page: Page, seasonId: number): Promise<void> {
  await page.evaluate((id) => {
    localStorage.setItem(`activeSeasonId:${localStorage.getItem('activeProjectId')}`, String(id));
  }, seasonId);
  await page.reload();
  await page.waitForLoadState('networkidle');
}

test('a physical change from a later season keeps the earlier season unchanged', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithDeterministicProject(page, request, 'fields-beds-dated-geometry', { loginAsAdmin: true });
  await page.goto('/app/fields-beds');
  await page.waitForLoadState('networkidle');
  const year = new Date().getFullYear();
  const current = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', {
    start_date: `${year}-01-01`, end_date: `${year}-12-31`,
  });
  const later = await apiRequest<{ id: number }>(page, 'POST', '/seasons/', {
    start_date: `${year + 1}-01-01`, end_date: `${year + 1}-12-31`,
  });
  const locations = await apiRequest<{ results: Array<{ id: number }> }>(page, 'GET', '/locations/');
  const field = await apiRequest<{ id: number }>(page, 'POST', '/fields/', {
    name: 'Geometrieparzelle', location: locations.results[0].id,
  });
  const bed = await apiRequest<{ id: number }>(page, 'POST', '/beds/', {
    name: BED, field: field.id, length_m: 10, width_m: 1,
  });
  await apiRequest(page, 'POST', '/planting-plans/', { bed: bed.id, season: current.id });

  await selectSeason(page, later.id);
  await expect(bedCell(page, 'area_sqm')).toContainText('10');
  await bedCell(page, 'width_m').dblclick();
  const width = page.locator('.MuiDataGrid-row--editing [data-field="width_m"] input');
  await width.fill('1,5');
  await width.press('Enter');

  const dialog = page.getByRole('dialog', { name: `Maße von „${BED}“ ändern` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /Physische Änderung ab Saison/ })).toBeChecked();
  await expect(dialog).toContainText('Bisher: 10 × 1 m (10 m²). Neu: 10 × 1,5 m (15 m²).');
  await dialog.getByRole('button', { name: 'Maße speichern' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/gelten 10 × 1,5 m \(15 m²\)/)).toBeVisible();
  await expect(bedCell(page, 'area_sqm')).toContainText('15');

  await selectSeason(page, current.id);
  await expect(bedCell(page, 'area_sqm')).toContainText('10');
  await expect(bedCell(page, 'width_m')).toContainText('1');
  const saved = await apiRequest<{ width_m: number }>(page, 'GET', `/beds/${bed.id}/`);
  expect(saved.width_m).toBe(1);
});
